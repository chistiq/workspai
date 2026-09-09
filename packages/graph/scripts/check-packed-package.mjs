import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = path.resolve(packageRoot, '../shared');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-graph-pack-'));
const consumerRoot = path.join(temporaryRoot, 'consumer');
const npmCache = path.join(temporaryRoot, 'npm-cache');
const toolRequire = createRequire(path.join(packageRoot, 'package.json'));
const typescriptCli = toolRequire.resolve('typescript/bin/tsc');

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

  fs.writeFileSync(
    path.join(consumerRoot, 'consumer.ts'),
    `
      import type { GraphProviderManifest, WorkspaiGraphProviderManifestCandidate } from '@workspai/graph/contracts';
      import { GRAPH_PROVIDER_MANIFEST_CONTRACT, GRAPH_IDENTITY_SCHEME } from '@workspai/graph/contracts';
      import { validateGraphProviderManifest } from '@workspai/graph/conformance';
      import { composeGraph, GRAPH_STANDARD_COMPOSITION_POLICY, queryGraph } from '@workspai/graph';
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
      void queryGraph;
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
        import { createNodeGraphReferenceWorkerPool } from '@workspai/graph/adapters/node';
        import { validateWisCoreResultEnvelope } from '@workspai/shared/validation';
        if (!graph.GRAPH_PACKAGE_METADATA) process.exit(10);
        if (typeof graph.composeGraph !== 'function') process.exit(25);
        if (typeof graph.queryGraph !== 'function') process.exit(27);
        if (!contracts.GRAPH_QUERY_CONTRACT) process.exit(28);
        if (typeof conformance.validateGraphQuery !== 'function') process.exit(29);
        if (graph.GRAPH_STANDARD_COMPOSITION_POLICY.version !== '0.1.0-candidate') process.exit(26);
        if (!contracts.GRAPH_PACKAGE_METADATA) process.exit(11);
        if (!providers.GRAPH_PROVIDER_MANIFEST_CONTRACT) process.exit(12);
        if (!conformance.GRAPH_CONFORMANCE_PROFILE) process.exit(13);
        if (!testing.GRAPH_FORBIDDEN_RUNTIME_DEPENDENCIES) process.exit(14);
        const status = graph.getGraphPackageStatus({ kind: 'project', projectIds: ['project:packed-consumer'] });
        if (!validateWisCoreResultEnvelope(status).valid) process.exit(15);
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
      `,
    ],
    { cwd: consumerRoot, encoding: 'utf8' }
  );
  if (smoke.error || smoke.status !== 0) {
    throw new Error(
      `packed Graph consumer smoke failed with exit ${smoke.status ?? 'unknown'}${smoke.error ? `: ${smoke.error.message}` : ''}\n${smoke.stdout ?? ''}\n${smoke.stderr ?? ''}`
    );
  }

  const installedRoot = path.join(consumerRoot, 'node_modules/@workspai/graph');
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
  console.log(
    `Packed Graph consumer passed: ${paths.length} files, ${compressedBytes}/${compressedBudgetBytes} compressed bytes.`
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
