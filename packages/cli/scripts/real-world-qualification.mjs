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
if (!args.referenceRoot) {
  fail('Pass --reference-root <directory>. No machine-specific default is permitted.');
}
const referenceRoot = path.resolve(args.referenceRoot);
const runRoot = path.resolve(args.runRoot ?? '/tmp/workspai-real-world-qualification');
const reportPath = path.resolve(
  args.report ?? path.join(runRoot, 'real-world-qualification-last-run.json')
);
const projectNames = (args.projects ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const sharedWorkspaceName = args.sharedWorkspace ? slug(args.sharedWorkspace) : null;

if (projectNames.length === 0) {
  fail(
    'Pass --projects <comma-separated names>. Qualification never scans or mutates every sibling repository implicitly.'
  );
}

fs.mkdirSync(runRoot, { recursive: true });
const startedAt = new Date();
const report = {
  schemaVersion: 'workspai.real-world-qualification.v1',
  generatedAt: startedAt.toISOString(),
  publication: {
    safeToPublish: true,
    projectIdentifiers: 'anonymized',
    localPathsRetained: false,
    commandOutputRetained: false,
  },
  workspaceLayout: sharedWorkspaceName ? 'shared' : 'isolated',
  safety: {
    sourceMode: 'linked',
    sourceCodeMutationAllowed: false,
    dependencyInstallationAllowed: false,
    lifecycleExecutionAllowed: false,
    infrastructureMutationAllowed: false,
    publicationAllowed: false,
  },
  projects: [],
};

for (const [projectIndex, projectName] of projectNames.entries()) {
  const projectPath = path.join(referenceRoot, projectName);
  const workspaceName = sharedWorkspaceName ?? slug(projectName);
  const workspacePath = path.join(runRoot, workspaceName);
  const project = {
    id: `project-${String(projectIndex + 1).padStart(3, '0')}`,
    status: 'running',
    commands: [],
    assertions: [],
  };
  report.projects.push(project);

  if (!isDirectory(projectPath)) {
    project.status = 'invalid-source';
    project.assertions.push(assertion('source.exists', false, 'Reference repository is missing.'));
    continue;
  }

  if (!isWorkspace(workspacePath)) {
    const workspaceCreate = run(project, {
      id: 'workspace.create',
      cwd: runRoot,
      argv: [
        'create',
        'workspace',
        workspaceName,
        '--output',
        runRoot,
        '--yes',
        '--profile',
        'polyglot',
        '--skip-python-engine',
        '--skip-git',
      ],
      acceptedExitCodes: [0],
      expectJson: false,
      timeoutMs: 120_000,
    });
    if (!workspaceCreate.accepted) {
      project.status = 'failed';
      project.assertions.push(
        assertion(
          'workspace.created',
          false,
          'The isolated workspace could not be created; downstream checks were not run.'
        )
      );
      project.durationMs = project.commands.reduce((sum, command) => sum + command.durationMs, 0);
      writeReport();
      continue;
    }
  }

  const adopt = run(project, {
    id: 'project.adopt',
    cwd: projectPath,
    argv: [
      'adopt',
      projectPath,
      '--workspace',
      workspacePath,
      '--name',
      projectName,
      '--project-grounding',
      'managed',
      '--json',
    ],
    acceptedExitCodes: [0],
    timeoutMs: 600_000,
  });
  const adoptedProject = adopt.json?.adoptedProject;
  if (!adopt.accepted) {
    project.status = 'failed';
    project.assertions.push(
      assertion(
        'project.adopted',
        false,
        'The project could not be adopted; downstream checks were not run.'
      )
    );
    project.durationMs = project.commands.reduce((sum, command) => sum + command.durationMs, 0);
    writeReport();
    continue;
  }
  project.assertions.push(
    assertion(
      'adopt.runtime-composition',
      Array.isArray(adoptedProject?.runtimeCandidates) &&
        adoptedProject.runtimeCandidates.length > 0,
      'Adoption must publish at least one detected runtime candidate.'
    )
  );

  run(project, {
    id: 'project.workspace-status',
    cwd: projectPath,
    argv: ['project', 'workspace', 'status', '--json'],
    acceptedExitCodes: [0],
    timeoutMs: 60_000,
  });
  const capabilities = run(project, {
    id: 'project.commands',
    cwd: projectPath,
    argv: ['project', 'commands', '--json'],
    acceptedExitCodes: [0],
    timeoutMs: 120_000,
  });
  project.assertions.push(
    assertion(
      'commands.lifecycle-truth',
      capabilities.json?.compositeRuntime !== true ||
        capabilities.json?.lifecycleCoverage === 'primary-runtime-only',
      'Composite projects must not claim complete lifecycle coverage from one primary adapter.'
    )
  );

  const doctorProject = run(project, {
    id: 'doctor.project',
    cwd: projectPath,
    argv: ['doctor', 'project', '--fresh', '--json', 'summary'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });
  project.assertions.push(
    assertion(
      'doctor.summary-contract',
      doctorProject.json?.schemaVersion === 'workspai.doctor-summary.v1' &&
        typeof doctorProject.json?.verdict === 'string',
      'Doctor must return its bounded summary contract even when repository readiness is blocked.'
    )
  );

  const intelligence = run(project, {
    id: 'workspace.intelligence',
    cwd: workspacePath,
    argv: ['workspace', 'intelligence', 'run', '--for-agent', 'generic', '--strict', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 900_000,
  });
  project.assertions.push(
    assertion(
      'intelligence.chain-contract',
      intelligence.json?.schemaVersion === 'workspace-intelligence-run.v1' &&
        Array.isArray(intelligence.json?.stages) &&
        intelligence.json.stages.some((stage) => stage?.id === 'model') &&
        intelligence.json.stages.some((stage) => stage?.id === 'context'),
      'The canonical chain must retain model and agent-context stages on blocked repositories.'
    )
  );

  run(project, {
    id: 'workspace.model-cache',
    cwd: workspacePath,
    argv: ['workspace', 'model', '--cache', '--write', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });
  run(project, {
    id: 'workspace.model-incremental',
    cwd: workspacePath,
    argv: ['workspace', 'model', '--incremental', '--write', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });
  run(project, {
    id: 'workspace.graph-search',
    cwd: workspacePath,
    argv: [
      'workspace',
      'graph',
      'search',
      'language binding core dependency',
      '--limit',
      '10',
      '--json',
    ],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });
  run(project, {
    id: 'workspace.graph-benchmark',
    cwd: workspacePath,
    argv: [
      'workspace',
      'graph',
      'benchmark',
      'language binding core dependency',
      '--limit',
      '10',
      '--json',
    ],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });
  run(project, {
    id: 'workspace.context',
    cwd: workspacePath,
    argv: [
      'workspace',
      'context',
      '--for-agent',
      'generic',
      '--write',
      '--no-agent-sync',
      '--json',
    ],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });
  run(project, {
    id: 'workspace.contract-verify',
    cwd: workspacePath,
    argv: ['workspace', 'contract', 'verify', '--strict', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 300_000,
  });
  run(project, {
    id: 'workspace.explain',
    cwd: workspacePath,
    argv: ['workspace', 'explain', '--write', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 300_000,
  });
  run(project, {
    id: 'workspace.remediation-plan',
    cwd: workspacePath,
    argv: ['workspace', 'remediation-plan', '--ci', '--write', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 300_000,
  });
  run(project, {
    id: 'project.coverage-inspect',
    cwd: projectPath,
    argv: ['project', 'coverage', '--target', '80', '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 300_000,
  });
  run(project, {
    id: 'readiness',
    cwd: workspacePath,
    argv: ['readiness', '--workspace', workspacePath, '--json'],
    acceptedExitCodes: [0, 1, 2],
    timeoutMs: 600_000,
  });

  const commandFailures = project.commands.filter((command) => !command.accepted);
  const assertionFailures = project.assertions.filter((item) => !item.passed);
  project.status =
    commandFailures.length === 0 && assertionFailures.length === 0 ? 'qualified' : 'failed';
  project.durationMs = project.commands.reduce((sum, command) => sum + command.durationMs, 0);
  writeReport();
}

report.completedAt = new Date().toISOString();
report.durationMs = Date.now() - startedAt.getTime();
report.summary = {
  total: report.projects.length,
  qualified: report.projects.filter((project) => project.status === 'qualified').length,
  failed: report.projects.filter((project) => project.status === 'failed').length,
  invalidSource: report.projects.filter((project) => project.status === 'invalid-source').length,
  commandCount: report.projects.reduce((sum, project) => sum + project.commands.length, 0),
  unexpectedCommandFailures: report.projects.reduce(
    (sum, project) => sum + project.commands.filter((command) => !command.accepted).length,
    0
  ),
  assertionFailures: report.projects.reduce(
    (sum, project) => sum + project.assertions.filter((item) => !item.passed).length,
    0
  ),
};
writeReport();
process.stdout.write(
  `${JSON.stringify({ reportWritten: true, summary: report.summary }, null, 2)}\n`
);
process.exit(report.summary.failed > 0 || report.summary.invalidSource > 0 ? 1 : 0);

function run(project, spec) {
  const started = Date.now();
  const result = spawnSync(args.cli ?? 'workspai', spec.argv, {
    cwd: spec.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: spec.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const parsed = parseJson(stdout);
  const accepted =
    spec.acceptedExitCodes.includes(exitCode) &&
    (spec.expectJson === false || parsed !== null) &&
    !result.error;
  const record = {
    ...createQualificationCommandRecord({ id: spec.id, result, parsed, startedAt: started }),
    accepted,
  };
  project.commands.push(record);
  writeReport();
  return { ...record, json: parsed };
}

function parseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function assertion(id, passed, message) {
  return { id, passed: Boolean(passed), message };
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isWorkspace(target) {
  return (
    fs.existsSync(path.join(target, '.workspai-workspace')) ||
    fs.existsSync(path.join(target, '.rapidkit-workspace'))
  );
}

function slug(value) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return normalized || 'qualified-project';
}

function writeReport() {
  assertQualificationReportIsPublicationSafe(report, [referenceRoot, runRoot, reportPath]);
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
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`[real-world-qualification] ${message}\n`);
  process.exit(2);
}
