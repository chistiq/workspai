import path from 'node:path';

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
