import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'dist', 'index.js');
const contractPath = path.join(repoRoot, 'contracts', 'create-planner-capabilities.v1.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const availableGenerators = (contract.officialCreate ?? []).filter(
  (entry) => entry.status === 'available' && entry.canExecuteCreate === true
);
const generatorBySignal = new Map();
for (const generator of availableGenerators) {
  generatorBySignal.set(generator.id, generator);
  for (const alias of generator.aliases ?? []) {
    generatorBySignal.set(alias, generator);
  }
}

const argv = process.argv.slice(2);
const execute =
  argv.includes('--execute') || process.env.RAPIDKIT_OFFICIAL_GENERATOR_SMOKE === 'network';
const keep = argv.includes('--keep') || process.env.RAPIDKIT_OFFICIAL_GENERATOR_KEEP === '1';
const timeoutMs =
  Number.parseInt(process.env.RAPIDKIT_OFFICIAL_GENERATOR_TIMEOUT_MS ?? '', 10) || 300_000;
const selected = readListOption('--generators') ?? process.env.RAPIDKIT_OFFICIAL_GENERATORS;
const reportPath = process.env.RAPIDKIT_OFFICIAL_GENERATOR_REPORT;
const requestedSignals = selected
  ? selected
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  : availableGenerators.map((entry) => entry.id);
const targets = requestedSignals.map((signal) => generatorBySignal.get(signal)).filter(Boolean);
const unknown = requestedSignals.filter((signal) => !generatorBySignal.has(signal));
let activeGenerator = null;
let activeStage = 'contract-discovery';
const report = {
  schemaVersion: 1,
  kind: 'workspai.official_generator_smoke',
  generatedAt: new Date().toISOString(),
  mode: execute ? 'network' : 'contract',
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  requestedGenerators: requestedSignals,
  status: 'running',
  results: [],
};

if (unknown.length > 0) {
  fail(
    `unknown or unavailable generator(s): ${unknown.join(', ')}. Available: ${availableGenerators
      .map((entry) => entry.id)
      .join(', ')}`
  );
}

if (argv.includes('--list')) {
  writeFileSync(
    process.stdout.fd,
    `${JSON.stringify(availableGenerators.map((entry) => entry.id).sort())}\n`
  );
  process.exit(0);
}

if (argv.includes('--matrix')) {
  const matrixMode = readListOption('--matrix-mode') ?? 'full';
  if (!['primary', 'full'].includes(matrixMode)) {
    fail(`unsupported matrix mode "${matrixMode}"; expected primary or full`);
  }
  const defaultPlatforms =
    matrixMode === 'primary' ? 'ubuntu-latest' : 'ubuntu-latest,macos-latest,windows-latest';
  const platforms = (readListOption('--platforms') ?? defaultPlatforms)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const include = targets.flatMap((generator) =>
    platforms.map((os) => ({ generator: generator.id, os }))
  );
  writeFileSync(process.stdout.fd, `${JSON.stringify({ include })}\n`);
  process.exit(0);
}

if (!existsSync(cliPath)) {
  fail(`missing built CLI at ${cliPath}; run npm run build first`);
}

const workspaceRoot = path.resolve(
  process.env.RAPIDKIT_OFFICIAL_GENERATOR_WORKSPACE_ROOT || tmpdir()
);
mkdirSync(workspaceRoot, { recursive: true });
const workspaceDir = mkdtempSync(path.join(workspaceRoot, 'workspai-official-generator-smoke-'));
writeWorkspaceFoundation(workspaceDir);
const mode = execute ? 'network execute' : 'dry-run contract';
console.log(`[official-generator-smoke] mode=${mode}`);
console.log(`[official-generator-smoke] workspace=${workspaceDir}`);
console.log(`[official-generator-smoke] node=${process.execPath}`);

try {
  for (const generator of targets) {
    activeGenerator = generator.id;
    activeStage = execute ? 'create' : 'dry-run';
    const projectName = `smoke-${generator.id.replace(/[^a-z0-9-]/gi, '-')}`;
    const projectPath = path.join(workspaceDir, projectName);
    const command = [
      cliPath,
      'create',
      'project',
      generator.id,
      projectName,
      '--output',
      workspaceDir,
      '--skip-git',
      // Separate scaffold generation from dependency installation. This keeps
      // upstream generator diagnostics visible and lets the common build stage
      // verify installation consistently across operating systems.
      ...(execute && shouldDeferInstall(generator.id) ? ['--skip-install'] : []),
      ...(execute ? [] : ['--dry-run']),
    ];

    console.log(
      `[official-generator-smoke] ${generator.id}: ${process.execPath} ${command.join(' ')}`
    );
    const result = run(process.execPath, command, workspaceDir, timeoutMs);
    if (result.status !== 0) {
      printFailure(result);
      fail(`${generator.id} exited with ${result.status}`);
    }

    const output = `${result.stdout}\n${result.stderr}`;
    if (!execute) {
      assertDryRunContract(generator, output);
      report.results.push({
        generator: generator.id,
        status: 'passed',
        stages: ['dry-run'],
      });
      continue;
    }

    activeStage = 'artifacts-and-registry';
    validateGeneratedProject({
      generator,
      projectName,
      projectPath,
      workspaceDir,
    });
    activeStage = 'build';
    validateBuild(projectPath, generator.id);
    activeStage = 'doctor';
    validateDoctor(projectPath, workspaceDir, generator.id);
    report.results.push({
      generator: generator.id,
      status: 'passed',
      stages: ['create', 'artifacts', 'metadata', 'registry', 'build', 'doctor'],
    });
  }

  report.status = 'passed';
  persistReport();
  console.log(`[official-generator-smoke] PASS ${targets.length} generator(s)`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (keep) {
    console.log(`[official-generator-smoke] kept workspace ${workspaceDir}`);
  } else {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

function readListOption(name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? '');
}

function fail(message) {
  report.status = 'failed';
  report.error = message;
  report.failedGenerator = activeGenerator;
  report.failedStage = activeStage;
  persistReport();
  console.error(`[official-generator-smoke] ${message}`);
  process.exit(1);
}

function persistReport() {
  if (!reportPath) return;
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function run(command, args, cwd, timeout) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      CI: '1',
      npm_config_yes: 'true',
    },
  });
}

function shouldDeferInstall(generatorId) {
  return generatorId.startsWith('frontend.') || generatorId === 'desktop.tauri';
}

function validateBuild(projectPath, generatorId) {
  if (generatorId === 'php.laravel') {
    const artisan = run(
      process.platform === 'win32' ? 'php.exe' : 'php',
      ['artisan', '--version'],
      projectPath,
      timeoutMs
    );
    if (artisan.status !== 0) {
      printFailure(artisan);
      fail(`${generatorId} final Artisan bootstrap exited with ${artisan.status}`);
    }
    console.log(`[official-generator-smoke] ${generatorId}: final Artisan bootstrap passed`);
    return;
  }

  const manifestPath = path.join(projectPath, 'package.json');
  if (!existsSync(manifestPath)) {
    fail(`${generatorId} did not produce package.json for final build verification`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const scripts = manifest.scripts ?? {};
  const buildScript = ['build', 'compile', 'package', 'make'].find(
    (candidate) => typeof scripts[candidate] === 'string' && scripts[candidate].trim().length > 0
  );
  if (!buildScript) {
    fail(
      `${generatorId} does not expose a deterministic build/compile/package/make script in package.json`
    );
  }

  if (!existsSync(path.join(projectPath, 'node_modules'))) {
    const install = runNpm(['install', '--no-audit', '--no-fund'], projectPath);
    if (install.status !== 0) {
      printFailure(install);
      fail(`${generatorId} dependency install exited with ${install.status}`);
    }
  }

  const build = runNpm(['run', buildScript], projectPath);
  if (build.status !== 0) {
    printFailure(build);
    fail(`${generatorId} final "${buildScript}" build exited with ${build.status}`);
  }
  console.log(`[official-generator-smoke] ${generatorId}: final ${buildScript} build passed`);
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], cwd, timeoutMs);
  }
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd, timeoutMs);
}

function printFailure(result) {
  if (result.error) {
    console.error(result.error);
  }
  if (result.stdout) {
    console.error(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function assertDryRunContract(generator, output) {
  if (!output.includes('Dry run:') && !output.includes('Workspai frontend create plan:')) {
    fail(`${generator.id} dry-run did not describe a no-write plan`);
  }
  const expectedTokens = [...(generator.officialCommands ?? [])]
    .flatMap((command) => [...command.matchAll(/(?:@[\w.-]+\/)?[\w.-]+@(?:latest|stable)\b/g)])
    .map((match) => match[0]);
  for (const token of expectedTokens) {
    if (!output.includes(token)) {
      fail(`${generator.id} dry-run missing official command token "${token}"`);
    }
  }
}

function validateGeneratedProject(input) {
  const projectMetadataPath = path.join(input.projectPath, '.workspai', 'project.json');
  const contextPath = path.join(input.projectPath, '.workspai', 'context.json');
  const evidencePath = path.join(
    input.projectPath,
    '.workspai',
    input.generator.id.startsWith('frontend.') ? 'frontend-create.json' : 'official-create.json'
  );
  for (const requiredPath of [projectMetadataPath, contextPath, evidencePath]) {
    if (!existsSync(requiredPath)) {
      fail(`${input.generator.id} missing governed artifact ${requiredPath}`);
    }
  }

  const metadata = JSON.parse(readFileSync(projectMetadataPath, 'utf8'));
  if (metadata.kit !== input.generator.id || metadata.generated_by !== 'workspai') {
    fail(`${input.generator.id} wrote inconsistent canonical project metadata`);
  }

  const workspaceStatePath = path.join(input.workspaceDir, '.workspai', 'workspace.json');
  const workspaceContractPath = path.join(
    input.workspaceDir,
    '.workspai',
    'workspace.contract.json'
  );
  for (const requiredPath of [workspaceStatePath, workspaceContractPath]) {
    if (!existsSync(requiredPath)) {
      fail(`${input.generator.id} did not preserve workspace state at ${requiredPath}`);
    }
  }
  const workspaceContract = JSON.parse(readFileSync(workspaceContractPath, 'utf8'));
  const registeredProjects = Array.isArray(workspaceContract.projects)
    ? workspaceContract.projects
    : [];
  if (
    !registeredProjects.some(
      (project) =>
        project?.slug === input.projectName &&
        project?.kit === input.generator.id &&
        project?.relativePath === input.projectName
    )
  ) {
    fail(`${input.generator.id} was not registered in the canonical workspace contract`);
  }
}

function validateDoctor(projectPath, workspaceDir, generatorId) {
  const result = run(
    process.execPath,
    [cliPath, 'doctor', 'project', '--json'],
    projectPath,
    timeoutMs
  );
  if (result.error || result.status === null || ![0, 1, 2].includes(result.status)) {
    printFailure(result);
    fail(`${generatorId} Doctor verification exited with ${result.status}`);
  }
  const payload = extractJson(result.stdout);
  if (!payload || typeof payload !== 'object') {
    fail(`${generatorId} Doctor did not emit a valid JSON result`);
  }
  if (!payload.project || path.resolve(payload.project.path ?? '') !== path.resolve(projectPath)) {
    fail(`${generatorId} Doctor evidence does not identify the generated project`);
  }
  const doctorArtifact = path.join(
    workspaceDir,
    '.workspai',
    'reports',
    'doctor-project-last-run.json'
  );
  if (!existsSync(doctorArtifact)) {
    fail(`${generatorId} Doctor did not persist ${doctorArtifact}`);
  }
}

function extractJson(value) {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function writeWorkspaceFoundation(workspaceDir) {
  mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, '.workspai-workspace'),
    `${JSON.stringify(
      {
        signature: 'WORKSPAI_WORKSPACE',
        createdBy: 'workspai-cli',
        version: 'smoke',
        createdAt: new Date().toISOString(),
        name: path.basename(workspaceDir),
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    path.join(workspaceDir, '.workspai', 'workspace.json'),
    `${JSON.stringify({ name: path.basename(workspaceDir), version: 1, projects: [] }, null, 2)}\n`
  );
}
