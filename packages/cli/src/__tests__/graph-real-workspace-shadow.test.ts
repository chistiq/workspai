import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runGraphRealWorkspaceShadowQualificationCli } from '../../scripts/graph-real-workspace-shadow-qualification.js';
import {
  GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION,
  GRAPH_REAL_WORKSPACE_APPROVALS_V1_SCHEMA_VERSION,
  GRAPH_REAL_WORKSPACE_PRIMARY_DIFFERENCE_CODES,
} from '../contracts/graph-real-workspace-shadow-contract.js';
import {
  assertSafePortableRelativePath,
  createGraphG8RealWorkspacePlatformReport,
  createGraphRealWorkspaceResourceBudgetDigest,
  digestRealWorkspaceSourceTree,
  GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS,
  assertExactGraphShadowMappingBinding,
  loadGraphRealWorkspaceInventory,
  normalizeComparablePath,
  parseGraphRealWorkspaceApprovals,
  pathsUseRejectedWindowsOrMacSpellings,
  resolveGraphRealWorkspaceLimits,
  runGraphRealWorkspaceQualification,
  workspaceContainsCanonicalGraphWrites,
} from '../graph-real-workspace-shadow.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  GRAPH_SHADOW_MAPPING_VERSION,
  createGraphShadowBoundedSetDigest,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  createGraphShadowResourceBudgetDigest,
  type LegacyGraphShadowInput,
  type PackageGraphShadowInput,
} from '../graph-shadow-parity.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const fixtureRoot = path.join(
  repositoryRoot,
  'packages/cli/test-data/graph-shadow/real-workspace-fixture.v1'
);
const corpusRoot = path.join(
  repositoryRoot,
  'packages/cli/test-data/graph-shadow/real-workspace-corpus.v1'
);
const roots: string[] = [];
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
});

function scopedLegacy() {
  return {
    schemaVersion: 'workspace-knowledge-graph.v1',
    generatedAt: '2026-09-12T00:00:00.000Z',
    source: { hash: digest('legacy'), inputs: { scopes: [] } },
    entities: [
      {
        id: 'legacy:fixture',
        kind: 'project',
        projectId: 'real-workspace-fixture',
        identity: { key: 'project:real-workspace-fixture' },
        proofIds: [],
      },
    ],
    relations: [],
    proofs: [],
    providers: [],
    quality: { unknownCount: 0, completeness: { status: 'bounded' } },
    diagnostics: [],
  };
}

function matchingLegacy(relationKind = 'owns'): LegacyGraphShadowInput {
  return {
    schemaVersion: 'workspace-knowledge-graph.v1',
    entities: [
      { id: 'legacy:project', kind: 'project', identity: { key: 'project:app' }, proofIds: [] },
      { id: 'legacy:test', kind: 'test-suite', identity: { key: 'test:app' }, proofIds: ['p1'] },
    ],
    relations: [
      {
        id: 'legacy:owns',
        from: 'legacy:project',
        to: 'legacy:test',
        kind: relationKind,
        proofIds: ['p1'],
      },
    ],
    proofs: [{ id: 'p1', artifact: 'src/app.ts' }],
    quality: { unknownCount: 0, completeness: { status: 'complete' } },
    diagnostics: [],
  };
}

function matchingPackage(relation = 'owned-by'): PackageGraphShadowInput {
  const value = 'a'.repeat(64);
  return {
    graph: {
      contract: { id: 'workspai.graph.canonical-graph', version: '0.1.0-candidate' },
      generation: {
        inputsDigest: { algorithm: 'sha256', value },
        providerSetDigest: { algorithm: 'sha256', value },
        compositionPolicyDigest: { algorithm: 'sha256', value },
      },
      nodes: [
        { id: 'project:app', kind: 'project' },
        { id: 'test:app', kind: 'test' },
      ],
      edges: [
        {
          id: 'edge:owned-by',
          from: 'project:app',
          to: 'test:app',
          relation,
          proof: { evidence: [{ relativeLocator: 'src/app.ts' }] },
        },
      ],
      unresolved: [],
      diagnostics: [],
    },
    quality: { unknownZones: [], unsupportedZones: [], coverage: [] },
    evidenceLocators: ['src/app.ts'],
  };
}

const exactPolicy = {
  mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
  approvedDifferences: {},
} as const;

async function boundNodeSetApprovals() {
  const fixture = await digestRealWorkspaceSourceTree(
    fixtureRoot,
    GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS
  );
  const corpus = await digestRealWorkspaceSourceTree(
    corpusRoot,
    GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS
  );
  const setDigest = createGraphShadowBoundedSetDigest(['module:deeper\0module']);
  return [
    {
      corpusId: 'committed-fixture',
      sourceTreeDigest: fixture.digest,
      mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
      code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
      key: 'module',
      setDigest,
      classification: 'intentional-contract-change' as const,
      reason: 'Bound package-only module identity for the committed fixture corpus only.',
    },
    {
      corpusId: 'committed-node-service',
      sourceTreeDigest: corpus.digest,
      mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
      code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
      key: 'module',
      setDigest,
      classification: 'intentional-contract-change' as const,
      reason: 'Bound package-only module identity for the committed Node service corpus.',
    },
  ];
}

describe('Graph real-workspace shadow qualification', () => {
  it('loads an explicit host workspaceId that is not the corpus id', async () => {
    const { inventory } = await loadGraphRealWorkspaceInventory(
      repositoryRoot,
      GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS.maxControlBytes
    );
    expect(
      inventory.required.map((entry) => ({
        id: entry.id,
        projectId: entry.projectId,
        workspaceId: entry.workspaceId,
      }))
    ).toEqual([
      {
        id: 'committed-fixture',
        projectId: 'real-workspace-fixture',
        workspaceId: 'real-workspace-fixture',
      },
      {
        id: 'committed-node-service',
        projectId: 'node-catalog-service',
        workspaceId: 'node-catalog-service',
      },
    ]);
    expect(inventory.required.every((entry) => entry.workspaceId !== entry.id)).toBe(true);
    expect(
      inventory.optionalLocalReferences.every((entry) => typeof entry.workspaceId === 'string')
    ).toBe(true);
  });

  it('qualifies committed corpora without mutating source trees or using cwd authority', async () => {
    const fixtureBefore = await readFile(path.join(fixtureRoot, 'src/index.ts'), 'utf8');
    const corpusBefore = await readFile(path.join(corpusRoot, 'src/index.ts'), 'utf8');
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
    });

    expect(result.observations.map((item) => item.id).sort()).toEqual([
      'committed-fixture',
      'committed-node-service',
    ]);
    expect(result.mutatedCanonicalArtifacts).toBe(false);
    expect(result.usedProcessCwdAsAuthority).toBe(false);
    expect(result.receipt).toMatchObject({
      authority: 'released-cli',
      packageWrites: 'prohibited',
      fallback: 'prohibited',
    });
    expect(await readFile(path.join(fixtureRoot, 'src/index.ts'), 'utf8')).toBe(fixtureBefore);
    expect(await readFile(path.join(corpusRoot, 'src/index.ts'), 'utf8')).toBe(corpusBefore);
    expect(await workspaceContainsCanonicalGraphWrites(fixtureRoot)).toBe(false);
    expect(await workspaceContainsCanonicalGraphWrites(corpusRoot)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fixtureRoot);
    expect(JSON.stringify(result)).not.toContain(corpusRoot);
    expect(JSON.stringify(result)).not.toMatch(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u);
    expect([0]).toContain(exitCode);
    const corpus = result.observations.find((item) => item.id === 'committed-node-service');
    expect(corpus?.workspaceId).toBe('node-catalog-service');
    expect(corpus?.workspaceId).not.toBe(corpus?.id);
    expect(corpus?.packageExecution).toMatchObject({
      status: 'complete',
      workspaceId: 'node-catalog-service',
    });
    expect(corpus?.comparison?.status).toBe('equivalent');
    expect(corpus?.comparison?.regressions).toBe(0);
    expect(corpus?.comparison?.differenceCodes).toEqual([]);
    expect(
      result.observations.every(
        (item) => item.status === 'compared' && item.comparison?.status === 'equivalent'
      )
    ).toBe(true);
  });

  it('records exact semantic equivalence for identical mapped graphs', async () => {
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      legacyBuilder: async () => matchingLegacy(),
      packageBuilder: async () => matchingPackage(),
    });
    expect(result.observations).toHaveLength(2);
    expect(
      result.observations.every(
        (item) => item.status === 'compared' && item.comparison?.status === 'equivalent'
      )
    ).toBe(true);
    expect(result.receipt.comparison.status).toBe('equivalent');
    expect(result.mutatedCanonicalArtifacts).toBe(false);
    expect(result.usedProcessCwdAsAuthority).toBe(false);
    expect(exitCode).toBe(0);
  });

  it('blocks a semantic regression when node and relation counts stay equal', async () => {
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      legacyBuilder: async () => matchingLegacy('owns'),
      packageBuilder: async () => matchingPackage('depends-on'),
    });
    const compared = result.observations.find((item) => item.id === 'committed-node-service');
    expect(compared?.status).toBe('failed');
    expect(compared?.reason).toBe('unapproved-semantic-difference');
    expect(compared?.comparison).toMatchObject({
      status: 'different',
      regressions: 2,
      approvedDifferences: 0,
    });
    expect(result.receipt.fallback).toBe('prohibited');
    expect(exitCode).toBe(4);
  });

  it('keeps bound approved differences incomparable and does not treat them as equivalent', async () => {
    const extra = matchingPackage();
    extra.graph = {
      ...extra.graph,
      nodes: [...extra.graph.nodes, { id: 'module:deeper', kind: 'module' }],
    };
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      approvals: await boundNodeSetApprovals(),
      legacyBuilder: async () => matchingLegacy(),
      packageBuilder: async () => extra,
    });
    const compared = result.observations.find((item) => item.id === 'committed-fixture');
    expect(compared?.status).toBe('compared');
    expect(compared?.comparison).toMatchObject({
      status: 'incomparable',
      regressions: 0,
      approvedDifferences: 1,
    });
    expect(compared?.comparison?.status).not.toBe('equivalent');
    expect(result.receipt.authority).toBe('released-cli');
    expect(exitCode).toBe(2);
  });

  it('rejects unbound policy approvals and blanket semantic-difference approvals', async () => {
    await expect(
      runGraphRealWorkspaceQualification({
        repositoryRoot,
        mode: 'regression',
        policy: {
          mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
          approvedDifferences: {
            GRAPH_SHADOW_NODE_PACKAGE_ONLY: 'intentional-contract-change',
          },
        },
        legacyBuilder: async () => matchingLegacy(),
        packageBuilder: async () => matchingPackage(),
      })
    ).rejects.toThrow(/unbound approved differences/);

    const tree = await digestRealWorkspaceSourceTree(
      fixtureRoot,
      GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS
    );
    await expect(
      runGraphRealWorkspaceQualification({
        repositoryRoot,
        mode: 'regression',
        policy: exactPolicy,
        approvals: GRAPH_REAL_WORKSPACE_PRIMARY_DIFFERENCE_CODES.map((code) => ({
          corpusId: 'committed-fixture',
          sourceTreeDigest: tree.digest,
          mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
          code,
          key: 'blanket',
          setDigest: `sha256:${'a'.repeat(64)}`,
          classification: 'intentional-contract-change' as const,
          reason: 'Blanket approval of every primary semantic difference class.',
        })),
        legacyBuilder: async () => matchingLegacy(),
        packageBuilder: async () => matchingPackage(),
      })
    ).rejects.toThrow(/Blanket semantic-difference approval/);
  });

  it('measures canonical writes on the copied execution tree', async () => {
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      legacyBuilder: async ({ projectRoot }) => {
        await mkdir(path.join(projectRoot, '.workspai'));
        await writeFile(path.join(projectRoot, '.workspai/graph.json'), '{}\n');
        await writeFile(path.join(projectRoot, 'graph-generation.json'), '{}\n');
        return matchingLegacy();
      },
      packageBuilder: async () => matchingPackage(),
    });
    expect(result.mutatedCanonicalArtifacts).toBe(true);
    expect(await workspaceContainsCanonicalGraphWrites(fixtureRoot)).toBe(false);
    expect(await workspaceContainsCanonicalGraphWrites(corpusRoot)).toBe(false);
    expect(result.receipt.packageWrites).toBe('prohibited');
    expect(exitCode).toBe(4);
  });

  it('measures process.chdir as cwd authority and restores the original working directory', async () => {
    const previous = process.cwd();
    try {
      const { result, exitCode } = await runGraphRealWorkspaceQualification({
        repositoryRoot,
        mode: 'regression',
        policy: exactPolicy,
        legacyBuilder: async ({ projectRoot }) => {
          process.chdir(projectRoot);
          return matchingLegacy();
        },
        packageBuilder: async () => matchingPackage(),
      });
      expect(result.usedProcessCwdAsAuthority).toBe(true);
      expect(result.mutatedCanonicalArtifacts).toBe(false);
      expect(exitCode).toBe(4);
      expect(process.cwd()).toBe(previous);
    } finally {
      process.chdir(previous);
    }
  });

  it('treats process.cwd consultation as project authority even without chdir', async () => {
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      legacyBuilder: async () => {
        process.cwd();
        return matchingLegacy();
      },
      packageBuilder: async () => matchingPackage(),
    });
    expect(result.usedProcessCwdAsAuthority).toBe(true);
    expect(exitCode).toBe(4);
  });

  it('validates qualification limits and uses them for copy and comparison', async () => {
    expect(() => resolveGraphRealWorkspaceLimits({ timeoutMs: 0 })).toThrow(/positive integer/);
    expect(() => resolveGraphRealWorkspaceLimits({ maxCopyDepth: 25 })).toThrow(/contract bounds/);
    const { result, exitCode } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      limits: { maxNodes: 1 },
      legacyBuilder: async () => matchingLegacy(),
      packageBuilder: async () => matchingPackage(),
    });
    expect(result.observations.some((item) => item.status === 'failed')).toBe(true);
    expect(exitCode).toBe(4);
  });

  it('records unavailable local references without treating them as cross-platform evidence', async () => {
    const { result } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'local-observation',
      legacyBuilder: async () => scopedLegacy(),
    });
    const references = result.observations.filter((item) => item.kind === 'local-reference');
    expect(references.length).toBe(3);
    expect(references.map((item) => item.id).sort()).toEqual([
      'grpc',
      'opentelemetry-demo',
      'pnpm',
    ]);
    expect(references.every((item) => item.status === 'unavailable-local-observation')).toBe(true);
    expect(JSON.stringify(references)).not.toContain('/Reference/');
    expect(result.receipt.comparison.status).not.toBe('equivalent');
  });

  it('rejects absolute, parent-traversal and Windows path spellings', () => {
    expect(() => assertSafePortableRelativePath('/tmp/graph', 'path')).toThrow(/portable/);
    expect(() => assertSafePortableRelativePath('../secret', 'path')).toThrow(/portable/);
    expect(() => assertSafePortableRelativePath('C:\\Users\\graph', 'path')).toThrow(/portable/);
    expect(pathsUseRejectedWindowsOrMacSpellings('C:\\Users\\graph')).toBe(true);
    expect(pathsUseRejectedWindowsOrMacSpellings('/Users/research/graph')).toBe(true);
    expect(pathsUseRejectedWindowsOrMacSpellings('/private/var/folders/zz/graph')).toBe(true);
    expect(pathsUseRejectedWindowsOrMacSpellings('/var/folders/zz/graph')).toBe(true);
    expect(normalizeComparablePath('src\\index.ts')).toBe('src/index.ts');
    expect(normalizeComparablePath('packages\\cli\\src\\index.ts')).toBe(
      'packages/cli/src/index.ts'
    );
    expect(createGraphRealWorkspaceResourceBudgetDigest).toBeTypeOf('function');
    expect(createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS)).toMatch(
      /^sha256:[a-f0-9]{64}$/u
    );
    expect(createGraphShadowProjectScopeDigest('real-workspace-fixture')).toMatch(
      /^sha256:[a-f0-9]{64}$/u
    );
    expect(createGraphShadowReadOnlyAuthorizationDigest()).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects symlink substitution at the workspace boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-g8-symlink-'));
    roots.push(root);
    const actual = path.join(root, 'actual');
    const linked = path.join(root, 'linked');
    await mkdir(actual);
    await symlink(actual, linked, 'dir');
    await expect(
      runGraphRealWorkspaceQualification({
        repositoryRoot: linked,
        mode: 'regression',
      })
    ).rejects.toThrow('repository root must be a real directory.');
  });

  it('does not treat process.cwd as implicit project authority', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-g8-cwd-'));
    roots.push(root);
    await expect(
      runGraphRealWorkspaceQualification({
        repositoryRoot: root,
        mode: 'regression',
      })
    ).rejects.toThrow();
  });

  it('fails closed on timeout, cancellation and partial package execution', async () => {
    const cancelled = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      signal: AbortSignal.abort(),
      legacyBuilder: async () => scopedLegacy(),
    });
    expect(cancelled.result.observations.some((item) => item.status === 'failed')).toBe(true);
    expect(cancelled.exitCode).toBe(4);

    const timedOut = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      limits: { timeoutMs: 250 },
      testUninterruptibleHang: true,
    });
    expect(timedOut.exitCode).toBe(4);
    expect(
      timedOut.result.observations.some(
        (item) =>
          item.status === 'failed' && (item.reason === 'timeout' || item.reason === 'cancelled')
      )
    ).toBe(true);

    const partial = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      policy: exactPolicy,
      legacyBuilder: async () => matchingLegacy(),
      packageBuilder: async () => undefined,
    });
    expect(partial.result.observations[0]).toMatchObject({
      status: 'failed',
      reason: 'partial-package-execution',
      packageExecution: { status: 'partial' },
    });
    expect(partial.result.receipt.fallback).toBe('prohibited');
    expect(partial.exitCode).toBe(4);

    const redacted = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      mode: 'regression',
      legacyBuilder: async () => {
        throw new Error('package engine unavailable');
      },
    });
    expect(JSON.stringify(redacted.result)).not.toContain('package engine unavailable');
    expect(redacted.result.receipt.fallback).toBe('prohibited');
    expect(redacted.exitCode).toBe(4);
  });

  it('does not overwrite existing evidence and keeps CLI default independent from cwd', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-g8-output-'));
    roots.push(root);
    const output = path.join(root, 'result.json');
    await writeFile(output, 'preserved\n');
    await expect(
      runGraphRealWorkspaceShadowQualificationCli([
        '--mode',
        'regression',
        '--repository-root',
        repositoryRoot,
        '--output',
        output,
      ])
    ).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('preserved\n');
  });

  it('copies bounded local references and never treats them as cross-platform evidence', async () => {
    const referenceRoot = await mkdtemp(path.join(os.tmpdir(), 'workspai-g8-ref-'));
    roots.push(referenceRoot);
    for (const name of ['grpc', 'opentelemetry-demo']) {
      const project = path.join(referenceRoot, name);
      await mkdir(project);
      await writeFile(path.join(project, 'README.md'), `# ${name}\n`);
    }
    const before = await readFile(path.join(referenceRoot, 'grpc/README.md'), 'utf8');
    const { result } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      referenceRoot,
      mode: 'local-observation',
      policy: exactPolicy,
      legacyBuilder: async () => matchingLegacy(),
      packageBuilder: async () => matchingPackage(),
    });
    const references = result.observations.filter((item) => item.kind === 'local-reference');
    expect(references.map((item) => item.id).sort()).toEqual([
      'grpc',
      'opentelemetry-demo',
      'pnpm',
    ]);
    expect(
      references
        .filter((item) => item.status === 'compared')
        .map((item) => item.id)
        .sort()
    ).toEqual(['grpc', 'opentelemetry-demo']);
    expect(references.find((item) => item.id === 'pnpm')).toMatchObject({
      status: 'unavailable-local-observation',
      reason: 'reference-unavailable',
    });
    expect(result.receipt.authority).toBe('released-cli');
    expect(result.receipt.packageWrites).toBe('prohibited');
    expect(await readFile(path.join(referenceRoot, 'grpc/README.md'), 'utf8')).toBe(before);
    expect(await workspaceContainsCanonicalGraphWrites(path.join(referenceRoot, 'grpc'))).toBe(
      false
    );
    expect(JSON.stringify(result)).not.toContain(referenceRoot);
  });

  it('records an oversized local reference as unavailable instead of mutating it', async () => {
    const referenceRoot = await mkdtemp(path.join(os.tmpdir(), 'workspai-g8-huge-'));
    roots.push(referenceRoot);
    const grpc = path.join(referenceRoot, 'grpc');
    await mkdir(grpc);
    await writeFile(path.join(grpc, 'huge.bin'), 'x'.repeat(65 * 1024));
    await mkdir(path.join(referenceRoot, 'opentelemetry-demo'));
    await writeFile(path.join(referenceRoot, 'opentelemetry-demo/README.md'), '# demo\n');
    const { result } = await runGraphRealWorkspaceQualification({
      repositoryRoot,
      referenceRoot,
      mode: 'local-observation',
      policy: exactPolicy,
      limits: { maxCopiedFileBytes: 64 * 1024 },
      legacyBuilder: async () => matchingLegacy(),
      packageBuilder: async () => matchingPackage(),
    });
    expect(result.observations.find((item) => item.id === 'grpc')).toMatchObject({
      status: 'unavailable-local-observation',
      reason: 'reference-exceeded-copy-budget',
      copyBudget: expect.objectContaining({
        truncated: true,
        observedFiles: 1,
        maxCopiedFileBytes: 64 * 1024,
      }),
    });
    expect(JSON.stringify(result.receipt)).not.toContain('cross-platform');
  });

  it('keeps real-workspace isolation as a repository TypeScript harness', async () => {
    const harness = await readFile(
      path.join(packageRoot, 'src/graph-real-workspace-shadow.ts'),
      'utf8'
    );
    const worker = await readFile(
      path.join(packageRoot, 'src/graph-real-workspace-shadow-worker.ts'),
      'utf8'
    );
    const bundleConfig = await readFile(path.join(packageRoot, 'tsup.config.ts'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      files?: string[];
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const runtimeDependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    };

    expect(harness).toContain('./graph-real-workspace-shadow-worker.ts');
    expect(harness).toContain('isolationExecArgv()');
    expect(harness).toContain("createRequire(import.meta.url).resolve('tsx')");
    expect(harness).toContain('async function removeTemporaryRoot');
    expect(harness).toContain('maxRetries: 10');
    expect(worker).toContain('Repository and CI source execution only');
    expect(bundleConfig).not.toMatch(/graph-real-workspace-shadow-worker/);
    expect(manifest.files ?? []).not.toContain('src');
    expect(runtimeDependencies).not.toHaveProperty('tsx');
  });

  it('refuses to mint cross-platform platform reports outside GitHub Actions', async () => {
    const previous = process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_ACTIONS;
    try {
      await expect(
        createGraphG8RealWorkspacePlatformReport({
          repositoryRoot,
          mode: 'platform-report',
        })
      ).rejects.toThrow('Cross-platform evidence requires GitHub Actions.');
    } finally {
      if (previous === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = previous;
    }
  });

  it('migrates empty v1 approvals and refuses to reinterpret v1 records', () => {
    expect(
      parseGraphRealWorkspaceApprovals({
        schemaVersion: GRAPH_REAL_WORKSPACE_APPROVALS_V1_SCHEMA_VERSION,
        mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        records: [],
      })
    ).toEqual({
      schemaVersion: GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION,
      mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
      records: [],
    });
    expect(() =>
      parseGraphRealWorkspaceApprovals({
        schemaVersion: GRAPH_REAL_WORKSPACE_APPROVALS_V1_SCHEMA_VERSION,
        mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        records: [
          {
            corpusId: 'committed-fixture',
            sourceTreeDigest: `sha256:${'a'.repeat(64)}`,
            mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
            code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
            key: 'module',
            setDigest: `sha256:${'b'.repeat(64)}`,
            classification: 'truth-depth-improvement',
            reason: 'A v1 record must not be silently reinterpreted as a v2 approval.',
          },
        ],
      })
    ).toThrow(/migrate to workspai.graph-real-workspace-approvals.v2/);
  });

  it('keeps the historical v1 ledger on mapping v1 and binds active ledgers to mapping v2', async () => {
    const historical = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          'packages/cli/test-data/graph-shadow/real-workspace-approvals.v1.json'
        ),
        'utf8'
      )
    ) as { schemaVersion: string; mappingVersion: string };
    const active = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          'packages/cli/test-data/graph-shadow/real-workspace-approvals.v2.json'
        ),
        'utf8'
      )
    ) as { schemaVersion: string; mappingVersion: string };
    expect(historical).toMatchObject({
      schemaVersion: GRAPH_REAL_WORKSPACE_APPROVALS_V1_SCHEMA_VERSION,
      mappingVersion: 'workspai.graph-shadow-mapping.v1',
    });
    expect(active).toMatchObject({
      schemaVersion: GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION,
      mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
    });
    expect(() =>
      assertExactGraphShadowMappingBinding({
        inventoryMappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        policyMappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        approvalsLedgerMappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
      })
    ).not.toThrow();
    expect(() =>
      assertExactGraphShadowMappingBinding({
        inventoryMappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        policyMappingVersion: 'workspai.graph-shadow-mapping.v1',
        approvalsLedgerMappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
      })
    ).toThrow(/must be identical/);
  });

  it('stops before graph execution when a mappingVersion ledger diverges', async () => {
    const legacyExecution = vi.fn(async () => matchingLegacy());
    const packageExecution = vi.fn(async () => matchingPackage());
    await expect(
      runGraphRealWorkspaceQualification({
        repositoryRoot,
        mode: 'regression',
        policy: {
          mappingVersion: 'workspai.graph-shadow-mapping.v1',
          approvedDifferences: {},
        },
        legacyBuilder: legacyExecution,
        packageBuilder: packageExecution,
      })
    ).rejects.toThrow(/must be identical/);
    expect(legacyExecution).not.toHaveBeenCalled();
    expect(packageExecution).not.toHaveBeenCalled();
  });

  it('rejects approval records whose mappingVersion diverges from the active ledger', async () => {
    const tree = await digestRealWorkspaceSourceTree(
      fixtureRoot,
      GRAPH_REAL_WORKSPACE_DEFAULT_LIMITS
    );
    const legacyExecution = vi.fn(async () => matchingLegacy());
    await expect(
      runGraphRealWorkspaceQualification({
        repositoryRoot,
        mode: 'regression',
        policy: exactPolicy,
        approvals: [
          {
            corpusId: 'committed-fixture',
            sourceTreeDigest: tree.digest,
            mappingVersion: 'workspai.graph-shadow-mapping.v1',
            code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
            key: 'module',
            setDigest: `sha256:${'a'.repeat(64)}`,
            classification: 'intentional-contract-change',
            reason: 'A record mappingVersion must match the active comparison mapping.',
          },
        ],
        legacyBuilder: legacyExecution,
        packageBuilder: async () => matchingPackage(),
      })
    ).rejects.toThrow(/must be identical/);
    expect(legacyExecution).not.toHaveBeenCalled();
    expect(() =>
      parseGraphRealWorkspaceApprovals({
        schemaVersion: GRAPH_REAL_WORKSPACE_APPROVALS_SCHEMA_VERSION,
        mappingVersion: GRAPH_SHADOW_MAPPING_VERSION,
        records: [
          {
            corpusId: 'committed-fixture',
            sourceTreeDigest: `sha256:${'a'.repeat(64)}`,
            mappingVersion: 'workspai.graph-shadow-mapping.v1',
            code: 'GRAPH_SHADOW_NODE_PACKAGE_ONLY',
            key: 'module',
            setDigest: `sha256:${'b'.repeat(64)}`,
            classification: 'truth-depth-improvement',
            reason: 'A record mappingVersion must match the ledger mappingVersion exactly.',
          },
        ],
      })
    ).toThrow(/not bound to the ledger mappingVersion/);
  });
});
