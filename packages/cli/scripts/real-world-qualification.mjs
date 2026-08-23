#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  assertQualificationReportIsPublicationSafe,
  createQualificationCommandRecord,
  isQualificationCommandAccepted,
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
const sourceMode = args.sourceMode ?? 'snapshot';
const isolatedStateRoot = path.join(runRoot, 'state');

if (!['snapshot', 'linked'].includes(sourceMode)) {
  fail('--source-mode must be snapshot or linked.');
}

if (projectNames.length === 0) {
  fail(
    'Pass --projects <comma-separated names>. Qualification never scans or mutates every sibling repository implicitly.'
  );
}

fs.mkdirSync(runRoot, { recursive: true });
fs.mkdirSync(isolatedStateRoot, { recursive: true });
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
    sourceMode: sourceMode === 'snapshot' ? 'local-git-snapshot' : 'linked',
    sourceCodeMutationAllowed: false,
    sourceMetadataMutationAllowed: sourceMode === 'linked',
    dependencyInstallationAllowed: false,
    lifecycleExecutionAllowed: false,
    infrastructureMutationAllowed: false,
    publicationAllowed: false,
  },
  projects: [],
};

for (const [projectIndex, projectName] of projectNames.entries()) {
  const sourceProjectPath = path.join(referenceRoot, projectName);
  const workspaceName = sharedWorkspaceName ?? slug(projectName);
  const workspacePath = path.join(runRoot, workspaceName);
  const project = {
    id: `project-${String(projectIndex + 1).padStart(3, '0')}`,
    status: 'running',
    commands: [],
    assertions: [],
  };
  report.projects.push(project);

  if (!isDirectory(sourceProjectPath)) {
    project.status = 'invalid-source';
    project.assertions.push(assertion('source.exists', false, 'Reference repository is missing.'));
    continue;
  }

  const projectPath =
    sourceMode === 'snapshot'
      ? prepareSourceSnapshot({ sourceProjectPath, runRoot, projectId: project.id })
      : sourceProjectPath;
  if (!projectPath) {
    project.status = 'failed';
    project.assertions.push(
      assertion(
        'source.snapshot-created',
        false,
        'A local Git snapshot could not be created; linked fallback requires explicit --source-mode linked.'
      )
    );
    project.durationMs = project.commands.reduce((sum, command) => sum + command.durationMs, 0);
    writeReport();
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
  const graphArtifact = readJsonFile(
    path.join(workspacePath, '.workspai', 'reports', 'workspace-knowledge-graph.json')
  );
  const serializedGraphArtifact = JSON.stringify(graphArtifact ?? {});
  project.assertions.push(
    assertion(
      'graph.proof-and-portability-contract',
      graphArtifact?.schemaVersion === 'workspace-knowledge-graph.v1' &&
        graphArtifact?.quality?.entityProofCoverageRatio === 1 &&
        graphArtifact?.quality?.relationProofCoverageRatio === 1 &&
        graphArtifact?.quality?.portable === true &&
        graphArtifact?.quality?.secretValuesEmitted === false &&
        graphArtifact?.providers?.every((provider) => provider?.status !== 'failed') &&
        ![referenceRoot, runRoot, projectPath, workspacePath].some((candidate) =>
          serializedGraphArtifact.includes(candidate)
        ),
      'The canonical graph must remain proof-carrying, portable, secret-free, and free of failed providers or machine-local paths.'
    )
  );

  if (sharedWorkspaceName) {
    const workspaceGoal = run(project, {
      id: 'goal.cumulative-workspace-preview',
      cwd: workspacePath,
      argv: [
        'goal',
        'Map the workspace architecture',
        '--scope',
        'workspace',
        '--dry-run',
        '--json',
      ],
      acceptedExitCodes: [0],
      timeoutMs: 600_000,
    });
    project.assertions.push(
      assertion(
        'goal.cumulative-workspace-scope',
        workspaceGoal.json?.schemaVersion === 'workspai.goal-plan-result.v1' &&
          workspaceGoal.json?.dryRun === true &&
          workspaceGoal.json?.goalPack?.scope?.kind === 'workspace' &&
          workspaceGoal.json?.goalPack?.scope?.selectionSource === 'explicit' &&
          workspaceGoal.json?.goalPack?.scope?.projects?.length === projectIndex + 1 &&
          workspaceGoal.json?.goalPack?.baseline?.projectCount === projectIndex + 1,
        'A cumulative workspace Goal must bind every project adopted so far without writing Goal artifacts.'
      )
    );
  }

  const goalPlan = run(project, {
    id: 'goal.system-understanding-plan',
    cwd: projectPath,
    argv: ['goal', 'Map the project architecture', '--for-agent', 'generic', '--json'],
    acceptedExitCodes: [0],
    timeoutMs: 600_000,
  });
  const goalId = goalPlan.json?.goalPack?.id;
  const portableGoal = JSON.stringify(goalPlan.json ?? {});
  project.assertions.push(
    assertion(
      'goal.plan-contract',
      goalPlan.json?.schemaVersion === 'workspai.goal-plan-result.v1' &&
        goalPlan.json?.goalPack?.scope?.kind === 'project' &&
        goalPlan.json?.goalPack?.scope?.projects?.length === 1 &&
        goalPlan.json?.agentHandoff?.goalId === goalId,
      'Goal planning must bind the project invocation to one portable Goal Pack and matching agent handoff.'
    )
  );
  project.assertions.push(
    assertion(
      'goal.portable-output',
      ![referenceRoot, runRoot, projectPath, workspacePath].some((candidate) =>
        portableGoal.includes(candidate)
      ),
      'Goal command output must not retain qualification or machine-local paths.'
    )
  );
  if (typeof goalId === 'string' && goalId.length > 0) {
    const goalStatus = run(project, {
      id: 'goal.status',
      cwd: projectPath,
      argv: ['goal', '--status', goalId, '--json'],
      acceptedExitCodes: [0],
      timeoutMs: 600_000,
    });
    project.assertions.push(
      assertion(
        'goal.lifecycle-contract',
        goalStatus.json?.schemaVersion === 'workspai.goal-lifecycle-result.v1' &&
          goalStatus.json?.operation === 'status' &&
          goalStatus.json?.activeGoalId === goalId &&
          goalStatus.json?.goal?.lifecycle === 'active',
        'Goal status must validate immutable bindings through the shared lifecycle result contract.'
      )
    );
  }

  const coverageGoal = run(project, {
    id: 'goal.coverage-preview',
    cwd: projectPath,
    argv: ['goal', 'Raise test coverage to 80%', '--dry-run', '--json'],
    acceptedExitCodes: [0],
    timeoutMs: 600_000,
  });
  project.assertions.push(
    assertion(
      'goal.coverage-preflight',
      coverageGoal.json?.schemaVersion === 'workspai.goal-plan-result.v1' &&
        coverageGoal.json?.dryRun === true &&
        ['ready-to-plan', 'needs-evidence', 'needs-confirmation', 'blocked'].includes(
          coverageGoal.json?.goalPack?.state
        ) &&
        hasValidCoverageMeasurementPreflight(coverageGoal.json?.goalPack),
      'Coverage goals must report either one runtime-specific measurement capability or an explicit bounded runtime decision without writing artifacts.'
    )
  );

  const releaseGoal = run(project, {
    id: 'goal.release-preview',
    cwd: projectPath,
    argv: ['goal', 'Prepare this project for release', '--dry-run', '--json'],
    acceptedExitCodes: [0],
    timeoutMs: 600_000,
  });
  project.assertions.push(
    assertion(
      'goal.release-intent',
      releaseGoal.json?.goalPack?.intent?.category === 'release-readiness' &&
        releaseGoal.json?.goalPack?.commands?.planVerifiedGoal?.includes(
          'workspace goal plan release-readiness'
        ),
      'The documented release phrase must compile to the deterministic release-readiness primitive.'
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
  const graphSearch = run(project, {
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
  project.assertions.push(
    assertion(
      'graph.search-contract',
      graphSearch.json?.schemaVersion === 'workspace-knowledge-search.v1' &&
        Array.isArray(graphSearch.json?.entities),
      'Bounded graph search must return its stable machine-readable retrieval contract.'
    )
  );
  const graphBenchmark = run(project, {
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
  project.assertions.push(
    assertion(
      'graph.benchmark-contract',
      graphBenchmark.json?.schemaVersion === 'workspace-graph-token-efficiency.v1',
      'Graph benchmarking must return its stable token-efficiency measurement contract.'
    )
  );
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
  const stateScope = sharedWorkspaceName ?? project.id;
  const isolatedStateDirectory = path.join(isolatedStateRoot, stateScope);
  const started = Date.now();
  const result = spawnSync(args.cli ?? 'workspai', spec.argv, {
    cwd: spec.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      WORKSPAI_STATE_DIR: isolatedStateDirectory,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    timeout: spec.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const parsed = parseJson(stdout);
  const accepted = isQualificationCommandAccepted({
    result,
    acceptedExitCodes: spec.acceptedExitCodes,
    parsed,
    expectJson: spec.expectJson !== false,
  });
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

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function assertion(id, passed, message) {
  return { id, passed: Boolean(passed), message };
}

function hasValidCoverageMeasurementPreflight(goalPack) {
  const measurement = goalPack?.preflight?.measurement;
  if (typeof measurement?.runtime === 'string' && measurement.runtime.length > 0) {
    return true;
  }
  return (
    goalPack?.state === 'needs-confirmation' &&
    goalPack?.decision?.required === true &&
    measurement?.status === 'requires-setup' &&
    measurement?.runtime === null &&
    Array.isArray(measurement?.runtimeChoices) &&
    measurement.runtimeChoices.length > 1
  );
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

function prepareSourceSnapshot({ sourceProjectPath, runRoot, projectId }) {
  const snapshotPath = path.join(runRoot, 'sources', projectId);
  if (fs.existsSync(snapshotPath)) return null;
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const clone = spawnSync(
    'git',
    ['clone', '--quiet', '--shared', '--no-tags', sourceProjectPath, snapshotPath],
    {
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    }
  );
  // Some restricted runners report a non-fatal spawn error after Git has
  // completed successfully. The process exit code and resulting Git worktree
  // are the authoritative success signals; stderr/error objects are never
  // persisted because they may contain machine-local paths.
  if (clone.status !== 0 || !isDirectory(snapshotPath)) return null;
  const verified = spawnSync('git', ['-C', snapshotPath, 'rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  return verified.status === 0 ? snapshotPath : null;
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
