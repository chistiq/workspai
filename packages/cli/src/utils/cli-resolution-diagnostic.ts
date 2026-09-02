import path from 'node:path';
import { execa } from 'execa';

export type CliResolutionStatus =
  'canonical' | 'shadowed' | 'unresolved' | 'unverified' | 'not-applicable';

export interface CliResolutionDiagnostic {
  status: 'ok' | 'warn' | 'error';
  applicability: 'applicable' | 'not-applicable';
  message: string;
  details?: string;
  paths?: Array<{ location: string; path: string }>;
  command: 'workspai';
  resolutionStatus: CliResolutionStatus;
  activePath?: string;
  npmGlobalPrefix?: string;
  candidates: string[];
}

interface CliResolutionProbeOptions {
  platform?: NodeJS.Platform;
  resolveCandidates?: () => Promise<string[]>;
  resolveNpmGlobalPrefix?: () => Promise<string | undefined>;
}

function normalizeWindowsPath(value: string): string {
  return path.win32.normalize(value.trim()).replace(/\\/g, '/').toLowerCase();
}

function isDirectChildOfPrefix(candidate: string, prefix: string): boolean {
  return (
    normalizeWindowsPath(path.win32.dirname(candidate)) === normalizeWindowsPath(prefix) &&
    /^workspai(?:\.cmd|\.exe|\.ps1)?$/i.test(path.win32.basename(candidate))
  );
}

async function resolveWindowsCommandCandidates(): Promise<string[]> {
  const result = await execa('where.exe', ['workspai'], {
    reject: false,
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

async function resolveNpmGlobalPrefix(): Promise<string | undefined> {
  const configuredPrefix = process.env.npm_config_prefix?.trim();
  if (configuredPrefix) return configuredPrefix;

  const result = await execa('npm', ['prefix', '--global'], {
    reject: false,
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export async function checkCliResolution(
  options: CliResolutionProbeOptions = {}
): Promise<CliResolutionDiagnostic> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      status: 'ok',
      applicability: 'not-applicable',
      command: 'workspai',
      resolutionStatus: 'not-applicable',
      candidates: [],
      message: 'Windows PATH resolution check is not applicable on this host.',
    };
  }

  const [rawCandidates, npmGlobalPrefix] = await Promise.all([
    (options.resolveCandidates ?? resolveWindowsCommandCandidates)(),
    (options.resolveNpmGlobalPrefix ?? resolveNpmGlobalPrefix)(),
  ]);
  const candidates = [
    ...new Set(rawCandidates.map((candidate) => candidate.trim()).filter(Boolean)),
  ];
  const paths = candidates.map((candidate, index) => ({
    location: index === 0 ? 'Active PATH match' : 'Additional PATH match',
    path: candidate,
  }));

  if (candidates.length === 0) {
    return {
      status: 'warn',
      applicability: 'applicable',
      command: 'workspai',
      resolutionStatus: 'unresolved',
      candidates,
      ...(npmGlobalPrefix ? { npmGlobalPrefix } : {}),
      message: '`workspai` is not resolvable from Windows PATH.',
      details:
        'Add the npm global prefix to PATH, or use `npx --yes workspai <command>` while repairing the host configuration.',
    };
  }

  const activePath = candidates[0];
  if (!npmGlobalPrefix) {
    return {
      status: 'warn',
      applicability: 'applicable',
      command: 'workspai',
      resolutionStatus: 'unverified',
      activePath,
      candidates,
      paths,
      message: 'The active `workspai` PATH target could not be verified against npm.',
      details:
        'Run `npm prefix --global`, then ensure that directory precedes conflicting command locations in PATH.',
    };
  }

  const npmCandidate = candidates.find((candidate) =>
    isDirectChildOfPrefix(candidate, npmGlobalPrefix)
  );
  if (isDirectChildOfPrefix(activePath, npmGlobalPrefix)) {
    return {
      status: 'ok',
      applicability: 'applicable',
      command: 'workspai',
      resolutionStatus: 'canonical',
      activePath,
      npmGlobalPrefix,
      candidates,
      paths,
      message: '`workspai` resolves to the npm global shim.',
      ...(candidates.length > 1
        ? { details: 'Additional PATH matches exist, but the npm global shim has precedence.' }
        : {}),
    };
  }

  return {
    status: 'warn',
    applicability: 'applicable',
    command: 'workspai',
    resolutionStatus: 'shadowed',
    activePath,
    npmGlobalPrefix,
    candidates,
    paths,
    message: 'Another executable shadows the npm global `workspai` shim.',
    details: npmCandidate
      ? `Move ${npmGlobalPrefix} before ${path.win32.dirname(activePath)} in PATH. Until then, use \`npx --yes workspai <command>\`.`
      : `Add ${npmGlobalPrefix} to PATH before ${path.win32.dirname(activePath)}. Until then, use \`npx --yes workspai <command>\`.`,
  };
}
