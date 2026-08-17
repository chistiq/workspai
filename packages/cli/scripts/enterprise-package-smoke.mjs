#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'dist', 'index.js');
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-enterprise-home-'));

process.on('exit', () => {
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});

function fail(message) {
  console.error(`[enterprise-package-smoke] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[enterprise-package-smoke] ${message}`);
}

function cliEnv(extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
    XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
    ...extraEnv,
  };
  delete env.NODE_ENV;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST')) {
      delete env[key];
    }
  }
  return env;
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function resolveNpmInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return { command: process.execPath, prefixArgs: [npmExecPath] };
  }

  if (commandExists('corepack')) {
    return { command: 'corepack', prefixArgs: ['npm'] };
  }

  if (commandExists('npm')) {
    return { command: 'npm', prefixArgs: [] };
  }

  fail('could not resolve npm. Install npm or enable corepack before packaging.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    env: cliEnv(options.env),
  });
  if (result.status !== 0) {
    fail(
      `command failed (${result.status}): ${command} ${args.join(' ')}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    );
  }
  return result.stdout ?? '';
}

function runToFile(command, args, options = {}) {
  const outputPath = path.join(
    os.tmpdir(),
    `rapidkit-enterprise-command-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.out`
  );
  const fd = fs.openSync(outputPath, 'w');
  try {
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', fd, 'pipe'],
      ...options,
      env: cliEnv(options.env),
    });
    if (result.status !== 0) {
      fail(
        `command failed (${result.status}): ${command} ${args.join(' ')}\n${result.stderr ?? ''}`
      );
    }
  } finally {
    fs.closeSync(fd);
  }

  try {
    return fs.readFileSync(outputPath, 'utf8');
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function runNpm(args) {
  const npm = resolveNpmInvocation();
  const isolatedCache = path.join(os.tmpdir(), `rapidkit-enterprise-npm-cache-${process.pid}`);
  fs.mkdirSync(isolatedCache, { recursive: true });
  return runToFile(npm.command, [...npm.prefixArgs, ...args], {
    env: {
      ...cliEnv(),
      npm_config_user_agent: process.env.npm_config_user_agent || 'npm/10 rapidkit-smoke',
      npm_config_cache: isolatedCache,
    },
  });
}

function runCli(args) {
  const outputPath = path.join(
    os.tmpdir(),
    `rapidkit-enterprise-cli-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.out`
  );
  const fd = fs.openSync(outputPath, 'w');
  try {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cliEnv(),
      stdio: ['ignore', fd, 'pipe'],
    });
    if (result.status !== 0) {
      fail(
        `CLI command failed (${result.status}): node dist/index.js ${args.join(' ')}\n${
          result.stderr ?? ''
        }`
      );
    }
  } finally {
    fs.closeSync(fd);
  }

  try {
    return fs.readFileSync(outputPath, 'utf8');
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function assertFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`missing required file: ${relativePath}`);
  }
}

function assertNodeExecutable(relativePath) {
  run(process.execPath, [path.join(repoRoot, relativePath)]);
}

function parseTrailingJson(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf('\n{');
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    fail(`failed to parse CLI JSON output: ${error instanceof Error ? error.message : error}`);
  }
}

function parseTrailingJsonArray(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf('\n[');
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    fail(`failed to parse npm JSON output: ${error instanceof Error ? error.message : error}`);
  }
}

const REQUIRED_PACKAGE_FILES = [
  'dist/index.js',
  'contracts/runtime-command-surface.v1.json',
  'contracts/workspace-archive-capabilities.v1.json',
  'contracts/workspace-archive-manifest.v1.json',
  'contracts/workspace-archive-operation-result.v1.json',
  'contracts/create-planner-capabilities.v1.json',
  'contracts/project-entry-capability.v1.json',
  'contracts/workspace-intelligence-architecture.v1.json',
  'contracts/workspace-intelligence-chain.v1.json',
  'contracts/studio-card-repair-capabilities.v1.json',
  'contracts/workspace-repair-capabilities.v1.json',
  'contracts/workspace-intelligence/workspace-repair-proposal.v1.json',
  'contracts/workspace-intelligence/workspace-repair-transaction.v1.json',
  'contracts/workspace-intelligence/project-agent-entry.v1.json',
  'contracts/workspace-intelligence/agent-bootstrap-receipt.v1.json',
  'contracts/extension-cli-compatibility.v1.json',
  'data/modules-embeddings.json',
  'templates/kits/fastapi-standard/README.md.j2',
  'templates/kits/fastapi-ddd/README.md.j2',
  'templates/kits/nestjs-standard/package.json.j2',
  'workspai.config.example.cjs',
  'rapidkit.config.example.cjs',
  'scripts/check-cli-resolution.cjs',
  'scripts/enforce-package-manager.cjs',
];

const FORBIDDEN_PACKAGE_FILES = ['workspai.config.example.js', 'rapidkit.config.example.js'];

function isPublishedByFilesPolicy(packageJson, assetPath) {
  const files = packageJson.files ?? [];
  return files.some(
    (entry) => entry === assetPath || assetPath.startsWith(`${entry.replace(/\/$/, '')}/`)
  );
}

function assertPackageFilesPolicy(requiredFiles) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  if (packageJson.name !== 'workspai') {
    fail(`package.json#name must be workspai, got ${packageJson.name}`);
  }
  if (packageJson.bin?.workspai !== 'dist/index.js') {
    fail('package.json#bin.workspai must point to dist/index.js');
  }
  if ('rapidkit' in (packageJson.bin ?? {})) {
    fail('package.json#bin.rapidkit must stay in the legacy rapidkit package, not workspai');
  }
  for (const required of requiredFiles) {
    if (!isPublishedByFilesPolicy(packageJson, required)) {
      fail(`package.json#files does not publish ${required}`);
    }
    assertFile(required);
  }
  for (const forbidden of FORBIDDEN_PACKAGE_FILES) {
    if (
      isPublishedByFilesPolicy(packageJson, forbidden) ||
      fs.existsSync(path.join(repoRoot, forbidden))
    ) {
      fail(`forbidden legacy package file is still present or published: ${forbidden}`);
    }
  }
  assertNodeExecutable('workspai.config.example.cjs');
  assertNodeExecutable('rapidkit.config.example.cjs');
}

function assertPackContents() {
  if (process.env.RAPIDKIT_ENTERPRISE_PREPACK === '1') {
    assertPackageFilesPolicy(REQUIRED_PACKAGE_FILES);
    log('verified package.json#files payload policy for prepack lifecycle');
    return;
  }

  const output = runNpm(['pack', '--dry-run', '--json', '--ignore-scripts']);
  const packuments = parseTrailingJsonArray(output);

  const files = new Set(
    (packuments?.[0]?.files ?? [])
      .map((entry) => entry?.path)
      .filter((entry) => typeof entry === 'string')
  );

  const missingRequired = REQUIRED_PACKAGE_FILES.filter((required) => !files.has(required));
  const forbiddenPresent = FORBIDDEN_PACKAGE_FILES.filter((forbidden) => files.has(forbidden));
  if (forbiddenPresent.length > 0) {
    fail(`npm pack includes forbidden legacy config example(s): ${forbiddenPresent.join(', ')}`);
  }
  if (missingRequired.length > 0) {
    assertPackageFilesPolicy(missingRequired);
    log(
      `npm pack dry-run omitted ${missingRequired.length} ignored generated asset(s); verified package.json#files policy and on-disk assets`
    );
  }

  for (const forbiddenPrefix of [
    'node_modules/',
    '.rapidkit/',
    '.venv/',
    'coverage/',
    'test-results/',
    'src/',
  ]) {
    const leaked = [...files].find((entry) => entry.startsWith(forbiddenPrefix));
    if (leaked) {
      fail(`npm pack payload leaks dev/local artifact: ${leaked}`);
    }
  }

  log(`verified npm pack payload (${files.size} files)`);
}

function assertCliContracts() {
  const version = parseTrailingJson(runCli(['--version', '--json']));
  if (version.schemaVersion !== 'rapidkit-version-v1') {
    fail(`unexpected version schema: ${version.schemaVersion}`);
  }
  if (!version.contracts?.runtimeCommandSurface) {
    fail('version contract does not advertise runtimeCommandSurface');
  }

  const commands = parseTrailingJson(runCli(['commands', '--json']));
  if (commands.schemaVersion !== 'rapidkit-command-capabilities-v1') {
    fail(`unexpected commands schema: ${commands.schemaVersion}`);
  }
  for (const topLevel of ['create', 'workspace', 'doctor', 'bootstrap']) {
    if (!commands.commandMap?.[topLevel]) {
      fail(`commands surface is missing top-level command: ${topLevel}`);
    }
  }
  for (const subcommand of [
    'model',
    'snapshot',
    'diff',
    'impact',
    'verify',
    'context',
    'explain',
  ]) {
    if (!commands.workspace?.intelligenceSubcommands?.includes(subcommand)) {
      fail(`workspace intelligence surface is missing subcommand: ${subcommand}`);
    }
  }

  log(`verified CLI contract surfaces for v${version.version}`);
}

function assertGeneratedProject(projectPath, expectedFiles) {
  for (const relativePath of expectedFiles) {
    const absolutePath = path.join(projectPath, relativePath);
    if (!fs.existsSync(absolutePath)) {
      fail(`generated project ${path.basename(projectPath)} is missing ${relativePath}`);
    }
  }
}

function smokeCreateNpmBackedKits() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-enterprise-smoke-'));
  const scenarios = [
    {
      kit: 'gofiber.standard',
      name: 'enterprise-fiber',
      extraArgs: [],
      expectedFiles: ['go.mod', 'cmd/server/main.go', '.workspai/project.json', 'rapidkit'],
    },
    {
      kit: 'gogin.standard',
      name: 'enterprise-gin',
      extraArgs: [],
      expectedFiles: ['go.mod', 'cmd/server/main.go', '.workspai/project.json', 'rapidkit'],
    },
    {
      kit: 'springboot.standard',
      name: 'enterprise-spring',
      extraArgs: ['--java-version', '21'],
      expectedFiles: [
        'pom.xml',
        'src/main/resources/application.yml',
        '.workspai/project.json',
        'rapidkit',
      ],
    },
    {
      kit: 'dotnet.webapi.clean',
      name: 'enterprise-dotnet',
      extraArgs: ['--target-framework', 'net8.0'],
      expectedFiles: [
        'src/Program.cs',
        'src/enterprise-dotnet.csproj',
        '.workspai/project.json',
        'rapidkit',
      ],
    },
    {
      kit: 'rust.axum',
      name: 'enterprise-rust-axum',
      extraArgs: [],
      expectedFiles: ['Cargo.toml', 'src/main.rs', '.workspai/project.json', 'rapidkit'],
    },
  ];

  try {
    for (const scenario of scenarios) {
      const args = [
        cliPath,
        'create',
        'project',
        scenario.kit,
        scenario.name,
        '--output',
        tempDir,
        '--skip-git',
        '--skip-install',
        ...scenario.extraArgs,
      ];
      const result = spawnSync(process.execPath, args, {
        cwd: tempDir,
        encoding: 'utf8',
        env: cliEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (result.status !== 0) {
        fail(
          `${scenario.kit} smoke create failed with exit ${result.status}\n${result.stdout}\n${result.stderr}`
        );
      }
      assertGeneratedProject(path.join(tempDir, scenario.name), scenario.expectedFiles);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log(`verified ${scenarios.length} npm-backed create scenarios`);
}

function smokeCreateOfflineFallbackKits() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-enterprise-fallback-'));
  const scenarios = [
    {
      kit: 'fastapi.standard',
      name: 'enterprise-fastapi',
      expectedFiles: [
        'pyproject.toml',
        'src/main.py',
        'src/routing/health.py',
        'src/routing/examples.py',
        'tests/test_health.py',
        'tests/test_examples.py',
        '.env.example',
        '.workspai/project.json',
        'rapidkit',
      ],
    },
    {
      kit: 'nestjs.standard',
      name: 'enterprise-nestjs',
      expectedFiles: [
        'package.json',
        'src/main.ts',
        'src/examples/examples.module.ts',
        '.env.example',
        '.workspai/project.json',
        'rapidkit',
      ],
    },
  ];

  try {
    for (const scenario of scenarios) {
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'create',
          'project',
          scenario.kit,
          scenario.name,
          '--output',
          tempDir,
          '--skip-git',
          '--skip-install',
        ],
        {
          cwd: tempDir,
          encoding: 'utf8',
          env: cliEnv({
            RAPIDKIT_FORCE_OFFLINE_CREATE_FALLBACK: '1',
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      if (result.status !== 0) {
        fail(
          `${scenario.kit} offline fallback smoke failed with exit ${result.status}\n${result.stdout}\n${result.stderr}`
        );
      }
      assertGeneratedProject(path.join(tempDir, scenario.name), scenario.expectedFiles);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  log(`verified ${scenarios.length} offline fallback create scenarios`);
}

for (const relativePath of [
  'package.json',
  'dist/index.js',
  'contracts/runtime-command-surface.v1.json',
  'contracts/workspace-archive-capabilities.v1.json',
  'contracts/workspace-archive-manifest.v1.json',
  'contracts/workspace-archive-operation-result.v1.json',
  'contracts/create-planner-capabilities.v1.json',
  'contracts/project-entry-capability.v1.json',
  'contracts/workspace-intelligence-architecture.v1.json',
  'contracts/workspace-intelligence-chain.v1.json',
  'contracts/studio-card-repair-capabilities.v1.json',
  'contracts/workspace-repair-capabilities.v1.json',
  'contracts/workspace-intelligence/workspace-repair-proposal.v1.json',
  'contracts/workspace-intelligence/workspace-repair-transaction.v1.json',
  'contracts/workspace-intelligence/project-agent-entry.v1.json',
  'contracts/workspace-intelligence/agent-bootstrap-receipt.v1.json',
  'contracts/extension-cli-compatibility.v1.json',
  'data/modules-embeddings.json',
]) {
  assertFile(relativePath);
}

assertPackContents();
assertCliContracts();
smokeCreateNpmBackedKits();
smokeCreateOfflineFallbackKits();

log('enterprise package smoke passed');
