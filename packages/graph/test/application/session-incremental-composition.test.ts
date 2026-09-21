import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildNodeIncrementalRepoGraph,
  buildNodeRepoGraph,
  createGraphProductBuildSession,
} from '../../src/adapters/node/index.js';
import {
  isGraphFactAdmitted,
  markGraphFactAdmitted,
} from '../../src/domain/admitted-graph-facts.js';
import { snapshotAdmittedGraphCompositionSource } from '../../src/application/compose-graph.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type { GraphRepoBuildResult } from '../../src/application/index.js';
import type { GraphWorkspaceFact } from '../../src/contracts/index.js';
import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
} from '../../src/contracts/index.js';
import type { GraphCompositionSource } from '../../src/application/composition-types.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function writeRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-incr-'));
  temporary.push(root);
  for (const [locator, contents] of Object.entries(files)) {
    const target = path.join(root, locator);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  }
  return root;
}

function moduleFiles(count: number): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': '{"name":"session-incremental-composition","private":true}\n',
  };
  for (let index = 0; index < count; index += 1) {
    files[`src/mod-${String(index).padStart(2, '0')}.ts`] =
      `export function value${index}(): number { return ${index}; }\n`;
  }
  return files;
}

function fixtureFact(id: string, locator: string): GraphWorkspaceFact {
  return {
    factId: id,
    factType: 'source.file',
    subject: {
      id: `entity:workspai:file:${locator}`,
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope: { kind: 'project', projectIds: ['p'] },
    },
    predicate: 'contains',
    object: {
      id: `entity:workspai:file:${locator}:obj`,
      identityScheme: GRAPH_IDENTITY_SCHEME,
      kind: 'file',
      scope: { kind: 'project', projectIds: ['p'] },
    },
    scope: { kind: 'project', projectIds: ['p'] },
    evidence: [
      {
        id: `evidence:${id}`,
        sourceKind: 'source-file',
        relativeLocator: locator,
        digest: { algorithm: 'sha256', value: 'a'.repeat(64) },
      },
    ],
    provenance: { id: 'workspai.graph.provider.fixture', version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 1,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change'] },
    observedAt: '2026-09-21T00:00:00.000Z',
    inputDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
    unknownZones: [],
  };
}

function fixtureSource(facts: readonly GraphWorkspaceFact[]): GraphCompositionSource {
  return {
    manifest: {
      contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
      id: 'workspai.graph.provider.fixture',
      version: '1',
      displayName: 'fixture',
      determinism: 'deterministic',
      capabilities: {
        entityKinds: ['file'],
        relationKinds: ['contains'],
        relationSemantics: ['structural'],
        factFamilies: ['source.file'],
        allowedClaims: ['observed'],
      },
      permissions: {
        filesystem: 'read',
        network: 'deny',
        process: 'deny',
        credentials: 'deny',
      },
      limits: { maxDurationMs: 1_000, maxFacts: 10, maxInputBytes: 1_024 },
      contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
      supportedInputs: ['fixture'],
      incremental: 'input',
      identitySchemes: [GRAPH_IDENTITY_SCHEME],
    },
    batch: {
      contract: GRAPH_FACT_BATCH_CONTRACT,
      provider: { id: 'workspai.graph.provider.fixture', version: '1' },
      batchId: 'batch:fixture',
      scope: { kind: 'project', projectIds: ['p'] },
      inputs: [{ locator: 'a.ts', digest: { algorithm: 'sha256', value: 'a'.repeat(64) } }],
      facts: [...facts],
      diagnostics: [],
      coverage: [],
      unknownZones: [],
      unsupportedZones: [],
      redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
      status: 'complete',
      processing: [
        {
          input: { locator: 'a.ts', digest: { algorithm: 'sha256', value: 'a'.repeat(64) } },
          provider: { id: 'workspai.graph.provider.fixture', version: '1' },
          stage: { id: 'fixture', version: '1' },
          outcome: 'processed',
          outputDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
          diagnostics: [],
        },
      ],
    },
  };
}

function factIdsOf(result: GraphRepoBuildResult): readonly string[] {
  return (result.compositionSources ?? [])
    .flatMap((source) => source.batch.facts.map((fact) => fact.factId))
    .sort();
}

function expectIndependentOracleMatch(
  incremental: GraphRepoBuildResult,
  oracle: GraphRepoBuildResult
): void {
  expect(incremental.status).toBe(oracle.status);
  expect(incremental.graph?.generation.reference.contentDigest).toEqual(
    oracle.graph?.generation.reference.contentDigest
  );
  expect(incremental.graph?.nodes.map((node) => node.id)).toEqual(
    oracle.graph?.nodes.map((node) => node.id)
  );
  expect(incremental.graph?.edges.map((edge) => edge.id)).toEqual(
    oracle.graph?.edges.map((edge) => edge.id)
  );
  expect(incremental.graph?.assertions.map((assertion) => assertion.id)).toEqual(
    oracle.graph?.assertions.map((assertion) => assertion.id)
  );
  expect(factIdsOf(incremental)).toEqual(factIdsOf(oracle));
  expect(incremental.quality.unknownZones).toEqual(oracle.quality.unknownZones);
  expect(incremental.quality.unsupportedZones).toEqual(oracle.quality.unsupportedZones);
  expect(incremental.quality.graph?.integrity).toBe(oracle.quality.graph?.integrity);
  expect(
    incremental.providers.map((summary) => ({
      id: summary.provider.id,
      version: summary.provider.version,
      collection: summary.collection,
      factCount: summary.factCount,
    }))
  ).toEqual(
    oracle.providers.map((summary) => ({
      id: summary.provider.id,
      version: summary.provider.version,
      collection: summary.collection,
      factCount: summary.factCount,
    }))
  );
}

describe('session incremental composition', () => {
  it('aliases already admitted facts instead of cloning them in a mixed snapshot', () => {
    const admitted = fixtureFact('fact:admitted', 'a.ts');
    const fresh = fixtureFact('fact:fresh', 'b.ts');
    markGraphFactAdmitted(admitted);
    const snapshot = snapshotAdmittedGraphCompositionSource(fixtureSource([admitted, fresh]));
    expect(snapshot.batch.facts[0]).toBe(admitted);
    expect(snapshot.batch.facts[1]).not.toBe(fresh);
    expect(isGraphFactAdmitted(snapshot.batch.facts[1]!)).toBe(true);
  });

  it('reuses a no-change session build without rehashing the complete fact set', async () => {
    const root = await writeRepo(moduleFiles(12));
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    expect(first.graph).toBeDefined();
    const firstHashed = first.metrics.dataMovement?.ops.hashed ?? 0;
    const firstCanonicalized = first.metrics.dataMovement?.ops.canonicalized ?? 0;
    const warm = await buildNodeRepoGraph({ root, session });
    expect(warm.graph?.generation.reference.contentDigest.value).toBe(
      first.graph?.generation.reference.contentDigest.value
    );
    const warmHashed = warm.metrics.dataMovement?.ops.hashed ?? 0;
    const warmCanonicalized = warm.metrics.dataMovement?.ops.canonicalized ?? 0;
    expect(firstHashed).toBeGreaterThan(0);
    expect(warmHashed).toBeLessThan(firstHashed);
    expect(warmCanonicalized).toBeLessThanOrEqual(firstCanonicalized);
    session.dispose();
  });

  it('matches an independent current-tree oracle after edit, create, and delete', async () => {
    const files = moduleFiles(8);
    const root = await writeRepo(files);
    const session = createGraphProductBuildSession();
    const base = await buildNodeRepoGraph({ root, session });
    expect(base.graph).toBeDefined();

    await fs.writeFile(
      path.join(root, 'src/mod-00.ts'),
      'export function value0(): number { return 100; }\n',
      'utf8'
    );
    const edited = await buildNodeIncrementalRepoGraph({ root, session, base });
    const editedOracle = createGraphProductBuildSession();
    const editedIndependent = await buildNodeRepoGraph({ root, session: editedOracle });
    expect(edited.graph?.generation.reference.contentDigest.value).toBe(
      editedIndependent.graph?.generation.reference.contentDigest.value
    );
    editedOracle.dispose();

    await fs.writeFile(path.join(root, 'src/mod-new.ts'), 'export const created = 1;\n', 'utf8');
    const created = await buildNodeIncrementalRepoGraph({ root, session, base: edited });
    const createdOracle = createGraphProductBuildSession();
    const createdIndependent = await buildNodeRepoGraph({ root, session: createdOracle });
    expect(created.graph?.generation.reference.contentDigest.value).toBe(
      createdIndependent.graph?.generation.reference.contentDigest.value
    );
    createdOracle.dispose();

    await fs.rm(path.join(root, 'src/mod-new.ts'));
    const deleted = await buildNodeIncrementalRepoGraph({ root, session, base: created });
    const deletedOracle = createGraphProductBuildSession();
    const deletedIndependent = await buildNodeRepoGraph({ root, session: deletedOracle });
    expect(deleted.graph?.generation.reference.contentDigest.value).toBe(
      deletedIndependent.graph?.generation.reference.contentDigest.value
    );
    deletedOracle.dispose();
    session.dispose();
  });

  it('invalidates importer calls when a re-exported callee changes', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"reexport-invalidation","private":true}\n',
      'src/lib.ts': 'export function loadItem(): void {}\n',
      'src/barrel.ts': "export { loadItem } from './lib.js';\n",
      'src/app.ts':
        "import { loadItem } from './barrel.js';\nexport function run(): void { loadItem(); }\n",
    });
    const session = createGraphProductBuildSession();
    const base = await buildNodeRepoGraph({ root, session });
    expect(base.graph).toBeDefined();
    const baseCalls =
      base.compositionSources?.flatMap((source) =>
        source.batch.facts.filter(
          (fact) =>
            fact.factType === 'source.call' &&
            fact.extensions?.calleeName === 'loadItem' &&
            fact.evidence[0]?.relativeLocator === 'src/app.ts'
        )
      ) ?? [];
    expect(baseCalls.length).toBeGreaterThan(0);

    await fs.writeFile(path.join(root, 'src/lib.ts'), 'export function other(): void {}\n', 'utf8');
    const edited = await buildNodeIncrementalRepoGraph({ root, session, base });
    const oracleSession = createGraphProductBuildSession();
    const oracle = await buildNodeRepoGraph({ root, session: oracleSession });
    expect(edited.status).toBe('complete');
    expect(edited.graph?.generation.reference.contentDigest.value).toBe(
      oracle.graph?.generation.reference.contentDigest.value
    );
    const staleCalls =
      edited.compositionSources?.flatMap((source) =>
        source.batch.facts.filter(
          (fact) =>
            fact.factType === 'source.call' &&
            fact.extensions?.calleeName === 'loadItem' &&
            fact.evidence[0]?.relativeLocator === 'src/app.ts'
        )
      ) ?? [];
    expect(staleCalls).toEqual([]);
    oracleSession.dispose();
    session.dispose();
  });

  it('does not reuse a session graph when ontology identity changes', async () => {
    const root = await writeRepo(moduleFiles(4));
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const second = await buildNodeRepoGraph({
      root,
      session,
      ontology: { ...CORE_GRAPH_ONTOLOGY_PROFILE, id: 'workspai.graph.ontology.session-shifted' },
    });
    expect(second.graph?.generation.ontologySetDigest.value).not.toBe(
      first.graph?.generation.ontologySetDigest.value
    );
    session.dispose();
  });

  it('matches an independent full build after a source-file rename', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-rename","private":true}\n',
      'src/alpha.ts': 'export function ping(): number { return 1; }\n',
      'src/app.ts': `import { ping } from './alpha.js';\nexport function run(): number { return ping(); }\n`,
    });
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    await fs.rename(path.join(root, 'src/alpha.ts'), path.join(root, 'src/beta.ts'));
    await fs.writeFile(
      path.join(root, 'src/app.ts'),
      `import { ping } from './beta.js';\nexport function run(): number { return ping(); }\n`,
      'utf8'
    );
    const incremental = await buildNodeIncrementalRepoGraph({
      root,
      session,
      base: first,
    });
    const oracleSession = createGraphProductBuildSession();
    const oracle = await buildNodeRepoGraph({ root, session: oracleSession });
    expectIndependentOracleMatch(incremental, oracle);
    expect(oracle.admittedInputs?.some((input) => input.locator === 'src/beta.ts')).toBe(true);
    expect(oracle.admittedInputs?.some((input) => input.locator === 'src/alpha.ts')).toBe(false);
    oracleSession.dispose();
    session.dispose();
  });

  it('matches an independent full build after deleting then restoring a source file', async () => {
    const files = {
      'package.json': '{"name":"session-restore","private":true}\n',
      'src/alpha.ts': 'export function ping(): number { return 1; }\n',
      'src/app.ts': `import { ping } from './alpha.js';\nexport function run(): number { return ping(); }\n`,
    };
    const root = await writeRepo(files);
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    await fs.rm(path.join(root, 'src/alpha.ts'));
    const deleted = await buildNodeIncrementalRepoGraph({
      root,
      session,
      base: first,
    });
    const deletedOracleSession = createGraphProductBuildSession();
    const deletedOracle = await buildNodeRepoGraph({ root, session: deletedOracleSession });
    expectIndependentOracleMatch(deleted, deletedOracle);
    deletedOracleSession.dispose();
    await fs.writeFile(path.join(root, 'src/alpha.ts'), files['src/alpha.ts'], 'utf8');
    const restored = await buildNodeIncrementalRepoGraph({
      root,
      session,
      base: deleted,
    });
    const oracleSession = createGraphProductBuildSession();
    const oracle = await buildNodeRepoGraph({ root, session: oracleSession });
    expectIndependentOracleMatch(restored, oracle);
    expect(oracle.admittedInputs?.some((input) => input.locator === 'src/alpha.ts')).toBe(true);
    oracleSession.dispose();
    session.dispose();
  });

  it('matches an independent full build when a re-export cycle callee changes', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-reexport-cycle","private":true}\n',
      'src/a.ts': 'export function ping(): number { return 1; }\nexport { pong } from "./b.js";\n',
      'src/b.ts': 'export function pong(): number { return 2; }\nexport { ping } from "./a.js";\n',
      'src/app.ts': `import { ping, pong } from './a.js';\nexport function run(): number { return ping() + pong(); }\n`,
    });
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    await fs.writeFile(
      path.join(root, 'src/a.ts'),
      'export function ping(): number { return 9; }\nexport { pong } from "./b.js";\n',
      'utf8'
    );
    const incremental = await buildNodeIncrementalRepoGraph({
      root,
      session,
      base: first,
    });
    const oracleSession = createGraphProductBuildSession();
    const oracle = await buildNodeRepoGraph({ root, session: oracleSession });
    expectIndependentOracleMatch(incremental, oracle);
    oracleSession.dispose();
    session.dispose();
  });

  it('admits unicode filenames as portable locators in a product build', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"unicode-locators","private":true}\n',
      'src/café.ts': 'export const cafe = 1;\n',
      'src/日本語.ts': 'export const nihongo = 2;\n',
    });
    const session = createGraphProductBuildSession();
    const built = await buildNodeRepoGraph({ root, session });
    const locators = built.admittedInputs?.map((input) => input.locator) ?? [];
    expect(locators).toEqual(expect.arrayContaining(['src/café.ts', 'src/日本語.ts']));
    expect(built.graph).toBeDefined();
    session.dispose();
  });
});
