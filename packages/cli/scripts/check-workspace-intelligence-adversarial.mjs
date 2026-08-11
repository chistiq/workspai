#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packageRoot = process.cwd();
const cliPath = path.join(packageRoot, 'dist', 'index.js');
const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-adversarial-'));
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-adversarial-home-'));
const reportsPath = path.join(workspacePath, '.workspai', 'reports');

const isolatedEnvironment = {
  ...process.env,
  CI: '1',
  NO_COLOR: '1',
  RAPIDKIT_SKIP_LOCK_SYNC: '1',
  WORKSPAI_NO_UPDATE_CHECK: '1',
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
  APPDATA: path.join(isolatedHome, 'AppData', 'Roaming'),
};

function fail(message) {
  throw new Error(`[workspace-intelligence-adversarial] ${message}`);
}

function writeJson(relativePath, payload) {
  const target = path.join(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(workspacePath, relativePath), 'utf8'));
}

function runCli(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: workspacePath,
      env: isolatedEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function killDuringAtomicWrite(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: workspacePath,
      env: { ...isolatedEnvironment, WORKSPAI_TEST_ATOMIC_WRITE_DELAY_MS: '10000' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.once('error', reject);
    const startedAt = Date.now();
    const poll = setInterval(() => {
      const temporary = fs
        .readdirSync(reportsPath)
        .find((name) => name.startsWith('workspace-model.json.') && name.endsWith('.tmp'));
      if (temporary) {
        clearInterval(poll);
        child.kill('SIGKILL');
      } else if (Date.now() - startedAt > 15_000) {
        clearInterval(poll);
        child.kill('SIGKILL');
        reject(new Error(`atomic-write interruption hook did not expose a temp file: ${stderr}`));
      }
    }, 10);
    child.once('close', (code, signal) => {
      clearInterval(poll);
      resolve({ code, signal, stderr });
    });
  });
}

function expectStatus(result, accepted, label) {
  if (!accepted.includes(result.code)) {
    fail(
      `${label} exited ${String(result.code)} (${String(result.signal)})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

function assertNoTransientFiles() {
  const names = fs.existsSync(reportsPath) ? fs.readdirSync(reportsPath) : [];
  const transient = names.filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'));
  if (transient.length > 0) fail(`transient artifact files leaked: ${transient.join(', ')}`);
}

try {
  if (!fs.existsSync(cliPath)) fail('dist/index.js is missing; run the build first');
  fs.writeFileSync(path.join(workspacePath, '.workspai-workspace'), '{}\n');
  writeJson('.workspai/workspace.json', {
    workspace_name: 'adversarial-fixture',
    profile: 'minimal',
  });
  writeJson('app/package.json', {
    name: '@workspai/adversarial-fixture',
    version: '1.0.0',
    scripts: { test: 'node --version', build: 'node --version' },
  });
  writeJson('app/.workspai/project.json', {
    name: 'app',
    runtime: 'node',
    kit_name: 'vite-react',
  });
  fs.writeFileSync(path.join(workspacePath, '.gitignore'), '.workspai/reports/\n');
  fs.writeFileSync(path.join(workspacePath, 'app', 'source.js'), 'export const value = 1;\n');
  for (const args of [
    ['init'],
    ['config', 'user.email', 'runtime-contract@workspai.dev'],
    ['config', 'user.name', 'Workspai Runtime Contract'],
    ['config', 'commit.gpgsign', 'false'],
    ['add', '.'],
    ['commit', '-m', 'fixture baseline'],
  ]) {
    const git = spawnSync('git', args, { cwd: workspacePath, encoding: 'utf8' });
    if (git.status !== 0) fail(`git ${args.join(' ')} failed: ${git.stderr}`);
  }

  expectStatus(await runCli(['workspace', 'model', '--json', '--write']), [0], 'model baseline');
  expectStatus(await runCli(['workspace', 'snapshot', '--json']), [0], 'snapshot baseline');
  expectStatus(
    await runCli([
      'workspace',
      'diff',
      '--from',
      '.workspai/reports/workspace-model-snapshot.json',
      '--json',
    ]),
    [0],
    'diff baseline'
  );

  const diffPath = path.join(reportsPath, 'workspace-model-diff-last-run.json');
  const validDiff = fs.readFileSync(diffPath);
  fs.writeFileSync(path.join(reportsPath, 'workspace-model-snapshot.json'), '{corrupt-json');
  const corruptDiff = await runCli([
    'workspace',
    'diff',
    '--from',
    '.workspai/reports/workspace-model-snapshot.json',
    '--json',
  ]);
  if (corruptDiff.code === 0) fail('diff accepted a corrupt snapshot');
  if (!fs.readFileSync(diffPath).equals(validDiff)) {
    fail('failed diff replaced the last valid diff artifact');
  }

  expectStatus(await runCli(['workspace', 'snapshot', '--json']), [0], 'snapshot recovery');
  expectStatus(
    await runCli([
      'workspace',
      'diff',
      '--from',
      '.workspai/reports/workspace-model-snapshot.json',
      '--json',
    ]),
    [0],
    'diff recovery'
  );
  expectStatus(
    await runCli([
      'workspace',
      'impact',
      '--from',
      '.workspai/reports/workspace-model-diff-last-run.json',
      '--json',
    ]),
    [0],
    'impact recovery'
  );
  const validImpact = fs.readFileSync(path.join(reportsPath, 'workspace-impact-last-run.json'));
  writeJson('.workspai/reports/workspace-impact-last-run.json', {
    schemaVersion: 'workspace-impact.v1',
  });
  const malformedImpact = await runCli([
    'workspace',
    'verify',
    '--from-impact',
    '.workspai/reports/workspace-impact-last-run.json',
    '--json',
  ]);
  if (malformedImpact.code === 0 || !malformedImpact.stderr.includes('violates')) {
    fail('verify accepted a same-version impact that violates its JSON Schema');
  }
  fs.writeFileSync(path.join(reportsPath, 'workspace-impact-last-run.json'), validImpact);

  writeJson('late-project/package.json', {
    name: '@workspai/late-project',
    version: '1.0.0',
  });
  const staleImpactRun = await runCli([
    'workspace',
    'verify',
    '--from-impact',
    '.workspai/reports/workspace-impact-last-run.json',
    '--json',
  ]);
  if (staleImpactRun.code === 0 || !staleImpactRun.stdout.includes('Impact evidence is stale')) {
    fail('verify accepted impact evidence after the workspace model changed');
  }
  fs.rmSync(path.join(workspacePath, 'late-project'), { recursive: true, force: true });
  fs.writeFileSync(path.join(workspacePath, 'app', 'source.js'), 'export const value = 2;\n');
  const staleGitImpactRun = await runCli([
    'workspace',
    'verify',
    '--from-impact',
    '.workspai/reports/workspace-impact-last-run.json',
    '--json',
  ]);
  if (
    staleGitImpactRun.code === 0 ||
    !staleGitImpactRun.stdout.includes('Git changes no longer match')
  ) {
    fail('verify accepted impact evidence after source code changed in Git');
  }
  fs.writeFileSync(path.join(workspacePath, 'app', 'source.js'), 'export const value = 1;\n');
  const inconsistentImpact = JSON.parse(validImpact.toString('utf8'));
  inconsistentImpact.summary.affectedProjects += 1;
  writeJson('.workspai/reports/workspace-impact-last-run.json', inconsistentImpact);
  const semanticMismatch = await runCli([
    'workspace',
    'verify',
    '--from-impact',
    '.workspai/reports/workspace-impact-last-run.json',
    '--json',
  ]);
  if (semanticMismatch.code === 0 || !semanticMismatch.stderr.includes('semantic integrity')) {
    fail('verify accepted a Schema-valid but semantically inconsistent impact');
  }
  fs.writeFileSync(path.join(reportsPath, 'workspace-impact-last-run.json'), validImpact);

  for (const relativePath of [
    'AGENTS.md',
    '.workspai/reports/INDEX.json',
    '.workspai/reports/agent-customization-pack.json',
    '.workspai/reports/workspace-skills-index.json',
  ]) {
    fs.rmSync(path.join(workspacePath, relativePath), { force: true });
  }
  expectStatus(
    await runCli(['workspace', 'context', '--for-agent', '--json', '--write', '--no-agent-sync']),
    [0],
    'stage-pure context'
  );
  for (const relativePath of [
    'AGENTS.md',
    '.workspai/reports/INDEX.json',
    '.workspai/reports/agent-customization-pack.json',
    '.workspai/reports/workspace-skills-index.json',
  ]) {
    if (fs.existsSync(path.join(workspacePath, relativePath))) {
      fail(`context violated stage purity by writing ${relativePath}`);
    }
  }

  const modelRuns = await Promise.all(
    Array.from({ length: 12 }, () => runCli(['workspace', 'model', '--json', '--write']))
  );
  modelRuns.forEach((result, index) => expectStatus(result, [0], `concurrent model ${index}`));
  if (readJson('.workspai/reports/workspace-model.json').schemaVersion !== 'workspace-model.v1') {
    fail('concurrent model writes left an invalid artifact');
  }
  assertNoTransientFiles();

  const modelPath = path.join(reportsPath, 'workspace-model.json');
  const modelBeforeInterruption = fs.readFileSync(modelPath);
  const interrupted = await killDuringAtomicWrite(['workspace', 'model', '--json', '--write']);
  if (interrupted.signal !== 'SIGKILL') {
    fail(`atomic write process was not interrupted as expected: ${String(interrupted.signal)}`);
  }
  if (!fs.readFileSync(modelPath).equals(modelBeforeInterruption)) {
    fail('interrupted atomic write damaged the last valid model artifact');
  }
  const orphanedTemporary = fs
    .readdirSync(reportsPath)
    .filter((name) => name.startsWith('workspace-model.json.') && name.endsWith('.tmp'));
  if (orphanedTemporary.length !== 1) {
    fail(`expected one orphaned temp after SIGKILL, found ${orphanedTemporary.length}`);
  }
  const oldTime = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(reportsPath, orphanedTemporary[0]), oldTime, oldTime);
  expectStatus(
    await runCli(['workspace', 'model', '--json', '--write']),
    [0],
    'atomic write recovery'
  );
  assertNoTransientFiles();

  fs.rmSync(path.join(reportsPath, 'workspace-intelligence-history.json'), { force: true });
  const verifyRuns = await Promise.all(
    Array.from({ length: 12 }, () =>
      runCli([
        'workspace',
        'verify',
        '--from-impact',
        '.workspai/reports/workspace-impact-last-run.json',
        '--json',
      ])
    )
  );
  verifyRuns.forEach((result, index) =>
    expectStatus(result, [0, 1, 2], `concurrent verify ${index}`)
  );
  const history = readJson('.workspai/reports/workspace-intelligence-history.json');
  if (history.schemaVersion !== 'workspace-intelligence-history.v1') {
    fail('concurrent verify wrote an invalid history schema');
  }
  if (history.entries.length !== verifyRuns.length) {
    fail(`concurrent verify lost history entries: ${history.entries.length}/${verifyRuns.length}`);
  }
  assertNoTransientFiles();

  const historyPath = path.join(reportsPath, 'workspace-intelligence-history.json');
  fs.writeFileSync(historyPath, '{corrupt-history');
  const corruptHistoryRun = await runCli([
    'workspace',
    'verify',
    '--from-impact',
    '.workspai/reports/workspace-impact-last-run.json',
    '--json',
  ]);
  if (corruptHistoryRun.code === 0) fail('verify silently replaced corrupt history');
  if (fs.readFileSync(historyPath, 'utf8') !== '{corrupt-history') {
    fail('verify modified corrupt history instead of preserving it for diagnosis');
  }
  fs.rmSync(historyPath, { force: true });

  const staleLockPath = `${historyPath}.lock`;
  fs.writeFileSync(staleLockPath, '{"pid":-1}\n');
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(staleLockPath, staleTime, staleTime);
  expectStatus(
    await runCli([
      'workspace',
      'verify',
      '--from-impact',
      '.workspai/reports/workspace-impact-last-run.json',
      '--json',
    ]),
    [0, 1, 2],
    'stale lock recovery'
  );
  assertNoTransientFiles();

  if (process.platform !== 'win32') {
    const validModel = fs.readFileSync(modelPath);
    fs.chmodSync(reportsPath, 0o500);
    const deniedWrite = await runCli(['workspace', 'model', '--json', '--write']);
    fs.chmodSync(reportsPath, 0o700);
    if (process.getuid?.() !== 0 && deniedWrite.code === 0) {
      fail('model write unexpectedly succeeded in a non-writable report directory');
    }
    if (!fs.readFileSync(modelPath).equals(validModel)) {
      fail('permission failure damaged the last valid model artifact');
    }
  }

  console.log('[workspace-intelligence-adversarial] 12 adversarial scenario groups passed');
} finally {
  try {
    fs.chmodSync(reportsPath, 0o700);
  } catch {}
  fs.rmSync(workspacePath, { recursive: true, force: true });
  fs.rmSync(isolatedHome, { recursive: true, force: true });
}
