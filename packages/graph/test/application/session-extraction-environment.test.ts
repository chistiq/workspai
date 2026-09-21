import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildNodeRepoGraph,
  createGraphProductBuildSession,
  runWithOwnedGraphProductBuildSession,
} from '../../src/adapters/node/index.js';
import { GRAPH_STANDARD_REPO_BUILD_POLICY } from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type {
  GraphOntologyProfile,
  GraphProviderRuntime,
  GraphScope,
} from '../../src/contracts/index.js';
import type {
  GraphRepoBuildPolicy,
  GraphRepoBuildResult,
} from '../../src/application/repo-build-types.js';
import {
  PACKAGE_JSON_PROVIDER_ID,
  createPackageJsonProvider,
  createStandardRepositoryProviders,
} from '../../src/providers/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function writeRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-env-'));
  temporary.push(root);
  for (const [locator, contents] of Object.entries(files)) {
    const target = path.join(root, locator);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  }
  return root;
}

const FILES = {
  'package.json': '{"name":"extraction-env","private":true}\n',
  'src/app.ts': 'export function health(): string { return "ok"; }\n',
};

function projectIdsFrom(result: GraphRepoBuildResult): string[] {
  const ids = new Set<string>();
  for (const source of result.compositionSources ?? []) {
    if (source.batch.scope.kind === 'project') {
      for (const id of source.batch.scope.projectIds) ids.add(id);
    }
    for (const fact of source.batch.facts) {
      if (fact.scope.kind === 'project') {
        for (const id of fact.scope.projectIds) ids.add(id);
      }
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function digestOf(result: GraphRepoBuildResult): string | undefined {
  return result.graph?.generation.reference.contentDigest.value;
}

async function independentOracle(
  request: Parameters<typeof buildNodeRepoGraph>[0]
): Promise<GraphRepoBuildResult> {
  const session = createGraphProductBuildSession();
  try {
    return await buildNodeRepoGraph({ ...request, session });
  } finally {
    session.dispose();
  }
}

function packageJsonProvider(patch: {
  readonly version?: string;
  readonly permissions?: Partial<GraphProviderRuntime['manifest']['permissions']>;
  readonly limits?: Partial<GraphProviderRuntime['manifest']['limits']>;
}): GraphProviderRuntime {
  const base = createPackageJsonProvider();
  return {
    ...base,
    manifest: {
      ...base.manifest,
      version: patch.version ?? base.manifest.version,
      permissions: { ...base.manifest.permissions, ...patch.permissions },
      limits: { ...base.manifest.limits, ...patch.limits },
    },
  };
}

function providersReplacingPackageJson(replacement: GraphProviderRuntime): GraphProviderRuntime[] {
  return createStandardRepositoryProviders().map((provider) =>
    provider.manifest.id === PACKAGE_JSON_PROVIDER_ID ? replacement : provider
  );
}

describe('session extraction-environment reuse vs independent oracle', () => {
  it('does not reuse project:a facts when the same session later requests project:b', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const scopeA: GraphScope = { kind: 'project', projectIds: ['project:a'] };
    const scopeB: GraphScope = { kind: 'project', projectIds: ['project:b'] };
    const a = await buildNodeRepoGraph({ root, session, scope: scopeA });
    const b = await buildNodeRepoGraph({ root, session, scope: scopeB });
    const oracle = await independentOracle({ root, scope: scopeB });
    expect(a.status).toMatch(/complete|partial/);
    expect(b.status).toBe(oracle.status);
    expect(b.status).toMatch(/complete|partial/);
    expect(projectIdsFrom(a)).toEqual(['project:a']);
    expect(projectIdsFrom(b)).toEqual(['project:b']);
    expect(projectIdsFrom(b)).not.toContain('project:a');
    expect(digestOf(b)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('does not reuse workspace identity across different project ids in one session', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({
      root,
      session,
      scope: { kind: 'project', workspaceId: 'workspace:a', projectIds: ['project:one'] },
    });
    const second = await buildNodeRepoGraph({
      root,
      session,
      scope: { kind: 'project', workspaceId: 'workspace:b', projectIds: ['project:one'] },
    });
    const oracle = await independentOracle({
      root,
      scope: { kind: 'project', workspaceId: 'workspace:b', projectIds: ['project:one'] },
    });
    expect(digestOf(second)).toBe(digestOf(oracle));
    expect(digestOf(second)).not.toBe(digestOf(first));
    session.dispose();
  });

  it('does not reuse network-allow facts after the current request denies network', async () => {
    const root = await writeRepo(FILES);
    const networked = providersReplacingPackageJson(
      packageJsonProvider({ permissions: { network: 'allow' } })
    );
    const allowPolicy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      network: 'allow',
    };
    const denyPolicy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      network: 'deny',
    };
    const session = createGraphProductBuildSession();
    const allowed = await buildNodeRepoGraph({
      root,
      session,
      providers: networked,
      policy: allowPolicy,
    });
    const denied = await buildNodeRepoGraph({
      root,
      session,
      providers: networked,
      policy: denyPolicy,
    });
    const oracle = await independentOracle({
      root,
      providers: networked,
      policy: denyPolicy,
    });
    expect(allowed.providers.some((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)).toBe(
      true
    );
    expect(
      denied.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)?.detection
    ).toBe('blocked');
    expect(digestOf(denied)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('does not reuse network-deny results after the current request allows network', async () => {
    const root = await writeRepo(FILES);
    const networked = providersReplacingPackageJson(
      packageJsonProvider({ permissions: { network: 'allow' } })
    );
    const allowPolicy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      network: 'allow',
    };
    const denyPolicy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      network: 'deny',
    };
    const session = createGraphProductBuildSession();
    const denied = await buildNodeRepoGraph({
      root,
      session,
      providers: networked,
      policy: denyPolicy,
    });
    const allowed = await buildNodeRepoGraph({
      root,
      session,
      providers: networked,
      policy: allowPolicy,
    });
    const oracle = await independentOracle({
      root,
      providers: networked,
      policy: allowPolicy,
    });
    expect(
      denied.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)?.detection
    ).toBe('blocked');
    expect(
      allowed.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)?.detection
    ).not.toBe('blocked');
    expect(digestOf(allowed)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('invalidates reuse when provider permissions change with the same id and version', async () => {
    const root = await writeRepo(FILES);
    const allowedProcess = providersReplacingPackageJson(
      packageJsonProvider({ permissions: { process: 'allow' } })
    );
    const deniedProcess = providersReplacingPackageJson(
      packageJsonProvider({ permissions: { process: 'deny' } })
    );
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session, providers: deniedProcess });
    const second = await buildNodeRepoGraph({ root, session, providers: allowedProcess });
    const oracle = await independentOracle({ root, providers: allowedProcess });
    expect(first.status).toMatch(/complete|partial/);
    expect(
      second.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)?.detection
    ).toBe('blocked');
    expect(digestOf(second)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('invalidates reuse when provider limits change with the same id and version', async () => {
    const root = await writeRepo(FILES);
    const wide = providersReplacingPackageJson(packageJsonProvider({}));
    const tight = providersReplacingPackageJson(packageJsonProvider({ limits: { maxFacts: 1 } }));
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session, providers: wide });
    const second = await buildNodeRepoGraph({ root, session, providers: tight });
    const oracle = await independentOracle({ root, providers: tight });
    expect(first.status).toMatch(/complete|partial/);
    expect(digestOf(second)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('invalidates reuse when composition policy changes', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const policy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      composition: {
        ...GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
        inferredClaims: 'accept-with-evidence',
      },
    };
    const second = await buildNodeRepoGraph({ root, session, policy });
    const oracle = await independentOracle({ root, policy });
    expect(digestOf(second)).toBe(digestOf(oracle));
    expect(second.graph?.generation.compositionPolicyDigest.value).not.toBe(
      first.graph?.generation.compositionPolicyDigest.value
    );
    session.dispose();
  });

  it('invalidates reuse when the redaction profile changes', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const policy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      redactionProfile: 'strict-test-profile',
    };
    const second = await buildNodeRepoGraph({ root, session, policy });
    const oracle = await independentOracle({ root, policy });
    expect(digestOf(second)).toBe(digestOf(oracle));
    expect(first.compositionSources?.[0]?.batch.redaction.policy).not.toBe('strict-test-profile');
    session.dispose();
  });

  it('invalidates reuse when ontology identity changes', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const ontology: GraphOntologyProfile = {
      ...CORE_GRAPH_ONTOLOGY_PROFILE,
      id: 'workspai.graph.ontology.session-env-shifted',
    };
    const second = await buildNodeRepoGraph({ root, session, ontology });
    const oracle = await independentOracle({ root, ontology });
    expect(digestOf(second)).toBe(digestOf(oracle));
    expect(second.graph?.generation.ontologySetDigest.value).not.toBe(
      first.graph?.generation.ontologySetDigest.value
    );
    session.dispose();
  });

  it('invalidates reuse when the extractor/provider version changes', async () => {
    const root = await writeRepo(FILES);
    const current = providersReplacingPackageJson(packageJsonProvider({}));
    const shifted = providersReplacingPackageJson(
      packageJsonProvider({ version: '0.1.0-shifted' })
    );
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session, providers: current });
    const second = await buildNodeRepoGraph({ root, session, providers: shifted });
    const oracle = await independentOracle({ root, providers: shifted });
    expect(digestOf(second)).toBe(digestOf(oracle));
    expect(first.providers.some((entry) => entry.provider.version === '0.1.0-candidate')).toBe(
      true
    );
    expect(second.providers.some((entry) => entry.provider.version === '0.1.0-shifted')).toBe(true);
    session.dispose();
  });

  it('cancels a second build without returning the first graph', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const controller = new AbortController();
    controller.abort();
    const second = await buildNodeRepoGraph({ root, session, signal: controller.signal });
    expect(first.graph).toBeDefined();
    expect(second.status).toBe('cancelled');
    expect(second.graph).toBeUndefined();
    session.dispose();
  });

  it('does not let a failed first build poison a later valid build', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const failing = createStandardRepositoryProviders().map((provider) =>
      provider.manifest.id === PACKAGE_JSON_PROVIDER_ID
        ? {
            ...provider,
            collect: async () => {
              throw new Error('first collect failed');
            },
          }
        : provider
    );
    const failed = await buildNodeRepoGraph({ root, session, providers: failing });
    const valid = await buildNodeRepoGraph({ root, session });
    const oracle = await independentOracle({ root });
    expect(failed.status === 'failed' || failed.status === 'partial').toBe(true);
    expect(digestOf(valid)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('does not return a prior complete graph when the second build fails', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const policy: GraphRepoBuildPolicy = {
      ...GRAPH_STANDARD_REPO_BUILD_POLICY,
      composition: { ...GRAPH_STANDARD_REPO_BUILD_POLICY.composition, maxFacts: 0 },
    };
    const second = await buildNodeRepoGraph({ root, session, policy });
    const oracle = await independentOracle({ root, policy });
    expect(first.graph).toBeDefined();
    expect(second.status === 'failed' || second.status === 'partial').toBe(true);
    expect(digestOf(second)).toBe(digestOf(oracle));
    expect(second.graph).toBeUndefined();
    session.dispose();
  });

  it('isolates two repositories with identical relative paths and bytes but different ownership', async () => {
    const files = {
      'package.json': '{"name":"shared-bytes","private":true}\n',
      'src/app.ts': 'export const shared = 1;\n',
    };
    const left = await writeRepo(files);
    const right = await writeRepo(files);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({
      root: left,
      session,
      scope: { kind: 'project', projectIds: ['owner:left'] },
    });
    const second = await buildNodeRepoGraph({
      root: right,
      session,
      scope: { kind: 'project', projectIds: ['owner:right'] },
    });
    const oracle = await independentOracle({
      root: right,
      scope: { kind: 'project', projectIds: ['owner:right'] },
    });
    expect(projectIdsFrom(first)).toEqual(['owner:left']);
    expect(projectIdsFrom(second)).toEqual(['owner:right']);
    expect(digestOf(second)).toBe(digestOf(oracle));
    session.dispose();
  });

  it('isolates concurrent sessions building the same tree', async () => {
    const root = await writeRepo(FILES);
    const left = createGraphProductBuildSession();
    const right = createGraphProductBuildSession();
    const [a, b] = await Promise.all([
      buildNodeRepoGraph({
        root,
        session: left,
        scope: { kind: 'project', projectIds: ['concurrent:a'] },
      }),
      buildNodeRepoGraph({
        root,
        session: right,
        scope: { kind: 'project', projectIds: ['concurrent:b'] },
      }),
    ]);
    expect(projectIdsFrom(a)).toEqual(['concurrent:a']);
    expect(projectIdsFrom(b)).toEqual(['concurrent:b']);
    left.dispose();
    right.dispose();
  });

  it('isolates a nested owned session from its caller-owned parent', async () => {
    const outerRoot = await writeRepo(FILES);
    const innerRoot = await writeRepo({
      'package.json': '{"name":"nested-inner","private":true}\n',
      'src/inner.ts': 'export const inner = 1;\n',
    });
    const parent = createGraphProductBuildSession();
    const nested = await runWithOwnedGraphProductBuildSession(parent, async (session) => {
      const outer = await buildNodeRepoGraph({
        root: outerRoot,
        session,
        scope: { kind: 'project', projectIds: ['nested:outer'] },
      });
      const inner = await buildNodeRepoGraph({
        root: innerRoot,
        scope: { kind: 'project', projectIds: ['nested:inner'] },
      });
      return { outer, inner };
    });
    expect(projectIdsFrom(nested.outer)).toEqual(['nested:outer']);
    expect(projectIdsFrom(nested.inner)).toEqual(['nested:inner']);
    expect(nested.outer.admittedInputs?.some((item) => item.locator === 'src/inner.ts')).toBe(
      false
    );
    parent.dispose();
  });

  it('records memory by stage and estimated retained bytes from real cache owners', async () => {
    const root = await writeRepo(FILES);
    const session = createGraphProductBuildSession();
    const built = await buildNodeRepoGraph({ root, session });
    expect(built.metrics.memory?.at).toBe('end');
    expect(built.metrics.memoryStages?.map((stage) => stage.at)).toEqual(
      expect.arrayContaining(['start', 'afterInventory', 'afterProviders', 'end'])
    );
    expect(built.metrics.peakObservedRssBytes).toBeGreaterThan(0);
    expect(built.metrics.processLifetimePeakRssBytes).toBeGreaterThan(0);
    expect(built.metrics.dataMovement?.retainedBytes.hashedContent).toBeGreaterThan(0);
    const facts = built.compositionSources?.flatMap((source) => source.batch.facts) ?? [];
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => Object.isFrozen(fact))).toBe(true);
    session.dispose();
  });
});
