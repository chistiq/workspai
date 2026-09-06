import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assessAgentFrameworkAdmission } from '../agent-frameworks/conformance.js';
import { detectAgentFramework } from '../agent-frameworks/detection.js';
import {
  loadAgentFrameworkConformanceReport,
  loadAgentFrameworkManifest,
  MAX_AGENT_FRAMEWORK_MANIFEST_BYTES,
} from '../agent-frameworks/manifest-loader.js';
import { AgentFrameworkRegistry } from '../agent-frameworks/registry.js';
import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
  AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS,
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_CAPABILITY_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';

const tempRoots: string[] = [];
const digest = 'a'.repeat(64);

async function tempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function manifest(input: {
  adapterId: string;
  frameworkId: string;
  runtimes: string[];
  markers: AgentFrameworkAdapterManifest['detection']['authoredMarkers'];
  minimumAuthoredMarkers?: number;
  minimumConfidence?: number;
}): AgentFrameworkAdapterManifest {
  const operationModes = {
    detect: 'read-only',
    'plan-scaffold': 'plan-only',
    'plan-attach': 'plan-only',
    'render-managed-files': 'render-only',
    'project-context': 'resolve-only',
    validate: 'read-only',
    'resolve-runtime': 'resolve-only',
  } as const;
  return {
    schemaVersion: AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    adapter: {
      id: input.adapterId,
      package: `@workspai/${input.adapterId}`,
      version: '1.0.0',
      stability: 'stable',
    },
    framework: {
      id: input.frameworkId,
      name: input.frameworkId,
      homepage: `https://example.com/${input.frameworkId}`,
      license: 'Apache-2.0',
      upstreamStatus: 'stable',
      supportedVersionRange: '>=1 <2',
      testedVersions: ['1.0.0'],
    },
    implementation: {
      languages: input.runtimes,
      runtimes: input.runtimes,
      platforms: ['linux'],
      executionBoundary: 'subprocess',
      distribution: 'optional-package',
    },
    operations: Object.fromEntries(
      AGENT_FRAMEWORK_ADAPTER_OPERATION_IDS.map((id) => [
        id,
        { supported: true, mode: operationModes[id], limitations: [] },
      ])
    ) as AgentFrameworkAdapterManifest['operations'],
    capabilities: Object.fromEntries(
      AGENT_FRAMEWORK_CAPABILITY_IDS.map((id) => [
        id,
        {
          support: 'native',
          evidence: [`evidence/${id}.json`],
          prerequisites: [],
          limitations: [],
        },
      ])
    ) as AgentFrameworkAdapterManifest['capabilities'],
    detection: {
      authoredMarkers: input.markers,
      generatedMarkers: [
        {
          id: 'generated-receipt',
          kind: 'path',
          path: `.workspai/adapters/${input.adapterId}.json`,
          weight: 0.1,
        },
      ],
      minimumAuthoredMarkers: input.minimumAuthoredMarkers ?? 1,
      minimumConfidence: input.minimumConfidence ?? 0.5,
    },
    ownership: {
      canonicalTruth: 'workspai',
      runtimeState: 'framework',
      sessionState: 'framework',
      mutationAdmission: 'workspai-pcc',
      verificationOwner: 'workspai-cli',
      managedWritePolicy: 'owned-files-or-managed-sections',
      conflictPolicy: 'preserve-user-content',
      managedRoots: [`.workspai/adapters/${input.adapterId}`],
    },
    security: {
      secrets: 'references-only',
      network: 'deny-unless-explicitly-granted',
      generatedCodeExecution: 'disabled-unless-explicitly-granted',
      toolMutation: 'approval-required',
      untrustedInput: 'isolated',
      telemetrySensitiveData: 'redacted',
    },
    bindings: {
      contextInputs: ['.workspai/reports/workspace-context-agent.json'],
      evidenceInputs: ['.workspai/reports/INDEX.json'],
      mutationGateway: 'proof-carrying-change',
      verificationGateway: 'workspace-verify',
      projectionPolicy: 'references-and-bounded-projections-only',
    },
  };
}

function reportFor(
  adapterManifest: AgentFrameworkAdapterManifest,
  overrides: Partial<AgentFrameworkConformanceReport> = {}
): AgentFrameworkConformanceReport {
  const checks = AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.map((id) => ({
    id,
    status: 'passed' as const,
    required: true,
    summary: `${id} passed`,
    evidencePaths: [`evidence/${id}.json`],
    durationMs: 1,
  }));
  return {
    schemaVersion: AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    generatedAt: '2026-09-05T00:00:00.000Z',
    adapter: {
      id: adapterManifest.adapter.id,
      version: adapterManifest.adapter.version,
      manifestSha256: digest,
    },
    frameworkVersion: '1.0.0',
    cliVersion: '0.74.0',
    environment: {
      platform: 'linux',
      architecture: 'x64',
      runtime: adapterManifest.implementation.runtimes[0],
      runtimeVersion: '1.0.0',
    },
    checks,
    summary: { passed: checks.length, failed: 0, skipped: 0, required: checks.length },
    verdict: 'admitted',
    blockers: [],
    limitations: [],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe('agent framework detection and registry', () => {
  it('does not expose an adapter by id until its complete conformance matrix is admitted', () => {
    const fixtureManifest = manifest({
      adapterId: 'fixture',
      frameworkId: 'fixture',
      runtimes: ['node'],
      markers: [{ id: 'fixture-source', kind: 'path', path: 'agent.ts', weight: 1 }],
    });
    const registry = new AgentFrameworkRegistry().register({
      manifest: fixtureManifest,
      manifestSha256: digest,
      source: 'builtin',
      conformanceReports: [],
    });

    expect(registry.resolveAdapter('missing')).toEqual({
      status: 'unresolved',
      entry: null,
      blockers: [],
    });
    expect(registry.resolveAdapter('fixture')).toMatchObject({
      status: 'blocked',
      entry: { manifest: { adapter: { id: 'fixture' } } },
      blockers: expect.arrayContaining(['missing admitted lane: linux/node/1.0.0']),
    });
  });

  it('detects filesystem-first npm frameworks from authored evidence', async () => {
    const root = await tempRoot('workspai-agent-eve-');
    await fs.mkdir(path.join(root, 'agent'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { eve: '^0.52.1' } })
    );
    await fs.writeFile(path.join(root, 'agent', 'instructions.md'), '# Agent\n');
    const eve = manifest({
      adapterId: 'eve-node',
      frameworkId: 'eve',
      runtimes: ['node'],
      markers: [
        {
          id: 'eve-package',
          kind: 'dependency',
          ecosystem: 'npm',
          name: 'eve',
          match: 'exact',
          manifestPaths: ['package.json'],
          manifestSuffixes: [],
          searchDepth: 0,
          weight: 0.7,
        },
        {
          id: 'eve-instructions',
          kind: 'path',
          path: 'agent/instructions.md',
          weight: 0.3,
        },
      ],
      minimumAuthoredMarkers: 2,
      minimumConfidence: 1,
    });

    await expect(detectAgentFramework(root, eve)).resolves.toMatchObject({
      detected: true,
      confidence: 1,
      matchedAuthoredMarkers: 2,
    });
  });

  it('detects one multi-language framework through PyPI and NuGet manifests', async () => {
    const pythonRoot = await tempRoot('workspai-agent-maf-python-');
    await fs.writeFile(
      path.join(pythonRoot, 'pyproject.toml'),
      '[project]\ndependencies = ["agent-framework-openai>=1.17.0"]\n'
    );
    const dotnetRoot = await tempRoot('workspai-agent-maf-dotnet-');
    await fs.mkdir(path.join(dotnetRoot, 'src', 'Agent'), { recursive: true });
    await fs.writeFile(
      path.join(dotnetRoot, 'src', 'Agent', 'Agent.csproj'),
      '<Project><ItemGroup><PackageReference Include="Microsoft.Agents.AI" Version="1.0.0" /></ItemGroup></Project>'
    );
    const maf = manifest({
      adapterId: 'microsoft-agent-framework',
      frameworkId: 'microsoft-agent-framework',
      runtimes: ['python', 'dotnet'],
      markers: [
        {
          id: 'maf-python',
          kind: 'dependency',
          ecosystem: 'pypi',
          name: 'agent-framework',
          match: 'prefix',
          manifestPaths: ['pyproject.toml', 'requirements.txt'],
          manifestSuffixes: [],
          searchDepth: 0,
          weight: 0.5,
        },
        {
          id: 'maf-dotnet',
          kind: 'dependency',
          ecosystem: 'nuget',
          name: 'Microsoft.Agents.AI',
          match: 'prefix',
          manifestPaths: [],
          manifestSuffixes: ['.csproj'],
          searchDepth: 4,
          weight: 0.5,
        },
      ],
    });

    await expect(detectAgentFramework(pythonRoot, maf)).resolves.toMatchObject({
      detected: true,
      confidence: 0.5,
    });
    await expect(detectAgentFramework(dotnetRoot, maf)).resolves.toMatchObject({
      detected: true,
      confidence: 0.5,
    });
  });

  it('does not select an adapter from generated evidence alone', async () => {
    const root = await tempRoot('workspai-agent-generated-');
    await fs.mkdir(path.join(root, '.workspai', 'adapters'), { recursive: true });
    await fs.writeFile(path.join(root, '.workspai', 'adapters', 'fixture.json'), '{}');
    const adapter = manifest({
      adapterId: 'fixture',
      frameworkId: 'fixture',
      runtimes: ['node'],
      markers: [
        {
          id: 'fixture-package',
          kind: 'dependency',
          ecosystem: 'npm',
          name: 'fixture',
          match: 'exact',
          manifestPaths: ['package.json'],
          manifestSuffixes: [],
          searchDepth: 0,
          weight: 1,
        },
      ],
    });

    await expect(detectAgentFramework(root, adapter)).resolves.toMatchObject({
      detected: false,
      confidence: 0,
      matchedAuthoredMarkers: 0,
    });
  });

  it('requires a complete conformance matrix and exact manifest binding', () => {
    const adapter = manifest({
      adapterId: 'fixture',
      frameworkId: 'fixture',
      runtimes: ['node', 'python'],
      markers: [{ id: 'marker', kind: 'path', path: 'agent', weight: 1 }],
    });
    const nodeReport = reportFor(adapter);
    const incomplete = assessAgentFrameworkAdmission({
      manifest: adapter,
      manifestSha256: digest,
      reports: [nodeReport],
    });
    expect(incomplete.status).toBe('blocked');
    expect(incomplete.blockers).toContain('missing admitted lane: linux/python/1.0.0');

    const pythonReport = reportFor(adapter, {
      environment: { ...nodeReport.environment, runtime: 'python' },
    });
    expect(
      assessAgentFrameworkAdmission({
        manifest: adapter,
        manifestSha256: digest,
        reports: [nodeReport, pythonReport],
      }).status
    ).toBe('admitted');

    const wrongDigest = structuredClone(pythonReport);
    wrongDigest.adapter.manifestSha256 = 'b'.repeat(64);
    expect(
      assessAgentFrameworkAdmission({
        manifest: adapter,
        manifestSha256: digest,
        reports: [nodeReport, wrongDigest],
      }).blockers
    ).toContain('conformance linux/python/1.0.0: manifest digest does not match');

    const blockedReport = structuredClone(pythonReport);
    blockedReport.checks[0].status = 'failed';
    blockedReport.summary.passed -= 1;
    blockedReport.summary.failed += 1;
    blockedReport.verdict = 'blocked';
    blockedReport.blockers = ['manifest-schema: fixture failure'];
    expect(
      assessAgentFrameworkAdmission({
        manifest: adapter,
        manifestSha256: digest,
        reports: [nodeReport, blockedReport],
      }).blockers
    ).toContain('conformance linux/python/1.0.0: manifest-schema: fixture failure');
  });

  it('loads only bounded, contained, schema-valid manifests', async () => {
    const root = await tempRoot('workspai-agent-loader-');
    const adapter = manifest({
      adapterId: 'fixture',
      frameworkId: 'fixture',
      runtimes: ['node'],
      markers: [{ id: 'marker', kind: 'path', path: 'agent', weight: 1 }],
    });
    await fs.writeFile(path.join(root, 'adapter.json'), `${JSON.stringify(adapter)}\n`);
    await expect(loadAgentFrameworkManifest(root, 'adapter.json')).resolves.toMatchObject({
      manifest: { adapter: { id: 'fixture' } },
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await fs.writeFile(path.join(root, 'conformance.json'), JSON.stringify(reportFor(adapter)));
    await expect(
      loadAgentFrameworkConformanceReport(root, 'conformance.json')
    ).resolves.toMatchObject({ verdict: 'admitted', adapter: { id: 'fixture' } });
    const blockedReport = reportFor(adapter);
    blockedReport.checks[0].status = 'failed';
    blockedReport.summary.passed -= 1;
    blockedReport.summary.failed += 1;
    blockedReport.verdict = 'blocked';
    blockedReport.blockers = ['manifest-schema: fixture failure'];
    await fs.writeFile(path.join(root, 'blocked.json'), JSON.stringify(blockedReport));
    await expect(loadAgentFrameworkConformanceReport(root, 'blocked.json')).resolves.toMatchObject({
      verdict: 'blocked',
      blockers: ['manifest-schema: fixture failure'],
    });
    await expect(loadAgentFrameworkManifest(root, '../adapter.json')).rejects.toThrow(
      'escapes its authorized root'
    );

    await fs.writeFile(
      path.join(root, 'oversized.json'),
      Buffer.alloc(MAX_AGENT_FRAMEWORK_MANIFEST_BYTES + 1)
    );
    await expect(loadAgentFrameworkManifest(root, 'oversized.json')).rejects.toThrow(
      `exceeds ${MAX_AGENT_FRAMEWORK_MANIFEST_BYTES} bytes`
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects manifest and authored-marker symlinks that escape the authorized root',
    async () => {
      const root = await tempRoot('workspai-agent-symlink-root-');
      const outside = await tempRoot('workspai-agent-symlink-outside-');
      const adapter = manifest({
        adapterId: 'fixture',
        frameworkId: 'fixture',
        runtimes: ['node'],
        markers: [{ id: 'outside', kind: 'path', path: 'agent', weight: 1 }],
      });
      await fs.writeFile(path.join(outside, 'adapter.json'), `${JSON.stringify(adapter)}\n`);
      await fs.mkdir(path.join(outside, 'agent'));
      await fs.symlink(path.join(outside, 'adapter.json'), path.join(root, 'adapter.json'));
      await fs.symlink(path.join(outside, 'agent'), path.join(root, 'agent'));

      await expect(loadAgentFrameworkManifest(root, 'adapter.json')).rejects.toThrow(
        'resolves outside its authorized root'
      );
      await expect(detectAgentFramework(root, adapter)).resolves.toMatchObject({
        detected: false,
        matchedAuthoredMarkers: 0,
      });
    }
  );

  it('fails closed on ambiguous authored matches and blocked adapters', async () => {
    const root = await tempRoot('workspai-agent-registry-');
    await fs.mkdir(path.join(root, 'agent'));
    const first = manifest({
      adapterId: 'first',
      frameworkId: 'first',
      runtimes: ['node'],
      markers: [{ id: 'first-marker', kind: 'path', path: 'agent', weight: 1 }],
    });
    const second = manifest({
      adapterId: 'second',
      frameworkId: 'second',
      runtimes: ['node'],
      markers: [{ id: 'second-marker', kind: 'path', path: 'agent', weight: 1 }],
    });
    const registry = new AgentFrameworkRegistry()
      .register({
        manifest: first,
        manifestSha256: digest,
        source: 'package',
        conformanceReports: [reportFor(first)],
      })
      .register({
        manifest: second,
        manifestSha256: digest,
        source: 'package',
        conformanceReports: [reportFor(second)],
      });
    await expect(
      registry.resolveProject({ projectRoot: root, runtime: 'node' })
    ).resolves.toMatchObject({ status: 'conflict', entry: null });

    const blocked = new AgentFrameworkRegistry().register({
      manifest: first,
      manifestSha256: digest,
      source: 'package',
      conformanceReports: [],
    });
    await expect(
      blocked.resolveProject({ projectRoot: root, runtime: 'node' })
    ).resolves.toMatchObject({
      status: 'blocked',
      entry: { manifest: { adapter: { id: 'first' } } },
    });

    expect(() =>
      blocked.register({
        manifest: first,
        manifestSha256: digest,
        source: 'workspace',
        conformanceReports: [],
      })
    ).toThrow('adapter id is already registered');
  });

  it('rejects duplicate conformance lanes instead of choosing newer-looking evidence', () => {
    const adapter = manifest({
      adapterId: 'fixture',
      frameworkId: 'fixture',
      runtimes: ['node'],
      markers: [{ id: 'marker', kind: 'path', path: 'agent', weight: 1 }],
    });
    const report = reportFor(adapter);
    const result = assessAgentFrameworkAdmission({
      manifest: adapter,
      manifestSha256: digest,
      reports: [report, structuredClone(report)],
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toContain('duplicate conformance report for linux/node/1.0.0');
  });
});
