import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  detectBackendFrameworkFromProject,
  detectRuntimeCandidatesFromProject,
  type BackendRuntimeFamily,
} from './utils/backend-framework-contract.js';
import { discoverWorkspaceProjects } from './utils/workspace-discovery.js';
import { readImportedProjectsRegistry } from './imported-projects-registry.js';
import { findWorkspaceRootUp, isWorkspaceShellDirectory } from './utils/workspace-root.js';
import {
  resolveGovernanceRunId,
  withGovernanceRunMetadata,
} from './utils/governance-report-metadata.js';
import { writeWorkspaceArtifactJson } from './utils/artifact-path-compat.js';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';
import {
  hasWorkspaceRootMarkers,
  projectMetadataCandidates,
  workspaceMetadataCandidates,
} from './utils/workspace-paths.js';

export type AnalyzeSeverity = 'info' | 'warn' | 'fail';

export interface AnalyzeFinding {
  id: string;
  severity: AnalyzeSeverity;
  title: string;
  detail: string;
  target: string;
  remediation: string;
}

export interface AnalyzeProject {
  name: string;
  path: string;
  relativePath: string;
  runtime: BackendRuntimeFamily;
  framework: string;
  confidence: string;
  supportTier: string;
  hasRapidKitMarker: boolean;
  hasTests: boolean;
  hasDockerfile: boolean;
  hasEnvExample: boolean;
  hasCiConfig: boolean;
  hasHealthEndpoint: boolean;
  scripts: string[];
  findings: AnalyzeFinding[];
  score: number;
}

export interface AnalyzeDependencyEdge {
  from: string;
  to: string;
  kind: 'package' | 'workspace-reference' | 'unknown';
}

export interface AnalyzeGraphImpact {
  project: string;
  directDependents: number;
  directDependencies: number;
}

export interface AnalyzeReport {
  schemaVersion: typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.analyze;
  generatedAt: string;
  workspacePath: string;
  workspaceDetected: boolean;
  profile: string | null;
  summary: {
    score: number;
    verdict: 'ready' | 'needs-attention' | 'blocked';
    projectCount: number;
    runtimeCount: number;
    findings: {
      fail: number;
      warn: number;
      info: number;
    };
  };
  runtimes: Record<string, number>;
  projects: AnalyzeProject[];
  dependencyGraph: {
    status: 'generated' | 'empty';
    edges: AnalyzeDependencyEdge[];
    topImpactedProjects: AnalyzeGraphImpact[];
  };
  findings: AnalyzeFinding[];
  nextActions: string[];
  enterpriseControls: {
    jsonReady: boolean;
    ciGateCommand: string;
    releaseGateCommand: string;
    evidencePath: string;
  };
}

export interface AnalyzeOptions {
  workspacePath?: string;
  json?: boolean;
  output?: string;
  strict?: boolean;
}

const PROJECT_SKIP_DIRS = new Set([
  '.git',
  '.workspai',
  '.rapidkit',
  '.venv',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  'htmlcov',
  '.next',
]);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function findWorkspaceUp(startPath: string): string | null {
  return findWorkspaceRootUp(startPath);
}

async function isProjectDir(dirPath: string, rootPath: string): Promise<boolean> {
  if (
    await hasAnyAbsolutePath([
      ...projectMetadataCandidates(dirPath, 'project.json'),
      ...projectMetadataCandidates(dirPath, 'context.json'),
    ])
  ) {
    return true;
  }

  // Workspace shells may contain pyproject/venv for RapidKit tooling — not app projects.
  if (isWorkspaceShellDirectory(dirPath)) {
    return false;
  }

  if (path.resolve(dirPath) === path.resolve(rootPath)) {
    return detectRuntimeCandidatesFromProject(dirPath).length > 0;
  }

  return detectRuntimeCandidatesFromProject(dirPath).length > 0;
}

async function discoverProjects(workspacePath: string): Promise<string[]> {
  const projects = await discoverWorkspaceProjects(workspacePath, {
    skipDirs: PROJECT_SKIP_DIRS,
    includeHiddenDirs: false,
    descendIntoMatchedProjects: false,
    isProjectDir,
  });

  const importedProjects = await readImportedProjectsRegistry(workspacePath);
  const adoptedProjectPaths = importedProjects
    .filter((project) => project.relationship === 'adopted' || project.source === 'adopted-local')
    .map((project) => path.resolve(project.path))
    .filter((projectPath) => fs.existsSync(projectPath));
  const discoveredProjects = [
    ...new Set([
      ...projects.map((projectPath) => path.resolve(projectPath)),
      ...adoptedProjectPaths,
    ]),
  ];

  if (discoveredProjects.length > 0) {
    return discoveredProjects;
  }

  if (isWorkspaceShellDirectory(workspacePath)) {
    return [];
  }

  return detectRuntimeCandidatesFromProject(workspacePath).length > 0 ? [workspacePath] : [];
}

function normalizeRelative(workspacePath: string, targetPath: string): string {
  const relative = path.relative(workspacePath, targetPath).replace(/\\/g, '/');
  return relative || '.';
}

async function hasAnyPath(projectPath: string, candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (await pathExists(path.join(projectPath, candidate))) {
      return true;
    }
  }
  return false;
}

async function hasAnyAbsolutePath(candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

async function hasCiConfiguration(projectPath: string): Promise<boolean> {
  if (
    await hasAnyPath(projectPath, [
      '.gitlab-ci.yml',
      '.circleci/config.yml',
      'azure-pipelines.yml',
      'bitbucket-pipelines.yml',
      'cloudbuild.yaml',
    ])
  ) {
    return true;
  }
  try {
    const workflows = await fs.promises.readdir(path.join(projectPath, '.github', 'workflows'), {
      withFileTypes: true,
    });
    return workflows.some(
      (entry) => entry.isFile() && /\.(?:ya?ml)$/i.test(entry.name) && !entry.name.startsWith('.')
    );
  } catch {
    return false;
  }
}

async function readFirstJsonObject(candidates: string[]): Promise<Record<string, unknown> | null> {
  for (const candidate of candidates) {
    const payload = await readJsonObject(candidate);
    if (payload) {
      return payload;
    }
  }
  return null;
}

async function hasHealthEndpoint(projectPath: string): Promise<boolean> {
  const candidatePaths = [
    'health',
    'health.ts',
    'health.js',
    'health.py',
    'health.go',
    'health.kt',
    'health.rb',
    'health.php',
    'healthcheck',
    'health-check',
    'src/health.ts',
    'src/health.js',
    'src/health.py',
    'src/health.go',
    'src/health.kt',
    'src/health.rb',
    'src/health.php',
    'src/healthcheck.ts',
    'src/healthcheck.js',
    'src/liveness.ts',
    'src/readiness.ts',
    'src/ping.ts',
  ];
  return hasAnyPath(projectPath, candidatePaths);
}

async function hasTestFiles(projectPath: string): Promise<boolean> {
  const direct = await hasAnyPath(projectPath, [
    'tests',
    'test',
    '__tests__',
    'src/__tests__',
    'pytest.ini',
    'vitest.config.ts',
    'jest.config.ts',
  ]);
  if (direct) return true;

  const packageJson = await readJsonObject(path.join(projectPath, 'package.json'));
  const scripts =
    packageJson?.scripts && typeof packageJson.scripts === 'object'
      ? (packageJson.scripts as Record<string, unknown>)
      : {};
  return typeof scripts.test === 'string' && scripts.test.trim().length > 0;
}

async function readScripts(projectPath: string): Promise<string[]> {
  const packageJson = await readJsonObject(path.join(projectPath, 'package.json'));
  const scripts =
    packageJson?.scripts && typeof packageJson.scripts === 'object'
      ? (packageJson.scripts as Record<string, unknown>)
      : {};
  return Object.keys(scripts).sort();
}

function finding(
  id: string,
  severity: AnalyzeSeverity,
  target: string,
  title: string,
  detail: string,
  remediation: string
): AnalyzeFinding {
  return { id, severity, target, title, detail, remediation };
}

function scoreProject(findings: AnalyzeFinding[]): number {
  const penalty = findings.reduce((sum, item) => {
    if (item.severity === 'fail') return sum + 28;
    if (item.severity === 'warn') return sum + 12;
    return sum + 3;
  }, 0);
  return Math.max(0, 100 - penalty);
}

async function analyzeProject(workspacePath: string, projectPath: string): Promise<AnalyzeProject> {
  const projectJson = await readFirstJsonObject(
    projectMetadataCandidates(projectPath, 'project.json')
  );
  const detection = detectBackendFrameworkFromProject(projectPath, projectJson);
  const runtimeCandidates = detectRuntimeCandidatesFromProject(projectPath);
  const runtime =
    detection.runtime === 'unknown' ? runtimeCandidates[0] || 'unknown' : detection.runtime;
  const relativePath = normalizeRelative(workspacePath, projectPath);
  const target = relativePath;
  const scripts = await readScripts(projectPath);
  const hasRapidKitMarker = await hasAnyAbsolutePath([
    ...projectMetadataCandidates(projectPath, 'project.json'),
    ...projectMetadataCandidates(projectPath, 'context.json'),
  ]);
  const hasTests = await hasTestFiles(projectPath);
  const hasDockerfile = await hasAnyPath(projectPath, ['Dockerfile', 'dockerfile']);
  const hasEnvExample = await hasAnyPath(projectPath, [
    '.env.example',
    'env.example',
    'config/env.example',
  ]);
  const hasCiConfig = await hasCiConfiguration(projectPath);
  const hasHealthEndpointFlag = await hasHealthEndpoint(projectPath);

  const findings: AnalyzeFinding[] = [];
  if (detection.key === 'unknown') {
    findings.push(
      finding(
        'project.stack.unknown',
        'fail',
        target,
        'Project stack is unknown',
        'Workspai cannot confidently classify this backend project.',
        'Add .workspai/project.json metadata or import the project with `workspai import`.'
      )
    );
  }
  if (!hasRapidKitMarker) {
    findings.push(
      finding(
        'project.marker.missing',
        'warn',
        target,
        'Workspai marker is missing',
        'The project can be detected by files, but it is not registered with Workspai metadata.',
        'Run `workspai import <path>` from a workspace or create the project through Workspai.'
      )
    );
  }
  if (!hasTests) {
    findings.push(
      finding(
        'project.tests.missing',
        'warn',
        target,
        'Test entrypoint is missing',
        'No common test folder, config, or package test script was found.',
        'Add a test command so `workspai workspace run test --affected` can gate changes.'
      )
    );
  }
  if (!hasEnvExample) {
    findings.push(
      finding(
        'project.env.example.missing',
        'info',
        target,
        'Environment example is missing',
        'No .env.example or env.example file was found.',
        'Add an env example for onboarding and CI secret documentation.'
      )
    );
  }
  if (!hasCiConfig) {
    findings.push(
      finding(
        'project.ci.missing',
        'warn',
        target,
        'Continuous integration is missing',
        'No recognized CI/CD configuration file was detected for this project.',
        'Add CI configuration so tests and checks run automatically for every change.'
      )
    );
  }
  if (!hasHealthEndpointFlag) {
    findings.push(
      finding(
        'project.health.missing',
        'info',
        target,
        'Health or readiness probe is missing',
        'The project has no obvious health or readiness endpoint to support automated deployment and runtime checks.',
        'Add a simple health endpoint and document it for readiness gates and observability.'
      )
    );
  }
  if (!hasDockerfile) {
    findings.push(
      finding(
        'project.container.missing',
        'info',
        target,
        'Container recipe is missing',
        'No Dockerfile was found for this project.',
        'Add a Dockerfile when the service is intended for containerized deployment.'
      )
    );
  }

  return {
    name:
      typeof projectJson?.name === 'string' && projectJson.name.trim()
        ? projectJson.name.trim()
        : path.basename(projectPath),
    path: projectPath,
    relativePath,
    runtime,
    framework: detection.key,
    confidence: detection.confidence,
    supportTier: detection.supportTier,
    hasRapidKitMarker,
    hasTests,
    hasDockerfile,
    hasEnvExample,
    hasCiConfig,
    hasHealthEndpoint: hasHealthEndpointFlag,
    scripts,
    findings,
    score: scoreProject(findings),
  };
}

function packageNameFromProject(project: AnalyzeProject): string {
  return project.name.toLowerCase();
}

async function buildDependencyGraph(projects: AnalyzeProject[]): Promise<AnalyzeDependencyEdge[]> {
  const byName = new Map(projects.map((project) => [packageNameFromProject(project), project]));
  const edges: AnalyzeDependencyEdge[] = [];

  for (const project of projects) {
    const packageJson = await readJsonObject(path.join(project.path, 'package.json'));
    const deps = {
      ...((packageJson?.dependencies as Record<string, unknown> | undefined) ?? {}),
      ...((packageJson?.devDependencies as Record<string, unknown> | undefined) ?? {}),
      ...((packageJson?.peerDependencies as Record<string, unknown> | undefined) ?? {}),
    };
    for (const depName of Object.keys(deps)) {
      const normalized = depName.replace(/^@[^/]+\//, '').toLowerCase();
      const target = byName.get(normalized);
      if (target && target.relativePath !== project.relativePath) {
        edges.push({ from: project.relativePath, to: target.relativePath, kind: 'package' });
      }
    }

    const pyproject = await readText(path.join(project.path, 'pyproject.toml'));
    for (const candidate of projects) {
      if (candidate.relativePath === project.relativePath) continue;
      if (pyproject.includes(candidate.name)) {
        edges.push({
          from: project.relativePath,
          to: candidate.relativePath,
          kind: 'workspace-reference',
        });
      }
    }
  }

  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeDependencyImpact(
  projects: AnalyzeProject[],
  edges: AnalyzeDependencyEdge[]
): AnalyzeGraphImpact[] {
  const impactMap = new Map<string, AnalyzeGraphImpact>();
  for (const project of projects) {
    impactMap.set(project.relativePath, {
      project: project.relativePath,
      directDependents: 0,
      directDependencies: 0,
    });
  }

  for (const edge of edges) {
    const from = impactMap.get(edge.from);
    const to = impactMap.get(edge.to);
    if (from) {
      from.directDependencies += 1;
    }
    if (to) {
      to.directDependents += 1;
    }
  }

  return Array.from(impactMap.values()).sort(
    (a, b) => b.directDependents - a.directDependents || b.directDependencies - a.directDependencies
  );
}

async function readWorkspaceProfile(workspacePath: string): Promise<string | null> {
  const workspaceJson = await readFirstJsonObject(
    workspaceMetadataCandidates(workspacePath, 'workspace.json')
  );
  return typeof workspaceJson?.profile === 'string' ? workspaceJson.profile : null;
}

function summarizeFindings(findings: AnalyzeFinding[]): {
  fail: number;
  warn: number;
  info: number;
} {
  return {
    fail: findings.filter((item) => item.severity === 'fail').length,
    warn: findings.filter((item) => item.severity === 'warn').length,
    info: findings.filter((item) => item.severity === 'info').length,
  };
}

function buildNextActions(report: {
  findings: AnalyzeFinding[];
  projectCount: number;
  hasGraph: boolean;
  workspaceDetected: boolean;
}): string[] {
  if (report.projectCount === 0) {
    if (report.workspaceDetected) {
      return [
        'Add your first project: npx workspai create project <name> --kit <kit>',
        'Import an existing service: npx workspai import <path>',
      ];
    }
    return [
      'Create a Workspai workspace: npx workspai create workspace my-workspace --profile polyglot',
      'Import an existing service: npx workspai import ../service',
    ];
  }

  const actions: string[] = [];
  if (report.findings.some((item) => item.id === 'workspace.marker.missing')) {
    actions.push('Initialize workspace metadata with `workspai bootstrap --profile polyglot`.');
  }
  if (report.findings.some((item) => item.id === 'project.marker.missing')) {
    actions.push(
      'Register detected projects with `workspai import <path>` or recreate them via `workspai create project`.'
    );
  }
  if (report.findings.some((item) => item.id === 'project.tests.missing')) {
    actions.push(
      'Add test entrypoints, then gate changes with `workspai workspace run test --affected --strict`.'
    );
  }
  if (report.findings.some((item) => item.id === 'project.ci.missing')) {
    actions.push(
      'Add CI/CD configuration to catch regressions early and make workspace health checks actionable.'
    );
  }
  if (report.findings.some((item) => item.id === 'project.health.missing')) {
    actions.push(
      'Add a health/readiness endpoint so runtime probes and deployment checks can verify service health.'
    );
  }
  if (!report.hasGraph) {
    actions.push(
      'Create `.workspai/workspace-dependency-graph.json` or use analyze output as the first graph seed.'
    );
  }
  actions.push('Run `workspai autopilot release --mode audit --json` before release.');
  return Array.from(new Set(actions));
}

export async function runAnalyze(options: AnalyzeOptions = {}): Promise<AnalyzeReport> {
  const requestedPath = path.resolve(options.workspacePath || process.cwd());
  if (!(await pathExists(requestedPath))) {
    throw new Error(`Workspace path does not exist: ${requestedPath}`);
  }
  const workspacePath = findWorkspaceUp(requestedPath) ?? requestedPath;
  const workspaceDetected = hasWorkspaceRootMarkers(workspacePath);
  const profile = await readWorkspaceProfile(workspacePath);
  const projectPaths = await discoverProjects(workspacePath);
  const projects = await Promise.all(
    projectPaths.map((projectPath) => analyzeProject(workspacePath, projectPath))
  );
  const dependencyEdges = await buildDependencyGraph(projects);
  const dependencyImpact = computeDependencyImpact(projects, dependencyEdges);

  const workspaceFindings: AnalyzeFinding[] = [];
  if (!workspaceDetected) {
    workspaceFindings.push(
      finding(
        'workspace.marker.missing',
        'warn',
        '.',
        'Workspace metadata is missing',
        'The directory can be analyzed, but it is not a registered Workspai workspace.',
        'Run `workspai create workspace` or `workspai bootstrap --profile polyglot` in a workspace root.'
      )
    );
  }
  if (projects.length === 0) {
    workspaceFindings.push(
      finding(
        'workspace.projects.missing',
        'warn',
        '.',
        'No backend projects detected',
        'Workspai did not find runtime markers or project metadata under this root.',
        'Create a project with `workspai create project` or import one with `workspai import <path>`.'
      )
    );
  }

  const findings = [...workspaceFindings, ...projects.flatMap((project) => project.findings)];
  const findingSummary = summarizeFindings(findings);
  const runtimes: Record<string, number> = {};
  for (const project of projects) {
    runtimes[project.runtime] = (runtimes[project.runtime] || 0) + 1;
  }

  const projectScore =
    projects.length > 0
      ? Math.round(projects.reduce((sum, project) => sum + project.score, 0) / projects.length)
      : 0;
  const workspacePenalty = workspaceFindings.reduce(
    (sum, item) => sum + (item.severity === 'fail' ? 20 : item.severity === 'warn' ? 8 : 2),
    0
  );
  const score = Math.max(0, projectScore - workspacePenalty);
  const scaffoldOnlyMissingProjects =
    projects.length === 0 &&
    findingSummary.fail === 0 &&
    findings.length > 0 &&
    findings.every((item) => item.id === 'workspace.projects.missing' && item.severity === 'warn');
  const verdict =
    findingSummary.fail > 0 ||
    (options.strict && findingSummary.warn > 0 && !scaffoldOnlyMissingProjects)
      ? 'blocked'
      : findingSummary.warn > 0
        ? 'needs-attention'
        : 'ready';
  const report: AnalyzeReport = {
    schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.analyze,
    generatedAt: new Date().toISOString(),
    workspacePath,
    workspaceDetected,
    profile,
    summary: {
      score,
      verdict,
      projectCount: projects.length,
      runtimeCount: Object.keys(runtimes).length,
      findings: findingSummary,
    },
    runtimes,
    projects,
    dependencyGraph: {
      status: dependencyEdges.length > 0 ? 'generated' : 'empty',
      edges: dependencyEdges,
      topImpactedProjects: dependencyImpact.slice(0, 5),
    },
    findings,
    nextActions: buildNextActions({
      findings,
      projectCount: projects.length,
      hasGraph: dependencyEdges.length > 0,
      workspaceDetected,
    }),
    enterpriseControls: {
      jsonReady: true,
      ciGateCommand: 'workspai analyze --json --strict',
      releaseGateCommand: 'workspai autopilot release --mode enforce --json',
      evidencePath: WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze,
    },
  };

  if (options.output) {
    await fs.promises.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await fs.promises.writeFile(
      path.resolve(options.output),
      `${JSON.stringify(report, null, 2)}\n`
    );
  }

  if (!options.output && workspaceDetected) {
    const enriched = withGovernanceRunMetadata(report as unknown as Record<string, unknown>, {
      commandId: 'workspaceAnalyze',
      exitCode:
        report.summary.verdict === 'blocked'
          ? 2
          : report.summary.verdict === 'needs-attention'
            ? 1
            : 0,
      generatedAt: report.generatedAt,
      blockers: report.findings
        .filter((finding) => finding.severity === 'fail')
        .map((finding) => finding.title)
        .slice(0, 12),
      runId: resolveGovernanceRunId(),
    });
    await writeWorkspaceArtifactJson(
      workspacePath,
      WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze,
      enriched
    );
  }

  return report;
}

export function printAnalyzeReport(report: AnalyzeReport): void {
  const verdictColor =
    report.summary.verdict === 'ready'
      ? chalk.green
      : report.summary.verdict === 'needs-attention'
        ? chalk.yellow
        : chalk.red;

  console.log(chalk.bold('\nWorkspai Workspace Analysis\n'));
  console.log(chalk.cyan('Workspace:'), report.workspacePath);
  console.log(chalk.cyan('Profile:'), report.profile || 'not configured');
  console.log(chalk.cyan('Score:'), `${report.summary.score}/100`);
  console.log(chalk.cyan('Verdict:'), verdictColor(report.summary.verdict));
  console.log(
    chalk.gray(
      `Projects: ${report.summary.projectCount}, runtimes: ${report.summary.runtimeCount}, findings: ${report.summary.findings.fail} fail / ${report.summary.findings.warn} warn / ${report.summary.findings.info} info`
    )
  );

  if (report.projects.length > 0) {
    console.log(chalk.bold('\nProjects'));
    for (const project of report.projects) {
      const marker =
        project.score >= 85
          ? chalk.green('pass')
          : project.score >= 65
            ? chalk.yellow('watch')
            : chalk.red('risk');
      console.log(
        `  ${project.relativePath}  ${chalk.gray(`${project.runtime}/${project.framework}`)}  ${marker} ${project.score}/100`
      );
    }
  }

  if (report.dependencyGraph.status === 'generated') {
    console.log(chalk.bold('\nDependency Graph'));
    console.log(chalk.gray(`  edges: ${report.dependencyGraph.edges.length}`));
    if (report.dependencyGraph.topImpactedProjects.length > 0) {
      console.log(chalk.gray('  Top impacted projects:'));
      for (const item of report.dependencyGraph.topImpactedProjects.slice(0, 3)) {
        console.log(
          `    ${item.project} (${item.directDependents} dependents, ${item.directDependencies} dependencies)`
        );
      }
    }
  }

  if (report.findings.length > 0) {
    console.log(chalk.bold('\nTop Findings'));
    for (const item of report.findings.slice(0, 8)) {
      const color =
        item.severity === 'fail' ? chalk.red : item.severity === 'warn' ? chalk.yellow : chalk.gray;
      console.log(`  ${color(item.severity.toUpperCase())} ${item.target}: ${item.title}`);
      console.log(chalk.gray(`     ${item.remediation}`));
    }
  }

  console.log(chalk.bold('\nNext Actions'));
  for (const action of report.nextActions.slice(0, 5)) {
    console.log(chalk.gray(`  - ${action}`));
  }
  console.log();
}
