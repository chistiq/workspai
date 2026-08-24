import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { buildOperationalJsonSchemas } from '../../contracts/operational-json-schemas.js';

const schemas = buildOperationalJsonSchemas();
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value: string) => !Number.isNaN(Date.parse(value)),
});

function expectValid(schemaFile: string, payload: unknown): void {
  const validate = ajv.compile(schemas[schemaFile]);
  expect(validate(payload), JSON.stringify(validate.errors, null, 2)).toBe(true);
}

function expectInvalid(schemaFile: string, payload: unknown): void {
  const validate = ajv.compile(schemas[schemaFile]);
  expect(validate(payload)).toBe(false);
}

describe('operational JSON producer contracts', () => {
  it('accepts the workspace list and sync output envelopes emitted by the CLI', () => {
    expectValid('workspace-list.v1.json', {
      schemaVersion: 'rapidkit-workspace-list-v1',
      registryPath: '/home/user/.workspai/workspaces.json',
      workspaces: [{ name: 'team', path: '/work/team', mode: 'full', projects: [] }],
      summary: {
        total: 1,
        missing: 0,
        registryExists: true,
        registryValid: true,
        cleanupApplied: false,
      },
    });

    expectValid('workspace-sync.v1.json', {
      schemaVersion: 'rapidkit-workspace-sync-v1',
      workspacePath: '/work/team',
      registry: { workspacePath: '/work/team', workspaceFound: true, added: [], skipped: 1 },
      contractSynced: true,
      registrySummary: { schemaVersion: 'workspace-registry.v1', projectCount: 1 },
    });
  });

  it('accepts the archive and snapshot manifests written by lifecycle operations', () => {
    expectValid('project-archive.v1.json', {
      schema: 'rapidkit-project-archive-v1',
      projectName: 'api',
      originalPath: '/work/team/api',
      archivedPath: '/work/team/.workspai/archive/projects/api-1',
      reason: 'maintenance',
      archivedAt: '2026-07-13T00:00:00.000Z',
      safetySnapshotPath: '/work/team/.workspai/snapshots/pre-archive-api',
    });

    expectValid('workspace-snapshot.v1.json', {
      schema: 'rapidkit-workspace-snapshot-v1',
      name: 'before-upgrade',
      mode: 'metadata',
      reason: 'upgrade',
      createdAt: '2026-07-13T00:00:00.000Z',
      workspaceName: 'team',
      workspacePath: '/work/team',
      copiedPaths: ['.workspai/workspace.json'],
      projects: [{ name: 'api', relativePath: 'api' }],
    });

    expectValid('workspace-snapshot.v2.json', {
      schema: 'rapidkit-workspace-snapshot-v2',
      name: 'pre-delete-api',
      mode: 'project',
      reason: 'recoverable delete',
      createdAt: '2026-07-13T00:00:00.000Z',
      workspaceName: 'team',
      workspacePath: '/work/team',
      copiedPaths: ['services/api'],
      projects: [{ name: 'api', relativePath: 'services/api' }],
      recoveryScope: { kind: 'project', projectName: 'api', relativePath: 'services/api' },
    });
    expectInvalid('workspace-snapshot.v2.json', {
      schema: 'rapidkit-workspace-snapshot-v2',
      name: 'bad',
      mode: 'project',
    });
  });

  it('enforces nested autopilot release semantics instead of accepting arbitrary objects', () => {
    const payload = {
      schemaVersion: 'autopilot-release-v1',
      generatedAt: '2026-07-13T00:00:00.000Z',
      workspacePath: '/work/team',
      mode: 'audit',
      summary: {
        releaseScore: 100,
        verdict: 'approved',
        blockers: 0,
        warnings: 0,
        safeFixesApplied: 0,
        manualActions: 0,
        exitCode: 0,
      },
      stages: [{ name: 'doctor-workspace', status: 'pass', durationMs: 10, summary: 'healthy' }],
      blockingReasons: [],
      warningReasons: [],
      nextActions: [],
      artifacts: { reportPath: '/work/team/.workspai/reports/autopilot-release-last-run.json' },
    };
    expectValid('autopilot-release.v1.json', payload);
    expectInvalid('autopilot-release.v1.json', {
      ...payload,
      summary: { verdict: 'approved' },
    });
  });

  it('requires a complete model-cache envelope', () => {
    expectValid('workspace-model-cache.v1.json', {
      schemaVersion: 'workspace-model-cache.v1',
      producerRevision: 'workspace-model-producer.v3',
      cliVersion: '0.44.0',
      inputsHash: 'a'.repeat(64),
      generatedAt: '2026-07-13T00:00:00.000Z',
      model: { schemaVersion: 'workspace-model.v1' },
      projectSignatures: { api: 'b'.repeat(64) },
    });
    expectInvalid('workspace-model-cache.v1.json', {
      schemaVersion: 'workspace-model-cache.v1',
    });
  });

  it('requires doctor workspace cache projects to carry runtime scan identity', () => {
    expectValid('doctor-workspace-cache.v2.json', {
      schemaVersion: 'doctor-workspace-cache-v2',
      signature: 'doctor-project-scan-v2||workspace',
      generatedAt: '2026-07-13T00:00:00.000Z',
      projects: [
        {
          name: 'api',
          path: '/work/team/api',
          venvActive: true,
          depsInstalled: true,
          coreInstalled: true,
          issues: [],
          fixCommands: [],
          runtimeFamily: 'python',
          projectKind: 'service',
          probes: [],
        },
      ],
    });
    expectInvalid('doctor-workspace-cache.v2.json', {
      schemaVersion: 'doctor-workspace-cache-v2',
      signature: 'doctor-project-scan-v2||workspace',
      generatedAt: '2026-07-13T00:00:00.000Z',
      projects: [{}],
    });
  });

  it.each([
    ['compatibility-matrix.v1.json', 'rapidkit.compatibility-matrix.v1'],
    ['infra-plan.v1.json', 'rapidkit.infra-plan.v1'],
    ['private-product-manifest.v1.json', 'rapidkit.private-product-manifest.v1'],
    ['product-factory-plan.v1.json', 'rapidkit.product-factory-plan.v1'],
    ['workspace-watch-event.v1.json', 'workspace-watch-event.v1'],
    ['doctor-project-scan.v2.json', 'doctor-project-scan-v2'],
    ['doctor-workspace-cache.v2.json', 'doctor-workspace-cache-v2'],
  ] as const)('rejects version-only payloads for %s', (schemaFile, schemaVersion) => {
    expectInvalid(schemaFile, { schemaVersion });
  });
});
