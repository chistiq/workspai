import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphOntologyProfile,
  type GraphWorkspaceFact,
} from '../../src/contracts/index.js';
import {
  composeGraph,
  executeGraphReferenceCompositionTask,
  semanticFactCanonical,
} from '../../src/application/compose-graph.js';
import {
  canonicalRepositoryIdentity,
  disposeResidentSessions,
  listRecoverableSessions,
  nativeExecutionIdentity,
  projectExplicitPartitions,
  NativePartitionSession,
  reapAbandonedJournals,
  residentSessionIsOpen,
  residentSessionKey,
  residentSessionObservation,
} from '../../src/application/native-partition-session.js';
import { NativeGraphQuerySession } from '../../src/application/native-query-session.js';
import {
  encodeCompositionFrame,
  composeBinaryFileName,
  closeNativeGraphSnapshot,
  verifyComposeBinary,
} from '../../src/application/owned-composition.js';
import {
  GRAPH_STANDARD_COMPOSITION_POLICY,
  requireMaterializedDecisions,
  requireMaterializedGraph,
  type GraphCompositionRequest,
  type GraphCompositionSource,
} from '../../src/application/composition-types.js';
import type {
  GraphExecutionPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';

function isolateNativeRoots(): void {
  let journal = '';
  let snapshot = '';
  let previousJournal: string | undefined;
  let previousSnapshot: string | undefined;
  beforeEach(() => {
    previousJournal = process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    previousSnapshot = process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    journal = mkdtempSync(join(tmpdir(), 'workspai-journal-'));
    snapshot = mkdtempSync(join(tmpdir(), 'workspai-snapshot-'));
    process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = journal;
    process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = snapshot;
  });
  afterEach(async () => {
    await disposeResidentSessions();
    if (journal) rmSync(journal, { recursive: true, force: true });
    if (snapshot) rmSync(snapshot, { recursive: true, force: true });
    journal = '';
    snapshot = '';
    if (previousJournal === undefined) delete process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    else process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = previousJournal;
    if (previousSnapshot === undefined) delete process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    else process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = previousSnapshot;
  });
}

const digest = { algorithm: 'sha256' as const, value: 'ab'.repeat(32) };
const scope = { kind: 'project' as const, projectIds: ['app'] as [string] };

function entity(id: string, kind: 'file' | 'module' = 'file') {
  return { id, identityScheme: GRAPH_IDENTITY_SCHEME, kind, scope };
}

function fact(id: string, target: string): GraphWorkspaceFact {
  return {
    factId: id,
    factType: 'source.import',
    subject: entity('file:src/a.ts'),
    predicate: 'imports',
    object: entity(target, 'module'),
    scope,
    evidence: [
      {
        id: `evidence:${id}`,
        sourceKind: 'source-file',
        relativeLocator: 'src/a.ts',
        digest,
      },
    ],
    provenance: { id: 'provider', version: '1' },
    derivation: 'extracted',
    authority: 'observed',
    confidence: 1,
    freshness: { status: 'current' },
    truthLifecycle: { invalidatedBy: ['input-change'] },
    observedAt: '2026-09-08T12:00:00.000Z',
    inputDigest: digest,
    unknownZones: [],
  };
}

const ontology: GraphOntologyProfile = {
  contract: GRAPH_ONTOLOGY_PROFILE_CONTRACT,
  id: 'workspai.graph.ontology.test',
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
      allowedAuthorities: ['declared', 'observed', 'verified', 'inferred'],
      proofPolicy: { id: 'workspai.graph.proof.test', version: '1' },
    },
  ],
};

function source(
  facts: readonly GraphWorkspaceFact[],
  provider = 'provider'
): GraphCompositionSource {
  const input = { locator: `src/${provider}.ts`, digest };
  const batch: GraphFactBatch = {
    contract: GRAPH_FACT_BATCH_CONTRACT,
    provider: { id: provider, version: '1' },
    batchId: `batch:${provider}`,
    scope,
    inputs: [input],
    facts: facts.map((item) => ({ ...item, provenance: { id: provider, version: '1' } })),
    diagnostics: [],
    coverage: [{ dimension: 'source-files', observed: 1, expected: 1 }],
    unknownZones: [],
    unsupportedZones: [],
    redaction: { policy: 'portable', redacted: 0, omitted: 0 },
    status: 'complete',
    processing: [
      {
        input,
        provider: { id: provider, version: '1' },
        stage: { id: 'extract', version: '1' },
        outcome: 'processed',
        outputDigest: digest,
        diagnostics: [],
      },
    ],
  };
  return {
    manifest: {
      contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
      id: provider,
      version: '1',
      displayName: 'provider',
      determinism: 'deterministic',
      capabilities: {
        entityKinds: ['file', 'module'],
        relationKinds: ['imports'],
        relationSemantics: ['structural'],
        factFamilies: ['source.import'],
        allowedClaims: ['observed', 'declared', 'verified', 'inferred'],
      },
      permissions: { filesystem: 'none', network: 'deny', process: 'deny', credentials: 'deny' },
      limits: { maxDurationMs: 1_000, maxFacts: 100 },
      contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
      supportedInputs: ['source'],
      incremental: 'input',
      identitySchemes: [GRAPH_IDENTITY_SCHEME],
    },
    batch,
  };
}

function ports(now = '2026-09-22T00:00:00.000Z'): GraphExecutionPorts {
  return {
    clock: { now: () => new Date(now) },
    digest: {
      algorithm: 'sha256',
      digest: async (input) => createHash('sha256').update(input).digest('hex'),
      digestSync: (input) => createHash('sha256').update(input).digest('hex'),
      createStreamingDigest: () => {
        const hash = createHash('sha256');
        return {
          update: (chunk: Uint8Array) => {
            hash.update(chunk);
          },
          digest: async () => hash.digest('hex'),
        };
      },
    },
    cancellation: { aborted: false, throwIfAborted: () => undefined },
    scheduler: { yield: async () => undefined },
    workers: {
      async execute<TInput, TOutput>(
        task: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
        return {
          status: 'complete',
          output: executeGraphReferenceCompositionTask(
            task.input as GraphCompositionRequest
          ) as TOutput,
          diagnostics: [],
          metrics: { durationMs: 0, inputBytes: 1, outputBytes: 1 },
        };
      },
    },
  };
}

describe('owned composition framing', () => {
  it('writes a kind and payload as one frame', () => {
    const frame = encodeCompositionFrame(2, Buffer.from([9, 8, 7]));
    expect(frame.readUInt32LE(0)).toBe(4);
    expect(frame[4]).toBe(2);
    expect([...frame.subarray(5)]).toEqual([9, 8, 7]);
  });

  it('does not drop a payload when the first write would have returned false', async () => {
    const chunks: Buffer[] = [];
    const stream = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        setImmediate(callback);
      },
    });
    const frame = encodeCompositionFrame(1, Buffer.alloc(64, 7));
    const written = stream.write(frame);
    if (!written) await once(stream, 'drain');
    stream.end();
    await once(stream, 'finish');
    const body = Buffer.concat(chunks);
    expect(body.equals(frame)).toBe(true);
    expect(body.byteLength).toBe(frame.byteLength);
  });

  it('names packaged binaries for linux, macOS, and windows', () => {
    expect(composeBinaryFileName('linux', 'x64')).toBe('graph-compose-graph-linux-x64');
    expect(composeBinaryFileName('darwin', 'arm64')).toBe('graph-compose-graph-darwin-arm64');
    expect(composeBinaryFileName('win32', 'x64')).toBe('graph-compose-graph-win32-x64.exe');
    expect(composeBinaryFileName('freebsd', 'x64')).toBeUndefined();
  });

  it('kills a child without waiting for a long timeout', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    const started = Date.now();
    child.kill('SIGKILL');
    await once(child, 'close');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(child.exitCode === null || child.signalCode === 'SIGKILL').toBe(true);
  });
});

describe('owned composition parity', () => {
  isolateNativeRoots();
  beforeAll(() => {
    const binary = fileURLToPath(
      new URL('../../../../target/release/graph-compose-graph', import.meta.url)
    );
    if (existsSync(binary)) return;
    const env = { ...process.env };
    delete env.CARGO_TARGET_DIR;
    execFileSync(
      'cargo',
      [
        'build',
        '--offline',
        '--release',
        '-p',
        'workspai-graph-engine',
        '--bin',
        'graph-compose-graph',
      ],
      {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        env,
        stdio: 'inherit',
      }
    );
  }, 180_000);
  it('matches the TypeScript content and fact digests for a small graph', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const typescript = await composeGraph(request, ports());
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = '1';
    const rust = await composeGraph(request, ports());
    if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
    expect(typescript.accepted).toBe(true);
    expect(rust.accepted).toBe(true);
    if (!typescript.accepted || !rust.accepted) return;
    expect(rust.timings.ownedFallbackReason).toBe('');
    expect(rust.timings.ownedFactDigest).toBe('complete');
    expect(rust.timings.ownedRetainedCanonicalBytes).toBe(0);
    expect(rust.value.receipt.factSetDigest.value).toBe(
      typescript.value.receipt.factSetDigest.value
    );
    expect(rust.value.receipt.contentDigest.value).toBe(
      typescript.value.receipt.contentDigest.value
    );
    expect(requireMaterializedGraph(rust.value).nodes.map((node) => node.id)).toEqual(
      requireMaterializedGraph(typescript.value).nodes.map((node) => node.id)
    );
    expect(requireMaterializedGraph(rust.value).edges.map((edge) => edge.id)).toEqual(
      requireMaterializedGraph(typescript.value).edges.map((edge) => edge.id)
    );
    expect(
      requireMaterializedGraph(rust.value).edges.map((edge) => [
        edge.from,
        edge.relation,
        edge.to,
        edge.proof.state,
      ])
    ).toEqual(
      requireMaterializedGraph(typescript.value).edges.map((edge) => [
        edge.from,
        edge.relation,
        edge.to,
        edge.proof.state,
      ])
    );
  });

  it('matches digests for duplicate, non-ASCII, and non-compact facts', async () => {
    const duplicated = fact('fact:dup', 'module:dup');
    const unicodeBase = fact('fact:unicode', 'module:left');
    const unicode: GraphWorkspaceFact = {
      ...unicodeBase,
      evidence: [{ ...unicodeBase.evidence[0]!, relativeLocator: 'src/café.ts' }],
    };
    const extended = {
      ...fact('fact:ext', 'module:ext'),
      extensions: { 'workspai.graph.note': 'x', 'workspai.graph.line': 4 },
    };
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([duplicated, unicode, extended]), source([duplicated], 'provider.b')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const typescript = await composeGraph(request, ports());
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = '1';
    const rust = await composeGraph(request, ports());
    if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
    if (!typescript.accepted) throw new Error(JSON.stringify(typescript.issues));
    if (!rust.accepted) throw new Error(`${rust.code} ${JSON.stringify(rust.issues)}`);
    expect(rust.timings.ownedFallbackReason).toBe('');
    expect(rust.value.receipt.factSetDigest.value).toBe(
      typescript.value.receipt.factSetDigest.value
    );
    expect(rust.value.receipt.contentDigest.value).toBe(
      typescript.value.receipt.contentDigest.value
    );
    expect(
      requireMaterializedGraph(rust.value)
        .edges.map((edge) => edge.id)
        .sort()
    ).toEqual(
      requireMaterializedGraph(typescript.value)
        .edges.map((edge) => edge.id)
        .sort()
    );
  });

  it('keeps concurrent compositions from sharing one output directory', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:left', 'module:left'), fact('fact:right', 'module:right')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    try {
      const [first, second] = await Promise.all([
        composeGraph(request, ports()),
        composeGraph(request, ports()),
      ]);
      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
      if (!first.accepted || !second.accepted) return;
      expect(first.timings.ownedFallbackReason).toBe('');
      expect(second.timings.ownedFallbackReason).toBe('');
      expect(first.value.receipt.contentDigest.value).toBe(
        second.value.receipt.contentDigest.value
      );
      expect(first.value.receipt.factSetDigest.value).toBe(
        second.value.receipt.factSetDigest.value
      );
    } finally {
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    }
  });

  it('returns a native snapshot handle without materializing nodes', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    const typescript = await composeGraph(request, ports());
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    const rust = await composeGraph(request, ports());
    if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
    expect(typescript.accepted).toBe(true);
    expect(rust.accepted).toBe(true);
    if (!typescript.accepted || !rust.accepted) return;
    expect(rust.value.representation).toBe('native-snapshot');
    if (rust.value.representation !== 'native-snapshot') return;
    expect('graph' in rust.value).toBe(false);
    expect(request.sources[0]?.batch.facts).toHaveLength(2);
    expect(rust.value.snapshot.nodeCount).toBe(
      requireMaterializedGraph(typescript.value).nodes.length
    );
    expect(rust.value.snapshot.edgeCount).toBe(
      requireMaterializedGraph(typescript.value).edges.length
    );
    expect(rust.value.snapshot.factDigest.value).toBe(typescript.value.receipt.factSetDigest.value);
    expect(rust.value.snapshot.contentDigest.value).toBe(
      typescript.value.receipt.contentDigest.value
    );
    expect(rust.value.snapshot.fallback).toBe('');
    expect(rust.value.snapshot.lifecycle).toBe('published');
    closeNativeGraphSnapshot(rust.value.snapshot.snapshotId);
  });

  it('falls back to the original facts when native acknowledgement never arrives', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workspai-compose-fail-'));
    const binary = join(directory, 'fail-before-ack.mjs');
    writeFileSync(binary, '#!/usr/bin/env node\nprocess.exit(1)\n');
    chmodSync(binary, 0o755);
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previousKernel = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const previousBinary = process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
    const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    process.env.WORKSPAI_GRAPH_COMPOSE_BIN = binary;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    try {
      const result = await composeGraph(request, ports());
      expect(request.sources[0]?.batch.facts).toHaveLength(2);
      expect(result.accepted).toBe(true);
      if (!result.accepted) return;
      expect(result.timings.ownedFallbackReason).not.toBe('');
      expect(result.value.representation).toBe('materialized');
      expect(requireMaterializedGraph(result.value).nodes.length).toBeGreaterThan(0);
    } finally {
      if (previousKernel === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previousKernel;
      if (previousBinary === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
      else process.env.WORKSPAI_GRAPH_COMPOSE_BIN = previousBinary;
      if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['fact-count', 'corrupt-frame', 'packed-digest', 'snapshot-rename', 'publication'])(
    'keeps the original facts when native publication fails at %s',
    async (fault) => {
      const request: GraphCompositionRequest = {
        ontology,
        sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      const previousKernel = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      const previousFault = process.env.WORKSPAI_GRAPH_COMPOSE_FAULT;
      const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      delete process.env.WORKSPAI_GRAPH_COMPOSE_FAULT;
      const typescript = await composeGraph(request, ports());
      process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
      process.env.WORKSPAI_GRAPH_COMPOSE_FAULT = fault;
      const rust = await composeGraph(request, ports());
      if (previousKernel === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previousKernel;
      if (previousFault === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_FAULT;
      else process.env.WORKSPAI_GRAPH_COMPOSE_FAULT = previousFault;
      if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
      expect(request.sources[0]?.batch.facts).toHaveLength(2);
      expect(typescript.accepted).toBe(true);
      expect(rust.accepted).toBe(true);
      if (!typescript.accepted || !rust.accepted) return;
      expect(rust.value.representation).toBe('materialized');
      expect(rust.timings.ownedFallbackReason).not.toBe('');
      expect(requireMaterializedGraph(rust.value).nodes).toEqual(
        requireMaterializedGraph(typescript.value).nodes
      );
      expect(rust.value.receipt.factSetDigest).toEqual(typescript.value.receipt.factSetDigest);
      expect(rust.value.receipt.contentDigest).toEqual(typescript.value.receipt.contentDigest);
    }
  );

  it.each(['cancel-before-header', 'cancel-after-ack', 'cancel-after-finish'])(
    'does not accept a graph when native composition is cancelled at %s',
    async (fault) => {
      const request: GraphCompositionRequest = {
        ontology,
        sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      const previousKernel = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      const previousFault = process.env.WORKSPAI_GRAPH_COMPOSE_FAULT;
      process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
      process.env.WORKSPAI_GRAPH_COMPOSE_FAULT = fault;
      try {
        const result = await composeGraph(request, ports());
        expect(request.sources[0]?.batch.facts).toHaveLength(2);
        expect(result.accepted).toBe(false);
        if (result.accepted) return;
        expect(result.code).toBe('cancelled');
      } finally {
        if (previousKernel === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
        else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previousKernel;
        if (previousFault === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_FAULT;
        else process.env.WORKSPAI_GRAPH_COMPOSE_FAULT = previousFault;
      }
    }
  );
});

describe('owned composition protocol faults', () => {
  isolateNativeRoots();
  beforeAll(() => {
    const binary = fileURLToPath(
      new URL('../../../../target/release/graph-compose-graph', import.meta.url)
    );
    if (existsSync(binary)) return;
    const env = { ...process.env };
    delete env.CARGO_TARGET_DIR;
    execFileSync(
      'cargo',
      [
        'build',
        '--offline',
        '--release',
        '-p',
        'workspai-graph-engine',
        '--bin',
        'graph-compose-graph',
      ],
      {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        env,
        stdio: 'inherit',
      }
    );
  }, 180_000);

  it('pages the native snapshot without treating it as an empty graph', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previousKernel = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    const typescript = await composeGraph(request, ports());
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = '1';
    const materialized = await composeGraph(request, ports());
    delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    const native = await composeGraph(request, ports());
    if (previousKernel === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previousKernel;
    if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
    else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
    expect(typescript.accepted && materialized.accepted && native.accepted).toBe(true);
    if (!typescript.accepted || !materialized.accepted || !native.accepted) return;
    expect(native.value.representation).toBe('native-snapshot');
    if (native.value.representation !== 'native-snapshot') return;
    expect(native.value.quality.orphans).toEqual(
      requireMaterializedGraph(typescript.value).nodes.filter((node) => {
        const graph = requireMaterializedGraph(typescript.value);
        const connected = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]));
        return !connected.has(node.id);
      })
    );
    const { NativeGraphQuerySession } =
      await import('../../src/application/native-query-session.js');
    const session = await NativeGraphQuerySession.open(native.value.snapshot);
    const collected = [];
    let cursor = '';
    let exhausted = false;
    do {
      const page = await session.query('nodes', { pageSize: 1, ...(cursor ? { cursor } : {}) });
      collected.push(...page.records);
      cursor = page.cursor;
      exhausted = page.exhausted;
    } while (!exhausted);
    const edges = await session.query('edges', { pageSize: 10 });
    const decisions = await session.query('decisions', { pageSize: 10 });
    await session.query('nodes', { cursor: 'v1\tnope\tnodes\t0\t' }).then(
      () => {
        throw new Error('invalid cursor was accepted');
      },
      (error: Error) => expect(error.message).toBe('query-cursor')
    );
    await session.close();
    await expect(session.query('nodes')).rejects.toThrow('query-closed');
    await session.close();
    const graph = requireMaterializedGraph(materialized.value);
    expect(collected).toEqual(graph.nodes);
    expect(exhausted).toBe(true);
    expect(edges.records).toEqual(graph.edges);
    expect(decisions.records).toEqual(requireMaterializedDecisions(materialized.value));
    expect(native.value.receipt.factSetDigest).toEqual(typescript.value.receipt.factSetDigest);
    expect(native.value.receipt.contentDigest).toEqual(typescript.value.receipt.contentDigest);
    closeNativeGraphSnapshot(native.value.snapshot.snapshotId);
    if (materialized.value.representation === 'native-snapshot') {
      closeNativeGraphSnapshot(materialized.value.snapshot.snapshotId);
    }
  });

  it.each(['after-one-shard', 'after-finish', 'nonzero-exit', 'corrupt-response'])(
    'falls back to the original graph when the child fails at %s',
    async (mode) => {
      const directory = mkdtempSync(join(tmpdir(), 'workspai-compose-fault-'));
      const binary = join(directory, 'fault-child.mjs');
      writeFileSync(
        binary,
        `#!/usr/bin/env node
import { readSync, writeSync } from 'node:fs';
const mode = process.env.WORKSPAI_GRAPH_CHILD_FAULT;
function readExact(n) {
  const out = Buffer.alloc(n);
  let offset = 0;
  while (offset < n) {
    const got = readSync(0, out, offset, n - offset, null);
    if (got === 0) process.exit(1);
    offset += got;
  }
  return out;
}
function readFrame() {
  return readExact(readExact(4).readUInt32LE(0));
}
function ack(seq) {
  const payload = Buffer.alloc(13);
  payload[0] = 0xa1;
  payload.writeUInt32LE(seq, 1);
  payload.writeUInt32LE(0, 5);
  payload.writeUInt32LE(2, 9);
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  writeSync(1, frame);
}
let seq = 0;
if (mode === 'after-one-shard') {
  readFrame();
  ack(seq++);
  readFrame();
  ack(seq++);
  process.exit(1);
}
for (;;) {
  const frame = readFrame();
  if (frame[0] === 5) break;
  ack(seq++);
}
if (mode === 'after-finish') process.exit(1);
if (mode === 'nonzero-exit') {
  const response = Buffer.alloc(4 + 248);
  response.writeUInt32LE(248, 0);
  writeSync(1, response);
  const quality = Buffer.alloc(12);
  quality.writeUInt32LE(8, 0);
  writeSync(1, quality);
  process.exit(3);
}
const corrupt = Buffer.alloc(8);
corrupt.writeUInt32LE(4, 0);
writeSync(1, corrupt);
process.exit(0);
`
      );
      chmodSync(binary, 0o755);
      const request: GraphCompositionRequest = {
        ontology,
        sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      const previousKernel = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      const previousBinary = process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
      const previousCompat = process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
      delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      const typescript = await composeGraph(request, ports());
      process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
      process.env.WORKSPAI_GRAPH_COMPOSE_BIN = binary;
      process.env.WORKSPAI_GRAPH_CHILD_FAULT = mode;
      try {
        const executed = await composeGraph(request, ports());
        expect(request.sources[0]?.batch.facts).toHaveLength(2);
        expect(typescript.accepted && executed.accepted).toBe(true);
        if (!typescript.accepted || !executed.accepted) return;
        expect(executed.value.representation).toBe('materialized');
        expect(executed.timings.ownedFallbackReason).not.toBe('');
        expect(requireMaterializedGraph(executed.value).nodes).toEqual(
          requireMaterializedGraph(typescript.value).nodes
        );
        expect(executed.value.receipt.contentDigest).toEqual(
          typescript.value.receipt.contentDigest
        );
      } finally {
        if (previousKernel === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
        else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previousKernel;
        if (previousBinary === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
        else process.env.WORKSPAI_GRAPH_COMPOSE_BIN = previousBinary;
        if (previousCompat === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT;
        else process.env.WORKSPAI_GRAPH_COMPOSE_COMPAT = previousCompat;
        delete process.env.WORKSPAI_GRAPH_CHILD_FAULT;
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});

describe('owned composition binary digest', () => {
  it('rejects a packaged binary that has no checksum and allows a development binary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workspai-compose-bin-'));
    const copy = join(directory, 'graph-compose-graph');
    try {
      writeFileSync(copy, '#!/bin/sh\nexit 0\n');
      chmodSync(copy, 0o755);
      expect(verifyComposeBinary(copy, 'packaged')).toBe('binary-digest-missing');
      expect(verifyComposeBinary(copy, 'development')).toBeUndefined();
      expect(verifyComposeBinary(copy, 'override')).toBeUndefined();
      writeFileSync(`${copy}.sha256`, `${'ab'.repeat(32)}\n`);
      expect(verifyComposeBinary(copy, 'development')).toBe('binary-digest');
      writeFileSync(
        `${copy}.sha256`,
        `${createHash('sha256').update(readFileSync(copy)).digest('hex')}\n`
      );
      expect(verifyComposeBinary(copy, 'packaged')).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('native partition session', () => {
  isolateNativeRoots();
  beforeAll(() => {
    const binary = fileURLToPath(
      new URL('../../../../target/release/graph-compose-graph', import.meta.url)
    );
    if (existsSync(binary)) return;
    const env = { ...process.env };
    delete env.CARGO_TARGET_DIR;
    execFileSync(
      'cargo',
      [
        'build',
        '--offline',
        '--release',
        '-p',
        'workspai-graph-engine',
        '--bin',
        'graph-compose-graph',
      ],
      {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        env,
        stdio: 'inherit',
      }
    );
  }, 180_000);

  it('matches a full compose and does not recompute an identical partition', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const reference = await composeGraph(request, ports());
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    try {
      await session.upsert('provider', request.sources[0]!.batch.facts, semanticFactCanonical);
      const first = await session.commit(request);
      const second = await session.commit(request);
      expect(reference.accepted).toBe(true);
      if (!reference.accepted) return;
      expect(first.factDigest).toBe(reference.value.receipt.factSetDigest.value);
      expect(first.contentDigest).toBe(reference.value.receipt.contentDigest.value);
      expect(first.recomputed).toBe(true);
      expect(second.recomputed).toBe(false);
      expect(second.factDigest).toBe(first.factDigest);
      const changed: GraphCompositionRequest = {
        ontology,
        sources: [source([fact('fact:b', 'module:c'), fact('fact:a', 'module:a')])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      const changedReference = await composeGraph(changed, ports());
      await session.upsert('provider', changed.sources[0]!.batch.facts, semanticFactCanonical);
      const third = await session.commit(changed);
      expect(changedReference.accepted).toBe(true);
      if (!changedReference.accepted) return;
      expect(third.recomputed).toBe(true);
      expect(third.factDigest).toBe(changedReference.value.receipt.factSetDigest.value);
      expect(third.contentDigest).toBe(changedReference.value.receipt.contentDigest.value);
      closeNativeGraphSnapshot(first.snapshotId);
      closeNativeGraphSnapshot(third.snapshotId);
    } finally {
      await session.close();
    }
  });

  it('recomputes only the affected partition closure', async () => {
    const located = (id: string, target: string, file: string): GraphWorkspaceFact => ({
      ...fact(id, target),
      subject: entity(file),
      evidence: [{ ...fact(id, target).evidence[0]!, relativeLocator: file }],
    });
    const left = located('fact:left', 'module:left', 'src/left.ts');
    const right = located('fact:right', 'module:right', 'src/right.ts');
    const leftSource = source([left], 'left');
    const rightSource = source([right], 'right');
    const request: GraphCompositionRequest = {
      ontology,
      sources: [leftSource, rightSource],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    try {
      await session.upsert('left', leftSource.batch.facts, semanticFactCanonical);
      await session.upsert('right', rightSource.batch.facts, semanticFactCanonical);
      const first = await session.commit(request);
      expect(first.parsedFacts).toBe(2);
      expect(first.affectedFacts).toBe(2);
      const changedRight = located('fact:right', 'module:changed', 'src/right.ts');
      const changedRightSource = source([changedRight], 'right');
      const changed: GraphCompositionRequest = {
        ontology,
        sources: [leftSource, changedRightSource],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      const reference = await composeGraph(changed, ports());
      await session.upsert('right', changedRightSource.batch.facts, semanticFactCanonical);
      const incremental = await session.commit(changed);
      expect(reference.accepted).toBe(true);
      if (!reference.accepted) return;
      expect(incremental.parsedFacts).toBe(1);
      expect(incremental.affectedFacts).toBe(1);
      expect(incremental.factDigest).toBe(reference.value.receipt.factSetDigest.value);
      expect(incremental.contentDigest).toBe(reference.value.receipt.contentDigest.value);
      closeNativeGraphSnapshot(first.snapshotId);
      closeNativeGraphSnapshot(incremental.snapshotId);
    } finally {
      await session.close();
    }
  });

  it('reproduces the full compose after the native process is killed', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const reference = await composeGraph(request, ports());
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    try {
      await session.upsert('provider', request.sources[0]!.batch.facts, semanticFactCanonical);
      await session.restartFromDurableJournal();
      const recovered = await session.commit(request);
      expect(reference.accepted).toBe(true);
      if (!reference.accepted) return;
      expect(recovered.factDigest).toBe(reference.value.receipt.factSetDigest.value);
      expect(recovered.contentDigest).toBe(reference.value.receipt.contentDigest.value);
      await session.remove('provider');
      const emptied: GraphCompositionRequest = {
        ontology,
        sources: [source([])],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      const emptyReference = await composeGraph(emptied, ports());
      const removed = await session.commit(emptied);
      expect(emptyReference.accepted).toBe(true);
      if (!emptyReference.accepted) return;
      expect(removed.factDigest).toBe(emptyReference.value.receipt.factSetDigest.value);
      expect(removed.contentDigest).toBe(emptyReference.value.receipt.contentDigest.value);
      closeNativeGraphSnapshot(recovered.snapshotId);
      closeNativeGraphSnapshot(removed.snapshotId);
    } finally {
      await session.close();
    }
  });

  it('pages a multi-hop traversal and stops on a cycle', async () => {
    const chain = (id: string, subject: string, target: string): GraphWorkspaceFact => ({
      ...fact(id, target),
      subject: entity(subject, subject.startsWith('module:') ? 'module' : 'file'),
    });
    const request: GraphCompositionRequest = {
      ontology,
      sources: [
        source([
          chain('fact:ab', 'file:src/a.ts', 'module:b'),
          chain('fact:bc', 'module:b', 'module:c'),
          chain('fact:cycle', 'module:c', 'module:b'),
        ]),
      ],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    const native = await composeGraph(request, ports());
    if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    expect(native.accepted).toBe(true);
    if (!native.accepted || native.value.representation !== 'native-snapshot') return;
    const session = await NativeGraphQuerySession.open(native.value.snapshot);
    const targets: string[] = [];
    let cursor: string | undefined;
    let exhausted = false;
    do {
      const page = await session.query('traverse', {
        pageSize: 1,
        cursor,
        extra: cursor ? undefined : 'file:src/a.ts\n4\nimports\nout',
      });
      for (const record of page.records as { to: string }[]) targets.push(record.to);
      cursor = page.cursor;
      exhausted = page.exhausted;
    } while (!exhausted);
    await session.close();
    expect(targets).toEqual(['module:b', 'module:c', 'module:b']);
    closeNativeGraphSnapshot(native.value.snapshot.snapshotId);
  });

  it('does not cross a filtered relation while traversing', async () => {
    const mixed = {
      ...ontology,
      relations: [
        ...ontology.relations,
        {
          ...ontology.relations[0]!,
          kind: 'references',
        },
      ],
    };
    const built = source([
      { ...fact('fact:ref', 'module:b'), predicate: 'references' },
      {
        ...fact('fact:bc', 'module:c'),
        subject: entity('module:b', 'module'),
      },
      fact('fact:ad', 'module:d'),
    ]);
    const request: GraphCompositionRequest = {
      ontology: mixed,
      sources: [
        {
          ...built,
          manifest: {
            ...built.manifest,
            capabilities: {
              ...built.manifest.capabilities,
              relationKinds: ['imports', 'references'],
            },
          },
        },
      ],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    const native = await composeGraph(request, ports());
    if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    expect(native.accepted).toBe(true);
    if (!native.accepted || native.value.representation !== 'native-snapshot') return;
    const snapshotId = native.value.snapshot.snapshotId;
    const session = await NativeGraphQuerySession.open(native.value.snapshot);
    expect(() => closeNativeGraphSnapshot(snapshotId)).toThrow('snapshot-busy');
    const page = await session.query('traverse', {
      pageSize: 16,
      extra: 'file:src/a.ts\n3\nimports\nout',
    });
    await session.close();
    expect((page.records as { to: string }[]).map((record) => record.to)).toEqual(['module:d']);
    closeNativeGraphSnapshot(native.value.snapshot.snapshotId);
  });

  it('resumes a journal only after the recorded owner is gone', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:b', 'module:b'), fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const reference = await composeGraph(request, ports());
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    await session.upsert('provider', request.sources[0]!.batch.facts, semanticFactCanonical);
    const directory = await session.abandon();
    await expect(NativePartitionSession.resume(directory)).rejects.toThrow('session-live');
    const manifestPath = join(directory, 'session.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pid: number;
      startTicks: string;
    };
    manifest.pid = 999999;
    manifest.startTicks = '1';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(listRecoverableSessions()).toContain(directory);
    const resumed = await NativePartitionSession.resume(directory);
    try {
      const recovered = await resumed.commit(request);
      expect(reference.accepted).toBe(true);
      if (!reference.accepted) return;
      expect(recovered.factDigest).toBe(reference.value.receipt.factSetDigest.value);
      expect(recovered.contentDigest).toBe(reference.value.receipt.contentDigest.value);
      expect(recovered.partitions.map((item) => item.partitionId)).toEqual(['provider']);
      closeNativeGraphSnapshot(recovered.snapshotId);
    } finally {
      await resumed.close();
    }
  });

  it('restores a manifest when a claim crashed after moving it aside', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:recover', 'module:recover')], 'recover-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const reference = await composeGraph(request, ports());
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    await session.upsert(
      'recover-provider',
      request.sources[0]!.batch.facts,
      semanticFactCanonical
    );
    const directory = await session.abandon();
    const manifestPath = join(directory, 'session.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pid: number;
      startTicks: string;
    };
    manifest.pid = 999999;
    manifest.startTicks = '1';
    const previous = JSON.stringify(manifest);
    writeFileSync(manifestPath, previous);
    renameSync(manifestPath, `${manifestPath}.crash.retired`);
    writeFileSync(`${manifestPath}.crash.next`, '{"schema":"interrupted"}\n');
    const resumed = await NativePartitionSession.resume(directory);
    try {
      expect(existsSync(`${manifestPath}.crash.retired`)).toBe(false);
      expect(existsSync(`${manifestPath}.crash.next`)).toBe(false);
      const recovered = await resumed.commit(request);
      expect(reference.accepted).toBe(true);
      if (!reference.accepted) return;
      expect(recovered.factDigest).toBe(reference.value.receipt.factSetDigest.value);
      expect(recovered.contentDigest).toBe(reference.value.receipt.contentDigest.value);
      closeNativeGraphSnapshot(recovered.snapshotId);
    } finally {
      await resumed.close();
    }
  });

  it('keeps one resident session open across compositions of the same workspace', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:a', 'module:a')])],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    try {
      const first = await composeGraph(request, ports());
      const second = await composeGraph(request, ports());
      expect(residentSessionIsOpen(request)).toBe(true);
      expect(first.accepted && second.accepted).toBe(true);
      if (!first.accepted || !second.accepted) return;
      expect(second.value.receipt.factSetDigest.value).toBe(
        first.value.receipt.factSetDigest.value
      );
      expect(second.value.receipt.contentDigest.value).toBe(
        first.value.receipt.contentDigest.value
      );
      delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      const originalReference = await composeGraph(request, ports());
      process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
      expect(originalReference.accepted).toBe(true);
      if (!originalReference.accepted) return;
      expect(first.value.receipt.factSetDigest.value).toBe(
        originalReference.value.receipt.factSetDigest.value
      );
      expect(first.value.receipt.contentDigest.value).toBe(
        originalReference.value.receipt.contentDigest.value
      );
      const changed: GraphCompositionRequest = {
        ...request,
        sources: [source([fact('fact:b', 'module:b')])],
      };
      const third = await composeGraph(changed, ports());
      delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      const reference = await composeGraph(changed, ports());
      expect(third.accepted && reference.accepted).toBe(true);
      if (!third.accepted || !reference.accepted) return;
      expect(third.value.receipt.factSetDigest.value).toBe(
        reference.value.receipt.factSetDigest.value
      );
      expect(third.value.receipt.contentDigest.value).toBe(
        reference.value.receipt.contentDigest.value
      );
      expect(third.value.receipt.factSetDigest.value).not.toBe(
        first.value.receipt.factSetDigest.value
      );
      expect(residentSessionIsOpen(changed)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    }
  });

  it('keeps one snapshot time when an injected clock advances', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:clock', 'module:clock')], 'clock-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    let millis = Date.parse('2026-09-22T00:00:00.000Z');
    const runtime = { ...ports(), clock: { now: () => new Date(millis) } };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    try {
      const first = await composeGraph(request, runtime);
      const before = residentSessionObservation(request);
      millis += 60_000;
      const second = await composeGraph(request, runtime);
      const after = residentSessionObservation(request);
      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      if (!first.accepted || !second.accepted || !before || !after) return;
      expect(first.value.representation).toBe('native-snapshot');
      expect(second.value.representation).toBe('native-snapshot');
      if (
        first.value.representation !== 'native-snapshot' ||
        second.value.representation !== 'native-snapshot'
      ) {
        return;
      }
      expect(after.recomputed).toBe(false);
      expect(after.encodedPartitions).toBe(0);
      expect(after.boundaryBytes).toBe(0);
      expect(after.packedMtimeMs).toBe(before.packedMtimeMs);
      expect(after.packedIno).toBe(before.packedIno);
      expect(after.snapshotMtimeMs).toBe(before.snapshotMtimeMs);
      expect(after.snapshotIno).toBe(before.snapshotIno);
      expect(second.value.snapshot.evaluatedAt).toBe('2026-09-22T00:00:00.000Z');
      expect(second.value.snapshot.evaluatedAt).toBe(first.value.snapshot.evaluatedAt);
      expect(second.timings.semanticDigestMs).toBe(0);
      expect(second.timings.edgeProofMs).toBe(0);
      expect(second.timings.contentDigestMs).toBe(0);
      expect(second.timings.ownedRustRssBytes).toBe(0);
      expect(second.value.receipt.factSetDigest.value).toBe(
        first.value.receipt.factSetDigest.value
      );
      expect(second.value.receipt.contentDigest.value).toBe(
        first.value.receipt.contentDigest.value
      );
      const query = await NativeGraphQuerySession.open(second.value.snapshot);
      try {
        const page = await query.query('edges', { pageSize: 8, maxBytes: 65_536 });
        const edge = page.records[0] as { proof?: { evaluatedAt?: string } };
        expect(edge?.proof?.evaluatedAt).toBe(first.value.snapshot.evaluatedAt);
      } finally {
        await query.close();
      }
    } finally {
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    }
  });

  it('encodes again when any semantic fact field changes', async () => {
    const provider = 'mutation-provider';
    const mutations: readonly [string, (item: GraphWorkspaceFact) => GraphWorkspaceFact][] = [
      [
        'evidence',
        (item) => ({
          ...item,
          evidence: item.evidence.map((evidence) => ({
            ...evidence,
            relativeLocator: 'src/changed.ts',
          })),
        }),
      ],
      ['confidence', (item) => ({ ...item, confidence: 0.25 })],
      ['authority', (item) => ({ ...item, authority: 'verified' })],
      ['derivation', (item) => ({ ...item, derivation: 'computed' })],
      [
        'scope',
        (item) => {
          const next = { kind: 'project' as const, projectIds: ['other'] as [string] };
          return {
            ...item,
            scope: next,
            subject: { ...item.subject, scope: next },
            object: 'scope' in item.object ? { ...item.object, scope: next } : item.object,
          };
        },
      ],
      [
        'validUntil',
        (item) => ({
          ...item,
          freshness: { status: 'current', validUntil: '2026-10-01T00:00:00.000Z' },
        }),
      ],
      [
        'inputDigest',
        (item) => ({ ...item, inputDigest: { algorithm: 'sha256', value: 'cd'.repeat(32) } }),
      ],
      ['extensions', (item) => ({ ...item, extensions: { note: 'changed' } })],
      ['observedAt', (item) => ({ ...item, observedAt: '2026-09-09T12:00:00.000Z' })],
      ['factType', (item) => ({ ...item, factType: 'source.reference' })],
      [
        'unknownZones',
        (item) => ({
          ...item,
          unknownZones: [{ code: 'GRAPH_UNKNOWN', scope: 'src/a.ts', reason: 'changed' }],
        }),
      ],
      [
        'truthLifecycle',
        (item) => ({ ...item, truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] } }),
      ],
    ];
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    try {
      let current = fact('fact:mutation', 'module:mutation');
      const compose = (item: GraphWorkspaceFact) =>
        composeGraph(
          {
            ontology,
            sources: [source([item], provider)],
            policy: GRAPH_STANDARD_COMPOSITION_POLICY,
          },
          ports()
        );
      const requestFor = (item: GraphWorkspaceFact): GraphCompositionRequest => ({
        ontology,
        sources: [source([item], provider)],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      });
      const first = await compose(current);
      const repeat = await compose(current);
      expect(first.accepted && repeat.accepted).toBe(true);
      expect(residentSessionObservation(requestFor(current))?.encodedPartitions).toBe(0);
      for (const [name, mutate] of mutations) {
        current = mutate(current);
        const request = requestFor(current);
        const widened =
          current.factType === 'source.import'
            ? request
            : {
                ...request,
                sources: request.sources.map((entry) => ({
                  ...entry,
                  manifest: {
                    ...entry.manifest,
                    capabilities: {
                      ...entry.manifest.capabilities,
                      factFamilies: [current.factType],
                    },
                  },
                })),
              };
        const changed = await composeGraph(widened, ports());
        const observation = residentSessionObservation(widened);
        if (!changed.accepted) throw new Error(`${name}:${JSON.stringify(changed.issues)}`);
        expect(changed.accepted, name).toBe(true);
        expect(observation?.encodedPartitions).toBe(1);
        expect(observation?.boundaryBytes).toBeGreaterThan(0);
      }
      const built = source([current], provider);
      const previousRequest = requestFor(current);
      const provenanceRequest: GraphCompositionRequest = {
        ontology,
        sources: [
          {
            ...built,
            manifest: {
              ...built.manifest,
              version: '9',
              capabilities: {
                ...built.manifest.capabilities,
                factFamilies: [current.factType],
              },
            },
            batch: {
              ...built.batch,
              provider: { id: provider, version: '9' },
              facts: built.batch.facts.map((item) => ({
                ...item,
                provenance: { id: provider, version: '9' },
              })),
              processing: built.batch.processing.map((record) => ({
                ...record,
                provider: { id: provider, version: '9' },
              })),
            },
          },
        ],
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      };
      expect(residentSessionKey(provenanceRequest)).not.toBe(residentSessionKey(previousRequest));
      const provenance = await composeGraph(provenanceRequest, ports());
      expect(provenance.accepted).toBe(true);
      expect(residentSessionObservation(provenanceRequest)?.encodedPartitions).toBe(1);
      expect(residentSessionObservation(provenanceRequest)?.boundaryBytes).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    }
  });

  it('restores the previous manifest when resume fails before replay', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:claim', 'module:claim')], 'claim-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    await session.upsert('claim-provider', request.sources[0]!.batch.facts, semanticFactCanonical);
    const directory = await session.abandon();
    const manifestPath = join(directory, 'session.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pid: number;
      startTicks: string;
    };
    manifest.pid = 999999;
    manifest.startTicks = '1';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    rmSync(join(directory, 'journal.rjnl'));
    await expect(NativePartitionSession.resume(directory)).rejects.toThrow();
    const restored = JSON.parse(readFileSync(manifestPath, 'utf8')) as { pid: number };
    expect(restored.pid).toBe(999999);
    rmSync(directory, { recursive: true, force: true });
  });

  it('reuses a journaled fingerprint after the owner process is gone', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:fp', 'module:fp')], 'fingerprint-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    const partitionId = 'fingerprint-provider@1:src/fingerprint-provider.ts';
    await session.upsertIfChanged(partitionId, request.sources[0]!, semanticFactCanonical);
    await session.commit(request, '2026-09-22T00:00:00.000Z');
    const directory = await session.abandon();
    const manifestPath = join(directory, 'session.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pid: number;
      startTicks: string;
    };
    manifest.pid = 999999;
    manifest.startTicks = '1';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const resumed = await NativePartitionSession.resume(directory);
    try {
      const bytes = await resumed.upsertIfChanged(
        partitionId,
        request.sources[0]!,
        semanticFactCanonical
      );
      expect(bytes).toBe(0);
      closeNativeGraphSnapshot((await resumed.commit(request)).snapshotId);
    } finally {
      await resumed.close();
    }
  });

  it('separates sessions when ontology semantics or repository path identity differ', () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:key', 'module:key')], 'key-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
      repositoryIdentity: canonicalRepositoryIdentity({ kind: 'project' }, '/tmp/graph-root'),
    };
    const symmetric: GraphCompositionRequest = {
      ...request,
      ontology: {
        ...ontology,
        relations: ontology.relations.map((relation) => ({ ...relation, symmetric: true })),
      },
    };
    expect(residentSessionKey(request)).not.toBe(residentSessionKey(symmetric));
    const root = mkdtempSync(join(tmpdir(), 'graph-repo-'));
    const alias = join(tmpdir(), `graph-link-${process.pid}-${Date.now()}`);
    symlinkSync(root, alias);
    try {
      expect(canonicalRepositoryIdentity({ kind: 'project' }, alias)).toBe(
        canonicalRepositoryIdentity({ kind: 'project' }, root)
      );
    } finally {
      rmSync(alias, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets only one resumer claim a dead session', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:claim', 'module:claim')], 'claim-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const session = await NativePartitionSession.open(request, '2026-09-22T00:00:00.000Z');
    await session.upsert('claim', request.sources[0]!.batch.facts, semanticFactCanonical);
    const directory = await session.abandon();
    const manifestPath = join(directory, 'session.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      pid: number;
      startTicks: string;
    };
    manifest.pid = 999999;
    manifest.startTicks = '1';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const results = await Promise.allSettled([
      NativePartitionSession.resume(directory),
      NativePartitionSession.resume(directory),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: 'session-live',
    });
    const resumed = (fulfilled[0] as PromiseFulfilledResult<NativePartitionSession>).value;
    await resumed.close();
  });

  it('deletes only dead journals beyond the retention cap', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspai-journal-quota-'));
    const previous = process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = root;
    try {
      for (let index = 0; index < 9; index += 1) {
        const directory = join(root, `dead${index}`);
        mkdirSync(directory);
        writeFileSync(
          join(directory, 'session.json'),
          JSON.stringify({
            schema: 'workspai.graph.replay-session.v1',
            sessionId: 'ab'.repeat(16),
            pid: 999999,
            startedAt: index,
            startTicks: '1',
            nonce: 'n',
            status: 'open',
          })
        );
      }
      const live = join(root, 'live-owner');
      mkdirSync(live);
      writeFileSync(
        join(live, 'session.json'),
        JSON.stringify({
          schema: 'workspai.graph.replay-session.v1',
          sessionId: 'cd'.repeat(16),
          pid: process.pid,
          startedAt: 0,
          startTicks: '',
          nonce: 'live',
          status: 'open',
        })
      );
      expect(reapAbandonedJournals(root)).toBe(1);
      expect(existsSync(join(root, 'dead0'))).toBe(false);
      expect(existsSync(join(root, 'dead8'))).toBe(true);
      expect(existsSync(live)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
      else process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('encodes a clean journal and reuses only that same pre-populated journal', async () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:journal', 'module:journal')], 'journal-isolation')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    const populatedJournal = process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    const populatedSnapshot = process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    const cleanJournal = mkdtempSync(join(tmpdir(), 'workspai-journal-clean-'));
    const cleanSnapshot = mkdtempSync(join(tmpdir(), 'workspai-snapshot-clean-'));
    try {
      const first = await composeGraph(request, ports());
      expect(first.accepted).toBe(true);
      expect(residentSessionObservation(request)?.encodedPartitions).toBe(1);
      await disposeResidentSessions();
      const resumed = await composeGraph(request, ports());
      expect(resumed.accepted).toBe(true);
      expect(residentSessionObservation(request)?.encodedPartitions).toBe(0);
      await disposeResidentSessions();
      process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = cleanJournal;
      process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = cleanSnapshot;
      const clean = await composeGraph(request, ports());
      expect(clean.accepted).toBe(true);
      expect(residentSessionObservation(request)?.encodedPartitions).toBe(1);
    } finally {
      await disposeResidentSessions();
      if (populatedJournal === undefined) delete process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
      else process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = populatedJournal;
      if (populatedSnapshot === undefined) delete process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
      else process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = populatedSnapshot;
      rmSync(cleanJournal, { recursive: true, force: true });
      rmSync(cleanSnapshot, { recursive: true, force: true });
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    }
  });

  it('preserves a build-clock observation and encodes only the changed file partition', async () => {
    const firstClock = '2026-09-22T00:00:00.000Z';
    const secondClock = '2026-09-22T00:01:00.000Z';
    const changed = 'ef'.repeat(32);
    const build = (clock: string, secondDigest = 'cd'.repeat(32)): GraphCompositionRequest => {
      const base = source(
        [fact('fact:file-a', 'module:left'), fact('fact:file-b', 'module:right')],
        'file-clock'
      );
      const inputA = { locator: 'src/a.ts', digest };
      const inputB = {
        locator: 'src/b.ts',
        digest: { algorithm: 'sha256' as const, value: secondDigest },
      };
      const [left, right] = base.batch.facts;
      if (!left || !right) throw new Error('fixture facts missing');
      const leftEvidence = left.evidence[0];
      const rightEvidence = right.evidence[0];
      const processing = base.batch.processing[0];
      if (!leftEvidence || !rightEvidence || !processing)
        throw new Error('fixture evidence missing');
      return {
        ontology,
        policy: GRAPH_STANDARD_COMPOSITION_POLICY,
        sources: [
          {
            ...base,
            batch: {
              ...base.batch,
              inputs: [inputA, inputB],
              facts: [
                {
                  ...left,
                  observedAt: clock,
                  partitionOwner: {
                    locator: 'src/a.ts',
                    observationOrigin: 'build-clock' as const,
                  },
                  inputDigest: inputA.digest,
                  evidence: [
                    { ...leftEvidence, relativeLocator: 'src/a.ts', digest: inputA.digest },
                  ],
                },
                {
                  ...right,
                  observedAt: clock,
                  partitionOwner: {
                    locator: 'src/b.ts',
                    observationOrigin: 'build-clock' as const,
                  },
                  inputDigest: inputB.digest,
                  evidence: [
                    {
                      ...rightEvidence,
                      id: 'evidence:fact:file-b',
                      relativeLocator: 'src/b.ts',
                      digest: inputB.digest,
                    },
                  ],
                },
              ],
              processing: [
                { ...processing, input: inputA },
                { ...processing, input: inputB, outputDigest: inputB.digest },
              ],
            },
          },
        ],
      };
    };
    const previous = process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
    process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = '1';
    try {
      const firstRequest = build(firstClock);
      const first = await composeGraph(firstRequest, ports(firstClock));
      const opened = residentSessionObservation(firstRequest);
      expect(first.accepted).toBe(true);
      expect(opened?.encodedPartitionIds).toEqual([
        'file-clock@1:src/a.ts',
        'file-clock@1:src/b.ts',
        'file-clock@1:synthetic:receipt',
      ]);
      const secondRequest = build(secondClock);
      const second = await composeGraph(secondRequest, ports(secondClock));
      const warmed = residentSessionObservation(secondRequest);
      expect(second.accepted).toBe(true);
      expect(warmed?.encodedPartitions).toBe(0);
      expect(warmed?.boundaryBytes).toBe(0);
      expect(warmed?.recomputed).toBe(false);
      expect(warmed?.packedIno).toBe(opened?.packedIno);
      expect(warmed?.snapshotIno).toBe(opened?.snapshotIno);
      if (!first.accepted || !second.accepted) return;
      expect(second.value.receipt.contentDigest.value).toBe(
        first.value.receipt.contentDigest.value
      );
      if (
        first.value.representation !== 'native-snapshot' ||
        second.value.representation !== 'native-snapshot'
      ) {
        throw new Error('expected a native snapshot');
      }
      expect(second.value.snapshot.evaluatedAt).toBe(first.value.snapshot.evaluatedAt);
      const thirdRequest = build(secondClock, changed);
      const third = await composeGraph(thirdRequest, ports(secondClock));
      const edited = residentSessionObservation(thirdRequest);
      expect(third.accepted).toBe(true);
      expect(edited?.encodedPartitionIds).toEqual(['file-clock@1:src/b.ts']);
      expect(edited?.boundaryBytes).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL;
      else process.env.WORKSPAI_GRAPH_COMPOSE_KERNEL = previous;
    }
  });

  it('keeps identical content on the locators that own the facts', () => {
    const same = { algorithm: 'sha256' as const, value: 'ab'.repeat(32) };
    const owned = (locator: string, id: string): GraphWorkspaceFact => ({
      ...fact(id, `module:${locator}`),
      observedAt: '2026-09-22T00:00:00.000Z',
      inputDigest: same,
      partitionOwner: { locator, observationOrigin: 'source' },
      evidence: [
        {
          id: `evidence:${id}`,
          sourceKind: 'source-file',
          relativeLocator: locator,
          digest: same,
        },
      ],
    });
    const base = source([owned('src/a.ts', 'fact:a'), owned('src/b.ts', 'fact:b')], 'same-bytes');
    const record = base.batch.processing[0];
    if (!record) throw new Error('fixture processing missing');
    const batch = {
      ...base.batch,
      inputs: [
        { locator: 'src/b.ts', digest: same },
        { locator: 'src/a.ts', digest: same },
      ],
      facts: [owned('src/a.ts', 'fact:a'), owned('src/b.ts', 'fact:b')],
      processing: [
        { ...record, input: { locator: 'src/a.ts', digest: same } },
        { ...record, input: { locator: 'src/b.ts', digest: same } },
      ],
      unknownZones: [
        { code: 'GRAPH_UNKNOWN', scope: 'src/a.ts', reason: 'owned by a' },
        { code: 'GRAPH_UNKNOWN', scope: 'other', reason: 'receipt' },
      ],
    };
    const projected = projectExplicitPartitions({ ...base, batch });
    const reversed = projectExplicitPartitions({
      ...base,
      batch: { ...batch, inputs: [...batch.inputs].reverse() },
    });
    expect(projected.map((slice) => slice.batch.facts.map((item) => item.factId))).toEqual([
      ['fact:a'],
      ['fact:b'],
      [],
    ]);
    expect(reversed.map((slice) => slice.batch.inputs[0]?.locator)).toEqual(
      projected.map((slice) => slice.batch.inputs[0]?.locator)
    );
    expect(projected[0]?.batch.unknownZones.map((zone) => zone.scope)).toEqual(['src/a.ts']);
    expect(projected[2]?.batch.coverage).toEqual(batch.coverage);
    expect(projected[2]?.batch.unknownZones.map((zone) => zone.reason)).toEqual(['receipt']);
    expect(projected[0]?.partitionOwnership).toEqual([
      {
        locator: 'src/a.ts',
        facts: [{ factId: 'fact:a', observationOrigin: 'source' }],
      },
    ]);
    expect(projected[0]?.batch.facts[0]?.partitionOwner).toBeUndefined();
    expect(() =>
      projectExplicitPartitions({
        ...base,
        batch: {
          ...batch,
          facts: [owned('src/a.ts', 'fact:a'), owned('src/missing.ts', 'fact:c')],
        },
      })
    ).toThrow('partition-ownership');
    expect(() =>
      projectExplicitPartitions({
        ...base,
        batch: {
          ...batch,
          facts: [owned('src/a.ts', 'fact:a'), fact('fact:bare', 'module:bare')],
        },
      })
    ).toThrow('partition-ownership');
    expect(() =>
      projectExplicitPartitions({
        ...base,
        batch: {
          ...batch,
          inputs: [batch.inputs[0]!, batch.inputs[0]!],
        },
      })
    ).toThrow('partition-ownership');
    expect(() =>
      projectExplicitPartitions({
        ...base,
        partitionOwnership: [
          { locator: 'src/a.ts', facts: [{ factId: 'fact:a', observationOrigin: 'source' }] },
          { locator: 'src/a.ts', facts: [{ factId: 'fact:b', observationOrigin: 'source' }] },
        ],
        batch: { ...batch, facts: [fact('fact:a', 'module:a'), fact('fact:b', 'module:b')] },
      })
    ).toThrow('partition-ownership');
    expect(() =>
      projectExplicitPartitions({
        ...base,
        batch: {
          ...batch,
          inputs: [{ locator: 'synthetic:receipt', digest: same }],
        },
      })
    ).toThrow('partition-ownership');
  });

  it('binds session identity to the journal, snapshot, and binary', () => {
    const request: GraphCompositionRequest = {
      ontology,
      sources: [source([fact('fact:identity', 'module:identity')], 'identity-provider')],
      policy: GRAPH_STANDARD_COMPOSITION_POLICY,
    };
    const journal = process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    const snapshot = process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    const binary = process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
    const base = residentSessionKey(request);
    process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = `${journal ?? tmpdir()}-other-journal`;
    const journalKey = residentSessionKey(request);
    if (journal === undefined) delete process.env.WORKSPAI_GRAPH_JOURNAL_ROOT;
    else process.env.WORKSPAI_GRAPH_JOURNAL_ROOT = journal;
    process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = `${snapshot ?? tmpdir()}-other-snapshot`;
    const snapshotKey = residentSessionKey(request);
    if (snapshot === undefined) delete process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT;
    else process.env.WORKSPAI_GRAPH_SNAPSHOT_ROOT = snapshot;
    const stamped = join(snapshot ?? tmpdir(), 'binary-identity');
    writeFileSync(stamped, 'aaaa');
    process.env.WORKSPAI_GRAPH_COMPOSE_BIN = stamped;
    const binaryKey = residentSessionKey(request);
    const fixedTime = new Date('2026-09-22T00:00:00.000Z');
    utimesSync(stamped, fixedTime, fixedTime);
    const sameMetadataBefore = residentSessionKey(request);
    writeFileSync(stamped, 'bbbb');
    utimesSync(stamped, fixedTime, fixedTime);
    const sameMetadataAfter = residentSessionKey(request);
    if (binary === undefined) delete process.env.WORKSPAI_GRAPH_COMPOSE_BIN;
    else process.env.WORKSPAI_GRAPH_COMPOSE_BIN = binary;
    rmSync(stamped, { force: true });
    expect(journalKey).not.toBe(base);
    expect(snapshotKey).not.toBe(base);
    expect(binaryKey).not.toBe(base);
    expect(sameMetadataAfter).not.toBe(sameMetadataBefore);
    expect(nativeExecutionIdentity()).toContain('workspai.graph.compose-build.v1');
    expect(nativeExecutionIdentity()).not.toContain('embedded-identity-missing');
    expect(residentSessionKey(request)).toBe(base);
    expect(
      residentSessionKey({
        ...request,
        policy: { ...request.policy, minimumConfidence: 0.25 },
      })
    ).not.toBe(base);
  });
});
