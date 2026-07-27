import chalk from 'chalk';
import { createHash } from 'crypto';
import { execa } from 'execa';
import fsExtra from 'fs-extra';
import type { Dirent } from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { prompt } from './cli-ui/prompts.js';
import { readImportedProjectsRegistry } from './imported-projects-registry.js';
import { buildCleanGitEnv } from './utils/git-worktree.js';
import {
  getPythonCommandCandidates,
  getRapidkitLocalScriptCandidates,
  getUserLocalBinCandidates,
  getVenvRapidkitPath,
  getVenvPythonPath,
  isWindowsPlatform,
  shouldUseShellExecution,
} from './utils/platform-capabilities.js';
import {
  detectBackendFrameworkFromProject,
  type BackendFrameworkDetection,
  type BackendPlatformKey,
  type BackendImportStack,
  type BackendRuntimeFamily,
} from './utils/backend-framework-contract.js';
import { detectFrontendFrameworkFromProject } from './utils/frontend-framework-contract.js';
import {
  assessFrontendSourceTree,
  buildFrontendDoctorProbes,
  detectNodeEslintConfigured,
  detectNodeTestSurface,
} from './utils/doctor-frontend-signals.js';
import {
  resolveProjectCommandCapabilities,
  type ProjectCommandCapabilities,
} from './utils/project-command-capabilities.js';
import { discoverWorkspaceProjects } from './utils/workspace-discovery.js';
import { getFrameworkSupportTier } from './utils/support-matrix.js';
import {
  assertDoctorEvidenceSemanticInvariants,
  DOCTOR_PROJECT_EVIDENCE_SCHEMA,
  DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
  isDoctorEvidencePayloadCompatible,
} from './utils/doctor-evidence-contract.js';
import {
  resolveGovernanceRunId,
  withGovernanceRunMetadata,
} from './utils/governance-report-metadata.js';
import {
  firstExistingWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
  writeWorkspaceArtifactJsonSet,
} from './utils/artifact-path-compat.js';
import {
  hasWorkspaceRootMarkers as hasKnownWorkspaceRootMarkers,
  projectMetadataCandidates,
  workspaceMetadataCandidates,
} from './utils/workspace-paths.js';
import { readWorkspaceMarker } from './workspace-marker.js';
import { getProbeTimeoutMs } from './utils/command-timeouts.js';
import {
  buildDoctorFixExecutionResult,
  DOCTOR_FIX_VERIFY_RECOMMENDED,
  type DoctorAppliedFix,
  type DoctorFixExecutionResult,
} from './contracts/doctor-fix-result-contract.js';
import type {
  DoctorRepairCapability,
  DoctorRepairOperation,
} from './utils/doctor-repair-capabilities.js';
import { buildEnterpriseSurfaceProbes } from './utils/doctor-surface-probes.js';
import { historyEntryFromDoctorFixResult, recordWorkspaceHistory } from './workspace-history.js';
import { isWorkspaceShellDirectory } from './utils/workspace-root.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import { assertJsonSchemaContract } from './utils/json-schema-contract.js';
import {
  collectDoctorDependencyAudit,
  type DoctorDependencyAuditEvidence,
} from './utils/doctor-dependency-audit.js';
import { buildDoctorGraphDiagnosis } from './utils/doctor-graph-diagnosis.js';
import type { DoctorGraphDiagnosis } from './contracts/doctor-graph-diagnosis-contract.js';

export const DOCTOR_WORKSPACE_REPORT_PATH = WORKSPACE_INTELLIGENCE_ARTIFACTS.doctor;

function uniquePaths(paths: string[]): string[] {
  return [
    ...new Set(paths.filter((candidatePath) => candidatePath && candidatePath.trim().length > 0)),
  ];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value.trim().length > 0))];
}

function getPoetryPathCandidates(): string[] {
  const fromLocalBins = getUserLocalBinCandidates().map((dir) =>
    path.join(dir, isWindowsPlatform() ? 'poetry.exe' : 'poetry')
  );

  const windowsExtras = isWindowsPlatform()
    ? [
        path.join(process.env.APPDATA || '', 'Python', 'Scripts', 'poetry.exe'),
        path.join(
          process.env.USERPROFILE || '',
          'AppData',
          'Roaming',
          'Python',
          'Scripts',
          'poetry.exe'
        ),
      ]
    : [];

  const unixExtras = isWindowsPlatform() ? [] : ['/usr/local/bin/poetry', '/usr/bin/poetry'];
  return uniquePaths([...fromLocalBins, ...windowsExtras, ...unixExtras]);
}

function getRapidkitBinaryCandidates(homeDir: string): Array<{ location: string; path: string }> {
  const localBinCandidates = getUserLocalBinCandidates().map((dir) => ({
    location: 'Global (user-local)',
    path: path.join(dir, isWindowsPlatform() ? 'rapidkit.exe' : 'rapidkit'),
  }));

  const defaults = [
    { location: 'Global (pipx)', path: path.join(homeDir, '.local', 'bin', 'rapidkit') },
    {
      location: 'Global (pipx)',
      path: path.join(homeDir, 'AppData', 'Roaming', 'Python', 'Scripts', 'rapidkit.exe'),
    },
    { location: 'Global (pyenv)', path: path.join(homeDir, '.pyenv', 'shims', 'rapidkit') },
    { location: 'Global (system)', path: '/usr/local/bin/rapidkit' },
    { location: 'Global (system)', path: '/usr/bin/rapidkit' },
  ];

  const workspaceVenvPath = getVenvRapidkitPath(path.join(process.cwd(), '.venv'));
  const workspaceLaunchers = getRapidkitLocalScriptCandidates(process.cwd());

  const workspaceCandidates = [
    { location: 'Workspace (.venv)', path: workspaceVenvPath },
    ...workspaceLaunchers.map((launcherPath) => ({
      location: 'Workspace (launcher)',
      path: launcherPath,
    })),
  ];

  const all = [...localBinCandidates, ...defaults, ...workspaceCandidates];
  const seen = new Set<string>();
  return all.filter((entry) => {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    return true;
  });
}

function sortRapidkitInstalledPaths(
  paths: { location: string; path: string; version: string }[]
): { location: string; path: string; version: string }[] {
  const locationPriority = new Map<string, number>([
    ['Workspace (.venv)', 0],
    ['Global (user-local)', 1],
    ['Global (pipx)', 2],
    ['Global (pyenv)', 3],
    ['Global (system)', 4],
  ]);

  return [...paths].sort((a, b) => {
    const aPriority = locationPriority.get(a.location) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = locationPriority.get(b.location) ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.path.localeCompare(b.path);
  });
}

interface HealthCheckResult {
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: string;
  paths?: { location: string; path: string; version?: string }[]; // Multiple installation paths
}

type DetectedFramework =
  | 'FastAPI'
  | 'Django'
  | 'Flask'
  | 'Python'
  | 'NestJS'
  | 'Next.js'
  | 'Remix'
  | 'Nuxt'
  | 'React'
  | 'Vue'
  | 'Angular'
  | 'SvelteKit'
  | 'Svelte'
  | 'Vite'
  | 'Astro'
  | 'Solid'
  | 'Express'
  | 'Fastify'
  | 'Koa'
  | 'Echo'
  | 'Node.js'
  | 'Go'
  | 'Go/Fiber'
  | 'Go/Gin'
  | 'Java'
  | 'Spring Boot'
  | 'Rust'
  | 'Elixir'
  | 'Phoenix'
  | 'Clojure'
  | 'Scala'
  | 'Kotlin'
  | 'C'
  | 'C++'
  | 'Deno'
  | 'Bun'
  | 'PHP'
  | 'Laravel'
  | 'Ruby'
  | 'Ruby on Rails'
  | 'ASP.NET'
  | 'Unknown';

type FrameworkSupportTier = 'first-class' | 'extended' | 'observed';
type ProjectRuntimeFamily =
  | 'python'
  | 'node'
  | 'go'
  | 'java'
  | 'rust'
  | 'elixir'
  | 'clojure'
  | 'deno'
  | 'bun'
  | 'php'
  | 'ruby'
  | 'dotnet'
  | 'scala'
  | 'kotlin'
  | 'c'
  | 'cpp'
  | 'unknown';
type ProjectKind = 'backend' | 'frontend' | 'fullstack' | 'generic';
type FrameworkConfidence = 'high' | 'medium' | 'low';

interface ProjectHealth {
  name: string;
  path: string;
  venvActive: boolean;
  depsInstalled: boolean;
  coreInstalled: boolean;
  coreVersion?: string;
  issues: string[];
  fixCommands?: string[];
  hasEnvFile?: boolean;
  modulesHealthy?: boolean;
  missingModules?: string[];
  framework?: DetectedFramework;
  frameworkKey?: BackendPlatformKey;
  importStack?: BackendImportStack;
  supportTier?: FrameworkSupportTier;
  runtimeFamily?: ProjectRuntimeFamily;
  projectKind?: ProjectKind;
  frameworkConfidence?: FrameworkConfidence;
  isGoProject?: boolean;
  kit?: string;
  stats?: {
    modules: number;
    files?: number;
    size?: string;
  };
  lastModified?: string;
  hasTests?: boolean;
  hasDocker?: boolean;
  hasCodeQuality?: boolean;
  vulnerabilities?: number;
  dependencyAudit?: DoctorDependencyAuditEvidence;
  probes?: ProjectProbeResult[];
  verdict?: DoctorVerdict;
  probeSummary?: DoctorProbeSummary;
  repairCapabilities?: DoctorRepairCapability[];
  commandCapabilities?: ProjectCommandCapabilities;
  graphDiagnosis?: DoctorGraphDiagnosis;
}

type DoctorScopeLabel = 'host-system' | 'workspace-aggregate' | 'project-scoped';
export type DoctorPolicyProfileName = 'local' | 'ci' | 'release' | 'enterprise-strict';
type DoctorVerdict = 'passed' | 'attention' | 'blocked';

interface DoctorProbeSummary {
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  blockingFindings: number;
  advisoryFindings: number;
  verdict: DoctorVerdict;
}

interface DoctorPolicyProfile {
  name: DoctorPolicyProfileName;
  exitOnErrors: true;
  exitOnWarnings: boolean;
  warningExitCode: 0 | 1 | 2;
  advisoryWarningsBlockRelease: boolean;
  description: string;
}

type DoctorFreshnessCategory = 'structure' | 'verification' | 'state';
type DoctorFreshnessStatus = 'fresh' | 'stale' | 'unknown';
type DoctorIssueClass =
  | 'dependency'
  | 'environment'
  | 'security'
  | 'test'
  | 'quality'
  | 'container'
  | 'deployment'
  | 'runtime'
  | 'workspace-contract'
  | 'source-tree'
  | 'framework'
  | 'configuration'
  | 'custom'
  | 'unknown';
type DoctorOperationalImpact =
  | 'none'
  | 'developer-friction'
  | 'ci-risk'
  | 'release-risk'
  | 'security-risk'
  | 'runtime-risk'
  | 'customer-risk';
type DoctorStudioActionMode =
  | 'none'
  | 'run-command'
  | 'edit-file'
  | 'review-required'
  | 'verify-before-fix'
  | 'refresh-evidence'
  | 'manual-guidance';

interface DoctorFreshnessContract {
  category: DoctorFreshnessCategory;
  generatedAt: string;
  ttlSeconds: number | null;
  expiresAt?: string;
  status: DoctorFreshnessStatus;
  verifyBeforeUse: boolean;
  reason: string;
}

interface DoctorRepairIntent {
  mode: DoctorStudioActionMode;
  confidence: 'high' | 'medium' | 'low';
  primaryActionLabel: string;
  requiresApproval: boolean;
  requiresFreshEvidence: boolean;
  reason: string;
  relatedCommands: string[];
}

interface ProjectProbeResult {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'info' | 'warn' | 'error';
  scope: DoctorScopeLabel;
  reason: string;
  recommendation?: string;
  repairCapability?: DoctorRepairCapability;
  freshness?: DoctorFreshnessContract;
  issueClass?: DoctorIssueClass;
  operationalImpact?: DoctorOperationalImpact;
  repairIntent?: DoctorRepairIntent;
}

interface ScoreBreakdownItem {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  scope: DoctorScopeLabel;
  policyRuleId: string;
  reason: string;
}

interface DoctorContractMetadata {
  version: 'doctor-evidence-v1';
  scoringPolicyVersion: 'doctor-score-policy-v2';
  generatedBy: 'workspai';
  deterministicScoreBreakdown: true;
  scopeModel: 'workspace-aggregate-or-project-scoped';
}

interface HealthScore {
  total: number;
  passed: number;
  warnings: number;
  errors: number;
  verdict: DoctorVerdict;
  components: {
    host: {
      total: number;
      passed: number;
      warnings: number;
      errors: number;
    };
    projects: {
      total: number;
      passed: number;
      warnings: number;
      errors: number;
    };
  };
}

interface WorkspaceHealth {
  workspacePath: string;
  workspaceName: string;
  python: HealthCheckResult;
  poetry: HealthCheckResult;
  pipx: HealthCheckResult;
  go: HealthCheckResult;
  rapidkitCore: HealthCheckResult;
  projects: ProjectHealth[];
  healthScore?: HealthScore;
  coreVersion?: string;
  npmVersion?: string;
  projectScanCached?: boolean;
  projectScanSignature?: string;
  projectScanCachePath?: string;
  evidencePath?: string;
  scoreBreakdown?: ScoreBreakdownItem[];
  driftDelta?: DoctorDriftDelta;
  scopeProvenance?: ScopeProvenanceSummary;
  policyProfile?: DoctorPolicyProfile;
  evidenceFreshness?: EvidenceFreshnessSummary;
}

interface ProjectHealthEnvelope {
  workspacePath?: string;
  projectPath: string;
  projectName: string;
  python: HealthCheckResult;
  poetry: HealthCheckResult;
  pipx: HealthCheckResult;
  go: HealthCheckResult;
  rapidkitCore: HealthCheckResult;
  project: ProjectHealth;
  healthScore: HealthScore;
  evidencePath?: string;
  scoreBreakdown?: ScoreBreakdownItem[];
  driftDelta?: DoctorDriftDelta;
  scopeProvenance?: ScopeProvenanceSummary;
  policyProfile?: DoctorPolicyProfile;
  evidenceFreshness?: EvidenceFreshnessSummary;
}

interface EvidenceFreshnessSummary {
  generatedAt: string;
  status: DoctorFreshnessStatus;
  staleProbeCount: number;
  unknownProbeCount: number;
  liveStateProbeCount: number;
  verifyBeforeUseProbeCount: number;
  oldestProbeGeneratedAt?: string;
}

interface ScopeProvenanceSummary {
  scopedCount: number;
  aggregatedCount: number;
  mixedCount: number;
  dominantScope: 'scoped' | 'aggregated' | 'mixed' | 'unknown';
}

interface DoctorDriftDelta {
  baselineAvailable: boolean;
  previousGeneratedAt?: string;
  newIssueCount: number;
  resolvedIssueCount: number;
  netIssueDelta: number;
  scoreDeltaPercent: number | null;
  systemStatusChanges: Array<{
    id: 'python' | 'poetry' | 'pipx' | 'go' | 'rapidkitCore';
    from: HealthCheckResult['status'];
    to: HealthCheckResult['status'];
  }>;
  regressedProjects: string[];
  improvedProjects: string[];
}

function getProjectAdvisoryWarningCount(project: ProjectHealth): number {
  const probeWarnings = (project.probes ?? []).filter((probe) => probe.status === 'warn').length;
  let advisoryWarnings = probeWarnings;

  const hasEnvIssue = project.issues.some((issue) =>
    issue.toLowerCase().includes('environment file missing')
  );
  const hasEnvProbe = (project.probes ?? []).some((probe) => probe.id === 'surface-env-contract');
  const hasSecurityProbe = (project.probes ?? []).some(
    (probe) => probe.id === 'surface-security-hygiene'
  );

  // `.env` absence is shown as a warning row in output; count it even when no fixable issue exists.
  if (project.hasEnvFile === false && !hasEnvIssue && !hasEnvProbe) {
    advisoryWarnings += 1;
  }

  if (
    typeof project.vulnerabilities === 'number' &&
    project.vulnerabilities > 0 &&
    !hasSecurityProbe
  ) {
    advisoryWarnings += 1;
  }

  return advisoryWarnings;
}

function shouldWarnAboutDoctorVersionCompatibility(input: {
  coreVersion?: string;
  npmVersion?: string;
}): boolean {
  const coreMajor = input.coreVersion?.split('.')[0];
  const npmMajor = input.npmVersion?.split('.')[0];
  if (!coreMajor || !npmMajor) return false;
  return coreMajor !== npmMajor;
}

interface DoctorWorkspaceCacheEntry {
  schemaVersion: 'doctor-workspace-cache-v2';
  signature: string;
  generatedAt: string;
  projects: ProjectHealth[];
}

type DoctorEvidenceLike = {
  schemaVersion?: string;
  evidenceType?: 'workspace' | 'project';
  generatedAt?: string;
  healthScore?: HealthScore;
  summary?: {
    totalIssues?: number;
  };
  projects?: Array<{ name?: string; path?: string; issues?: number | string[] }>;
  project?: { name?: string; path?: string; issues?: number | string[] };
  system?: {
    python?: HealthCheckResult;
    poetry?: HealthCheckResult;
    pipx?: HealthCheckResult;
    go?: HealthCheckResult;
    rapidkitCore?: HealthCheckResult;
  };
};

const DOCTOR_PROJECT_SCAN_SCHEMA = 'doctor-project-scan-v2';
const DOCTOR_WORKSPACE_CACHE_SCHEMA = 'doctor-workspace-cache-v2';
const DOCTOR_CONTRACT_METADATA: DoctorContractMetadata = Object.freeze({
  version: 'doctor-evidence-v1',
  scoringPolicyVersion: 'doctor-score-policy-v2',
  generatedBy: 'workspai',
  deterministicScoreBreakdown: true,
  scopeModel: 'workspace-aggregate-or-project-scoped',
});

const DOCTOR_POLICY_PROFILES: Record<DoctorPolicyProfileName, DoctorPolicyProfile> = Object.freeze({
  local: {
    name: 'local',
    exitOnErrors: true,
    exitOnWarnings: false,
    warningExitCode: 0,
    advisoryWarningsBlockRelease: false,
    description: 'Local diagnostics: report warnings without blocking the developer loop.',
  },
  ci: {
    name: 'ci',
    exitOnErrors: true,
    exitOnWarnings: true,
    warningExitCode: 2,
    advisoryWarningsBlockRelease: false,
    description: 'CI diagnostics: errors fail, warnings return a distinct warning exit code.',
  },
  release: {
    name: 'release',
    exitOnErrors: true,
    exitOnWarnings: true,
    warningExitCode: 1,
    advisoryWarningsBlockRelease: true,
    description: 'Release gate: any warning/error blocks release readiness.',
  },
  'enterprise-strict': {
    name: 'enterprise-strict',
    exitOnErrors: true,
    exitOnWarnings: true,
    warningExitCode: 1,
    advisoryWarningsBlockRelease: true,
    description:
      'Enterprise strict gate: all warnings/errors block release and must carry evidence or repair guidance.',
  },
});

function getDoctorContractMetadata(): DoctorContractMetadata {
  return { ...DOCTOR_CONTRACT_METADATA };
}

export function resolveDoctorPolicyProfile(options: {
  profile?: string;
  strict?: boolean;
  ci?: boolean;
}): DoctorPolicyProfile {
  const requested = options.profile?.trim() as DoctorPolicyProfileName | undefined;
  if (requested && requested in DOCTOR_POLICY_PROFILES) {
    return { ...DOCTOR_POLICY_PROFILES[requested] };
  }
  if (options.strict) return { ...DOCTOR_POLICY_PROFILES.release };
  if (options.ci) return { ...DOCTOR_POLICY_PROFILES.ci };
  return { ...DOCTOR_POLICY_PROFILES.local };
}

function toHealthPercent(score: HealthScore | undefined): number | null {
  if (!score || score.total <= 0) {
    return null;
  }
  return Math.round((score.passed / score.total) * 100);
}

function classifyDoctorProbeFreshness(probe: ProjectProbeResult): {
  category: DoctorFreshnessCategory;
  ttlSeconds: number | null;
  reason: string;
} {
  if (
    probe.id === 'surface-security-hygiene' &&
    /vulnerabilit/i.test(`${probe.reason} ${probe.recommendation ?? ''}`)
  ) {
    return {
      category: 'state',
      ttlSeconds: 5 * 60,
      reason:
        'Dependency vulnerability evidence is live state and must be refreshed before release use.',
    };
  }

  if (
    probe.id.includes('script') ||
    probe.id.includes('test') ||
    probe.id.includes('quality') ||
    probe.id.includes('format') ||
    probe.id.includes('runtime') ||
    probe.id.includes('lockfile')
  ) {
    return {
      category: 'verification',
      ttlSeconds: 24 * 60 * 60,
      reason:
        'Verification/tooling evidence can drift with dependency and config changes; refresh daily or before release.',
    };
  }

  if (
    probe.id.includes('dependency') ||
    probe.id.includes('env') ||
    probe.id.includes('container') ||
    probe.id.includes('docker') ||
    probe.id.includes('deploy') ||
    probe.id.includes('kubernetes') ||
    probe.id.includes('source-tree') ||
    probe.id.includes('framework') ||
    probe.id.includes('typescript')
  ) {
    return {
      category: 'structure',
      ttlSeconds: 7 * 24 * 60 * 60,
      reason:
        'Structural workspace/project evidence is durable but should be refreshed when files or manifests change.',
    };
  }

  return {
    category: 'verification',
    ttlSeconds: 24 * 60 * 60,
    reason: 'Default Doctor evidence freshness contract for project-scoped verification.',
  };
}

function buildDoctorFreshnessContract(
  probe: ProjectProbeResult,
  generatedAt: string
): DoctorFreshnessContract {
  const classification = classifyDoctorProbeFreshness(probe);
  const generatedTime = Date.parse(generatedAt);
  const ttlMs =
    typeof classification.ttlSeconds === 'number' ? classification.ttlSeconds * 1000 : null;
  const expiresAt =
    ttlMs !== null && Number.isFinite(generatedTime)
      ? new Date(generatedTime + ttlMs).toISOString()
      : undefined;
  const status: DoctorFreshnessStatus =
    !Number.isFinite(generatedTime) || (ttlMs !== null && !expiresAt)
      ? 'unknown'
      : ttlMs !== null && Date.now() > generatedTime + ttlMs
        ? 'stale'
        : 'fresh';

  return {
    category: classification.category,
    generatedAt,
    ttlSeconds: classification.ttlSeconds,
    ...(expiresAt ? { expiresAt } : {}),
    status,
    verifyBeforeUse: classification.category !== 'structure' || status !== 'fresh',
    reason: classification.reason,
  };
}

function classifyDoctorIssueClass(probe: ProjectProbeResult): DoctorIssueClass {
  const id = probe.id.toLowerCase();
  const text = `${probe.label} ${probe.reason} ${probe.recommendation ?? ''}`.toLowerCase();
  if (id.includes('dependency') || id.includes('lockfile') || text.includes('lockfile')) {
    return 'dependency';
  }
  if (id.includes('security') || text.includes('vulnerabilit') || text.includes('audit')) {
    return 'security';
  }
  if (id.includes('env') || text.includes('.env') || text.includes('environment')) {
    return 'environment';
  }
  if (id.includes('test')) return 'test';
  if (id.includes('quality') || id.includes('format') || id.includes('lint')) return 'quality';
  if (id.includes('docker') || id.includes('container')) return 'container';
  if (id.includes('deploy') || id.includes('kubernetes')) return 'deployment';
  if (id.includes('runtime')) return 'runtime';
  if (id.includes('contract')) return 'workspace-contract';
  if (id.includes('source-tree')) return 'source-tree';
  if (id.includes('framework') || id.includes('typescript')) return 'framework';
  if (id.includes('custom')) return 'custom';
  if (id.includes('script') || id.includes('config')) return 'configuration';
  return 'unknown';
}

function doctorGraphDiagnosisProbes(project: ProjectHealth) {
  const dependencySubjects = project.dependencyAudit?.subjects.map((subject) => subject.name) ?? [];
  return (project.probes ?? []).map((probe) => ({
    ...probe,
    ...(probe.id === 'surface-security-hygiene' && dependencySubjects.length > 0
      ? { subjects: dependencySubjects }
      : {}),
  }));
}

function inferDoctorOperationalImpact(
  probe: ProjectProbeResult,
  issueClass: DoctorIssueClass
): DoctorOperationalImpact {
  if (probe.status === 'pass') return 'none';
  if (issueClass === 'security') return 'security-risk';
  if (issueClass === 'deployment' || issueClass === 'runtime') return 'runtime-risk';
  if (
    issueClass === 'dependency' ||
    issueClass === 'test' ||
    issueClass === 'quality' ||
    issueClass === 'workspace-contract'
  ) {
    return probe.severity === 'error' || probe.status === 'fail' ? 'release-risk' : 'ci-risk';
  }
  if (issueClass === 'container' || issueClass === 'environment') return 'release-risk';
  return 'developer-friction';
}

function buildDoctorRepairIntent(input: {
  probe: ProjectProbeResult;
  freshness: DoctorFreshnessContract;
  issueClass: DoctorIssueClass;
  operationalImpact: DoctorOperationalImpact;
}): DoctorRepairIntent {
  const { probe, freshness } = input;
  const capability = probe.repairCapability;

  if (probe.status === 'pass') {
    return {
      mode: 'none',
      confidence: 'high',
      primaryActionLabel: 'No action required',
      requiresApproval: false,
      requiresFreshEvidence: false,
      reason: 'Probe is passing.',
      relatedCommands: [],
    };
  }

  if (freshness.status !== 'fresh') {
    return {
      mode: 'refresh-evidence',
      confidence: 'high',
      primaryActionLabel: 'Refresh evidence',
      requiresApproval: false,
      requiresFreshEvidence: true,
      reason: `Evidence is ${freshness.status}; refresh Doctor before applying repairs.`,
      relatedCommands: ['npx workspai doctor project --json'],
    };
  }

  if (freshness.verifyBeforeUse && freshness.category === 'state') {
    return {
      mode: 'verify-before-fix',
      confidence: 'high',
      primaryActionLabel: 'Verify live state',
      requiresApproval: false,
      requiresFreshEvidence: true,
      reason: 'Live state evidence must be re-read before Studio claims a fix path.',
      relatedCommands: ['npx workspai doctor project --json'],
    };
  }

  if (capability?.status === 'available' && capability.canAutoFix) {
    const editMode = capability.canEditFiles;
    return {
      mode: editMode ? 'edit-file' : 'run-command',
      confidence: 'high',
      primaryActionLabel: editMode ? 'Apply file fix' : 'Run fix command',
      requiresApproval: capability.requiresApproval,
      requiresFreshEvidence: freshness.verifyBeforeUse,
      reason: capability.reason,
      relatedCommands: uniqueStrings([
        ...(capability.command ? [capability.command] : []),
        ...(capability.verifyCommand ? [capability.verifyCommand] : []),
        ...capability.refreshCommands,
      ]),
    };
  }

  if (capability?.status === 'manual' || capability?.requiresReview) {
    return {
      mode: 'review-required',
      confidence: 'medium',
      primaryActionLabel: 'Review fix path',
      requiresApproval: true,
      requiresFreshEvidence: freshness.verifyBeforeUse,
      reason: capability?.reason ?? probe.recommendation ?? probe.reason,
      relatedCommands: uniqueStrings(
        capability?.refreshCommands ?? ['npx workspai doctor project --json']
      ),
    };
  }

  if (probe.recommendation) {
    return {
      mode: 'manual-guidance',
      confidence: 'medium',
      primaryActionLabel: 'Inspect guidance',
      requiresApproval: false,
      requiresFreshEvidence: freshness.verifyBeforeUse,
      reason: probe.recommendation,
      relatedCommands: ['npx workspai doctor project --json'],
    };
  }

  return {
    mode: 'manual-guidance',
    confidence: 'low',
    primaryActionLabel: 'Inspect issue',
    requiresApproval: false,
    requiresFreshEvidence: freshness.verifyBeforeUse,
    reason: 'Doctor classified the issue but does not have a deterministic repair path yet.',
    relatedCommands: ['npx workspai doctor project --json'],
  };
}

function normalizeDoctorProbe(probe: ProjectProbeResult, generatedAt: string): ProjectProbeResult {
  const freshness = buildDoctorFreshnessContract(
    probe,
    probe.freshness?.generatedAt ?? generatedAt
  );
  const issueClass = probe.issueClass ?? classifyDoctorIssueClass(probe);
  const operationalImpact =
    probe.operationalImpact ?? inferDoctorOperationalImpact(probe, issueClass);
  const repairIntent =
    probe.repairIntent ??
    buildDoctorRepairIntent({
      probe,
      freshness,
      issueClass,
      operationalImpact,
    });

  return {
    ...probe,
    freshness,
    issueClass,
    operationalImpact,
    repairIntent,
  };
}

function normalizeProjectProbeFreshness(project: ProjectHealth, generatedAt: string): void {
  if (!Array.isArray(project.probes)) return;
  project.probes = project.probes.map((probe) => normalizeDoctorProbe(probe, generatedAt));
}

function buildEvidenceFreshnessSummary(
  projects: ProjectHealth[],
  generatedAt: string
): EvidenceFreshnessSummary {
  const probeFreshness = projects.flatMap((project) =>
    Array.isArray(project.probes)
      ? project.probes
          .map((probe) => probe.freshness)
          .filter((freshness): freshness is DoctorFreshnessContract => Boolean(freshness))
      : []
  );
  const staleProbeCount = probeFreshness.filter((freshness) => freshness.status === 'stale').length;
  const unknownProbeCount = probeFreshness.filter(
    (freshness) => freshness.status === 'unknown'
  ).length;
  const liveStateProbeCount = probeFreshness.filter(
    (freshness) => freshness.category === 'state'
  ).length;
  const verifyBeforeUseProbeCount = probeFreshness.filter(
    (freshness) => freshness.verifyBeforeUse
  ).length;
  const oldestProbeGeneratedAt = probeFreshness
    .map((freshness) => freshness.generatedAt)
    .filter(Boolean)
    .sort()[0];

  return {
    generatedAt,
    status: staleProbeCount > 0 ? 'stale' : unknownProbeCount > 0 ? 'unknown' : 'fresh',
    staleProbeCount,
    unknownProbeCount,
    liveStateProbeCount,
    verifyBeforeUseProbeCount,
    ...(oldestProbeGeneratedAt ? { oldestProbeGeneratedAt } : {}),
  };
}

function getIssueCountFromEvidenceValue(value: number | string[] | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

async function readDoctorEvidenceIfPresent(
  filePath: string,
  expectedType?: 'workspace' | 'project'
): Promise<DoctorEvidenceLike | null> {
  try {
    if (!(await fsExtra.pathExists(filePath))) {
      return null;
    }
    const payload = await fsExtra.readJSON(filePath);
    if (!isDoctorEvidencePayloadCompatible(payload, expectedType)) {
      return null;
    }

    return payload as DoctorEvidenceLike;
  } catch {
    return null;
  }
}

function collectSystemStatusChanges(
  previous: DoctorEvidenceLike | null,
  current: {
    python: HealthCheckResult;
    poetry: HealthCheckResult;
    pipx: HealthCheckResult;
    go: HealthCheckResult;
    rapidkitCore: HealthCheckResult;
  }
): DoctorDriftDelta['systemStatusChanges'] {
  if (!previous?.system) {
    return [];
  }

  const pairs: Array<{
    id: DoctorDriftDelta['systemStatusChanges'][number]['id'];
    current: HealthCheckResult;
  }> = [
    { id: 'python', current: current.python },
    { id: 'poetry', current: current.poetry },
    { id: 'pipx', current: current.pipx },
    { id: 'go', current: current.go },
    { id: 'rapidkitCore', current: current.rapidkitCore },
  ];

  const changes: DoctorDriftDelta['systemStatusChanges'] = [];
  for (const pair of pairs) {
    const previousStatus = previous.system?.[pair.id]?.status;
    if (!previousStatus || previousStatus === pair.current.status) {
      continue;
    }
    changes.push({
      id: pair.id,
      from: previousStatus,
      to: pair.current.status,
    });
  }

  return changes;
}

function buildWorkspaceDriftDelta(
  previous: DoctorEvidenceLike | null,
  health: WorkspaceHealth
): DoctorDriftDelta {
  const currentIssuesByProject = new Map<string, number>();
  for (const project of health.projects) {
    currentIssuesByProject.set(project.path || project.name, project.issues.length);
  }

  if (!previous) {
    return {
      baselineAvailable: false,
      newIssueCount: 0,
      resolvedIssueCount: 0,
      netIssueDelta: 0,
      scoreDeltaPercent: null,
      systemStatusChanges: [],
      regressedProjects: [],
      improvedProjects: [],
    };
  }

  const previousProjects = Array.isArray(previous.projects) ? previous.projects : [];
  const previousIssuesByProject = new Map<string, number>();
  for (const project of previousProjects) {
    const projectKey = project.path || project.name;
    if (!projectKey) {
      continue;
    }
    previousIssuesByProject.set(projectKey, getIssueCountFromEvidenceValue(project.issues));
  }

  let newIssueCount = 0;
  let resolvedIssueCount = 0;
  const regressedProjects = new Set<string>();
  const improvedProjects = new Set<string>();
  const allProjectKeys = new Set<string>([
    ...Array.from(previousIssuesByProject.keys()),
    ...Array.from(currentIssuesByProject.keys()),
  ]);

  for (const projectKey of allProjectKeys) {
    const prevIssues = previousIssuesByProject.get(projectKey) ?? 0;
    const currIssues = currentIssuesByProject.get(projectKey) ?? 0;
    if (currIssues > prevIssues) {
      newIssueCount += currIssues - prevIssues;
      regressedProjects.add(projectKey);
    } else if (currIssues < prevIssues) {
      resolvedIssueCount += prevIssues - currIssues;
      improvedProjects.add(projectKey);
    }
  }

  const previousPercent = toHealthPercent(previous.healthScore);
  const currentPercent = toHealthPercent(health.healthScore);

  return {
    baselineAvailable: true,
    previousGeneratedAt: previous.generatedAt,
    newIssueCount,
    resolvedIssueCount,
    netIssueDelta: newIssueCount - resolvedIssueCount,
    scoreDeltaPercent:
      previousPercent === null || currentPercent === null ? null : currentPercent - previousPercent,
    systemStatusChanges: collectSystemStatusChanges(previous, {
      python: health.python,
      poetry: health.poetry,
      pipx: health.pipx,
      go: health.go,
      rapidkitCore: health.rapidkitCore,
    }),
    regressedProjects: Array.from(regressedProjects).sort(),
    improvedProjects: Array.from(improvedProjects).sort(),
  };
}

function buildProjectDriftDelta(
  previous: DoctorEvidenceLike | null,
  envelope: ProjectHealthEnvelope
): DoctorDriftDelta {
  if (!previous) {
    return {
      baselineAvailable: false,
      newIssueCount: 0,
      resolvedIssueCount: 0,
      netIssueDelta: 0,
      scoreDeltaPercent: null,
      systemStatusChanges: [],
      regressedProjects: [],
      improvedProjects: [],
    };
  }

  const previousProjectIssueCount = getIssueCountFromEvidenceValue(previous.project?.issues);
  const currentProjectIssueCount = envelope.project.issues.length;
  const newIssueCount = Math.max(currentProjectIssueCount - previousProjectIssueCount, 0);
  const resolvedIssueCount = Math.max(previousProjectIssueCount - currentProjectIssueCount, 0);

  const previousPercent = toHealthPercent(previous.healthScore);
  const currentPercent = toHealthPercent(envelope.healthScore);
  const projectKey = envelope.project.path || envelope.project.name;

  return {
    baselineAvailable: true,
    previousGeneratedAt: previous.generatedAt,
    newIssueCount,
    resolvedIssueCount,
    netIssueDelta: newIssueCount - resolvedIssueCount,
    scoreDeltaPercent:
      previousPercent === null || currentPercent === null ? null : currentPercent - previousPercent,
    systemStatusChanges: collectSystemStatusChanges(previous, {
      python: envelope.python,
      poetry: envelope.poetry,
      pipx: envelope.pipx,
      go: envelope.go,
      rapidkitCore: envelope.rapidkitCore,
    }),
    regressedProjects: newIssueCount > 0 ? [projectKey] : [],
    improvedProjects: resolvedIssueCount > 0 ? [projectKey] : [],
  };
}

function buildScopeProvenanceSummary(
  scoreBreakdown: ScoreBreakdownItem[] | undefined
): ScopeProvenanceSummary {
  const breakdown = scoreBreakdown ?? [];
  let scopedCount = 0;
  let aggregatedCount = 0;

  for (const item of breakdown) {
    if (item.scope === 'project-scoped') {
      scopedCount += 1;
      continue;
    }
    if (item.scope === 'workspace-aggregate' || item.scope === 'host-system') {
      aggregatedCount += 1;
    }
  }

  const mixedCount = scopedCount > 0 && aggregatedCount > 0 ? 1 : 0;
  const dominantScope =
    mixedCount > 0
      ? 'mixed'
      : scopedCount > 0
        ? 'scoped'
        : aggregatedCount > 0
          ? 'aggregated'
          : 'unknown';

  return {
    scopedCount,
    aggregatedCount,
    mixedCount,
    dominantScope,
  };
}

function buildProjectFixCommand(projectPath: string, command: string): string {
  if (isWindowsPlatform()) {
    return `Set-Location -LiteralPath "${projectPath.replace(/"/g, '`"')}"; ${command}`;
  }
  return `cd '${projectPath.replace(/'/g, `'"'"'`)}' && ${command}`;
}

function buildEnvCopyFixCommand(projectPath: string): string {
  if (isWindowsPlatform()) {
    return buildProjectFixCommand(projectPath, 'Copy-Item .env.example .env');
  }
  return buildProjectFixCommand(projectPath, 'cp .env.example .env');
}

function buildPythonDependencyInstallFixCommand(projectPath: string): string {
  return buildProjectFixCommand(projectPath, 'poetry install --no-root');
}

function supportTierForFramework(framework: DetectedFramework): FrameworkSupportTier {
  if (framework === 'FastAPI' || framework === 'NestJS') {
    return 'first-class';
  }

  if (
    framework === 'Django' ||
    framework === 'Flask' ||
    framework === 'Express' ||
    framework === 'Fastify' ||
    framework === 'Koa' ||
    framework === 'Go/Fiber' ||
    framework === 'Go/Gin' ||
    framework === 'Spring Boot' ||
    framework === 'Rust' ||
    framework === 'Phoenix' ||
    framework === 'Elixir' ||
    framework === 'Clojure' ||
    framework === 'Scala' ||
    framework === 'Kotlin' ||
    framework === 'C' ||
    framework === 'C++' ||
    framework === 'Deno' ||
    framework === 'Bun' ||
    framework === 'PHP' ||
    framework === 'Laravel' ||
    framework === 'Ruby' ||
    framework === 'Ruby on Rails' ||
    framework === 'ASP.NET'
  ) {
    return 'extended';
  }

  return 'observed';
}

function kindForFramework(framework: DetectedFramework): ProjectKind {
  if (
    framework === 'Next.js' ||
    framework === 'Remix' ||
    framework === 'Nuxt' ||
    framework === 'React' ||
    framework === 'Vue' ||
    framework === 'Angular' ||
    framework === 'SvelteKit' ||
    framework === 'Svelte' ||
    framework === 'Vite' ||
    framework === 'Astro' ||
    framework === 'Solid'
  ) {
    return 'frontend';
  }

  if (
    framework === 'Unknown' ||
    framework === 'Node.js' ||
    framework === 'Python' ||
    framework === 'Go' ||
    framework === 'Java' ||
    framework === 'Scala' ||
    framework === 'Kotlin' ||
    framework === 'C' ||
    framework === 'C++'
  ) {
    return 'generic';
  }

  return 'backend';
}

function runtimeForFramework(framework: DetectedFramework): ProjectRuntimeFamily {
  if (
    framework === 'NestJS' ||
    framework === 'Next.js' ||
    framework === 'Remix' ||
    framework === 'Nuxt' ||
    framework === 'React' ||
    framework === 'Vue' ||
    framework === 'Angular' ||
    framework === 'SvelteKit' ||
    framework === 'Svelte' ||
    framework === 'Vite' ||
    framework === 'Astro' ||
    framework === 'Solid' ||
    framework === 'Express' ||
    framework === 'Fastify' ||
    framework === 'Koa' ||
    framework === 'Node.js'
  ) {
    return 'node';
  }

  if (framework === 'Bun') {
    return 'bun';
  }

  if (
    framework === 'FastAPI' ||
    framework === 'Django' ||
    framework === 'Flask' ||
    framework === 'Python'
  ) {
    return 'python';
  }

  if (
    framework === 'Go/Fiber' ||
    framework === 'Go/Gin' ||
    framework === 'Go' ||
    framework === 'Echo'
  ) {
    return 'go';
  }

  if (framework === 'Spring Boot' || framework === 'Java') {
    return 'java';
  }

  if (framework === 'Rust') {
    return 'rust';
  }

  if (framework === 'Elixir' || framework === 'Phoenix') {
    return 'elixir';
  }

  if (framework === 'Clojure') {
    return 'clojure';
  }

  if (framework === 'Deno') {
    return 'deno';
  }

  if (framework === 'Laravel' || framework === 'PHP') {
    return 'php';
  }

  if (framework === 'Ruby on Rails' || framework === 'Ruby') {
    return 'ruby';
  }

  if (framework === 'ASP.NET') {
    return 'dotnet';
  }

  if (framework === 'Scala') {
    return 'scala';
  }

  if (framework === 'Kotlin') {
    return 'kotlin';
  }

  if (framework === 'C') {
    return 'c';
  }

  if (framework === 'C++') {
    return 'cpp';
  }

  return 'unknown';
}

function applyCommandCapabilities(projectHealth: ProjectHealth, projectPath: string): void {
  const capabilities = resolveProjectCommandCapabilities(projectPath);
  projectHealth.commandCapabilities = capabilities;
  projectHealth.supportTier = capabilities.frameworkSupportTier;
}

function applyFrameworkMetadata(
  health: ProjectHealth,
  framework: DetectedFramework,
  confidence: FrameworkConfidence,
  frameworkKey?: BackendPlatformKey
): void {
  health.framework = framework;
  health.frameworkConfidence = confidence;
  health.supportTier = frameworkKey
    ? getFrameworkSupportTier(frameworkKey)
    : supportTierForFramework(framework);
  health.projectKind = kindForFramework(framework);
  health.runtimeFamily = runtimeForFramework(framework);
}

function toDoctorRuntimeFamily(runtime: BackendRuntimeFamily): ProjectRuntimeFamily {
  if (runtime === 'python') return 'python';
  if (runtime === 'node') return 'node';
  if (runtime === 'bun') return 'bun';
  if (runtime === 'go') return 'go';
  if (runtime === 'java') return 'java';
  if (runtime === 'rust') return 'rust';
  if (runtime === 'elixir') return 'elixir';
  if (runtime === 'clojure') return 'clojure';
  if (runtime === 'deno') return 'deno';
  if (runtime === 'php') return 'php';
  if (runtime === 'ruby') return 'ruby';
  if (runtime === 'dotnet') return 'dotnet';
  if (runtime === 'scala') return 'scala';
  if (runtime === 'kotlin') return 'kotlin';
  if (runtime === 'c') return 'c';
  if (runtime === 'cpp') return 'cpp';
  return 'unknown';
}

function toDoctorFramework(detection: BackendFrameworkDetection): DetectedFramework {
  switch (detection.key) {
    case 'fastapi':
      return 'FastAPI';
    case 'django':
      return 'Django';
    case 'flask':
      return 'Flask';
    case 'python':
      return 'Python';
    case 'nestjs':
      return 'NestJS';
    case 'nextjs':
      return 'Next.js';
    case 'remix':
      return 'Remix';
    case 'nuxt':
      return 'Nuxt';
    case 'react':
      return 'React';
    case 'vite':
      return 'Vite';
    case 'vue':
      return 'Vue';
    case 'sveltekit':
      return 'SvelteKit';
    case 'svelte':
      return 'Svelte';
    case 'angular':
      return 'Angular';
    case 'astro':
      return 'Astro';
    case 'solid':
      return 'Solid';
    case 'express':
      return 'Express';
    case 'fastify':
      return 'Fastify';
    case 'koa':
      return 'Koa';
    case 'node':
      return 'Node.js';
    case 'gofiber':
      return 'Go/Fiber';
    case 'gogin':
      return 'Go/Gin';
    case 'echo':
      return 'Echo';
    case 'go':
      return 'Go';
    case 'springboot':
      return 'Spring Boot';
    case 'java':
      return 'Java';
    case 'laravel':
      return 'Laravel';
    case 'php':
      return 'PHP';
    case 'rails':
      return 'Ruby on Rails';
    case 'ruby':
      return 'Ruby';
    case 'dotnet':
      return 'ASP.NET';
    case 'phoenix':
      return 'Phoenix';
    case 'elixir':
      return 'Elixir';
    case 'clojure':
      return 'Clojure';
    case 'scala':
      return 'Scala';
    case 'kotlin':
      return 'Kotlin';
    case 'deno':
      return 'Deno';
    case 'bun':
      return 'Bun';
    case 'actix':
    case 'axum':
    case 'rocket':
    case 'rust':
      return 'Rust';
    case 'sinatra':
    case 'symfony':
      return detection.key === 'sinatra' ? 'Ruby' : 'PHP';
    case 'c':
      return 'C';
    case 'cpp':
      return 'C++';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Unknown';
  }
}

function isGenericBackendDetection(detection: BackendFrameworkDetection): boolean {
  return (
    detection.key === 'python' ||
    detection.key === 'node' ||
    detection.key === 'go' ||
    detection.key === 'java' ||
    detection.key === 'php' ||
    detection.key === 'ruby' ||
    detection.key === 'dotnet' ||
    detection.key === 'rust' ||
    detection.key === 'elixir' ||
    detection.key === 'clojure' ||
    detection.key === 'scala' ||
    detection.key === 'kotlin' ||
    detection.key === 'deno' ||
    detection.key === 'bun' ||
    detection.key === 'unknown'
  );
}

function applyFrontendFrameworkDetection(
  health: ProjectHealth,
  detection: BackendFrameworkDetection
): void {
  health.framework = toDoctorFramework(detection);
  health.frameworkKey = detection.key;
  health.importStack = detection.importStack;
  health.frameworkConfidence = detection.confidence;
  health.supportTier = detection.supportTier;
  health.projectKind = 'frontend';
  health.runtimeFamily = toDoctorRuntimeFamily(detection.runtime);
}

function applyBackendFrameworkDetection(
  health: ProjectHealth,
  detection: BackendFrameworkDetection
): void {
  health.framework = toDoctorFramework(detection);
  health.frameworkKey = detection.key;
  health.importStack = detection.importStack;
  health.frameworkConfidence = detection.confidence;
  health.supportTier = detection.supportTier;
  health.projectKind = isGenericBackendDetection(detection) ? 'generic' : 'backend';
  health.runtimeFamily = toDoctorRuntimeFamily(detection.runtime);
}

function detectNodeFrameworkFromManifest(input: {
  dependencies: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  kitName?: string;
}): { framework: DetectedFramework; confidence: FrameworkConfidence } {
  const deps = input.dependencies;
  const scripts = input.scripts ?? {};
  const kitName = (input.kitName ?? '').toLowerCase();

  const hasDep = (name: string) => Boolean(deps[name]);
  const scriptText = Object.values(scripts)
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (hasDep('next') || scriptText.includes('next ')) {
    return { framework: 'Next.js', confidence: 'high' };
  }
  if (hasDep('nuxt') || scriptText.includes('nuxt ')) {
    return { framework: 'Nuxt', confidence: 'high' };
  }
  if (hasDep('@nestjs/core') || kitName.startsWith('nestjs.')) {
    return { framework: 'NestJS', confidence: 'high' };
  }
  if (hasDep('express')) {
    return { framework: 'Express', confidence: 'high' };
  }
  if (hasDep('fastify')) {
    return { framework: 'Fastify', confidence: 'high' };
  }
  if (hasDep('koa')) {
    return { framework: 'Koa', confidence: 'high' };
  }
  if (hasDep('@angular/core')) {
    return { framework: 'Angular', confidence: 'high' };
  }
  if (hasDep('@sveltejs/kit') || scriptText.includes('svelte-kit')) {
    return { framework: 'SvelteKit', confidence: 'high' };
  }
  if (hasDep('vue')) {
    return { framework: 'Vue', confidence: 'medium' };
  }
  if (hasDep('react') && hasDep('react-dom')) {
    return { framework: 'React', confidence: 'medium' };
  }

  return { framework: 'Node.js', confidence: 'low' };
}

async function detectPythonFramework(
  projectPath: string,
  projectJsonData?: Record<string, unknown> | null
): Promise<{
  framework: DetectedFramework;
  confidence: FrameworkConfidence;
}> {
  const detection = detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null);
  if (detection.runtime !== 'python') {
    return { framework: 'Python', confidence: 'low' };
  }

  return {
    framework: toDoctorFramework(detection),
    confidence: detection.confidence,
  };
}

async function statSignature(candidatePath: string): Promise<string> {
  try {
    const stat = await fsExtra.stat(candidatePath);
    return `${path.basename(candidatePath)}:${stat.isDirectory() ? 'd' : 'f'}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${path.basename(candidatePath)}:missing`;
  }
}

async function collectWorkspaceProjectPaths(workspacePath: string): Promise<string[]> {
  try {
    const ignoredDirs = new Set([
      '.git',
      '.venv',
      'node_modules',
      '.workspai',
      '.rapidkit',
      'dist',
      'build',
      'coverage',
      '__pycache__',
    ]);
    const projectPaths = new Set<string>();

    const hasDoctorProjectSurface = async (dirPath: string): Promise<boolean> => {
      if (await hasRapidkitProjectMarkers(dirPath)) {
        return true;
      }
      const manifestCandidates = [
        'package.json',
        'pyproject.toml',
        'requirements.txt',
        'go.mod',
        'pom.xml',
        'build.gradle',
        'build.gradle.kts',
        '*.csproj',
        'Cargo.toml',
        'composer.json',
        'Gemfile',
        'mix.exs',
        'deps.edn',
        'deno.json',
        'deno.jsonc',
      ];
      for (const candidate of manifestCandidates) {
        if (candidate === '*.csproj') {
          const entries = await fsExtra.readdir(dirPath).catch(() => []);
          if (entries.some((entry) => entry.endsWith('.csproj'))) {
            return true;
          }
          continue;
        }
        if (await fsExtra.pathExists(path.join(dirPath, candidate))) {
          return true;
        }
      }
      return false;
    };

    if (await hasRapidkitProjectMarkers(workspacePath)) {
      projectPaths.add(workspacePath);
    }

    const importedProjects = await readImportedProjectsRegistry(workspacePath);
    for (const importedProject of importedProjects) {
      const projectPath = path.isAbsolute(importedProject.path)
        ? importedProject.path
        : path.join(workspacePath, importedProject.path);
      if (await hasDoctorProjectSurface(projectPath)) {
        projectPaths.add(projectPath);
      }
    }

    const discoveredProjects = await discoverWorkspaceProjects(workspacePath, {
      skipDirs: ignoredDirs,
      descendIntoMatchedProjects: false,
      isProjectDir: async (dirPath, rootPath) => {
        if (path.resolve(dirPath) === path.resolve(rootPath)) {
          return hasRapidkitProjectMarkers(dirPath);
        }
        return hasDoctorProjectSurface(dirPath);
      },
    });
    discoveredProjects.forEach((projectPath) => projectPaths.add(projectPath));

    if (projectPaths.size === 0) {
      const fallbackProjects = await findRapidkitProjectsDeep(workspacePath, 3, ignoredDirs);
      fallbackProjects.forEach((projectPath) => projectPaths.add(projectPath));
    }

    if (
      projectPaths.size === 0 &&
      !(await isWorkspaceShellDirectory(workspacePath)) &&
      (await hasDoctorProjectSurface(workspacePath))
    ) {
      projectPaths.add(workspacePath);
    }

    return Array.from(projectPaths).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function buildWorkspaceProjectSignature(
  workspacePath: string,
  projectPaths: string[]
): Promise<string> {
  const workspacePaths = [
    path.join(workspacePath, '.workspai-workspace'),
    path.join(workspacePath, '.workspai', 'workspace.json'),
    path.join(workspacePath, '.workspai', 'imported-projects.json'),
    path.join(workspacePath, '.workspai', 'policies.yml'),
    path.join(workspacePath, '.workspai', 'toolchain.lock'),
    path.join(workspacePath, '.workspai', 'cache-config.yml'),
    path.join(workspacePath, '.rapidkit-workspace'),
    path.join(workspacePath, '.rapidkit', 'workspace.json'),
    path.join(workspacePath, '.rapidkit', 'imported-projects.json'),
    path.join(workspacePath, '.rapidkit', 'policies.yml'),
    path.join(workspacePath, '.rapidkit', 'toolchain.lock'),
    path.join(workspacePath, '.rapidkit', 'cache-config.yml'),
  ];

  const projectKeyPaths = [
    '.workspai/project.json',
    '.workspai/context.json',
    '.workspai/file-hashes.json',
    '.rapidkit/project.json',
    '.rapidkit/context.json',
    '.rapidkit/file-hashes.json',
    'package.json',
    'pyproject.toml',
    'composer.json',
    'Gemfile',
    'Gemfile.lock',
    'go.mod',
    'go.sum',
    'pom.xml',
    'requirements.txt',
    'Dockerfile',
    'Makefile',
    '.env',
    '.env.example',
    'src',
    'modules',
    'tests',
    'test',
    '.venv',
    'node_modules',
  ];

  const workspaceSignature = await Promise.all(workspacePaths.map(statSignature));
  const projectSignatures = await Promise.all(
    projectPaths.map(async (projectPath) => {
      const details = await Promise.all(
        projectKeyPaths.map((relativePath) => statSignature(path.join(projectPath, relativePath)))
      );
      return `${projectPath}::${details.join('|')}`;
    })
  );

  return [DOCTOR_PROJECT_SCAN_SCHEMA, ...workspaceSignature, ...projectSignatures].join('||');
}

async function loadWorkspaceProjectCache(
  cachePath: string,
  signature: string
): Promise<DoctorWorkspaceCacheEntry | null> {
  try {
    if (!(await fsExtra.pathExists(cachePath))) return null;
    const cachedPayload: unknown = await fsExtra.readJSON(cachePath);
    assertJsonSchemaContract(
      cachedPayload,
      'contracts/doctor-workspace-cache.v2.json',
      `Doctor workspace cache ${cachePath}`
    );
    const cached = cachedPayload as DoctorWorkspaceCacheEntry;
    if (!cached || cached.signature !== signature || !Array.isArray(cached.projects)) {
      return null;
    }
    if (
      typeof (cached as { schemaVersion?: unknown }).schemaVersion === 'string' &&
      cached.schemaVersion !== DOCTOR_WORKSPACE_CACHE_SCHEMA
    ) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

async function saveWorkspaceProjectCache(
  cachePath: string,
  entry: DoctorWorkspaceCacheEntry
): Promise<void> {
  try {
    assertJsonSchemaContract(
      entry,
      'contracts/doctor-workspace-cache.v2.json',
      `Doctor workspace cache ${cachePath}`
    );
    await fsExtra.ensureDir(path.dirname(cachePath));
    await fsExtra.writeJSON(cachePath, entry, { spaces: 2 });
  } catch {
    // Non-fatal cache write failure.
  }
}

async function writeDoctorEvidence(
  workspacePath: string,
  health: WorkspaceHealth,
  cachePath: string | null
): Promise<string | undefined> {
  const evidencePath = path.join(workspacePath, DOCTOR_WORKSPACE_REPORT_PATH);
  try {
    const blockers: string[] = [];
    for (const project of health.projects) {
      for (const issue of project.issues ?? []) {
        if (typeof issue === 'string' && issue.trim()) {
          blockers.push(`${project.name}: ${issue.trim()}`);
        }
      }
      for (const probe of project.probes ?? []) {
        if (probe.status === 'fail' && probe.reason.trim()) {
          blockers.push(`${project.name}: ${probe.reason.trim()}`);
        }
      }
    }
    for (const [label, check] of [
      ['python', health.python],
      ['rapidkitCore', health.rapidkitCore],
    ] as const) {
      if (check?.status === 'error') {
        const message = typeof check.message === 'string' ? check.message : `${label} check failed`;
        blockers.push(`${label}: ${message}`);
      }
    }
    const projectSummaries = health.projects.map(buildDoctorProbeSummary);
    const blockingFindings = projectSummaries.reduce(
      (sum, summary) => sum + summary.blockingFindings,
      0
    );
    const advisoryFindings = projectSummaries.reduce(
      (sum, summary) => sum + summary.advisoryFindings,
      0
    );
    const payload = withGovernanceRunMetadata(
      {
        schemaVersion: DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
        evidenceType: 'workspace',
        contract: getDoctorContractMetadata(),
        policyProfile: health.policyProfile,
        workspacePath,
        workspaceName: health.workspaceName,
        projectScanCached: health.projectScanCached ?? false,
        projectScanSignature: health.projectScanSignature,
        cachePath,
        healthScore: health.healthScore,
        evidenceFreshness: health.evidenceFreshness,
        system: {
          python: health.python,
          poetry: health.poetry,
          pipx: health.pipx,
          go: health.go,
          rapidkitCore: health.rapidkitCore,
          versions: {
            core: health.coreVersion,
            npm: health.npmVersion,
          },
        },
        projects: health.projects,
        summary: {
          totalProjects: health.projects.length,
          totalIssues: health.projects.reduce((sum, p) => sum + p.issues.length, 0),
          verdict: health.healthScore?.verdict ?? 'passed',
          blockingFindings,
          advisoryFindings,
          projectAdvisoryWarningProjects: projectSummaries.filter(
            (summary) => summary.advisoryFindings > 0
          ).length,
          projectAdvisoryWarnings: advisoryFindings,
          hasSystemErrors: [health.python, health.rapidkitCore].some((c) => c.status === 'error'),
          scopeProvenance: health.scopeProvenance,
        },
        driftDelta: health.driftDelta,
        scoreBreakdown: health.scoreBreakdown ?? [],
      },
      {
        commandId: 'checkWorkspaceHealth',
        exitCode: computeDoctorGateExitCode(health.healthScore, {
          profile: health.policyProfile?.name,
        }),
        generatedAt: new Date().toISOString(),
        blockers: blockers.slice(0, 12),
        runId: resolveGovernanceRunId(),
      }
    );
    assertDoctorEvidenceSemanticInvariants(payload);
    await writeWorkspaceArtifactJson(workspacePath, DOCTOR_WORKSPACE_REPORT_PATH, payload);
    return evidencePath;
  } catch (error) {
    if (error instanceof Error && error.message.includes('violates contracts/')) {
      throw error;
    }
    return undefined;
  }
}

async function collectSystemChecks(): Promise<{
  python: HealthCheckResult;
  poetry: HealthCheckResult;
  pipx: HealthCheckResult;
  go: HealthCheckResult;
  rapidkitCore: HealthCheckResult;
}> {
  const [python, poetry, pipx, go, rapidkitCore] = await Promise.all([
    checkPython(),
    checkPoetry(),
    checkPipx(),
    checkGo(),
    checkRapidKitCore(),
  ]);

  return { python, poetry, pipx, go, rapidkitCore };
}

async function checkPython(): Promise<HealthCheckResult> {
  const pythonCommands = getPythonCommandCandidates();
  let unsupportedVersion: { version: string; command: string } | undefined;

  for (const cmd of pythonCommands) {
    try {
      const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
      const { stdout, stderr } = await execa(cmd, args, { timeout: 3000, reject: false });
      const output = `${stdout ?? ''}\n${stderr ?? ''}`;
      const match = output.match(/Python\s+(\d+\.\d+(?:\.\d+)?)/i);
      if (match) {
        const version = match[1];
        const [major, minor] = version.split('.').map(Number);

        if (major < 3 || (major === 3 && minor < 10)) {
          unsupportedVersion ??= { version, command: [cmd, ...args.slice(0, -1)].join(' ') };
          continue;
        }

        return {
          status: 'ok',
          message: `Python ${version}`,
          details: `Using ${[cmd, ...args.slice(0, -1)].join(' ')}`,
        };
      }
    } catch {
      continue;
    }
  }

  if (unsupportedVersion) {
    return {
      status: 'warn',
      message: `Python ${unsupportedVersion.version} (requires 3.10+)`,
      details: `${unsupportedVersion.command} found but version is below minimum requirement`,
    };
  }

  return {
    status: 'error',
    message: 'Python not found',
    details: "Install Python 3.10+ and ensure it's in PATH",
  };
}

async function checkPoetry(): Promise<HealthCheckResult> {
  try {
    const { stdout } = await execa('poetry', ['--version'], { timeout: 3000 });
    const match = stdout.match(/Poetry .*version ([\d.]+)/);
    if (match) {
      return {
        status: 'ok',
        message: `Poetry ${match[1]}`,
        details: 'Available for dependency management',
      };
    }
    return { status: 'warn', message: 'Poetry version unknown' };
  } catch {
    const candidates = getPythonCommandCandidates().map((cmd) => ({
      cmd,
      args: cmd === 'py' ? ['-3', '-m', 'poetry', '--version'] : ['-m', 'poetry', '--version'],
    }));

    for (const candidate of candidates) {
      try {
        const { stdout } = await execa(candidate.cmd, candidate.args, {
          timeout: 3000,
          shell: shouldUseShellExecution(),
        });
        const match = stdout.match(/Poetry .*version ([\d.]+)/) || stdout.match(/([\d.]+)/);
        return {
          status: 'ok',
          message: match?.[1] ? `Poetry ${match[1]}` : 'Poetry detected',
          details: `Available via ${candidate.cmd} ${candidate.args.join(' ')}`,
        };
      } catch {
        continue;
      }
    }

    for (const poetryPath of getPoetryPathCandidates()) {
      try {
        if (!(await fsExtra.pathExists(poetryPath))) {
          continue;
        }
        const { stdout } = await execa(poetryPath, ['--version'], {
          timeout: 3000,
          shell: shouldUseShellExecution(),
        });
        const match = stdout.match(/Poetry .*version ([\d.]+)/) || stdout.match(/([\d.]+)/);
        return {
          status: 'ok',
          message: match?.[1] ? `Poetry ${match[1]}` : 'Poetry detected',
          details: `Available at ${poetryPath}`,
        };
      } catch {
        continue;
      }
    }

    return {
      status: 'warn',
      message: 'Poetry not installed',
      details: 'Optional: Install for better dependency management',
    };
  }
}

async function checkPipx(): Promise<HealthCheckResult> {
  try {
    const { stdout } = await execa('pipx', ['--version'], { timeout: 3000 });
    const version = stdout.trim();
    return {
      status: 'ok',
      message: `pipx ${version}`,
      details: 'Available for global tool installation',
    };
  } catch {
    const pythonCandidates = getPythonCommandCandidates();
    for (const cmd of pythonCandidates) {
      try {
        const args = cmd === 'py' ? ['-3', '-m', 'pipx', '--version'] : ['-m', 'pipx', '--version'];
        const { stdout } = await execa(cmd, args, {
          timeout: 3000,
          shell: shouldUseShellExecution(),
        });
        const version = stdout.trim();
        return {
          status: 'ok',
          message: `pipx ${version}`,
          details: `Available via ${cmd} ${args.join(' ')}`,
        };
      } catch {
        continue;
      }
    }

    return {
      status: 'warn',
      message: 'pipx not installed',
      details: 'Optional: Install for isolated Python tools',
    };
  }
}

async function checkGo(): Promise<HealthCheckResult> {
  try {
    const { stdout } = await execa('go', ['version'], { timeout: 3000 });
    // e.g. "go version go1.24.0 linux/amd64"
    const match = stdout.match(/go version go(\d+\.\d+(?:\.\d+)?)/);
    if (match) {
      return {
        status: 'ok',
        message: `Go ${match[1]}`,
        details: 'Available for Go/Fiber and Go/Gin projects',
      };
    }
    return { status: 'ok', message: 'Go (version unknown)', details: 'go found in PATH' };
  } catch {
    return {
      status: 'warn',
      message: 'Go not installed',
      details:
        'Optional: Required only for gofiber.standard / gogin.standard projects — https://go.dev/dl/',
    };
  }
}

async function checkRapidKitCore(): Promise<HealthCheckResult> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const foundPaths: { location: string; path: string; version: string }[] = [];

  const candidates = getRapidkitBinaryCandidates(homeDir);

  // Check all paths
  for (const { location, path: rapidkitPath } of candidates) {
    try {
      if (await fsExtra.pathExists(rapidkitPath)) {
        const { stdout, exitCode } = await execa(rapidkitPath, ['--version'], {
          timeout: 3000,
          reject: false,
        });

        if (
          exitCode === 0 &&
          (stdout.includes('RapidKit Version') || stdout.includes('RapidKit'))
        ) {
          const versionMatch = stdout.match(/v?([\d.]+(?:rc\d+)?(?:a\d+)?(?:b\d+)?)/);
          if (versionMatch) {
            foundPaths.push({ location, path: rapidkitPath, version: versionMatch[1] });
          }
        }
      }
    } catch {
      continue;
    }
  }

  // If found installations, return them
  if (foundPaths.length > 0) {
    const installedPackagePaths = foundPaths.filter((f) => f.location !== 'Workspace (launcher)');

    if (installedPackagePaths.length > 0) {
      const sortedInstalledPaths = sortRapidkitInstalledPaths(installedPackagePaths);
      const primaryVersion = sortedInstalledPaths[0].version;
      const hasWorkspaceVenvInstall = sortedInstalledPaths.some(
        (entry) => entry.location === 'Workspace (.venv)'
      );
      const hasGlobalInstall = sortedInstalledPaths.some((entry) =>
        entry.location.startsWith('Global (')
      );

      const workspaceVenvAdvisory =
        !hasWorkspaceVenvInstall && hasGlobalInstall
          ? 'Workspace (.venv): not installed (optional). For RapidKit Core module-enabled projects, run npx workspai workspace run init inside this workspace to install the local Python engine.'
          : undefined;

      return {
        status: 'ok',
        message: `RapidKit Core ${primaryVersion}`,
        details: workspaceVenvAdvisory,
        paths: sortedInstalledPaths.map((f) => ({
          location: f.location,
          path: f.path,
          version: f.version,
        })),
      };
    }

    const launcherVersion = foundPaths[0].version;
    return {
      status: 'ok',
      message: `RapidKit Core ${launcherVersion}`,
      details: 'Detected via workspace launcher',
    };
  }

  // Try checking via PATH
  try {
    const { stdout, exitCode } = await execa('rapidkit', ['--version'], {
      timeout: 3000,
      reject: false,
    });

    if (exitCode === 0 && (stdout.includes('RapidKit Version') || stdout.includes('RapidKit'))) {
      const versionMatch = stdout.match(/v?([\d.]+(?:rc\d+)?(?:a\d+)?(?:b\d+)?)/);
      if (versionMatch) {
        return {
          status: 'ok',
          message: `RapidKit Core ${versionMatch[1]}`,
          details: 'Available via PATH',
        };
      }
    }
  } catch {
    // Not in PATH
  }

  // Try Poetry environment
  try {
    const { stdout, exitCode } = await execa('poetry', ['run', 'rapidkit', '--version'], {
      timeout: 3000,
      reject: false,
    });

    if (exitCode === 0 && (stdout.includes('RapidKit Version') || stdout.includes('RapidKit'))) {
      const versionMatch = stdout.match(/v?([\d.]+(?:rc\d+)?(?:a\d+)?(?:b\d+)?)/);
      if (versionMatch) {
        return {
          status: 'ok',
          message: `RapidKit Core ${versionMatch[1]}`,
          details: 'Available via Poetry',
        };
      }
    }
  } catch {
    // Poetry not available
  }

  // Try Python module import (last resort)
  const pythonCommands = getPythonCommandCandidates();
  for (const cmd of pythonCommands) {
    try {
      const args =
        cmd === 'py'
          ? ['-3', '-c', 'import rapidkit_core; print(rapidkit_core.__version__)']
          : ['-c', 'import rapidkit_core; print(rapidkit_core.__version__)'];
      const { stdout, exitCode } = await execa(cmd, args, { timeout: 3000, reject: false });

      if (
        exitCode === 0 &&
        stdout &&
        !stdout.includes('Traceback') &&
        !stdout.includes('ModuleNotFoundError')
      ) {
        const version = stdout.trim();
        if (version) {
          return {
            status: 'ok',
            message: `RapidKit Core ${version}`,
            details: `Available in ${cmd} environment`,
          };
        }
      }
    } catch {
      continue;
    }
  }

  return {
    status: 'error',
    message: 'RapidKit Core not installed',
    details: 'Install with: pipx install rapidkit-core',
  };
}

async function performCommonChecks(
  projectPath: string,
  health: ProjectHealth,
  packageJsonData?: Record<string, unknown> | null
): Promise<void> {
  // Docker check
  const dockerfilePath = path.join(projectPath, 'Dockerfile');
  health.hasDocker = await fsExtra.pathExists(dockerfilePath);

  // Tests check
  const testsPath = path.join(projectPath, 'tests');
  const testPath = path.join(projectPath, 'test');
  const srcTestPath = path.join(projectPath, 'src', 'test');
  const hasTestDir =
    (await fsExtra.pathExists(testsPath)) ||
    (await fsExtra.pathExists(testPath)) ||
    (await fsExtra.pathExists(srcTestPath));

  // Go: tests are *_test.go files anywhere in the project tree
  let hasGoTests = false;
  if (health.framework === 'Go/Fiber' || health.framework === 'Go/Gin') {
    try {
      const queue: Array<{ dir: string; depth: number }> = [{ dir: projectPath, depth: 0 }];
      const maxDepth = 4;
      const ignoredDirs = new Set(['.git', '.venv', 'node_modules', 'dist', 'build', 'vendor']);

      while (queue.length > 0 && !hasGoTests) {
        const current = queue.shift();
        if (!current) break;

        let entries: string[] = [];
        try {
          entries = await fsExtra.readdir(current.dir);
        } catch {
          continue;
        }

        for (const entry of entries) {
          const fullPath = path.join(current.dir, entry);
          let stat;
          try {
            stat = await fsExtra.stat(fullPath);
          } catch {
            continue;
          }

          if (stat.isFile() && entry.endsWith('_test.go')) {
            hasGoTests = true;
            break;
          }

          if (
            stat.isDirectory() &&
            current.depth < maxDepth &&
            !ignoredDirs.has(entry) &&
            !entry.startsWith('.')
          ) {
            queue.push({ dir: fullPath, depth: current.depth + 1 });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  health.hasTests = hasTestDir || hasGoTests;
  if ((health.runtimeFamily === 'node' || health.runtimeFamily === 'bun') && !health.hasTests) {
    health.hasTests = await detectNodeTestSurface(projectPath, packageJsonData);
  }

  // Code Quality checks
  if (health.runtimeFamily === 'node' || health.runtimeFamily === 'bun') {
    health.hasCodeQuality = await detectNodeEslintConfigured(projectPath, packageJsonData);
  } else if (health.framework === 'Go/Fiber' || health.framework === 'Go/Gin') {
    // golangci-lint config or Makefile with lint target
    const golangciPath = path.join(projectPath, '.golangci.yml');
    const golangciYaml = path.join(projectPath, '.golangci.yaml');
    const makefilePath = path.join(projectPath, 'Makefile');
    const hasMakefileLint =
      (await fsExtra.pathExists(makefilePath)) &&
      (await fsExtra.readFile(makefilePath, 'utf8')).includes('golangci-lint');
    health.hasCodeQuality =
      (await fsExtra.pathExists(golangciPath)) ||
      (await fsExtra.pathExists(golangciYaml)) ||
      hasMakefileLint;
  } else if (health.runtimeFamily === 'python') {
    // Ruff for Python runtimes
    const ruffPath = path.join(projectPath, 'ruff.toml');
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');

    if (await fsExtra.pathExists(pyprojectPath)) {
      try {
        const content = await fsExtra.readFile(pyprojectPath, 'utf8');
        health.hasCodeQuality =
          content.includes('[tool.ruff]') || (await fsExtra.pathExists(ruffPath));
      } catch {
        health.hasCodeQuality = await fsExtra.pathExists(ruffPath);
      }
    }
  } else if (health.framework === 'Spring Boot') {
    const pomXmlPath = path.join(projectPath, 'pom.xml');
    if (await fsExtra.pathExists(pomXmlPath)) {
      try {
        const content = await fsExtra.readFile(pomXmlPath, 'utf8');
        health.hasCodeQuality =
          content.includes('spotless') ||
          content.includes('checkstyle') ||
          content.includes('pmd') ||
          content.includes('maven-enforcer-plugin');
      } catch {
        health.hasCodeQuality = false;
      }
    }
  }

  health.dependencyAudit = await collectDoctorDependencyAudit({
    projectPath,
    runtime: health.runtimeFamily ?? 'unknown',
  });
  health.vulnerabilities =
    health.dependencyAudit.status === 'vulnerable'
      ? (health.dependencyAudit.blockingFindingCount ?? health.dependencyAudit.findingCount ?? 0)
      : undefined;
}

function pythonEnvironmentInterpreterCandidates(environmentPath: string): string[] {
  return uniquePaths([
    getVenvPythonPath(environmentPath),
    path.join(environmentPath, 'Scripts', 'python.exe'),
    path.join(environmentPath, 'Scripts', 'python'),
    path.join(environmentPath, 'bin', 'python'),
    path.join(environmentPath, 'bin', 'python3'),
  ]);
}

function parsePipPackageList(output: string): Array<{ name?: string }> | null {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as Array<{ name?: string }>) : null;
  } catch {
    return null;
  }
}

async function inspectPythonEnvironment(input: {
  environmentPath: string;
  frameworkImport: string;
}): Promise<{
  interpreter?: string;
  coreVersion?: string;
  dependenciesInstalled: boolean;
}> {
  for (const interpreter of pythonEnvironmentInterpreterCandidates(input.environmentPath)) {
    if (!(await fsExtra.pathExists(interpreter))) continue;

    let coreVersion: string | undefined;
    try {
      const result = await execa(
        interpreter,
        ['-c', 'import rapidkit_core; print(rapidkit_core.__version__)'],
        { timeout: 2000, reject: false }
      );
      if (result.exitCode === 0 && result.stdout.trim()) coreVersion = result.stdout.trim();
    } catch {
      // Core is optional in project environments.
    }

    if (input.frameworkImport) {
      try {
        const result = await execa(interpreter, ['-c', `import ${input.frameworkImport}`], {
          timeout: 2000,
          reject: false,
        });
        if (result.exitCode === 0) {
          return { interpreter, coreVersion, dependenciesInstalled: true };
        }
      } catch {
        // Fall through to pip metadata, which is portable across venv layouts.
      }
    }

    try {
      const result = await execa(interpreter, ['-m', 'pip', 'list', '--format=json'], {
        timeout: 5000,
        reject: false,
      });
      const packages = parsePipPackageList(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
      const ignored = new Set(['pip', 'setuptools', 'wheel']);
      const dependenciesInstalled =
        packages?.some(
          (pkg) => typeof pkg.name === 'string' && !ignored.has(pkg.name.toLowerCase())
        ) ?? false;
      return { interpreter, coreVersion, dependenciesInstalled };
    } catch {
      return { interpreter, coreVersion, dependenciesInstalled: false };
    }
  }

  return { dependenciesInstalled: false };
}

async function resolvePythonProjectEnvironment(
  projectPath: string,
  frameworkImport: string,
  usesPoetry: boolean
): Promise<{
  environmentPath?: string;
  interpreter?: string;
  coreVersion?: string;
  dependenciesInstalled: boolean;
}> {
  const localEnvironmentPath = path.join(projectPath, '.venv');
  if (await fsExtra.pathExists(localEnvironmentPath)) {
    return {
      environmentPath: localEnvironmentPath,
      ...(await inspectPythonEnvironment({
        environmentPath: localEnvironmentPath,
        frameworkImport,
      })),
    };
  }

  if (usesPoetry) {
    try {
      const result = await execa('poetry', ['env', 'info', '--path'], {
        cwd: projectPath,
        timeout: 3000,
        reject: false,
      });
      const environmentPath = result.stdout.trim();
      if (result.exitCode === 0 && environmentPath && (await fsExtra.pathExists(environmentPath))) {
        return {
          environmentPath,
          ...(await inspectPythonEnvironment({ environmentPath, frameworkImport })),
        };
      }
    } catch {
      // Poetry may be unavailable or the project may not have an environment yet.
    }
  }

  return { dependenciesInstalled: false };
}

function pushProjectProbe(health: ProjectHealth, probe: ProjectProbeResult): void {
  if (!health.probes) {
    health.probes = [];
  }
  const normalizedProbe = normalizeDoctorProbe(probe, new Date().toISOString());
  health.probes.push(normalizedProbe);

  if (normalizedProbe.repairCapability) {
    if (!health.repairCapabilities) {
      health.repairCapabilities = [];
    }
    health.repairCapabilities.push(normalizedProbe.repairCapability);

    if (
      normalizedProbe.repairCapability.status === 'available' &&
      normalizedProbe.repairCapability.canAutoFix &&
      normalizedProbe.repairCapability.command
    ) {
      health.fixCommands = health.fixCommands ?? [];
      if (!health.fixCommands.includes(normalizedProbe.repairCapability.command)) {
        health.fixCommands.push(normalizedProbe.repairCapability.command);
      }
    }
  }
}

async function anyRelativePathExists(rootPath: string, relativePaths: string[]): Promise<boolean> {
  return (
    await Promise.all(
      relativePaths.map((relativePath) => fsExtra.pathExists(path.join(rootPath, relativePath)))
    )
  ).some(Boolean);
}

async function findFileByName(
  rootPath: string,
  options: { name?: string; suffix?: string; under?: string[]; ignoreDirs?: string[] }
): Promise<boolean> {
  const ignoreDirs = new Set(options.ignoreDirs ?? ['node_modules', '.git', 'bin', 'obj', 'dist']);
  const roots = options.under && options.under.length > 0 ? options.under : ['.'];
  const queue = roots.map((relativeRoot) => path.join(rootPath, relativeRoot));

  while (queue.length > 0) {
    const current = queue.shift() as string;
    let entries: Dirent[];
    try {
      entries = await fsExtra.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (
        entry.isFile() &&
        ((options.name && entry.name === options.name) ||
          (options.suffix && entry.name.endsWith(options.suffix)))
      ) {
        return true;
      }
      if (entry.isDirectory() && !ignoreDirs.has(entry.name)) {
        queue.push(path.join(current, entry.name));
      }
    }
  }

  return false;
}

async function appendRuntimeAdapterProbes(
  projectPath: string,
  health: ProjectHealth
): Promise<void> {
  const runtime = health.runtimeFamily || 'unknown';
  const isBackend = health.projectKind === 'backend' || health.projectKind === 'generic';
  if (!isBackend) {
    return;
  }

  if (runtime === 'node') {
    const lockExists =
      (await fsExtra.pathExists(path.join(projectPath, 'package-lock.json'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'pnpm-lock.yaml'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'yarn.lock')));
    pushProjectProbe(health, {
      id: 'adapter-node-lockfile-integrity',
      label: 'Node adapter lockfile integrity',
      status: lockExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: lockExists
        ? 'Node lockfile detected for deterministic dependency restore.'
        : 'No Node lockfile detected (package-lock/yarn.lock/pnpm-lock.yaml).',
      recommendation: lockExists
        ? undefined
        : 'Commit a lockfile for deterministic installs and CI parity.',
    });

    const bootEntryExists = await anyRelativePathExists(projectPath, [
      'src/main.ts',
      'src/main.js',
      'src/server.ts',
      'src/server.js',
      'server.ts',
      'server.js',
      'index.ts',
      'index.js',
    ]);
    pushProjectProbe(health, {
      id: 'adapter-node-boot-entrypoint',
      label: 'Node adapter boot entrypoint',
      status: bootEntryExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: bootEntryExists
        ? 'Boot entrypoint markers detected for service startup path.'
        : 'No canonical Node boot entrypoint markers detected.',
      recommendation: bootEntryExists
        ? undefined
        : 'Define and document service bootstrap entrypoint (main/server).',
    });
    return;
  }

  if (runtime === 'python') {
    const lockExists =
      (await fsExtra.pathExists(path.join(projectPath, 'poetry.lock'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'requirements.txt'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'uv.lock')));
    pushProjectProbe(health, {
      id: 'adapter-python-lockfile-integrity',
      label: 'Python adapter dependency integrity',
      status: lockExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: lockExists
        ? 'Python dependency contract file detected.'
        : 'No Python dependency contract file detected (poetry.lock/requirements/uv.lock).',
      recommendation: lockExists
        ? undefined
        : 'Pin dependency contract for deterministic setup and reproducible CI.',
    });

    const pythonBootEntrypointMarkers = [
      'src/main.py',
      'src/app/main.py',
      'app/main.py',
      'main.py',
      'manage.py',
      'asgi.py',
      'wsgi.py',
    ];
    const bootEntryExists = await anyRelativePathExists(projectPath, pythonBootEntrypointMarkers);
    pushProjectProbe(health, {
      id: 'adapter-python-boot-entrypoint',
      label: 'Python adapter boot entrypoint',
      status: bootEntryExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: bootEntryExists
        ? 'Python application entrypoint markers detected.'
        : 'No Python application entrypoint markers detected.',
      recommendation: bootEntryExists
        ? undefined
        : 'Expose explicit app/main entrypoint for deterministic boot probes.',
    });
    return;
  }

  if (runtime === 'java') {
    const buildWrapperExists =
      (await fsExtra.pathExists(path.join(projectPath, 'mvnw'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'gradlew')));
    pushProjectProbe(health, {
      id: 'adapter-java-build-wrapper',
      label: 'Java adapter build wrapper',
      status: buildWrapperExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: buildWrapperExists
        ? 'Build wrapper detected (mvnw/gradlew).'
        : 'No Java build wrapper detected.',
      recommendation: buildWrapperExists
        ? undefined
        : 'Commit mvnw or gradlew for reproducible enterprise pipelines.',
    });

    const bootEntryExists =
      (await anyRelativePathExists(projectPath, [
        'src/main/java/Application.java',
        'src/main/kotlin/Application.kt',
      ])) ||
      (await findFileByName(projectPath, {
        suffix: 'Application.java',
        under: ['src/main/java'],
      })) ||
      (await findFileByName(projectPath, {
        suffix: 'Application.kt',
        under: ['src/main/kotlin'],
      }));
    pushProjectProbe(health, {
      id: 'adapter-java-boot-entrypoint',
      label: 'Java adapter boot entrypoint',
      status: bootEntryExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: bootEntryExists
        ? 'Java application entrypoint markers detected.'
        : 'No Java application entrypoint markers detected.',
      recommendation: bootEntryExists
        ? undefined
        : 'Expose a Spring Boot Application class under src/main/java or src/main/kotlin.',
    });
    return;
  }

  if (runtime === 'go') {
    const goSumExists = await fsExtra.pathExists(path.join(projectPath, 'go.sum'));
    pushProjectProbe(health, {
      id: 'adapter-go-module-integrity',
      label: 'Go adapter module integrity',
      status: goSumExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: goSumExists
        ? 'go.sum detected for deterministic module verification.'
        : 'go.sum missing; module integrity baseline is incomplete.',
      recommendation: goSumExists
        ? undefined
        : 'Generate and commit go.sum in the repository baseline.',
    });
    const bootEntryExists = await anyRelativePathExists(projectPath, [
      'cmd/server/main.go',
      'cmd/api/main.go',
      'main.go',
    ]);
    pushProjectProbe(health, {
      id: 'adapter-go-boot-entrypoint',
      label: 'Go adapter boot entrypoint',
      status: bootEntryExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: bootEntryExists
        ? 'Go application entrypoint markers detected.'
        : 'No Go application entrypoint markers detected.',
      recommendation: bootEntryExists
        ? undefined
        : 'Expose a Go main package entrypoint such as cmd/server/main.go.',
    });
    return;
  }

  if (runtime === 'dotnet') {
    const bootEntryExists =
      (await anyRelativePathExists(projectPath, ['Program.cs', 'src/Program.cs'])) ||
      (await findFileByName(projectPath, { name: 'Program.cs' }));
    pushProjectProbe(health, {
      id: 'adapter-dotnet-boot-entrypoint',
      label: '.NET adapter boot entrypoint',
      status: bootEntryExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: bootEntryExists
        ? '.NET application entrypoint markers detected.'
        : 'No .NET application entrypoint markers detected.',
      recommendation: bootEntryExists
        ? undefined
        : 'Expose Program.cs at the project root or under src for deterministic boot probes.',
    });
  }
}

type CustomDoctorAdapterCheck = {
  id?: string;
  label?: string;
  severity?: 'info' | 'warn' | 'error';
  runtimes?: ProjectRuntimeFamily[];
  anyOfPaths?: string[];
  allOfPaths?: string[];
  recommendation?: string;
  passReason?: string;
  failReason?: string;
};

async function appendCustomAdapterChecks(
  projectPath: string,
  health: ProjectHealth
): Promise<void> {
  const candidates = [
    path.join(projectPath, '.workspai', 'doctor.adapters.json'),
    path.join(projectPath, '.rapidkit', 'doctor.adapters.json'),
    path.join(projectPath, 'doctor.adapters.json'),
  ];

  for (const candidatePath of candidates) {
    if (!(await fsExtra.pathExists(candidatePath))) {
      continue;
    }

    try {
      const raw = (await fsExtra.readJSON(candidatePath)) as {
        checks?: CustomDoctorAdapterCheck[];
      };
      const checks = Array.isArray(raw?.checks) ? raw.checks : [];

      for (let index = 0; index < checks.length; index += 1) {
        const check = checks[index] || {};
        const configuredRuntimes = Array.isArray(check.runtimes) ? check.runtimes : [];
        if (
          configuredRuntimes.length > 0 &&
          !configuredRuntimes.includes(health.runtimeFamily || 'unknown')
        ) {
          continue;
        }

        const id =
          typeof check.id === 'string' && check.id.trim().length > 0
            ? check.id.trim()
            : `adapter-check-${index + 1}`;
        const label =
          typeof check.label === 'string' && check.label.trim().length > 0
            ? check.label.trim()
            : id;
        const severity = check.severity || 'warn';
        const anyOfPaths = Array.isArray(check.anyOfPaths) ? check.anyOfPaths.filter(Boolean) : [];
        const allOfPaths = Array.isArray(check.allOfPaths) ? check.allOfPaths.filter(Boolean) : [];

        let passAny = anyOfPaths.length === 0;
        for (const p of anyOfPaths) {
          if (await fsExtra.pathExists(path.join(projectPath, p))) {
            passAny = true;
            break;
          }
        }

        let passAll = true;
        for (const p of allOfPaths) {
          if (!(await fsExtra.pathExists(path.join(projectPath, p)))) {
            passAll = false;
            break;
          }
        }

        const passed = passAny && passAll;
        pushProjectProbe(health, {
          id,
          label,
          status: passed ? 'pass' : severity === 'error' ? 'fail' : 'warn',
          severity,
          scope: 'project-scoped',
          reason: passed
            ? check.passReason || 'Custom adapter contract satisfied.'
            : check.failReason ||
              `Custom adapter check failed from ${path.basename(candidatePath)}.`,
          recommendation: check.recommendation,
        });
      }
    } catch {
      pushProjectProbe(health, {
        id: 'custom-adapter-config',
        label: 'Custom doctor adapter configuration',
        status: 'warn',
        severity: 'warn',
        scope: 'project-scoped',
        reason: `Failed to parse ${path.basename(candidatePath)}.`,
        recommendation: 'Fix JSON syntax in doctor.adapters.json to re-enable adapter checks.',
      });
    }
  }
}

async function appendBuiltInBackendProbes(
  projectPath: string,
  health: ProjectHealth
): Promise<void> {
  const isBackend = health.projectKind === 'backend' || health.projectKind === 'generic';
  if (!isBackend) {
    return;
  }

  const envPath = path.join(projectPath, '.env');
  const envExamplePath = path.join(projectPath, '.env.example');
  const hasConfigSurface =
    (await fsExtra.pathExists(envPath)) ||
    (await fsExtra.pathExists(envExamplePath)) ||
    (await fsExtra.pathExists(path.join(projectPath, 'config')));
  pushProjectProbe(health, {
    id: 'config-surface',
    label: 'Configuration contract surface',
    status: hasConfigSurface ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasConfigSurface
      ? 'Configuration artifacts detected (.env/.env.example/config).'
      : 'No explicit configuration contract artifacts detected.',
    recommendation: hasConfigSurface
      ? undefined
      : 'Add .env.example or explicit config contract documentation for deterministic setup.',
  });

  const migrationMarkersByRuntime: Record<ProjectRuntimeFamily, string[]> = {
    python: ['alembic.ini', 'migrations', 'versions'],
    node: ['prisma/schema.prisma', 'migrations', 'typeorm.config.ts', 'typeorm.config.js'],
    bun: ['prisma/schema.prisma', 'migrations', 'typeorm.config.ts', 'typeorm.config.js'],
    go: ['migrations', 'db/migrations'],
    java: ['src/main/resources/db/migration', 'src/main/resources/liquibase'],
    rust: ['migrations', 'sqlx-data.json'],
    elixir: ['priv/repo/migrations'],
    clojure: ['resources/migrations', 'migrations'],
    deno: ['migrations'],
    php: ['database/migrations', 'migrations'],
    ruby: ['db/migrate'],
    dotnet: ['Migrations', 'Data/Migrations'],
    scala: ['src/main/resources/db/migration', 'conf/evolutions'],
    kotlin: ['src/main/resources/db/migration', 'src/main/resources/liquibase'],
    c: ['migrations', 'db/migrations'],
    cpp: ['migrations', 'db/migrations'],
    unknown: ['migrations'],
  };

  const runtime = health.runtimeFamily || 'unknown';
  const migrationMarkers = migrationMarkersByRuntime[runtime] || migrationMarkersByRuntime.unknown;
  let hasMigrationSurface = false;
  for (const marker of migrationMarkers) {
    if (await fsExtra.pathExists(path.join(projectPath, marker))) {
      hasMigrationSurface = true;
      break;
    }
  }

  pushProjectProbe(health, {
    id: 'migration-surface',
    label: 'Migration/readiness surface',
    status: hasMigrationSurface ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasMigrationSurface
      ? 'Migration or schema evolution markers detected.'
      : 'No migration markers detected for this backend runtime.',
    recommendation: hasMigrationSurface
      ? undefined
      : 'Add migration tooling baseline (migrations dir or runtime-native migration config).',
  });

  const healthMarkers = [
    'src/health',
    'src/healthcheck',
    'src/main/resources/application.yml',
    'src/main/resources/application.properties',
    'app/health.py',
    'routes/health.ts',
    'routes/health.js',
  ];
  let hasHealthSurface = false;
  for (const marker of healthMarkers) {
    if (await fsExtra.pathExists(path.join(projectPath, marker))) {
      hasHealthSurface = true;
      break;
    }
  }

  pushProjectProbe(health, {
    id: 'runtime-health-surface',
    label: 'Runtime health probe surface',
    status: hasHealthSurface ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasHealthSurface
      ? 'Health endpoint/config markers detected.'
      : 'No explicit runtime health endpoint markers detected.',
    recommendation: hasHealthSurface
      ? undefined
      : 'Expose a deterministic health endpoint and keep it covered in verify pack.',
  });

  await appendRuntimeAdapterProbes(projectPath, health);
}

async function appendBuiltInFrontendProbes(
  projectPath: string,
  health: ProjectHealth,
  packageJsonData: Record<string, unknown> | null,
  detection: BackendFrameworkDetection
): Promise<void> {
  const probes = await buildFrontendDoctorProbes({
    projectPath,
    detection,
    packageJsonData,
  });

  for (const probe of probes) {
    pushProjectProbe(health, probe);
  }
}

async function appendEnterpriseSurfaceProbes(
  projectPath: string,
  health: ProjectHealth,
  packageJsonData?: Record<string, unknown> | null
): Promise<void> {
  const probes = await buildEnterpriseSurfaceProbes({
    projectPath,
    runtimeFamily: health.runtimeFamily,
    projectKind: health.projectKind,
    framework: health.framework,
    packageJsonData,
    hasTests: health.hasTests,
    hasDocker: health.hasDocker,
    vulnerabilities: health.vulnerabilities,
    dependencyAudit: health.dependencyAudit,
  });

  for (const probe of probes) {
    pushProjectProbe(health, probe);
  }
}

type CustomDoctorProbeConfig = {
  id?: string;
  label?: string;
  severity?: 'info' | 'warn' | 'error';
  anyOfPaths?: string[];
  allOfPaths?: string[];
  recommendation?: string;
};

async function appendCustomConfiguredProbes(
  projectPath: string,
  health: ProjectHealth
): Promise<void> {
  const candidates = [
    path.join(projectPath, '.workspai', 'doctor.probes.json'),
    path.join(projectPath, '.rapidkit', 'doctor.probes.json'),
    path.join(projectPath, 'doctor.probes.json'),
  ];

  for (const candidatePath of candidates) {
    if (!(await fsExtra.pathExists(candidatePath))) {
      continue;
    }

    try {
      const raw = (await fsExtra.readJSON(candidatePath)) as {
        probes?: CustomDoctorProbeConfig[];
      };
      const probes = Array.isArray(raw?.probes) ? raw.probes : [];

      for (let index = 0; index < probes.length; index += 1) {
        const probe = probes[index] || {};
        const id =
          typeof probe.id === 'string' && probe.id.trim().length > 0
            ? probe.id.trim()
            : `custom-probe-${index + 1}`;
        const label =
          typeof probe.label === 'string' && probe.label.trim().length > 0
            ? probe.label.trim()
            : id;
        const severity = probe.severity || 'warn';

        const anyOfPaths = Array.isArray(probe.anyOfPaths) ? probe.anyOfPaths.filter(Boolean) : [];
        const allOfPaths = Array.isArray(probe.allOfPaths) ? probe.allOfPaths.filter(Boolean) : [];

        let passAny = anyOfPaths.length === 0;
        for (const p of anyOfPaths) {
          if (await fsExtra.pathExists(path.join(projectPath, p))) {
            passAny = true;
            break;
          }
        }

        let passAll = true;
        for (const p of allOfPaths) {
          if (!(await fsExtra.pathExists(path.join(projectPath, p)))) {
            passAll = false;
            break;
          }
        }

        const passed = passAny && passAll;
        pushProjectProbe(health, {
          id,
          label,
          status: passed ? 'pass' : severity === 'error' ? 'fail' : 'warn',
          severity,
          scope: 'project-scoped',
          reason: passed
            ? 'Custom probe contract satisfied.'
            : `Custom probe failed from ${path.basename(candidatePath)}.`,
          recommendation: probe.recommendation,
        });
      }
    } catch {
      pushProjectProbe(health, {
        id: 'custom-probe-config',
        label: 'Custom doctor probe configuration',
        status: 'warn',
        severity: 'warn',
        scope: 'project-scoped',
        reason: `Failed to parse ${path.basename(candidatePath)}.`,
        recommendation: 'Fix JSON syntax in doctor.probes.json to re-enable custom probes.',
      });
    }
  }

  await appendCustomAdapterChecks(projectPath, health);
}

async function checkProject(
  projectPath: string,
  options: { allowNonRapidkit?: boolean } = {}
): Promise<ProjectHealth> {
  const projectName = path.basename(projectPath);
  const health: ProjectHealth = {
    name: projectName,
    path: projectPath,
    venvActive: false,
    depsInstalled: false,
    coreInstalled: false,
    issues: [],
    fixCommands: [],
  };

  const allowNonRapidkit = options.allowNonRapidkit === true;
  const hasWorkspaiMetadata =
    (await fsExtra.pathExists(path.join(projectPath, '.workspai'))) ||
    (await fsExtra.pathExists(path.join(projectPath, '.rapidkit')));
  if (!hasWorkspaiMetadata) {
    if (!allowNonRapidkit) {
      health.issues.push('Not a valid Workspai project (missing .workspai metadata)');
      return health;
    }
    health.issues.push('Not a Workspai-managed project (running generic backend diagnostics)');
  }

  // Try to read kit info and stats from registry.json
  try {
    const registryPath = path.join(projectPath, 'registry.json');
    if (await fsExtra.pathExists(registryPath)) {
      const registry = await fsExtra.readJson(registryPath);
      if (registry.installed_modules) {
        health.stats = {
          modules: registry.installed_modules.length,
        };
      }
    }
  } catch {
    // Ignore if can't read registry
  }

  try {
    const { auditProjectModulePaths } = await import('./utils/module-layout.js');
    const moduleAudit = await auditProjectModulePaths(projectPath);
    if (moduleAudit.issues.length > 0) {
      for (const issue of moduleAudit.issues) {
        health.issues.push(`${issue.message} (${issue.slug})`);
      }
      health.fixCommands = health.fixCommands ?? [];
      health.fixCommands.push('npx workspai workspace contract verify --strict --json');
      health.fixCommands.push(
        'npx workspai add module <slug>  # reinstall via Core-backed module install'
      );
    }
  } catch {
    // Non-fatal module layout audit
  }

  // Try to read kit info from canonical Workspai metadata, then legacy RapidKit metadata.
  let projectJsonData: Record<string, unknown> | null = null;
  try {
    for (const projectJsonPath of projectMetadataCandidates(projectPath, 'project.json')) {
      if (!(await fsExtra.pathExists(projectJsonPath))) {
        continue;
      }
      projectJsonData = await fsExtra.readJson(projectJsonPath);
      // Support both 'kit' (legacy) and 'kit_name' (new generator) fields
      const kitValue = (projectJsonData?.kit_name || projectJsonData?.kit) as string | undefined;
      if (kitValue) {
        health.kit = kitValue;
      }
      break;
    }
  } catch {
    // Ignore if can't read kit info
  }

  // Last Modified check
  try {
    const gitPath = path.join(projectPath, '.git');
    if (await fsExtra.pathExists(gitPath)) {
      const { stdout } = await execa('git', ['log', '-1', '--format=%cr'], {
        cwd: projectPath,
        reject: false,
        env: buildCleanGitEnv(),
      });
      if (stdout) {
        health.lastModified = stdout.trim();
      }
    } else {
      // Fallback to directory modification time
      const stat = await fsExtra.stat(projectPath);
      const now = Date.now();
      const diff = now - stat.mtime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      health.lastModified = days === 0 ? 'today' : `${days} day${days > 1 ? 's' : ''} ago`;
    }
  } catch {
    // Ignore if can't determine last modified
  }

  // Detect project type using runtime/framework signals
  const packageJsonPath = path.join(projectPath, 'package.json');
  const pyprojectTomlPath = path.join(projectPath, 'pyproject.toml');
  const requirementsTxtPath = path.join(projectPath, 'requirements.txt');
  const goModPath = path.join(projectPath, 'go.mod');
  const pomXmlPath = path.join(projectPath, 'pom.xml');
  const buildSbtPath = path.join(projectPath, 'build.sbt');
  const cargoTomlPath = path.join(projectPath, 'Cargo.toml');
  const mixExsPath = path.join(projectPath, 'mix.exs');
  const depsEdnPath = path.join(projectPath, 'deps.edn');
  const projectCljPath = path.join(projectPath, 'project.clj');
  const denoJsonPath = path.join(projectPath, 'deno.json');
  const denoJsoncPath = path.join(projectPath, 'deno.jsonc');
  const bunLockbPath = path.join(projectPath, 'bun.lockb');
  const bunLockPath = path.join(projectPath, 'bun.lock');
  const composerJsonPath = path.join(projectPath, 'composer.json');
  const gemfilePath = path.join(projectPath, 'Gemfile');

  const isNodeProject = await fsExtra.pathExists(packageJsonPath);
  const isPythonProject =
    (await fsExtra.pathExists(pyprojectTomlPath)) ||
    (await fsExtra.pathExists(requirementsTxtPath));
  const isPhpProject = await fsExtra.pathExists(composerJsonPath);
  const isRubyProject = await fsExtra.pathExists(gemfilePath);
  const isRustProject = await fsExtra.pathExists(cargoTomlPath);
  const isElixirProject = await fsExtra.pathExists(mixExsPath);
  const isClojureProject =
    (await fsExtra.pathExists(depsEdnPath)) || (await fsExtra.pathExists(projectCljPath));
  const isScalaProject = await fsExtra.pathExists(buildSbtPath);
  const isDenoProject =
    (await fsExtra.pathExists(denoJsonPath)) || (await fsExtra.pathExists(denoJsoncPath));
  let isDotnetProject = projectJsonData?.runtime === 'dotnet';
  try {
    isDotnetProject =
      isDotnetProject ||
      (await hasFileWithSuffixWithinDepth(projectPath, '.csproj', 3)) ||
      (await hasFileWithSuffixWithinDepth(projectPath, '.sln', 2));
  } catch {
    isDotnetProject = projectJsonData?.runtime === 'dotnet';
  }

  const isGoProject =
    (await fsExtra.pathExists(goModPath)) ||
    projectJsonData?.runtime === 'go' ||
    (typeof projectJsonData?.kit_name === 'string' &&
      ((projectJsonData.kit_name as string).startsWith('gofiber') ||
        (projectJsonData.kit_name as string).startsWith('gogin')));

  const isBunProject =
    isNodeProject &&
    ((await fsExtra.pathExists(bunLockbPath)) ||
      (await fsExtra.pathExists(bunLockPath)) ||
      (typeof (projectJsonData?.packageManager as string | undefined) === 'string' &&
        (projectJsonData?.packageManager as string).toLowerCase().startsWith('bun@')));

  // Go project checks (Fiber or Gin)
  if (isGoProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.isGoProject = true;
    health.venvActive = true; // N/A for Go
    health.coreInstalled = false; // N/A for Go

    // Check if Go is installed
    try {
      await execa('go', ['version'], { timeout: 3000 });
    } catch {
      health.issues.push('Go toolchain not found — install from https://go.dev/dl/');
      health.fixCommands?.push('https://go.dev/dl/');
    }

    // Check deps via go.sum
    const goSumPath = path.join(projectPath, 'go.sum');
    if (await fsExtra.pathExists(goSumPath)) {
      health.depsInstalled = true;
    } else {
      health.depsInstalled = false;
      health.issues.push('Go dependencies not downloaded (go.sum missing)');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'go mod tidy'));
    }

    // .env check — Go reads env vars from OS directly; .env is optional (no dotenv loaded by default)
    // Leave hasEnvFile undefined so the Environment row is hidden in the output.

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  const isJavaProject =
    (await fsExtra.pathExists(pomXmlPath)) ||
    projectJsonData?.runtime === 'java' ||
    (typeof projectJsonData?.kit_name === 'string' &&
      (projectJsonData.kit_name as string).startsWith('springboot'));

  if (isJavaProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const hasPomXml = await fsExtra.pathExists(pomXmlPath);
    const hasGradleBuild =
      (await fsExtra.pathExists(path.join(projectPath, 'build.gradle'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'build.gradle.kts')));
    const hasMavenWrapper =
      (await fsExtra.pathExists(path.join(projectPath, 'mvnw'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'mvnw.cmd')));
    const hasGradleWrapper =
      (await fsExtra.pathExists(path.join(projectPath, 'gradlew'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'gradlew.bat')));

    try {
      await execa('java', ['-version'], { timeout: 3000, reject: false });
    } catch {
      health.issues.push('Java runtime not found — install JDK 21+ and ensure java is on PATH');
      health.fixCommands?.push('https://adoptium.net/');
    }

    if (hasPomXml) {
      if (!hasMavenWrapper) {
        try {
          await execa('mvn', ['-version'], { timeout: 3000, reject: false });
        } catch {
          health.issues.push('Maven not found — install Maven 3.9+ or add Maven Wrapper');
          health.fixCommands?.push('https://maven.apache.org/install.html');
        }
      }
    } else if (hasGradleBuild) {
      if (!hasGradleWrapper) {
        try {
          await execa('gradle', ['--version'], { timeout: 3000, reject: false });
        } catch {
          health.issues.push('Gradle not found — install Gradle 8+ or add Gradle Wrapper');
          health.fixCommands?.push('https://gradle.org/install/');
        }
      }
    }

    const targetPath = path.join(projectPath, 'target');
    const gradleLibsPath = path.join(projectPath, 'build', 'libs');
    const localMavenCachePath = path.join(projectPath, '.workspai', 'cache', 'java', 'm2');
    const localGradleCachePath = path.join(projectPath, '.workspai', 'cache', 'java', 'gradle');
    health.depsInstalled =
      (await fsExtra.pathExists(targetPath)) ||
      (await fsExtra.pathExists(gradleLibsPath)) ||
      (await fsExtra.pathExists(localMavenCachePath)) ||
      (await fsExtra.pathExists(localGradleCachePath));

    if (!health.depsInstalled) {
      health.issues.push('Java dependencies are not warmed or built yet');
      const dependencyCommand = hasPomXml
        ? hasMavenWrapper
          ? isWindowsPlatform()
            ? '.\\mvnw.cmd -B -DskipTests dependency:go-offline'
            : './mvnw -B -DskipTests dependency:go-offline'
          : 'mvn -B -DskipTests dependency:go-offline'
        : hasGradleWrapper
          ? isWindowsPlatform()
            ? '.\\gradlew.bat dependencies'
            : './gradlew dependencies'
          : 'gradle dependencies';
      health.fixCommands?.push(buildProjectFixCommand(projectPath, dependencyCommand));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    const applicationYamlPath = path.join(
      projectPath,
      'src',
      'main',
      'resources',
      'application.yml'
    );
    if (await fsExtra.pathExists(applicationYamlPath)) {
      try {
        const applicationYamlRaw = await fsExtra.readFile(applicationYamlPath, 'utf-8');
        const hasHealthExposure =
          /include:\s*[^\n]*health/i.test(applicationYamlRaw) ||
          /management:\s*[\s\S]*endpoint:\s*[\s\S]*health:/i.test(applicationYamlRaw);

        if (!hasHealthExposure) {
          health.issues.push(
            'Actuator health endpoint exposure is not clearly configured in application.yml'
          );
          health.fixCommands?.push(
            buildProjectFixCommand(
              projectPath,
              'Ensure management.endpoints.web.exposure.include contains health in src/main/resources/application.yml'
            )
          );
        }
      } catch {
        health.issues.push('Unable to read application.yml for Spring Actuator health checks');
      }
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isRustProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const cargoLockPath = path.join(projectPath, 'Cargo.lock');
    const rustTargetPath = path.join(projectPath, 'target');
    health.depsInstalled =
      (await fsExtra.pathExists(cargoLockPath)) || (await fsExtra.pathExists(rustTargetPath));

    if (!health.depsInstalled) {
      health.issues.push('Rust dependencies are not resolved yet (Cargo.lock/target missing)');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'cargo fetch'));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isElixirProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const mixLockPath = path.join(projectPath, 'mix.lock');
    const depsPath = path.join(projectPath, 'deps');
    health.depsInstalled =
      (await fsExtra.pathExists(mixLockPath)) || (await fsExtra.pathExists(depsPath));

    if (!health.depsInstalled) {
      health.issues.push('Elixir dependencies not installed (mix.lock/deps missing)');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'mix deps.get'));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isClojureProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const cpcachePath = path.join(projectPath, '.cpcache');
    const targetPath = path.join(projectPath, 'target');
    const hasDepsManifest =
      (await fsExtra.pathExists(depsEdnPath)) || (await fsExtra.pathExists(projectCljPath));
    health.depsInstalled =
      (await fsExtra.pathExists(cpcachePath)) ||
      (await fsExtra.pathExists(targetPath)) ||
      hasDepsManifest;

    if (!health.depsInstalled) {
      health.issues.push('Clojure dependency cache not initialized');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'clojure -P'));
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isScalaProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const targetPath = path.join(projectPath, 'target');
    health.depsInstalled = await fsExtra.pathExists(targetPath);

    if (!health.depsInstalled) {
      health.issues.push('Scala build artifacts missing (run dependency/build warmup)');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'sbt compile'));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isDenoProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;
    health.depsInstalled = true;

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  // Node.js project checks
  if (isNodeProject) {
    let packageJsonData: Record<string, unknown> | null = null;
    try {
      packageJsonData = await fsExtra.readJson(packageJsonPath);
    } catch {
      packageJsonData = null;
    }

    const dependencies = {
      ...((packageJsonData?.dependencies as Record<string, unknown> | undefined) ?? {}),
      ...((packageJsonData?.devDependencies as Record<string, unknown> | undefined) ?? {}),
    };

    const scripts =
      (packageJsonData?.scripts as Record<string, unknown> | undefined) ??
      ({} as Record<string, unknown>);

    const kitName =
      typeof projectJsonData?.kit_name === 'string'
        ? (projectJsonData.kit_name as string).toLowerCase()
        : typeof projectJsonData?.kit === 'string'
          ? (projectJsonData.kit as string).toLowerCase()
          : '';

    const frontendDetection = detectFrontendFrameworkFromProject(projectPath, projectJsonData);
    const nodeDetection = detectNodeFrameworkFromManifest({
      dependencies,
      scripts,
      kitName,
    });
    if (isBunProject) {
      applyFrameworkMetadata(health, 'Bun', 'high');
    } else {
      const backendDetection = detectBackendFrameworkFromProject(
        projectPath,
        projectJsonData ?? null
      );
      const explicitBackendNodeFramework =
        backendDetection.key === 'nestjs' ||
        backendDetection.key === 'express' ||
        backendDetection.key === 'fastify' ||
        backendDetection.key === 'koa';

      if (explicitBackendNodeFramework) {
        applyBackendFrameworkDetection(health, backendDetection);
      } else if (frontendDetection.key !== 'unknown') {
        applyFrontendFrameworkDetection(health, frontendDetection);
      } else if (backendDetection.key !== 'unknown' && backendDetection.key !== 'node') {
        applyBackendFrameworkDetection(health, backendDetection);
      } else {
        applyFrameworkMetadata(health, nodeDetection.framework, nodeDetection.confidence);
      }
    }
    health.venvActive = true; // N/A for Node.js projects

    // Check for node_modules
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    if (await fsExtra.pathExists(nodeModulesPath)) {
      try {
        const modules = await fsExtra.readdir(nodeModulesPath);
        // Check if there are actual packages (more than just .bin, .cache, etc.)
        const realPackages = modules.filter((m) => !m.startsWith('.') && !m.startsWith('_'));
        health.depsInstalled = realPackages.length > 0;
      } catch {
        health.depsInstalled = false;
      }
    }

    if (!health.depsInstalled) {
      health.issues.push('Dependencies not installed (node_modules empty or missing)');
      const declaredPackageManager =
        typeof packageJsonData?.packageManager === 'string'
          ? packageJsonData.packageManager.split('@')[0]
          : undefined;
      const nodeInstallCommand = isBunProject
        ? 'bun install'
        : declaredPackageManager === 'pnpm' ||
            (await fsExtra.pathExists(path.join(projectPath, 'pnpm-lock.yaml')))
          ? 'pnpm install'
          : declaredPackageManager === 'yarn' ||
              (await fsExtra.pathExists(path.join(projectPath, 'yarn.lock')))
            ? 'yarn install'
            : 'npm install';
      health.fixCommands?.push(buildProjectFixCommand(projectPath, nodeInstallCommand));
    }

    // Node.js projects don't need Python venv
    health.coreInstalled = false; // N/A for Node.js

    // Check environment files.
    // For frontend frameworks, .env.* files are optional; show warning only when .env.example exists.
    if (health.projectKind === 'frontend') {
      const envCandidates = [
        '.env',
        '.env.local',
        '.env.development',
        '.env.development.local',
        '.env.production',
        '.env.production.local',
      ];
      const hasAnyEnvFile = (
        await Promise.all(
          envCandidates.map((name) => fsExtra.pathExists(path.join(projectPath, name)))
        )
      ).some(Boolean);

      if (hasAnyEnvFile) {
        health.hasEnvFile = true;
      } else {
        const envExamplePath = path.join(projectPath, '.env.example');
        if (await fsExtra.pathExists(envExamplePath)) {
          health.hasEnvFile = false;
          health.issues.push('Environment file missing (found .env.example)');
          health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
        }
      }
    } else {
      const envPath = path.join(projectPath, '.env');
      health.hasEnvFile = await fsExtra.pathExists(envPath);
      if (!health.hasEnvFile) {
        const envExamplePath = path.join(projectPath, '.env.example');
        if (await fsExtra.pathExists(envExamplePath)) {
          health.issues.push('Environment file missing (found .env.example)');
          health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
        }
      }
    }

    if (health.projectKind === 'frontend') {
      health.modulesHealthy = await assessFrontendSourceTree(projectPath);
      health.missingModules = [];
    } else {
      const srcPath = path.join(projectPath, 'src');
      health.modulesHealthy = true;
      health.missingModules = [];

      if (await fsExtra.pathExists(srcPath)) {
        try {
          const modules = await fsExtra.readdir(srcPath);
          health.modulesHealthy = modules.length > 0;
        } catch {
          health.modulesHealthy = false;
        }
      }
    }

    // Common checks for both Node.js and Python
    await performCommonChecks(projectPath, health, packageJsonData);
    await appendEnterpriseSurfaceProbes(projectPath, health, packageJsonData);
    if (health.projectKind === 'frontend') {
      await appendBuiltInFrontendProbes(
        projectPath,
        health,
        packageJsonData,
        frontendDetection.key !== 'unknown'
          ? frontendDetection
          : detectFrontendFrameworkFromProject(projectPath, projectJsonData)
      );
    } else {
      await appendBuiltInBackendProbes(projectPath, health);
    }
    await appendCustomConfiguredProbes(projectPath, health);

    return health;
  }

  // Python/FastAPI project checks
  if (isPythonProject) {
    const pythonDetection = await detectPythonFramework(projectPath, projectJsonData);
    applyFrameworkMetadata(health, pythonDetection.framework, pythonDetection.confidence);

    let frameworkImport = 'fastapi';
    if (health.framework === 'Django') frameworkImport = 'django';
    else if (health.framework === 'Flask') frameworkImport = 'flask';
    else if (health.framework === 'Python') frameworkImport = '';

    const pyprojectText = await readFileIfExists(pyprojectTomlPath);
    const environment = await resolvePythonProjectEnvironment(
      projectPath,
      frameworkImport,
      /\[tool\.poetry\]/.test(pyprojectText)
    );
    health.venvActive = Boolean(environment.environmentPath);
    health.depsInstalled = environment.dependenciesInstalled;
    health.coreInstalled = Boolean(environment.coreVersion);
    health.coreVersion = environment.coreVersion;

    if (!environment.environmentPath) {
      health.issues.push('Virtual environment not created');
      health.fixCommands?.push(buildPythonDependencyInstallFixCommand(projectPath));
    } else if (!environment.interpreter) {
      health.issues.push('Virtual environment exists but Python executable not found');
    } else if (!health.depsInstalled) {
      health.issues.push('Dependencies not installed');
      health.fixCommands?.push(buildPythonDependencyInstallFixCommand(projectPath));
    }

    // Check for .env file
    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    // Check for critical modules (src/__init__.py or modules/)
    const srcPath = path.join(projectPath, 'src');
    const modulesPath = path.join(projectPath, 'modules');

    health.modulesHealthy = true;
    health.missingModules = [];

    if (await fsExtra.pathExists(srcPath)) {
      const srcInit = path.join(srcPath, '__init__.py');
      if (!(await fsExtra.pathExists(srcInit))) {
        health.modulesHealthy = false;
        health.missingModules.push('src/__init__.py');
      }
    }

    if (await fsExtra.pathExists(modulesPath)) {
      try {
        const modules = await listDirectories(modulesPath);
        for (const module of modules) {
          const moduleInit = path.join(modulesPath, module, '__init__.py');
          if (!(await fsExtra.pathExists(moduleInit))) {
            health.modulesHealthy = false;
            health.missingModules.push(`modules/${module}/__init__.py`);
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    if (!health.modulesHealthy && health.missingModules.length > 0) {
      health.issues.push(`Missing module init files: ${health.missingModules.join(', ')}`);
    }

    // Common checks for both Node.js and Python
    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);

    return health;
  }

  if (isPhpProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const vendorPath = path.join(projectPath, 'vendor');
    health.depsInstalled = await fsExtra.pathExists(vendorPath);
    if (!health.depsInstalled) {
      health.issues.push('PHP dependencies not installed (vendor missing)');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'composer install'));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);
    if (!health.hasEnvFile) {
      const envExamplePath = path.join(projectPath, '.env.example');
      if (await fsExtra.pathExists(envExamplePath)) {
        health.issues.push('Environment file missing (found .env.example)');
        health.fixCommands?.push(buildEnvCopyFixCommand(projectPath));
      }
    }

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isRubyProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const hasLockFile = await fsExtra.pathExists(path.join(projectPath, 'Gemfile.lock'));
    const hasVendorBundle = await fsExtra.pathExists(path.join(projectPath, 'vendor', 'bundle'));
    health.depsInstalled = hasLockFile || hasVendorBundle;
    if (!health.depsInstalled) {
      health.issues.push('Ruby dependencies not installed (Gemfile.lock/vendor missing)');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'bundle install'));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  if (isDotnetProject) {
    applyBackendFrameworkDetection(
      health,
      detectBackendFrameworkFromProject(projectPath, projectJsonData ?? null)
    );
    health.venvActive = true;
    health.coreInstalled = false;

    const objPath = path.join(projectPath, 'obj');
    const srcObjPath = path.join(projectPath, 'src', 'obj');
    const packagesLockPath = path.join(projectPath, 'packages.lock.json');
    health.depsInstalled =
      (await fsExtra.pathExists(objPath)) ||
      (await fsExtra.pathExists(srcObjPath)) ||
      (await fsExtra.pathExists(packagesLockPath));
    if (!health.depsInstalled) {
      health.issues.push('.NET restore/build artifacts not found');
      health.fixCommands?.push(buildProjectFixCommand(projectPath, 'dotnet restore'));
    }

    const envPath = path.join(projectPath, '.env');
    health.hasEnvFile = await fsExtra.pathExists(envPath);

    await performCommonChecks(projectPath, health);
    await appendEnterpriseSurfaceProbes(projectPath, health);
    await appendBuiltInBackendProbes(projectPath, health);
    await appendCustomConfiguredProbes(projectPath, health);
    return health;
  }

  // If runtime markers are absent, return basic health
  applyFrameworkMetadata(health, 'Unknown', 'low');
  health.issues.push('Unknown project type (no recognized runtime marker files)');

  await performCommonChecks(projectPath, health);
  await appendEnterpriseSurfaceProbes(projectPath, health);
  await appendBuiltInBackendProbes(projectPath, health);
  await appendCustomConfiguredProbes(projectPath, health);
  return health;
}

async function listDirectories(basePath: string): Promise<string[]> {
  try {
    const entries = await fsExtra.readdir(basePath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    try {
      const entries = await fsExtra.readdir(basePath);
      const dirs: string[] = [];
      for (const name of entries) {
        try {
          const stat = await fsExtra.stat(path.join(basePath, name));
          if (stat.isDirectory()) {
            dirs.push(name);
          }
        } catch {
          continue;
        }
      }
      return dirs;
    } catch {
      return [];
    }
  }
}

async function hasFileWithSuffixWithinDepth(
  basePath: string,
  suffix: string,
  maxDepth: number
): Promise<boolean> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: basePath, depth: 0 }];
  const ignoredDirs = new Set([
    '.git',
    '.workspai',
    '.rapidkit',
    'node_modules',
    'bin',
    'obj',
    'target',
  ]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) {
      continue;
    }

    let entries;
    try {
      entries = await fsExtra.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix.toLowerCase())) {
        return true;
      }

      if (entry.isDirectory() && !ignoredDirs.has(entry.name)) {
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }

  return false;
}

async function hasRapidkitProjectMarkers(projectPath: string): Promise<boolean> {
  const markerFiles = ['project.json', 'context.json', 'file-hashes.json'];
  for (const metadataDir of ['.workspai', '.rapidkit']) {
    for (const markerFile of markerFiles) {
      if (await fsExtra.pathExists(path.join(projectPath, metadataDir, markerFile))) {
        return true;
      }
    }
  }

  return false;
}

function shouldIgnoreWorkspaceDir(dirName: string, ignoredDirs: Set<string>): boolean {
  if (ignoredDirs.has(dirName)) {
    return true;
  }

  const lowerName = dirName.toLowerCase();
  if (lowerName === 'dist' || lowerName.startsWith('dist-') || lowerName.startsWith('dist_')) {
    return true;
  }

  if (lowerName === 'build' || lowerName.startsWith('build-') || lowerName.startsWith('build_')) {
    return true;
  }

  return false;
}

async function findRapidkitProjectsDeep(
  workspacePath: string,
  maxDepth: number,
  ignoredDirs: Set<string>
): Promise<string[]> {
  const results = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: workspacePath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    try {
      const entries = await fsExtra.readdir(current.dir);
      for (const name of entries) {
        if (shouldIgnoreWorkspaceDir(name, ignoredDirs)) continue;

        const fullPath = path.join(current.dir, name);
        let stat;
        try {
          stat = await fsExtra.stat(fullPath);
        } catch {
          continue;
        }

        if (!stat.isDirectory()) continue;

        if (await hasRapidkitProjectMarkers(fullPath)) {
          results.add(fullPath);
          continue;
        }

        if (current.depth < maxDepth) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
      }
    } catch {
      continue;
    }
  }

  return Array.from(results);
}

async function findWorkspace(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;

  while (true) {
    if (await hasWorkspaceRootMarkers(currentPath)) {
      return currentPath;
    }

    if (currentPath === root) {
      break;
    }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

async function findProjectRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);
  const workspaceRoot = await findWorkspace(currentPath);
  const root = workspaceRoot ?? path.parse(currentPath).root;

  while (true) {
    if (await hasRapidkitProjectMarkers(currentPath)) {
      return currentPath;
    }

    if (await hasBackendProjectMarkers(currentPath)) {
      // Inside a workspace, backend markers at workspace root are usually
      // toolchain/workspace metadata and should not be treated as project scope.
      if (!workspaceRoot || currentPath !== workspaceRoot) {
        return currentPath;
      }
    }

    if (currentPath === root) {
      break;
    }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

function normalizeReportedPath(targetPath: string): string {
  const resolvedPath = path.resolve(targetPath);
  if (process.platform === 'darwin') {
    return resolvedPath.replace(/^\/private(?=\/var\/)/, '');
  }
  return resolvedPath;
}

async function hasBackendProjectMarkers(projectPath: string): Promise<boolean> {
  const markerPaths = [
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'pom.xml',
    'build.sbt',
    'Cargo.toml',
    'mix.exs',
    'deps.edn',
    'project.clj',
    'deno.json',
    'deno.jsonc',
    'composer.json',
    'Gemfile',
  ];

  for (const marker of markerPaths) {
    if (await fsExtra.pathExists(path.join(projectPath, marker))) {
      return true;
    }
  }

  return false;
}

async function hasWorkspaceRootMarkers(candidatePath: string): Promise<boolean> {
  if (hasKnownWorkspaceRootMarkers(candidatePath)) {
    return true;
  }

  const markerFiles = [
    path.join(candidatePath, '.rapidkit', 'workspace-marker.json'),
    path.join(candidatePath, '.rapidkit', 'config.json'),
  ];

  return Promise.all(markerFiles.map((marker) => fsExtra.pathExists(marker))).then((results) =>
    results.some(Boolean)
  );
}

function calculateHealthScore(
  systemChecks: HealthCheckResult[],
  projects: ProjectHealth[]
): HealthScore {
  const host = { total: 0, passed: 0, warnings: 0, errors: 0 };
  const projectScore = { total: 0, passed: 0, warnings: 0, errors: 0 };

  systemChecks.forEach((check) => {
    host.total += 1;
    if (check.status === 'ok') host.passed += 1;
    else if (check.status === 'warn') host.warnings += 1;
    else if (check.status === 'error') host.errors += 1;
  });

  projects.forEach((project) => {
    const probes = project.probes ?? [];
    if (probes.length > 0) {
      for (const probe of probes) {
        projectScore.total += 1;
        if (probe.status === 'pass') projectScore.passed += 1;
        else if (probe.status === 'warn') projectScore.warnings += 1;
        else projectScore.errors += 1;
      }

      // Legacy runtime checks predate probe contracts. Preserve their blocking
      // meaning until each one has a typed probe, without allowing a passing
      // surface probe to hide an unresolved runtime issue.
      if (project.issues.length > 0) {
        projectScore.total += project.issues.length;
        projectScore.errors += project.issues.length;
      }
      return;
    }

    projectScore.total += 1;
    const advisoryWarnings = getProjectAdvisoryWarningCount(project);
    const isHealthy = project.isGoProject
      ? project.issues.length === 0 && project.depsInstalled
      : project.issues.length === 0 && project.venvActive && project.depsInstalled;
    if (project.issues.length > 0 || !isHealthy) projectScore.errors += 1;
    else if (advisoryWarnings > 0) projectScore.warnings += 1;
    else projectScore.passed += 1;
  });

  const passed = host.passed + projectScore.passed;
  const warnings = host.warnings + projectScore.warnings;
  const errors = host.errors + projectScore.errors;
  return {
    total: host.total + projectScore.total,
    passed,
    warnings,
    errors,
    verdict: errors > 0 ? 'blocked' : warnings > 0 ? 'attention' : 'passed',
    components: { host, projects: projectScore },
  };
}

function buildDoctorProbeSummary(project: ProjectHealth): DoctorProbeSummary {
  const probes = project.probes ?? [];
  const passed = probes.filter((probe) => probe.status === 'pass').length;
  const warnings = probes.filter((probe) => probe.status === 'warn').length;
  const failed = probes.filter((probe) => probe.status === 'fail').length;
  const blockingFindings = failed + project.issues.length;
  const advisoryFindings = warnings;
  return {
    total: probes.length,
    passed,
    warnings,
    failed,
    blockingFindings,
    advisoryFindings,
    verdict: blockingFindings > 0 ? 'blocked' : advisoryFindings > 0 ? 'attention' : 'passed',
  };
}

function applyProjectVerdict(project: ProjectHealth): void {
  const summary = buildDoctorProbeSummary(project);
  project.probeSummary = summary;
  project.verdict = summary.verdict;
}

function buildScoreBreakdown(
  systemChecks: Array<{ id: string; label: string; result: HealthCheckResult }>,
  projects: ProjectHealth[],
  options: { includeWorkspaceAggregateRules?: boolean } = {}
): ScoreBreakdownItem[] {
  const breakdown: ScoreBreakdownItem[] = [];

  for (const check of systemChecks) {
    breakdown.push({
      id: check.id,
      label: check.label,
      status: check.result.status,
      scope: 'host-system',
      policyRuleId: 'system-status-derived',
      reason: check.result.details || check.result.message,
    });
  }

  const sortedProjects = [...projects].sort((a, b) => {
    const left = `${a.path || ''}|${a.name || ''}`.toLowerCase();
    const right = `${b.path || ''}|${b.name || ''}`.toLowerCase();
    return left.localeCompare(right);
  });

  for (const project of sortedProjects) {
    applyProjectVerdict(project);
    for (const probe of project.probes ?? []) {
      breakdown.push({
        id: `project:${project.name}:probe:${probe.id}`,
        label: `${project.name} · ${probe.label}`,
        status: probe.status === 'pass' ? 'ok' : probe.status === 'warn' ? 'warn' : 'error',
        scope: 'project-scoped',
        policyRuleId: `project-probe-${probe.id}`,
        reason: probe.reason,
      });
    }
    for (const [index, issue] of project.issues.entries()) {
      breakdown.push({
        id: `project:${project.name}:legacy:${index + 1}`,
        label: `${project.name} · Runtime issue`,
        status: 'error',
        scope: 'project-scoped',
        policyRuleId: 'project-runtime-issue',
        reason: issue,
      });
    }
    if ((project.probes?.length ?? 0) === 0 && project.issues.length === 0) {
      breakdown.push({
        id: `project:${project.name}`,
        label: `Project ${project.name}`,
        status: 'ok',
        scope: 'project-scoped',
        policyRuleId: 'project-checks-passed',
        reason: 'Project checks passed',
      });
    }
  }

  if (options.includeWorkspaceAggregateRules) {
    const totalProjectIssues = projects.reduce(
      (sum, project) => sum + buildDoctorProbeSummary(project).blockingFindings,
      0
    );
    const advisoryWarnings = projects.reduce(
      (sum, project) => sum + buildDoctorProbeSummary(project).advisoryFindings,
      0
    );
    const systemErrors = systemChecks.filter((check) => check.result.status === 'error').length;

    breakdown.push({
      id: 'workspace:projects-discovered',
      label: 'Workspace projects discovered',
      status: projects.length > 0 ? 'ok' : 'warn',
      scope: 'workspace-aggregate',
      policyRuleId: 'workspace-project-discovery',
      reason:
        projects.length > 0
          ? `${projects.length} project(s) discovered for workspace analysis.`
          : 'No projects discovered for workspace analysis.',
    });

    breakdown.push({
      id: 'workspace:system-error-gate',
      label: 'Workspace system error gate',
      status: systemErrors > 0 ? 'error' : 'ok',
      scope: 'workspace-aggregate',
      policyRuleId: 'workspace-system-error-gate',
      reason:
        systemErrors > 0
          ? `${systemErrors} system requirement gate(s) failed.`
          : 'All system requirement gates passed.',
    });

    breakdown.push({
      id: 'workspace:blocking-issues-gate',
      label: 'Workspace blocking issues gate',
      status: totalProjectIssues > 0 ? 'error' : 'ok',
      scope: 'workspace-aggregate',
      policyRuleId: 'workspace-blocking-issues-gate',
      reason:
        totalProjectIssues > 0
          ? `${totalProjectIssues} blocking project issue(s) detected.`
          : 'No blocking project issues detected.',
    });

    breakdown.push({
      id: 'workspace:advisory-warnings-gate',
      label: 'Workspace advisory warnings gate',
      status: advisoryWarnings > 0 ? 'warn' : 'ok',
      scope: 'workspace-aggregate',
      policyRuleId: 'workspace-advisory-warning-gate',
      reason:
        advisoryWarnings > 0
          ? `${advisoryWarnings} advisory warning(s) detected.`
          : 'No advisory warnings detected.',
    });
  }

  return breakdown;
}

async function getWorkspaceHealth(
  workspacePath: string,
  allowProjectCache: boolean = true,
  policyProfile: DoctorPolicyProfile = resolveDoctorPolicyProfile({})
): Promise<WorkspaceHealth> {
  let workspaceName = path.basename(workspacePath);

  const marker = await readWorkspaceMarker(workspacePath);
  if (typeof marker?.name === 'string' && marker.name.trim().length > 0) {
    workspaceName = marker.name;
  } else {
    try {
      for (const manifestPath of workspaceMetadataCandidates(workspacePath, 'workspace.json')) {
        if (!(await fsExtra.pathExists(manifestPath))) continue;
        const manifest = await fsExtra.readJSON(manifestPath);
        workspaceName = manifest.workspace_name || manifest.name || workspaceName;
        break;
      }
    } catch {
      // Use directory name as fallback
    }
  }

  const [systemHealth, projectPaths] = await Promise.all([
    collectSystemChecks(),
    collectWorkspaceProjectPaths(workspacePath),
  ]);

  const health: WorkspaceHealth = {
    workspacePath,
    workspaceName,
    python: systemHealth.python,
    poetry: systemHealth.poetry,
    pipx: systemHealth.pipx,
    go: systemHealth.go,
    rapidkitCore: systemHealth.rapidkitCore,
    projects: [],
    policyProfile,
  };

  logger.debug(`Workspace scan found ${projectPaths.length} project(s)`);

  const projectSignature = await buildWorkspaceProjectSignature(workspacePath, projectPaths);
  const cachePath = path.join(workspacePath, '.workspai', 'reports', 'doctor-workspace-cache.json');
  const cached = allowProjectCache
    ? await loadWorkspaceProjectCache(cachePath, projectSignature)
    : null;

  if (cached) {
    health.projects = cached.projects;
    for (const projectHealth of health.projects) {
      normalizeProjectProbeFreshness(projectHealth, cached.generatedAt);
      applyCommandCapabilities(projectHealth, projectHealth.path);
    }
    health.projectScanCached = true;
    logger.debug(`Workspace project health cache hit: ${cachePath}`);
  } else {
    try {
      const scanGeneratedAt = new Date().toISOString();
      const projectHealthResults = await Promise.all(
        projectPaths.map((projectPath) => checkProject(projectPath, { allowNonRapidkit: true }))
      );
      for (const projectHealth of projectHealthResults) {
        normalizeProjectProbeFreshness(projectHealth, scanGeneratedAt);
        applyCommandCapabilities(projectHealth, projectHealth.path);
      }
      health.projects = projectHealthResults;
      health.projectScanCached = false;
      await saveWorkspaceProjectCache(cachePath, {
        schemaVersion: DOCTOR_WORKSPACE_CACHE_SCHEMA,
        signature: projectSignature,
        generatedAt: scanGeneratedAt,
        projects: projectHealthResults,
      });
      logger.debug(`Workspace project health cache refreshed: ${cachePath}`);
    } catch (err) {
      logger.debug(`Failed to scan workspace projects: ${err}`);
    }
  }

  health.projectScanSignature = projectSignature;
  health.projectScanCachePath = cachePath;

  await Promise.all(
    health.projects.map(async (projectHealth) => {
      projectHealth.graphDiagnosis = await buildDoctorGraphDiagnosis({
        workspacePath,
        projectPath: projectHealth.path,
        projectName: projectHealth.name,
        probes: doctorGraphDiagnosisProbes(projectHealth),
        issues: projectHealth.issues,
      });
    })
  );

  // Calculate health score
  const healthChecks = [health.python, health.poetry, health.pipx, health.go, health.rapidkitCore];
  health.healthScore = calculateHealthScore(healthChecks, health.projects);
  health.scoreBreakdown = buildScoreBreakdown(
    [
      { id: 'system-python', label: 'Python', result: health.python },
      { id: 'system-poetry', label: 'Poetry', result: health.poetry },
      { id: 'system-pipx', label: 'pipx', result: health.pipx },
      { id: 'system-go', label: 'Go', result: health.go },
      { id: 'system-rapidkit-core', label: 'RapidKit Core', result: health.rapidkitCore },
    ],
    health.projects,
    { includeWorkspaceAggregateRules: true }
  );
  health.scopeProvenance = buildScopeProvenanceSummary(health.scoreBreakdown);
  health.evidenceFreshness = buildEvidenceFreshnessSummary(
    health.projects,
    new Date().toISOString()
  );

  // Extract version info
  if (health.rapidkitCore.status === 'ok') {
    const versionMatch = health.rapidkitCore.message.match(/([\d.]+(?:rc\d+)?(?:a\d+)?(?:b\d+)?)/);
    if (versionMatch) {
      health.coreVersion = versionMatch[1];
    }
  }

  const previousEvidencePath = await firstExistingWorkspaceArtifactPath(
    workspacePath,
    DOCTOR_WORKSPACE_REPORT_PATH
  );
  const previousEvidence = previousEvidencePath
    ? await readDoctorEvidenceIfPresent(previousEvidencePath, 'workspace')
    : null;
  health.driftDelta = buildWorkspaceDriftDelta(previousEvidence, health);

  health.evidencePath = await writeDoctorEvidence(workspacePath, health, cached ? cachePath : null);

  return health;
}

function serializeDoctorProjectForOutput(project: ProjectHealth): Record<string, unknown> {
  return {
    name: project.name,
    path: project.path,
    framework: project.framework,
    frameworkKey: project.frameworkKey,
    importStack: project.importStack,
    runtimeFamily: project.runtimeFamily,
    projectKind: project.projectKind,
    supportTier: project.supportTier,
    frameworkConfidence: project.frameworkConfidence,
    kit: project.kit,
    venvActive: project.venvActive,
    depsInstalled: project.depsInstalled,
    hasEnvFile: project.hasEnvFile,
    modulesHealthy: project.modulesHealthy,
    missingModules: project.missingModules,
    hasTests: project.hasTests,
    hasDocker: project.hasDocker,
    hasCodeQuality: project.hasCodeQuality,
    vulnerabilities: project.vulnerabilities,
    dependencyAudit: project.dependencyAudit,
    coreInstalled: project.coreInstalled,
    coreVersion: project.coreVersion,
    lastModified: project.lastModified,
    stats: project.stats,
    issues: project.issues,
    fixCommands: project.fixCommands,
    probes: project.probes,
    verdict: project.verdict ?? buildDoctorProbeSummary(project).verdict,
    probeSummary: project.probeSummary ?? buildDoctorProbeSummary(project),
    repairCapabilities: project.repairCapabilities,
    commandCapabilities: project.commandCapabilities,
    graphDiagnosis: project.graphDiagnosis,
  };
}

function projectDoctorEvidenceRelativePath(
  workspacePath: string | undefined,
  projectPath: string
): string {
  const identity = workspacePath
    ? path.relative(workspacePath, projectPath).split(path.sep).join('/')
    : path.resolve(projectPath);
  const readable =
    path
      .basename(projectPath)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project';
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return `.workspai/reports/projects/${readable}--${digest}/doctor-project-last-run.json`;
}

async function writeProjectDoctorEvidence(
  workspacePath: string | undefined,
  envelope: ProjectHealthEnvelope
): Promise<string | undefined> {
  const evidenceRoot = workspacePath || envelope.projectPath;
  const latestRelativePath = '.workspai/reports/doctor-project-last-run.json';
  const namespacedRelativePath = projectDoctorEvidenceRelativePath(
    workspacePath,
    envelope.projectPath
  );
  const evidencePath = path.join(evidenceRoot, latestRelativePath);

  try {
    const blockers = [
      ...envelope.project.issues,
      ...(envelope.project.probes ?? [])
        .filter((probe) => probe.status === 'fail')
        .map((probe) => probe.reason),
    ]
      .filter((issue): issue is string => typeof issue === 'string' && issue.trim().length > 0)
      .slice(0, 12);
    const probeSummary = buildDoctorProbeSummary(envelope.project);
    const payload = withGovernanceRunMetadata(
      {
        schemaVersion: DOCTOR_PROJECT_EVIDENCE_SCHEMA,
        evidenceType: 'project',
        contract: getDoctorContractMetadata(),
        policyProfile: envelope.policyProfile,
        workspacePath: workspacePath || null,
        projectPath: envelope.projectPath,
        projectName: envelope.projectName,
        healthScore: envelope.healthScore,
        evidenceFreshness: envelope.evidenceFreshness,
        system: {
          python: envelope.python,
          poetry: envelope.poetry,
          pipx: envelope.pipx,
          go: envelope.go,
          rapidkitCore: envelope.rapidkitCore,
        },
        project: envelope.project,
        driftDelta: envelope.driftDelta,
        summary: {
          scopeProvenance: envelope.scopeProvenance,
          verdict: probeSummary.verdict,
          probeSummary,
          blockingFindings: probeSummary.blockingFindings,
          advisoryFindings: probeSummary.advisoryFindings,
        },
        scoreBreakdown: envelope.scoreBreakdown ?? [],
      },
      {
        commandId: 'projectDoctor',
        exitCode: computeDoctorGateExitCode(envelope.healthScore, {
          profile: envelope.policyProfile?.name,
        }),
        generatedAt: new Date().toISOString(),
        blockers,
        runId: resolveGovernanceRunId(),
      }
    );
    assertDoctorEvidenceSemanticInvariants(payload);
    if (workspacePath) {
      await writeWorkspaceArtifactJsonSet(workspacePath, latestRelativePath, [
        { relativePath: latestRelativePath, payload },
        { relativePath: namespacedRelativePath, payload },
      ]);
    } else {
      await writeWorkspaceArtifactJson(evidenceRoot, latestRelativePath, payload);
    }
    if (workspacePath && path.resolve(workspacePath) !== path.resolve(envelope.projectPath)) {
      await writeWorkspaceArtifactJson(envelope.projectPath, latestRelativePath, payload);
    }
    return evidencePath;
  } catch (error) {
    if (error instanceof Error && error.message.includes('violates contracts/')) {
      throw error;
    }
    return undefined;
  }
}

async function writeDoctorRemediationPlanArtifact(
  scopeRoot: string,
  remediationPlan: RemediationPlan,
  mirrorRoots: string[] = []
): Promise<string | undefined> {
  const artifactPath = path.join(
    scopeRoot,
    '.workspai',
    'reports',
    'doctor-remediation-plan-last-run.json'
  );
  try {
    await writeWorkspaceArtifactJson(
      scopeRoot,
      '.workspai/reports/doctor-remediation-plan-last-run.json',
      remediationPlan
    );
    for (const mirrorRoot of mirrorRoots) {
      if (path.resolve(mirrorRoot) === path.resolve(scopeRoot)) {
        continue;
      }
      await writeWorkspaceArtifactJson(
        mirrorRoot,
        '.workspai/reports/doctor-remediation-plan-last-run.json',
        remediationPlan
      );
    }
    return artifactPath;
  } catch (error) {
    if (error instanceof Error && error.message.includes('violates contracts/')) {
      throw error;
    }
    return undefined;
  }
}

async function writeDoctorFixResultArtifact(
  scopeRoot: string,
  fixResult: DoctorFixExecutionResult,
  mirrorRoots: string[] = []
): Promise<string | undefined> {
  const artifactPath = path.join(
    scopeRoot,
    '.workspai',
    'reports',
    'doctor-fix-result-last-run.json'
  );
  try {
    await writeWorkspaceArtifactJson(
      scopeRoot,
      '.workspai/reports/doctor-fix-result-last-run.json',
      fixResult
    );
    for (const mirrorRoot of mirrorRoots) {
      if (path.resolve(mirrorRoot) === path.resolve(scopeRoot)) {
        continue;
      }
      await writeWorkspaceArtifactJson(
        mirrorRoot,
        '.workspai/reports/doctor-fix-result-last-run.json',
        fixResult
      );
    }
    return artifactPath;
  } catch {
    return undefined;
  }
}

async function recordDoctorFixHistory(
  scopeRoot: string,
  fixResult: DoctorFixExecutionResult,
  scope: 'workspace' | 'project'
): Promise<void> {
  try {
    await recordWorkspaceHistory(scopeRoot, historyEntryFromDoctorFixResult(fixResult, scope));
  } catch {
    // Non-fatal: Doctor evidence and fix result artifacts remain the source of truth.
  }
}

async function getProjectHealthEnvelope(
  projectPath: string,
  policyProfile: DoctorPolicyProfile = resolveDoctorPolicyProfile({})
): Promise<ProjectHealthEnvelope> {
  const workspacePath = await findWorkspace(projectPath);
  const systemHealth = await collectSystemChecks();
  const projectHealth = await checkProject(projectPath, { allowNonRapidkit: true });
  applyCommandCapabilities(projectHealth, projectPath);
  projectHealth.graphDiagnosis = await buildDoctorGraphDiagnosis({
    workspacePath: workspacePath || undefined,
    projectPath,
    projectName: projectHealth.name,
    probes: doctorGraphDiagnosisProbes(projectHealth),
    issues: projectHealth.issues,
  });
  const healthScore = calculateHealthScore(
    [
      systemHealth.python,
      systemHealth.poetry,
      systemHealth.pipx,
      systemHealth.go,
      systemHealth.rapidkitCore,
    ],
    [projectHealth]
  );

  const envelope: ProjectHealthEnvelope = {
    workspacePath: workspacePath || undefined,
    projectPath,
    projectName: path.basename(projectPath),
    python: systemHealth.python,
    poetry: systemHealth.poetry,
    pipx: systemHealth.pipx,
    go: systemHealth.go,
    rapidkitCore: systemHealth.rapidkitCore,
    project: projectHealth,
    healthScore,
    policyProfile,
  };

  envelope.scoreBreakdown = buildScoreBreakdown(
    [
      { id: 'system-python', label: 'Python', result: envelope.python },
      { id: 'system-poetry', label: 'Poetry', result: envelope.poetry },
      { id: 'system-pipx', label: 'pipx', result: envelope.pipx },
      { id: 'system-go', label: 'Go', result: envelope.go },
      { id: 'system-rapidkit-core', label: 'RapidKit Core', result: envelope.rapidkitCore },
    ],
    [envelope.project]
  );
  envelope.scopeProvenance = buildScopeProvenanceSummary(envelope.scoreBreakdown);
  envelope.evidenceFreshness = buildEvidenceFreshnessSummary(
    [envelope.project],
    new Date().toISOString()
  );

  const projectLocalEvidencePath = await firstExistingWorkspaceArtifactPath(
    projectPath,
    '.workspai/reports/doctor-project-last-run.json'
  );
  const workspaceProjectEvidencePath = workspacePath
    ? await firstExistingWorkspaceArtifactPath(
        workspacePath,
        projectDoctorEvidenceRelativePath(workspacePath, projectPath)
      )
    : null;
  const previousEvidencePath = projectLocalEvidencePath ?? workspaceProjectEvidencePath;
  const previousEvidence = previousEvidencePath
    ? await readDoctorEvidenceIfPresent(previousEvidencePath, 'project')
    : null;
  envelope.driftDelta = buildProjectDriftDelta(previousEvidence, envelope);

  envelope.evidencePath = await writeProjectDoctorEvidence(workspacePath || undefined, envelope);
  return envelope;
}

function renderHealthCheck(check: HealthCheckResult, label: string): void {
  const icon = check.status === 'ok' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
  const color =
    check.status === 'ok' ? chalk.green : check.status === 'warn' ? chalk.yellow : chalk.red;

  console.log(`${icon} ${chalk.bold(label)}: ${color(check.message)}`);

  // Show multiple paths if available
  if (check.paths && check.paths.length > 0) {
    check.paths.forEach((p) => {
      const versionSuffix = p.version ? chalk.cyan(` -> ${p.version}`) : '';
      console.log(
        `   ${chalk.cyan('•')} ${chalk.gray(p.location)}: ${chalk.dim(p.path)}${versionSuffix}`
      );
    });
  }

  if (check.details) {
    console.log(`   ${chalk.gray(check.details)}`);
  }
}

function humanFixDescription(project: ProjectHealth, command: string): string {
  const capability = findRepairCapabilityForCommand(project, command);
  if (command.startsWith('rapidkit:doctor:repair ')) {
    return capability?.title ?? 'Apply Doctor-managed project repair';
  }
  if (/^https?:\/\//i.test(command.trim())) return `Open: ${command.trim()}`;

  const separator = command.match(/\s+(?:&&|;)\s+/);
  const runnable = separator
    ? command.slice((separator.index ?? 0) + separator[0].length)
    : command;
  return `Run in project: ${runnable}`;
}

function renderProjectHealth(project: ProjectHealth, hostCore?: HealthCheckResult): void {
  const hasIssues = project.issues.length > 0;
  const icon = hasIssues ? '⚠️' : '✅';
  const nameColor = hasIssues ? chalk.yellow : chalk.green;

  console.log(`\n${icon} ${chalk.bold('Project')}: ${nameColor(project.name)}`);

  // Show framework
  if (project.framework) {
    const frameworkIcon =
      project.framework === 'FastAPI' ||
      project.framework === 'Django' ||
      project.framework === 'Flask'
        ? '🐍'
        : project.framework === 'NestJS'
          ? '🦅'
          : project.framework === 'Next.js' ||
              project.framework === 'Nuxt' ||
              project.framework === 'Remix'
            ? '▲'
            : project.framework === 'React' || project.framework === 'Vite'
              ? '⚛️'
              : project.framework === 'Vue'
                ? '🟢'
                : project.framework === 'Angular'
                  ? '🅰️'
                  : project.framework === 'SvelteKit'
                    ? '🧡'
                    : project.framework === 'Spring Boot'
                      ? '☕'
                      : project.framework === 'Rust'
                        ? '🦀'
                        : project.framework === 'Elixir' || project.framework === 'Phoenix'
                          ? '🧪'
                          : project.framework === 'Clojure'
                            ? '⚙️'
                            : project.framework === 'Scala'
                              ? '🔺'
                              : project.framework === 'Kotlin'
                                ? '🟣'
                                : project.framework === 'Deno'
                                  ? '🦕'
                                  : project.framework === 'Bun'
                                    ? '🥖'
                                    : project.framework === 'Go/Fiber'
                                      ? '🐹'
                                      : project.framework === 'Go/Gin'
                                        ? '🐹'
                                        : project.framework === 'Laravel' ||
                                            project.framework === 'PHP'
                                          ? '🐘'
                                          : project.framework === 'Ruby on Rails' ||
                                              project.framework === 'Ruby'
                                            ? '💎'
                                            : project.framework === 'ASP.NET'
                                              ? '🔷'
                                              : '📦';
    console.log(
      `   ${frameworkIcon} Framework: ${chalk.cyan(project.framework)}${project.kit ? chalk.gray(` (${project.kit})`) : ''}`
    );

    const profileParts: string[] = [];
    if (project.runtimeFamily) {
      profileParts.push(`runtime: ${project.runtimeFamily}`);
    }
    if (project.projectKind) {
      profileParts.push(`kind: ${project.projectKind}`);
    }
    if (project.supportTier) {
      profileParts.push(`support: ${project.supportTier}`);
    }
    if (project.frameworkConfidence) {
      profileParts.push(`confidence: ${project.frameworkConfidence}`);
    }
    if (profileParts.length > 0) {
      console.log(`   ${chalk.dim('↳')} ${chalk.gray(profileParts.join(' • '))}`);
    }
  }

  console.log(`   ${chalk.gray(`Path: ${project.path}`)}`);

  const isPythonProject = project.runtimeFamily === 'python';

  if (isPythonProject) {
    // Python project display
    if (project.venvActive) {
      console.log(`   ✅ Virtual environment: ${chalk.green('Active')}`);
    } else {
      console.log(`   ❌ Virtual environment: ${chalk.red('Not found')}`);
    }

    if (project.coreInstalled) {
      console.log(
        `   ${chalk.dim('ℹ')}  RapidKit Core: ${chalk.gray(project.coreVersion || 'In venv')} ${chalk.dim('(optional)')}`
      );
    } else if (hostCore?.status === 'ok') {
      console.log(
        `   ${chalk.dim('ℹ')}  RapidKit Core: ${chalk.gray('Using global installation')} ${chalk.dim('(recommended)')}`
      );
    } else {
      console.log(`   ❌ RapidKit Core: ${chalk.red('Not detected locally or globally')}`);
    }
  }

  // Dependencies (both Python and Node.js)
  if (project.depsInstalled) {
    console.log(`   ✅ Dependencies: ${chalk.green('Installed')}`);
  } else {
    console.log(`   ⚠️  Dependencies: ${chalk.yellow('Not installed')}`);
  }

  // Environment file check
  if (project.hasEnvFile !== undefined) {
    if (project.hasEnvFile) {
      console.log(`   ✅ Environment: ${chalk.green('.env configured')}`);
    } else {
      console.log(`   ⚠️  Environment: ${chalk.yellow('.env missing')}`);
    }
  }

  // Module / source tree health check
  if (project.modulesHealthy !== undefined) {
    const healthLabel = project.projectKind === 'frontend' ? 'Source tree' : 'Modules';
    if (project.modulesHealthy) {
      console.log(`   ✅ ${healthLabel}: ${chalk.green('Healthy')}`);
    } else if (project.missingModules && project.missingModules.length > 0) {
      console.log(
        `   ⚠️  ${healthLabel}: ${chalk.yellow(`Missing ${project.missingModules.length} init file(s)`)}`
      );
    } else if (project.projectKind === 'frontend') {
      console.log(`   ⚠️  ${healthLabel}: ${chalk.yellow('No application directories detected')}`);
    }
  }

  // Project Stats
  if (project.stats) {
    const statsLine = [];
    if (project.stats.modules !== undefined) {
      statsLine.push(`${project.stats.modules} module${project.stats.modules !== 1 ? 's' : ''}`);
    }
    if (statsLine.length > 0) {
      console.log(`   📊 Stats: ${chalk.cyan(statsLine.join(' • '))}`);
    }
  }

  // Last Modified
  if (project.lastModified) {
    console.log(`   🕒 Last Modified: ${chalk.gray(project.lastModified)}`);
  }

  // Additional checks
  const additionalChecks = [];
  if (project.hasTests !== undefined) {
    additionalChecks.push(project.hasTests ? '✅ Tests' : chalk.dim('⊘ No tests'));
  }
  if (project.hasDocker !== undefined) {
    additionalChecks.push(project.hasDocker ? '✅ Docker' : chalk.dim('⊘ No Docker'));
  }
  if (project.hasCodeQuality !== undefined) {
    const qualityTool =
      project.runtimeFamily === 'node' || project.runtimeFamily === 'bun'
        ? 'ESLint'
        : project.runtimeFamily === 'rust'
          ? 'clippy'
          : project.runtimeFamily === 'elixir'
            ? 'Credo'
            : project.runtimeFamily === 'clojure'
              ? 'clj-kondo'
              : project.runtimeFamily === 'deno'
                ? 'deno lint'
                : project.framework === 'Spring Boot'
                  ? 'Static analysis'
                  : project.framework === 'Go/Fiber' || project.framework === 'Go/Gin'
                    ? 'golangci-lint'
                    : project.runtimeFamily === 'python'
                      ? 'Ruff'
                      : 'Lint';
    additionalChecks.push(
      project.hasCodeQuality ? `✅ ${qualityTool}` : chalk.dim(`⊘ No ${qualityTool}`)
    );
  }

  if (additionalChecks.length > 0) {
    console.log(`   ${additionalChecks.join(' • ')}`);
  }

  // Security vulnerabilities
  if (project.vulnerabilities !== undefined && project.vulnerabilities > 0) {
    console.log(
      `   ⚠️  Security: ${chalk.yellow(`${project.vulnerabilities} vulnerability(ies) found`)}`
    );
  }

  if (project.issues.length > 0) {
    console.log(`   ${chalk.bold('Issues:')}`);
    project.issues.forEach((issue) => {
      console.log(`     • ${chalk.yellow(issue)}`);
    });

    // Show fix commands
    if (project.fixCommands && project.fixCommands.length > 0) {
      console.log(`\n   ${chalk.bold.cyan('🔧 Quick Fix:')}`);
      project.fixCommands.forEach((cmd) => {
        console.log(`   ${chalk.white(humanFixDescription(project, cmd))}`);
      });
    }
  }

  if (project.probes && project.probes.length > 0) {
    console.log(`   ${chalk.bold('Probe checks:')}`);
    for (const probe of project.probes) {
      const icon = probe.status === 'pass' ? '✅' : probe.status === 'warn' ? '⚠️' : '❌';
      console.log(`     ${icon} ${probe.label}: ${chalk.gray(probe.reason)}`);
      if (probe.recommendation) {
        console.log(`       ${chalk.dim('↳')} ${chalk.gray(probe.recommendation)}`);
      }
    }
  }

  if (project.graphDiagnosis?.status === 'available') {
    const summary = project.graphDiagnosis.summary;
    console.log(`   ${chalk.bold('Graph-aware diagnosis:')}`);
    console.log(
      `     ${summary.findingCount} finding(s) • ${summary.affectedEntityCount} affected candidate(s) • ${summary.verificationTargetCount} verification target(s) • ${summary.proofPathCount} proof path(s)`
    );
    if (summary.unknownCount > 0) {
      console.log(
        `     ${chalk.dim('↳')} ${chalk.gray(`${summary.unknownCount} explicit unknown(s); inspect JSON evidence before expanding impact claims.`)}`
      );
    }
  } else if (
    project.graphDiagnosis &&
    ['stale', 'invalid', 'project-unresolved'].includes(project.graphDiagnosis.status)
  ) {
    console.log(
      `   ⚠️  Graph-aware diagnosis: ${chalk.yellow(project.graphDiagnosis.status)} ${chalk.dim('(refresh workspace model evidence)')}`
    );
  }

  if (project.commandCapabilities) {
    const caps = project.commandCapabilities;
    console.log(`   ${chalk.bold('Command support:')}`);
    console.log(
      `     ${chalk.green('supported')} ${caps.supportedCommands.length} • ${chalk.yellow('unsupported')} ${caps.unsupportedCommands.length} • ${chalk.gray('global')} ${caps.globalCommands.length}`
    );
    if (caps.unsupportedCommands.length > 0) {
      const preview = caps.unsupportedCommands.slice(0, 8).join(', ');
      const suffix = caps.unsupportedCommands.length > 8 ? ', ...' : '';
      console.log(`     ${chalk.dim('↳')} ${chalk.gray(`Unsupported here: ${preview}${suffix}`)}`);
    }
  }
}

async function canRunGoModTidy(): Promise<boolean> {
  try {
    const result = await execa('go', ['version'], {
      timeout: getProbeTimeoutMs(),
      reject: false,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

type FixRiskLevel = 'safe' | 'guarded' | 'invasive';

type FixStepKind =
  | 'manual-url'
  | 'env-copy'
  | 'package-json-script'
  | 'file-create'
  | 'file-append'
  | 'json-edit'
  | 'env-key-add'
  | 'makefile-target'
  | 'rapidkit-init'
  | 'go-mod-tidy'
  | 'dependency-sync'
  | 'shell';

interface FixPlanStep {
  projectName: string;
  projectPath: string;
  originalCommand: string;
  kind: FixStepKind;
  risk: FixRiskLevel;
  executable: boolean;
  reason?: string;
}

type RemediationPlanStudioState = 'ready' | 'blocked' | 'review-required' | 'guidance-only';
type RemediationPlanPhase =
  | 'dependency-baseline'
  | 'local-environment'
  | 'source-hygiene'
  | 'command-contract'
  | 'runtime-governance'
  | 'manual-review'
  | 'generic-execution';

interface ProjectSnapshotEntry {
  snapshotRoot: string;
  files: Map<string, string>;
  missingFiles: Set<string>;
}

interface PlannedFixStep extends FixPlanStep {
  id: string;
  phase: RemediationPlanPhase;
  order: number;
  dependsOn: string[];
  issueId?: string;
  issueClass?: DoctorIssueClass;
  operationalImpact?: DoctorOperationalImpact;
  repairIntent?: DoctorRepairIntent;
  files: string[];
  operation?: DoctorRepairOperation;
  preview: {
    title: string;
    summary: string;
    changes: string[];
  };
  diffPreview: {
    available: boolean;
    format: 'unified' | 'summary' | 'none';
    summary: string;
    hunks: string[];
    limitations?: string[];
  };
  verifyCommand?: string;
  refreshCommands: string[];
  rollback: {
    available: boolean;
    strategy: 'snapshot' | 'idempotent' | 'manual' | 'none';
  };
  studioStatus: {
    state: RemediationPlanStudioState;
    reason: string;
  };
  executableInCurrentEnvironment: boolean;
  blockedReason?: string;
}

interface RemediationPlan {
  schemaVersion: 'doctor-remediation-plan-v2';
  generatedAt: string;
  policyProfile: DoctorPolicyProfileName;
  fixableProjects: number;
  totalSteps: number;
  executableSteps: number;
  risk: {
    safe: number;
    guarded: number;
    invasive: number;
  };
  steps: PlannedFixStep[];
}

function parseProjectCommandFix(
  cmd: string,
  expectedTailPattern: string
): { projectPath: string } | null {
  const patterns = [
    new RegExp(
      `^Set-Location\\s+-LiteralPath\\s+"([^"]+)"\\s*;\\s*${expectedTailPattern}\\s*$`,
      'i'
    ),
    new RegExp(`^cd\\s+"([^"]+)"\\s*(?:&&|;)\\s*${expectedTailPattern}\\s*$`, 'i'),
    new RegExp(`^cd\\s+'([^']+)'\\s*(?:&&|;)\\s*${expectedTailPattern}\\s*$`, 'i'),
    new RegExp(`^cd\\s+(.+?)\\s*(?:&&|;)\\s*${expectedTailPattern}\\s*$`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    if (match?.[1]) {
      return { projectPath: match[1].trim() };
    }
  }

  return null;
}

function parseEnvCopyFix(cmd: string): { projectPath: string } | null {
  return (
    parseProjectCommandFix(cmd, 'cp\\s+\\.env\\.example\\s+\\.env') ||
    parseProjectCommandFix(cmd, 'copy-item\\s+\\.env\\.example\\s+\\.env')
  );
}

function parseDependencySyncFix(
  cmd: string
): { projectPath: string; command: string; args: string[] } | null {
  const knownPatterns: Array<{ pattern: string; command: string; args: string[] }> = [
    { pattern: 'npm\\s+install', command: 'npm', args: ['install'] },
    { pattern: 'npm\\s+ci', command: 'npm', args: ['ci'] },
    { pattern: 'pnpm\\s+install', command: 'pnpm', args: ['install'] },
    { pattern: 'yarn\\s+install', command: 'yarn', args: ['install'] },
    { pattern: 'bun\\s+install', command: 'bun', args: ['install'] },
    { pattern: 'poetry\\s+install', command: 'poetry', args: ['install'] },
    {
      pattern: 'poetry\\s+install\\s+--no-root',
      command: 'poetry',
      args: ['install', '--no-root'],
    },
    { pattern: 'poetry\\s+lock', command: 'poetry', args: ['lock'] },
    { pattern: 'uv\\s+lock', command: 'uv', args: ['lock'] },
    {
      pattern: 'pip\\s+install\\s+-r\\s+requirements\\.txt',
      command: 'pip',
      args: ['install', '-r', 'requirements.txt'],
    },
    { pattern: 'composer\\s+install', command: 'composer', args: ['install'] },
    { pattern: 'bundle\\s+install', command: 'bundle', args: ['install'] },
    { pattern: 'dotnet\\s+restore', command: 'dotnet', args: ['restore'] },
    { pattern: 'cargo\\s+fetch', command: 'cargo', args: ['fetch'] },
    { pattern: 'mix\\s+deps\\.get', command: 'mix', args: ['deps.get'] },
    { pattern: 'clojure\\s+-P', command: 'clojure', args: ['-P'] },
    { pattern: 'sbt\\s+compile', command: 'sbt', args: ['compile'] },
  ];

  for (const candidate of knownPatterns) {
    const parsed = parseProjectCommandFix(cmd, candidate.pattern);
    if (parsed) {
      return {
        projectPath: parsed.projectPath,
        command: candidate.command,
        args: candidate.args,
      };
    }
  }

  return null;
}

function getDoctorFixCommandTimeoutMs(): number {
  const raw = process.env.RAPIDKIT_DOCTOR_FIX_COMMAND_TIMEOUT_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 60_000;
}

export function parsePackageScriptFix(
  cmd: string
): { projectPath: string; scriptName: string; scriptValue: string } | null {
  const patterns = [
    /^cd\s+"([^"]+)"\s*(?:&&|;)\s*npm\s+pkg\s+set\s+"scripts\.([^=]+)=([^"]+)"\s*$/i,
    /^cd\s+'([^']+)'\s*(?:&&|;)\s*npm\s+pkg\s+set\s+'scripts\.([^=]+)=([^']+)'\s*$/i,
    /^cd\s+(.+?)\s*(?:&&|;)\s*npm\s+pkg\s+set\s+scripts\.([^=\s]+)=(.+)\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    if (!match?.[1] || !match?.[2] || !match?.[3]) {
      continue;
    }
    return {
      projectPath: match[1].trim(),
      scriptName: match[2].trim(),
      scriptValue: match[3].trim().replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
    };
  }

  return null;
}

export function parseInternalRepairCommand(cmd: string): DoctorRepairOperation | null {
  const match = cmd.trim().match(/^rapidkit:doctor:repair\s+([A-Za-z0-9_-]+)$/);
  if (!match?.[1]) return null;

  try {
    const decoded = Buffer.from(match[1], 'base64url').toString('utf8');
    const value = JSON.parse(decoded) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const operation = value as Partial<DoctorRepairOperation>;
    if (operation.type === 'file-create') {
      if (
        typeof operation.path === 'string' &&
        typeof operation.content === 'string' &&
        operation.overwrite === false
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    if (operation.type === 'file-append') {
      if (
        typeof operation.path === 'string' &&
        Array.isArray(operation.lines) &&
        operation.lines.every((line) => typeof line === 'string') &&
        typeof operation.ensureNewline === 'boolean'
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    if (operation.type === 'file-copy') {
      if (
        typeof operation.sourcePath === 'string' &&
        typeof operation.path === 'string' &&
        operation.overwrite === false
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    if (operation.type === 'package-json-script') {
      if (
        typeof operation.path === 'string' &&
        typeof operation.scriptName === 'string' &&
        typeof operation.scriptValue === 'string'
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    if (operation.type === 'json-edit') {
      if (
        typeof operation.path === 'string' &&
        Array.isArray(operation.edits) &&
        operation.edits.every((edit) => {
          if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return false;
          const record = edit as Record<string, unknown>;
          return (
            typeof record.pointer === 'string' &&
            record.pointer.startsWith('/') &&
            (typeof record.value === 'string' ||
              typeof record.value === 'number' ||
              typeof record.value === 'boolean' ||
              record.value === null)
          );
        })
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    if (operation.type === 'env-key-add') {
      if (
        typeof operation.path === 'string' &&
        Array.isArray(operation.keys) &&
        operation.keys.every((key) => {
          if (!key || typeof key !== 'object' || Array.isArray(key)) return false;
          const record = key as Record<string, unknown>;
          return (
            typeof record.name === 'string' &&
            /^[A-Z_][A-Z0-9_]*$/i.test(record.name) &&
            typeof record.value === 'string' &&
            (record.comment === undefined || typeof record.comment === 'string')
          );
        })
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    if (operation.type === 'makefile-target') {
      if (
        typeof operation.path === 'string' &&
        typeof operation.target === 'string' &&
        /^[A-Za-z0-9_.:-]+$/.test(operation.target) &&
        typeof operation.command === 'string' &&
        operation.command.trim().length > 0 &&
        typeof operation.phony === 'boolean'
      ) {
        return operation as DoctorRepairOperation;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildRemediationStepId(input: {
  projectName: string;
  kind: string;
  command: string;
  operation?: DoctorRepairOperation;
}): string {
  const identity = input.operation
    ? buildRepairOperationIdentity(input.operation)
    : `command:${input.command}`;
  const digest = createHash('sha256').update(identity).digest('base64url').slice(0, 16);
  return `${input.projectName}:${input.kind}:${digest}`;
}

export function buildRepairOperationIdentity(operation: DoctorRepairOperation): string {
  switch (operation.type) {
    case 'file-create':
      return `file-create:${operation.path}:${operation.overwrite}:${operation.content}`;
    case 'file-append':
      return `file-append:${operation.path}:${operation.ensureNewline}:${operation.lines.join('\n')}`;
    case 'file-copy':
      return `file-copy:${operation.sourcePath}:${operation.path}:${operation.overwrite}`;
    case 'package-json-script':
      return `package-json-script:${operation.path}:${operation.scriptName}:${operation.scriptValue}`;
    case 'json-edit':
      return `json-edit:${operation.path}:${operation.edits
        .map((edit) => `${edit.pointer}=${JSON.stringify(edit.value)}`)
        .join('|')}`;
    case 'env-key-add':
      return `env-key-add:${operation.path}:${operation.keys
        .map((key) => `${key.name}=${key.value ?? ''}`)
        .join('|')}`;
    case 'makefile-target':
      return `makefile-target:${operation.path}:${operation.target}:${operation.command}:${operation.phony}`;
    default:
      return `operation:${JSON.stringify(operation)}`;
  }
}

export function assertOperationPathInsideProject(projectPath: string, targetPath: string): string {
  const resolvedProjectPath = path.resolve(projectPath);
  const resolvedTargetPath = path.resolve(targetPath);
  const relative = path.relative(resolvedProjectPath, resolvedTargetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Repair target escapes project boundary: ${targetPath}`);
  }
  return resolvedTargetPath;
}

export async function applyPackageScriptFix(input: {
  projectPath: string;
  scriptName: string;
  scriptValue: string;
}): Promise<void> {
  if (!/^[A-Za-z0-9:_-]+$/.test(input.scriptName)) {
    throw new Error(`Unsafe package script name: ${input.scriptName}`);
  }

  const packageJsonPath = path.join(input.projectPath, 'package.json');
  if (!(await fsExtra.pathExists(packageJsonPath))) {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  const packageJson = (await fsExtra.readJSON(packageJsonPath)) as Record<string, unknown>;
  const existingScripts =
    packageJson.scripts &&
    typeof packageJson.scripts === 'object' &&
    !Array.isArray(packageJson.scripts)
      ? (packageJson.scripts as Record<string, unknown>)
      : {};

  const existingValue = existingScripts[input.scriptName];
  if (typeof existingValue === 'string' && existingValue.trim().length > 0) {
    return;
  }

  packageJson.scripts = {
    ...existingScripts,
    [input.scriptName]: input.scriptValue,
  };

  await fsExtra.writeJSON(packageJsonPath, packageJson, { spaces: 2 });
}

export async function applyFileCreateFix(input: {
  projectPath: string;
  operation: Extract<DoctorRepairOperation, { type: 'file-create' }>;
}): Promise<void> {
  const targetPath = assertOperationPathInsideProject(input.projectPath, input.operation.path);
  if (await fsExtra.pathExists(targetPath)) {
    return;
  }
  await fsExtra.ensureDir(path.dirname(targetPath));
  await fsExtra.writeFile(targetPath, input.operation.content, 'utf8');
}

export async function applyFileAppendFix(input: {
  projectPath: string;
  operation: Extract<DoctorRepairOperation, { type: 'file-append' }>;
}): Promise<void> {
  const targetPath = assertOperationPathInsideProject(input.projectPath, input.operation.path);
  await fsExtra.ensureDir(path.dirname(targetPath));

  const existing = await readFileIfExists(targetPath);
  const existingLines = existing.split(/\r?\n/);
  const missingLines = input.operation.lines.filter((line) => !existingLines.includes(line));
  if (missingLines.length === 0) {
    return;
  }

  const prefix =
    existing.length === 0 || existing.endsWith('\n') || !input.operation.ensureNewline ? '' : '\n';
  await fsExtra.appendFile(targetPath, `${prefix}${missingLines.join('\n')}\n`, 'utf8');
}

export async function applyFileCopyFix(input: {
  projectPath: string;
  operation: Extract<DoctorRepairOperation, { type: 'file-copy' }>;
}): Promise<void> {
  const sourcePath = assertOperationPathInsideProject(
    input.projectPath,
    input.operation.sourcePath
  );
  const targetPath = assertOperationPathInsideProject(input.projectPath, input.operation.path);

  if (!(await fsExtra.pathExists(sourcePath))) {
    throw new Error(`Repair source file not found at ${sourcePath}`);
  }
  if (await fsExtra.pathExists(targetPath)) {
    return;
  }

  await fsExtra.ensureDir(path.dirname(targetPath));
  await fsExtra.copy(sourcePath, targetPath, {
    overwrite: input.operation.overwrite,
    errorOnExist: false,
  });
}

export function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export async function applyJsonEditFix(input: {
  projectPath: string;
  operation: Extract<DoctorRepairOperation, { type: 'json-edit' }>;
}): Promise<void> {
  const targetPath = assertOperationPathInsideProject(input.projectPath, input.operation.path);
  if (!(await fsExtra.pathExists(targetPath))) {
    throw new Error(`JSON repair target not found at ${targetPath}`);
  }

  const document = (await fsExtra.readJSON(targetPath)) as Record<string, unknown>;
  for (const edit of input.operation.edits) {
    const segments = edit.pointer.split('/').slice(1).map(decodeJsonPointerSegment);
    if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
      throw new Error(`Unsupported JSON pointer: ${edit.pointer}`);
    }
    let cursor: Record<string, unknown> = document;
    for (const segment of segments.slice(0, -1)) {
      const existing = cursor[segment];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = edit.value;
  }

  await fsExtra.writeJSON(targetPath, document, { spaces: 2 });
}

export async function applyEnvKeyAddFix(input: {
  projectPath: string;
  operation: Extract<DoctorRepairOperation, { type: 'env-key-add' }>;
}): Promise<void> {
  const targetPath = assertOperationPathInsideProject(input.projectPath, input.operation.path);
  await fsExtra.ensureDir(path.dirname(targetPath));
  const existing = await readFileIfExists(targetPath);
  const existingKeys = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter((key): key is string => Boolean(key))
  );
  const additions: string[] = [];
  for (const key of input.operation.keys) {
    if (existingKeys.has(key.name)) continue;
    if (key.comment) additions.push(`# ${key.comment}`);
    additions.push(`${key.name}=${key.value}`);
  }
  if (additions.length === 0) return;
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await fsExtra.appendFile(targetPath, `${prefix}${additions.join('\n')}\n`, 'utf8');
}

export async function applyMakefileTargetFix(input: {
  projectPath: string;
  operation: Extract<DoctorRepairOperation, { type: 'makefile-target' }>;
}): Promise<void> {
  const targetPath = assertOperationPathInsideProject(input.projectPath, input.operation.path);
  await fsExtra.ensureDir(path.dirname(targetPath));
  const existing = await readFileIfExists(targetPath);
  const targetPattern = new RegExp(
    `(^|\\n)${input.operation.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`,
    'm'
  );
  if (targetPattern.test(existing)) {
    return;
  }
  const lines = [
    ...(input.operation.phony ? [`.PHONY: ${input.operation.target}`] : []),
    `${input.operation.target}:`,
    `\t${input.operation.command}`,
  ];
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await fsExtra.appendFile(targetPath, `${prefix}${lines.join('\n')}\n`, 'utf8');
}

async function readFileIfExists(filePath: string): Promise<string> {
  try {
    if (!(await fsExtra.pathExists(filePath))) return '';
    return await fsExtra.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function classifyFixStep(project: ProjectHealth, cmd: string): FixPlanStep {
  if (/^https?:\/\//i.test(cmd.trim())) {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'manual-url',
      risk: 'safe',
      executable: false,
      reason: 'Manual guidance URL',
    };
  }

  if (parseEnvCopyFix(cmd)) {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'env-copy',
      risk: 'safe',
      executable: true,
      reason: 'Environment seed copy',
    };
  }

  if (parsePackageScriptFix(cmd)) {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'package-json-script',
      risk: 'guarded',
      executable: true,
      reason: 'package.json lifecycle script repair',
    };
  }

  const internalRepair = parseInternalRepairCommand(cmd);
  if (internalRepair?.type === 'file-create') {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'file-create',
      risk: 'safe',
      executable: true,
      reason: 'Project-scoped file create repair',
    };
  }

  if (internalRepair?.type === 'file-append') {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'file-append',
      risk: 'safe',
      executable: true,
      reason: 'Project-scoped file append repair',
    };
  }

  if (internalRepair?.type === 'file-copy') {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'env-copy',
      risk: 'safe',
      executable: true,
      reason: 'Project-scoped file copy repair',
    };
  }

  if (internalRepair?.type === 'json-edit') {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'json-edit',
      risk: 'guarded',
      executable: true,
      reason: 'Project-scoped JSON document repair',
    };
  }

  if (internalRepair?.type === 'env-key-add') {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'env-key-add',
      risk: 'guarded',
      executable: true,
      reason: 'Project-scoped environment key repair',
    };
  }

  if (internalRepair?.type === 'makefile-target') {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'makefile-target',
      risk: 'guarded',
      executable: true,
      reason: 'Project-scoped Makefile target repair',
    };
  }

  if (parseProjectCommandFix(cmd, 'rapidkit\\s+init')) {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'rapidkit-init',
      risk: 'guarded',
      executable: true,
      reason: 'RapidKit initializer may mutate dependencies and configs',
    };
  }

  if (parseProjectCommandFix(cmd, 'go\\s+mod\\s+tidy')) {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'go-mod-tidy',
      risk: 'guarded',
      executable: true,
      reason: 'Go module graph reconciliation',
    };
  }

  if (parseDependencySyncFix(cmd)) {
    return {
      projectName: project.name,
      projectPath: project.path,
      originalCommand: cmd,
      kind: 'dependency-sync',
      risk: 'guarded',
      executable: true,
      reason: 'Dependency synchronization command',
    };
  }

  return {
    projectName: project.name,
    projectPath: project.path,
    originalCommand: cmd,
    kind: 'shell',
    risk: 'invasive',
    executable: true,
    reason: 'Generic shell command',
  };
}

function findRepairCapabilityForCommand(
  project: ProjectHealth,
  command: string
): DoctorRepairCapability | undefined {
  return project.repairCapabilities?.find((capability) => capability.command === command);
}

function findProbeForRepairCapability(
  project: ProjectHealth,
  capability: DoctorRepairCapability | undefined
): ProjectProbeResult | undefined {
  if (!capability) return undefined;
  return project.probes?.find((probe) => probe.repairCapability?.id === capability.id);
}

function buildRemediationPreview(input: {
  step: FixPlanStep;
  capability?: DoctorRepairCapability;
  operation?: DoctorRepairOperation;
}): PlannedFixStep['preview'] {
  const { step, capability, operation } = input;
  if (operation?.type === 'file-create') {
    return {
      title: capability?.title ?? 'Create file',
      summary: `Create ${path.basename(operation.path)} if it does not already exist.`,
      changes: [`create ${operation.path}`, 'do not overwrite an existing file'],
    };
  }
  if (operation?.type === 'file-append') {
    return {
      title: capability?.title ?? 'Append file rules',
      summary: `Append ${operation.lines.length} missing line(s) to ${path.basename(operation.path)}.`,
      changes: [
        `append to ${operation.path}`,
        ...operation.lines.map((line) => `ensure line: ${line}`),
      ],
    };
  }
  if (operation?.type === 'file-copy') {
    return {
      title: capability?.title ?? 'Copy file',
      summary: `Copy ${path.basename(operation.sourcePath)} to ${path.basename(operation.path)} if the target is missing.`,
      changes: [
        `copy ${operation.sourcePath} -> ${operation.path}`,
        'do not overwrite an existing target file',
      ],
    };
  }
  if (operation?.type === 'package-json-script') {
    return {
      title: capability?.title ?? 'Update package.json script',
      summary: `Ensure package.json script "${operation.scriptName}" exists.`,
      changes: [`set scripts.${operation.scriptName}=${operation.scriptValue}`],
    };
  }
  if (operation?.type === 'json-edit') {
    return {
      title: capability?.title ?? 'Update JSON document',
      summary: `Apply ${operation.edits.length} JSON pointer edit(s) to ${path.basename(operation.path)}.`,
      changes: operation.edits.map((edit) => `set ${edit.pointer}=${JSON.stringify(edit.value)}`),
    };
  }
  if (operation?.type === 'env-key-add') {
    return {
      title: capability?.title ?? 'Add environment keys',
      summary: `Ensure ${operation.keys.length} environment key(s) exist in ${path.basename(operation.path)}.`,
      changes: operation.keys.map((key) => `ensure ${key.name}`),
    };
  }
  if (operation?.type === 'makefile-target') {
    return {
      title: capability?.title ?? 'Add Makefile target',
      summary: `Ensure Makefile target "${operation.target}" exists.`,
      changes: [
        `target ${operation.target}`,
        `command ${operation.command}`,
        ...(operation.phony ? ['mark target as .PHONY'] : []),
      ],
    };
  }
  if (step.kind === 'env-copy') {
    return {
      title: 'Create .env from example',
      summary: 'Copy .env.example to .env when the local env file is missing.',
      changes: ['copy .env.example -> .env', 'do not overwrite existing .env'],
    };
  }
  if (step.kind === 'manual-url') {
    return {
      title: 'Open manual guidance',
      summary: 'Manual remediation is required outside Doctor.',
      changes: [step.originalCommand],
    };
  }
  return {
    title: capability?.title ?? 'Run remediation command',
    summary: step.reason ?? 'Run the planned remediation command.',
    changes: [step.originalCommand],
  };
}

function buildUnifiedCreateDiff(filePath: string, content: string): string[] {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  return [`--- /dev/null`, `+++ ${filePath}`, '@@', ...lines.map((line) => `+${line}`)];
}

function buildRemediationDiffPreview(input: {
  step: FixPlanStep;
  operation?: DoctorRepairOperation;
}): PlannedFixStep['diffPreview'] {
  const { step, operation } = input;
  if (!operation) {
    return {
      available: false,
      format: 'none',
      summary: step.executable
        ? 'Command execution has no deterministic file diff preview.'
        : 'Guidance-only remediation has no file diff preview.',
      hunks: [],
    };
  }

  if (operation.type === 'file-create') {
    return {
      available: true,
      format: 'unified',
      summary: `Create ${operation.path} without overwriting an existing file.`,
      hunks: buildUnifiedCreateDiff(operation.path, operation.content),
    };
  }

  if (operation.type === 'file-append') {
    return {
      available: true,
      format: 'unified',
      summary: `Append ${operation.lines.length} line(s) to ${operation.path} when missing.`,
      hunks: [
        `--- ${operation.path}`,
        `+++ ${operation.path}`,
        '@@',
        ...operation.lines.map((line) => `+${line}`),
      ],
    };
  }

  if (operation.type === 'file-copy') {
    return {
      available: true,
      format: 'summary',
      summary: `Copy ${operation.sourcePath} to ${operation.path} when target is missing.`,
      hunks: [`copy ${operation.sourcePath} -> ${operation.path}`],
      limitations: ['Source content is read during apply to avoid stale preview data.'],
    };
  }

  if (operation.type === 'package-json-script') {
    return {
      available: true,
      format: 'unified',
      summary: `Add scripts.${operation.scriptName} to package.json when missing.`,
      hunks: [
        `--- ${operation.path}`,
        `+++ ${operation.path}`,
        '@@ scripts',
        `+  "${operation.scriptName}": "${operation.scriptValue}"`,
      ],
    };
  }

  if (operation.type === 'json-edit') {
    return {
      available: true,
      format: 'summary',
      summary: `Apply ${operation.edits.length} JSON pointer edit(s) to ${operation.path}.`,
      hunks: operation.edits.map((edit) => `set ${edit.pointer}=${JSON.stringify(edit.value)}`),
    };
  }

  if (operation.type === 'env-key-add') {
    return {
      available: true,
      format: 'unified',
      summary: `Add ${operation.keys.length} env key(s) to ${operation.path} when missing.`,
      hunks: [
        `--- ${operation.path}`,
        `+++ ${operation.path}`,
        '@@',
        ...operation.keys.flatMap((key) => [
          ...(key.comment ? [`+# ${key.comment}`] : []),
          `+${key.name}=${key.value}`,
        ]),
      ],
    };
  }

  if (operation.type === 'makefile-target') {
    const lines = [
      ...(operation.phony ? [`.PHONY: ${operation.target}`] : []),
      `${operation.target}:`,
      `\t${operation.command}`,
    ];
    return {
      available: true,
      format: 'unified',
      summary: `Add Makefile target "${operation.target}" when missing.`,
      hunks: [
        `--- ${operation.path}`,
        `+++ ${operation.path}`,
        '@@',
        ...lines.map((line) => `+${line}`),
      ],
    };
  }

  return {
    available: false,
    format: 'none',
    summary: 'No deterministic file diff preview is available for this remediation.',
    hunks: [],
  };
}

function buildRollbackContract(step: FixPlanStep): PlannedFixStep['rollback'] {
  if (step.kind === 'manual-url') {
    return { available: false, strategy: 'none' };
  }
  if (step.kind === 'env-copy' || step.kind === 'file-create' || step.kind === 'file-append') {
    return { available: true, strategy: 'snapshot' };
  }
  if (step.risk === 'guarded' || step.risk === 'invasive') {
    return { available: true, strategy: 'snapshot' };
  }
  return { available: true, strategy: 'idempotent' };
}

function buildStudioStatus(input: {
  step: FixPlanStep;
  capability?: DoctorRepairCapability;
  executableInCurrentEnvironment: boolean;
  blockedReason?: string;
  policyProfile: DoctorPolicyProfileName;
}): PlannedFixStep['studioStatus'] {
  if (!input.executableInCurrentEnvironment) {
    return {
      state: 'blocked',
      reason: input.blockedReason ?? 'Required tool or environment is not available.',
    };
  }
  if (!input.step.executable) {
    return {
      state: 'guidance-only',
      reason: input.step.reason ?? 'This remediation is guidance-only.',
    };
  }
  if (input.policyProfile === 'enterprise-strict' && input.step.risk !== 'safe') {
    return {
      state: 'review-required',
      reason: 'Enterprise-strict policy requires review before guarded or invasive remediation.',
    };
  }
  if (input.capability?.requiresReview) {
    return {
      state: 'review-required',
      reason: 'Repair capability requires human review before applying.',
    };
  }
  return {
    state: 'ready',
    reason: 'Remediation step is ready for approved execution.',
  };
}

function getRemediationPhase(input: {
  step: FixPlanStep;
  issueClass?: DoctorIssueClass;
  repairIntent?: DoctorRepairIntent;
  operation?: DoctorRepairOperation;
}): RemediationPlanPhase {
  const { step, issueClass, repairIntent, operation } = input;

  if (step.kind === 'manual-url' || repairIntent?.mode === 'manual-guidance') {
    return 'manual-review';
  }
  if (
    step.kind === 'dependency-sync' ||
    step.kind === 'go-mod-tidy' ||
    issueClass === 'dependency'
  ) {
    return 'dependency-baseline';
  }
  if (step.kind === 'env-copy' || issueClass === 'environment') {
    return 'local-environment';
  }
  if (
    step.kind === 'package-json-script' ||
    step.kind === 'json-edit' ||
    step.kind === 'makefile-target' ||
    (operation?.type === 'file-append' &&
      (issueClass === 'test' || issueClass === 'quality' || issueClass === 'security'))
  ) {
    return 'command-contract';
  }
  if (step.kind === 'env-key-add') {
    return 'local-environment';
  }
  if (step.kind === 'rapidkit-init' || issueClass === 'workspace-contract') {
    return 'runtime-governance';
  }
  if (operation?.type === 'file-create' || operation?.type === 'file-append') {
    return 'source-hygiene';
  }
  return 'generic-execution';
}

function getRemediationPhaseOrder(phase: RemediationPlanPhase): number {
  const phaseOrder: Record<RemediationPlanPhase, number> = {
    'dependency-baseline': 10,
    'local-environment': 20,
    'source-hygiene': 30,
    'command-contract': 40,
    'runtime-governance': 50,
    'manual-review': 80,
    'generic-execution': 90,
  };
  return phaseOrder[phase];
}

function sortRemediationSteps(steps: PlannedFixStep[]): PlannedFixStep[] {
  const sorted = [...steps].sort((a, b) => {
    const phaseDelta = getRemediationPhaseOrder(a.phase) - getRemediationPhaseOrder(b.phase);
    if (phaseDelta !== 0) return phaseDelta;
    const projectDelta = a.projectName.localeCompare(b.projectName);
    if (projectDelta !== 0) return projectDelta;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((step, index) => ({
    ...step,
    order: index + 1,
  }));
}

function applyRemediationDependencies(steps: PlannedFixStep[]): PlannedFixStep[] {
  const projectDependencyStepIds = new Map<string, string[]>();

  for (const step of steps) {
    if (step.phase !== 'dependency-baseline') continue;
    const existing = projectDependencyStepIds.get(step.projectPath) ?? [];
    existing.push(step.id);
    projectDependencyStepIds.set(step.projectPath, existing);
  }

  return steps.map((step) => {
    if (step.phase === 'dependency-baseline') return step;
    const dependencyStepIds = projectDependencyStepIds.get(step.projectPath) ?? [];
    if (dependencyStepIds.length === 0) return step;
    return {
      ...step,
      dependsOn: [...new Set([...step.dependsOn, ...dependencyStepIds])],
    };
  });
}

function remediationDedupeKey(
  project: ProjectHealth,
  command: string,
  step: FixPlanStep
): string | null {
  if (step.kind === 'dependency-sync' || step.kind === 'go-mod-tidy') {
    return `${project.path}:dependency-baseline`;
  }

  const internalRepair = parseInternalRepairCommand(command);
  if (internalRepair?.type === 'file-copy') {
    return `${project.path}:file-copy:${internalRepair.path}`;
  }
  if (internalRepair?.type === 'file-create') {
    return `${project.path}:file-create:${internalRepair.path}`;
  }
  if (internalRepair?.type === 'file-append') {
    return `${project.path}:file-append:${internalRepair.path}`;
  }
  if (internalRepair?.type === 'package-json-script') {
    return `${project.path}:package-json-script:${internalRepair.path}:${internalRepair.scriptName}`;
  }
  if (internalRepair?.type === 'json-edit') {
    return `${project.path}:json-edit:${internalRepair.path}:${internalRepair.edits
      .map((edit) => edit.pointer)
      .join(',')}`;
  }
  if (internalRepair?.type === 'env-key-add') {
    return `${project.path}:env-key-add:${internalRepair.path}:${internalRepair.keys
      .map((key) => key.name)
      .join(',')}`;
  }
  if (internalRepair?.type === 'makefile-target') {
    return `${project.path}:makefile-target:${internalRepair.path}:${internalRepair.target}`;
  }

  const envCopyFix = parseEnvCopyFix(command);
  if (envCopyFix) {
    return `${project.path}:file-copy:${path.join(envCopyFix.projectPath, '.env')}`;
  }

  const packageScriptFix = parsePackageScriptFix(command);
  if (packageScriptFix) {
    return `${project.path}:package-json-script:${path.join(
      packageScriptFix.projectPath,
      'package.json'
    )}:${packageScriptFix.scriptName}`;
  }

  return null;
}

function remediationCommandPriority(project: ProjectHealth, command: string): number {
  if (findRepairCapabilityForCommand(project, command)) {
    return 4;
  }
  if (parseInternalRepairCommand(command)) {
    return 3;
  }
  if (parsePackageScriptFix(command)) {
    return 2;
  }
  if (parseEnvCopyFix(command)) {
    return 1;
  }
  return 0;
}

async function buildRemediationPlan(
  projects: ProjectHealth[],
  policyProfile: DoctorPolicyProfileName = 'local'
): Promise<RemediationPlan> {
  const fixableProjects = projects.filter((p) => p.fixCommands && p.fixCommands.length > 0);
  const rawBaseSteps = fixableProjects.flatMap((project) =>
    (project.fixCommands ?? []).map((cmd) => ({
      project,
      step: classifyFixStep(project, cmd),
      command: cmd,
    }))
  );
  const dedupedSteps: typeof rawBaseSteps = [];
  const keyedSteps = new Map<string, { index: number; priority: number }>();

  for (const item of rawBaseSteps) {
    const key = remediationDedupeKey(item.project, item.command, item.step);
    if (!key) {
      dedupedSteps.push(item);
      continue;
    }

    const priority = remediationCommandPriority(item.project, item.command);
    const existing = keyedSteps.get(key);
    if (!existing) {
      keyedSteps.set(key, { index: dedupedSteps.length, priority });
      dedupedSteps.push(item);
      continue;
    }

    if (priority > existing.priority) {
      dedupedSteps[existing.index] = item;
      keyedSteps.set(key, { index: existing.index, priority });
    }
  }
  const baseSteps = dedupedSteps;

  let goToolchainAvailable: boolean | null = null;
  const steps: PlannedFixStep[] = [];
  let executableSteps = 0;
  let safe = 0;
  let guarded = 0;
  let invasive = 0;

  for (const item of baseSteps) {
    const { project, step, command } = item;
    let executableInCurrentEnvironment = step.executable;
    let blockedReason: string | undefined;

    if (step.kind === 'go-mod-tidy') {
      if (goToolchainAvailable === null) {
        goToolchainAvailable = await canRunGoModTidy();
      }
      if (!goToolchainAvailable) {
        executableInCurrentEnvironment = false;
        blockedReason = 'Go toolchain not available';
      }
    }

    if (executableInCurrentEnvironment) {
      executableSteps += 1;
      if (step.risk === 'safe') safe += 1;
      if (step.risk === 'guarded') guarded += 1;
      if (step.risk === 'invasive') invasive += 1;
    }

    const capability = findRepairCapabilityForCommand(project, command);
    const probe = findProbeForRepairCapability(project, capability);
    const operation = capability?.operation ?? parseInternalRepairCommand(command) ?? undefined;
    const files = capability?.files ?? (operation && 'path' in operation ? [operation.path] : []);
    const repairIntent = probe?.repairIntent;
    const studioStatus = buildStudioStatus({
      step,
      capability,
      executableInCurrentEnvironment,
      blockedReason,
      policyProfile,
    });

    const phase = getRemediationPhase({
      step,
      issueClass: probe?.issueClass,
      repairIntent,
      operation,
    });

    steps.push({
      ...step,
      id: buildRemediationStepId({
        projectName: project.name,
        kind: step.kind,
        command,
        operation,
      }),
      phase,
      order: 0,
      dependsOn: [],
      issueId: capability?.issueId,
      issueClass: probe?.issueClass,
      operationalImpact: probe?.operationalImpact,
      repairIntent,
      files,
      ...(operation ? { operation } : {}),
      preview: buildRemediationPreview({ step, capability, operation }),
      diffPreview: buildRemediationDiffPreview({ step, operation }),
      verifyCommand: capability?.verifyCommand,
      refreshCommands: capability?.refreshCommands ?? ['npx workspai doctor project --json'],
      rollback: buildRollbackContract(step),
      studioStatus,
      executableInCurrentEnvironment,
      blockedReason,
    });
  }

  const orderedSteps = applyRemediationDependencies(sortRemediationSteps(steps));

  return {
    schemaVersion: 'doctor-remediation-plan-v2',
    generatedAt: new Date().toISOString(),
    policyProfile,
    fixableProjects: fixableProjects.length,
    totalSteps: orderedSteps.length,
    executableSteps,
    risk: {
      safe,
      guarded,
      invasive,
    },
    steps: orderedSteps,
  };
}

function looksRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const retryableTokens = [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'network',
    '503',
    '504',
  ];
  const lower = message.toLowerCase();
  return retryableTokens.some((token) => lower.includes(token.toLowerCase()));
}

async function ensureProjectSnapshot(
  snapshotCache: Map<string, ProjectSnapshotEntry>,
  projectPath: string
): Promise<ProjectSnapshotEntry> {
  const existing = snapshotCache.get(projectPath);
  if (existing) {
    return existing;
  }

  const snapshotId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeProjectName = path.basename(projectPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const snapshotRoot = path.join(
    projectPath,
    '.workspai',
    'reports',
    'fix-snapshots',
    `${safeProjectName}-${snapshotId}`
  );
  await fsExtra.ensureDir(snapshotRoot);

  const candidateFiles = [
    '.env',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'poetry.lock',
    'requirements.txt',
    'go.mod',
    'go.sum',
    'Cargo.lock',
    'composer.lock',
    'Gemfile.lock',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'gradle.lockfile',
  ];

  const files = new Map<string, string>();
  for (const relativeFile of candidateFiles) {
    const sourcePath = path.join(projectPath, relativeFile);
    if (!(await fsExtra.pathExists(sourcePath))) {
      continue;
    }
    const destinationPath = path.join(snapshotRoot, relativeFile);
    await fsExtra.ensureDir(path.dirname(destinationPath));
    await fsExtra.copy(sourcePath, destinationPath, { overwrite: true });
    files.set(sourcePath, destinationPath);
  }

  const entry: ProjectSnapshotEntry = { snapshotRoot, files, missingFiles: new Set() };
  snapshotCache.set(projectPath, entry);
  return entry;
}

async function ensureSnapshotFile(
  snapshot: ProjectSnapshotEntry,
  targetPath: string
): Promise<void> {
  if (snapshot.files.has(targetPath) || snapshot.missingFiles.has(targetPath)) {
    return;
  }

  if (!(await fsExtra.pathExists(targetPath))) {
    snapshot.missingFiles.add(targetPath);
    return;
  }

  const relativeFile = path.basename(targetPath);
  const destinationPath = path.join(
    snapshot.snapshotRoot,
    'ad-hoc',
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${relativeFile}`
  );
  await fsExtra.ensureDir(path.dirname(destinationPath));
  await fsExtra.copy(targetPath, destinationPath, { overwrite: true });
  snapshot.files.set(targetPath, destinationPath);
}

async function rollbackProjectFromSnapshot(snapshot: ProjectSnapshotEntry): Promise<void> {
  for (const [targetPath, snapshotPath] of snapshot.files.entries()) {
    if (!(await fsExtra.pathExists(snapshotPath))) {
      continue;
    }
    await fsExtra.ensureDir(path.dirname(targetPath));
    await fsExtra.copy(snapshotPath, targetPath, { overwrite: true });
  }

  for (const targetPath of snapshot.missingFiles) {
    if (await fsExtra.pathExists(targetPath)) {
      await fsExtra.remove(targetPath);
    }
  }
}

async function verifyProjectPostFix(
  projectPath: string
): Promise<{ issues: number; healthy: boolean }> {
  const recheck = await checkProject(projectPath, { allowNonRapidkit: true });
  return {
    issues: recheck.issues.length,
    healthy: recheck.issues.length === 0,
  };
}

async function collectDoctorRemainingBlockers(projects: ProjectHealth[]): Promise<string[]> {
  const blockers: string[] = [];
  for (const project of projects) {
    const recheck = await checkProject(project.path, { allowNonRapidkit: true });
    for (const issue of recheck.issues) {
      if (typeof issue === 'string' && issue.trim()) {
        blockers.push(`${project.name}: ${issue.trim()}`);
      }
    }
  }
  return blockers.slice(0, 24);
}

function collectDoctorRemainingBlockersFromHealth(projects: ProjectHealth[]): string[] {
  const blockers: string[] = [];
  for (const project of projects) {
    for (const issue of project.issues) {
      if (typeof issue === 'string' && issue.trim()) {
        blockers.push(`${project.name}: ${issue.trim()}`);
      }
    }
  }
  return blockers.slice(0, 24);
}

async function executeFixCommands(
  projects: ProjectHealth[],
  autoFix: boolean = false,
  options: {
    planOnly?: boolean;
    skipConfirmation?: boolean;
    json?: boolean;
    policyProfile?: DoctorPolicyProfileName;
    artifactRoot?: string;
    artifactMirrorRoots?: string[];
    historyScope?: 'workspace' | 'project';
  } = {}
): Promise<DoctorFixExecutionResult | void> {
  const remediationPlan = await buildRemediationPlan(projects, options.policyProfile);
  if (options.artifactRoot && (options.planOnly || autoFix)) {
    await writeDoctorRemediationPlanArtifact(
      options.artifactRoot,
      remediationPlan,
      options.artifactMirrorRoots
    );
  }
  const fixableProjects = projects.filter((p) => p.fixCommands && p.fixCommands.length > 0);
  const appliedFixes: DoctorAppliedFix[] = [];
  const quiet = options.json === true;
  const logFix = (...args: Parameters<typeof console.log>) => {
    if (!quiet) {
      console.log(...args);
    }
  };
  let goToolchainAvailable: boolean | null = null;
  const goFixBlocked = remediationPlan.steps.some(
    (step) => step.kind === 'go-mod-tidy' && !step.executableInCurrentEnvironment
  );
  const snapshotCache = new Map<string, ProjectSnapshotEntry>();

  if (fixableProjects.length === 0) {
    if (!quiet) {
      console.log(chalk.green('\n✅ No fixes needed - all projects are healthy!'));
    }
    if (autoFix) {
      const result = buildDoctorFixExecutionResult({
        appliedFixes: [],
        remainingBlockers: [],
        verifyRecommended: DOCTOR_FIX_VERIFY_RECOMMENDED,
      });
      if (options.artifactRoot) {
        await writeDoctorFixResultArtifact(
          options.artifactRoot,
          result,
          options.artifactMirrorRoots
        );
        await recordDoctorFixHistory(
          options.artifactRoot,
          result,
          options.historyScope ?? 'project'
        );
      }
      return result;
    }
    return;
  }

  if (!quiet) {
    console.log(chalk.bold.cyan('\n🔧 Available Fixes:\n'));

    for (const project of fixableProjects) {
      const fixCommands = project.fixCommands ?? [];
      console.log(chalk.bold(`Project: ${chalk.yellow(project.name)}`));
      fixCommands.forEach((cmd, idx) => {
        console.log(`  ${idx + 1}. ${chalk.cyan(humanFixDescription(project, cmd))}`);
      });
      console.log();
    }
  }

  if (options.planOnly) {
    if (options.json) {
      console.log(JSON.stringify(remediationPlan, null, 2));
      return;
    }

    console.log(chalk.bold('\n🧭 Remediation Plan\n'));
    console.log(
      chalk.gray(
        `Executable steps: ${remediationPlan.executableSteps}/${remediationPlan.totalSteps} | risk: safe=${remediationPlan.risk.safe}, guarded=${remediationPlan.risk.guarded}, invasive=${remediationPlan.risk.invasive}`
      )
    );

    for (const step of remediationPlan.steps) {
      const project = fixableProjects.find((candidate) => candidate.path === step.projectPath);
      const state = step.executableInCurrentEnvironment
        ? chalk.green('ready')
        : chalk.yellow(`blocked${step.blockedReason ? ` (${step.blockedReason})` : ''}`);
      console.log(
        `  - ${chalk.cyan(step.projectName)} [${step.risk}] ${project ? humanFixDescription(project, step.originalCommand) : step.preview.title} ${chalk.gray(`=> ${state}`)}`
      );
    }

    console.log(
      chalk.gray(
        '\nUse --apply to execute this plan non-interactively, or --fix for interactive confirmation.'
      )
    );
    return;
  }

  const executableFixCount = remediationPlan.executableSteps;
  const safeSteps = remediationPlan.risk.safe;
  const guardedSteps = remediationPlan.risk.guarded;
  const invasiveSteps = remediationPlan.risk.invasive;

  if (executableFixCount === 0) {
    if (!quiet) {
      console.log(chalk.gray('💡 No automatic fixes can be applied right now.'));
      if (goFixBlocked) {
        console.log(
          chalk.gray(
            '   Install Go to enable go mod tidy fixes, then rerun `workspai doctor workspace --fix`.'
          )
        );
      }
    }
    if (autoFix) {
      const result = buildDoctorFixExecutionResult({
        appliedFixes: [],
        remainingBlockers: await collectDoctorRemainingBlockers(projects),
        verifyRecommended: DOCTOR_FIX_VERIFY_RECOMMENDED,
      });
      if (options.artifactRoot) {
        await writeDoctorFixResultArtifact(
          options.artifactRoot,
          result,
          options.artifactMirrorRoots
        );
        await recordDoctorFixHistory(
          options.artifactRoot,
          result,
          options.historyScope ?? 'project'
        );
      }
      return result;
    }
    return;
  }

  if (!autoFix) {
    if (!quiet) {
      console.log(
        chalk.gray('💡 Run "npx workspai doctor workspace --fix" to apply fixes automatically')
      );
    }
    return;
  }

  if (!quiet) {
    console.log(
      chalk.gray(
        `Risk policy: safe=${safeSteps}, guarded=${guardedSteps}, invasive=${invasiveSteps}. Guarded/invasive fixes use snapshot + rollback.`
      )
    );
  }

  if (!options.skipConfirmation) {
    // Confirm before proceeding
    const { confirm } = await prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Apply ${fixableProjects.reduce((sum, p) => sum + (p.fixCommands?.length ?? 0), 0)} fix(es)?`,
        default: false,
      },
    ]);

    if (!confirm) {
      if (!quiet) {
        console.log(chalk.yellow('\n⚠️  Fixes cancelled by user'));
      }
      const result = buildDoctorFixExecutionResult({
        appliedFixes: [],
        remainingBlockers: await collectDoctorRemainingBlockers(projects),
        verifyRecommended: DOCTOR_FIX_VERIFY_RECOMMENDED,
      });
      if (options.artifactRoot) {
        await writeDoctorFixResultArtifact(
          options.artifactRoot,
          result,
          options.artifactMirrorRoots
        );
        await recordDoctorFixHistory(
          options.artifactRoot,
          result,
          options.historyScope ?? 'project'
        );
      }
      return result;
    }
  }

  if (!quiet) {
    console.log(chalk.bold.cyan('\n🚀 Applying fixes...\n'));
  }

  const executedSteps = new Set<string>();
  const fixableProjectsByPath = new Map(fixableProjects.map((project) => [project.path, project]));
  const touchedProjectPaths = new Set<string>();
  const fixCommandTimeoutMs = getDoctorFixCommandTimeoutMs();
  const allowGuardedCommandFixes =
    process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS === '1' ||
    process.env.RAPIDKIT_DOCTOR_FIX_ALLOW_DEPENDENCY_SYNC === '1';
  let currentProjectName = '';

  for (const planStep of remediationPlan.steps) {
    const project = fixableProjectsByPath.get(planStep.projectPath);
    if (!project) {
      continue;
    }
    const cmd = planStep.originalCommand;
    if (!quiet) {
      if (currentProjectName !== planStep.projectName) {
        currentProjectName = planStep.projectName;
        console.log(chalk.bold(`Fixing ${chalk.cyan(planStep.projectName)}...`));
      }
    }

    const stepKey = `${planStep.projectPath}::${cmd}`;
    if (executedSteps.has(stepKey)) {
      continue;
    }
    executedSteps.add(stepKey);

    try {
      logFix(chalk.gray(`  ${humanFixDescription(project, cmd)}`));

      if (planStep.kind === 'manual-url') {
        logFix(chalk.yellow(`  ℹ Manual action required: open ${cmd}`));
        logFix(chalk.green('  ✅ Recorded as guidance\n'));
        continue;
      }

      if (!planStep.executable || !planStep.executableInCurrentEnvironment) {
        const reason = planStep.blockedReason ? `: ${planStep.blockedReason}` : '';
        logFix(chalk.yellow(`  ⚠ Step is non-executable by policy${reason}`));
        logFix(chalk.green('  ✅ Recorded as guidance\n'));
        continue;
      }

      const internalRepair = parseInternalRepairCommand(cmd);
      const requiresSnapshot =
        planStep.risk !== 'safe' ||
        internalRepair?.type === 'file-create' ||
        internalRepair?.type === 'file-append' ||
        internalRepair?.type === 'file-copy' ||
        internalRepair?.type === 'json-edit' ||
        internalRepair?.type === 'env-key-add' ||
        internalRepair?.type === 'makefile-target';
      const snapshot = requiresSnapshot
        ? await ensureProjectSnapshot(snapshotCache, planStep.projectPath)
        : null;
      if (snapshot && internalRepair?.type === 'file-create') {
        await ensureSnapshotFile(snapshot, internalRepair.path);
      }
      if (snapshot && internalRepair?.type === 'file-append') {
        await ensureSnapshotFile(snapshot, internalRepair.path);
      }
      if (snapshot && internalRepair?.type === 'file-copy') {
        await ensureSnapshotFile(snapshot, internalRepair.path);
      }
      if (snapshot && internalRepair?.type === 'json-edit') {
        await ensureSnapshotFile(snapshot, internalRepair.path);
      }
      if (snapshot && internalRepair?.type === 'env-key-add') {
        await ensureSnapshotFile(snapshot, internalRepair.path);
      }
      if (snapshot && internalRepair?.type === 'makefile-target') {
        await ensureSnapshotFile(snapshot, internalRepair.path);
      }

      const envCopyFix = parseEnvCopyFix(cmd);
      if (envCopyFix) {
        const sourcePath = path.join(envCopyFix.projectPath, '.env.example');
        const targetPath = path.join(envCopyFix.projectPath, '.env');

        if (!(await fsExtra.pathExists(sourcePath))) {
          throw new Error(`.env.example not found at ${sourcePath}`);
        }

        if (await fsExtra.pathExists(targetPath)) {
          logFix(chalk.green('  ✅ .env already exists\n'));
          continue;
        }

        await fsExtra.copy(sourcePath, targetPath, { overwrite: false, errorOnExist: false });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: targetPath,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      if (internalRepair?.type === 'file-copy') {
        await applyFileCopyFix({
          projectPath: planStep.projectPath,
          operation: internalRepair,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: internalRepair.path,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      const packageScriptFix = parsePackageScriptFix(cmd);
      if (packageScriptFix) {
        await applyPackageScriptFix(packageScriptFix);
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: planStep.projectPath,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      if (internalRepair?.type === 'file-create') {
        await applyFileCreateFix({
          projectPath: planStep.projectPath,
          operation: internalRepair,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: internalRepair.path,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      if (internalRepair?.type === 'file-append') {
        await applyFileAppendFix({
          projectPath: planStep.projectPath,
          operation: internalRepair,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: internalRepair.path,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      if (internalRepair?.type === 'json-edit') {
        await applyJsonEditFix({
          projectPath: planStep.projectPath,
          operation: internalRepair,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: internalRepair.path,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      if (internalRepair?.type === 'env-key-add') {
        await applyEnvKeyAddFix({
          projectPath: planStep.projectPath,
          operation: internalRepair,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: internalRepair.path,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      if (internalRepair?.type === 'makefile-target') {
        await applyMakefileTargetFix({
          projectPath: planStep.projectPath,
          operation: internalRepair,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: internalRepair.path,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      const rapidkitInitFix = parseProjectCommandFix(cmd, '(?:npx\\s+workspai|rapidkit)\\s+init');
      if (rapidkitInitFix) {
        if (!allowGuardedCommandFixes) {
          logFix(
            chalk.yellow(
              '  ⚠ workspai init is a guarded dependency/setup action; recording guidance instead of executing. Set RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS=1 to opt in.'
            )
          );
          appliedFixes.push({
            path: planStep.projectPath,
            action: planStep.kind,
            outcome: 'guidance',
            projectName: planStep.projectName,
            command: cmd,
            detail:
              'Guarded setup command was not auto-executed by doctor --fix. Run it explicitly after review.',
          });
          continue;
        }
        await execa('rapidkit', ['init'], {
          cwd: rapidkitInitFix.projectPath,
          shell: shouldUseShellExecution(),
          stdio: quiet ? 'pipe' : 'inherit',
          timeout: fixCommandTimeoutMs,
          forceKillAfterDelay: 1000,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: planStep.projectPath,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      const goModTidyFix = parseProjectCommandFix(cmd, 'go\\s+mod\\s+tidy');
      if (goModTidyFix) {
        if (goToolchainAvailable === null) {
          goToolchainAvailable = await canRunGoModTidy();
        }

        if (!goToolchainAvailable) {
          logFix(
            chalk.yellow(
              '  ⚠ Go toolchain is not installed — skipping go mod tidy; install Go to apply this fix.'
            )
          );
          logFix(chalk.green('  ✅ Recorded as guidance\n'));
          continue;
        }

        await execa('go', ['mod', 'tidy'], {
          cwd: goModTidyFix.projectPath,
          shell: shouldUseShellExecution(),
          stdio: quiet ? 'pipe' : 'inherit',
          timeout: fixCommandTimeoutMs,
          forceKillAfterDelay: 1000,
        });
        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: planStep.projectPath,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      const dependencySync = parseDependencySyncFix(cmd);
      if (dependencySync) {
        const guardedPackageInstallCommands = new Set([
          'npm',
          'pnpm',
          'yarn',
          'bun',
          'poetry',
          'pip',
          'pip3',
          'pipenv',
        ]);
        if (
          !allowGuardedCommandFixes &&
          guardedPackageInstallCommands.has(dependencySync.command)
        ) {
          logFix(
            chalk.yellow(
              '  ⚠ dependency sync is a guarded install action; recording guidance instead of executing. Set RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS=1 to opt in.'
            )
          );
          appliedFixes.push({
            path: planStep.projectPath,
            action: planStep.kind,
            outcome: 'guidance',
            projectName: planStep.projectName,
            command: cmd,
            detail:
              'Guarded dependency command was not auto-executed by doctor --fix. Run it explicitly after review.',
          });
          continue;
        }
        const maxAttempts = 2;
        let lastError: unknown;
        const isPoetryInstall =
          dependencySync.command === 'poetry' && dependencySync.args[0] === 'install';
        const dependencySyncEnv = isPoetryInstall
          ? {
              ...process.env,
              POETRY_CACHE_DIR: path.join(
                dependencySync.projectPath,
                '.workspai',
                'cache',
                'python',
                'poetry'
              ),
            }
          : process.env;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            await execa(dependencySync.command, dependencySync.args, {
              cwd: dependencySync.projectPath,
              env: dependencySyncEnv,
              shell: shouldUseShellExecution(),
              stdio: quiet ? 'pipe' : 'inherit',
              timeout: fixCommandTimeoutMs,
              forceKillAfterDelay: 1000,
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < maxAttempts && looksRetryableError(error)) {
              logFix(
                chalk.yellow(`  ⚠ Retrying dependency sync (${attempt}/${maxAttempts - 1})...`)
              );
              continue;
            }
            throw error;
          }
        }

        if (lastError) {
          throw lastError;
        }

        touchedProjectPaths.add(planStep.projectPath);
        appliedFixes.push({
          path: planStep.projectPath,
          action: planStep.kind,
          outcome: 'applied',
          projectName: planStep.projectName,
          command: cmd,
        });
        logFix(chalk.green('  ✅ Success\n'));
        continue;
      }

      // Execute the full command through shell for proper command resolution
      const maxAttempts = planStep.kind === 'shell' ? 2 : 1;
      let shellError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await execa(cmd, {
            shell: true,
            stdio: quiet ? 'pipe' : 'inherit',
            timeout: fixCommandTimeoutMs,
            forceKillAfterDelay: 1000,
          });
          shellError = null;
          break;
        } catch (error) {
          shellError = error;
          if (attempt < maxAttempts && looksRetryableError(error)) {
            logFix(chalk.yellow(`  ⚠ Retrying command (${attempt}/${maxAttempts - 1})...`));
            continue;
          }
          throw error;
        }
      }

      if (shellError) {
        throw shellError;
      }

      if (!quiet) {
        console.log(chalk.green(`  ✅ Success\n`));
      }
      touchedProjectPaths.add(planStep.projectPath);
      appliedFixes.push({
        path: planStep.projectPath,
        action: planStep.kind,
        outcome: 'applied',
        projectName: planStep.projectName,
        command: cmd,
      });
    } catch (error) {
      const failedInternalRepair = parseInternalRepairCommand(cmd);
      if (
        planStep.risk !== 'safe' ||
        failedInternalRepair?.type === 'file-create' ||
        failedInternalRepair?.type === 'file-append' ||
        failedInternalRepair?.type === 'file-copy' ||
        failedInternalRepair?.type === 'json-edit' ||
        failedInternalRepair?.type === 'env-key-add' ||
        failedInternalRepair?.type === 'makefile-target'
      ) {
        const snapshot = snapshotCache.get(planStep.projectPath);
        if (snapshot) {
          try {
            await rollbackProjectFromSnapshot(snapshot);
            if (!quiet) {
              console.log(chalk.yellow('  ↩ Rolled back snapshot after failed fix'));
            }
          } catch (rollbackError) {
            if (!quiet) {
              console.log(
                chalk.red(
                  `  ❌ Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
                )
              );
            }
          }
        }
      }
      if (!quiet) {
        console.log(
          chalk.red(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}\n`)
        );
      }
      appliedFixes.push({
        path: planStep.projectPath,
        action: planStep.kind,
        outcome: 'failed',
        projectName: planStep.projectName,
        command: cmd,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const project of fixableProjects) {
    if (!touchedProjectPaths.has(project.path)) {
      continue;
    }
    try {
      const verification = await verifyProjectPostFix(project.path);
      if (!quiet) {
        console.log(
          verification.healthy
            ? chalk.green(`  ✅ Post-fix verification passed for ${project.name}`)
            : chalk.yellow(
                `  ⚠ Post-fix verification: ${verification.issues} issue(s) remain for ${project.name}`
              )
        );
      }
    } catch (verificationError) {
      if (!quiet) {
        console.log(
          chalk.yellow(
            `  ⚠ Post-fix verification skipped: ${
              verificationError instanceof Error
                ? verificationError.message
                : String(verificationError)
            }`
          )
        );
      }
    }
  }

  if (!quiet) {
    console.log(chalk.bold.green('\n✅ Fix process completed!'));
  }

  if (autoFix) {
    const result = buildDoctorFixExecutionResult({
      appliedFixes,
      remainingBlockers: await collectDoctorRemainingBlockers(projects),
      verifyRecommended: DOCTOR_FIX_VERIFY_RECOMMENDED,
    });
    if (options.artifactRoot) {
      await writeDoctorFixResultArtifact(options.artifactRoot, result, options.artifactMirrorRoots);
      await recordDoctorFixHistory(options.artifactRoot, result, options.historyScope ?? 'project');
    }
    return result;
  }
}

export function computeDoctorGateExitCode(
  healthScore: { errors?: number; warnings?: number } | null | undefined,
  options: { strict?: boolean; ci?: boolean; profile?: string }
): number {
  const profile = resolveDoctorPolicyProfile(options);
  const errors = Number(healthScore?.errors ?? 0);
  const warnings = Number(healthScore?.warnings ?? 0);
  if (profile.exitOnErrors && errors > 0) return 1;
  if (profile.exitOnWarnings && warnings > 0) return profile.warningExitCode;
  return 0;
}

export function computeDoctorFixAwareExitCode(
  healthScore: { errors?: number; warnings?: number } | null | undefined,
  options: { strict?: boolean; ci?: boolean; profile?: string },
  fixResult: DoctorFixExecutionResult | undefined
): number {
  const gateExitCode = computeDoctorGateExitCode(healthScore, options);
  const failedFix = fixResult?.appliedFixes.some((fix) => fix.outcome === 'failed') ?? false;
  return failedFix ? Math.max(gateExitCode, 1) : gateExitCode;
}

export async function runDoctor(
  options: {
    workspace?: boolean | string;
    project?: boolean;
    json?: boolean;
    quiet?: boolean;
    fix?: boolean;
    plan?: boolean;
    apply?: boolean;
    strict?: boolean;
    ci?: boolean;
    profile?: string;
  } = {}
): Promise<number> {
  const policyProfile = resolveDoctorPolicyProfile({
    profile: options.profile,
    strict: options.strict,
    ci: options.ci,
  });
  const wantsWorkspaceScope = Boolean(options.fix || options.plan || options.apply);
  const explicitWorkspacePath =
    typeof options.workspace === 'string' && options.workspace.trim().length > 0
      ? path.resolve(options.workspace)
      : null;
  const autoWorkspacePath =
    !explicitWorkspacePath && !options.workspace && !options.project && wantsWorkspaceScope
      ? await findWorkspace(process.cwd())
      : null;
  const workspaceMode = Boolean(options.workspace) || Boolean(autoWorkspacePath);
  const projectMode = Boolean(options.project) && !workspaceMode;

  if (!options.json) {
    console.log(chalk.bold.cyan('\n🩺 Workspai Health Check\n'));
  }

  if (workspaceMode) {
    // Workspace mode: check entire workspace
    const workspacePath =
      explicitWorkspacePath ?? autoWorkspacePath ?? (await findWorkspace(process.cwd()));

    if (!workspacePath) {
      logger.error('No Workspai workspace found in current directory or parents');
      logger.info(
        'Run this command from within a workspace, or use "workspai doctor" for system check'
      );
      process.exit(1);
    }

    if (!options.json) {
      if (autoWorkspacePath) {
        console.log(
          chalk.gray('ℹ️  Detected workspace context; enabling workspace checks for --fix')
        );
      }
      console.log(chalk.bold(`Workspace: ${chalk.cyan(path.basename(workspacePath))}`));
      console.log(chalk.gray(`Path: ${workspacePath}`));
    }

    const allowProjectScanCache = !(options.plan || options.fix || options.apply);
    let health = await getWorkspaceHealth(workspacePath, allowProjectScanCache, policyProfile);

    if (!options.json) {
      if (health.projectScanCached) {
        console.log(
          chalk.gray(
            `ℹ️  Reused cached project scan${health.projectScanCachePath ? ` (${path.basename(health.projectScanCachePath)})` : ''}`
          )
        );
      }
      if (health.evidencePath) {
        console.log(chalk.gray(`ℹ️  Evidence saved: ${health.evidencePath}`));
      }
    }

    // JSON output mode
    if (options.json) {
      let fixResult: DoctorFixExecutionResult | undefined;
      const remediationPlan =
        options.plan || options.fix || options.apply
          ? await buildRemediationPlan(health.projects, policyProfile.name)
          : undefined;
      const remediationPlanPath = remediationPlan
        ? await writeDoctorRemediationPlanArtifact(workspacePath, remediationPlan)
        : undefined;
      let fixResultPath: string | undefined;

      if ((options.fix || options.apply) && !options.plan) {
        fixResult =
          (await executeFixCommands(health.projects, true, {
            skipConfirmation: options.apply === true || options.fix === true,
            json: true,
            policyProfile: policyProfile.name,
          })) ??
          buildDoctorFixExecutionResult({
            appliedFixes: [],
            remainingBlockers: [],
            verifyRecommended: DOCTOR_FIX_VERIFY_RECOMMENDED,
          });
        health = await getWorkspaceHealth(workspacePath, false, policyProfile);
        fixResult = {
          ...fixResult,
          remainingBlockers: collectDoctorRemainingBlockersFromHealth(health.projects),
        };
        fixResultPath = await writeDoctorFixResultArtifact(workspacePath, fixResult);
        await recordDoctorFixHistory(workspacePath, fixResult, 'workspace');
      }

      const projectSummaries = health.projects.map(buildDoctorProbeSummary);
      const blockingFindings = projectSummaries.reduce(
        (sum, summary) => sum + summary.blockingFindings,
        0
      );
      const advisoryFindings = projectSummaries.reduce(
        (sum, summary) => sum + summary.advisoryFindings,
        0
      );
      const output = {
        contract: getDoctorContractMetadata(),
        policyProfile,
        workspace: {
          name: health.workspaceName,
          path: workspacePath,
        },
        cache: {
          projectScan: health.projectScanCached ?? false,
          projectScanPath: health.projectScanCachePath,
          evidencePath: health.evidencePath,
        },
        healthScore: health.healthScore,
        evidenceFreshness: health.evidenceFreshness,
        system: {
          python: health.python,
          poetry: health.poetry,
          pipx: health.pipx,
          rapidkitCore: health.rapidkitCore,
          versions: {
            core: health.coreVersion,
            npm: health.npmVersion,
          },
        },
        projects: health.projects.map((project) => serializeDoctorProjectForOutput(project)),
        summary: {
          totalProjects: health.projects.length,
          totalIssues: health.projects.reduce((sum, p) => sum + p.issues.length, 0),
          verdict: health.healthScore?.verdict ?? 'passed',
          blockingFindings,
          advisoryFindings,
          projectAdvisoryWarningProjects: projectSummaries.filter(
            (summary) => summary.advisoryFindings > 0
          ).length,
          projectAdvisoryWarnings: advisoryFindings,
          hasSystemErrors: [health.python, health.rapidkitCore].some((c) => c.status === 'error'),
          scopeProvenance: health.scopeProvenance,
        },
        driftDelta: health.driftDelta,
        scoreBreakdown: health.scoreBreakdown ?? [],
        ...(remediationPlan ? { remediationPlan, remediationPlanPath } : {}),
        ...(fixResult
          ? {
              appliedFixes: fixResult.appliedFixes,
              remainingBlockers: fixResult.remainingBlockers,
              verifyRecommended: fixResult.verifyRecommended,
              fixResult,
              fixResultPath,
            }
          : {}),
      };

      if (!options.quiet) {
        console.log(JSON.stringify(output, null, 2));
      }
      return computeDoctorFixAwareExitCode(
        health.healthScore,
        { profile: policyProfile.name },
        fixResult
      );
    }

    // Render health score
    if (health.healthScore) {
      const score = health.healthScore;
      const percentage = Math.round((score.passed / score.total) * 100);
      const scoreColor =
        percentage >= 80 ? chalk.green : percentage >= 50 ? chalk.yellow : chalk.red;
      const bar =
        '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));

      console.log(chalk.bold('\n📊 Health Score:'));
      console.log(`   ${scoreColor(`${percentage}%`)} ${chalk.gray(bar)}`);
      console.log(
        `   ${chalk.green(`✅ ${score.passed} passed`)} ${chalk.gray('|')} ${chalk.yellow(`⚠️ ${score.warnings} warnings`)} ${chalk.gray('|')} ${chalk.red(`❌ ${score.errors} errors`)}`
      );
    }

    console.log(chalk.bold('\n\nSystem Tools:\n'));
    renderHealthCheck(health.python, 'Python');
    renderHealthCheck(health.poetry, 'Poetry');
    renderHealthCheck(health.pipx, 'pipx');
    renderHealthCheck(health.go, 'Go');
    renderHealthCheck(health.rapidkitCore, 'RapidKit Core');

    // Version compatibility warning. Core and npm use independent minor streams;
    // only warn on incompatible major streams to avoid false-positive release noise.
    if (
      shouldWarnAboutDoctorVersionCompatibility({
        coreVersion: health.coreVersion,
        npmVersion: health.npmVersion,
      })
    ) {
      console.log(
        chalk.yellow(
          `\n⚠️  Version mismatch: Core ${health.coreVersion} / CLI ${health.npmVersion}`
        )
      );
      console.log(chalk.gray('   Consider updating to compatible major versions.'));
    }

    if (health.projects.length > 0) {
      console.log(chalk.bold(`\n📦 Projects (${health.projects.length}):`));
      health.projects.forEach((project) => renderProjectHealth(project, health.rapidkitCore));
    } else {
      console.log(chalk.bold('\n📦 Projects:'));
      console.log(chalk.gray('   No Workspai projects found in workspace'));
    }

    // Summary
    const projectSummaries = health.projects.map(buildDoctorProbeSummary);
    const totalIssues = projectSummaries.reduce(
      (sum, summary) => sum + summary.blockingFindings,
      0
    );
    const advisoryWarningCount = projectSummaries.reduce(
      (sum, summary) => sum + summary.advisoryFindings,
      0
    );
    const hasSystemIssues = [health.python, health.rapidkitCore].some((c) => c.status === 'error');

    if (hasSystemIssues || totalIssues > 0 || advisoryWarningCount > 0) {
      console.log(
        chalk.bold.yellow(
          `\n⚠️  Doctor verdict: ${health.healthScore?.verdict ?? 'attention'} · ${totalIssues} blocking finding(s) · ${advisoryWarningCount} advisory finding(s)`
        )
      );
      if (hasSystemIssues) {
        console.log(chalk.bold.red('❌ System requirements not met'));
      }

      // Plan or execute fixes when requested
      if (options.plan) {
        await executeFixCommands(health.projects, false, {
          planOnly: true,
          json: options.json,
          policyProfile: policyProfile.name,
          artifactRoot: workspacePath,
          historyScope: 'workspace',
        });
      } else if (options.fix || options.apply) {
        await executeFixCommands(health.projects, true, {
          skipConfirmation: options.apply === true,
          policyProfile: policyProfile.name,
          artifactRoot: workspacePath,
          historyScope: 'workspace',
        });

        if (!options.json) {
          const refreshedHealth = await getWorkspaceHealth(workspacePath, false, policyProfile);
          const refreshedTotalIssues = refreshedHealth.projects
            .map(buildDoctorProbeSummary)
            .reduce((sum, summary) => sum + summary.blockingFindings, 0);
          const refreshedHasSystemIssues = [
            refreshedHealth.python,
            refreshedHealth.rapidkitCore,
          ].some((c) => c.status === 'error');

          if (refreshedHasSystemIssues || refreshedTotalIssues > 0) {
            console.log(
              chalk.bold.yellow(
                `\n⚠️  Post-fix verification found ${refreshedTotalIssues} remaining issue(s)`
              )
            );
            if (refreshedHasSystemIssues) {
              console.log(chalk.bold.red('❌ System requirements still not met'));
            }
          } else {
            console.log(
              chalk.bold.green('\n✅ Post-fix verification passed. Workspace is healthy.')
            );
          }

          if (refreshedHealth.projectScanCached) {
            console.log(
              chalk.gray(
                `ℹ️  Reused cached project scan${refreshedHealth.projectScanCachePath ? ` (${path.basename(refreshedHealth.projectScanCachePath)})` : ''}`
              )
            );
          }

          if (refreshedHealth.evidencePath) {
            console.log(chalk.gray(`ℹ️  Evidence refreshed: ${refreshedHealth.evidencePath}`));
          }
        }
      } else if (totalIssues > 0) {
        await executeFixCommands(health.projects, false);
      }
    } else {
      console.log(chalk.bold.green('\n✅ All checks passed! Workspace is healthy.'));
    }

    return computeDoctorGateExitCode(health.healthScore, { profile: policyProfile.name });
  } else if (projectMode) {
    const projectPath = await findProjectRoot(process.cwd());

    if (!projectPath) {
      const workspacePath = await findWorkspace(process.cwd());
      if (options.json) {
        const output = {
          contract: getDoctorContractMetadata(),
          policyProfile,
          scope: 'project',
          status: 'error',
          generatedAt: new Date().toISOString(),
          workspace: workspacePath
            ? {
                name: path.basename(workspacePath),
                path: workspacePath,
              }
            : null,
          project: null,
          healthScore: {
            total: 1,
            passed: 0,
            warnings: 0,
            errors: 1,
            verdict: 'blocked',
            components: {
              host: { total: 0, passed: 0, warnings: 0, errors: 0 },
              projects: { total: 1, passed: 0, warnings: 0, errors: 1 },
            },
          },
          summary: {
            totalProjects: 0,
            totalIssues: 1,
            projectAdvisoryWarningProjects: 0,
            projectAdvisoryWarnings: 0,
            hasSystemErrors: false,
          },
          error: {
            code: workspacePath
              ? 'doctor.project.scope.not_found_in_workspace'
              : 'doctor.project.scope.not_found',
            message: workspacePath
              ? 'No project found in the current directory within this workspace.'
              : 'No Workspai project found in the current directory or parents.',
            recommendation: workspacePath
              ? 'Run this command from inside a registered project directory, or use doctor workspace for workspace-wide checks.'
              : 'Run this command from within a project, or use doctor workspace from a Workspai workspace.',
            relatedCommands: workspacePath
              ? ['npx workspai doctor workspace --json', 'npx workspai workspace list --json']
              : ['npx workspai doctor workspace --json', 'npx workspai adopt --json'],
          },
        };
        if (!options.quiet) {
          console.log(JSON.stringify(output, null, 2));
        }
        return 1;
      }
      if (workspacePath) {
        logger.error('No backend project found in current directory within this workspace');
        logger.info('Run this command from inside a project directory in the workspace');
      } else {
        logger.error('No Workspai project found in current directory or parents');
      }
      logger.info(
        'Run this command from within a project, or use "workspai doctor workspace" for workspace checks'
      );
      process.exit(1);
    }

    let envelope = await getProjectHealthEnvelope(projectPath, policyProfile);
    const reportedWorkspacePath = envelope.workspacePath
      ? normalizeReportedPath(envelope.workspacePath)
      : null;

    if (options.json) {
      let fixResult: DoctorFixExecutionResult | undefined;
      const remediationPlan =
        options.plan || options.fix || options.apply
          ? await buildRemediationPlan([envelope.project], policyProfile.name)
          : undefined;
      const projectArtifactRoot = projectPath;
      const projectArtifactMirrors: string[] = [];
      const remediationPlanPath = remediationPlan
        ? await writeDoctorRemediationPlanArtifact(
            projectArtifactRoot,
            remediationPlan,
            projectArtifactMirrors
          )
        : undefined;
      let fixResultPath: string | undefined;

      if ((options.fix || options.apply) && !options.plan) {
        fixResult =
          (await executeFixCommands([envelope.project], true, {
            skipConfirmation: options.apply === true || options.fix === true,
            json: true,
            policyProfile: policyProfile.name,
          })) ??
          buildDoctorFixExecutionResult({
            appliedFixes: [],
            remainingBlockers: [],
            verifyRecommended: DOCTOR_FIX_VERIFY_RECOMMENDED,
          });
        envelope = await getProjectHealthEnvelope(projectPath, policyProfile);
        fixResult = {
          ...fixResult,
          remainingBlockers: collectDoctorRemainingBlockersFromHealth([envelope.project]),
        };
        fixResultPath = await writeDoctorFixResultArtifact(
          projectArtifactRoot,
          fixResult,
          projectArtifactMirrors
        );
        await recordDoctorFixHistory(projectArtifactRoot, fixResult, 'project');
      }

      const reportedProjectPath = normalizeReportedPath(envelope.project.path);
      const probeSummary = buildDoctorProbeSummary(envelope.project);
      const output = {
        contract: getDoctorContractMetadata(),
        policyProfile,
        scope: 'project',
        workspace: reportedWorkspacePath
          ? {
              name: path.basename(reportedWorkspacePath),
              path: reportedWorkspacePath,
            }
          : null,
        project: {
          ...serializeDoctorProjectForOutput(envelope.project),
          path: reportedProjectPath,
        },
        evidencePath: envelope.evidencePath,
        healthScore: envelope.healthScore,
        evidenceFreshness: envelope.evidenceFreshness,
        system: {
          python: envelope.python,
          poetry: envelope.poetry,
          pipx: envelope.pipx,
          go: envelope.go,
          rapidkitCore: envelope.rapidkitCore,
        },
        summary: {
          totalProjects: 1,
          totalIssues: envelope.project.issues.length,
          verdict: probeSummary.verdict,
          probeSummary,
          blockingFindings: probeSummary.blockingFindings,
          advisoryFindings: probeSummary.advisoryFindings,
          projectAdvisoryWarningProjects: probeSummary.advisoryFindings > 0 ? 1 : 0,
          projectAdvisoryWarnings: probeSummary.advisoryFindings,
          hasSystemErrors: [envelope.python, envelope.rapidkitCore].some(
            (c) => c.status === 'error'
          ),
          scopeProvenance: envelope.scopeProvenance,
        },
        driftDelta: envelope.driftDelta,
        scoreBreakdown: envelope.scoreBreakdown ?? [],
        ...(remediationPlan ? { remediationPlan, remediationPlanPath } : {}),
        ...(fixResult
          ? {
              appliedFixes: fixResult.appliedFixes,
              remainingBlockers: fixResult.remainingBlockers,
              verifyRecommended: fixResult.verifyRecommended,
              fixResult,
              fixResultPath,
            }
          : {}),
      };

      if (!options.quiet) {
        console.log(JSON.stringify(output, null, 2));
      }
      return computeDoctorFixAwareExitCode(
        envelope.healthScore,
        { profile: policyProfile.name },
        fixResult
      );
    }

    console.log(chalk.bold(`Project: ${chalk.cyan(path.basename(projectPath))}`));
    console.log(chalk.gray(`Path: ${projectPath}`));
    if (envelope.workspacePath) {
      console.log(chalk.gray(`Workspace: ${path.basename(envelope.workspacePath)}`));
    }
    if (envelope.evidencePath) {
      console.log(chalk.gray(`ℹ️  Evidence saved: ${envelope.evidencePath}`));
    }

    const score = envelope.healthScore;
    const percentage = score.total > 0 ? Math.round((score.passed / score.total) * 100) : 0;
    const scoreColor = percentage >= 80 ? chalk.green : percentage >= 50 ? chalk.yellow : chalk.red;
    const bar =
      '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));

    console.log(chalk.bold('\n📊 Health Score:'));
    console.log(`   ${scoreColor(`${percentage}%`)} ${chalk.gray(bar)}`);
    console.log(
      `   ${chalk.green(`✅ ${score.passed} passed`)} ${chalk.gray('|')} ${chalk.yellow(`⚠️ ${score.warnings} warnings`)} ${chalk.gray('|')} ${chalk.red(`❌ ${score.errors} errors`)}`
    );

    console.log(chalk.bold('\n\nSystem Tools:\n'));
    renderHealthCheck(envelope.python, 'Python');
    renderHealthCheck(envelope.poetry, 'Poetry');
    renderHealthCheck(envelope.pipx, 'pipx');
    renderHealthCheck(envelope.go, 'Go');
    renderHealthCheck(envelope.rapidkitCore, 'RapidKit Core');

    console.log(chalk.bold('\n📦 Project (1):'));
    renderProjectHealth(envelope.project, envelope.rapidkitCore);

    const hasSystemIssues = [envelope.python, envelope.rapidkitCore].some(
      (c) => c.status === 'error'
    );
    const probeSummary = buildDoctorProbeSummary(envelope.project);
    const issueCount = probeSummary.blockingFindings;
    const advisoryWarningCount = probeSummary.advisoryFindings;

    if (hasSystemIssues || issueCount > 0 || advisoryWarningCount > 0) {
      console.log(
        chalk.bold.yellow(
          `\n⚠️  Doctor verdict: ${probeSummary.verdict} · ${issueCount} blocking finding(s) · ${advisoryWarningCount} advisory finding(s)`
        )
      );
      if (hasSystemIssues) {
        console.log(chalk.bold.red('❌ System requirements not met'));
      }

      if (options.plan) {
        const projectArtifactRoot = envelope.workspacePath ?? projectPath;
        const projectArtifactMirrors =
          envelope.workspacePath &&
          path.resolve(envelope.workspacePath) !== path.resolve(projectPath)
            ? [projectPath]
            : [];
        await executeFixCommands([envelope.project], false, {
          planOnly: true,
          json: options.json,
          policyProfile: policyProfile.name,
          artifactRoot: projectArtifactRoot,
          artifactMirrorRoots: projectArtifactMirrors,
          historyScope: 'project',
        });
      } else if (options.fix || options.apply) {
        const projectArtifactRoot = envelope.workspacePath ?? projectPath;
        const projectArtifactMirrors =
          envelope.workspacePath &&
          path.resolve(envelope.workspacePath) !== path.resolve(projectPath)
            ? [projectPath]
            : [];
        await executeFixCommands([envelope.project], true, {
          skipConfirmation: options.apply === true,
          policyProfile: policyProfile.name,
          artifactRoot: projectArtifactRoot,
          artifactMirrorRoots: projectArtifactMirrors,
          historyScope: 'project',
        });
      } else if (issueCount > 0) {
        await executeFixCommands([envelope.project], false);
      }
    } else {
      console.log(chalk.bold.green('\n✅ All checks passed! Project is healthy.'));
    }

    return computeDoctorGateExitCode(envelope.healthScore, { profile: policyProfile.name });
  } else {
    // System mode: check system tools only
    const systemChecks = await collectSystemChecks();
    const python = systemChecks.python;
    const poetry = systemChecks.poetry;
    const pipx = systemChecks.pipx;
    const go = systemChecks.go;
    const core = systemChecks.rapidkitCore;
    const checks = [python, poetry, pipx, go, core];
    const healthScore = calculateHealthScore(checks, []);
    const systemErrors = [python, core].filter((c) => c.status === 'error').length;

    if (options.json) {
      const output = {
        contract: getDoctorContractMetadata(),
        policyProfile,
        scope: 'system',
        status: systemErrors > 0 ? 'error' : 'ok',
        generatedAt: new Date().toISOString(),
        healthScore,
        system: {
          python,
          poetry,
          pipx,
          go,
          rapidkitCore: core,
        },
        summary: {
          totalChecks: checks.length,
          errors: systemErrors,
          warnings: checks.filter((check) => check.status === 'warn').length,
          recommendedScopes: ['workspace', 'project'],
        },
        nextActions: ['npx workspai doctor workspace --json', 'npx workspai doctor project --json'],
      };
      if (!options.quiet) {
        console.log(JSON.stringify(output, null, 2));
      }
      return options.strict || options.ci ? (systemErrors > 0 ? 1 : 0) : 0;
    }

    console.log(chalk.bold('System Tools:\n'));

    renderHealthCheck(python, 'Python');
    renderHealthCheck(poetry, 'Poetry');
    renderHealthCheck(pipx, 'pipx');
    renderHealthCheck(go, 'Go');
    renderHealthCheck(core, 'RapidKit Core');

    const hasErrors = [python, core].some((c) => c.status === 'error');

    if (hasErrors) {
      console.log(chalk.bold.red('\n❌ Some required tools are missing'));
      if (options.fix || options.apply) {
        console.log(
          chalk.gray(
            '\nTip: Project auto-fix runs in workspace mode. Run from a workspace and use "workspai doctor workspace --fix"'
          )
        );
      }
      console.log(
        chalk.gray(
          '\nTip: Run "workspai doctor workspace" for workspace-wide checks, or "workspai doctor project" for the current project'
        )
      );
    } else {
      console.log(chalk.bold.green('\n✅ All required tools are installed!'));
      if (options.fix || options.apply) {
        console.log(
          chalk.gray(
            '\nTip: Project auto-fix runs in workspace mode. Run from a workspace and use "workspai doctor workspace --fix"'
          )
        );
      }
      console.log(
        chalk.gray(
          '\nTip: Run "workspai doctor workspace" for workspace-wide checks, or "workspai doctor project" for the current project'
        )
      );
    }

    console.log('');

    if (options.strict || options.ci) {
      if (systemErrors > 0) return 1;
    }
    return 0;
  }
}
