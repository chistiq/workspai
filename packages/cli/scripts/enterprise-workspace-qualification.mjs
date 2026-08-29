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
  requestedProject: args.project,
  workspaceContract,
  workspaceModel,
  importedRegistry,
});
const graphProject = persistedGraph?.entities?.find((entity) => entity?.kind === 'project');
const EVIDENCE_ENTITY_PLACEHOLDER = '__WORKSPAI_PROJECT_ENTITY__';
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
  ['workspace', 'graph', 'benchmark', 'language binding core dependency', '--limit', '20'],
  ['workspace', 'graph', 'benchmark-suite', 'agent-core.v1', '--limit', '20', '--write'],
  ...['dot', 'mermaid', 'jsonld', 'graphml', 'gexf'].map((format) => [
    'workspace',
    'graph',
    format,
    '--output',
    path.join(outputRoot, `graph.${format}`),
  ]),
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
  ['workspace', 'policy', 'show'],
  ['workspace', 'share', '--output', path.join(outputRoot, 'workspace-share.json')],
  ['workspace', 'export', '--output', archivePath],
  ['workspace', 'archive', 'inspect', archivePath],
  ['workspace', 'archive', 'verify', archivePath],
  ['workspace', 'archive', 'doctor', archivePath],
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
    agentWrites: 'dry-run-only',
  },
  coverage: {
    projectLifecycle: lifecycleProjectId ? 'dry-run' : 'skipped-no-managed-project',
    projectConsumers: projectPath ? 'verified' : 'skipped-no-project-path',
    liveCapture: 'verified',
  },
  commands: [],
};

for (const [commandIndex, commandTemplate] of commands.entries()) {
  const commandSpec = Array.isArray(commandTemplate)
    ? { argv: commandTemplate, cwd: workspacePath }
    : commandTemplate;
  const argv = commandSpec.argv.map((part) =>
    part === EVIDENCE_ENTITY_PLACEHOLDER ? resolveGeneratedProjectEntityId() : part
  );
  const expectJson = commandSpec.expectJson !== false;
  const invocation = !expectJson || argv.includes('--json') ? argv : [...argv, '--json'];
  const started = Date.now();
  const result = spawnSync(args.cli ?? 'workspai', invocation, {
    cwd: commandSpec.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const parsed = parseJson(stdout);
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
  writeReport();
}

report.completedAt = new Date().toISOString();
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

function resolveQualificationProjectPath({
  requestedProject,
  workspaceContract,
  workspaceModel,
  importedRegistry,
}) {
  const candidates = [
    requestedProject,
    importedRegistry?.projects?.[0]?.path,
    workspaceContract?.projects?.[0]?.externalPath,
    workspaceModel?.projects?.[0]?.path,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue;
    const resolved = path.resolve(candidate);
    if (
      fs.existsSync(path.join(resolved, '.workspai', 'project.json')) &&
      fs.statSync(resolved).isDirectory()
    ) {
      return resolved;
    }
  }
  return null;
}

function resolveGeneratedProjectEntityId() {
  const graph = readJson(path.join(outputRoot, 'workspace-knowledge-graph.json')) ?? persistedGraph;
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
