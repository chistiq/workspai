import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import {
  isGoProject,
  isJavaProject,
  isNodeProject,
  isPythonProject,
  readRapidkitProjectJson,
} from './utils/runtime-detection.js';
import {
  assertDoctorEvidenceSemanticInvariants,
  isDoctorEvidencePayloadCompatible,
} from './utils/doctor-evidence-contract.js';
import { findWorkspaceRootUp, isWorkspaceShellDirectory } from './utils/workspace-root.js';
import {
  resolveGovernanceRunId,
  withGovernanceRunMetadata,
} from './utils/governance-report-metadata.js';
import {
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
} from './utils/artifact-path-compat.js';
import { workspaceMetadataCandidates } from './utils/workspace-paths.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import { assertWorkspaceArtifactContract } from './contracts/artifact-contract-registry.js';
import {
  assessCanonicalDoctorDependencies,
  assessCanonicalDoctorEvidence,
} from './utils/doctor-diagnosis-consumer.js';

export const RELEASE_READINESS_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.readiness;

export type ReadinessGateStatus = 'pass' | 'warn' | 'fail';
export type ReadinessOverallStatus = 'pass' | 'warn' | 'fail';
export type LifecycleAction = 'dev' | 'test' | 'build' | 'start' | 'lint' | 'format';

export interface ReadinessGateResult {
  gate: 'env' | 'doctor' | 'analyze' | 'verify' | 'dependency';
  status: ReadinessGateStatus;
  summary: string;
  details: string[];
  evidencePath?: string;
}

export const RELEASE_READINESS_SCHEMA_VERSION = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.readiness;

export interface ReleaseReadinessContract {
  schemaVersion: typeof RELEASE_READINESS_SCHEMA_VERSION | 'v1';
  generatedAt: string;
  workspacePath: string;
  projectPath: string;
  action?: LifecycleAction;
  overallStatus: ReadinessOverallStatus;
  blocking: boolean;
  blockingReasons: string[];
  gates: ReadinessGateResult[];
  evidencePath?: string;
}

interface EvaluateReleaseReadinessOptions {
  startPath?: string;
  action?: LifecycleAction;
  writeReport?: boolean;
  skipVerify?: boolean;
}

interface ReadinessCommandOptions {
  workspace?: string;
  json?: boolean;
  strict?: boolean;
  skipVerify?: boolean;
}

function resolveReadinessProjectPath(startPath: string, workspacePath: string): string {
  const resolvedStart = path.resolve(startPath);
  if (!isWorkspaceShellDirectory(resolvedStart)) {
    return resolvedStart;
  }

  const contractPath = firstExistingWorkspaceMetadataPath(workspacePath, 'workspace.contract.json');
  if (fs.existsSync(contractPath)) {
    try {
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      const projects = Array.isArray(contract.projects) ? contract.projects : [];
      for (const entry of projects) {
        const record = toObjectRecord(entry);
        const relativePath =
          typeof record.relativePath === 'string' ? record.relativePath.trim() : '';
        if (relativePath) {
          return path.join(workspacePath, relativePath);
        }
      }
    } catch {
      // Fall through to doctor evidence.
    }
  }

  const doctor = loadDoctorPayload(workspacePath);
  const doctorProjects = Array.isArray(doctor.payload?.projects) ? doctor.payload.projects : [];
  for (const entry of doctorProjects) {
    const record = toObjectRecord(entry);
    const projectPath = typeof record.path === 'string' ? record.path.trim() : '';
    if (projectPath) {
      return path.resolve(projectPath);
    }
  }

  return resolvedStart;
}

function detectProjectRuntime(projectPath: string): 'python' | 'node' | 'go' | 'java' | 'unknown' {
  const projectJson = readRapidkitProjectJson(projectPath);

  if (isGoProject(projectJson, projectPath)) return 'go';
  if (isJavaProject(projectJson, projectPath)) return 'java';
  if (isNodeProject(projectJson, projectPath)) return 'node';
  if (isPythonProject(projectJson, projectPath)) return 'python';
  return 'unknown';
}

function selectLatestReport(reportsDir: string, patterns: RegExp[]): string | null {
  if (!fs.existsSync(reportsDir)) return null;

  const candidates = fs
    .readdirSync(reportsDir)
    .filter(
      (fileName) => fileName.endsWith('.json') && patterns.some((pattern) => pattern.test(fileName))
    )
    .map((fileName) => path.join(reportsDir, fileName));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function toObjectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function firstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function firstExistingWorkspaceMetadataPath(workspacePath: string, ...segments: string[]): string {
  const candidates = workspaceMetadataCandidates(workspacePath, ...segments);
  return firstExistingPath(candidates) ?? candidates[0];
}

function firstExistingWorkspaceReportPath(workspacePath: string, fileName: string): string {
  const canonical = resolveWorkspaceArtifactPath(workspacePath, `.workspai/reports/${fileName}`);
  return (
    firstExistingPath([canonical, path.join(workspacePath, '.rapidkit', 'reports', fileName)]) ??
    canonical
  );
}

async function resolveRegisteredWorkspaceProjectCount(workspacePath: string): Promise<number> {
  const { readWorkspaceRegistrySummary, resolveWorkspaceRegisteredProjects } =
    await import('./utils/workspace-registry-summary.js');
  const summary = await readWorkspaceRegistrySummary(workspacePath);
  if (summary) {
    return summary.projectCount;
  }
  const resolved = await resolveWorkspaceRegisteredProjects(workspacePath);
  return resolved.summary.projectCount;
}

function buildEnvGate(
  workspacePath: string,
  projectRuntime:
    | 'python'
    | 'node'
    | 'go'
    | 'java'
    | 'unknown'
    | Array<'python' | 'node' | 'go' | 'java' | 'unknown'>,
  options?: { hasRegisteredProjects?: boolean }
): ReadinessGateResult {
  const lockPath = firstExistingWorkspaceMetadataPath(workspacePath, 'toolchain.lock');

  if (!fs.existsSync(lockPath)) {
    return {
      gate: 'env',
      status: 'fail',
      summary: 'toolchain.lock is missing',
      details: [
        'Run workspai bootstrap to pin runtime versions and generate a reproducible toolchain.',
      ],
      evidencePath: lockPath,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as Record<string, unknown>;
    const runtime = toObjectRecord(parsed.runtime);
    const runtimeKeys = ['python', 'node', 'go', 'java'] as const;
    const pinned = runtimeKeys.filter((key) => {
      const item = toObjectRecord(runtime[key]);
      return typeof item.version === 'string' && item.version.trim().length > 0;
    });

    if (pinned.length === 0) {
      return {
        gate: 'env',
        status: 'fail',
        summary: 'No runtime versions are pinned in toolchain.lock',
        details: [
          'Pin at least one runtime version via workspai setup <runtime> and re-run bootstrap.',
        ],
        evidencePath: lockPath,
      };
    }

    const requiredRuntimes = [
      ...new Set(
        (Array.isArray(projectRuntime) ? projectRuntime : [projectRuntime]).filter(
          (candidate): candidate is 'python' | 'node' | 'go' | 'java' => candidate !== 'unknown'
        )
      ),
    ];
    const missingRuntimes = requiredRuntimes.filter((requiredRuntime) => {
      const runtimeEntry = toObjectRecord(runtime[requiredRuntime]);
      return typeof runtimeEntry.version !== 'string' || runtimeEntry.version.trim().length === 0;
    });
    if (missingRuntimes.length > 0) {
      const runtimeScopeLabel = options?.hasRegisteredProjects ? 'Project runtime' : 'Workspace';
      return {
        gate: 'env',
        status: 'fail',
        summary: `${runtimeScopeLabel}${missingRuntimes.length === 1 ? '' : 's'} (${missingRuntimes.join(', ')}) ${missingRuntimes.length === 1 ? 'is' : 'are'} not pinned in toolchain.lock`,
        details: missingRuntimes.map(
          (missingRuntime) =>
            `Run workspai setup ${missingRuntime} and workspai bootstrap to lock ${missingRuntime} for this workspace.`
        ),
        evidencePath: lockPath,
      };
    }

    return {
      gate: 'env',
      status: 'pass',
      summary: `Pinned runtimes: ${pinned.join(', ')}`,
      details: [],
      evidencePath: lockPath,
    };
  } catch {
    return {
      gate: 'env',
      status: 'fail',
      summary: 'toolchain.lock is invalid JSON',
      details: ['Regenerate lockfile with workspai bootstrap.'],
      evidencePath: lockPath,
    };
  }
}

function loadDoctorPayload(workspacePath: string): {
  payload: Record<string, unknown> | null;
  path: string;
} {
  const reportPath = firstExistingWorkspaceReportPath(workspacePath, 'doctor-last-run.json');
  if (!fs.existsSync(reportPath)) {
    return { payload: null, path: reportPath };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;
    if (!isDoctorEvidencePayloadCompatible(payload, 'workspace')) {
      return { payload: null, path: reportPath };
    }
    assertDoctorEvidenceSemanticInvariants(payload);

    return { payload, path: reportPath };
  } catch {
    return { payload: null, path: reportPath };
  }
}

function buildDoctorGate(workspacePath: string): {
  gate: ReadinessGateResult;
  payload: Record<string, unknown> | null;
} {
  const loaded = loadDoctorPayload(workspacePath);

  if (!loaded.payload) {
    return {
      gate: {
        gate: 'doctor',
        status: 'fail',
        summary: 'Doctor evidence is missing',
        details: ['Run workspai doctor workspace --json before release readiness checks.'],
        evidencePath: loaded.path,
      },
      payload: null,
    };
  }

  const assessment = assessCanonicalDoctorEvidence(loaded.payload);

  if (assessment.hasSystemErrors) {
    return {
      gate: {
        gate: 'doctor',
        status: 'fail',
        summary: 'Doctor reported system errors',
        details: ['Resolve system-level doctor errors before proceeding.'],
        evidencePath: loaded.path,
      },
      payload: loaded.payload,
    };
  }

  if (assessment.blockingFindings > 0) {
    return {
      gate: {
        gate: 'doctor',
        status: 'fail',
        summary: `Doctor reported ${assessment.blockingFindings} blocking finding(s)`,
        details: ['Resolve the canonical Doctor findings and regenerate fresh Doctor evidence.'],
        evidencePath: loaded.path,
      },
      payload: loaded.payload,
    };
  }

  const trustWarnings = [
    ...(assessment.advisoryFindings > 0
      ? [`${assessment.advisoryFindings} advisory finding(s)`]
      : []),
    ...(assessment.unknownFindings > 0 ? [`${assessment.unknownFindings} unknown finding(s)`] : []),
    ...(assessment.contradictionCount > 0
      ? [`${assessment.contradictionCount} evidence contradiction(s)`]
      : []),
    ...(assessment.missingDiagnosisProjects > 0
      ? [`${assessment.missingDiagnosisProjects} project(s) without canonical diagnosis`]
      : []),
    ...(assessment.staleEvidence ? ['stale Doctor evidence'] : []),
    ...(assessment.unknownFreshness ? ['unknown Doctor evidence freshness'] : []),
    ...(assessment.minimumDiagnosisCompleteness < 100
      ? [`diagnosis completeness ${assessment.minimumDiagnosisCompleteness}%`]
      : []),
  ];
  if (trustWarnings.length > 0) {
    return {
      gate: {
        gate: 'doctor',
        status: 'warn',
        summary: 'Doctor evidence requires attention',
        details: trustWarnings,
        evidencePath: loaded.path,
      },
      payload: loaded.payload,
    };
  }

  return {
    gate: {
      gate: 'doctor',
      status: 'pass',
      summary: 'Doctor checks passed without issues',
      details: [],
      evidencePath: loaded.path,
    },
    payload: loaded.payload,
  };
}

function buildAnalyzeGate(workspacePath: string): ReadinessGateResult {
  const reportPath = firstExistingWorkspaceReportPath(workspacePath, 'analyze-last-run.json');

  if (!fs.existsSync(reportPath)) {
    return {
      gate: 'analyze',
      status: 'fail',
      summary: 'Analyze evidence is missing',
      details: ['Run workspai analyze --json before release readiness checks.'],
      evidencePath: reportPath,
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;
    assertWorkspaceArtifactContract(WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze, payload, reportPath);
    const summary = toObjectRecord(payload.summary);
    const verdict = String(summary.verdict ?? '').toLowerCase();
    const score = Number(summary.score ?? 0);
    const findings = toObjectRecord(summary.findings);
    const failCount = Number(findings.fail ?? 0);

    if (verdict === 'blocked' || failCount > 0) {
      return {
        gate: 'analyze',
        status: 'fail',
        summary: `Analyze verdict is blocked (score ${score}/100)`,
        details: ['Resolve analyze findings and regenerate analyze-last-run.json.'],
        evidencePath: reportPath,
      };
    }

    if (verdict === 'needs-attention') {
      return {
        gate: 'analyze',
        status: 'warn',
        summary: `Analyze needs attention (score ${score}/100)`,
        details: ['Review analyze warnings before release.'],
        evidencePath: reportPath,
      };
    }

    return {
      gate: 'analyze',
      status: 'pass',
      summary: `Analyze passed (score ${score}/100)`,
      details: [],
      evidencePath: reportPath,
    };
  } catch {
    return {
      gate: 'analyze',
      status: 'fail',
      summary: 'Analyze evidence is invalid or violates its contract',
      details: ['Re-run workspai analyze --json to regenerate evidence.'],
      evidencePath: reportPath,
    };
  }
}

function evaluateExtensionVerifyArtifact(verifyPath: string): ReadinessGateResult {
  try {
    const payload = JSON.parse(fs.readFileSync(verifyPath, 'utf-8')) as Record<string, unknown>;
    const status = String(payload.status ?? '').toLowerCase();
    const summary = toObjectRecord(payload.summary);
    const failedChecks = Number(summary.failedChecks ?? 0);

    if (status === 'fail' || failedChecks > 0) {
      return {
        gate: 'verify',
        status: 'fail',
        summary: 'Verify-pack contract reports failed checks',
        details: ['Fix failed verify checks and regenerate verify-pack contract evidence.'],
        evidencePath: verifyPath,
      };
    }

    if (status === 'pass') {
      return {
        gate: 'verify',
        status: 'pass',
        summary: 'Verify-pack contract passed',
        details: [],
        evidencePath: verifyPath,
      };
    }

    return {
      gate: 'verify',
      status: 'warn',
      summary: 'Verify-pack contract status is not explicit',
      details: ['Ensure contract status is pass/fail and keep schema aligned with v1 contract.'],
      evidencePath: verifyPath,
    };
  } catch {
    return {
      gate: 'verify',
      status: 'fail',
      summary: 'Verify-pack contract is invalid JSON',
      details: ['Regenerate verify-pack contract artifact.'],
      evidencePath: verifyPath,
    };
  }
}

async function buildVerifyGate(
  workspacePath: string,
  options: { skipVerify?: boolean }
): Promise<ReadinessGateResult> {
  if (options.skipVerify) {
    return {
      gate: 'verify',
      status: 'pass',
      summary: 'Verify gate skipped (--skip-verify)',
      details: ['Verification was explicitly skipped for this readiness run.'],
    };
  }

  const reportsDirs = [
    resolveWorkspaceArtifactPath(workspacePath, '.workspai/reports'),
    path.join(workspacePath, '.rapidkit', 'reports'),
  ];
  const reportsDir = reportsDirs[0];
  const verifyPath =
    reportsDirs
      .map((candidate) =>
        selectLatestReport(candidate, [/verify-pack-contract/i, /^verify.*\.json$/i])
      )
      .find((candidate): candidate is string => typeof candidate === 'string') ?? null;

  if (verifyPath) {
    return evaluateExtensionVerifyArtifact(verifyPath);
  }

  const cliEvidencePath = resolveWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_INTELLIGENCE_ARTIFACTS.contractVerify
  );
  const cachedCliEvidence =
    reportsDirs
      .map((candidate) =>
        selectLatestReport(candidate, [
          /workspace-contract-verify-last-run/i,
          /workspace-contract-verify/i,
        ])
      )
      .find((candidate): candidate is string => typeof candidate === 'string') ?? null;

  if (cachedCliEvidence) {
    try {
      const payload = JSON.parse(fs.readFileSync(cachedCliEvidence, 'utf-8')) as Record<
        string,
        unknown
      >;
      const status = String(payload.status ?? '').toLowerCase();
      if (status === 'passed' || status === 'pass') {
        return {
          gate: 'verify',
          status: 'pass',
          summary: 'Workspace contract verification passed (CLI cache)',
          details: [],
          evidencePath: cachedCliEvidence,
        };
      }
      if (status === 'failed' || status === 'fail') {
        const violations = Array.isArray(payload.violations)
          ? (payload.violations as string[])
          : [];
        return {
          gate: 'verify',
          status: 'fail',
          summary: 'Workspace contract verification failed (CLI cache)',
          details: violations.slice(0, 5),
          evidencePath: cachedCliEvidence,
        };
      }
    } catch {
      // fall through to inline verify
    }
  }

  try {
    const { verifyWorkspaceContract } = await import('./utils/workspace-contract.js');
    const result = await verifyWorkspaceContract({ workspacePath });
    const evidencePayload = {
      schemaVersion: 'v1',
      source: 'cli',
      generatedAt: new Date().toISOString(),
      status: result.status,
      contractPath: result.contractPath,
      projectCount: result.projectCount,
      checks: result.checks,
      violations: result.violations,
    };
    await writeWorkspaceArtifactJson(
      workspacePath,
      WORKSPACE_INTELLIGENCE_ARTIFACTS.contractVerify,
      evidencePayload
    );

    if (result.status === 'failed') {
      return {
        gate: 'verify',
        status: 'fail',
        summary: 'Workspace contract verification failed (CLI)',
        details: result.violations.slice(0, 5),
        evidencePath: cliEvidencePath,
      };
    }

    return {
      gate: 'verify',
      status: 'pass',
      summary: 'Workspace contract verification passed (CLI)',
      details: [],
      evidencePath: cliEvidencePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      gate: 'verify',
      status: 'fail',
      summary: 'No verify evidence and workspace contract verification unavailable',
      details: [
        'Run workspai workspace contract verify --json or export verify-pack contract from CI.',
        message,
      ],
      evidencePath: path.join(reportsDir, '*verify*.json'),
    };
  }
}

function buildDependencyGate(
  doctorPayload: Record<string, unknown> | null,
  workspacePath: string
): ReadinessGateResult {
  const fallbackEvidence = firstExistingWorkspaceReportPath(workspacePath, 'doctor-last-run.json');

  if (!doctorPayload) {
    return {
      gate: 'dependency',
      status: 'warn',
      summary: 'Dependency risk check skipped (doctor evidence missing)',
      details: ['Run workspai doctor workspace --json to include dependency findings.'],
      evidencePath: fallbackEvidence,
    };
  }

  const assessment = assessCanonicalDoctorDependencies(doctorPayload);

  if (assessment.blockingFindings > 0 || assessment.vulnerableDependencies > 0) {
    return {
      gate: 'dependency',
      status: 'fail',
      summary: `${Math.max(assessment.blockingFindings, assessment.vulnerableDependencies)} blocking dependency/security vulnerability finding(s) reported`,
      details: [
        'Resolve the typed dependency/security findings and regenerate focused audit evidence.',
      ],
      evidencePath: fallbackEvidence,
    };
  }

  if (assessment.auditFailed > 0) {
    return {
      gate: 'dependency',
      status: 'fail',
      summary: `${assessment.auditFailed} dependency audit(s) failed`,
      details: ['Repair the audit runner or dependency environment; failed audits are not clean.'],
      evidencePath: fallbackEvidence,
    };
  }

  if (
    assessment.missingDependencies > 0 ||
    assessment.auditUnavailable > 0 ||
    assessment.unknownFindings > 0 ||
    assessment.advisoryFindings > 0
  ) {
    const details = [
      ...(assessment.missingDependencies > 0
        ? [`${assessment.missingDependencies} project(s) have no materialized dependency tree.`]
        : []),
      ...(assessment.auditUnavailable > 0
        ? [`${assessment.auditUnavailable} audit provider(s) are unavailable or unsupported.`]
        : []),
      ...(assessment.unknownFindings > 0
        ? [`${assessment.unknownFindings} dependency/security finding(s) remain unknown.`]
        : []),
      ...(assessment.advisoryFindings > 0
        ? [`${assessment.advisoryFindings} dependency/security advisory finding(s) remain.`]
        : []),
    ];
    return {
      gate: 'dependency',
      status: 'warn',
      summary: 'Dependency evidence is incomplete or requires attention',
      details,
      evidencePath: fallbackEvidence,
    };
  }

  return {
    gate: 'dependency',
    status: 'pass',
    summary: 'No dependency vulnerabilities reported',
    details: [],
    evidencePath: fallbackEvidence,
  };
}

function computeOverallStatus(gates: ReadinessGateResult[]): ReadinessOverallStatus {
  if (gates.some((gate) => gate.status === 'fail')) return 'fail';
  if (gates.some((gate) => gate.status === 'warn')) return 'warn';
  return 'pass';
}

async function writeReadinessEvidence(
  workspacePath: string,
  payload: ReleaseReadinessContract
): Promise<string> {
  return writeWorkspaceArtifactJson(workspacePath, RELEASE_READINESS_REPORT_PATH, payload);
}

export async function evaluateReleaseReadiness(
  options: EvaluateReleaseReadinessOptions = {}
): Promise<ReleaseReadinessContract> {
  const startPath = path.resolve(options.startPath ?? process.cwd());
  const workspacePath = findWorkspaceRootUp(startPath) ?? startPath;
  const hasRegisteredProjects = (await resolveRegisteredWorkspaceProjectCount(workspacePath)) > 0;
  const projectPath =
    hasRegisteredProjects && isWorkspaceShellDirectory(startPath)
      ? workspacePath
      : resolveReadinessProjectPath(startPath, workspacePath);
  const projectRuntime =
    projectPath === workspacePath ? 'unknown' : detectProjectRuntime(projectPath);
  let effectiveRuntime:
    | 'python'
    | 'node'
    | 'go'
    | 'java'
    | 'unknown'
    | Array<'python' | 'node' | 'go' | 'java' | 'unknown'> = hasRegisteredProjects
    ? projectRuntime
    : 'unknown';
  if (hasRegisteredProjects && projectPath === workspacePath) {
    const { resolveWorkspaceRegisteredProjects } =
      await import('./utils/workspace-registry-summary.js');
    const registered = await resolveWorkspaceRegisteredProjects(workspacePath);
    effectiveRuntime = registered.summary.projects.map((project) =>
      detectProjectRuntime(path.resolve(workspacePath, project.relativePath))
    );
  }

  const envGate = buildEnvGate(workspacePath, effectiveRuntime, { hasRegisteredProjects });
  const doctor = buildDoctorGate(workspacePath);
  const analyzeGate = buildAnalyzeGate(workspacePath);
  const verifyGate = await buildVerifyGate(workspacePath, { skipVerify: options.skipVerify });
  const dependencyGate = buildDependencyGate(doctor.payload, workspacePath);

  const gates = [envGate, doctor.gate, analyzeGate, verifyGate, dependencyGate];
  const overallStatus = computeOverallStatus(gates);

  const contract: ReleaseReadinessContract = {
    schemaVersion: RELEASE_READINESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    workspacePath,
    projectPath,
    action: options.action,
    overallStatus,
    blocking: overallStatus === 'fail',
    blockingReasons: gates
      .filter((gate) => gate.status === 'fail')
      .map((gate) => `${gate.gate}: ${gate.summary}`),
    gates,
  };

  if (options.writeReport !== false) {
    const enriched = withGovernanceRunMetadata(contract as unknown as Record<string, unknown>, {
      commandId: 'workspaceReadiness',
      exitCode: overallStatus === 'fail' ? 2 : overallStatus === 'warn' ? 1 : 0,
      generatedAt: contract.generatedAt,
      blockers: contract.blockingReasons,
      runId: resolveGovernanceRunId(),
    }) as unknown as ReleaseReadinessContract;
    contract.evidencePath = await writeReadinessEvidence(workspacePath, enriched);
  }

  return contract;
}

function gateIndicator(status: ReadinessGateStatus): string {
  if (status === 'pass') return chalk.green('PASS');
  if (status === 'warn') return chalk.yellow('WARN');
  return chalk.red('FAIL');
}

function overallIndicator(status: ReadinessOverallStatus): string {
  if (status === 'pass') return chalk.green('PASS');
  if (status === 'warn') return chalk.yellow('WARN');
  return chalk.red('FAIL');
}

export async function runReleaseReadinessCommand(options: ReadinessCommandOptions): Promise<void> {
  const contract = await evaluateReleaseReadiness({
    startPath: options.workspace,
    writeReport: true,
    skipVerify: options.skipVerify === true,
  });

  if (options.json) {
    console.log(JSON.stringify(contract, null, 2));
  } else {
    console.log(chalk.bold.cyan('\n🚦 Workspai Release Readiness\n'));
    console.log(chalk.bold(`Workspace: ${chalk.cyan(path.basename(contract.workspacePath))}`));
    console.log(chalk.gray(`Path: ${contract.workspacePath}`));
    console.log(`Overall: ${overallIndicator(contract.overallStatus)}`);

    for (const gate of contract.gates) {
      console.log(` - ${gate.gate}: ${gateIndicator(gate.status)} ${gate.summary}`);
      for (const detail of gate.details) {
        console.log(chalk.gray(`   ${detail}`));
      }
      if (gate.evidencePath) {
        console.log(chalk.gray(`   evidence: ${gate.evidencePath}`));
      }
    }

    if (contract.evidencePath) {
      console.log(chalk.gray(`\nEvidence saved: ${contract.evidencePath}`));
    }
  }

  if (options.strict && contract.overallStatus !== 'pass') {
    process.exit(1);
  }
}
