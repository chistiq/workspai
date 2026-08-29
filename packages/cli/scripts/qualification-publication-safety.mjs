import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';

const RESERVED_PROJECT_NAMES = new Set([
  'build',
  'dist',
  'lib',
  'node',
  'npm',
  'pip',
  'poetry',
  'python',
  'rapidkit',
  'src',
  'test',
  'tests',
]);

const FORBIDDEN_REPORT_KEYS = new Set([
  'argv',
  'cwd',
  'error',
  'projectPath',
  'referenceRoot',
  'runRoot',
  'stderr',
  'stderrExcerpt',
  'stdout',
  'stdoutExcerpt',
  'workspacePath',
]);

const ABSOLUTE_PATH_PATTERNS = [
  /(?:^|[\s"'])\/(?:home|Users|private\/var|var\/folders|tmp)\//u,
  /(?:^|[\s"'])[A-Za-z]:[\\/](?:Users|Documents and Settings|Windows|Temp)[\\/]/u,
  /(?:^|[\s"'])\\\\[^\\\s]+\\[^\\\s]+/u,
  /file:\/\//iu,
];

export function createQualificationCommandRecord({ id, result, parsed, startedAt }) {
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  const exitCode = result.status ?? (result.error ? 1 : 0);

  return {
    id,
    durationMs: Date.now() - startedAt,
    exitCode,
    timedOut: result.error?.code === 'ETIMEDOUT',
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    ...(parsed?.schemaVersion ? { schemaVersion: parsed.schemaVersion } : {}),
    ...(result.error?.code ? { processErrorCode: String(result.error.code) } : {}),
  };
}

export function isQualificationCommandAccepted({
  result,
  acceptedExitCodes,
  parsed,
  expectJson = true,
}) {
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const hasTerminalStatus = Number.isInteger(result.status);
  const processErrorCode =
    result.error && typeof result.error.code === 'string' ? result.error.code : null;
  const processStateAccepted = !result.error || (hasTerminalStatus && processErrorCode === 'EPERM');
  return (
    acceptedExitCodes.includes(exitCode) && (!expectJson || parsed !== null) && processStateAccepted
  );
}

export function qualificationCommandAllowsGovernedBlock(argv) {
  const command = argv
    .filter((part) => !String(part).startsWith('-'))
    .slice(0, 3)
    .join(' ');
  return (
    command.startsWith('doctor workspace') ||
    command.startsWith('doctor project') ||
    command === 'analyze' ||
    command === 'readiness' ||
    command.startsWith('workspace intelligence run') ||
    command.startsWith('workspace verify') ||
    command.startsWith('workspace why') ||
    command.startsWith('workspace remediation-plan')
  );
}

export function hasGovernedQualificationOutcome(value) {
  if (Array.isArray(value)) return value.some(hasGovernedQualificationOutcome);
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value)) {
    if (
      ['status', 'verdict', 'readiness', 'result'].includes(key) &&
      typeof entry === 'string' &&
      ['blocked', 'not-ready', 'not_ready', 'needs-attention', 'needs_attention'].includes(
        entry.toLowerCase()
      )
    ) {
      return true;
    }
    if (hasGovernedQualificationOutcome(entry)) return true;
  }
  return false;
}

export function selectQualificationProjectId({ graph, contract, model, importedRegistry }) {
  const graphProject = graph?.entities?.find((entity) => entity?.kind === 'project');
  return (
    [
      graphProject?.projectId,
      contract?.projects?.[0]?.slug,
      model?.projects?.[0]?.name,
      importedRegistry?.projects?.[0]?.name,
    ].find((value) => typeof value === 'string' && value.trim().length > 0) ?? null
  );
}

export function selectQualificationLifecycleProjectId({
  workspacePath,
  contract,
  model,
  importedRegistry,
  pathExists = existsSync,
}) {
  const isManagedPath = (candidate) => {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) return false;
    const resolved = path.resolve(workspacePath, candidate);
    const relative = path.relative(path.resolve(workspacePath), resolved);
    return (
      relative.length > 0 &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative) &&
      pathExists(resolved)
    );
  };
  const contractProject = contract?.projects?.find(
    (project) => !project?.externalPath && isManagedPath(project?.relativePath)
  );
  if (typeof contractProject?.slug === 'string' && contractProject.slug.trim()) {
    return contractProject.slug;
  }
  const registryProject = importedRegistry?.projects?.find((project) => {
    if (typeof project?.path !== 'string') return false;
    const resolved = path.resolve(project.path);
    const relative = path.relative(path.resolve(workspacePath), resolved);
    return (
      relative.length > 0 &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative) &&
      pathExists(resolved)
    );
  });
  if (typeof registryProject?.name === 'string' && registryProject.name.trim()) {
    return registryProject.name;
  }
  const modelProject = model?.projects?.find((project) => isManagedPath(project?.path));
  return typeof modelProject?.name === 'string' && modelProject.name.trim()
    ? modelProject.name
    : null;
}

export function qualificationPrimaryRuntime(project) {
  const runtime = typeof project?.runtime === 'string' ? project.runtime.trim().toLowerCase() : '';
  return runtime && runtime !== 'unknown' ? runtime : null;
}

export function repairAdaptersForQualificationBoundary(runtime, projectPath) {
  const normalized = typeof runtime === 'string' ? runtime.trim().toLowerCase() : '';
  const exists = (...names) => names.some((name) => existsSync(path.join(projectPath, name)));
  const rootFiles = (() => {
    try {
      return readdirSync(projectPath);
    } catch {
      return [];
    }
  })();
  if (normalized === 'node' && exists('package.json')) return ['node'];
  if (normalized === 'python' && exists('pyproject.toml', 'requirements.txt')) return ['python'];
  if (normalized === 'go' && exists('go.mod')) return ['go'];
  if (normalized === 'rust' && exists('Cargo.toml')) return ['rust'];
  if (normalized === 'php' && exists('composer.json')) return ['php-composer'];
  if (normalized === 'ruby' && exists('Gemfile')) return ['ruby-bundler'];
  if (normalized === 'elixir' && exists('mix.exs')) return ['elixir-mix'];
  if (normalized === 'deno' && exists('deno.json', 'deno.jsonc')) return ['deno'];
  if (
    normalized === 'dotnet' &&
    rootFiles.some((file) => /\.(?:cs|fs|vb)proj$|\.slnx?$/iu.test(file))
  )
    return ['dotnet'];
  if (['java', 'kotlin'].includes(normalized)) {
    return [
      ...(exists('pom.xml') ? ['jvm-maven'] : []),
      ...(exists('build.gradle', 'build.gradle.kts') ? ['jvm-gradle'] : []),
    ];
  }
  if (normalized === 'clojure' && exists('deps.edn', 'project.clj')) return ['clojure'];
  if (normalized === 'scala' && exists('build.sbt')) return ['scala-sbt'];
  return [];
}

/**
 * Convert an arbitrary repository identifier into a collision-resistant name
 * accepted by the public workspace/project naming contract. Repository names
 * may contain dots, uppercase letters, spaces, Unicode, or reserved package
 * names; qualification must never fail before adoption because of that source
 * naming difference.
 */
export function canonicalQualificationWorkspaceName(value) {
  const source = String(value).trim();
  const normalized = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^[^a-z]+/gu, '')
    .replace(/[-_]{2,}/gu, '-')
    .replace(/^[-_]+|[-_]+$/gu, '');
  const base =
    normalized.length >= 2 && !RESERVED_PROJECT_NAMES.has(normalized)
      ? normalized
      : `workspace-${normalized || 'repository'}`;
  const changed = base !== source;
  const truncated = base.length > 196;
  if (!changed && !truncated) return base;
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 10);
  return `${base.slice(0, 196).replace(/[-_]+$/gu, '')}-${digest}`;
}

export function assertQualificationReportIsPublicationSafe(report, forbiddenPaths = []) {
  const forbiddenVariants = forbiddenPaths.flatMap((candidate) =>
    candidate ? [...pathVariants(candidate)] : []
  );
  visit(report, '$', forbiddenVariants);
}

function visit(value, location, forbiddenVariants) {
  if (typeof value === 'string') {
    if (forbiddenVariants.some((candidate) => candidate && value.includes(candidate))) {
      throw new Error('Qualification report contains a forbidden local path.');
    }
    if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error('Qualification report contains an absolute local path.');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${location}[${index}]`, forbiddenVariants));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEYS.has(key)) {
      throw new Error(`Qualification report uses forbidden field ${location}.${key}.`);
    }
    visit(entry, `${location}.${key}`, forbiddenVariants);
  }
}

function pathVariants(candidate) {
  const value = String(candidate);
  return new Set([value, value.replaceAll('\\', '/'), value.replaceAll('/', '\\')]);
}
