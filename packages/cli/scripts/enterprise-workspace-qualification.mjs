#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  assertQualificationReportIsPublicationSafe,
  createQualificationCommandRecord,
  hasGovernedQualificationOutcome,
  isQualificationCommandAccepted,
  qualificationCommandAllowsGovernedBlock,
  selectQualificationLifecycleProjectId,
  selectQualificationProjectId,
  resolveQualificationProjectPath,
  summarizeQualificationCoverage,
  qualificationCommandTargets,
  qualificationInvocationCoversPath,
} from './qualification-publication-safety.mjs';

const args = parseArgs(process.argv.slice(2));
const workspacePath = path.resolve(args.workspace ?? '');
const reportPath = path.resolve(
  args.report ?? path.join(workspacePath, '.workspai', 'reports', 'enterprise-qualification.json')
);
if (!workspacePath || !fs.existsSync(path.join(workspacePath, '.workspai-workspace'))) {
  fail('Pass --workspace <managed workspace>.');
}

const outputRoot = path.join(path.dirname(reportPath), 'enterprise-qualification-artifacts');
fs.mkdirSync(outputRoot, { recursive: true });
const diagnosticsRoot =
  typeof args.diagnosticsDir === 'string' ? path.resolve(args.diagnosticsDir) : null;
if (diagnosticsRoot) fs.mkdirSync(diagnosticsRoot, { recursive: true, mode: 0o700 });
const commandSurface = readCommandSurface();
const commandTargets = qualificationCommandTargets(commandSurface);
const startedAt = new Date();
const snapshotName = `enterprise-qualification-${startedAt.toISOString().replace(/[^0-9]/g, '')}`;
const modelSnapshot = '.workspai/reports/workspace-model-snapshot.json';
const diffArtifact = '.workspai/reports/workspace-model-diff-last-run.json';
const impactArtifact = '.workspai/reports/workspace-impact-last-run.json';
const archivePath = path.join(outputRoot, 'workspace.tar.gz');
const persistedGraph = readJson(
  path.join(workspacePath, '.workspai', 'reports', 'workspace-knowledge-graph.json')
);
const workspaceContract = readJson(
  path.join(workspacePath, '.workspai', 'workspace.contract.json')
);
const workspaceModel = readJson(
  path.join(workspacePath, '.workspai', 'reports', 'workspace-model.json')
);
const importedRegistry = readJson(path.join(workspacePath, '.workspai', 'imported-projects.json'));
const projectPath = resolveQualificationProjectPath({
  workspacePath,
  requestedProject: args.project,
  workspaceContract,
  workspaceModel,
  importedRegistry,
});
const graphProject = persistedGraph?.entities?.find((entity) => entity?.kind === 'project');
const EVIDENCE_ENTITY_PLACEHOLDER = '__WORKSPAI_PROJECT_ENTITY__';
const EVIDENCE_PATH_TARGET_PLACEHOLDER = '__WORKSPAI_PATH_TARGET_ENTITY__';
const VERIFIED_GOAL_PLACEHOLDER = '__WORKSPAI_VERIFIED_GOAL__';
const GOAL_PACK_PLACEHOLDER = '__WORKSPAI_GOAL_PACK__';
const CHANGE_PLACEHOLDER = '__WORKSPAI_CHANGE__';
const CHANGE_EXPORT_PLACEHOLDER = '__WORKSPAI_CHANGE_EXPORT__';
let verifiedGoalId;
let goalPackId;
let changeId;
let changeState;
let projectCapabilities;
const predictionPath = path.join(outputRoot, 'qualification-prediction.json');
const effectPath = path.join(outputRoot, 'qualification-effect.json');
fs.writeFileSync(
  predictionPath,
  `${JSON.stringify(
    {
      operations: [
        {
          operation: 'change',
          targetKind: 'artifact',
          targetId: 'README.md',
          rationale:
            'Exercise the architecture-aware change contract without mutating repository source.',
          confidence: 'high',
        },
      ],
      assumptions: ['This qualification records no source mutation.'],
      predictedRisk: 'none',
    },
    null,
    2
  )}\n`,
  { mode: 0o600 }
);
fs.writeFileSync(
  effectPath,
  `${JSON.stringify(
    {
      id: 'qualification-no-source-mutation',
      effectClass: 'command',
      status: 'succeeded',
      summary: 'Completed the isolated qualification command without changing repository source.',
      command: ['workspai', 'commands', '--json'],
      artifacts: [],
      observedAt: startedAt.toISOString(),
      idempotencyKey: `qualification-no-source-mutation-${startedAt.getTime()}`,
    },
    null,
    2
  )}\n`,
  { mode: 0o600 }
);
const projectId = selectQualificationProjectId({
  graph: persistedGraph,
  contract: workspaceContract,
  model: workspaceModel,
  importedRegistry,
});
const lifecycleProjectId = selectQualificationLifecycleProjectId({
  workspacePath,
  contract: workspaceContract,
  model: workspaceModel,
  importedRegistry,
});
const evidenceEntityId = firstNonEmptyString(
  graphProject?.id,
  projectId ? EVIDENCE_ENTITY_PLACEHOLDER : null
);
const commands = [
  ['commands'],
  ['workspace', 'list'],
  ['workspace', 'sync'],
  ['workspace', 'registry', '--refresh'],
  ['workspace', 'foundation'],
  ['doctor', 'workspace', '--fresh', '--json', 'summary'],
  ['analyze'],
  ['readiness'],
  ['workspace', 'model', '--cache', '--write'],
  ['workspace', 'model', '--incremental', '--write'],
  ['workspace', 'snapshot'],
  ['workspace', 'diff', '--from', modelSnapshot],
  ['workspace', 'impact', '--from', diffArtifact],
  ['workspace', 'verify', '--from-impact', impactArtifact],
  ['workspace', 'trace', '--from', diffArtifact, '--write'],
  ['workspace', 'contract', 'inspect'],
  ['workspace', 'contract', 'sync', '--strict'],
  ['workspace', 'contract', 'verify', '--strict'],
  [
    'workspace',
    'contract',
    'graph',
    '--output',
    path.join(outputRoot, 'workspace-contract-graph.json'),
  ],
  [
    'workspace',
    'graph',
    'emit',
    '--output',
    path.join(outputRoot, 'workspace-knowledge-graph.json'),
  ],
  ...(projectId ? [['workspace', 'graph', 'explain', projectId]] : []),
  ['workspace', 'graph', 'entities', 'project', '--limit', '20'],
  ['workspace', 'graph', 'search', 'language binding core dependency', '--limit', '20'],
  ...(evidenceEntityId
    ? [['workspace', 'graph', 'evidence', evidenceEntityId, '--limit', '20']]
    : []),
  ...(evidenceEntityId
    ? [['workspace', 'graph', 'path', evidenceEntityId, EVIDENCE_PATH_TARGET_PLACEHOLDER]]
    : []),
  ['workspace', 'graph', 'benchmark', 'language binding core dependency', '--limit', '20'],
  ['workspace', 'graph', 'benchmark-suite', 'agent-core.v1', '--limit', '20', '--write'],
  ...['dot', 'mermaid', 'jsonld', 'graphml', 'gexf'].map((format) => [
    'workspace',
    'graph',
    format,
    '--output',
    path.join(outputRoot, `graph.${format}`),
  ]),
  [
    'workspace',
    'graph',
    'overlay',
    '--from',
    path.join(outputRoot, 'workspace-knowledge-graph.json'),
  ],
  ['workspace', 'watch', '--once'],
  ['live', '--once', '--projection', 'monitor'],
  ['live', '--once', '--projection', 'board'],
  {
    argv: [
      'live',
      '--capture',
      path.join(outputRoot, 'live-board-linkedin.svg'),
      '--capture-preset',
      'linkedin',
    ],
    cwd: workspacePath,
    expectJson: false,
  },
  ['workspace', 'context', '--for-agent', 'generic', '--write', '--no-agent-sync'],
  ['workspace', 'agent-sync', '--for-agent', 'codex', '--dry-run'],
  ['workspace', 'agent-sync', '--for-agent', 'copilot', '--dry-run'],
  ['workspace', 'agent-sync', '--for-agent', 'cursor', '--dry-run'],
  ['workspace', 'explain', '--write'],
  ['workspace', 'why', 'readiness', '--write'],
  ['workspace', 'remediation-plan', '--ci', '--write'],
  ['workspace', 'repair', 'capabilities'],
  ['workspace', 'repair', 'list'],
  ['workspace', 'intelligence', 'run', '--for-agent', 'generic', '--strict'],
  ['pipeline', '--skip-autopilot', '--no-agent-sync'],
  [
    'goal',
    'Map the polyglot service architecture',
    '--workspace',
    workspacePath,
    '--scope',
    'workspace',
    '--for-agent',
    'generic',
  ],
  ['change', 'begin', '--workspace', workspacePath, '--goal', GOAL_PACK_PLACEHOLDER],
  [
    'change',
    'predict',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--file',
    predictionPath,
  ],
  [
    'change',
    'authorize',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--effects',
    'command',
    '--granted-by',
    'qualification',
  ],
  [
    'change',
    'effect',
    'record',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--file',
    effectPath,
  ],
  ['change', 'status', '--workspace', workspacePath, '--change', CHANGE_PLACEHOLDER],
  ['change', 'explain', '--workspace', workspacePath, '--change', CHANGE_PLACEHOLDER],
  [
    'change',
    'verify',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--no-refresh',
  ],
  [
    'change',
    'resume',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--to',
    'authorized',
    '--reason',
    'Qualification observed the expected repository readiness blockers.',
    '--actor',
    'qualification',
  ],
  [
    'change',
    'abort',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--reason',
    'Qualification completed without source mutation.',
    '--actor',
    'qualification',
  ],
  ['change', 'capsule', 'validate', '--workspace', workspacePath, '--change', CHANGE_PLACEHOLDER],
  [
    'change',
    'capsule',
    'export',
    '--workspace',
    workspacePath,
    '--change',
    CHANGE_PLACEHOLDER,
    '--output',
    CHANGE_EXPORT_PLACEHOLDER,
  ],
  ['workspace', 'goal', 'plan', 'release-readiness'],
  ['workspace', 'goal', 'status', VERIFIED_GOAL_PLACEHOLDER],
  ['workspace', 'goal', 'verify', VERIFIED_GOAL_PLACEHOLDER, '--no-run'],
  ['goal', 'Update README documentation', '--scope', 'workspace', '--dry-run'],
  ['goal', '--list'],
  ['change', 'list'],
  ...(projectPath && projectId
    ? [
        {
          argv: [
            'adopt',
            projectPath,
            '--workspace',
            workspacePath,
            '--name',
            projectId,
            '--project-grounding',
            'off',
            '--dry-run',
          ],
          cwd: workspacePath,
        },
      ]
    : []),
  { argv: ['ai', 'info'], cwd: workspacePath, expectJson: false },
  ['ai', 'recommend', 'polyglot observability service'],
  { argv: ['config', 'show'], cwd: workspacePath, expectJson: false },
  ['infra', 'plan', '--workspace', workspacePath, '--dry-run'],
  ...(projectPath
    ? [
        { argv: ['project', 'commands'], cwd: projectPath },
        { argv: ['project', 'coverage', '--project', projectPath], cwd: projectPath },
      ]
    : []),
  ['project', 'archives', '--workspace', workspacePath],
  ...['init', 'test', 'build', 'start'].map((stage) => [
    'workspace',
    'run',
    stage,
    '--plan',
    '--no-gates',
  ]),
  ['workspace', 'policy', 'show'],
  ['workspace', 'share', '--output', path.join(outputRoot, 'workspace-share.json')],
  ['workspace', 'export', '--output', archivePath],
  ['workspace', 'archive', 'inspect', archivePath],
  ['workspace', 'archive', 'verify', archivePath],
  ['workspace', 'archive', 'doctor', archivePath],
  ['workspace', 'connect', workspacePath, '--project-grounding', 'off', '--dry-run'],
  [
    'workspace',
    'hydrate',
    archivePath,
    '--output',
    path.join(outputRoot, 'hydrated-preview'),
    '--dry-run',
  ],
  [
    'workspace',
    'import',
    archivePath,
    '--output',
    path.join(outputRoot, 'imported-preview'),
    '--project-grounding',
    'off',
    '--dry-run',
  ],
  ['workspace', 'eval', 'init', 'qualification', 'workspace-intelligence'],
  ['workspace', 'eval', 'status'],
  ['workspace', 'eval', 'report'],
  [
    'workspace',
    'eval',
    'compare',
    '--from',
    '.workspai/reports/workspace-intelligence-evaluation-last-run.json',
  ],
  ['snapshot', 'create', snapshotName, '--workspace', workspacePath],
  ['snapshot', 'list', '--workspace', workspacePath],
  ['snapshot', 'inspect', snapshotName, '--workspace', workspacePath],
  ['snapshot', 'restore', snapshotName, '--workspace', workspacePath, '--dry-run'],
  ...(lifecycleProjectId
    ? [
        ['project', 'archive', lifecycleProjectId, '--workspace', workspacePath, '--dry-run'],
        ['project', 'delete', lifecycleProjectId, '--workspace', workspacePath, '--dry-run'],
      ]
    : []),
  ...(projectPath
    ? [
        {
          argv: ['project', 'workspace', 'status', '--project', projectPath],
          cwd: projectPath,
        },
        {
          argv: ['doctor', 'project', '--fresh', '--json', 'summary'],
          cwd: projectPath,
        },
        {
          argv: [
            'agent',
            'bootstrap',
            '--project',
            projectPath,
            '--for-agent',
            'generic',
            '--strict',
          ],
          cwd: projectPath,
        },
        {
          argv: [
            'project',
            'agent-entry',
            'verify',
            '--project',
            projectPath,
            '--for-agent',
            'all',
            '--strict',
          ],
          cwd: projectPath,
        },
      ]
    : []),
];

const report = {
  schemaVersion: 'workspai.enterprise-workspace-qualification.v1',
  generatedAt: startedAt.toISOString(),
  publication: {
    safeToPublish: true,
    localPathsRetained: false,
    commandOutputRetained: false,
    generatedArtifacts: 'local-only-do-not-publish',
  },
  safety: {
    projectLifecycleExecutionAllowed: false,
    projectSourceMutationAllowed: false,
    destructiveOperations: 'dry-run-only',
    agentWrites: 'explicit-sync-dry-run;intelligence-writes-grounding',
  },
  coverage: {
    projectLifecycle: lifecycleProjectId ? 'dry-run' : 'skipped-no-managed-project',
    projectConsumers: projectPath ? 'pending' : 'skipped-no-project-path',
    liveCapture: 'pending',
    commandInventory: {
      total: commandTargets.length,
      functional: 0,
      dryRun: 0,
      planned: 0,
      surfaceOnly: 0,
      notApplicable: 0,
      failed: 0,
    },
  },
  commands: [],
};
const executedInvocations = [];

for (const [commandIndex, commandTemplate] of commands.entries()) {
  const commandSpec = Array.isArray(commandTemplate)
    ? { argv: commandTemplate, cwd: workspacePath }
    : commandTemplate;
  const argv = commandSpec.argv.map((part) => {
    if (part === EVIDENCE_ENTITY_PLACEHOLDER) return resolveGeneratedProjectEntityId();
    if (part === EVIDENCE_PATH_TARGET_PLACEHOLDER) return resolveGeneratedPathTargetEntityId();
    if (part === VERIFIED_GOAL_PLACEHOLDER)
      return verifiedGoalId ?? '__missing_qualification_goal__';
    if (part === GOAL_PACK_PLACEHOLDER) return goalPackId ?? '__missing_goal_pack__';
    if (part === CHANGE_PLACEHOLDER) return changeId ?? '__missing_change__';
    if (part === CHANGE_EXPORT_PLACEHOLDER) {
      return changeId
        ? path.join(workspacePath, '.workspai', 'changes', changeId, 'qualification-export.json')
        : path.join(outputRoot, '__missing_change_export__.json');
    }
    return part;
  });
  // A healthy repository can commit verification. Terminal transactions cannot
  // be resumed or aborted; preserve that success instead of manufacturing a failure.
  if (
    argv[0] === 'change' &&
    ((argv[1] === 'resume' && !['blocked', 'awaiting-human'].includes(changeState)) ||
      (argv[1] === 'abort' && ['committed', 'aborted'].includes(changeState)))
  ) {
    continue;
  }
  const expectJson = commandSpec.expectJson !== false;
  const invocation = !expectJson || argv.includes('--json') ? argv : [...argv, '--json'];
  const started = Date.now();
  const executable = args.cli ?? 'workspai';
  const nodeEntry = /\.[cm]?js$/u.test(executable);
  const result = spawnSync(
    nodeEntry ? process.execPath : executable,
    nodeEntry ? [executable, ...invocation] : invocation,
    {
      cwd: commandSpec.cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      timeout: 900_000,
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
    }
  );
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (diagnosticsRoot) {
    const prefix = path.join(
      diagnosticsRoot,
      `command-${String(commandIndex + 1).padStart(3, '0')}`
    );
    fs.writeFileSync(`${prefix}.stdout`, stdout, { mode: 0o600 });
    fs.writeFileSync(`${prefix}.stderr`, stderr, { mode: 0o600 });
    fs.writeFileSync(
      `${prefix}.invocation.json`,
      JSON.stringify({ argv: invocation, cwd: commandSpec.cwd }),
      { mode: 0o600 }
    );
  }
  const parsed = parseJson(stdout);
  if (argv[0] === 'project' && argv[1] === 'commands' && parsed?.commandMap) {
    projectCapabilities = parsed;
  }
  if (argv[0] === 'goal' && typeof parsed?.goalPack?.id === 'string') {
    goalPackId = parsed.goalPack.id;
  }
  if (argv[0] === 'change' && argv[1] === 'begin' && typeof parsed?.changeId === 'string') {
    changeId = parsed.changeId;
  }
  if (argv[0] === 'change' && typeof parsed?.state === 'string') {
    changeState = parsed.state;
  }
  if (argv.slice(0, 3).join(' ') === 'workspace goal plan' && typeof parsed?.goal?.id === 'string')
    verifiedGoalId = parsed.goal.id;
  const governedCommand = qualificationCommandAllowsGovernedBlock(argv);
  const acceptedExitCodes = governedCommand ? [0, 1, 2] : [0];
  const processAccepted = isQualificationCommandAccepted({
    result,
    acceptedExitCodes,
    parsed,
    expectJson,
  });
  const governedOutcome = result.status === 0 || hasGovernedQualificationOutcome(parsed);
  report.commands.push({
    ...(commandSpec.cwd === projectPath ? { coverageGroup: 'projectConsumers' } : {}),
    ...(argv[0] === 'live' && argv.includes('--capture') ? { coverageGroup: 'liveCapture' } : {}),
    ...createQualificationCommandRecord({
      id: `command-${String(commandIndex + 1).padStart(3, '0')}`,
      result,
      parsed,
      startedAt: started,
    }),
    acceptanceClass:
      processAccepted && result.status === 0
        ? 'succeeded'
        : processAccepted && governedOutcome
          ? 'governed-block'
          : 'failed',
    accepted: processAccepted && governedOutcome,
  });
  executedInvocations.push({
    invocation,
    accepted: processAccepted && governedOutcome,
    acceptanceClass:
      processAccepted && result.status === 0
        ? 'succeeded'
        : processAccepted && governedOutcome
          ? 'governed-block'
          : 'failed',
  });
  for (const group of ['projectConsumers', 'liveCapture']) {
    const records = report.commands.filter((command) => command.coverageGroup === group);
    if (records.length) report.coverage[group] = 'in-progress';
  }
  writeReport();
}

for (const target of commandTargets) {
  const direct = executedInvocations.find(({ invocation }) =>
    qualificationInvocationCoversPath(invocation, target.path)
  );
  const plannedProject =
    target.owner === 'runtime-adapter'
      ? executedInvocations.find(
          ({ invocation }) =>
            invocation[0] === 'workspace' &&
            invocation[1] === 'run' &&
            invocation[2] === target.path[0] &&
            invocation.includes('--plan')
        )
      : null;
  const covered = direct ?? plannedProject;
  if (covered) {
    const mode = plannedProject
      ? 'planned'
      : direct.invocation.includes('--dry-run')
        ? 'dryRun'
        : 'functional';
    if (!covered.accepted) report.coverage.commandInventory.failed += 1;
    else report.coverage.commandInventory[mode] += 1;
    continue;
  }
  const projectCapability = projectCapabilities?.commandMap?.[target.path[0]];
  if (
    target.owner === 'python-core' ||
    (target.owner === 'runtime-adapter' && projectCapability?.status === 'unsupported')
  ) {
    report.commands.push({
      id: `surface-${String(
        report.coverage.commandInventory.surfaceOnly +
          report.coverage.commandInventory.notApplicable +
          report.coverage.commandInventory.failed +
          1
      ).padStart(3, '0')}`,
      durationMs: 0,
      exitCode: 0,
      timedOut: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      commandSurface: target.path.join(' '),
      commandOwner: target.owner,
      commandScope: target.scope,
      coverageMode: 'not-applicable',
      reasonCode:
        target.owner === 'python-core'
          ? 'python-core-delegated-outside-selected-project'
          : 'runtime-command-unsupported-by-project-capabilities',
      acceptanceClass: 'not-applicable',
      accepted: true,
    });
    report.coverage.commandInventory.notApplicable += 1;
    continue;
  }
  const started = Date.now();
  const invocation = [...target.path, '--help'];
  const result = spawnCli(invocation, { cwd: workspacePath, timeout: 120_000 });
  const accepted = isQualificationCommandAccepted({
    result,
    acceptedExitCodes: [0],
    parsed: null,
    expectJson: false,
  });
  report.commands.push({
    ...createQualificationCommandRecord({
      id: `surface-${String(
        report.coverage.commandInventory.surfaceOnly +
          report.coverage.commandInventory.notApplicable +
          report.coverage.commandInventory.failed +
          1
      ).padStart(3, '0')}`,
      result,
      parsed: null,
      startedAt: started,
    }),
    commandSurface: target.path.join(' '),
    commandOwner: target.owner,
    commandScope: target.scope,
    coverageMode: 'surface-only',
    acceptanceClass: accepted ? 'succeeded' : 'failed',
    accepted,
  });
  if (accepted) report.coverage.commandInventory.surfaceOnly += 1;
  else report.coverage.commandInventory.failed += 1;
  writeReport();
}

report.completedAt = new Date().toISOString();
for (const group of ['projectConsumers', 'liveCapture']) {
  const records = report.commands.filter((command) => command.coverageGroup === group);
  if (records.length) report.coverage[group] = summarizeQualificationCoverage(records);
}
report.durationMs = Date.now() - startedAt.getTime();
report.summary = {
  total: report.commands.length,
  accepted: report.commands.filter((command) => command.accepted).length,
  failed: report.commands.filter((command) => !command.accepted).length,
  domainBlocked: report.commands.filter((command) => command.accepted && command.exitCode !== 0)
    .length,
};
writeReport();
process.stdout.write(
  `${JSON.stringify({ reportWritten: true, summary: report.summary }, null, 2)}\n`
);
process.exit(report.summary.failed > 0 ? 1 : 0);

function parseJson(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function spawnCli(invocation, options = {}) {
  const executable = args.cli ?? 'workspai';
  const nodeEntry = /\.[cm]?js$/u.test(executable);
  return spawnSync(
    nodeEntry ? process.execPath : executable,
    nodeEntry ? [executable, ...invocation] : invocation,
    {
      cwd: options.cwd ?? workspacePath,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      timeout: options.timeout ?? 900_000,
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
    }
  );
}

function readCommandSurface() {
  const result = spawnCli(['commands', '--json'], { cwd: workspacePath, timeout: 120_000 });
  const parsed = parseJson(result.stdout ?? '');
  if (result.status !== 0 || !parsed?.runtimeInventory)
    fail('Could not read the runtime command inventory.');
  return parsed;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function firstNonEmptyString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0) ?? null;
}

function resolveGeneratedProjectEntityId() {
  const graph = readGeneratedKnowledgeGraph();
  const entity = graph?.entities?.find(
    (candidate) =>
      candidate?.kind === 'project' && (!projectId || candidate?.projectId === projectId)
  );
  if (!entity?.id) {
    fail(
      `The generated knowledge graph has no project entity for ${projectId ?? 'this workspace'}.`
    );
  }
  return entity.id;
}

function resolveGeneratedPathTargetEntityId() {
  const graph = readGeneratedKnowledgeGraph();
  const projectEntityId = resolveGeneratedProjectEntityId();
  const relation = graph?.relations?.find(
    (candidate) => candidate?.from === projectEntityId || candidate?.to === projectEntityId
  );
  const target = relation?.from === projectEntityId ? relation?.to : relation?.from;
  if (!target) fail('The generated knowledge graph has no relation from its project entity.');
  return target;
}

function readGeneratedKnowledgeGraph() {
  const payload =
    readJson(path.join(outputRoot, 'workspace-knowledge-graph.json')) ?? persistedGraph ?? {};
  return payload.knowledgeGraph ?? payload.graph?.knowledgeGraph ?? payload;
}

function writeReport() {
  assertQualificationReportIsPublicationSafe(report, [workspacePath, reportPath, outputRoot]);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, reportPath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`[enterprise-workspace-qualification] ${message}\n`);
  process.exit(2);
}
