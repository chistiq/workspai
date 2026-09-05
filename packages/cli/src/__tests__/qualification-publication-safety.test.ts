import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  assertQualificationReportIsPublicationSafe,
  canonicalQualificationWorkspaceName,
  createQualificationCommandRecord,
  hasGovernedQualificationOutcome,
  isQualificationCommandAccepted,
  qualificationCommandAllowsGovernedBlock,
  qualificationPrimaryRuntime,
  repairAdaptersForQualificationBoundary,
  selectQualificationLifecycleProjectId,
  selectQualificationProjectId,
  resolveQualificationProjectPath,
  summarizeQualificationCoverage,
  qualificationLeafCommandPaths,
  qualificationCommandTargets,
  qualificationInvocationCoversPath,
} from '../../scripts/qualification-publication-safety.mjs';

describe('qualification report publication safety', () => {
  it('resolves a relative project against the workspace instead of the caller directory', () => {
    const workspacePath = path.resolve('isolated-workspace');
    const expected = path.join(workspacePath, 'services', 'api');
    expect(
      resolveQualificationProjectPath({
        workspacePath,
        workspaceContract: { projects: [{ relativePath: 'services/api' }] },
        pathExists: (candidate) => candidate === path.join(expected, '.workspai/project.json'),
      })
    ).toBe(expected);
  });

  it('does not claim verified coverage for missing, failed, or governed-blocked checks', () => {
    expect(summarizeQualificationCoverage([])).toBe('not-run');
    expect(summarizeQualificationCoverage([{ accepted: false }])).toBe('failed');
    expect(
      summarizeQualificationCoverage([{ accepted: true, acceptanceClass: 'governed-block' }])
    ).toBe('governed-block');
    expect(summarizeQualificationCoverage([{ accepted: true, acceptanceClass: 'succeeded' }])).toBe(
      'verified'
    );
  });

  it('derives leaf commands and distinguishes functional execution from parent coverage', () => {
    const paths = qualificationLeafCommandPaths({
      commands: [
        { path: ['change'], hidden: false },
        { path: ['change', 'begin'], hidden: false },
        { path: ['change', 'list'], hidden: false },
        { path: ['hidden'], hidden: true },
      ],
    });
    expect(paths).toEqual([
      ['change', 'begin'],
      ['change', 'list'],
    ]);
    expect(qualificationInvocationCoversPath(['change', 'begin', '--json'], paths[0])).toBe(true);
    expect(qualificationInvocationCoversPath(['change', 'list'], paths[0])).toBe(false);
  });

  it('expands workspace, delegated Core, and runtime-adapter surfaces into auditable targets', () => {
    const targets = qualificationCommandTargets({
      runtimeInventory: {
        commands: [
          { path: ['workspace'], hidden: false },
          { path: ['doctor'], hidden: false },
        ],
      },
      workspace: { subcommands: ['model', 'graph'] },
      commands: { coreBacked: ['modules'], projectScoped: ['build'] },
    });
    expect(targets).toEqual(
      expect.arrayContaining([
        { path: ['doctor'], owner: 'npm-wrapper', scope: 'command' },
        { path: ['workspace', 'model'], owner: 'npm-wrapper', scope: 'workspace' },
        { path: ['modules'], owner: 'python-core', scope: 'core' },
        { path: ['build'], owner: 'runtime-adapter', scope: 'project' },
      ])
    );
  });
  it('accepts non-zero exits only for explicit commands with governed outcomes', () => {
    expect(qualificationCommandAllowsGovernedBlock(['doctor', 'workspace', '--json'])).toBe(true);
    expect(qualificationCommandAllowsGovernedBlock(['doctor', 'project', '--json'])).toBe(true);
    expect(
      qualificationCommandAllowsGovernedBlock([
        'workspace',
        'intelligence',
        'run',
        '--strict',
        '--json',
      ])
    ).toBe(true);
    expect(qualificationCommandAllowsGovernedBlock(['workspace', 'verify', '--json'])).toBe(true);
    expect(qualificationCommandAllowsGovernedBlock(['pipeline', '--json'])).toBe(true);
    expect(
      qualificationCommandAllowsGovernedBlock(['workspace', 'graph', 'explain', 'missing'])
    ).toBe(false);
    expect(hasGovernedQualificationOutcome({ summary: { verdict: 'blocked' } })).toBe(true);
    expect(hasGovernedQualificationOutcome({ status: 'failed', error: 'missing project' })).toBe(
      false
    );
  });

  it('selects a real project dynamically instead of assuming a fixture name', () => {
    expect(
      selectQualificationProjectId({
        graph: null,
        contract: { projects: [{ slug: 'orders-api' }] },
        model: null,
        importedRegistry: null,
      })
    ).toBe('orders-api');
  });

  it('selects only a workspace-owned project for destructive lifecycle dry-runs', () => {
    expect(
      selectQualificationLifecycleProjectId({
        workspacePath: '/qualification/workspace',
        contract: {
          projects: [
            {
              slug: 'linked-sdk',
              relativePath: 'external/linked-sdk',
              externalPath: '/references/linked-sdk',
            },
            { slug: 'managed-api', relativePath: 'services/managed-api' },
          ],
        },
        model: null,
        importedRegistry: null,
        pathExists: () => true,
      })
    ).toBe('managed-api');
    expect(
      selectQualificationLifecycleProjectId({
        workspacePath: '/qualification/workspace',
        contract: {
          projects: [
            {
              slug: 'linked-sdk',
              relativePath: 'external/linked-sdk',
              externalPath: '/references/linked-sdk',
            },
          ],
        },
        model: { projects: [{ name: 'linked-sdk', path: '../references/linked-sdk' }] },
        importedRegistry: { projects: [{ name: 'linked-sdk', path: '/references/linked-sdk' }] },
        pathExists: () => true,
      })
    ).toBeNull();
  });

  it('does not select a stale managed project for lifecycle qualification', () => {
    expect(
      selectQualificationLifecycleProjectId({
        workspacePath: '/qualification/workspace',
        contract: { projects: [{ slug: 'stale-api', relativePath: 'services/stale-api' }] },
        model: null,
        importedRegistry: null,
        pathExists: () => false,
      })
    ).toBeNull();
  });

  it('does not promote an aggregate runtime candidate to its authoritative runtime', () => {
    expect(
      qualificationPrimaryRuntime({ runtime: 'unknown', runtimeCandidates: ['dotnet', 'python'] })
    ).toBeNull();
    expect(qualificationPrimaryRuntime({ runtime: 'python', runtimeCandidates: ['python'] })).toBe(
      'python'
    );
  });

  it('requires a repair adapter manifest instead of inferring one from runtime alone', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workspai-qualification-repair-boundary-'));
    try {
      writeFileSync(path.join(root, 'library.gemspec'), 'Gem::Specification.new {}\n');
      expect(repairAdaptersForQualificationBoundary('ruby', root)).toEqual([]);
      writeFileSync(path.join(root, 'Library.slnx'), '<Solution />\n');
      expect(repairAdaptersForQualificationBoundary('dotnet', root)).toEqual(['dotnet']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['next.js', /^next-js-[a-f0-9]{10}$/],
    ['OpenSearch', /^opensearch-[a-f0-9]{10}$/],
    ['Apache Arrow / C++', /^apache-arrow-c-[a-f0-9]{10}$/],
    ['test', /^workspace-test-[a-f0-9]{10}$/],
    ['valid-workspace', /^valid-workspace$/],
  ])('maps repository identifier %s to a canonical workspace name', (source, expected) => {
    expect(canonicalQualificationWorkspaceName(source)).toMatch(expected);
  });

  it('retains bounded process metadata without command output or local paths', () => {
    const record = createQualificationCommandRecord({
      id: 'command-001',
      result: {
        status: 0,
        stdout: '{"schemaVersion":"example.v1","path":"/home/alice/private"}',
        stderr: 'token=secret',
      },
      parsed: { schemaVersion: 'example.v1' },
      startedAt: Date.now(),
    });

    expect(record).toMatchObject({
      id: 'command-001',
      exitCode: 0,
      schemaVersion: 'example.v1',
      stdoutBytes: 59,
      stderrBytes: 12,
    });
    expect(JSON.stringify(record)).not.toContain('/home/alice');
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(() => assertQualificationReportIsPublicationSafe(record)).not.toThrow();
  });

  it.each([
    { workspacePath: '/home/alice/workspace' },
    { note: 'stored at /Users/alice/workspace' },
    { note: String.raw`stored at C:\Users\Alice\workspace` },
    { note: String.raw`stored at \\server\share\workspace` },
    { note: 'file:///home/alice/workspace' },
    { stdoutExcerpt: 'otherwise harmless' },
  ])('fails closed for local or raw report data: %j', (unsafe) => {
    expect(() => assertQualificationReportIsPublicationSafe(unsafe)).toThrow();
  });

  it('rejects caller-provided roots even when they use an uncommon mount point', () => {
    expect(() =>
      assertQualificationReportIsPublicationSafe(
        { note: '/mnt/company-secret/repository/result.json' },
        ['/mnt/company-secret/repository']
      )
    ).toThrow('forbidden local path');
  });

  it('accepts a completed child status when a restricted runner also reports non-fatal EPERM', () => {
    expect(
      isQualificationCommandAccepted({
        result: {
          status: 0,
          error: Object.assign(new Error('restricted runner'), { code: 'EPERM' }),
        },
        acceptedExitCodes: [0],
        parsed: null,
        expectJson: false,
      })
    ).toBe(true);
  });

  it('rejects spawn and timeout failures without a completed child status', () => {
    expect(
      isQualificationCommandAccepted({
        result: { status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) },
        acceptedExitCodes: [0],
        parsed: {},
      })
    ).toBe(false);
  });

  it('rejects unexpected process errors even when a child status is present', () => {
    expect(
      isQualificationCommandAccepted({
        result: {
          status: 0,
          error: Object.assign(new Error('buffer failure'), { code: 'ENOBUFS' }),
        },
        acceptedExitCodes: [0],
        parsed: {},
      })
    ).toBe(false);
  });
});
