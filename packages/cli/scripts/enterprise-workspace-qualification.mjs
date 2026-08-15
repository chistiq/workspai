#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  assertQualificationReportIsPublicationSafe,
  createQualificationCommandRecord,
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
const modelSnapshot = '.workspai/reports/workspace-model-snapshot.json';
const diffArtifact = '.workspai/reports/workspace-model-diff-last-run.json';
const impactArtifact = '.workspai/reports/workspace-impact-last-run.json';
const archivePath = path.join(outputRoot, 'workspace.tar.gz');
const persistedGraph = readJson(
  path.join(workspacePath, '.workspai', 'reports', 'workspace-knowledge-graph.json')
);
const evidenceEntityId =
  persistedGraph?.entities?.find(
    (entity) => entity?.kind === 'project' && entity?.projectId === 'vscode'
  )?.id ?? 'vscode';
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
  ['workspace', 'graph', 'explain', 'vscode'],
  ['workspace', 'graph', 'entities', 'project', '--limit', '20'],
  ['workspace', 'graph', 'search', 'language binding core dependency', '--limit', '20'],
  ['workspace', 'graph', 'evidence', evidenceEntityId, '--limit', '20'],
  ['workspace', 'graph', 'benchmark', 'language binding core dependency', '--limit', '20'],
  ...['dot', 'mermaid', 'jsonld', 'graphml', 'gexf'].map((format) => [
    'workspace',
    'graph',
    format,
    '--output',
    path.join(outputRoot, `graph.${format}`),
  ]),
  ['workspace', 'watch', '--once'],
  ['workspace', 'context', '--for-agent', 'generic', '--write', '--no-agent-sync'],
  ['workspace', 'agent-sync', '--for-agent', 'codex', '--dry-run'],
  ['workspace', 'agent-sync', '--for-agent', 'copilot', '--dry-run'],
  ['workspace', 'agent-sync', '--for-agent', 'cursor', '--dry-run'],
  ['workspace', 'explain', '--write'],
  ['workspace', 'why', 'readiness', '--write'],
  ['workspace', 'remediation-plan', '--ci', '--write'],
  ['workspace', 'repair', 'capabilities'],
  ['workspace', 'repair', 'list'],
  ['workspace', 'policy', 'show'],
  ['workspace', 'share', '--output', path.join(outputRoot, 'workspace-share.json')],
  ['workspace', 'export', '--output', archivePath],
  ['workspace', 'archive', 'inspect', archivePath],
  ['workspace', 'archive', 'verify', archivePath],
  ['workspace', 'archive', 'doctor', archivePath],
  ['snapshot', 'create', 'enterprise-qualification', '--workspace', workspacePath],
  ['snapshot', 'list', '--workspace', workspacePath],
  ['snapshot', 'inspect', 'enterprise-qualification', '--workspace', workspacePath],
  ['snapshot', 'restore', 'enterprise-qualification', '--workspace', workspacePath, '--dry-run'],
  ['project', 'archive', 'vscode', '--workspace', workspacePath, '--dry-run'],
  ['project', 'delete', 'vscode', '--workspace', workspacePath, '--dry-run'],
];

const startedAt = new Date();
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
  commands: [],
};

for (const [commandIndex, argv] of commands.entries()) {
  const invocation = [...argv, '--json'];
  const started = Date.now();
  const result = spawnSync(args.cli ?? 'workspai', invocation, {
    cwd: workspacePath,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const parsed = parseJson(stdout);
  const exitCode = result.status ?? (result.error ? 1 : 0);
  report.commands.push({
    ...createQualificationCommandRecord({
      id: `command-${String(commandIndex + 1).padStart(3, '0')}`,
      result,
      parsed,
      startedAt: started,
    }),
    accepted: [0, 1, 2].includes(exitCode) && parsed !== null && !result.error,
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
