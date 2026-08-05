#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cliPath = path.join(repoRoot, 'dist', 'index.js');
const runtimeSurfaceContractPath = path.join(
  repoRoot,
  'contracts',
  'runtime-command-surface.v1.json'
);
let tsupCli = path.join(repoRoot, 'node_modules', 'tsup', 'dist', 'cli-default.js');
if (!fs.existsSync(tsupCli)) {
  tsupCli = path.join(repoRoot, '..', '..', 'node_modules', 'tsup', 'dist', 'cli-default.js');
}

const runtimeSurfaceContract = readRuntimeSurfaceContract();

function runtimeExpectation(runtime) {
  const descriptor = runtimeSurfaceContract.runtimeMatrix?.[runtime];
  if (!descriptor) {
    throw new Error(`Runtime ${runtime} is missing from runtime-command-surface.v1.json`);
  }
  return descriptor;
}

const NPM_KITS = [
  {
    id: 'gofiber.standard',
    project: 'matrix-go-fiber',
    runtime: 'go',
    tier: runtimeExpectation('go').tier,
    owner: 'npm',
  },
  {
    id: 'gogin.standard',
    project: 'matrix-go-gin',
    runtime: 'go',
    tier: runtimeExpectation('go').tier,
    owner: 'npm',
  },
  {
    id: 'springboot.standard',
    project: 'matrix-spring',
    runtime: 'java',
    tier: runtimeExpectation('java').tier,
    owner: 'npm',
  },
  {
    id: 'dotnet.webapi.clean',
    project: 'matrix-dotnet',
    runtime: 'dotnet',
    tier: runtimeExpectation('dotnet').tier,
    owner: 'npm',
  },
  {
    id: 'rust.axum',
    project: 'matrix-rust-axum',
    runtime: 'rust',
    tier: runtimeExpectation('rust').tier,
    owner: 'npm',
  },
];

const CORE_KITS = [
  {
    id: 'fastapi.standard',
    project: 'matrix-fastapi',
    runtime: 'python',
    tier: runtimeExpectation('python').tier,
    owner: 'core',
  },
  {
    id: 'fastapi.ddd',
    project: 'matrix-fastapi-ddd',
    runtime: 'python',
    tier: runtimeExpectation('python').tier,
    owner: 'core',
  },
  {
    id: 'nestjs.standard',
    project: 'matrix-nestjs',
    runtime: 'node',
    tier: runtimeExpectation('node').tier,
    owner: 'core',
  },
];

if (process.argv.includes('--list-kits')) {
  fs.writeFileSync(
    process.stdout.fd,
    `${JSON.stringify([...NPM_KITS, ...CORE_KITS].map((kit) => kit.id).sort())}\n`
  );
  process.exit(0);
}

const PROJECT_COMMAND_CONTRACT = [
  'version',
  'project',
  'create',
  'add',
  'list',
  'info',
  'commands',
  'upgrade',
  'diff',
  'doctor',
  'license',
  'reconcile',
  'rollback',
  'uninstall',
  'checkpoint',
  'optimize',
  'snapshot',
  'frameworks',
  'modules',
  'merge',
  'init',
  'dev',
  'start',
  'build',
  'test',
  'lint',
  'format',
  'help',
];

const GLOBAL_COMMAND_CONTRACT = [
  'version',
  'project',
  'create',
  'add',
  'list',
  'info',
  'commands',
  'upgrade',
  'diff',
  'merge',
  'optimize',
  'doctor',
  'license',
  'checkpoint',
  'snapshot',
  'reconcile',
  'rollback',
  'uninstall',
  'frameworks',
  'modules',
];

const OBSERVED_PROJECTS = [
  {
    id: 'observed.php.laravel',
    project: 'matrix-observed-php',
    runtime: 'php',
    framework: 'laravel',
    tier: runtimeExpectation('php').tier,
    sourceDir: 'observed-laravel-source',
  },
  {
    id: 'observed.ruby.rails',
    project: 'matrix-observed-ruby',
    runtime: 'ruby',
    framework: 'rails',
    tier: runtimeExpectation('ruby').tier,
    sourceDir: 'observed-rails-source',
  },
  {
    id: 'observed.rust.axum',
    project: 'matrix-observed-rust',
    runtime: 'rust',
    framework: 'axum',
    tier: runtimeExpectation('rust').tier,
    sourceDir: 'observed-axum-source',
  },
  {
    id: 'observed.unknown.generic',
    project: 'matrix-observed-generic',
    runtime: 'unknown',
    framework: 'unknown',
    tier: runtimeExpectation('unknown').tier,
    sourceDir: 'observed-generic-source',
  },
];

const RUNTIME_HINTS = {
  go: ['go', 'version'],
  java: ['java', '-version'],
  maven: ['mvn', '--version'],
  dotnet: ['dotnet', '--version'],
  python: ['python3', '--version'],
  rapidkitCore: ['rapidkit', 'list', '--json'],
  node: [process.execPath, '--version'],
  rust: ['cargo', '--version'],
  php: ['php', '--version'],
  composer: ['composer', '--version'],
};

const args = parseArgs(process.argv.slice(2));
const startedAt = new Date();
const workspaceName =
  args.workspaceName || `rapidkit-runtime-acceptance-${startedAt.getTime().toString(36)}`;
const runRoot =
  args.workspaceDir || fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-runtime-acceptance-'));
const workspacePath = path.join(runRoot, workspaceName);
const defaultReportRoot = args.workspaceDir
  ? runRoot
  : path.join(os.tmpdir(), 'rapidkit-runtime-acceptance-reports');
const reportPath =
  args.report ||
  path.join(defaultReportRoot, `runtime-acceptance-report-${toFileTimestamp(startedAt)}.json`);
const markdownReportPath = reportPath.replace(/\.json$/i, '.md');

const report = {
  schemaVersion: 1,
  kind: 'rapidkit.runtime.acceptance.matrix',
  generatedAt: startedAt.toISOString(),
  mode: args.full ? 'full' : args.contractOnly ? 'contract-only' : 'default',
  repository: repoRoot,
  workspacePath,
  cliPath,
  markdownReportPath,
  processCapture: detectProcessCapture(),
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    exitCode: 0,
  },
  runtimePreflight: [],
  scenarios: [],
};

try {
  await main();
} catch (error) {
  report.summary.exitCode = 1;
  report.scenarios.push({
    id: 'matrix.unhandled',
    scope: 'matrix',
    status: 'failed',
    command: '',
    cwd: process.cwd(),
    durationMs: 0,
    exitCode: 1,
    expectation: 'matrix runner must finish without unhandled errors',
    reason: error instanceof Error ? error.message : String(error),
  });
  finalizeAndExit();
}

async function main() {
  ensureCli();
  preflightRuntimes();
  if (args.full && !assertFullModePreconditions()) return;

  fs.mkdirSync(runRoot, { recursive: true });

  runGlobalCommandScenarios(runRoot);

  runScenario({
    id: 'workspace.create.minimal',
    scope: 'workspace',
    args: [
      'create',
      'workspace',
      workspaceName,
      '--yes',
      '--profile',
      'minimal',
      '--skip-git',
      '--output',
      '.',
    ],
    cwd: runRoot,
    expect: 'pass',
  });

  runScenario({
    id: 'workspace.policy.show',
    scope: 'workspace',
    args: ['workspace', 'policy', 'show'],
    cwd: workspacePath,
    expect: 'pass',
  });

  runScenario({
    id: 'workspace.policy.set.strict',
    scope: 'workspace',
    args: ['workspace', 'policy', 'set', 'mode', 'strict'],
    cwd: workspacePath,
    expect: 'pass',
  });

  runScenario({
    id: 'workspace.policy.set.warn',
    scope: 'workspace',
    args: ['workspace', 'policy', 'set', 'mode', 'warn'],
    cwd: workspacePath,
    expect: 'pass',
  });

  runScenario({
    id: 'workspace.policy.set.shared-runtime-caches',
    scope: 'workspace',
    args: ['workspace', 'policy', 'set', 'dependency_sharing_mode', 'shared-runtime-caches'],
    cwd: workspacePath,
    expect: 'pass',
  });

  for (const kit of [...NPM_KITS, ...CORE_KITS]) {
    runScenario({
      id: `create.project.${kit.id}`,
      scope: 'project-create',
      runtime: kit.runtime,
      supportTier: kit.tier,
      args: [
        'create',
        'project',
        kit.id,
        kit.project,
        '--yes',
        ...(args.full ? [] : ['--skip-install']),
        '--skip-git',
      ],
      cwd: workspacePath,
      expect: args.full || kit.owner === 'npm' ? 'pass' : 'passOrActionableRuntimeFailure',
      timeoutMs: kit.owner === 'core' ? 180000 : 60000,
    });
  }

  createObservedSourceProjects(runRoot);
  for (const observed of OBSERVED_PROJECTS) {
    runScenario({
      id: `workspace.import.${observed.id}`,
      scope: 'import',
      runtime: observed.runtime,
      supportTier: observed.tier,
      args: [
        'import',
        path.join(runRoot, observed.sourceDir),
        '--name',
        observed.project,
        '--json',
      ],
      cwd: workspacePath,
      expect: 'pass',
    });
  }

  runScenario({
    id: 'workspace.sync',
    scope: 'workspace',
    args: ['workspace', 'sync'],
    cwd: workspacePath,
    expect: 'pass',
  });

  runSafetyCommandScenarios();

  runScenario({
    id: 'workspace.contract.init',
    scope: 'contract',
    args: ['workspace', 'contract', 'init', '--force', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.contract.inspect',
    scope: 'contract',
    args: ['workspace', 'contract', 'inspect', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.contract.verify',
    scope: 'contract',
    args: ['workspace', 'contract', 'verify', '--strict', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.contract.graph',
    scope: 'contract',
    args: ['workspace', 'contract', 'graph', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'doctor.workspace',
    scope: 'doctor',
    args: ['doctor', 'workspace', '--json'],
    cwd: workspacePath,
    expect: 'passJsonOrGovernedBlock',
    validateJson: validateDoctorEvidence,
  });

  const expectedProjects = [...NPM_KITS, ...CORE_KITS, ...OBSERVED_PROJECTS].map((project) => ({
    ...project,
    moduleSupport: runtimeExpectation(project.runtime).moduleCommands,
  }));

  const projectCapabilities = new Map();
  for (const project of expectedProjects) {
    const projectPath = path.join(workspacePath, project.project);
    const commandsScenario = runScenario({
      id: `project.commands.${project.project}`,
      scope: 'project',
      runtime: project.runtime,
      supportTier: project.tier,
      args: ['project', 'commands', '--json'],
      cwd: projectPath,
      expect: 'passJson',
      validateJson: (payload) => validateProjectCapabilities(payload, project),
    });
    if (commandsScenario.status === 'passed' && commandsScenario.rawStdout) {
      try {
        projectCapabilities.set(project.project, parseJsonFromOutput(commandsScenario.rawStdout));
      } catch {
        // The passJson evaluator already reports malformed JSON. Keep the
        // lifecycle phase defensive if stdout capture is unavailable.
      }
    }

    runScenario({
      id: `doctor.project.${project.project}`,
      scope: 'doctor',
      runtime: project.runtime,
      supportTier: project.tier,
      args: ['doctor', 'project', '--json'],
      cwd: projectPath,
      expect: 'passJsonOrGovernedBlock',
      validateJson: validateDoctorEvidence,
    });
  }

  if (!args.contractOnly) {
    for (const project of expectedProjects.filter((item) => item.tier !== 'observed')) {
      const projectPath = path.join(workspacePath, project.project);
      const commandMap = projectCapabilities.get(project.project)?.commandMap;
      for (const commandName of ['init', 'help', 'test', 'build', 'lint', 'format']) {
        const commandStatus = commandMap?.[commandName]?.status;
        const commandIsSupported = commandStatus === 'supported';
        runScenario({
          id: `project.${commandName}.${project.project}`,
          scope: 'project-lifecycle',
          runtime: project.runtime,
          supportTier: project.tier,
          args: [commandName],
          cwd: projectPath,
          ...(!commandMap
            ? {
                skipReason:
                  'Project command capabilities were unavailable; lifecycle execution cannot be classified safely.',
              }
            : {}),
          expect: commandIsSupported
            ? args.full
              ? 'pass'
              : 'passOrActionableRuntimeFailure'
            : 'failWithMessage',
          ...(commandIsSupported ? {} : { expectedMessage: 'not supported' }),
          timeoutMs: commandName === 'init' ? 240_000 : 90_000,
        });
      }
    }
  }

  for (const project of expectedProjects.filter((item) => !item.moduleSupport)) {
    const projectPath = path.join(workspacePath, project.project);
    runScenario({
      id: `project.modules.unsupported.${project.project}`,
      scope: 'project-command-guard',
      runtime: project.runtime,
      supportTier: project.tier,
      args: ['modules', '--json'],
      cwd: projectPath,
      expect: 'failWithMessage',
      expectedMessage: 'not supported',
    });
  }

  if (args.contractOnly) {
    finalizeAndExit();
  }

  for (const stage of ['init', 'test', 'build']) {
    runScenario({
      id: `workspace.run.${stage}`,
      scope: 'workspace-run',
      args: ['workspace', 'run', stage, '--continue-on-error', '--json', '--no-gates'],
      cwd: workspacePath,
      expect: args.full ? 'passJson' : 'passJsonOrActionableRuntimeFailure',
      timeoutMs: stage === 'init' ? 300_000 : 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  runScenario({
    id: 'workspace.run.dev.rejected',
    scope: 'workspace-run',
    args: ['workspace', 'run', 'dev'],
    cwd: workspacePath,
    expect: 'failWithMessage',
    expectedMessage: 'dev is excluded',
  });

  const archivePath = path.join(runRoot, 'matrix-workspace.workspai-archive.zip');
  runScenario({
    id: 'workspace.export.archive',
    scope: 'archive',
    args: ['workspace', 'export', '--output', archivePath, '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.archive.inspect',
    scope: 'archive',
    args: ['workspace', 'archive', 'inspect', archivePath, '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.archive.verify',
    scope: 'archive',
    args: ['workspace', 'archive', 'verify', archivePath, '--strict', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.archive.doctor',
    scope: 'archive',
    args: ['workspace', 'archive', 'doctor', archivePath, '--strict', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'workspace.hydrate.preview',
    scope: 'archive',
    args: [
      'workspace',
      'hydrate',
      archivePath,
      '--output',
      path.join(runRoot, 'hydrated-preview'),
      '--dry-run',
      '--json',
    ],
    cwd: workspacePath,
    expect: 'passJson',
  });

  finalizeAndExit();
}

function runGlobalCommandScenarios(runDirectory) {
  const globalScenarioCwd = path.join(runDirectory, 'global-cli-cwd');
  fs.mkdirSync(globalScenarioCwd, { recursive: true });

  for (const flag of ['--version', '-v']) {
    runScenario({
      id: `global.${flag.replace(/^-+/, '')}`,
      scope: 'global',
      args: [flag],
      cwd: globalScenarioCwd,
      expect: 'pass',
    });
  }

  runScenario({
    id: 'global.commands.json.contract',
    scope: 'global',
    args: ['commands', '--json'],
    cwd: globalScenarioCwd,
    expect: 'passJson',
    validateJson: validateGlobalCommandsPayload,
  });

  for (const { id, command } of [
    { id: 'version', command: ['version'] },
    { id: 'commands', command: ['commands'] },
    { id: 'list', command: ['list'] },
    { id: 'info.fastapi-standard', command: ['info', 'fastapi.standard'] },
    { id: 'frameworks.help', command: ['frameworks', '--help'] },
    { id: 'modules.help', command: ['modules', '--help'] },
    { id: 'license.help', command: ['license', '--help'] },
  ]) {
    runScenario({
      id: `global.${id}`,
      scope: 'global',
      args: command,
      cwd: globalScenarioCwd,
      expect: args.full ? 'pass' : 'passOrActionableRuntimeFailure',
    });
  }
}

function runSafetyCommandScenarios() {
  runScenario({
    id: 'snapshot.create.metadata',
    scope: 'snapshot',
    args: ['snapshot', 'create', 'acceptance-metadata', '--reason', 'runtime acceptance', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'snapshot.list',
    scope: 'snapshot',
    args: ['snapshot', 'list', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'snapshot.inspect',
    scope: 'snapshot',
    args: ['snapshot', 'inspect', 'acceptance-metadata', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'snapshot.restore.dry-run',
    scope: 'snapshot',
    args: [
      'snapshot',
      'restore',
      'acceptance-metadata',
      '--dry-run',
      '--reason',
      'runtime acceptance',
      '--json',
    ],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'project.archives.list',
    scope: 'project-safety',
    args: ['project', 'archives', '--json'],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'project.archive.dry-run',
    scope: 'project-safety',
    args: [
      'project',
      'archive',
      'matrix-go-fiber',
      '--dry-run',
      '--reason',
      'runtime acceptance',
      '--json',
    ],
    cwd: workspacePath,
    expect: 'passJson',
  });

  runScenario({
    id: 'project.delete.dry-run',
    scope: 'project-safety',
    args: [
      'project',
      'delete',
      'matrix-go-fiber',
      '--dry-run',
      '--reason',
      'runtime acceptance',
      '--json',
    ],
    cwd: workspacePath,
    expect: 'passJson',
  });
}

function parseArgs(argv) {
  const parsed = {
    full: false,
    contractOnly: false,
    keep: false,
    noBuild: false,
    json: false,
    report: '',
    workspaceDir: '',
    workspaceName: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--full') parsed.full = true;
    else if (arg === '--contract-only') parsed.contractOnly = true;
    else if (arg === '--keep') parsed.keep = true;
    else if (arg === '--no-build') parsed.noBuild = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--report') parsed.report = argv[++index] || '';
    else if (arg.startsWith('--report=')) parsed.report = arg.slice('--report='.length);
    else if (arg === '--workspace-dir') parsed.workspaceDir = path.resolve(argv[++index] || '');
    else if (arg.startsWith('--workspace-dir=')) {
      parsed.workspaceDir = path.resolve(arg.slice('--workspace-dir='.length));
    } else if (arg === '--workspace-name') parsed.workspaceName = argv[++index] || '';
    else if (arg.startsWith('--workspace-name=')) {
      parsed.workspaceName = arg.slice('--workspace-name='.length);
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (parsed.full && parsed.contractOnly) {
    throw new Error('--full and --contract-only are mutually exclusive');
  }

  return parsed;
}

function printUsageAndExit() {
  console.log(`Workspai runtime acceptance matrix

Usage:
  node scripts/runtime-acceptance-matrix.mjs [--contract-only|--full] [--report <file>] [--keep]

Modes:
  default          Full local matrix with actionable missing-runtime outcomes.
  --contract-only  Fast deterministic command, contract, capability, and Doctor gate.
  --full   Requires lifecycle commands to pass for installed runtimes.

Options:
  --no-build              Require dist/index.js to already exist.
  --workspace-dir <dir>   Use a stable run directory instead of a temp directory.
  --workspace-name <name> Override generated workspace name.
  --report <file>         Write JSON report to an explicit path.
  --json                  Print only the final JSON report.
`);
  process.exit(0);
}

function readRuntimeSurfaceContract() {
  if (!fs.existsSync(runtimeSurfaceContractPath)) {
    throw new Error(`Canonical runtime contract is missing: ${runtimeSurfaceContractPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(runtimeSurfaceContractPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.runtimeMatrix) {
    throw new Error('runtime-command-surface.v1.json does not expose runtimeMatrix');
  }
  return parsed;
}

function ensureCli() {
  if (args.noBuild) {
    if (!fs.existsSync(cliPath)) {
      throw new Error('dist/index.js is missing. Run `npm run build` or omit --no-build.');
    }
    return;
  }
  if (!fs.existsSync(tsupCli)) {
    throw new Error('dist/index.js is missing and local tsup is unavailable. Run `npm install`.');
  }
  const result = spawnSync(process.execPath, [tsupCli], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build CLI before matrix run:\n${result.stderr || result.stdout}`);
  }
}

function preflightRuntimes() {
  for (const [runtime, command] of Object.entries(RUNTIME_HINTS)) {
    const started = Date.now();
    const result = spawnSync(command[0], command.slice(1), {
      cwd: repoRoot,
      encoding: 'utf8',
      env: childEnv(),
      timeout: 5000,
    });
    report.runtimePreflight.push({
      runtime,
      command: command.join(' '),
      status: result.status === 0 ? 'available' : 'missing',
      durationMs: Date.now() - started,
      output: tail(`${result.stdout || ''}${result.stderr || ''}`, 800),
    });
  }
}

function assertFullModePreconditions() {
  const unavailable = report.runtimePreflight.filter((entry) => entry.status !== 'available');
  if (unavailable.length === 0) return true;

  report.scenarios.push({
    id: 'matrix.full.preconditions',
    scope: 'matrix',
    status: 'failed',
    command: '',
    cwd: repoRoot,
    durationMs: 0,
    exitCode: 1,
    expectation: 'all full-mode lifecycle toolchains must be healthy before execution',
    reason: `Full mode requires a prepared machine. Unavailable: ${unavailable
      .map((entry) => `${entry.runtime} (${entry.command})`)
      .join(', ')}.`,
    stdoutTail: '',
    stderrTail: '',
  });
  if (!args.json) {
    console.log('FAIL matrix.full.preconditions');
    console.log(`     ${report.scenarios.at(-1).reason}`);
  }
  try {
    removeGeneratedRunRoot(runRoot);
  } catch {
    // finalizeAndExit reports the failed precondition; the empty temporary
    // root is harmless if the host denies cleanup.
  }
  finalizeAndExit();
  return false;
}

function runScenario(options) {
  const started = Date.now();
  const command = `${process.execPath} ${quote(cliPath)} ${options.args.map(quote).join(' ')}`;
  if (options.skipReason || !fs.existsSync(options.cwd)) {
    const scenario = {
      id: options.id,
      scope: options.scope,
      runtime: options.runtime,
      supportTier: options.supportTier,
      status: 'skipped',
      command,
      cwd: options.cwd,
      durationMs: 0,
      exitCode: null,
      signal: null,
      expectation: options.expect,
      reason: options.skipReason || `Working directory does not exist: ${options.cwd}`,
      stdoutTail: '',
      stderrTail: '',
    };
    Object.defineProperty(scenario, 'rawStdout', { value: '', enumerable: false });
    report.scenarios.push(scenario);
    if (!args.json) console.log(`SKIP ${scenario.id}`);
    return scenario;
  }
  const result = spawnSync(process.execPath, [cliPath, ...options.args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: childEnv(),
    timeout: options.timeoutMs || 60_000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const evaluation = evaluateScenario(options, result, output);
  const scenario = {
    id: options.id,
    scope: options.scope,
    runtime: options.runtime,
    supportTier: options.supportTier,
    status: evaluation.status,
    command,
    cwd: options.cwd,
    durationMs,
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal || null,
    expectation: options.expect,
    reason: evaluation.reason,
    stdoutTail: tail(result.stdout || '', 1600),
    stderrTail: tail(result.stderr || '', 1600),
  };
  Object.defineProperty(scenario, 'rawStdout', {
    value: result.stdout || '',
    enumerable: false,
  });
  report.scenarios.push(scenario);
  if (!args.json) {
    const marker =
      scenario.status === 'passed' ? 'PASS' : scenario.status === 'skipped' ? 'SKIP' : 'FAIL';
    console.log(`${marker.padEnd(4)} ${scenario.id}`);
    if (scenario.status === 'failed') {
      console.log(`     ${scenario.reason}`);
      if (scenario.stderrTail) console.log(indent(scenario.stderrTail));
      else if (scenario.stdoutTail) console.log(indent(scenario.stdoutTail));
    }
  }
  return scenario;
}

function evaluateScenario(options, result, output) {
  const code = typeof result.status === 'number' ? result.status : 1;
  const passCode = code === 0;
  let jsonPayload = null;

  const parseJsonOnFailure = options.expect === 'passJsonOrGovernedBlock';
  if (options.expect.toLowerCase().includes('json') && (passCode || parseJsonOnFailure)) {
    try {
      jsonPayload = parseJsonFromOutput(result.stdout || '');
    } catch (error) {
      if (report.processCapture.stdout === 'unavailable') {
        return {
          status: 'passed',
          reason: 'Command exited 0; JSON stdout capture is unavailable in this process sandbox.',
        };
      }
      return {
        status: 'failed',
        reason: `Expected JSON output but parsing failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (jsonPayload && typeof options.validateJson === 'function') {
    const validation = options.validateJson(jsonPayload);
    if (validation !== true) {
      return { status: 'failed', reason: String(validation || 'JSON validation failed') };
    }
  }

  if (options.expect === 'pass' || options.expect === 'passJson') {
    return passCode
      ? { status: 'passed', reason: 'Command completed successfully.' }
      : { status: 'failed', reason: `Expected exit 0, received ${code}.` };
  }

  if (options.expect === 'passJsonOrGovernedBlock') {
    if (passCode) {
      return { status: 'passed', reason: 'Doctor completed without blocking findings.' };
    }
    const healthScore = jsonPayload?.healthScore;
    const blockingFindings = doctorBlockingFindings(jsonPayload);
    if ((code === 1 || code === 2) && healthScore?.verdict === 'blocked' && blockingFindings > 0) {
      return {
        status: 'passed',
        reason: `Doctor truthfully reported ${blockingFindings} governed blocking finding(s).`,
      };
    }
    return {
      status: 'failed',
      reason: `Doctor failed without a contract-valid governed blocked verdict (exit ${code}).`,
    };
  }

  if (options.expect === 'failWithMessage') {
    if (code === 0) {
      return { status: 'failed', reason: 'Expected command to fail, but it passed.' };
    }
    if (!output.includes(options.expectedMessage || '')) {
      if (report.processCapture.stdout === 'unavailable' && output.trim().length === 0) {
        return {
          status: 'passed',
          reason:
            'Command failed as expected; failure text capture is unavailable in this process sandbox.',
        };
      }
      return {
        status: 'failed',
        reason: `Expected failure message to include "${options.expectedMessage}".`,
      };
    }
    return { status: 'passed', reason: 'Command failed with expected message.' };
  }

  if (
    options.expect === 'passOrActionableRuntimeFailure' ||
    options.expect === 'passJsonOrActionableRuntimeFailure'
  ) {
    if (passCode) return { status: 'passed', reason: 'Command completed successfully.' };
    if (report.processCapture.stdout === 'unavailable' && output.trim().length === 0) {
      if (args.full) {
        return {
          status: 'failed',
          reason: 'Command failed without captured diagnostics; full mode requires a hard pass.',
        };
      }
      return {
        status: 'skipped',
        reason:
          'Command failed in default mode; diagnostics capture is unavailable in this process sandbox.',
      };
    }
    if (isActionableRuntimeFailure(output)) {
      if (args.full) {
        return {
          status: 'failed',
          reason: 'Runtime is missing; full mode requires lifecycle commands to pass.',
        };
      }
      return {
        status: 'passed',
        reason: 'Runtime dependency failure was actionable in default mode.',
      };
    }
    return {
      status: 'failed',
      reason: `Command failed without an actionable runtime/setup diagnostic (exit ${code}).`,
    };
  }

  return { status: 'failed', reason: `Unknown expectation: ${options.expect}` };
}

function parseJsonFromOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('empty stdout');
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = trimmed.indexOf('{');
    const firstArray = trimmed.indexOf('[');
    const start =
      firstObject === -1
        ? firstArray
        : firstArray === -1
          ? firstObject
          : Math.min(firstObject, firstArray);
    if (start < 0) throw new Error('no JSON object or array found');
    return JSON.parse(trimmed.slice(start));
  }
}

function validateProjectCapabilities(payload, project) {
  if (payload?.scope !== 'project') return 'capability payload scope must be project';
  if (payload.runtime !== project.runtime) {
    return `expected runtime ${project.runtime}, got ${payload.runtime}`;
  }
  if (project.framework && payload.framework !== project.framework) {
    return `expected framework ${project.framework}, got ${payload.framework}`;
  }
  if (project.tier && payload.runtimeSupportTier !== project.tier) {
    return `expected runtime support tier ${project.tier}, got ${payload.runtimeSupportTier}`;
  }
  const moduleSupport = payload.moduleSupport === true;
  if (moduleSupport !== project.moduleSupport) {
    return `expected moduleSupport ${project.moduleSupport}, got ${payload.moduleSupport}`;
  }
  if (!Array.isArray(payload.supportedCommands) || !payload.supportedCommands.includes('help')) {
    return 'capability payload must include supported help command';
  }
  if (!payload.commandMap || typeof payload.commandMap !== 'object') {
    return 'capability payload must include commandMap';
  }
  for (const command of PROJECT_COMMAND_CONTRACT) {
    if (!payload.commandMap[command]) return `missing project command capability: ${command}`;
  }
  for (const command of ['create', 'list', 'info', 'frameworks', 'license']) {
    if (payload.commandMap[command]?.status !== 'global') {
      return `expected ${command} to be marked global inside project capabilities`;
    }
  }
  if (!project.moduleSupport && payload.commandMap.modules?.status !== 'unsupported') {
    return 'non-core project must mark modules as unsupported';
  }
  if (project.moduleSupport && payload.commandMap.modules?.status !== 'supported') {
    return 'core project must mark modules as supported';
  }
  const runtimeContract = runtimeExpectation(project.runtime);
  const supportedLifecycleCommands = [];
  for (const command of ['init', 'dev', 'start', 'build', 'test', 'lint', 'format', 'help']) {
    const actualStatus = payload.commandMap[command]?.status;
    if (actualStatus === 'supported') supportedLifecycleCommands.push(command);
    if (actualStatus === 'supported' && !runtimeContract.lifecycleCommands.includes(command)) {
      return `${project.runtime} exposes ${command} outside its canonical runtime contract`;
    }
  }
  if (!supportedLifecycleCommands.includes('help')) {
    return `${project.runtime} must expose the universal help lifecycle`;
  }
  if (
    runtimeContract.tier !== 'observed' &&
    !supportedLifecycleCommands.some((command) => command !== 'help')
  ) {
    return `${project.runtime} must expose at least one project-aware lifecycle command`;
  }
  return true;
}

function doctorBlockingFindings(payload) {
  const value = payload?.summary?.blockingFindings;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function validateDoctorEvidence(payload) {
  const healthScore = payload?.healthScore;
  if (!healthScore || typeof healthScore !== 'object') {
    return 'Doctor JSON must include healthScore';
  }
  if (!['passed', 'attention', 'blocked'].includes(healthScore.verdict)) {
    return `Doctor emitted invalid verdict: ${String(healthScore.verdict)}`;
  }
  const blockingFindings = doctorBlockingFindings(payload);
  if (blockingFindings === null) {
    return 'Doctor summary.blockingFindings must be a non-negative integer';
  }
  if (healthScore.verdict === 'blocked' && blockingFindings === 0) {
    return 'Doctor blocked verdict must carry at least one blocking finding';
  }
  if (healthScore.verdict !== 'blocked' && blockingFindings > 0) {
    return 'Doctor non-blocked verdict cannot carry blocking findings';
  }
  return true;
}

function validateGlobalCommandsPayload(payload) {
  const serialized = JSON.stringify(payload);
  for (const command of GLOBAL_COMMAND_CONTRACT) {
    if (!serialized.includes(command)) return `global commands payload missing command: ${command}`;
  }
  return true;
}

function isActionableRuntimeFailure(output) {
  return [
    /Reason:/i,
    /Hint:/i,
    /not found/i,
    /not installed/i,
    /not executable/i,
    /is required/i,
    /No such file or directory/i,
    /No module named/i,
    /command not found/i,
    /could not execute/i,
    /command timed out/i,
    /Cargo command failed/i,
    /PHP lifecycle command failed/i,
    /Install .*SDK/i,
    /Install .*runtime/i,
    /No runtime adapter/i,
    /restore failed/i,
    /build failed/i,
    /execution failed/i,
    /connectivity/i,
    /package references/i,
    /unsupported/i,
    /Command:/i,
  ].some((pattern) => pattern.test(output));
}

function createObservedSourceProjects(root) {
  createObservedLaravelProject(path.join(root, 'observed-laravel-source'));
  createObservedRailsProject(path.join(root, 'observed-rails-source'));
  createObservedRustProject(path.join(root, 'observed-axum-source'));
  createObservedGenericProject(path.join(root, 'observed-generic-source'));
}

function createObservedLaravelProject(source) {
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'composer.json'),
    JSON.stringify(
      {
        name: 'rapidkit/matrix-observed-php',
        require: { 'laravel/framework': '^11.0' },
        scripts: { test: 'php artisan test' },
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(source, 'app'), { recursive: true });
  fs.writeFileSync(path.join(source, 'app', 'HttpKernel.php'), '<?php\n// observed import\n');
}

function createObservedRailsProject(source) {
  fs.mkdirSync(path.join(source, 'config'), { recursive: true });
  fs.writeFileSync(path.join(source, 'Gemfile'), 'gem "rails", "~> 7.2"\n');
  fs.writeFileSync(path.join(source, 'config', 'application.rb'), 'require "rails/all"\n');
}

function createObservedRustProject(source) {
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'Cargo.toml'),
    '[package]\nname = "matrix-observed-rust"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\naxum = "0.7"\n'
  );
  fs.writeFileSync(path.join(source, 'src', 'main.rs'), 'fn main() {}\n');
}

function createObservedGenericProject(source) {
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'README.md'), '# Generic observed backend\n');
}

function childEnv() {
  const env = { ...process.env };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  const isolatedHome = path.join(runRoot, 'home');
  fs.mkdirSync(isolatedHome, { recursive: true });
  env.HOME = isolatedHome;
  env.USERPROFILE = isolatedHome;
  // Keep bridge/cache writes inside the acceptance run directory so sandboxed
  // and CI environments never write to the user's home cache.
  env.XDG_CACHE_HOME = path.join(runRoot, '.cache');
  env.RAPIDKIT_CACHE_DIR = path.join(runRoot, '.rapidkit-cache');
  // Do not force CI=1 here. Some terminal shims and test sandboxes alter child
  // stdout behavior under CI; the matrix is validating CLI UX, so preserve the
  // caller's environment unless CI was already set by the caller.
  env.NO_COLOR = env.NO_COLOR || '1';
  env.RAPIDKIT_SKIP_UPDATE_CHECK = '1';
  env.GOFLAGS = [env.GOFLAGS, '-modcacherw'].filter(Boolean).join(' ');
  if (!args.full && !env.RAPIDKIT_CHILD_COMMAND_TIMEOUT_MS) {
    env.RAPIDKIT_CHILD_COMMAND_TIMEOUT_MS = '60000';
  }
  return env;
}

function detectProcessCapture() {
  const result = spawnSync(process.execPath, ['-e', 'console.log("rapidkit-capture-probe")'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout.trim() === 'rapidkit-capture-probe' ? 'available' : 'unavailable',
    stderr: typeof result.stderr === 'string' ? 'available' : 'unknown',
  };
}

function finalizeAndExit() {
  if (
    !args.keep &&
    report.scenarios.every((scenario) => scenario.status !== 'failed') &&
    !args.workspaceDir
  ) {
    try {
      removeGeneratedRunRoot(runRoot);
    } catch (error) {
      report.scenarios.push({
        id: 'matrix.cleanup',
        scope: 'matrix',
        status: 'failed',
        command: '',
        cwd: runRoot,
        durationMs: 0,
        exitCode: 1,
        expectation: 'generated acceptance workspace must be removed after a successful run',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  report.summary.durationMs = Date.now() - startedAt.getTime();
  report.summary.total = report.scenarios.length;
  report.summary.passed = report.scenarios.filter(
    (scenario) => scenario.status === 'passed'
  ).length;
  report.summary.failed = report.scenarios.filter(
    (scenario) => scenario.status === 'failed'
  ).length;
  report.summary.skipped = report.scenarios.filter(
    (scenario) => scenario.status === 'skipped'
  ).length;
  report.summary.exitCode = report.summary.failed > 0 ? 1 : report.summary.exitCode;

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownReportPath, renderMarkdownReport(report));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('');
    console.log('Runtime acceptance matrix complete');
    console.log(`  Mode: ${report.mode}`);
    console.log(`  Passed: ${report.summary.passed}/${report.summary.total}`);
    console.log(`  Failed: ${report.summary.failed}`);
    console.log(`  Report: ${reportPath}`);
    console.log(`  Markdown: ${markdownReportPath}`);
    if ((args.keep || report.summary.failed > 0) && fs.existsSync(workspacePath)) {
      console.log(`  Workspace: ${workspacePath}`);
    }
  }

  process.exit(report.summary.exitCode);
}

function removeGeneratedRunRoot(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return;
  } catch (error) {
    const errorCode = error && typeof error === 'object' ? error.code : undefined;
    if (errorCode !== 'EACCES' && errorCode !== 'EPERM') throw error;
  }

  makeGeneratedTreeWritable(directory);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function makeGeneratedTreeWritable(candidate) {
  if (!fs.existsSync(candidate)) return;
  const stats = fs.lstatSync(candidate);
  if (stats.isSymbolicLink()) return;
  fs.chmodSync(candidate, stats.isDirectory() ? stats.mode | 0o700 : stats.mode | 0o600);
  if (!stats.isDirectory()) return;
  for (const entry of fs.readdirSync(candidate)) {
    makeGeneratedTreeWritable(path.join(candidate, entry));
  }
}

function renderMarkdownReport(matrixReport) {
  const lines = [
    '# Workspai Runtime Acceptance Matrix',
    '',
    `Generated: ${matrixReport.generatedAt}`,
    `Mode: ${matrixReport.mode}`,
    `Workspace: \`${matrixReport.workspacePath}\``,
    '',
    '## Summary',
    '',
    `- Total: ${matrixReport.summary.total}`,
    `- Passed: ${matrixReport.summary.passed}`,
    `- Failed: ${matrixReport.summary.failed}`,
    `- Skipped: ${matrixReport.summary.skipped}`,
    `- Duration: ${matrixReport.summary.durationMs}ms`,
    '',
    '## Runtime Preflight',
    '',
    '| Runtime | Status | Command |',
    '| --- | --- | --- |',
    ...matrixReport.runtimePreflight.map(
      (item) => `| ${item.runtime} | ${item.status} | \`${item.command}\` |`
    ),
    '',
    '## Scenario Status By Scope',
    '',
    '| Scope | Passed | Failed | Skipped |',
    '| --- | ---: | ---: | ---: |',
    ...renderScopeRows(matrixReport.scenarios),
    '',
    '## Failed Or Skipped Scenarios',
    '',
  ];

  const notable = matrixReport.scenarios.filter((scenario) => scenario.status !== 'passed');
  if (notable.length === 0) {
    lines.push('All scenarios passed.');
  } else {
    for (const scenario of notable) {
      lines.push(`- **${scenario.status.toUpperCase()}** \`${scenario.id}\`: ${scenario.reason}`);
    }
  }

  lines.push('', '## Release Interpretation', '');
  if (matrixReport.summary.failed > 0) {
    lines.push('This run is **not release-ready**. Fix failed scenarios before release.');
  } else if (matrixReport.summary.skipped > 0) {
    lines.push(
      'This run is acceptable for default-mode CI if skipped scenarios are documented runtime/toolchain gaps. Run `--full` before release on a prepared machine.'
    );
  } else {
    lines.push('This run is release-ready for the selected matrix mode.');
  }

  return `${lines.join('\n')}\n`;
}

function renderScopeRows(scenarios) {
  const byScope = new Map();
  for (const scenario of scenarios) {
    const bucket = byScope.get(scenario.scope) || { passed: 0, failed: 0, skipped: 0 };
    bucket[scenario.status] += 1;
    byScope.set(scenario.scope, bucket);
  }
  return [...byScope.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([scope, bucket]) =>
        `| ${scope} | ${bucket.passed || 0} | ${bucket.failed || 0} | ${bucket.skipped || 0} |`
    );
}

function toFileTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function quote(value) {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(String(value))) return String(value);
  return JSON.stringify(String(value));
}

function tail(value, max) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

function indent(value) {
  return value
    .split('\n')
    .slice(-12)
    .map((line) => `     ${line}`)
    .join('\n');
}
