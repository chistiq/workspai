import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = path.resolve(packageRoot, '../shared');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-graph-pack-'));
const consumerRoot = path.join(temporaryRoot, 'consumer');
const npmCache = path.join(temporaryRoot, 'npm-cache');
const toolRequire = createRequire(path.join(packageRoot, 'package.json'));
const typescriptCli = toolRequire.resolve('typescript/bin/tsc');
const {
  GRAPH_CLI_RESULT_SCHEMA_VERSION,
  GRAPH_INCIDENT_CLASSES,
  GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY,
  GRAPH_ROLLBACK_PROCEDURE,
  GRAPH_STANDALONE_PACKED_JOBS,
} = await import(pathToFileURL(path.join(packageRoot, 'dist/contracts/index.js')).href);

if (GRAPH_PACKED_ARTIFACT_SECURITY_BOUNDARY.signedAttestation !== 'not-generated') {
  throw new Error('Packed artifact security boundary cannot claim attestation');
}
if (
  GRAPH_ROLLBACK_PROCEDURE.status !== 'not-proven' ||
  GRAPH_ROLLBACK_PROCEDURE.sourceRewrite !== 'prohibited'
) {
  throw new Error('Packed artifact cannot claim a proven rollback procedure');
}
if (!GRAPH_INCIDENT_CLASSES.includes('secret-or-path-leakage')) {
  throw new Error('Incident classes omitted secret or path leakage');
}

function runNpm(args, cwd) {
  // Bypass the Windows .cmd shim when npm exposes its JavaScript entrypoint.
  // Direct shim execution through spawnSync can fail with EINVAL on Node 20.
  const npmExecPath = process.env.npm_execpath;
  const useNpmEntrypoint = Boolean(npmExecPath && fs.existsSync(npmExecPath));
  const command = useNpmEntrypoint
    ? process.execPath
    : process.platform === 'win32'
      ? 'npm.cmd'
      : 'npm';
  const commandArgs = useNpmEntrypoint ? [npmExecPath, ...args] : args;
  const environment = { ...process.env, npm_config_cache: npmCache };
  for (const key of [
    'npm_config_workspace',
    'npm_config_workspaces',
    'npm_config_include_workspace_root',
    'npm_config_local_prefix',
    'npm_config_loglevel',
  ]) {
    delete environment[key];
  }
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    env: environment,
    shell: process.platform === 'win32' && !useNpmEntrypoint,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    );
  }
  return result.stdout;
}

function packedJson(installedRoot, relative) {
  return JSON.parse(fs.readFileSync(path.join(installedRoot, relative), 'utf8'));
}

function mutate(document, mutation) {
  const segments = mutation.pointer.split('/').slice(1);
  let cursor = document;
  for (const segment of segments.slice(0, -1)) {
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
  }
  const key = segments.at(-1);
  if (mutation.remove) {
    if (Array.isArray(cursor)) cursor.splice(Number(key), 1);
    else delete cursor[key];
    return;
  }
  if (Array.isArray(cursor)) cursor[Number(key)] = mutation.value;
  else cursor[key] = mutation.value;
}

function packedFiles(installedRoot) {
  const files = [];
  const pending = [installedRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) {
        files.push(path.relative(installedRoot, absolutePath).split(path.sep).join('/'));
      }
    }
  }
  return files;
}

try {
  for (const sourceRoot of [sharedRoot, packageRoot]) {
    runNpm(
      ['pack', '--loglevel=notice', '--ignore-scripts', '--pack-destination', temporaryRoot],
      sourceRoot
    );
  }
  const tarballs = fs
    .readdirSync(temporaryRoot)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => path.join(temporaryRoot, entry));
  const sharedTarball = tarballs.find((entry) => path.basename(entry).includes('workspai-shared'));
  const graphTarball = tarballs.find((entry) => path.basename(entry).includes('workspai-graph'));
  if (!sharedTarball || !graphTarball || tarballs.length !== 2) {
    throw new Error(`expected one Shared and one Graph tarball; found ${tarballs.length}`);
  }
  const compressedBytes = fs.statSync(graphTarball).size;
  const compressedBudgetBytes = 256 * 1024;
  if (compressedBytes > compressedBudgetBytes) {
    throw new Error(
      `packed Graph package is ${compressedBytes} compressed bytes; budget is ${compressedBudgetBytes}`
    );
  }

  fs.mkdirSync(consumerRoot, { recursive: true });
  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    'utf8'
  );
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      sharedTarball,
    ],
    consumerRoot
  );
  runNpm(
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      graphTarball,
    ],
    consumerRoot
  );

  const installedRoot = path.join(consumerRoot, 'node_modules/@workspai/graph');
  const packedProduct = await import(
    pathToFileURL(path.join(installedRoot, 'dist/contracts/index.js')).href
  );
  if (
    JSON.stringify(GRAPH_STANDALONE_PACKED_JOBS.map((job) => job.id)) !==
    JSON.stringify(packedProduct.GRAPH_STANDALONE_PACKED_JOBS.map((job) => job.id))
  ) {
    throw new Error('installed packed job table drifted from the workspace contract');
  }
  if (
    packedProduct.GRAPH_ROLLBACK_PROCEDURE.status !== 'not-proven' ||
    packedProduct.GRAPH_ROLLBACK_PROCEDURE.sourceRewrite !== 'prohibited' ||
    packedProduct.GRAPH_SBOM_SPEC.provenance !== 'unattested' ||
    packedProduct.GRAPH_STANDALONE_SUPPORT_MATRIX.standaloneStable !== false ||
    packedProduct.GRAPH_STANDALONE_SUPPORT_MATRIX.centralCliRuntime !== 'prohibited'
  ) {
    throw new Error('installed Graph product claimed stability, attestation or proven rollback');
  }
  if (
    JSON.stringify([...packedProduct.GRAPH_INCIDENT_CLASSES]) !==
    JSON.stringify([...GRAPH_INCIDENT_CLASSES])
  ) {
    throw new Error('installed incident classes drifted');
  }
  for (const preset of Object.keys(packedProduct.GRAPH_QUERY_PRESETS)) {
    if (!packedProduct.GRAPH_STANDALONE_PACKED_JOBS.some((job) => job.args.includes(preset))) {
      throw new Error(`installed packed jobs omit query preset ${preset}`);
    }
  }

  fs.writeFileSync(
    path.join(consumerRoot, 'consumer.ts'),
    `
      import type { GraphProviderManifest, WorkspaiGraphProviderManifestCandidate } from '@workspai/graph/contracts';
      import { GRAPH_PROVIDER_MANIFEST_CONTRACT, GRAPH_IDENTITY_SCHEME } from '@workspai/graph/contracts';
      import { validateGraphProviderManifest } from '@workspai/graph/conformance';
      import { buildReviewContextSlice, composeGraph, GRAPH_STANDARD_COMPOSITION_POLICY, GRAPH_STANDALONE_SUPPORT_MATRIX, GRAPH_CLI_EXIT_CODES, projectRepositoryPreview, queryGraph } from '@workspai/graph';
      import { GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES, scoreGraphRetrievalBenchmark } from '@workspai/graph/testing';
      import type { GraphExecutionPorts } from '@workspai/graph';
      const wire: WorkspaiGraphProviderManifestCandidate = {
        contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
        id: 'packed.fixture', version: '1', displayName: 'Packed fixture', determinism: 'deterministic',
        capabilities: { entityKinds: ['file'], relationKinds: ['contains'], relationSemantics: ['structural'], factFamilies: ['source.contains'], allowedClaims: ['observed'] },
        permissions: { filesystem: 'read', network: 'deny', process: 'deny', credentials: 'deny' },
        limits: { maxDurationMs: 1000, maxFacts: 10 }, contractVersions: ['0.1.0-candidate'],
        supportedInputs: ['source-file'], incremental: 'input', identitySchemes: [GRAPH_IDENTITY_SCHEME],
      };
      const semantic: GraphProviderManifest = wire;
      if (!validateGraphProviderManifest(semantic).accepted) throw new Error('invalid fixture');
      const compose: typeof composeGraph = composeGraph;
      const ports = {} as GraphExecutionPorts;
      void compose;
      void ports;
      void GRAPH_STANDARD_COMPOSITION_POLICY;
      void GRAPH_STANDALONE_SUPPORT_MATRIX;
      void GRAPH_CLI_EXIT_CODES;
      void queryGraph;
      void projectRepositoryPreview;
      void buildReviewContextSlice;
      void GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES;
      void scoreGraphRetrievalBenchmark;
    `,
    'utf8'
  );
  const typecheck = spawnSync(
    process.execPath,
    [
      typescriptCli,
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      path.join(consumerRoot, 'consumer.ts'),
    ],
    { cwd: consumerRoot, encoding: 'utf8' }
  );
  if (typecheck.error || typecheck.status !== 0) {
    throw new Error(
      `packed Graph TypeScript consumer failed\n${typecheck.stdout ?? ''}\n${typecheck.stderr ?? ''}`
    );
  }

  const smoke = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import * as graph from '@workspai/graph';
        import * as contracts from '@workspai/graph/contracts';
        import * as providers from '@workspai/graph/providers';
        import * as conformance from '@workspai/graph/conformance';
        import * as testing from '@workspai/graph/testing';
      import { buildNodeRepoGraph, createNodeGraphReferenceWorkerPool } from '@workspai/graph/adapters/node';
        import { validateWisCoreResultEnvelope } from '@workspai/shared/validation';
        if (!graph.GRAPH_PACKAGE_METADATA) process.exit(10);
        if (typeof graph.composeGraph !== 'function') process.exit(25);
        if (typeof graph.queryGraph !== 'function') process.exit(27);
        if (!contracts.GRAPH_QUERY_CONTRACT) process.exit(28);
        if (typeof conformance.validateGraphQuery !== 'function') process.exit(29);
        if (graph.GRAPH_STANDARD_COMPOSITION_POLICY.version !== '0.1.0-candidate') process.exit(26);
        if (graph.GRAPH_STANDALONE_SUPPORT_MATRIX.standaloneStable !== false) process.exit(31);
        if (graph.GRAPH_STANDALONE_SUPPORT_MATRIX.centralCliRuntime !== 'prohibited') process.exit(32);
        if (graph.GRAPH_PACKAGE_METADATA.plannedCapabilities.includes('incremental')) process.exit(33);
        if (graph.GRAPH_PACKAGE_METADATA.plannedCapabilities.includes('profile-driven-projection')) process.exit(34);
        if (!graph.GRAPH_CLI_EXIT_CODES || graph.GRAPH_CLI_EXIT_CODES.rejected !== 3) process.exit(35);
        if (!contracts.GRAPH_PACKAGE_METADATA) process.exit(11);
        if (!providers.GRAPH_PROVIDER_MANIFEST_CONTRACT) process.exit(12);
        if (!conformance.GRAPH_CONFORMANCE_PROFILE) process.exit(13);
        if (!testing.GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES) process.exit(14);
        if (typeof testing.scoreGraphRetrievalBenchmark !== 'function') process.exit(38);
        const status = graph.getGraphPackageStatus({ kind: 'project', projectIds: ['project:packed-consumer'] });
        if (!validateWisCoreResultEnvelope(status).valid) process.exit(15);
        if ((status.compatibility?.unsupportedCapabilities ?? []).includes('query')) process.exit(36);
        if ((status.compatibility?.unsupportedCapabilities ?? []).includes('incremental')) process.exit(37);
        if (!Object.isFrozen(providers.GRAPH_PROVIDER_MANIFEST_CONTRACT)) process.exit(16);
        const adoption = conformance.assessGraphSharedEnvelope(status);
        if (!adoption.accepted || adoption.status !== 'exact') process.exit(17);
        if (conformance.GRAPH_SHARED_ADOPTION_PROFILE.cliBridge !== 'prohibited') process.exit(18);
        if (adoption.sharedContract.digest.length !== 71) process.exit(19);
        const manifest = providers.defineGraphProviderManifest({
          contract: contracts.GRAPH_PROVIDER_MANIFEST_CONTRACT,
          id: 'packed.fixture', version: '1', displayName: 'Packed fixture',
          determinism: 'deterministic',
          capabilities: { entityKinds: ['file'], relationKinds: ['contains'], relationSemantics: ['structural'], factFamilies: ['source.contains'], allowedClaims: ['observed'] },
          permissions: { filesystem: 'read', network: 'deny', process: 'deny', credentials: 'deny' },
          limits: { maxDurationMs: 1000, maxFacts: 10 },
          contractVersions: ['0.1.0-candidate'], supportedInputs: ['source-file'], incremental: 'input',
          identitySchemes: [contracts.GRAPH_IDENTITY_SCHEME],
        });
        if (!conformance.validateGraphProviderManifest(manifest).accepted) process.exit(20);
        const detection = {
          contract: contracts.GRAPH_PROVIDER_DETECTION_CONTRACT,
          provider: { id: manifest.id, version: manifest.version },
          status: 'applicable', matchedInputs: ['source-file'], missingPermissions: [], diagnostics: [],
        };
        if (!conformance.validateGraphProviderDetectionResult(detection, manifest).accepted) process.exit(23);
        const standardProviders = providers.createStandardRepositoryProviders();
        if (standardProviders.length !== 7 || !Object.isFrozen(standardProviders)) process.exit(30);
        const canonical = conformance.canonicalizeGraphValue({ z: 1, a: 2 });
        if (!canonical.accepted || canonical.value !== '{"a":2,"z":1}') process.exit(21);
        const digest = conformance.digestCanonicalGraphValue({ z: 1, a: 2 });
        if (!digest.accepted || digest.value.algorithm !== 'sha256') process.exit(24);
        if (conformance.validateGraphQueryCacheKey({ contract: contracts.GRAPH_QUERY_CACHE_CONTRACT }).accepted) process.exit(22);
        const worker = createNodeGraphReferenceWorkerPool();
        const workerResult = await worker.execute({
          task: graph.GRAPH_REFERENCE_COMPOSITION_TASK,
          input: {
            ontology: {
              contract: contracts.GRAPH_ONTOLOGY_PROFILE_CONTRACT,
              id: 'workspai.graph.ontology.packed-worker', version: '1', entities: [], relations: [],
            },
            sources: [],
            policy: graph.GRAPH_STANDARD_COMPOSITION_POLICY,
          },
          timeoutMs: 30000,
          maxOutputBytes: graph.GRAPH_STANDARD_COMPOSITION_POLICY.maxWorkerOutputBytes,
        });
        if (workerResult.status !== 'complete') {
          throw new Error('Packed Graph worker failed: ' + JSON.stringify(workerResult));
        }
        const preview = await buildNodeRepoGraph({ root: process.cwd() });
        if (!['complete', 'partial'].includes(preview.status) || !preview.graph || preview.metrics.inputFiles < 2) {
          throw new Error('Packed repository preview failed: ' + JSON.stringify(preview));
        }
        const view = graph.projectRepositoryPreview(preview.graph, preview.quality.graph, 'evidence', { maxNodes: 100, maxEdges: 100, maxEvidence: 100 });
        if (!view.accepted || view.value.sourceGeneration.id !== preview.graph.generation.reference.id) {
          throw new Error('Packed repository preview view lost canonical generation identity');
        }
        const { createHash } = await import('node:crypto');
        const digestPort = {
          algorithm: 'sha256',
          digest: async (input) => createHash('sha256').update(input).digest('hex'),
        };
        const liveQuery = await graph.queryGraph(
          preview.graph,
          { contract: contracts.GRAPH_QUERY_CONTRACT, kind: 'entry-points' },
          digestPort
        );
        if (!liveQuery.accepted || 'cache' in liveQuery.value) process.exit(41);
        const aliased = {
          ...preview.graph,
          generation: {
            ...preview.graph.generation,
            reference: { ...preview.graph.generation.reference, id: 'latest' },
          },
        };
        try {
          await graph.createQueryCacheKey({
            graph: aliased,
            query: graph.normalizeGraphQuery({
              contract: contracts.GRAPH_QUERY_CONTRACT,
              kind: 'dependencies',
              subject: preview.graph.nodes[0]?.id,
              scope: preview.graph.nodes[0]?.scope,
            }),
            digest: digestPort,
            policy: {
              redactionPolicyDigest: { algorithm: 'sha256', value: 'a'.repeat(64) },
              authorizationDigest: { algorithm: 'sha256', value: 'b'.repeat(64) },
            },
          });
          process.exit(39);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'GRAPH_QUERY_CACHE_MUTABLE_GENERATION') {
            throw error;
          }
        }
        const { existsSync } = await import('node:fs');
        if (existsSync('.workspai')) throw new Error('Repository preview created forbidden metadata');
      `,
    ],
    { cwd: consumerRoot, encoding: 'utf8' }
  );
  if (smoke.error || smoke.status !== 0) {
    throw new Error(
      `packed Graph consumer smoke failed with exit ${smoke.status ?? 'unknown'}${smoke.error ? `: ${smoke.error.message}` : ''}\n${smoke.stdout ?? ''}\n${smoke.stderr ?? ''}`
    );
  }

  const cliPath = path.join(installedRoot, 'dist', 'cli.js');
  const runCli = (args, acceptedStatuses = [0]) => {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: consumerRoot,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error || !acceptedStatuses.includes(result.status)) {
      throw new Error(
        `packed Graph CLI failed with exit ${result.status ?? 'unknown'}${result.error ? `: ${result.error.message}` : ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
      );
    }
    const serialized = (result.stdout || result.stderr).trim();
    if (!serialized) {
      throw new Error(
        `packed Graph CLI exited successfully without a JSON envelope: ${args.join(' ')}`
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new Error(
        `packed Graph CLI emitted invalid JSON for ${args.join(' ')}: ${error instanceof Error ? error.message : 'unknown parse failure'}\n${serialized}`
      );
    }
    if (
      parsed.schemaVersion !== GRAPH_CLI_RESULT_SCHEMA_VERSION ||
      typeof parsed.command !== 'string' ||
      typeof parsed.status !== 'string' ||
      !Array.isArray(parsed.diagnostics)
    ) {
      throw new Error(`packed Graph CLI envelope drifted for ${args.join(' ')}: ${serialized}`);
    }
    return parsed;
  };
  let subjectId;
  let targetId;
  const extraById = {
    help: ({ text }) => {
      if (
        !text.includes('Query presets:') ||
        !text.includes('architectureConformance') ||
        !text.includes('entryPoints') ||
        !text.includes(GRAPH_CLI_RESULT_SCHEMA_VERSION) ||
        !text.includes('Standalone-stable admission is not claimed')
      ) {
        throw new Error(
          'packed Graph CLI help omitted published presets or the fail-closed banner'
        );
      }
    },
    'inspect-json': (envelope) => {
      if (!['complete', 'partial'].includes(envelope.status)) {
        throw new Error('packed Graph CLI did not return an honest repository preview');
      }
      if (fs.existsSync(path.join(consumerRoot, '.workspai'))) {
        throw new Error('packed Graph CLI wrote metadata without --write');
      }
      const nodes = envelope.data?.build?.graph?.nodes;
      const nodeId = nodes?.[0]?.id;
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        throw new Error('packed Graph CLI inspect omitted graph nodes');
      }
      subjectId = nodeId;
      targetId = typeof nodes?.[1]?.id === 'string' ? nodes[1].id : nodeId;
    },
    'inspect-project-only': (envelope) => {
      if (!['complete', 'partial'].includes(envelope.status)) {
        throw new Error('packed Graph CLI project-only inspect drifted');
      }
      if (fs.existsSync(path.join(consumerRoot, '.workspai'))) {
        throw new Error('packed Graph CLI wrote metadata in project-only mode');
      }
    },
    'inspect-source-view': (envelope) => {
      if (envelope.data?.view?.view !== 'source' || !envelope.data?.view?.sourceGeneration) {
        throw new Error('packed Graph CLI did not emit the source preview view');
      }
    },
    'inspect-structural-view': (envelope) => {
      if (envelope.data?.view?.view !== 'structural' || !envelope.data?.view?.sourceGeneration) {
        throw new Error('packed Graph CLI did not emit the structural preview view');
      }
    },
    'inspect-evidence-view': (envelope) => {
      if (envelope.data?.view?.view !== 'evidence' || !envelope.data?.view?.sourceGeneration) {
        throw new Error('packed Graph CLI did not emit the evidence preview view');
      }
    },
    'providers-list': (envelope) => {
      if (!Array.isArray(envelope.data) || envelope.data.length !== 7) {
        throw new Error('packed Graph CLI provider inventory is incomplete');
      }
    },
    'providers-inspect-repository-files': (envelope) => {
      if (envelope.data?.id !== 'workspai.graph.provider.repository-files') {
        throw new Error('packed Graph CLI did not inspect the repository-files provider');
      }
    },
    'query-review-context-slice': (envelope) => {
      if (
        envelope.data?.contract?.id !== 'workspai.graph.review-context-slice' ||
        !envelope.data?.sourceGeneration ||
        !envelope.data?.sourceQueryDigest
      ) {
        throw new Error('packed Graph CLI did not emit a provenance-bound review context slice');
      }
    },
    'query-dependencies-without-subject': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_QUERY_SUBJECT_REQUIRED')
      ) {
        throw new Error('packed Graph CLI admitted a subject-required query without a subject');
      }
    },
    'query-unknown-preset': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_CLI_INPUT_INVALID')
      ) {
        throw new Error('packed Graph CLI admitted an unknown query preset');
      }
    },
    'query-without-preset': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_CLI_INPUT_INVALID')
      ) {
        throw new Error('packed Graph CLI admitted a query without a preset');
      }
    },
    'query-slice-without-review-context': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_CLI_INPUT_INVALID')
      ) {
        throw new Error('packed Graph CLI admitted --slice on a non-reviewContext preset');
      }
    },
    'quality-write-rejected': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_CLI_INPUT_INVALID')
      ) {
        throw new Error('packed Graph CLI allowed --write on quality');
      }
    },
    'providers-inspect-unknown': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_PROVIDER_UNKNOWN')
      ) {
        throw new Error('packed Graph CLI admitted an unknown provider');
      }
    },
    'quality-json': (envelope) => {
      if (!envelope.data?.quality || typeof envelope.data?.metrics?.inputFiles !== 'number') {
        throw new Error('packed Graph CLI quality omitted metrics');
      }
    },
    'inspect-workspace-without-onboarding': (envelope) => {
      if (envelope.status !== 'partial') {
        throw new Error('packed Graph CLI silently completed workspace inspect without onboarding');
      }
      if (
        envelope.data?.workspace?.status !== 'handoff-unavailable' ||
        !JSON.stringify(envelope.diagnostics).includes(
          'GRAPH_STANDALONE_ONBOARDING_ADAPTER_MISSING'
        )
      ) {
        throw new Error('packed Graph CLI hid missing workspace onboarding');
      }
      if (fs.existsSync(path.join(consumerRoot, '.workspai'))) {
        throw new Error('packed Graph CLI wrote workspace metadata without --write');
      }
    },
    'inspect-existing-workspace-without-selection': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes(
          'GRAPH_STANDALONE_WORKSPACE_SELECTION_REQUIRED'
        )
      ) {
        throw new Error('packed Graph CLI admitted existing-workspace inspect without a selection');
      }
      if (fs.existsSync(path.join(consumerRoot, '.workspai'))) {
        throw new Error('packed Graph CLI wrote metadata while rejecting workspace selection');
      }
    },
    'inspect-existing-workspace-write-without-selection': (envelope) => {
      if (
        envelope.status !== 'failed' ||
        !JSON.stringify(envelope.diagnostics).includes('GRAPH_CLI_INPUT_INVALID')
      ) {
        throw new Error('packed Graph CLI wrote an existing workspace without a selection');
      }
      if (fs.existsSync(path.join(consumerRoot, '.workspai'))) {
        throw new Error(
          'packed Graph CLI wrote metadata while rejecting workspace write selection'
        );
      }
    },
    'inspect-write': (envelope) => {
      if (!['committed', 'already-current'].includes(envelope.data?.publication?.status)) {
        throw new Error('packed Graph CLI did not publish an explicit project generation');
      }
      const pointerPath = path.join(consumerRoot, '.workspai', 'reports', 'graph-generation.json');
      if (
        !fs.existsSync(pointerPath) ||
        fs.readFileSync(pointerPath, 'utf8').includes(consumerRoot)
      ) {
        throw new Error('packed Graph CLI publication pointer is absent or host-bound');
      }
    },
  };
  for (const job of GRAPH_STANDALONE_PACKED_JOBS) {
    const args = [...job.args];
    if (job.requiresSubject) {
      if (typeof subjectId !== 'string') {
        throw new Error(`packed job ${job.id} needs a captured graph subject`);
      }
      args.push('--subject', subjectId);
    }
    if (job.requiresTarget) {
      if (typeof targetId !== 'string') {
        throw new Error(`packed job ${job.id} needs a captured graph target`);
      }
      args.push('--target', targetId);
    }
    if (job.output === 'help') {
      const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: consumerRoot,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result.error || !job.acceptedExitCodes.includes(result.status)) {
        throw new Error(
          `packed Graph CLI help failed with exit ${result.status ?? 'unknown'}${result.error ? `: ${result.error.message}` : ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
        );
      }
      extraById[job.id]?.({ text: result.stdout ?? '' });
      continue;
    }
    const envelope = runCli(args, [...job.acceptedExitCodes]);
    extraById[job.id]?.(envelope);
  }

  const paths = packedFiles(installedRoot);
  const rootRuntime = fs.readFileSync(path.join(installedRoot, 'dist/index.js'), 'utf8');
  if (
    /from\s+['"](?:node:)?(?:crypto|fs|path|child_process|worker_threads)['"]/u.test(rootRuntime)
  ) {
    throw new Error('packed Graph root runtime imports host infrastructure directly');
  }
  for (const requiredPath of [
    'package.json',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/cli.js',
    'dist/contracts/index.js',
    'dist/providers/index.js',
    'dist/conformance/index.js',
    'dist/testing/index.js',
    'dist/adapters/node/index.js',
    'dist/adapters/node/index.d.ts',
    'dist/adapters/node/reference-worker-entry.js',
    'conformance/contract-catalog.v1.json',
    'schemas/entity-identity.v0.1.0-candidate.schema.json',
    'schemas/fact-batch.v0.1.0-candidate.schema.json',
    'schemas/provider-detection.v0.1.0-candidate.schema.json',
    'schemas/provider-manifest.v0.1.0-candidate.schema.json',
    'schemas/ontology-profile.v0.1.0-candidate.schema.json',
    'schemas/canonical-graph.v0.1.0-candidate.schema.json',
    'schemas/generation-publication.v0.1.0-candidate.schema.json',
    'schemas/model-generation-binding.v0.1.0-candidate.schema.json',
    'schemas/query-cache-key.v0.1.0-candidate.schema.json',
    'schemas/query-cache-entry.v0.1.0-candidate.schema.json',
    'schemas/query-cache-reuse.v0.1.0-candidate.schema.json',
    'schemas/query-cache-invalidation.v0.1.0-candidate.schema.json',
    'schemas/proof-policy.v0.1.0-candidate.schema.json',
    'schemas/binding-profile.v0.1.0-candidate.schema.json',
    'schemas/graph-query.v0.1.0-candidate.schema.json',
    'schemas/graph-query-result.v0.1.0-candidate.schema.json',
    'schemas/retrieval-plan.v0.1.0-candidate.schema.json',
    'schemas/repository-preview-view.v0.1.0-candidate.schema.json',
    'schemas/review-context-slice.v0.1.0-candidate.schema.json',
    'schemas/structural-extractor-profile.v0.1.0-candidate.schema.json',
    'schemas/cli-result.v0.1.0-candidate.schema.json',
    'schemas/standalone-support-matrix.v0.1.0-candidate.schema.json',
    'conformance/profile.json',
    'fixtures/g1/minimal-provider-manifest.json',
    'fixtures/g1/minimal-fact-batch.json',
    'fixtures/g1/minimal-entity.json',
    'fixtures/g1/semantic-invalid-mutations.json',
    'fixtures/g1/invalid-absolute-entity.json',
    'fixtures/g1/maximal-provider-manifest.json',
    'fixtures/g1/maximal-fact-batch.json',
    'fixtures/g4/structural-extractor-profile.json',
    'fixtures/g4/repositories/node/package.json',
    'fixtures/g4/repositories/node/src/server.ts',
    'fixtures/g4/repositories/python/app.py',
    'fixtures/g4/repositories/go/main.go',
    'fixtures/g4/repositories/java/HealthController.java',
    'fixtures/g4/repositories/dotnet/Program.cs',
    'fixtures/g4/repositories/rust/main.rs',
    'fixtures/g4/repositories/unsupported/app.rb',
    'fixtures/g6/minimal-changeset.json',
    'fixtures/g6/minimal-content-state-manifest.json',
    'fixtures/g6/minimal-graph-change-overlay.json',
    'fixtures/g6/minimal-graph-delta.json',
    'fixtures/g6/minimal-proposed-change-set.json',
    'fixtures/g6/minimal-proposed-graph-delta.json',
    'fixtures/g7/minimal-cli-result.json',
    'fixtures/g7/invalid-cli-result.json',
    'fixtures/g7/retrieval-corpus.v1.json',
  ]) {
    if (!paths.includes(requiredPath))
      throw new Error(`packed Graph package omits ${requiredPath}`);
  }
  for (const forbiddenPrefix of [
    'src/',
    'test/',
    'scripts/',
    'coverage/',
    'governance/',
    'docs/',
  ]) {
    if (paths.some((entry) => entry.startsWith(forbiddenPrefix))) {
      throw new Error(`packed Graph package leaks development path ${forbiddenPrefix}`);
    }
  }
  if (paths.some((entry) => entry.endsWith('.map'))) {
    throw new Error('packed Graph package leaks source maps');
  }
  if (
    paths.some(
      (entry) => entry === 'governance/g7-sbom.cdx.json' || entry.startsWith('governance/')
    )
  ) {
    throw new Error('packed Graph package leaks unattested governance artifacts');
  }

  const catalog = JSON.parse(
    fs.readFileSync(path.join(installedRoot, 'conformance/contract-catalog.v1.json'), 'utf8')
  );
  if (!Array.isArray(catalog.contracts) || catalog.contracts.length === 0) {
    throw new Error('packed Graph package omits the contract catalog');
  }
  for (const contract of catalog.contracts) {
    const schemaPath = path.join(installedRoot, contract.file);
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`packed Graph package omits catalog schema ${contract.file}`);
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');
    if (digest !== contract.sha256) {
      throw new Error(`packed catalog digest drifted for ${contract.file}`);
    }
  }

  const packedConformance = await import(
    pathToFileURL(path.join(installedRoot, 'dist/conformance/index.js')).href
  );
  const profile = packedJson(installedRoot, 'conformance/profile.json');
  if (
    profile.id !== packedConformance.GRAPH_CONFORMANCE_PROFILE.id ||
    profile.version !== packedConformance.GRAPH_CONFORMANCE_PROFILE.version ||
    profile.maturity !== packedConformance.GRAPH_CONFORMANCE_PROFILE.maturity ||
    JSON.stringify(profile.requiredSuites) !==
      JSON.stringify([...packedConformance.GRAPH_CONFORMANCE_PROFILE.requiredSuites])
  ) {
    throw new Error('packed conformance profile drifted from GRAPH_CONFORMANCE_PROFILE');
  }
  const packedManifest = packedJson(installedRoot, 'fixtures/g1/minimal-provider-manifest.json');
  const packedBatch = packedJson(installedRoot, 'fixtures/g1/minimal-fact-batch.json');
  if (!packedConformance.validateGraphProviderManifest(packedManifest).accepted) {
    throw new Error('packed G1 provider manifest was not admitted');
  }
  if (!packedConformance.validateGraphFactBatch(packedBatch, packedManifest).accepted) {
    throw new Error('packed G1 fact batch was not admitted');
  }
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const entitySchema = packedJson(
    installedRoot,
    'schemas/entity-identity.v0.1.0-candidate.schema.json'
  );
  const validateEntity = new Ajv2020({
    strict: true,
    strictRequired: false,
    validateFormats: false,
  }).compile(entitySchema);
  if (!validateEntity(packedJson(installedRoot, 'fixtures/g1/minimal-entity.json'))) {
    throw new Error('packed G1 entity fixture was not schema-valid');
  }
  if (validateEntity(packedJson(installedRoot, 'fixtures/g1/invalid-absolute-entity.json'))) {
    throw new Error('packed invalid-absolute entity was admitted');
  }
  for (const fixture of packedJson(installedRoot, 'fixtures/g1/semantic-invalid-mutations.json')) {
    const batch = structuredClone(packedBatch);
    mutate(batch, fixture);
    if (fixture.also) mutate(batch, fixture.also);
    const result = packedConformance.validateGraphFactBatch(batch, packedManifest);
    if (result.accepted || !result.issues.some((issue) => issue.code === fixture.expectedCode)) {
      throw new Error(`packed semantic-invalid mutation ${fixture.id} was not fail-closed`);
    }
  }
  const packedMaximalManifest = packedJson(
    installedRoot,
    'fixtures/g1/maximal-provider-manifest.json'
  );
  const packedMaximalBatch = packedJson(installedRoot, 'fixtures/g1/maximal-fact-batch.json');
  if (!packedConformance.validateGraphProviderManifest(packedMaximalManifest).accepted) {
    throw new Error('packed maximal G1 provider manifest was not admitted');
  }
  const maximalBatch = packedConformance.validateGraphFactBatch(
    packedMaximalBatch,
    packedMaximalManifest
  );
  if (!maximalBatch.accepted || maximalBatch.value.status !== 'partial') {
    throw new Error('packed maximal G1 fact batch lost partial unknown state');
  }

  const compilePackedSchema = (relative) =>
    new Ajv2020({
      strict: true,
      strictRequired: false,
      validateFormats: false,
    }).compile(packedJson(installedRoot, relative));
  const validateCliResult = compilePackedSchema('schemas/cli-result.v0.1.0-candidate.schema.json');
  if (!validateCliResult(packedJson(installedRoot, 'fixtures/g7/minimal-cli-result.json'))) {
    throw new Error('packed G7 CLI result fixture was not schema-valid');
  }
  if (validateCliResult(packedJson(installedRoot, 'fixtures/g7/invalid-cli-result.json'))) {
    throw new Error('packed invalid CLI result fixture was admitted');
  }
  const packedExtractor = packedJson(
    installedRoot,
    'fixtures/g4/structural-extractor-profile.json'
  );
  const validateExtractor = compilePackedSchema(
    'schemas/structural-extractor-profile.v0.1.0-candidate.schema.json'
  );
  if (!validateExtractor(packedExtractor)) {
    throw new Error('packed G4 structural extractor fixture was not schema-valid');
  }
  if (
    JSON.stringify(packedExtractor) !==
    JSON.stringify(packedProduct.GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE)
  ) {
    throw new Error('packed G4 structural extractor fixture drifted from the installed contract');
  }
  for (const [fixture, schema] of [
    ['fixtures/g6/minimal-changeset.json', 'schemas/changeset.v0.1.0-candidate.schema.json'],
    [
      'fixtures/g6/minimal-content-state-manifest.json',
      'schemas/content-state-manifest.v0.1.0-candidate.schema.json',
    ],
    [
      'fixtures/g6/minimal-graph-change-overlay.json',
      'schemas/graph-change-overlay.v0.1.0-candidate.schema.json',
    ],
    ['fixtures/g6/minimal-graph-delta.json', 'schemas/graph-delta.v0.1.0-candidate.schema.json'],
    [
      'fixtures/g6/minimal-proposed-change-set.json',
      'schemas/proposed-change-set.v0.1.0-candidate.schema.json',
    ],
    [
      'fixtures/g6/minimal-proposed-graph-delta.json',
      'schemas/proposed-graph-delta.v0.1.0-candidate.schema.json',
    ],
  ]) {
    if (!compilePackedSchema(schema)(packedJson(installedRoot, fixture))) {
      throw new Error(`packed ${fixture} was not schema-valid`);
    }
  }

  const packedRuntime = await import(pathToFileURL(path.join(installedRoot, 'dist/index.js')).href);
  const packedTesting = await import(
    pathToFileURL(path.join(installedRoot, 'dist/testing/index.js')).href
  );
  const packedCorpus = packedJson(installedRoot, 'fixtures/g7/retrieval-corpus.v1.json');
  if (packedCorpus.groundTruthClass !== 'synthetic' || packedCorpus.accuracyClaim !== 'none') {
    throw new Error('packed retrieval corpus claimed non-synthetic accuracy');
  }
  const retrievalDigest = {
    algorithm: 'sha256',
    digest: async (input) => crypto.createHash('sha256').update(input).digest('hex'),
  };
  const retrievalObservations = [];
  for (const fixture of packedCorpus.cases) {
    const result = await packedRuntime.queryGraph(
      packedCorpus.graph,
      fixture.query,
      retrievalDigest
    );
    if (!result.accepted) {
      retrievalObservations.push({
        id: fixture.id,
        accepted: false,
        resultIds: [],
        pathNodeIds: [],
        truncated: false,
        issueCodes: result.issues.map((issue) => issue.code),
        unknownCodes: [],
        elapsedMs: 0,
      });
      continue;
    }
    retrievalObservations.push({
      id: fixture.id,
      accepted: true,
      resultIds: (Array.isArray(result.value.result) ? result.value.result : [])
        .map((item) => item?.id)
        .filter((id) => typeof id === 'string')
        .sort(),
      pathNodeIds: result.value.paths[0]?.nodes.map((node) => node.id) ?? [],
      truncated: Boolean(result.value.truncation?.truncated),
      selectedStrategy: result.value.retrievalPlan?.selected,
      issueCodes: [],
      unknownCodes: result.value.unknownBoundaries.map((zone) => zone.code),
      elapsedMs: 0,
    });
  }
  const retrievalReport = packedTesting.scoreGraphRetrievalBenchmark(
    packedCorpus,
    retrievalObservations
  );
  if (
    retrievalReport.publicAccuracyClaimPermitted !== false ||
    retrievalReport.failures.length > 0
  ) {
    throw new Error(`packed retrieval benchmark failed: ${retrievalReport.failures.join('; ')}`);
  }

  const packedAdapters = await import(
    pathToFileURL(path.join(installedRoot, 'dist/adapters/node/index.js')).href
  );
  const languageFixtures = [
    ['node', 'imports', 'exposes'],
    ['python', 'imports', 'exposes'],
    ['go', 'imports', 'exposes'],
    ['java', 'imports', 'exposes'],
    ['dotnet', 'imports', 'exposes'],
    ['rust', 'imports', undefined],
  ];
  for (const [language, importRelation, routeRelation] of languageFixtures) {
    const fixtureRoot = path.join(installedRoot, 'fixtures/g4/repositories', language);
    const result = await packedAdapters.buildNodeRepoGraph({ root: fixtureRoot });
    if (!['complete', 'partial'].includes(result.status) || !result.graph) {
      throw new Error(`packed G4 ${language} fixture failed to build`);
    }
    if (!result.graph.edges.some((edge) => edge.relation === importRelation)) {
      throw new Error(`packed G4 ${language} fixture omitted ${importRelation} evidence`);
    }
    if (routeRelation && !result.graph.edges.some((edge) => edge.relation === routeRelation)) {
      throw new Error(`packed G4 ${language} fixture omitted ${routeRelation} evidence`);
    }
    if (
      JSON.stringify(result).includes(fixtureRoot) ||
      JSON.stringify(result).includes(os.homedir())
    ) {
      throw new Error(`packed G4 ${language} fixture leaked a host path`);
    }
  }
  const unsupported = await packedAdapters.buildNodeRepoGraph({
    root: path.join(installedRoot, 'fixtures/g4/repositories/unsupported'),
  });
  if (
    unsupported.status !== 'partial' ||
    !unsupported.quality.unsupportedZones.some(
      (zone) => zone.code === 'graph.source-language-unsupported'
    )
  ) {
    throw new Error('packed unsupported-language fixture was not an honest partial');
  }

  const leakedRoots = [
    ...new Set(
      [
        os.homedir(),
        process.env.HOME,
        process.env.USERPROFILE,
        packageRoot,
        path.resolve(packageRoot, '../..'),
      ]
        .filter((value) => typeof value === 'string' && value.length >= 3)
        .flatMap((value) => [value, value.replaceAll('\\', '/'), value.replaceAll('/', '\\')])
    ),
  ];
  const secretMaterial =
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|npm_[A-Za-z0-9]{36}/u;
  for (const relative of paths) {
    if (
      !relative.endsWith('.js') &&
      !relative.endsWith('.json') &&
      !relative.endsWith('.md') &&
      !relative.endsWith('.ts') &&
      relative !== 'LICENSE'
    ) {
      continue;
    }
    const text = fs.readFileSync(path.join(installedRoot, relative), 'utf8');
    if (secretMaterial.test(text)) {
      throw new Error(`packed Graph package contains secret material in ${relative}`);
    }
    for (const root of leakedRoots) {
      if (text.includes(root)) {
        throw new Error(`packed Graph package leaks host path in ${relative}`);
      }
    }
  }

  console.log(
    `Packed Graph consumer passed: ${paths.length} files, ${compressedBytes}/${compressedBudgetBytes} compressed bytes.`
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
