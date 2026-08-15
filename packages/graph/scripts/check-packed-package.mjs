import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = path.resolve(packageRoot, '../shared');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-graph-pack-'));
const consumerRoot = path.join(temporaryRoot, 'consumer');
const npmCache = path.join(temporaryRoot, 'npm-cache');

function runNpm(args, cwd) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
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
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: environment });
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
      else if (entry.isFile()) files.push(path.relative(installedRoot, absolutePath));
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
        import { validateWisCoreResultEnvelope } from '@workspai/shared/validation';
        if (!graph.GRAPH_PACKAGE_METADATA) process.exit(10);
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
      `,
    ],
    { cwd: consumerRoot, encoding: 'utf8' }
  );
  if (smoke.error || smoke.status !== 0) {
    throw new Error(
      `packed Graph consumer smoke failed${smoke.error ? `: ${smoke.error.message}` : ''}\n${smoke.stdout ?? ''}\n${smoke.stderr ?? ''}`
    );
  }

  const installedRoot = path.join(consumerRoot, 'node_modules/@workspai/graph');
  const paths = packedFiles(installedRoot);
  for (const requiredPath of [
    'package.json',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/contracts/index.js',
    'dist/providers/index.js',
    'dist/conformance/index.js',
    'dist/testing/index.js',
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
