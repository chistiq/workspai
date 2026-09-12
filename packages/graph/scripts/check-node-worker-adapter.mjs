import { createNodeGraphReferenceWorkerPool } from '../dist/adapters/node/index.js';
import {
  GRAPH_REFERENCE_COMPOSITION_TASK,
  GRAPH_STANDARD_COMPOSITION_POLICY,
} from '../dist/index.js';
import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
} from '../dist/contracts/index.js';

const digest = { algorithm: 'sha256', value: 'a'.repeat(64) };
const scope = { kind: 'project', projectIds: ['project:worker-check'] };
const entity = (id, kind = 'file') => ({ id, identityScheme: GRAPH_IDENTITY_SCHEME, kind, scope });
const facts = Array.from({ length: 5_000 }, (_, index) => ({
  factId: `fact:${String(index).padStart(5, '0')}`,
  factType: 'source.import',
  subject: entity(`entity:source:${index}`),
  predicate: 'imports',
  object: entity('entity:target', 'module'),
  scope,
  evidence: [
    { id: `evidence:${index}`, sourceKind: 'fixture', relativeLocator: `src/${index}.ts` },
  ],
  provenance: { id: 'provider:worker-check', version: '1' },
  derivation: 'extracted',
  authority: 'observed',
  confidence: 0.9,
  freshness: { status: 'current' },
  truthLifecycle: { invalidatedBy: ['input-change'] },
  observedAt: '2026-09-08T00:00:00.000Z',
  inputDigest: digest,
  unknownZones: [],
}));
const manifest = {
  contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
  id: 'provider:worker-check',
  version: '1',
  displayName: 'Worker check',
  determinism: 'deterministic',
  capabilities: {
    entityKinds: ['file', 'module'],
    relationKinds: ['imports'],
    relationSemantics: ['structural'],
    factFamilies: ['source.import'],
    allowedClaims: ['observed'],
  },
  permissions: { filesystem: 'none', network: 'deny', process: 'deny', credentials: 'deny' },
  limits: { maxDurationMs: 30_000, maxFacts: facts.length },
  contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
  supportedInputs: ['fixture'],
  incremental: 'input',
  identitySchemes: [GRAPH_IDENTITY_SCHEME],
};
const input = { locator: 'worker-check', digest };
const request = {
  ontology: {
    contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
    id: 'workspai.graph.ontology.worker-check',
    version: '1',
    entities: [
      { kind: 'file', family: 'source' },
      { kind: 'module', family: 'source' },
    ],
    relations: [
      {
        kind: 'imports',
        semantics: 'structural',
        subjectFamilies: ['source'],
        objectFamilies: ['source'],
        symmetric: false,
        transitive: false,
        allowedAuthorities: ['observed'],
        proofPolicy: { id: 'workspai.graph.proof.worker-check', version: '1' },
      },
    ],
  },
  sources: [
    {
      manifest,
      batch: {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: 'batch:worker-check',
        scope,
        inputs: [input],
        facts,
        diagnostics: [],
        coverage: [{ dimension: 'fixture', observed: facts.length, expected: facts.length }],
        unknownZones: [],
        unsupportedZones: [],
        redaction: { policy: 'portable', redacted: 0, omitted: 0 },
        status: 'complete',
        processing: [],
      },
    },
  ],
  policy: GRAPH_STANDARD_COMPOSITION_POLICY,
};

const pool = createNodeGraphReferenceWorkerPool();
const cancelledController = new AbortController();
cancelledController.abort();
const cancelled = await pool.execute({
  task: GRAPH_REFERENCE_COMPOSITION_TASK,
  input: request,
  timeoutMs: 30_000,
  maxOutputBytes: GRAPH_STANDARD_COMPOSITION_POLICY.maxWorkerOutputBytes,
  signal: cancelledController.signal,
});
if (cancelled.status !== 'cancelled') {
  throw new Error(`Node Graph worker did not honor pre-start cancellation: ${cancelled.status}`);
}
const runningController = new AbortController();
const runningTask = pool.execute({
  task: GRAPH_REFERENCE_COMPOSITION_TASK,
  input: request,
  timeoutMs: 30_000,
  maxOutputBytes: GRAPH_STANDARD_COMPOSITION_POLICY.maxWorkerOutputBytes,
  signal: runningController.signal,
});
runningController.abort();
const cancelledWhileRunning = await runningTask;
if (cancelledWhileRunning.status !== 'cancelled') {
  throw new Error(
    `Node Graph worker did not honor in-flight cancellation: ${cancelledWhileRunning.status}`
  );
}
const invalidBudget = await pool.execute({
  task: GRAPH_REFERENCE_COMPOSITION_TASK,
  input: request,
  timeoutMs: 0,
  maxOutputBytes: 0,
});
if (invalidBudget.status !== 'resource-limit') {
  throw new Error(`Node Graph worker accepted an invalid budget: ${invalidBudget.status}`);
}
let heartbeats = 0;
const heartbeat = setInterval(() => {
  heartbeats += 1;
}, 1);
const result = await pool.execute({
  task: GRAPH_REFERENCE_COMPOSITION_TASK,
  input: request,
  timeoutMs: 30_000,
  maxOutputBytes: GRAPH_STANDARD_COMPOSITION_POLICY.maxWorkerOutputBytes,
});
clearInterval(heartbeat);

if (result.status !== 'complete' || !result.output) {
  throw new Error(`Node Graph worker did not complete: ${result.status}`);
}
if (heartbeats === 0) throw new Error('Node Graph worker blocked the host event loop.');
if (result.output.candidates.length !== facts.length) {
  throw new Error(`Node Graph worker lost candidates: ${result.output.candidates.length}`);
}
if (result.metrics.outputBytes <= 0 || result.metrics.durationMs < 0) {
  throw new Error('Node Graph worker returned invalid execution metrics.');
}

const bounded = await pool.execute({
  task: GRAPH_REFERENCE_COMPOSITION_TASK,
  input: request,
  timeoutMs: 30_000,
  maxOutputBytes: 1,
});
if (
  bounded.status !== 'resource-limit' ||
  bounded.diagnostics[0]?.code !== 'GRAPH_NODE_WORKER_OUTPUT_LIMIT'
) {
  throw new Error(`Node Graph worker did not enforce its output budget: ${bounded.status}`);
}

const unsupported = await pool.execute({
  task: { id: 'workspai.graph.unknown-task', version: '1' },
  input: request,
  timeoutMs: 30_000,
  maxOutputBytes: 1,
});
if (unsupported.status !== 'unsupported') {
  throw new Error(`Node Graph worker did not reject an unknown task: ${unsupported.status}`);
}

console.log(
  `Node Graph worker passed: ${facts.length} facts, ${heartbeats} host heartbeats, ${result.metrics.durationMs.toFixed(3)}ms worker time.`
);
