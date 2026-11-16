import os from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkspaceModel,
  writeWorkspaceModel,
  workspaceModelProjectTopology,
} from '../workspace-model.js';
import { buildWorkspaceKnowledgeGraph } from '../workspace-knowledge-graph.js';
import {
  queryKnowledgeEvidence,
  knowledgeProofMatchesProjectScope,
  searchKnowledgeGraph,
} from '../workspace-knowledge-graph-query.js';
import { hashWorkspaceModel } from '../workspace-model-hash.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import {
  buildWorkspaceGraphSearchView,
  graphSearchByteBudget,
  graphSearchViewBytes,
  workspaceKnowledgeGraphRevision,
} from '../workspace-graph-search-view.js';
import type { WorkspaceGraphSearchView } from '../workspace-graph-search-view.js';
import type { WorkspaceKnowledgeGraph } from '../contracts/workspace-knowledge-graph-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';

describe('revision-bound graph search consumer view', () => {
  let root: string;
  let graph: WorkspaceKnowledgeGraph;
  const cli = path.resolve('dist/index.js');
  beforeAll(async () => {
    root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-view-'));
    await fsExtra.outputFile(path.join(root, '.workspai-workspace'), 'lab\n');
    await fsExtra.outputJson(path.join(root, '.workspai/workspace.contract.json'), {
      schemaVersion: 1,
      kind: 'rapidkit.workspace.contract',
      workspace: { name: 'lab' },
      projects: [],
    });
    for (const name of ['api', 'other']) {
      await fsExtra.outputJson(path.join(root, name, '.workspai/project.json'), {
        name,
        runtime: 'node',
        framework: 'node',
      });
      await fsExtra.outputJson(path.join(root, name, 'package.json'), {
        name,
        scripts: { test: 'node --test' },
      });
      await fsExtra.outputFile(
        path.join(root, name, 'src/slug.ts'),
        `${name === 'other' ? "import { missing } from './missing.js';\n" : ''}export function createArticleSlug(value: string) { return value.trim(); }\n`
      );
      await fsExtra.outputFile(
        path.join(root, name, 'tests/slug.test.ts'),
        'createArticleSlug("test");\n'
      );
    }
    const model = await buildWorkspaceModel({ workspacePath: root });
    await writeWorkspaceModel(model, root);
    graph = await buildWorkspaceKnowledgeGraph({
      workspacePath: root,
      workspace: model.workspace,
      projects: model.projects.map((project) => ({
        id: project.name,
        path: project.path,
        runtime: project.runtime,
      })),
      projectTopology: workspaceModelProjectTopology(model)!,
      source: {
        kind: 'workspace-model',
        artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
        hashAlgorithm: 'sha256',
        hash: hashWorkspaceModel(model),
      },
    });
    await fsExtra.outputJson(
      path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
      graph
    );
  });
  afterAll(async () => {
    if (root) await fsExtra.remove(root);
  });

  function complete(
    source = graph,
    options: { query?: string; maxBytes?: number } = {}
  ): WorkspaceGraphSearchView {
    const result = buildWorkspaceGraphSearchView(source, {
      query: options.query ?? 'createArticleSlug',
      projectId: 'api',
      ...options,
    });
    if (result.status !== 'results')
      throw new Error(`Expected results, required ${result.budget.requiredBytes} bytes`);
    return result;
  }

  it.each(['python', 'typescript', 'go', 'rust'])(
    'ranks a named history parser above generic test vocabulary in %s',
    (language) => {
      const source = structuredClone(graph);
      const prototype = source.entities.find((entity) => entity.kind === 'symbol')!;
      const symbol = {
        ...prototype,
        id: 'subject-parser',
        label: 'parseSavedChatHistory',
        projectId: 'api',
        identity: { ...prototype.identity, key: 'parseSavedChatHistory', aliases: [] },
        attributes: {
          language,
          artifact: 'api/src/history',
          summary: 'terminal tool output multiline messages',
        },
        proofIds: [],
      };
      const noise = Array.from({ length: 15 }, (_, i) => ({
        ...prototype,
        id: `broad-test-${i}`,
        kind: 'file' as const,
        label: `api/tests/test_main_${i}`,
        identity: { ...prototype.identity, key: `test_main_${i}`, aliases: [] },
        projectId: 'api',
        attributes: {
          language,
          summary:
            'add check default enabled exclude fix include maintain please preserve regression run tests verified',
        },
        proofIds: [],
      }));
      source.entities = [
        ...source.entities.filter((entity) => entity.kind === 'project'),
        symbol,
        ...noise,
      ];
      source.relations = [];
      const result = searchKnowledgeGraph(source, {
        query:
          'Fix saved chat history parsing so terminal tool output is preserved, maintaining message order and multiline output, default excludes tool messages; add regression tests and run checks.',
        projectId: 'api',
        limit: 3,
      });
      expect(result.entities[0]?.id).toBe('subject-parser');
    }
  );

  it('returns explicit recovery for no matches instead of claiming absence', () => {
    const view = complete(graph, { query: 'nonexistentSpecificIdentifier' });
    expect(view.retrieval).toMatchObject({ method: 'lexical', status: 'no-matches' });
    expect(view.retrieval.nextAction).toContain('not proof of absence');
  });

  it.each([
    '\u062e\u0648\u0627\u0646\u062f\u0646_\u067e\u06cc\u0627\u0645',
    '\u7b97',
    'cafe\u0301',
  ])('retains Unicode identifiers in lexical search: %s', (identifier) => {
    const source = structuredClone(graph);
    const symbol = source.entities.find((entity) => entity.kind === 'symbol')!;
    symbol.label = identifier.normalize('NFC');
    symbol.identity.aliases.push(symbol.label);
    expect(
      searchKnowledgeGraph(source, { query: identifier, projectId: 'api' }).entities[0]?.id
    ).toBe(symbol.id);
  });

  it('normalizes proof traversal before checking project ownership', () => {
    const proof = { ...graph.proofs[0], artifact: 'api/../other/src/private.ts' };
    expect(knowledgeProofMatchesProjectScope(graph, proof, 'api')).toBe(false);
    expect(
      knowledgeProofMatchesProjectScope(graph, { ...proof, artifact: '../private.ts' }, 'api')
    ).toBe(false);
    expect(
      knowledgeProofMatchesProjectScope(
        graph,
        { ...proof, artifact: 'api\\..\\other\\private.ts' },
        'api'
      )
    ).toBe(false);
  });

  it('preserves ranked matches, evidence, scope and package boundaries while deferring full details', () => {
    const baseline = searchKnowledgeGraph(graph, {
      query: 'createArticleSlug',
      projectId: 'api',
      projection: 'full',
    });
    const view = complete();
    expect(view.matches.map((match) => match.id)).toEqual(
      baseline.entities.map((entity) => entity.id)
    );
    expect(view.matches.length).toBeGreaterThan(0);
    expect(view.scope).toEqual({ workspace: 'lab', project: 'api', kind: null });
    expect(view.matches.some((match) => match.role === 'test')).toBe(true);
    expect(view.matches.some((match) => match.packageManifests.includes('api/package.json'))).toBe(
      true
    );
    expect(JSON.stringify(view.matches)).not.toContain('other/');
    expect(view.claims).toContain('discovery-only');
    expect(view.validation.liveInputsValidated).toBe(false);
    for (const match of view.matches) {
      if (!match.proofId) continue;
      const proof = view.proofs.find((item) => item.id === match.proofId)!;
      expect(proof).toBeDefined();
      expect(proof.artifact.startsWith('api/')).toBe(true);
      expect(match.reason.terms.length).toBeGreaterThan(0);
      const detail = queryKnowledgeEvidence(graph, match.id, 'api');
      expect(detail.found).toBe(true);
      expect(detail.proofs.some((item) => item.id === match.proofId)).toBe(true);
    }
    expect(view.omitted.entityDetails).toBe('deferred');
    expect(view.expand.argv).toContain('--expected-graph-hash');
    expect(view.expand.expectedGraphHash).toBe(view.source.graphHash);
    expect(graphSearchViewBytes(view)).toBeLessThan(
      Buffer.byteLength(JSON.stringify(baseline, null, 2) + '\n')
    );
  });

  it('preserves unscoped legacy diagnostics, failed providers and workspace freshness limitations', () => {
    const source = structuredClone(graph);
    source.diagnostics.forEach((diagnostic) => {
      delete diagnostic.entityIds;
      delete diagnostic.relationIds;
    });
    source.diagnostics.push({
      code: 'partial',
      severity: 'warning',
      message: 'Some tests are not indexed.',
    });
    source.providers[0].status = 'failed';
    source.proofs[0].freshness = 'unknown';
    const view = complete(source);
    expect(view.diagnostics).toEqual(source.diagnostics);
    expect(view.coverage.failedProviders).toContain(source.providers[0].id);
    expect(view.coverage.unknownCount).toBe(source.quality.unknownCount);
    expect(view.coverage.completeness).toEqual(source.quality.completeness);
    expect(view.validation.proofFreshness.unknown).toBeGreaterThan(0);
    view.diagnostics[0].message = 'local mutation';
    expect(source.diagnostics[0].message).not.toBe('local mutation');
  });

  it('scopes actual source-provider findings by project without altering the canonical graph', () => {
    const foreignProject = graph.entities.find(
      (entity) => entity.kind === 'project' && entity.projectId === 'other'
    )!;
    const finding = graph.diagnostics.find(
      (diagnostic) => diagnostic.code === 'graph.provider.source_structure.unresolved_local_imports'
    )!;
    expect(finding).toBeDefined();
    expect(finding.entityIds).toEqual([foreignProject.id]);
    const view = complete();
    expect(view.diagnostics).not.toContainEqual(finding);
    expect(view.diagnosticSelection).toMatchObject({
      mode: 'project-and-unscoped',
      aggregateScope: 'workspace',
      omittedForeign: 1,
    });
    const full = buildWorkspaceGraphSearchView(graph, { query: 'createArticleSlug' });
    if (full.status !== 'results') throw new Error('Expected workspace view');
    expect(full.diagnostics).toEqual(graph.diagnostics);
    expect(full.diagnosticSelection?.omittedForeign).toBe(0);
    expect(graph.diagnostics).toContainEqual(finding);
    const legacyView = structuredClone(view);
    delete legacyView.diagnosticSelection;
    expect(() =>
      assertJsonSchemaContract(
        legacyView,
        'contracts/workspace-intelligence/workspace-graph-search-view.v1.json',
        'Legacy compact graph view'
      )
    ).not.toThrow();
  });

  it('retains global, relevant, mixed, shared and unresolved findings regardless of severity or message', () => {
    const source = structuredClone(graph);
    const own = source.entities.find((entity) => entity.projectId === 'api')!;
    const other = source.entities.find((entity) => entity.projectId === 'other')!;
    source.entities.push({ ...other, id: 'shared-finding', projectId: undefined });
    source.relations.push(
      { ...source.relations[0], id: 'foreign', from: other.id, to: other.id },
      { ...source.relations[0], id: 'cross-project', from: other.id, to: own.id }
    );
    source.diagnostics = [
      { code: 'own', severity: 'error', message: 'Other name in text', entityIds: [own.id] },
      { code: 'foreign', severity: 'error', message: 'api name in text', entityIds: [other.id] },
      { code: 'global', severity: 'error', message: 'Global provider failure' },
      {
        code: 'mixed',
        severity: 'warning',
        message: 'Both projects',
        entityIds: [own.id, other.id],
      },
      {
        code: 'missing',
        severity: 'warning',
        message: 'Unknown ID',
        entityIds: [other.id, 'missing'],
      },
      { code: 'shared', severity: 'info', message: 'Shared', entityIds: ['shared-finding'] },
      { code: 'foreign-relation', severity: 'error', message: 'Foreign', relationIds: ['foreign'] },
      {
        code: 'cross',
        severity: 'error',
        message: 'Cross boundary',
        relationIds: ['cross-project'],
      },
      {
        code: 'unknown-relation',
        severity: 'warning',
        message: 'Unknown',
        relationIds: ['missing'],
      },
    ];
    const view = complete(source);
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'own',
      'global',
      'mixed',
      'missing',
      'shared',
      'cross',
      'unknown-relation',
    ]);
    expect(view.diagnosticSelection).toEqual({
      mode: 'project-and-unscoped',
      omittedForeign: 2,
      retainedUnscoped: 4,
      aggregateScope: 'workspace',
    });
    // Unknown or old unscoped findings are never hidden to force a packet under budget.
    source.diagnostics.push({ code: 'unscoped', severity: 'error', message: 'x'.repeat(140000) });
    expect(
      buildWorkspaceGraphSearchView(source, {
        query: 'createArticleSlug',
        projectId: 'api',
        maxBytes: 131072,
      }).status
    ).toBe('insufficient-budget');
  });

  it('keeps shared-entity proof expansion and exact relation lookup within project scope', () => {
    const source = structuredClone(graph);
    const own = source.entities.find(
      (entity) => entity.kind === 'symbol' && entity.projectId === 'api'
    )!;
    for (const entity of source.entities.filter((item) => item.kind === 'project')) {
      entity.attributes.path = `.\\${String(entity.attributes.path).replace(/\//gu, '\\')}`;
    }
    const other = source.entities.find(
      (entity) => entity.kind === 'symbol' && entity.projectId === 'other'
    )!;
    const shared = { ...own, id: 'shared-slug', proofIds: [...other.proofIds, ...own.proofIds] };
    delete shared.projectId;
    source.entities.push(shared);
    const project = source.entities.find(
      (entity) => entity.kind === 'project' && entity.projectId === 'api'
    )!;
    source.relations.push({
      ...source.relations[0],
      id: 'shared-relation',
      from: project.id,
      to: shared.id,
      kind: 'contains',
      proofIds: own.proofIds,
    });
    const view = complete(source);
    const match = view.matches.find((item) => item.id === shared.id)!;
    expect(view.proofs.find((proof) => proof.id === match.proofId)?.artifact).toMatch(/^api\//);
    const detail = queryKnowledgeEvidence(source, shared.id, 'api');
    expect(detail.found).toBe(true);
    expect(detail.proofs.every((proof) => proof.artifact.startsWith('api/'))).toBe(true);
    const foreignIds = new Set(
      source.entities.filter((entity) => entity.projectId === 'other').map((entity) => entity.id)
    );
    const foreign = source.relations.find(
      (relation) => foreignIds.has(relation.from) && foreignIds.has(relation.to)
    )!;
    expect(queryKnowledgeEvidence(source, foreign.id, 'api').found).toBe(false);
  });

  it('counts exact UTF-8 wire bytes including Unicode and the trailing newline', () => {
    const source = structuredClone(graph);
    source.diagnostics.push({
      code: 'unicode',
      severity: 'info',
      message: '\u0645\u0633\u06cc\u0631 \u0622\u0632\u0645\u0648\u0646 🧭',
    });
    const view = complete(source);
    const wire = JSON.stringify(view) + '\n';
    expect(view.budget.usedBytes).toBe(Buffer.byteLength(wire));
    expect(Buffer.byteLength(wire)).toBeGreaterThan(wire.length);
    expect(view.budget.usedBytes).toBeLessThanOrEqual(view.budget.maxBytes);
  });

  it('rejects insufficient budgets without silently dropping matches, evidence or diagnostics', () => {
    const failed = buildWorkspaceGraphSearchView(graph, {
      query: 'createArticleSlug',
      projectId: 'api',
      maxBytes: 1024,
    });
    expect(failed.status).toBe('insufficient-budget');
    if (failed.status !== 'insufficient-budget') throw new Error('Expected budget failure');
    expect(graphSearchViewBytes(failed)).toBeLessThanOrEqual(1024);
    expect(failed).not.toHaveProperty('matches');
    const retry = complete(graph, { maxBytes: failed.budget.requiredBytes });
    expect(retry.budget.usedBytes).toBeLessThanOrEqual(failed.budget.requiredBytes);
  });

  it('binds the revision to content, providers and findings rather than observation timestamps', () => {
    const initial = workspaceKnowledgeGraphRevision(graph);
    const observed = structuredClone(graph);
    observed.generatedAt = '2026-11-09T00:00:00.000Z';
    observed.proofs.forEach((proof) => {
      proof.observedAt = observed.generatedAt;
    });
    expect(workspaceKnowledgeGraphRevision(observed)).toBe(initial);
    observed.proofs[0].contentHash = 'e'.repeat(64);
    expect(workspaceKnowledgeGraphRevision(observed)).not.toBe(initial);
    const provider = structuredClone(graph);
    provider.providers[0].version = '99.0.0';
    expect(workspaceKnowledgeGraphRevision(provider)).not.toBe(initial);
  });

  it('recommends a budget that fits in one retry at a decimal-width boundary', () => {
    const source = structuredClone(graph);
    source.diagnostics.push({ code: 'budget', severity: 'warning', message: 'x' });
    const initial = complete(source, { maxBytes: 9999 });
    source.diagnostics[source.diagnostics.length - 1].message = 'x'.repeat(
      10000 - initial.budget.usedBytes + 1
    );
    const rejected = buildWorkspaceGraphSearchView(source, {
      query: 'createArticleSlug',
      projectId: 'api',
      maxBytes: 9999,
    });
    expect(rejected.status).toBe('insufficient-budget');
    if (rejected.status !== 'insufficient-budget') throw new Error('Expected rejection');
    expect(rejected.budget.requiredBytes).toBeGreaterThan(10000);
    const retry = complete(source, { maxBytes: rejected.budget.requiredBytes });
    expect(retry.budget.usedBytes).toBe(rejected.budget.requiredBytes);
  });

  it('refuses oversized findings without truncation or an unbounded failure envelope', () => {
    const source = structuredClone(graph);
    source.diagnostics.push({
      code: 'large-finding',
      severity: 'error',
      message: '\u0645\u062d\u062f\u0648\u062f\u06cc\u062a '.repeat(20000),
    });
    const result = buildWorkspaceGraphSearchView(source, {
      query: '\u0645\u0633\u06cc\u0631 '.repeat(1000),
      maxBytes: 1024,
    });
    expect(result.status).toBe('insufficient-budget');
    if (result.status !== 'insufficient-budget') throw new Error('Expected rejection');
    expect(result.budget.requiredBytes).toBeGreaterThan(131072);
    expect(graphSearchViewBytes(result)).toBeLessThanOrEqual(1024);
    expect(result.nextActions[0]).toContain('--view full');
  });

  it('returns scoped no-match results without manufacturing test or execution evidence', () => {
    const view = complete(graph, { query: 'nonexistentzqxv' });
    expect(view.matches).toEqual([]);
    expect(view.proofs).toEqual([]);
    expect(view.totalMatches).toBe(0);
    expect(view.claims).toContain('do not establish');
  });

  it.each(['-1', '1e4', '1023', '131073', '4096junk', 2.5])(
    'rejects invalid byte budget %s',
    (value) => {
      expect(() => graphSearchByteBudget(value)).toThrow();
    }
  );

  it('delivers budgeted CLI JSON and expands the same revision; rejects a changed revision', async () => {
    const result = await execa(
      process.execPath,
      [
        cli,
        'workspace',
        'graph',
        'search',
        'createArticleSlug',
        '--scope',
        'project:api',
        '--view',
        'agent',
        '--json',
      ],
      { cwd: root }
    );
    const view = JSON.parse(result.stdout) as WorkspaceGraphSearchView;
    expect(view.status).toBe('results');
    expect(view.budget.usedBytes).toBe(Buffer.byteLength(result.stdout + '\n'));
    expect(view.validation.liveInputsValidated).toBe(true);
    const legacy = JSON.parse(
      (
        await execa(
          process.execPath,
          [
            cli,
            'workspace',
            'graph',
            'search',
            'createArticleSlug',
            '--scope',
            'project:api',
            '--json',
          ],
          { cwd: root }
        )
      ).stdout
    );
    const full = JSON.parse(
      (
        await execa(
          process.execPath,
          [
            cli,
            'workspace',
            'graph',
            'search',
            'createArticleSlug',
            '--scope',
            'project:api',
            '--view',
            'full',
            '--json',
          ],
          { cwd: root }
        )
      ).stdout
    );
    expect(legacy.schemaVersion).toBe('workspace-knowledge-search.v1');
    expect(legacy.budget.mode).toBe('agent');
    expect(full.schemaVersion).toBe(legacy.schemaVersion);
    expect(full).not.toHaveProperty('budget');
    expect(view.matches.map((item) => item.id)).toEqual(
      legacy.entities.map((item: { id: string }) => item.id)
    );
    const match = view.matches.find((item) => item.proofId)!;
    const args = view.expand.argv.map((argument) => (argument === '<id>' ? match.id : argument));
    const expanded = await execa(process.execPath, [cli, ...args], { cwd: root });
    const detail = JSON.parse(expanded.stdout);
    expect(detail.found).toBe(true);
    expect(detail.target.id).toBe(match.id);
    expect(detail.graphHash).toBe(view.source.graphHash);
    const changed = structuredClone(graph);
    changed.diagnostics.push({ code: 'changed', severity: 'warning', message: 'New finding' });
    try {
      await fsExtra.outputJson(
        path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
        changed
      );
      const blocked = await execa(process.execPath, [cli, ...args], { cwd: root, reject: false });
      expect(blocked.exitCode).toBe(2);
      expect(JSON.parse(blocked.stdout).error.code).toBe('workspace.graph.revision.changed');
    } finally {
      await fsExtra.outputJson(
        path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph),
        graph
      );
    }
    const sourcePath = path.join(root, 'api/src/slug.ts');
    const sourceBytes = await fsExtra.readFile(sourcePath);
    try {
      await fsExtra.writeFile(sourcePath, Buffer.concat([sourceBytes, Buffer.from('\n')]));
      const stale = await execa(process.execPath, [cli, ...args], { cwd: root, reject: false });
      expect(stale.exitCode).toBe(2);
      expect(JSON.parse(stale.stdout).error.code).toBe('workspace.graph.revision.changed');
    } finally {
      await fsExtra.writeFile(sourcePath, sourceBytes);
    }
    const small = await execa(
      process.execPath,
      [
        cli,
        'workspace',
        'graph',
        'search',
        'createArticleSlug',
        '--view',
        'agent',
        '--max-bytes',
        '1024',
        '--json',
      ],
      { cwd: root, reject: false }
    );
    expect(small.exitCode).toBe(2);
    expect(JSON.parse(small.stdout).status).toBe('insufficient-budget');
  });

  it.each(
    [
      ['search', 'slug', '--view', 'bad', '--json'],
      ['search', 'slug', '--view', 'agent'],
      ['search', 'slug', '--max-bytes', '4096', '--json'],
      ['search', 'slug', '--view', 'agent', '--scope', 'project:', '--json'],
      ['search', 'slug', '--view', 'agent', '--limit', '2junk', '--json'],
      ['emit', '--view', 'agent', '--json'],
      ['evidence', 'id', '--expected-graph-hash', 'bad', '--json'],
    ].map((args) => ({ args }))
  )('rejects invalid CLI output options before workspace lookup: $args', async ({ args }) => {
    const result = await execa(process.execPath, [cli, 'workspace', 'graph', ...args], {
      cwd: os.tmpdir(),
      reject: false,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain(
      args.includes('--json') ? 'workspace.graph.output.invalid' : 'requires --json'
    );
  });
});
