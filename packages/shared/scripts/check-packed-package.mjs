import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-shared-pack-'));
const consumerRoot = path.join(temporaryRoot, 'consumer');
const npmCache = path.join(temporaryRoot, 'npm-cache');

function runNpm(args, cwd) {
  // Invoke the platform npm shim. Re-entering npm through npm_execpath while
  // already inside a workspace lifecycle can inherit workspace-only output
  // settings and suppress the JSON payload required by this gate.
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const environment = { ...process.env, npm_config_cache: npmCache };
  for (const inheritedWorkspaceSetting of [
    'npm_config_workspace',
    'npm_config_workspaces',
    'npm_config_include_workspace_root',
    'npm_config_local_prefix',
    'npm_config_loglevel',
  ]) {
    delete environment[inheritedWorkspaceSetting];
  }
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    );
  }
  return result.stdout;
}

try {
  runNpm(
    ['pack', '--loglevel=notice', '--ignore-scripts', '--pack-destination', temporaryRoot],
    packageRoot
  );
  const tarballs = fs
    .readdirSync(temporaryRoot)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => path.join(temporaryRoot, entry));
  if (tarballs.length !== 1) {
    throw new Error(`npm pack must produce exactly one tarball; found ${tarballs.length}`);
  }

  fs.mkdirSync(consumerRoot, { recursive: true });
  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'workspai-shared-packed-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  const tarballPath = tarballs[0];
  const compressedBytes = fs.statSync(tarballPath).size;
  const compressedBudgetBytes = 160 * 1024;
  if (compressedBytes > compressedBudgetBytes) {
    throw new Error(
      `packed package is ${compressedBytes} compressed bytes; budget is ${compressedBudgetBytes}`
    );
  }
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], consumerRoot);

  const sbom = JSON.parse(runNpm(['sbom', '--sbom-format', 'cyclonedx'], consumerRoot));
  const sbomComponents = [sbom.metadata?.component, ...(sbom.components ?? [])].filter(Boolean);
  const sharedSbomComponent = sbomComponents.find(
    (component) => component.name === '@workspai/shared'
  );
  if (
    sbom.bomFormat !== 'CycloneDX' ||
    sbom.specVersion !== '1.5' ||
    sharedSbomComponent?.version !== '0.0.0-development'
  ) {
    throw new Error('packed package did not produce the expected CycloneDX Shared component');
  }

  const smoke = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import fs from 'node:fs';
        import * as root from '@workspai/shared';
        import * as browser from '@workspai/shared/browser';
        import * as contracts from '@workspai/shared/contracts';
        import * as node from '@workspai/shared/node';
        import { negotiateWisCoreResultEnvelope } from '@workspai/shared/compatibility';
        import {
          validateWisContractCatalogStructure,
          validateWisCoreResultEnvelope,
          validateWisGeneratedContractStructure,
          MAX_WIS_VALIDATION_LIMITS
        } from '@workspai/shared/validation';
        import {
          WIS_GENERATED_CONTRACT_REGISTRY,
          getWisGeneratedContract
        } from '@workspai/shared/registry';
        const fixture = JSON.parse(fs.readFileSync(
          'node_modules/@workspai/shared/fixtures/core/v0.2.0-draft/valid-pass.json',
          'utf8'
        ));
        const previousFixture = JSON.parse(fs.readFileSync(
          'node_modules/@workspai/shared/fixtures/compatibility/core-result-envelope/previous-valid-pass.json',
          'utf8'
        ));
        if (!root.WORKSPAI_SHARED_PACKAGE || !contracts.WIS_RESULT_STATUSES) process.exit(10);
        if (browser.WORKSPAI_SHARED_RUNTIME !== 'browser-neutral') process.exit(20);
        if (node.WORKSPAI_SHARED_RUNTIME !== 'node') process.exit(21);
        if (!validateWisCoreResultEnvelope(fixture).valid) process.exit(11);
        if (WIS_GENERATED_CONTRACT_REGISTRY.contracts.length !== 3) process.exit(12);
        if (!getWisGeneratedContract('core-result-envelope')) process.exit(13);
        if (!validateWisGeneratedContractStructure('core-result-envelope', fixture).valid) process.exit(14);
        if (!validateWisGeneratedContractStructure('contract-catalog', WIS_GENERATED_CONTRACT_REGISTRY).valid) process.exit(15);
        const compatibility = negotiateWisCoreResultEnvelope(previousFixture);
        if (!compatibility.compatible || compatibility.status !== 'migrated') process.exit(16);
        if (compatibility.value.extensions !== undefined) process.exit(17);
        if (MAX_WIS_VALIDATION_LIMITS.maxDiagnostics !== 1000) process.exit(18);
        const cancelled = validateWisCoreResultEnvelope(fixture, { signal: { aborted: true } });
        if (cancelled.valid || cancelled.diagnostics[0]?.code !== 'WIS_RESOURCE_CANCELLED') process.exit(19);
      `,
    ],
    { cwd: consumerRoot, encoding: 'utf8' }
  );
  if (smoke.error || smoke.status !== 0) {
    throw new Error(`packed consumer smoke failed\n${smoke.stdout ?? ''}\n${smoke.stderr ?? ''}`);
  }

  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(consumerRoot, 'node_modules/@workspai/shared/package.json'), 'utf8')
  );
  const installedPackageRoot = path.join(consumerRoot, 'node_modules/@workspai/shared');
  const packedPaths = [];
  const pending = [installedPackageRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) packedPaths.push(path.relative(installedPackageRoot, absolutePath));
    }
  }
  for (const requiredPath of [
    'package.json',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/contracts/index.js',
    'dist/compatibility/index.js',
    'dist/compatibility/index.d.ts',
    'dist/validation/index.js',
    'dist/registry/index.js',
    'dist/browser.js',
    'dist/browser.d.ts',
    'dist/node.js',
    'dist/node.d.ts',
    'dist/cli/index.js',
    'schemas/generated/registry.v2.json',
    'schemas/compatibility/wis-core-result-envelope.v0.1.0-draft.schema.json',
    'schemas/cli/workspai-shared-cli-result.v1.schema.json',
    'fixtures/scale/workload-manifest.v1.json',
  ]) {
    if (!packedPaths.includes(requiredPath))
      throw new Error(`packed package omits ${requiredPath}`);
  }
  for (const forbiddenPrefix of [
    'src/',
    'test/',
    'scripts/',
    'coverage/',
    'governance/',
    'adr/',
    'docs/',
  ]) {
    if (packedPaths.some((entry) => entry.startsWith(forbiddenPrefix))) {
      throw new Error(`packed package leaks development path ${forbiddenPrefix}`);
    }
  }
  for (const forbiddenPath of ['schemas/generation-manifest.v2.json']) {
    if (packedPaths.includes(forbiddenPath))
      throw new Error(`packed package leaks maintainer artifact ${forbiddenPath}`);
  }
  if (packedPaths.some((entry) => entry.endsWith('.map'))) {
    throw new Error('packed package leaks source maps');
  }
  const runtimeDependencies = {
    ...(installedManifest.dependencies ?? {}),
    ...(installedManifest.optionalDependencies ?? {}),
    ...(installedManifest.peerDependencies ?? {}),
  };
  if (Object.keys(runtimeDependencies).length > 0) {
    throw new Error('packed Shared package must remain a runtime dependency leaf');
  }

  if (installedManifest.bin?.['workspai-shared'] !== './dist/cli/index.js') {
    throw new Error('packed package does not expose the expected workspai-shared executable');
  }
  for (const subpath of ['./browser', './node']) {
    if (!installedManifest.exports?.[subpath]) {
      throw new Error(`packed package omits runtime export ${subpath}`);
    }
  }

  const cliPath = path.join(installedPackageRoot, 'dist/cli/index.js');
  const cliDurationsMs = [];
  const cliColdExecutionBudgetMs = 2_000;
  const validFixturePath = path.join(
    installedPackageRoot,
    'fixtures/core/v0.2.0-draft/valid-pass.json'
  );
  const previousFixturePath = path.join(
    installedPackageRoot,
    'fixtures/compatibility/core-result-envelope/previous-valid-pass.json'
  );
  const invalidFixturePath = path.join(
    installedPackageRoot,
    'fixtures/core/v0.2.0-draft/invalid-false-pass.json'
  );
  function runCli(args, expectedStatus, input) {
    const startedAt = performance.now();
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: consumerRoot,
      encoding: 'utf8',
      ...(input === undefined ? {} : { input }),
    });
    const durationMs = performance.now() - startedAt;
    cliDurationsMs.push(durationMs);
    if (durationMs > cliColdExecutionBudgetMs) {
      throw new Error(
        `packed CLI exceeded ${cliColdExecutionBudgetMs}ms cold execution budget (${durationMs.toFixed(2)}ms): ${args.join(' ')}`
      );
    }
    if (result.error || result.status !== expectedStatus || result.signal || result.stderr) {
      throw new Error(
        `packed CLI failed (${args.join(' ')})\nstatus=${result.status} signal=${result.signal} error=${result.error?.message ?? 'none'}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
      );
    }
    if (!result.stdout.trim()) {
      throw new Error(
        `packed CLI emitted no JSON (${args.join(' ')}) status=${result.status} signal=${result.signal}`
      );
    }
    const payload = JSON.parse(result.stdout);
    if (payload.exitCode !== expectedStatus) {
      throw new Error(`packed CLI JSON exit mismatch for ${args.join(' ')}`);
    }
    if (result.stdout.includes(consumerRoot)) {
      throw new Error(`packed CLI leaked its consumer path for ${args.join(' ')}`);
    }
    return payload;
  }

  const catalog = runCli(['schema', 'list', '--json'], 0);
  if (catalog.data?.contracts?.length !== 3 || resultContains(catalog, 'schemas/src/')) {
    throw new Error('packed CLI catalog is incomplete or leaks maintainer source paths');
  }
  const validCli = runCli(
    ['validate', validFixturePath, '--contract', 'core-result-envelope', '--json'],
    0
  );
  if (validCli.status !== 'succeeded') throw new Error('packed CLI rejected valid fixture');
  const invalidCli = runCli(
    ['validate', invalidFixturePath, '--contract', 'core-result-envelope', '--json'],
    3
  );
  if (invalidCli.status !== 'invalid') throw new Error('packed CLI accepted invalid fixture');
  const unknownContractCli = runCli(
    ['validate', 'does-not-exist.json', '--contract', 'unknown-contract', '--json'],
    3
  );
  if (unknownContractCli.diagnostics?.[0]?.code !== 'WIS_CONTRACT_NOT_FOUND') {
    throw new Error('packed CLI did not fail closed before reading an unknown contract');
  }
  const nonFileCli = runCli(
    ['validate', consumerRoot, '--contract', 'core-result-envelope', '--json'],
    1
  );
  if (nonFileCli.diagnostics?.[0]?.code !== 'WIS_CLI_INPUT_INVALID') {
    throw new Error('packed CLI did not reject a non-file input');
  }
  const compatibilityCli = runCli(
    ['compatibility', '-', '--json'],
    0,
    fs.readFileSync(previousFixturePath)
  );
  if (
    compatibilityCli.data?.compatibility !== 'migrated' ||
    Object.hasOwn(compatibilityCli.data ?? {}, 'value')
  ) {
    throw new Error('packed CLI compatibility result is incomplete or echoes payload data');
  }
  runCli(['validate', '-', '--contract', 'core-result-envelope', '--json'], 1, '{');

  const maxCliDurationMs = Math.max(...cliDurationsMs);
  console.log(
    `Packed consumer passed: ${packedPaths.length} files, ${compressedBytes}/${compressedBudgetBytes} compressed bytes, zero runtime dependencies; CLI cold max ${maxCliDurationMs.toFixed(2)}/${cliColdExecutionBudgetMs}ms.`
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function resultContains(value, fragment) {
  return JSON.stringify(value).includes(fragment);
}
