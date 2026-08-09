import fsExtra from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCTOR_ADAPTER_CONTRACT_VERSION,
  DOCTOR_DIAGNOSTIC_DOMAINS,
  DoctorAdapterRegistry,
  type DoctorAdapterDescriptor,
} from '../doctor/adapter-contract.js';
import {
  assessDoctorCapability,
  buildDoctorCapabilitiesReport,
  createBuiltinDoctorAdapterRegistry,
} from '../doctor/capability-registry.js';
import { runDoctorCapabilities } from '../doctor/capabilities-command.js';
import { DOCTOR_DISEASE_CORPUS, runDoctorValidationCorpus } from '../doctor/validation-corpus.js';
import { buildDoctorDiagnosis } from '../doctor/diagnosis-engine.js';

function descriptor(id: string): DoctorAdapterDescriptor {
  return {
    contractVersion: DOCTOR_ADAPTER_CONTRACT_VERSION,
    id,
    runtimeFamilies: [id],
    aliases: [],
    frameworks: [],
    projectKinds: ['generic'],
    tier: 'extended',
    platforms: ['linux', 'darwin', 'win32'],
    domains: DOCTOR_DIAGNOSTIC_DOMAINS.map((domain) => ({
      domain,
      level: 'portable',
      evidenceSources: ['fixture'],
      limitations: [],
    })),
    repairModes: ['manual-guidance'],
    source: 'package',
    limitations: [],
  };
}

describe('Doctor capability and validation architecture', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tempDirs) await fsExtra.remove(dir);
    tempDirs.length = 0;
  });

  it('publishes complete domain truth for every built-in runtime adapter', () => {
    const adapters = createBuiltinDoctorAdapterRegistry().list();
    expect(adapters.map((entry) => entry.runtimeFamilies[0])).toEqual(
      expect.arrayContaining([
        'node',
        'python',
        'go',
        'java',
        'dotnet',
        'rust',
        'php',
        'ruby',
        'elixir',
        'clojure',
        'deno',
        'bun',
        'scala',
        'kotlin',
        'c',
        'cpp',
        'unknown',
      ])
    );
    for (const adapter of adapters) {
      expect(adapter.platforms).toEqual(['linux', 'darwin', 'win32']);
      expect(adapter.domains.map((entry) => entry.domain).sort()).toEqual(
        [...DOCTOR_DIAGNOSTIC_DOMAINS].sort()
      );
      expect(new Set(adapter.domains.map((entry) => entry.domain)).size).toBe(6);
      for (const domain of adapter.domains.filter((entry) => entry.level === 'unsupported')) {
        expect(domain.limitations.length).toBeGreaterThan(0);
      }
    }
  });

  it('routes aliases and frameworks without allowing ambiguous ownership', () => {
    const registry = createBuiltinDoctorAdapterRegistry();
    expect(registry.resolve({ runtimeFamily: 'TypeScript' })?.id).toBe('builtin.node');
    expect(registry.resolve({ framework: 'Spring Boot' })?.id).toBe('builtin.java');
    expect(registry.resolve({ framework: 'Ruby on Rails' })?.id).toBe('builtin.ruby');
    expect(
      registry.resolveWithDiagnostics({ runtimeFamily: 'node', framework: 'Spring Boot' })
    ).toMatchObject({
      status: 'conflict',
      descriptor: null,
      runtimeOwner: 'builtin.node',
      frameworkOwner: 'builtin.java',
    });

    const custom = new DoctorAdapterRegistry().register(descriptor('custom'));
    expect(() => custom.register(descriptor('custom'))).toThrow(/already registered/);
    const incomplete = descriptor('incomplete');
    incomplete.domains = incomplete.domains.slice(1);
    expect(() => new DoctorAdapterRegistry().register(incomplete)).toThrow(
      /every canonical diagnostic domain/
    );
  });

  it('fails closed for an unknown runtime instead of claiming native coverage', () => {
    const assessment = assessDoctorCapability({ runtimeFamily: 'alien-runtime' });
    expect(assessment).toMatchObject({
      adapterId: 'builtin.unknown',
      runtimeFamily: 'unknown',
      tier: 'fallback',
      confidence: 'low',
    });
    expect(assessment.nativeDomains).toEqual([]);
    expect(assessment.unsupportedDomains).toContain('security');
    expect(assessment.limitations.join(' ')).toMatch(/fail-closed|unknown/i);
  });

  it('fails closed when runtime and framework metadata select different adapters', () => {
    const assessment = assessDoctorCapability({
      runtimeFamily: 'node',
      framework: 'Spring Boot',
    });
    expect(assessment).toMatchObject({
      adapterId: 'builtin.unknown',
      tier: 'fallback',
      confidence: 'low',
    });
    expect(assessment.limitations.join(' ')).toMatch(/ownership conflict.*failed closed/i);
    expect(
      buildDoctorCapabilitiesReport({ runtime: 'node', framework: 'Spring Boot' }).adapters[0]
        ?.limitations
    ).toEqual(
      expect.arrayContaining([expect.stringMatching(/ownership conflict.*failed closed/i)])
    );
  });

  it('does not turn passing generic probes into full coverage for an unsupported domain', () => {
    const probes = DOCTOR_DIAGNOSTIC_DOMAINS.map((domain) => ({
      id: `${domain}-pass`,
      label: `${domain} pass`,
      status: 'pass' as const,
      severity: 'info' as const,
      reason: `${domain} generic observation passed.`,
      issueClass:
        domain === 'configuration' ? 'configuration' : domain === 'quality' ? 'quality' : domain,
      operationalImpact: 'none',
    }));
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'unknown-project',
      projectPath: '/workspace/unknown-project',
      runtimeFamily: 'alien-runtime',
      projectKind: 'generic',
      probes,
    });

    expect(diagnosis.domains.find((domain) => domain.id === 'security')).toMatchObject({
      status: 'not-run',
    });
    expect(diagnosis.coverage.diagnosisCompleteness).toBeLessThan(100);
    expect(diagnosis.unknowns.some((entry) => entry.id.includes('unknown:domain:security'))).toBe(
      true
    );
  });

  it('does not claim complete diagnosis for unevaluated runtimes in a composite project', () => {
    const probes = DOCTOR_DIAGNOSTIC_DOMAINS.map((domain) => ({
      id: `${domain}-pass`,
      label: `${domain} pass`,
      status: 'pass' as const,
      severity: 'info' as const,
      reason: `${domain} observation passed for the primary runtime.`,
      issueClass:
        domain === 'configuration' ? 'configuration' : domain === 'quality' ? 'quality' : domain,
      operationalImpact: 'none',
    }));
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'polyglot-service',
      projectPath: '/workspace/polyglot-service',
      runtimeFamily: 'node',
      runtimeFamilies: ['node', 'python'],
      projectKind: 'backend',
      probes,
    });

    expect(diagnosis.coverage.diagnosisCompleteness).toBe(50);
    expect(diagnosis.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^unknown:runtime:python:/) }),
      ])
    );
  });

  it('allows a package adapter to own an otherwise unknown runtime without patching the core', () => {
    const registry = createBuiltinDoctorAdapterRegistry().register(descriptor('zig'));
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'zig-service',
      projectPath: '/workspace/zig-service',
      runtimeFamily: 'zig',
      projectKind: 'backend',
      probes: [],
      adapterRegistry: registry,
    });
    expect(diagnosis.capability).toMatchObject({
      adapterId: 'zig',
      runtimeFamily: 'zig',
      tier: 'extended',
      confidence: 'medium',
    });
  });

  it('binds capability truth into every canonical project diagnosis', () => {
    const diagnosis = buildDoctorDiagnosis({
      projectName: 'web',
      projectPath: '/workspace/web',
      runtimeFamily: 'node',
      framework: 'Next.js',
      projectKind: 'frontend',
      probes: [],
    });
    expect(diagnosis.capability).toMatchObject({
      adapterId: 'builtin.node',
      runtimeFamily: 'node',
      tier: 'first-class',
      confidence: 'high',
    });
    expect(diagnosis.capability.nativeDomains).toHaveLength(6);
  });

  it('passes the complete versioned disease corpus with bounded metrics', () => {
    const report = runDoctorValidationCorpus();
    const adapterCount = createBuiltinDoctorAdapterRegistry().list().length;
    expect(report.summary).toMatchObject({
      totalCases: DOCTOR_DISEASE_CORPUS.length * adapterCount,
      passedCases: DOCTOR_DISEASE_CORPUS.length * adapterCount,
      failedCases: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      domainCoverage: 1,
      runtimeAdapterCoverage: 1,
      runtimeAdaptersExercised: adapterCount,
      declaredPlatforms: 3,
    });
  });

  it('keeps the future package core independent from CLI and workspace adapters', async () => {
    const sourceRoot = path.resolve(import.meta.dirname, '..', 'doctor');
    for (const fileName of [
      'adapter-contract.ts',
      'capability-registry.ts',
      'diagnosis-engine.ts',
      'validation-corpus.ts',
    ]) {
      const source = await fsExtra.readFile(path.join(sourceRoot, fileName), 'utf8');
      expect(source, fileName).not.toMatch(
        /from ['"](?:commander|chalk|fs-extra|\.\.\/index|\.\.\/workspace|\.\.\/ui)/
      );
    }
  });

  it('filters capability output and writes contract-governed artifacts atomically', async () => {
    const workspace = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-capability-'));
    tempDirs.push(workspace);
    await fsExtra.writeFile(path.join(workspace, '.workspai-workspace'), 'name=test\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = await runDoctorCapabilities({
      runtime: 'node',
      validate: true,
      write: true,
      workspace,
      json: true,
    });

    expect(exitCode).toBe(0);
    const capabilitiesPath = path.join(
      workspace,
      '.workspai',
      'reports',
      'doctor-capabilities.json'
    );
    const validationPath = path.join(
      workspace,
      '.workspai',
      'reports',
      'doctor-validation-last-run.json'
    );
    expect(await fsExtra.pathExists(capabilitiesPath)).toBe(true);
    expect(await fsExtra.pathExists(validationPath)).toBe(true);
    expect((await fsExtra.readJSON(capabilitiesPath)).adapters).toHaveLength(17);
    expect((await fsExtra.readJSON(validationPath)).summary.failedCases).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it('reports an honest error when artifact writing has no workspace', async () => {
    const cwd = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-no-workspace-'));
    tempDirs.push(cwd);
    const previous = process.cwd();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      process.chdir(cwd);
      expect(await runDoctorCapabilities({ write: true, json: true })).toBe(1);
      const payload = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(payload.error.code).toBe('doctor.capabilities.workspace-not-found');
    } finally {
      process.chdir(previous);
    }
  });

  it('reports the complete unfiltered public capability matrix', () => {
    const report = buildDoctorCapabilitiesReport();
    expect(report.policy).toEqual({
      unknownIsHealthy: false,
      unsupportedIsHealthy: false,
      repairRequiresTypedOperation: true,
      canonicalDomains: [...DOCTOR_DIAGNOSTIC_DOMAINS],
    });
    expect(report.summary.adapterCount).toBe(17);
    expect(report.summary.firstClassRuntimes).toBe(7);
    expect(report.summary.extendedRuntimes).toBe(9);
    expect(report.summary.fallbackRuntimes).toBe(1);
  });
});
