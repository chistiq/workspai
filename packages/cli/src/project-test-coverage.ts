import { createHash } from 'node:crypto';
import path from 'node:path';

import { execa } from 'execa';
import fsExtra from 'fs-extra';

import {
  writeWorkspaceArtifactJson,
  writeWorkspaceArtifactJsonSet,
} from './utils/artifact-path-compat.js';
import { findWorkspaceRootUp } from './utils/workspace-root.js';
import { isPythonVirtualEnvironmentDirectory } from './utils/workspace-scan-policy.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './contracts/workspace-intelligence-runtime-registry.js';

export const PROJECT_TEST_COVERAGE_SCHEMA =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectTestCoverage.schemaVersion;
export const PROJECT_TEST_COVERAGE_ARTIFACT = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectTestCoverage;

export type ProjectCoverageRuntime =
  | 'node'
  | 'bun'
  | 'deno'
  | 'python'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'rust'
  | 'php'
  | 'ruby'
  | 'elixir'
  | 'clojure'
  | 'scala'
  | 'kotlin'
  | 'c'
  | 'cpp'
  | 'unknown';

export type ProjectCoverageMetricName = 'lines' | 'branches' | 'functions' | 'statements';

export interface ProjectCoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  percent: number | null;
}

export interface ProjectCoverageFile {
  path: string;
  metrics: Partial<Record<ProjectCoverageMetricName, ProjectCoverageMetric>>;
}

export interface ProjectCoverageInvocation {
  cwd: string;
  executable: string;
  args: string[];
}

export interface ProjectCoverageCapability {
  runtime: ProjectCoverageRuntime;
  runner: string | null;
  status: 'available' | 'requires-setup' | 'unsupported';
  existingEvidence: Array<{ path: string; sha256: string }>;
  invocations: ProjectCoverageInvocation[];
  prerequisites: string[];
}

export interface ProjectTestCoverageEvidence {
  schemaVersion: typeof PROJECT_TEST_COVERAGE_SCHEMA;
  generatedAt: string;
  status: 'passed' | 'below-target' | 'unavailable' | 'failed';
  project: {
    id: string;
    name: string;
    path: string;
    workspacePath: string | null;
  };
  runtime: ProjectCoverageRuntime;
  runner: string | null;
  target: {
    metric: ProjectCoverageMetricName;
    percent: number;
  };
  metrics: Partial<Record<ProjectCoverageMetricName, ProjectCoverageMetric>>;
  files: ProjectCoverageFile[];
  lowCoverageFiles: Array<{
    path: string;
    percent: number | null;
    uncovered: number;
  }>;
  source: {
    format:
      | 'istanbul-json'
      | 'coverage-py-json'
      | 'lcov'
      | 'go-coverprofile'
      | 'jacoco-xml'
      | 'cobertura-xml'
      | 'clover-xml'
      | 'scoverage-xml'
      | 'simplecov-json'
      | 'llvm-cov-json'
      | 'unknown';
    path: string | null;
    sha256: string | null;
  };
  execution: {
    requested: boolean;
    invocations: ProjectCoverageInvocation[];
    exitCodes: number[];
    durationMs: number;
  };
  diagnostics: string[];
  artifactPaths: {
    project: string;
    workspaceLatest: string | null;
    workspaceProject: string | null;
  };
}

type CoverageParseResult = Pick<ProjectTestCoverageEvidence, 'metrics' | 'files' | 'source'>;

const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'deps.edn',
  'project.clj',
  'build.sbt',
  'CMakeLists.txt',
  'meson.build',
  'deno.json',
  'deno.jsonc',
];

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function metric(total: unknown, covered: unknown, skipped: unknown = 0): ProjectCoverageMetric {
  const normalizedTotal = finiteNumber(total);
  const normalizedCovered = Math.min(finiteNumber(covered), normalizedTotal);
  const normalizedSkipped = finiteNumber(skipped);
  return {
    total: normalizedTotal,
    covered: normalizedCovered,
    skipped: normalizedSkipped,
    percent:
      normalizedTotal > 0 ? Math.round((normalizedCovered / normalizedTotal) * 10_000) / 100 : null,
  };
}

function metricFromIstanbul(value: unknown): ProjectCoverageMetric | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return metric(record.total, record.covered, record.skipped);
}

function normalizeRelative(projectPath: string, filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
  const relative = path.relative(projectPath, absolute);
  return relative && !relative.startsWith('..') ? relative.split(path.sep).join('/') : filePath;
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await fsExtra.readFile(filePath))
    .digest('hex');
}

async function findProjectRoot(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  while (true) {
    const hasProjectMetadata =
      (await fsExtra.pathExists(path.join(current, '.workspai', 'project.json'))) ||
      (await fsExtra.pathExists(path.join(current, '.rapidkit', 'project.json')));
    if (
      hasProjectMetadata ||
      (
        await Promise.all(
          PROJECT_MARKERS.map((candidate) => fsExtra.pathExists(path.join(current, candidate)))
        )
      ).some(Boolean)
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

async function detectRuntime(projectPath: string): Promise<ProjectCoverageRuntime> {
  if (await fsExtra.pathExists(path.join(projectPath, 'deno.json'))) return 'deno';
  if (await fsExtra.pathExists(path.join(projectPath, 'deno.jsonc'))) return 'deno';
  if (await fsExtra.pathExists(path.join(projectPath, 'bun.lock'))) return 'bun';
  if (await fsExtra.pathExists(path.join(projectPath, 'bun.lockb'))) return 'bun';
  if (await fsExtra.pathExists(path.join(projectPath, 'package.json'))) return 'node';
  if (
    (await fsExtra.pathExists(path.join(projectPath, 'pyproject.toml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'requirements.txt')))
  )
    return 'python';
  if (await fsExtra.pathExists(path.join(projectPath, 'go.mod'))) return 'go';
  const hasJvmBuild =
    (await fsExtra.pathExists(path.join(projectPath, 'pom.xml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'build.gradle'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'build.gradle.kts')));
  if (
    hasJvmBuild &&
    (
      await findFiles(
        projectPath,
        (name) =>
          name.endsWith('.kt') ||
          (name.endsWith('.kts') && name !== 'build.gradle.kts' && name !== 'settings.gradle.kts'),
        4
      )
    ).length > 0
  )
    return 'kotlin';
  if (hasJvmBuild) return 'java';
  if (await fsExtra.pathExists(path.join(projectPath, 'Cargo.toml'))) return 'rust';
  if (await fsExtra.pathExists(path.join(projectPath, 'composer.json'))) return 'php';
  if (await fsExtra.pathExists(path.join(projectPath, 'Gemfile'))) return 'ruby';
  if (await fsExtra.pathExists(path.join(projectPath, 'mix.exs'))) return 'elixir';
  if (
    (await fsExtra.pathExists(path.join(projectPath, 'deps.edn'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'project.clj')))
  )
    return 'clojure';
  if (await fsExtra.pathExists(path.join(projectPath, 'build.sbt'))) return 'scala';
  if (await fsExtra.pathExists(path.join(projectPath, 'CMakeLists.txt'))) {
    const sources = await findFiles(projectPath, (name) => /\.(c|cc|cpp|cxx)$/.test(name), 3);
    return sources.some((file) => /\.(cc|cpp|cxx)$/.test(file)) ? 'cpp' : 'c';
  }
  if ((await findFiles(projectPath, (name) => /\.(sln|csproj)$/.test(name), 2)).length > 0)
    return 'dotnet';
  return 'unknown';
}

async function findFiles(
  root: string,
  predicate: (name: string, relativePath: string) => boolean,
  maxDepth = 5
): Promise<string[]> {
  const result: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const ignored = new Set([
    '.git',
    '.workspai',
    '.rapidkit',
    'node_modules',
    '.venv',
    'vendor',
    'deps',
  ]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const entries = await fsExtra.readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (ignored.has(entry.name) || isPythonVirtualEnvironmentDirectory(entry.name)) continue;
      const absolute = path.join(current.dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isFile() && predicate(entry.name, relative)) result.push(absolute);
      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: absolute, depth: current.depth + 1 });
      }
    }
  }
  return result;
}

async function parseIstanbul(projectPath: string, filePath: string): Promise<CoverageParseResult> {
  const payload = (await fsExtra.readJson(filePath)) as Record<string, unknown>;
  const total = (payload.total ?? payload) as Record<string, unknown>;
  const metrics: ProjectTestCoverageEvidence['metrics'] = {};
  for (const name of ['lines', 'branches', 'functions', 'statements'] as const) {
    const value = metricFromIstanbul(total[name]);
    if (value) metrics[name] = value;
  }
  const files: ProjectCoverageFile[] = [];
  for (const [file, raw] of Object.entries(payload)) {
    if (file === 'total' || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const fileMetrics: ProjectCoverageFile['metrics'] = {};
    for (const name of ['lines', 'branches', 'functions', 'statements'] as const) {
      const value = metricFromIstanbul(record[name]);
      if (value) fileMetrics[name] = value;
    }
    files.push({ path: normalizeRelative(projectPath, file), metrics: fileMetrics });
  }
  return {
    metrics,
    files,
    source: { format: 'istanbul-json', path: filePath, sha256: await sha256File(filePath) },
  };
}

async function parseCoveragePy(
  projectPath: string,
  filePath: string
): Promise<CoverageParseResult> {
  const payload = (await fsExtra.readJson(filePath)) as Record<string, unknown>;
  const totals = (payload.totals ?? {}) as Record<string, unknown>;
  const metrics: ProjectTestCoverageEvidence['metrics'] = {
    lines: metric(totals.num_statements, totals.covered_lines),
  };
  if (finiteNumber(totals.num_branches) > 0) {
    metrics.branches = metric(totals.num_branches, totals.covered_branches);
  }
  const files: ProjectCoverageFile[] = [];
  for (const [file, raw] of Object.entries((payload.files ?? {}) as Record<string, unknown>)) {
    const summary = ((raw as Record<string, unknown>)?.summary ?? {}) as Record<string, unknown>;
    files.push({
      path: normalizeRelative(projectPath, file),
      metrics: {
        lines: metric(summary.num_statements, summary.covered_lines),
        ...(finiteNumber(summary.num_branches) > 0
          ? { branches: metric(summary.num_branches, summary.covered_branches) }
          : {}),
      },
    });
  }
  return {
    metrics,
    files,
    source: { format: 'coverage-py-json', path: filePath, sha256: await sha256File(filePath) },
  };
}

function llvmMetric(value: unknown): ProjectCoverageMetric | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const total = finiteNumber(record.count);
  const covered = finiteNumber(record.covered);
  return total > 0 ? metric(total, covered) : undefined;
}

async function parseLlvmCov(projectPath: string, filePath: string): Promise<CoverageParseResult> {
  const payload = (await fsExtra.readJson(filePath)) as Record<string, unknown>;
  const first = Array.isArray(payload.data)
    ? ((payload.data[0] ?? {}) as Record<string, unknown>)
    : payload;
  const totals = (first.totals ?? {}) as Record<string, unknown>;
  const metrics: ProjectTestCoverageEvidence['metrics'] = {};
  metrics.lines = llvmMetric(totals.lines);
  metrics.functions = llvmMetric(totals.functions);
  metrics.branches = llvmMetric(totals.branches);
  metrics.statements = llvmMetric(totals.regions);
  const files: ProjectCoverageFile[] = [];
  for (const raw of Array.isArray(first.files) ? first.files : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const file = raw as Record<string, unknown>;
    const summary = (file.summary ?? {}) as Record<string, unknown>;
    files.push({
      path: normalizeRelative(projectPath, String(file.filename ?? 'unknown')),
      metrics: {
        lines: llvmMetric(summary.lines),
        functions: llvmMetric(summary.functions),
        branches: llvmMetric(summary.branches),
        statements: llvmMetric(summary.regions),
      },
    });
  }
  return {
    metrics,
    files,
    source: { format: 'llvm-cov-json', path: filePath, sha256: await sha256File(filePath) },
  };
}

async function parseLcov(projectPath: string, filePath: string): Promise<CoverageParseResult> {
  const text = await fsExtra.readFile(filePath, 'utf8');
  const files: ProjectCoverageFile[] = [];
  let current = '';
  let linesTotal = 0;
  let linesCovered = 0;
  let functionsTotal = 0;
  let functionsCovered = 0;
  let branchesTotal = 0;
  let branchesCovered = 0;
  const flush = (state: {
    lineTotal: number;
    lineCovered: number;
    functionTotal: number;
    functionCovered: number;
    branchTotal: number;
    branchCovered: number;
  }): void => {
    if (!current) return;
    files.push({
      path: normalizeRelative(projectPath, current),
      metrics: {
        lines: metric(state.lineTotal, state.lineCovered),
        functions: metric(state.functionTotal, state.functionCovered),
        branches: metric(state.branchTotal, state.branchCovered),
      },
    });
    linesTotal += state.lineTotal;
    linesCovered += state.lineCovered;
    functionsTotal += state.functionTotal;
    functionsCovered += state.functionCovered;
    branchesTotal += state.branchTotal;
    branchesCovered += state.branchCovered;
  };
  let state = {
    lineTotal: 0,
    lineCovered: 0,
    functionTotal: 0,
    functionCovered: 0,
    branchTotal: 0,
    branchCovered: 0,
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) current = line.slice(3);
    else if (line.startsWith('LF:')) state.lineTotal = finiteNumber(line.slice(3));
    else if (line.startsWith('LH:')) state.lineCovered = finiteNumber(line.slice(3));
    else if (line.startsWith('FNF:')) state.functionTotal = finiteNumber(line.slice(4));
    else if (line.startsWith('FNH:')) state.functionCovered = finiteNumber(line.slice(4));
    else if (line.startsWith('BRF:')) state.branchTotal = finiteNumber(line.slice(4));
    else if (line.startsWith('BRH:')) state.branchCovered = finiteNumber(line.slice(4));
    else if (line === 'end_of_record') {
      flush(state);
      current = '';
      state = {
        lineTotal: 0,
        lineCovered: 0,
        functionTotal: 0,
        functionCovered: 0,
        branchTotal: 0,
        branchCovered: 0,
      };
    }
  }
  return {
    metrics: {
      lines: metric(linesTotal, linesCovered),
      functions: metric(functionsTotal, functionsCovered),
      branches: metric(branchesTotal, branchesCovered),
    },
    files,
    source: { format: 'lcov', path: filePath, sha256: await sha256File(filePath) },
  };
}

async function parseGoCoverprofile(
  projectPath: string,
  filePath: string
): Promise<CoverageParseResult> {
  const text = await fsExtra.readFile(filePath, 'utf8');
  const byFile = new Map<string, { total: number; covered: number }>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const match = /^(.+?):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/.exec(line.trim());
    if (!match) continue;
    const entry = byFile.get(match[1]) ?? { total: 0, covered: 0 };
    const statements = finiteNumber(match[2]);
    entry.total += statements;
    if (finiteNumber(match[3]) > 0) entry.covered += statements;
    byFile.set(match[1], entry);
  }
  const files = [...byFile.entries()].map(([file, value]) => ({
    path: normalizeRelative(projectPath, file),
    metrics: { statements: metric(value.total, value.covered) },
  }));
  const total = [...byFile.values()].reduce(
    (sum, value) => ({ total: sum.total + value.total, covered: sum.covered + value.covered }),
    { total: 0, covered: 0 }
  );
  return {
    metrics: { statements: metric(total.total, total.covered) },
    files,
    source: {
      format: 'go-coverprofile',
      path: filePath,
      sha256: await sha256File(filePath),
    },
  };
}

function xmlCounter(text: string, type: string): ProjectCoverageMetric | undefined {
  const matches = [
    ...text.matchAll(
      new RegExp(
        `<counter\\s+type=["']${type}["']\\s+missed=["'](\\d+)["']\\s+covered=["'](\\d+)["']\\s*\\/?\\s*>`,
        'gi'
      )
    ),
  ];
  const match = matches.at(-1);
  return match ? metric(Number(match[1]) + Number(match[2]), match[2]) : undefined;
}

async function parseXmlCoverage(
  filePath: string,
  format: 'jacoco-xml' | 'cobertura-xml' | 'clover-xml'
): Promise<CoverageParseResult> {
  const text = await fsExtra.readFile(filePath, 'utf8');
  const metrics: ProjectTestCoverageEvidence['metrics'] = {};
  if (format === 'cobertura-xml') {
    const root = /<coverage\b([^>]*)>/i.exec(text)?.[1] ?? '';
    const lineRate = /\bline-rate=["']([\d.]+)["']/i.exec(root)?.[1];
    const branchRate = /\bbranch-rate=["']([\d.]+)["']/i.exec(root)?.[1];
    if (lineRate) metrics.lines = metric(10_000, Math.round(Number(lineRate) * 10_000));
    if (branchRate) metrics.branches = metric(10_000, Math.round(Number(branchRate) * 10_000));
  }
  if (format === 'clover-xml') {
    const matches = [...text.matchAll(/<metrics\b([^>]*)\/?>/gi)];
    const attributes = matches.at(-1)?.[1] ?? '';
    const attribute = (name: string): number =>
      finiteNumber(new RegExp(`\\b${name}=["'](\\d+)["']`, 'i').exec(attributes)?.[1]);
    const statements = attribute('statements');
    const methods = attribute('methods');
    const conditionals = attribute('conditionals');
    if (statements > 0) metrics.statements = metric(statements, attribute('coveredstatements'));
    if (methods > 0) metrics.functions = metric(methods, attribute('coveredmethods'));
    if (conditionals > 0) metrics.branches = metric(conditionals, attribute('coveredconditionals'));
  }
  metrics.lines ??= xmlCounter(text, 'LINE');
  metrics.branches ??= xmlCounter(text, 'BRANCH');
  metrics.functions ??= xmlCounter(text, format === 'jacoco-xml' ? 'METHOD' : 'METHOD');
  metrics.statements ??= xmlCounter(text, 'INSTRUCTION');
  return {
    metrics,
    files: [],
    source: { format, path: filePath, sha256: await sha256File(filePath) },
  };
}

async function parseScoverage(filePath: string): Promise<CoverageParseResult> {
  const text = await fsExtra.readFile(filePath, 'utf8');
  const root = /<scoverage\b([^>]*)>/i.exec(text)?.[1] ?? '';
  const attribute = (name: string): number =>
    finiteNumber(new RegExp(`\\b${name}=["']([\\d.]+)["']`, 'i').exec(root)?.[1]);
  const statementTotal = attribute('statement-count');
  const statementCovered = attribute('statements-invoked');
  const branchTotal = attribute('branch-count');
  const branchCovered = attribute('branches-invoked');
  const statementRate = attribute('statement-rate');
  const branchRate = attribute('branch-rate');
  const metrics: ProjectTestCoverageEvidence['metrics'] = {};
  if (statementTotal > 0) {
    metrics.statements = metric(statementTotal, statementCovered);
  } else if (statementRate > 0) {
    metrics.statements = metric(10_000, Math.round(statementRate * 100));
  }
  if (branchTotal > 0) {
    metrics.branches = metric(branchTotal, branchCovered);
  } else if (branchRate > 0) {
    metrics.branches = metric(10_000, Math.round(branchRate * 100));
  }
  return {
    metrics,
    files: [],
    source: { format: 'scoverage-xml', path: filePath, sha256: await sha256File(filePath) },
  };
}

async function parseSimpleCov(projectPath: string, filePath: string): Promise<CoverageParseResult> {
  const payload = (await fsExtra.readJson(filePath)) as Record<string, unknown>;
  const byFile = new Map<string, number[]>();
  for (const suite of Object.values(payload)) {
    const coverage = (suite as Record<string, unknown>)?.coverage;
    if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) continue;
    for (const [file, values] of Object.entries(coverage as Record<string, unknown>)) {
      if (!Array.isArray(values)) continue;
      const existing = byFile.get(file) ?? [];
      values.forEach((value, index) => {
        if (typeof value === 'number') existing[index] = Math.max(existing[index] ?? 0, value);
      });
      byFile.set(file, existing);
    }
  }
  const files = [...byFile.entries()].map(([file, values]) => {
    const executable = values.filter((value) => typeof value === 'number');
    return {
      path: normalizeRelative(projectPath, file),
      metrics: { lines: metric(executable.length, executable.filter((value) => value > 0).length) },
    };
  });
  const total = files.reduce(
    (sum, file) => {
      const value = file.metrics.lines;
      return {
        total: sum.total + (value?.total ?? 0),
        covered: sum.covered + (value?.covered ?? 0),
      };
    },
    { total: 0, covered: 0 }
  );
  return {
    metrics: { lines: metric(total.total, total.covered) },
    files,
    source: { format: 'simplecov-json', path: filePath, sha256: await sha256File(filePath) },
  };
}

async function discoverCoverage(
  projectPath: string,
  options: { recursive?: boolean } = {}
): Promise<CoverageParseResult | null> {
  const exactCandidates: Array<{
    relativePath: string;
    parser: (filePath: string) => Promise<CoverageParseResult>;
  }> = [
    {
      relativePath: 'coverage/coverage-summary.json',
      parser: (file) => parseIstanbul(projectPath, file),
    },
    {
      relativePath: 'coverage.json',
      parser: async (file) => {
        const payload = (await fsExtra.readJson(file)) as Record<string, unknown>;
        return Array.isArray(payload.data)
          ? parseLlvmCov(projectPath, file)
          : parseCoveragePy(projectPath, file);
      },
    },
    { relativePath: 'coverage/lcov.info', parser: (file) => parseLcov(projectPath, file) },
    { relativePath: 'cover/lcov.info', parser: (file) => parseLcov(projectPath, file) },
    { relativePath: 'lcov.info', parser: (file) => parseLcov(projectPath, file) },
    { relativePath: 'coverage.out', parser: (file) => parseGoCoverprofile(projectPath, file) },
    {
      relativePath: 'target/site/jacoco/jacoco.xml',
      parser: (file) => parseXmlCoverage(file, 'jacoco-xml'),
    },
    {
      relativePath: 'build/reports/jacoco/test/jacocoTestReport.xml',
      parser: (file) => parseXmlCoverage(file, 'jacoco-xml'),
    },
    {
      relativePath: 'coverage.xml',
      parser: (file) => parseXmlCoverage(file, 'clover-xml'),
    },
    {
      relativePath: '.resultset.json',
      parser: (file) => parseSimpleCov(projectPath, file),
    },
  ];
  for (const candidate of exactCandidates) {
    const filePath = path.join(projectPath, candidate.relativePath);
    if (await fsExtra.pathExists(filePath)) return candidate.parser(filePath);
  }
  if (options.recursive === false) return null;
  const recursive = await findFiles(
    projectPath,
    (name, relative) =>
      name === 'coverage.cobertura.xml' ||
      name === 'jacoco.xml' ||
      name === 'clover.xml' ||
      name === 'scoverage.xml' ||
      relative.endsWith('/coverage-summary.json'),
    7
  );
  const filePath = recursive.sort()[0];
  if (!filePath) return null;
  if (filePath.endsWith('coverage-summary.json')) return parseIstanbul(projectPath, filePath);
  if (filePath.endsWith('jacoco.xml')) return parseXmlCoverage(filePath, 'jacoco-xml');
  if (filePath.endsWith('coverage.cobertura.xml'))
    return parseXmlCoverage(filePath, 'cobertura-xml');
  if (filePath.endsWith('scoverage.xml')) return parseScoverage(filePath);
  return parseXmlCoverage(filePath, 'clover-xml');
}

async function packageJson(projectPath: string): Promise<Record<string, unknown> | null> {
  return fsExtra.readJson(path.join(projectPath, 'package.json')).catch(() => null);
}

async function coverageInvocations(
  projectPath: string,
  runtime: ProjectCoverageRuntime
): Promise<{
  runner: string | null;
  invocations: ProjectCoverageInvocation[];
  diagnostics: string[];
}> {
  const invocation = (executable: string, args: string[]): ProjectCoverageInvocation => ({
    cwd: projectPath,
    executable,
    args,
  });
  if (runtime === 'node' || runtime === 'bun') {
    const manifest = await packageJson(projectPath);
    const scripts = (manifest?.scripts ?? {}) as Record<string, unknown>;
    const preferred = ['test:coverage', 'test:cov', 'coverage'].find(
      (name) => typeof scripts[name] === 'string'
    );
    const manager =
      runtime === 'bun'
        ? 'bun'
        : (await fsExtra.pathExists(path.join(projectPath, 'pnpm-lock.yaml')))
          ? 'pnpm'
          : (await fsExtra.pathExists(path.join(projectPath, 'yarn.lock')))
            ? 'yarn'
            : 'npm';
    if (preferred) {
      return {
        runner: String(scripts[preferred]).split(/\s+/)[0] || manager,
        invocations: [invocation(manager, manager === 'yarn' ? [preferred] : ['run', preferred])],
        diagnostics: [],
      };
    }
    if (typeof scripts.test === 'string') {
      const args =
        manager === 'yarn'
          ? ['test', '--coverage']
          : manager === 'bun'
            ? ['test', '--coverage', '--coverage-reporter=lcov']
            : ['test', '--', '--coverage'];
      return {
        runner: String(scripts.test).split(/\s+/)[0] || manager,
        invocations: [invocation(manager, args)],
        diagnostics: [],
      };
    }
    return {
      runner: null,
      invocations: [],
      diagnostics: ['No project-owned test or coverage script was detected.'],
    };
  }
  if (runtime === 'deno')
    return {
      runner: 'deno',
      invocations: [
        invocation('deno', ['test', '--coverage=coverage']),
        invocation('deno', ['coverage', '--lcov', '--output=coverage/lcov.info', 'coverage']),
      ],
      diagnostics: [],
    };
  if (runtime === 'python')
    return {
      runner: 'pytest-cov',
      invocations: [
        invocation(
          (await fsExtra.pathExists(
            path.join(
              projectPath,
              '.venv',
              process.platform === 'win32' ? 'Scripts' : 'bin',
              process.platform === 'win32' ? 'python.exe' : 'python'
            )
          ))
            ? path.join(
                '.venv',
                process.platform === 'win32' ? 'Scripts' : 'bin',
                process.platform === 'win32' ? 'python.exe' : 'python'
              )
            : process.platform === 'win32'
              ? 'python'
              : 'python3',
          ['-m', 'pytest', '--cov=.', '--cov-report=json:coverage.json']
        ),
      ],
      diagnostics: [],
    };
  if (runtime === 'go')
    return {
      runner: 'go test',
      invocations: [invocation('go', ['test', './...', '-coverprofile=coverage.out'])],
      diagnostics: [],
    };
  if (runtime === 'java') {
    const gradleUnix = await fsExtra.pathExists(path.join(projectPath, 'gradlew'));
    const gradleWindows = await fsExtra.pathExists(path.join(projectPath, 'gradlew.bat'));
    const gradle = gradleUnix || gradleWindows;
    const mavenUnix = await fsExtra.pathExists(path.join(projectPath, 'mvnw'));
    const mavenWindows = await fsExtra.pathExists(path.join(projectPath, 'mvnw.cmd'));
    const executable = gradle
      ? process.platform === 'win32' && gradleWindows
        ? '.\\gradlew.bat'
        : './gradlew'
      : (await fsExtra.pathExists(path.join(projectPath, 'pom.xml')))
        ? process.platform === 'win32' && mavenWindows
          ? '.\\mvnw.cmd'
          : mavenUnix
            ? './mvnw'
            : 'mvn'
        : 'gradle';
    return {
      runner: gradle ? 'jacoco/gradle' : 'jacoco/maven',
      invocations: [
        invocation(executable, gradle ? ['test', 'jacocoTestReport'] : ['test', 'jacoco:report']),
      ],
      diagnostics: [],
    };
  }
  if (runtime === 'dotnet')
    return {
      runner: 'dotnet coverlet',
      invocations: [invocation('dotnet', ['test', '--collect:XPlat Code Coverage'])],
      diagnostics: [],
    };
  if (runtime === 'rust')
    return {
      runner: 'cargo llvm-cov',
      invocations: [invocation('cargo', ['llvm-cov', '--json', '--output-path', 'coverage.json'])],
      diagnostics: ['cargo-llvm-cov must be available in the project toolchain.'],
    };
  if (runtime === 'php')
    return {
      runner: 'phpunit',
      invocations: [
        invocation(
          process.platform === 'win32' ? 'vendor\\bin\\phpunit.bat' : 'vendor/bin/phpunit',
          ['--coverage-clover', 'coverage.xml']
        ),
      ],
      diagnostics: [],
    };
  if (runtime === 'ruby')
    return {
      runner: 'simplecov',
      invocations: [invocation('bundle', ['exec', 'rspec'])],
      diagnostics: ['The test suite must enable SimpleCov to emit .resultset.json.'],
    };
  if (runtime === 'elixir')
    return {
      runner: 'mix cover',
      invocations: [invocation('mix', ['test', '--cover'])],
      diagnostics: [
        'Configure ExCoveralls for JSON or LCOV interchange when machine-readable coverage is required.',
      ],
    };
  if (runtime === 'clojure')
    return {
      runner: 'cloverage',
      invocations: [invocation('clojure', ['-M:coverage'])],
      diagnostics: ['The project must declare a coverage alias such as cloverage.'],
    };
  if (runtime === 'scala')
    return {
      runner: 'sbt-scoverage',
      invocations: [invocation('sbt', ['clean', 'coverage', 'test', 'coverageReport'])],
      diagnostics: ['The project must declare the scoverage plugin.'],
    };
  if (runtime === 'kotlin')
    return {
      runner: 'jacoco/gradle',
      invocations: [
        invocation(
          (await fsExtra.pathExists(
            path.join(projectPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
          ))
            ? process.platform === 'win32'
              ? '.\\gradlew.bat'
              : './gradlew'
            : 'gradle',
          ['test', 'jacocoTestReport']
        ),
      ],
      diagnostics: ['The project must declare the JaCoCo Gradle plugin.'],
    };
  if (runtime === 'c' || runtime === 'cpp')
    return {
      runner: 'CTest/LLVM coverage',
      invocations: [invocation('ctest', ['--test-dir', 'build', '--output-on-failure'])],
      diagnostics: [
        'The native build must be instrumented for coverage and export LCOV, Cobertura, or LLVM JSON evidence.',
      ],
    };
  return { runner: null, invocations: [], diagnostics: ['Project runtime could not be detected.'] };
}

/** Read-only capability probe used by governed goal planning. It never executes tests or writes evidence. */
export async function inspectProjectTestCoverageCapability(
  projectPathInput: string,
  runtimeHint?: ProjectCoverageRuntime
): Promise<ProjectCoverageCapability> {
  const projectPath = await findProjectRoot(projectPathInput);
  const runtime = runtimeHint ?? (await detectRuntime(projectPath));
  const execution = await coverageInvocations(projectPath, runtime);
  const parsed = await discoverCoverage(projectPath, { recursive: false }).catch(() => null);
  const existingEvidence =
    parsed?.source.path && parsed.source.sha256
      ? [
          {
            path: path.relative(projectPath, parsed.source.path).split(path.sep).join('/'),
            sha256: parsed.source.sha256,
          },
        ]
      : [];
  const prerequisites = [...execution.diagnostics];
  const status = parsed
    ? 'available'
    : execution.invocations.length === 0 || runtime === 'unknown'
      ? 'unsupported'
      : prerequisites.length > 0
        ? 'requires-setup'
        : 'available';
  return {
    runtime,
    runner: execution.runner,
    status,
    existingEvidence,
    invocations: execution.invocations,
    prerequisites,
  };
}

function stableProjectKey(workspacePath: string | null, projectPath: string): string {
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
  return `${readable}--${digest}`;
}

function coverageTargetMetric(
  metrics: ProjectTestCoverageEvidence['metrics']
): ProjectCoverageMetricName {
  if (metrics.lines) return 'lines';
  if (metrics.statements) return 'statements';
  if (metrics.branches) return 'branches';
  return 'functions';
}

export async function collectProjectTestCoverage(
  options: {
    projectPath?: string;
    target?: number;
    run?: boolean;
    runtime?: ProjectCoverageRuntime;
  } = {}
): Promise<ProjectTestCoverageEvidence> {
  const projectPath = await findProjectRoot(options.projectPath ?? process.cwd());
  const workspacePath = findWorkspaceRootUp(projectPath);
  const runtime = options.runtime ?? (await detectRuntime(projectPath));
  const targetPercent = Math.max(0, Math.min(100, Math.round(options.target ?? 80)));
  const executionPlan = await coverageInvocations(projectPath, runtime);
  const exitCodes: number[] = [];
  const startedAt = Date.now();
  if (options.run) {
    for (const item of executionPlan.invocations) {
      const result = await execa(item.executable, item.args, {
        cwd: item.cwd,
        reject: false,
        timeout: 10 * 60_000,
      }).catch(() => ({ exitCode: 1 }));
      exitCodes.push(Number(result.exitCode ?? 1));
      if (Number(result.exitCode ?? 1) !== 0) break;
    }
  }
  const parsed = await discoverCoverage(projectPath).catch(() => null);
  const metricName = parsed ? coverageTargetMetric(parsed.metrics) : 'lines';
  const percent = parsed?.metrics[metricName]?.percent ?? null;
  const status =
    options.run && exitCodes.some((code) => code !== 0)
      ? 'failed'
      : percent === null
        ? 'unavailable'
        : percent >= targetPercent
          ? 'passed'
          : 'below-target';
  const projectKey = stableProjectKey(workspacePath, projectPath);
  const projectArtifactPath = path.join(projectPath, PROJECT_TEST_COVERAGE_ARTIFACT);
  const workspaceProjectRelativePath = workspacePath
    ? `.workspai/reports/projects/${projectKey}/project-test-coverage-last-run.json`
    : null;
  const evidence: ProjectTestCoverageEvidence = {
    schemaVersion: PROJECT_TEST_COVERAGE_SCHEMA,
    generatedAt: new Date().toISOString(),
    status,
    project: {
      id: projectKey,
      name: path.basename(projectPath),
      path: projectPath,
      workspacePath,
    },
    runtime,
    runner: executionPlan.runner,
    target: { metric: metricName, percent: targetPercent },
    metrics: parsed?.metrics ?? {},
    files: parsed?.files ?? [],
    lowCoverageFiles: (parsed?.files ?? [])
      .map((file) => {
        const value = file.metrics[metricName] ?? file.metrics.lines ?? file.metrics.statements;
        return {
          path: file.path,
          percent: value?.percent ?? null,
          uncovered: Math.max(0, (value?.total ?? 0) - (value?.covered ?? 0)),
        };
      })
      .filter((file) => file.percent === null || file.percent < targetPercent)
      .sort(
        (left, right) => right.uncovered - left.uncovered || left.path.localeCompare(right.path)
      ),
    source: parsed?.source ?? { format: 'unknown', path: null, sha256: null },
    execution: {
      requested: options.run === true,
      invocations: executionPlan.invocations,
      exitCodes,
      durationMs: Date.now() - startedAt,
    },
    diagnostics: [
      ...executionPlan.diagnostics,
      ...(parsed ? [] : ['No supported machine-readable coverage artifact was found.']),
    ],
    artifactPaths: {
      project: projectArtifactPath,
      workspaceLatest: workspacePath
        ? path.join(workspacePath, PROJECT_TEST_COVERAGE_ARTIFACT)
        : null,
      workspaceProject:
        workspacePath && workspaceProjectRelativePath
          ? path.join(workspacePath, workspaceProjectRelativePath)
          : null,
    },
  };
  if (workspacePath && workspaceProjectRelativePath) {
    await writeWorkspaceArtifactJsonSet(workspacePath, PROJECT_TEST_COVERAGE_ARTIFACT, [
      { relativePath: PROJECT_TEST_COVERAGE_ARTIFACT, payload: evidence },
      { relativePath: workspaceProjectRelativePath, payload: evidence },
    ]);
  }
  await writeWorkspaceArtifactJson(projectPath, PROJECT_TEST_COVERAGE_ARTIFACT, evidence);
  return evidence;
}
