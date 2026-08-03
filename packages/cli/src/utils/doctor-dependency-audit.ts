import { execa } from 'execa';
import fsExtra from 'fs-extra';
import path from 'path';

export type DoctorDependencyAuditRuntime =
  | 'node'
  | 'bun'
  | 'deno'
  | 'python'
  | 'go'
  | 'java'
  | 'rust'
  | 'elixir'
  | 'clojure'
  | 'php'
  | 'ruby'
  | 'dotnet'
  | 'scala'
  | 'kotlin'
  | 'c'
  | 'cpp'
  | 'unknown';

export type DoctorDependencyAuditStatus =
  'clean' | 'vulnerable' | 'tool-unavailable' | 'unsupported' | 'failed';

export interface DoctorDependencyAuditInvocation {
  cwd: string;
  executable: string;
  args: string[];
}

export interface DoctorDependencySeverityCounts {
  low: number;
  moderate: number;
  high: number;
  critical: number;
  unknown: number;
}

export interface DoctorDependencyAuditSubject {
  name: string;
  version?: string;
  direct?: boolean;
  advisoryIds: string[];
  severities: Array<'low' | 'moderate' | 'high' | 'critical' | 'unknown'>;
}

export type DoctorDependencyRemediationDisposition =
  'not-needed' | 'compatible' | 'breaking-only' | 'mixed' | 'none' | 'unknown';

export interface DoctorDependencyRemediationCandidate {
  packageName: string;
  version?: string;
  breaking: boolean;
}

export type DoctorDependencyResolutionStrategy =
  | 'direct-upgrade'
  | 'owner-upgrade'
  | 'constraint-update'
  | 'transitive-override'
  | 'replacement'
  | 'policy-exception'
  | 'upstream-wait';

/**
 * A bounded resolution hypothesis, not permission to mutate source.
 *
 * Audit tools frequently expose the vulnerable transitive package while their
 * `fixAvailable` field points at an invalid owner downgrade. Doctor preserves
 * the useful causal evidence so consumers can investigate a compatible owner,
 * constraint, or override transaction before asking for a breaking decision.
 */
export interface DoctorDependencyResolutionCandidate {
  packageName: string;
  relationship: 'direct' | 'transitive' | 'unknown';
  strategies: DoctorDependencyResolutionStrategy[];
  risk: 'safe' | 'guarded' | 'breaking' | 'unknown';
  autoExecutable: boolean;
  requiresCompatibilityVerification: boolean;
  currentVersion?: string;
  currentRange?: string;
  vulnerableRange?: string;
  safeVersionConstraint?: string;
  ownerPackages: string[];
  advisoryIds: string[];
  reason: string;
}

export interface DoctorDependencyRemediationEvidence {
  disposition: DoctorDependencyRemediationDisposition;
  compatibleFixAvailable: boolean;
  breakingFixAvailable: boolean;
  candidates: DoctorDependencyRemediationCandidate[];
  resolutionCandidates?: DoctorDependencyResolutionCandidate[];
}

export interface DoctorDependencyAuditEvidence {
  schemaVersion: 'doctor-dependency-audit-v1';
  runtime: DoctorDependencyAuditRuntime;
  ecosystem: string;
  tool: string;
  status: DoctorDependencyAuditStatus;
  generatedAt: string;
  invocation?: DoctorDependencyAuditInvocation;
  exitCode?: number;
  findingCount: number | null;
  blockingFindingCount: number | null;
  severityCounts: DoctorDependencySeverityCounts;
  subjects: DoctorDependencyAuditSubject[];
  remediation?: DoctorDependencyRemediationEvidence;
  reason: string;
  limitations: string[];
}

interface AuditPlan {
  ecosystem: string;
  tool: string;
  invocation?: DoctorDependencyAuditInvocation;
  unsupportedReason?: string;
}

interface ParsedAudit {
  findingCount: number;
  severityCounts: DoctorDependencySeverityCounts;
  subjects: DoctorDependencyAuditSubject[];
  remediation?: DoctorDependencyRemediationEvidence;
}

const EMPTY_SEVERITIES: DoctorDependencySeverityCounts = {
  low: 0,
  moderate: 0,
  high: 0,
  critical: 0,
  unknown: 0,
};

function normalizedSeverity(value: unknown): 'low' | 'moderate' | 'high' | 'critical' | 'unknown' {
  const severity = String(value ?? 'unknown').toLowerCase();
  if (severity === 'medium') return 'moderate';
  if (
    severity === 'low' ||
    severity === 'moderate' ||
    severity === 'high' ||
    severity === 'critical'
  )
    return severity;
  return 'unknown';
}

function subject(input: {
  name?: unknown;
  version?: unknown;
  direct?: unknown;
  advisoryIds?: unknown[];
  severities?: unknown[];
}): DoctorDependencyAuditSubject | null {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return null;
  return {
    name,
    ...(typeof input.version === 'string' && input.version.trim()
      ? { version: input.version.trim() }
      : {}),
    ...(typeof input.direct === 'boolean' ? { direct: input.direct } : {}),
    advisoryIds: [
      ...new Set(
        (input.advisoryIds ?? [])
          .map((value) =>
            typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
          )
          .filter(Boolean)
      ),
    ].sort(),
    severities: [
      ...new Set((input.severities ?? []).map((value) => normalizedSeverity(value))),
    ].sort(),
  };
}

function mergeSubjects(
  subjects: Array<DoctorDependencyAuditSubject | null>
): DoctorDependencyAuditSubject[] {
  const merged = new Map<string, DoctorDependencyAuditSubject>();
  for (const candidate of subjects) {
    if (!candidate) continue;
    const key = candidate.name.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      continue;
    }
    merged.set(key, {
      name: existing.name,
      ...(existing.version || candidate.version
        ? { version: existing.version ?? candidate.version }
        : {}),
      ...(existing.direct !== undefined || candidate.direct !== undefined
        ? { direct: existing.direct ?? candidate.direct }
        : {}),
      advisoryIds: [...new Set([...existing.advisoryIds, ...candidate.advisoryIds])].sort(),
      severities: [...new Set([...existing.severities, ...candidate.severities])].sort(),
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function genericResolutionCandidates(
  subjects: DoctorDependencyAuditSubject[]
): DoctorDependencyResolutionCandidate[] {
  return subjects.map((entry) => {
    const relationship =
      entry.direct === true ? 'direct' : entry.direct === false ? 'transitive' : 'unknown';
    return {
      packageName: entry.name,
      relationship,
      strategies:
        relationship === 'direct'
          ? [
              'direct-upgrade',
              'constraint-update',
              'replacement',
              'policy-exception',
              'upstream-wait',
            ]
          : [
              'owner-upgrade',
              'constraint-update',
              'replacement',
              'policy-exception',
              'upstream-wait',
            ],
      risk: 'guarded',
      autoExecutable: false,
      requiresCompatibilityVerification: true,
      ...(entry.version ? { currentVersion: entry.version } : {}),
      ownerPackages: [],
      advisoryIds: [...entry.advisoryIds],
      reason:
        'Resolve the advisory through the runtime-native dependency manifest and lock/baseline, then prove compatibility with audit, tests, build, and canonical verification.',
    } satisfies DoctorDependencyResolutionCandidate;
  });
}

const auditEvidenceCache = new Map<string, Promise<DoctorDependencyAuditEvidence>>();
const AUDIT_INPUT_FILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.yarnrc.yml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'pyproject.toml',
  'requirements.txt',
  'uv.lock',
  'poetry.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Cargo.toml',
  'Cargo.lock',
  'composer.json',
  'composer.lock',
  'Gemfile',
  'Gemfile.lock',
  'mix.exs',
  'mix.lock',
  'deps.edn',
  'project.clj',
  'Directory.Packages.props',
  'packages.lock.json',
];

function auditTimeoutMs(): number {
  const configured = Number(process.env.RAPIDKIT_DOCTOR_AUDIT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : 15_000;
}

async function auditCacheKey(
  projectPath: string,
  runtime: DoctorDependencyAuditRuntime
): Promise<string> {
  const state: string[] = [];
  for (const relativePath of AUDIT_INPUT_FILES) {
    const absolute = path.join(projectPath, relativePath);
    try {
      const stat = await fsExtra.stat(absolute);
      state.push(`${relativePath}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      // Missing inputs are intentionally omitted from the source signature.
    }
  }
  return `${path.resolve(projectPath)}\0${runtime}\0${state.join('|')}`;
}

function jsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function severityCountsFromRecord(value: unknown): DoctorDependencySeverityCounts {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    low: numberValue(record.low),
    moderate: numberValue(record.moderate ?? record.medium),
    high: numberValue(record.high),
    critical: numberValue(record.critical),
    unknown: numberValue(record.unknown),
  };
}

function severityTotal(counts: DoctorDependencySeverityCounts): number {
  return counts.low + counts.moderate + counts.high + counts.critical + counts.unknown;
}

function npmSafeVersionConstraint(vulnerableRange: unknown): string | undefined {
  if (typeof vulnerableRange !== 'string') return undefined;
  const range = vulnerableRange.trim();
  const lessThan = range.match(/^<\s*(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
  if (lessThan) return `>=${lessThan[1]}`;
  const lessThanOrEqual = range.match(/^<=\s*(\d+)\.(\d+)\.(\d+)$/);
  if (lessThanOrEqual) {
    return `>=${lessThanOrEqual[1]}.${lessThanOrEqual[2]}.${Number(lessThanOrEqual[3]) + 1}`;
  }
  return undefined;
}

async function npmManifestRanges(projectPath: string): Promise<Map<string, string>> {
  const ranges = new Map<string, string>();
  try {
    const manifest = (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
      string,
      unknown
    >;
    for (const sectionName of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const section = manifest[sectionName];
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
      for (const [packageName, value] of Object.entries(section as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) {
          ranges.set(packageName.toLowerCase(), value.trim());
        }
      }
    }
  } catch {
    // Missing or malformed manifests are reported by other Doctor surfaces.
  }
  return ranges;
}

async function npmResolutionCandidates(
  projectPath: string,
  stdout: string
): Promise<DoctorDependencyResolutionCandidate[]> {
  const payload = jsonObject(stdout);
  const vulnerabilities =
    payload?.vulnerabilities &&
    typeof payload.vulnerabilities === 'object' &&
    !Array.isArray(payload.vulnerabilities)
      ? (payload.vulnerabilities as Record<string, unknown>)
      : undefined;
  if (!vulnerabilities) return [];

  const [installedVersions, manifestRanges] = await Promise.all([
    npmInstalledVersions(projectPath),
    npmManifestRanges(projectPath),
  ]);
  const results = new Map<string, DoctorDependencyResolutionCandidate>();
  for (const [key, raw] of Object.entries(vulnerabilities)) {
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const packageName =
      typeof record.name === 'string' && record.name.trim() ? record.name.trim() : key.trim();
    if (!packageName) continue;
    const relationship =
      record.isDirect === true ? 'direct' : record.isDirect === false ? 'transitive' : 'unknown';
    const ownerPackages = Array.isArray(record.effects)
      ? [
          ...new Set(
            record.effects
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim())
              .filter(Boolean)
          ),
        ].sort()
      : [];
    const via = Array.isArray(record.via) ? record.via : [];
    const advisoryIds = [
      ...new Set(
        via.flatMap((entry) => {
          const advisory =
            entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
          return [advisory.source, advisory.url]
            .filter(
              (value): value is string | number =>
                typeof value === 'string' || typeof value === 'number'
            )
            .map(String);
        })
      ),
    ].sort();
    const vulnerableRange = typeof record.range === 'string' ? record.range.trim() : undefined;
    const safeVersionConstraint = npmSafeVersionConstraint(vulnerableRange);
    const currentRange = manifestRanges.get(packageName.toLowerCase());
    const currentVersion = installedVersions.get(packageName.toLowerCase());
    const strategies: DoctorDependencyResolutionStrategy[] =
      relationship === 'direct'
        ? [
            'direct-upgrade',
            'constraint-update',
            'replacement',
            'policy-exception',
            'upstream-wait',
          ]
        : [
            ...(ownerPackages.length > 0
              ? (['owner-upgrade'] as DoctorDependencyResolutionStrategy[])
              : []),
            'transitive-override',
            'replacement',
            'policy-exception',
            'upstream-wait',
          ];
    results.set(packageName.toLowerCase(), {
      packageName,
      relationship,
      strategies,
      risk: 'guarded',
      autoExecutable: false,
      requiresCompatibilityVerification: true,
      ...(currentVersion ? { currentVersion } : {}),
      ...(currentRange ? { currentRange } : {}),
      ...(vulnerableRange ? { vulnerableRange } : {}),
      ...(safeVersionConstraint ? { safeVersionConstraint } : {}),
      ownerPackages,
      advisoryIds,
      reason:
        relationship === 'direct'
          ? 'Resolve the direct dependency inside its declared compatibility boundary, then reconcile and verify the complete dependency transaction.'
          : 'Resolve the vulnerable transitive path through a compatible owner upgrade or a guarded package-manager constraint; never infer safety from an audit downgrade.',
    });
  }
  return [...results.values()].sort((left, right) =>
    left.packageName.localeCompare(right.packageName)
  );
}

function addSeverity(counts: DoctorDependencySeverityCounts, severity: unknown, amount = 1): void {
  const normalized = String(severity ?? 'unknown').toLowerCase();
  if (normalized === 'low') counts.low += amount;
  else if (normalized === 'moderate' || normalized === 'medium') counts.moderate += amount;
  else if (normalized === 'high') counts.high += amount;
  else if (normalized === 'critical') counts.critical += amount;
  else counts.unknown += amount;
}

function walkObjects(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visitor);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  visitor(record);
  for (const child of Object.values(record)) walkObjects(child, visitor);
}

function npmRemediationEvidence(
  vulnerabilityRecords: Array<[string, unknown]>,
  findingCount: number
): DoctorDependencyRemediationEvidence {
  if (findingCount === 0) {
    return {
      disposition: 'not-needed',
      compatibleFixAvailable: false,
      breakingFixAvailable: false,
      candidates: [],
    };
  }

  let fixMetadataSeen = false;
  let compatibleFixAvailable = false;
  let breakingFixAvailable = false;
  const candidates: DoctorDependencyRemediationCandidate[] = [];
  for (const [name, value] of vulnerabilityRecords) {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    if (!Object.prototype.hasOwnProperty.call(record, 'fixAvailable')) continue;
    fixMetadataSeen = true;
    const fix = record.fixAvailable;
    if (fix === true) {
      compatibleFixAvailable = true;
      candidates.push({ packageName: name, breaking: false });
      continue;
    }
    if (!fix || typeof fix !== 'object' || Array.isArray(fix)) continue;
    const fixRecord = fix as Record<string, unknown>;
    const packageName =
      typeof fixRecord.name === 'string' && fixRecord.name.trim() ? fixRecord.name.trim() : name;
    const breaking = fixRecord.isSemVerMajor === true;
    compatibleFixAvailable ||= !breaking;
    breakingFixAvailable ||= breaking;
    candidates.push({
      packageName,
      ...(typeof fixRecord.version === 'string' && fixRecord.version.trim()
        ? { version: fixRecord.version.trim() }
        : {}),
      breaking,
    });
  }

  const disposition: DoctorDependencyRemediationDisposition = compatibleFixAvailable
    ? breakingFixAvailable
      ? 'mixed'
      : 'compatible'
    : breakingFixAvailable
      ? 'breaking-only'
      : fixMetadataSeen
        ? 'none'
        : 'unknown';
  return {
    disposition,
    compatibleFixAvailable,
    breakingFixAvailable,
    candidates: candidates.sort((left, right) =>
      `${left.packageName}@${left.version ?? ''}`.localeCompare(
        `${right.packageName}@${right.version ?? ''}`
      )
    ),
  };
}

function compareExactVersions(left: string, right: string): number | null {
  const parse = (value: string): [number, number, number, string] | null => {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Number(leftParts[index]) > Number(rightParts[index]) ? 1 : -1;
    }
  }
  if (leftParts[3] === rightParts[3]) return 0;
  if (!leftParts[3]) return 1;
  if (!rightParts[3]) return -1;
  return leftParts[3].localeCompare(rightParts[3]);
}

async function npmInstalledVersions(projectPath: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  try {
    const lock = (await fsExtra.readJSON(path.join(projectPath, 'package-lock.json'))) as Record<
      string,
      unknown
    >;
    const packages =
      lock.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages)
        ? (lock.packages as Record<string, unknown>)
        : {};
    for (const [packagePath, value] of Object.entries(packages)) {
      if (!packagePath.startsWith('node_modules/')) continue;
      const packageName =
        packagePath
          .replace(/^node_modules\//, '')
          .split('/node_modules/')
          .at(-1)
          ?.trim() ?? '';
      if (!packageName) continue;
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      if (
        !versions.has(packageName.toLowerCase()) &&
        typeof record.version === 'string' &&
        record.version.trim()
      ) {
        versions.set(packageName.toLowerCase(), record.version.trim());
      }
    }
    const dependencies =
      lock.dependencies &&
      typeof lock.dependencies === 'object' &&
      !Array.isArray(lock.dependencies)
        ? (lock.dependencies as Record<string, unknown>)
        : {};
    for (const [packageName, value] of Object.entries(dependencies)) {
      if (versions.has(packageName.toLowerCase())) continue;
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      if (typeof record.version === 'string' && record.version.trim()) {
        versions.set(packageName.toLowerCase(), record.version.trim());
      }
    }
  } catch {
    // A missing or unreadable npm lockfile leaves npm's own remediation metadata unchanged.
  }
  return versions;
}

async function normalizeNpmRemediationEvidence(
  projectPath: string,
  remediation: DoctorDependencyRemediationEvidence
): Promise<DoctorDependencyRemediationEvidence> {
  if (remediation.disposition === 'not-needed') return remediation;
  const installedVersions = await npmInstalledVersions(projectPath);
  const merged = new Map<string, DoctorDependencyRemediationCandidate>();
  for (const candidate of remediation.candidates) {
    const installedVersion = installedVersions.get(candidate.packageName.toLowerCase());
    if (candidate.version && installedVersion) {
      const ordering = compareExactVersions(candidate.version, installedVersion);
      if (ordering !== null && ordering <= 0) {
        // npm can advertise a downgrade or the already-installed release as a
        // "fix" when an advisory has no compatible patched dependency tree.
        // Such a candidate is not executable remediation and must not reach Studio.
        continue;
      }
    }
    const key = `${candidate.packageName.toLowerCase()}\0${candidate.version ?? ''}`;
    const existing = merged.get(key);
    merged.set(key, {
      packageName: existing?.packageName ?? candidate.packageName,
      ...(candidate.version ? { version: candidate.version } : {}),
      // Conflicting audit records are classified conservatively.
      breaking: Boolean(existing?.breaking || candidate.breaking),
    });
  }
  const candidates = [...merged.values()].sort((left, right) =>
    `${left.packageName}@${left.version ?? ''}`.localeCompare(
      `${right.packageName}@${right.version ?? ''}`
    )
  );
  const compatibleFixAvailable = candidates.some((candidate) => !candidate.breaking);
  const breakingFixAvailable = candidates.some((candidate) => candidate.breaking);
  const disposition: DoctorDependencyRemediationDisposition = compatibleFixAvailable
    ? breakingFixAvailable
      ? 'mixed'
      : 'compatible'
    : breakingFixAvailable
      ? 'breaking-only'
      : 'none';
  return { disposition, compatibleFixAvailable, breakingFixAvailable, candidates };
}

function parseNpmCompatibleAudit(stdout: string): ParsedAudit | null {
  const payload = jsonObject(stdout);
  if (!payload) {
    const severityCounts = { ...EMPTY_SEVERITIES };
    const subjects: DoctorDependencyAuditSubject[] = [];
    let findingCount = 0;
    let summarySeen = false;
    for (const line of stdout.split(/\r?\n/)) {
      const message = jsonObject(line);
      if (!message) continue;
      const data =
        message.data && typeof message.data === 'object'
          ? (message.data as Record<string, unknown>)
          : {};
      if (message.type === 'auditAdvisory') {
        const advisory =
          data.advisory && typeof data.advisory === 'object'
            ? (data.advisory as Record<string, unknown>)
            : {};
        findingCount += 1;
        addSeverity(severityCounts, advisory.severity);
        const candidate = subject({
          name: advisory.module_name ?? advisory.name,
          advisoryIds: [advisory.id, advisory.github_advisory_id, advisory.url],
          severities: [advisory.severity],
        });
        if (candidate) subjects.push(candidate);
      }
      if (message.type === 'auditSummary') {
        summarySeen = true;
        const summaryCounts = severityCountsFromRecord(data.vulnerabilities);
        if (severityTotal(summaryCounts) >= findingCount) {
          return {
            findingCount: severityTotal(summaryCounts),
            severityCounts: summaryCounts,
            subjects: mergeSubjects(subjects),
          };
        }
      }
    }
    return findingCount > 0 || summarySeen
      ? { findingCount, severityCounts, subjects: mergeSubjects(subjects) }
      : null;
  }
  const metadata =
    payload.metadata && typeof payload.metadata === 'object'
      ? (payload.metadata as Record<string, unknown>)
      : null;
  const severityCounts = severityCountsFromRecord(metadata?.vulnerabilities);
  const vulnerabilityRecords =
    payload.vulnerabilities && typeof payload.vulnerabilities === 'object'
      ? Object.entries(payload.vulnerabilities as Record<string, unknown>)
      : [];
  const vulnerabilitySubjects = mergeSubjects(
    vulnerabilityRecords.map(([name, value]) => {
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const via = Array.isArray(record.via) ? record.via : [];
      return subject({
        name: record.name ?? name,
        direct: record.isDirect,
        advisoryIds: via.flatMap((entry) => {
          const advisory =
            entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
          return [advisory.source, advisory.url];
        }),
        severities: [record.severity],
      });
    })
  );
  if (severityTotal(severityCounts) > 0 || metadata?.vulnerabilities) {
    const findingCount = severityTotal(severityCounts);
    return {
      findingCount,
      severityCounts,
      subjects: vulnerabilitySubjects,
      remediation: npmRemediationEvidence(vulnerabilityRecords, findingCount),
    };
  }

  const advisoryEntries =
    payload.advisories && typeof payload.advisories === 'object'
      ? Object.entries(payload.advisories as Record<string, unknown>)
      : [];
  const advisorySubjects: DoctorDependencyAuditSubject[] = [];
  for (const [advisoryId, advisory] of advisoryEntries) {
    const record =
      advisory && typeof advisory === 'object' ? (advisory as Record<string, unknown>) : {};
    addSeverity(severityCounts, record.severity);
    const candidate = subject({
      name: record.module_name ?? record.name,
      advisoryIds: [record.id, record.github_advisory_id, record.url, advisoryId],
      severities: [record.severity],
    });
    if (candidate) advisorySubjects.push(candidate);
  }
  return {
    findingCount: advisoryEntries.length,
    severityCounts,
    subjects: mergeSubjects([...vulnerabilitySubjects, ...advisorySubjects]),
  };
}

function parsePipAudit(stdout: string): ParsedAudit | null {
  const payload: unknown = (() => {
    try {
      return JSON.parse(stdout.trim());
    } catch {
      return null;
    }
  })();
  const dependencies = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).dependencies as unknown)
      : null;
  if (!Array.isArray(dependencies)) return null;
  const severityCounts = { ...EMPTY_SEVERITIES };
  const subjects: DoctorDependencyAuditSubject[] = [];
  let findingCount = 0;
  for (const dependency of dependencies) {
    const record =
      dependency && typeof dependency === 'object' ? (dependency as Record<string, unknown>) : {};
    const vulnerabilities = Array.isArray(record.vulns) ? record.vulns : [];
    findingCount += vulnerabilities.length;
    severityCounts.unknown += vulnerabilities.length;
    if (vulnerabilities.length > 0) {
      const candidate = subject({
        name: record.name,
        version: record.version,
        advisoryIds: vulnerabilities.flatMap((value) => {
          const vulnerability =
            value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
          return [vulnerability.id, vulnerability.aliases].flatMap((item) =>
            Array.isArray(item) ? item : [item]
          );
        }),
        severities: vulnerabilities.map(() => 'unknown'),
      });
      if (candidate) subjects.push(candidate);
    }
  }
  return { findingCount, severityCounts, subjects: mergeSubjects(subjects) };
}

function parseGoVulncheck(stdout: string): ParsedAudit | null {
  if (!stdout.trim()) return null;
  const ids = new Set<string>();
  const modules = new Map<string, { version?: string; advisoryIds: Set<string> }>();
  for (const line of stdout.split(/\r?\n/)) {
    const payload = jsonObject(line);
    const osv =
      payload?.osv && typeof payload.osv === 'object'
        ? (payload.osv as Record<string, unknown>)
        : null;
    if (typeof osv?.id === 'string') ids.add(osv.id);
    const finding =
      payload?.finding && typeof payload.finding === 'object'
        ? (payload.finding as Record<string, unknown>)
        : null;
    if (typeof finding?.osv === 'string') ids.add(finding.osv);
    const trace = Array.isArray(finding?.trace) ? finding.trace : [];
    for (const frame of trace) {
      const record = frame && typeof frame === 'object' ? (frame as Record<string, unknown>) : {};
      const name =
        typeof record.module === 'string'
          ? record.module
          : typeof record.package === 'string'
            ? record.package
            : '';
      if (!name) continue;
      const current = modules.get(name) ?? { advisoryIds: new Set<string>() };
      if (typeof record.version === 'string') current.version = record.version;
      if (typeof finding?.osv === 'string') current.advisoryIds.add(finding.osv);
      modules.set(name, current);
    }
  }
  return {
    findingCount: ids.size,
    severityCounts: { ...EMPTY_SEVERITIES, unknown: ids.size },
    subjects: [...modules.entries()]
      .map(([name, value]) =>
        subject({
          name,
          version: value.version,
          advisoryIds: [...value.advisoryIds],
          severities: ['unknown'],
        })
      )
      .filter((value): value is DoctorDependencyAuditSubject => Boolean(value)),
  };
}

function parseCargoAudit(stdout: string): ParsedAudit | null {
  const payload = jsonObject(stdout);
  if (!payload) return null;
  const vulnerabilities =
    payload.vulnerabilities && typeof payload.vulnerabilities === 'object'
      ? (payload.vulnerabilities as Record<string, unknown>)
      : {};
  const list = Array.isArray(vulnerabilities.list) ? vulnerabilities.list : [];
  const severityCounts = { ...EMPTY_SEVERITIES };
  const subjects: DoctorDependencyAuditSubject[] = [];
  for (const item of list) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const advisory =
      record.advisory && typeof record.advisory === 'object'
        ? (record.advisory as Record<string, unknown>)
        : {};
    addSeverity(severityCounts, advisory.severity);
    const packageRecord =
      record.package && typeof record.package === 'object'
        ? (record.package as Record<string, unknown>)
        : {};
    const candidate = subject({
      name: packageRecord.name,
      version: packageRecord.version,
      advisoryIds: [advisory.id, advisory.url],
      severities: [advisory.severity],
    });
    if (candidate) subjects.push(candidate);
  }
  return { findingCount: list.length, severityCounts, subjects: mergeSubjects(subjects) };
}

function parseComposerAudit(stdout: string): ParsedAudit | null {
  const payload = jsonObject(stdout);
  if (!payload) return null;
  const advisories =
    payload.advisories && typeof payload.advisories === 'object'
      ? (payload.advisories as Record<string, unknown>)
      : {};
  const severityCounts = { ...EMPTY_SEVERITIES };
  let findingCount = 0;
  const subjects: DoctorDependencyAuditSubject[] = [];
  for (const [name, value] of Object.entries(advisories)) {
    const entries = Array.isArray(value) ? value : [value];
    const candidate = subject({
      name,
      advisoryIds: entries.flatMap((entry) => {
        const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        return [record.advisoryId, record.cve, record.link];
      }),
      severities: entries.map((entry) => {
        const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        return record.severity;
      }),
    });
    if (candidate) subjects.push(candidate);
  }
  walkObjects(advisories, (record) => {
    if (typeof record.advisoryId === 'string' || typeof record.cve === 'string') {
      findingCount += 1;
      addSeverity(severityCounts, record.severity);
    }
  });
  return { findingCount, severityCounts, subjects: mergeSubjects(subjects) };
}

function parseDotnetAudit(stdout: string): ParsedAudit | null {
  const payload = jsonObject(stdout);
  if (!payload) return null;
  const severityCounts = { ...EMPTY_SEVERITIES };
  let findingCount = 0;
  const subjects: DoctorDependencyAuditSubject[] = [];
  walkObjects(payload, (record) => {
    if (!Array.isArray(record.vulnerabilities)) return;
    for (const vulnerability of record.vulnerabilities) {
      const entry =
        vulnerability && typeof vulnerability === 'object'
          ? (vulnerability as Record<string, unknown>)
          : {};
      findingCount += 1;
      addSeverity(severityCounts, entry.severity);
    }
    const candidate = subject({
      name: record.id ?? record.name ?? record.packageId,
      version: record.resolvedVersion ?? record.version,
      direct: record.isTransitive === false,
      advisoryIds: record.vulnerabilities.flatMap((value) => {
        const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
        return [entry.advisoryurl, entry.advisoryUrl, entry.url];
      }),
      severities: record.vulnerabilities.map((value) => {
        const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
        return entry.severity;
      }),
    });
    if (candidate) subjects.push(candidate);
  });
  return { findingCount, severityCounts, subjects: mergeSubjects(subjects) };
}

function parseBundlerAudit(stdout: string): ParsedAudit | null {
  const payload = jsonObject(stdout);
  if (!payload) return null;
  const severityCounts = { ...EMPTY_SEVERITIES };
  const identities = new Set<string>();
  const subjects: DoctorDependencyAuditSubject[] = [];
  walkObjects(payload, (record) => {
    const identity = record.id ?? record.cve ?? record.advisory ?? record.url;
    if (typeof identity !== 'string') return;
    identities.add(identity);
    addSeverity(severityCounts, record.severity ?? record.criticality);
    const gem =
      record.gem && typeof record.gem === 'object' ? (record.gem as Record<string, unknown>) : {};
    const candidate = subject({
      name: gem.name ?? record.gemName ?? record.name,
      version: gem.version ?? record.version,
      advisoryIds: [identity],
      severities: [record.severity ?? record.criticality],
    });
    if (candidate) subjects.push(candidate);
  });
  return {
    findingCount: identities.size,
    severityCounts:
      identities.size > 0 && severityTotal(severityCounts) === 0
        ? { ...severityCounts, unknown: identities.size }
        : severityCounts,
    subjects: mergeSubjects(subjects),
  };
}

function parseTextAudit(stdout: string, stderr: string): ParsedAudit | null {
  const text = `${stdout}\n${stderr}`.trim();
  if (!text) return null;
  const match = text.match(/(?:found|total:?)\s+(\d+)\s+vulnerabilit/i);
  const explicitlyClean =
    /no (?:known )?vulnerabilit|no retired packages found|no insecure dependencies found/i.test(
      text
    );
  if (!match && !explicitlyClean) return null;
  const findingCount = match ? Number(match[1]) : 0;
  return {
    findingCount,
    severityCounts: { ...EMPTY_SEVERITIES, unknown: findingCount },
    subjects: [],
  };
}

function parseAudit(
  runtime: DoctorDependencyAuditRuntime,
  stdout: string,
  stderr: string
): ParsedAudit | null {
  if (runtime === 'node' || runtime === 'bun') return parseNpmCompatibleAudit(stdout);
  if (runtime === 'python') return parsePipAudit(stdout);
  if (runtime === 'go') return parseGoVulncheck(stdout);
  if (runtime === 'rust') return parseCargoAudit(stdout);
  if (runtime === 'php') return parseComposerAudit(stdout);
  if (runtime === 'dotnet') return parseDotnetAudit(stdout);
  if (runtime === 'ruby') return parseBundlerAudit(stdout) ?? parseTextAudit(stdout, stderr);
  if (runtime === 'deno' || runtime === 'elixir') {
    return parseTextAudit(stdout, stderr);
  }
  return null;
}

async function pathExists(projectPath: string, relativePath: string): Promise<boolean> {
  return fsExtra.pathExists(path.join(projectPath, relativePath));
}

async function resolveAuditPlan(
  projectPath: string,
  runtime: DoctorDependencyAuditRuntime
): Promise<AuditPlan> {
  if (runtime === 'bun') {
    return {
      ecosystem: 'npm',
      tool: 'bun audit',
      invocation: { cwd: projectPath, executable: 'bun', args: ['audit', '--json'] },
    };
  }
  if (runtime === 'node') {
    if (
      (await pathExists(projectPath, 'bun.lock')) ||
      (await pathExists(projectPath, 'bun.lockb'))
    ) {
      return {
        ecosystem: 'npm',
        tool: 'bun audit',
        invocation: { cwd: projectPath, executable: 'bun', args: ['audit', '--json'] },
      };
    }
    if (await pathExists(projectPath, 'pnpm-lock.yaml')) {
      return {
        ecosystem: 'npm',
        tool: 'pnpm audit',
        invocation: { cwd: projectPath, executable: 'pnpm', args: ['audit', '--json'] },
      };
    }
    if (await pathExists(projectPath, 'yarn.lock')) {
      const yarnBerry = await pathExists(projectPath, '.yarnrc.yml');
      return {
        ecosystem: 'npm',
        tool: 'yarn audit',
        invocation: {
          cwd: projectPath,
          executable: 'yarn',
          args: yarnBerry
            ? ['npm', 'audit', '--json', '--severity', 'moderate']
            : ['audit', '--json', '--level', 'moderate'],
        },
      };
    }
    return {
      ecosystem: 'npm',
      tool: 'npm audit',
      invocation: { cwd: projectPath, executable: 'npm', args: ['audit', '--json'] },
    };
  }
  if (runtime === 'deno') {
    return {
      ecosystem: 'deno',
      tool: 'deno audit',
      invocation: { cwd: projectPath, executable: 'deno', args: ['audit'] },
    };
  }
  if (runtime === 'python') {
    const venvPython = path.join(
      projectPath,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
    return {
      ecosystem: 'PyPI',
      tool: 'pip-audit',
      invocation: {
        cwd: projectPath,
        executable: (await fsExtra.pathExists(venvPython))
          ? venvPython
          : process.platform === 'win32'
            ? 'python'
            : 'python3',
        args: ['-m', 'pip_audit', '--format', 'json'],
      },
    };
  }
  if (runtime === 'go') {
    return {
      ecosystem: 'Go modules',
      tool: 'govulncheck',
      invocation: { cwd: projectPath, executable: 'govulncheck', args: ['-json', './...'] },
    };
  }
  if (runtime === 'rust') {
    return {
      ecosystem: 'crates.io',
      tool: 'cargo-audit',
      invocation: { cwd: projectPath, executable: 'cargo', args: ['audit', '--json'] },
    };
  }
  if (runtime === 'php') {
    return {
      ecosystem: 'Packagist',
      tool: 'Composer audit',
      invocation: { cwd: projectPath, executable: 'composer', args: ['audit', '--format=json'] },
    };
  }
  if (runtime === 'ruby') {
    return {
      ecosystem: 'RubyGems',
      tool: 'bundler-audit',
      invocation: {
        cwd: projectPath,
        executable: 'bundle-audit',
        args: ['check', '--format', 'json'],
      },
    };
  }
  if (runtime === 'dotnet') {
    return {
      ecosystem: 'NuGet',
      tool: '.NET package audit',
      invocation: {
        cwd: projectPath,
        executable: 'dotnet',
        args: ['package', 'list', '--vulnerable', '--include-transitive', '--format', 'json'],
      },
    };
  }
  if (runtime === 'elixir') {
    return {
      ecosystem: 'Hex',
      tool: 'mix hex.audit',
      invocation: { cwd: projectPath, executable: 'mix', args: ['hex.audit'] },
    };
  }
  if (runtime === 'java') {
    return {
      ecosystem: 'Maven/Gradle',
      tool: 'OWASP Dependency-Check',
      unsupportedReason:
        'No universal zero-configuration Java vulnerability scanner is safe to invoke. Declare OWASP Dependency-Check or an organization-approved equivalent in the build.',
    };
  }
  if (runtime === 'scala' || runtime === 'kotlin') {
    return {
      ecosystem: 'Maven/JVM',
      tool: 'organization-selected JVM dependency scanner',
      unsupportedReason:
        'No universal zero-configuration JVM vulnerability scanner is safe to invoke. Declare an organization-approved scanner in the project build.',
    };
  }
  if (runtime === 'c' || runtime === 'cpp') {
    return {
      ecosystem: runtime === 'c' ? 'C/native' : 'C++/native',
      tool: 'organization-selected native dependency scanner',
      unsupportedReason:
        'Native dependency provenance depends on the build and package manager. Declare an organization-approved SBOM or vulnerability scanner in the project command contract.',
    };
  }
  if (runtime === 'clojure') {
    return {
      ecosystem: 'Clojars/Maven',
      tool: 'organization-selected Clojure audit',
      unsupportedReason:
        'No portable Clojure vulnerability command is declared. Configure an organization-approved scanner and expose it through the project command contract.',
    };
  }
  return {
    ecosystem: 'unknown',
    tool: 'none',
    unsupportedReason: 'Doctor could not determine a supported dependency ecosystem.',
  };
}

function unavailableError(error: unknown): boolean {
  const record =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const code = String(record?.code ?? '');
  const message = String(record?.message ?? '');
  return (
    code === 'ENOENT' || /not found|is not recognized|no module named pip_audit/i.test(message)
  );
}

async function collectDoctorDependencyAuditUncached(input: {
  projectPath: string;
  runtime: DoctorDependencyAuditRuntime;
}): Promise<DoctorDependencyAuditEvidence> {
  const generatedAt = new Date().toISOString();
  const plan = await resolveAuditPlan(input.projectPath, input.runtime);
  const base = {
    schemaVersion: 'doctor-dependency-audit-v1' as const,
    runtime: input.runtime,
    ecosystem: plan.ecosystem,
    tool: plan.tool,
    generatedAt,
    findingCount: null,
    blockingFindingCount: null,
    severityCounts: { ...EMPTY_SEVERITIES },
    subjects: [],
    limitations: [
      'A clean result covers known advisories available to the selected runtime-native audit tool at execution time.',
      'Doctor never treats a missing scanner, malformed output, registry failure, or timeout as a clean audit.',
    ],
  };

  if (!plan.invocation) {
    return {
      ...base,
      status: 'unsupported',
      reason: plan.unsupportedReason ?? 'No supported audit invocation is available.',
    };
  }

  try {
    const result = await execa(plan.invocation.executable, plan.invocation.args, {
      cwd: plan.invocation.cwd,
      timeout: auditTimeoutMs(),
      reject: false,
    });
    const parsed = parseAudit(input.runtime, result.stdout, result.stderr);
    if (!parsed) {
      const unavailable =
        /not found|no module named pip_audit|unknown command|unrecognized (?:command|option)/i.test(
          `${result.stdout}\n${result.stderr}`
        );
      return {
        ...base,
        invocation: plan.invocation,
        exitCode: result.exitCode,
        status: unavailable ? 'tool-unavailable' : 'failed',
        reason: unavailable
          ? `${plan.tool} is not installed or not supported by the detected runtime version.`
          : `${plan.tool} did not produce parseable vulnerability evidence.`,
      };
    }

    if ((input.runtime === 'node' || input.runtime === 'bun') && parsed.remediation) {
      parsed.remediation = await normalizeNpmRemediationEvidence(
        input.projectPath,
        parsed.remediation
      );
      if (parsed.findingCount > 0 && !parsed.remediation.compatibleFixAvailable) {
        const structuredCandidates = await npmResolutionCandidates(
          input.projectPath,
          result.stdout
        );
        parsed.remediation.resolutionCandidates =
          structuredCandidates.length > 0
            ? structuredCandidates
            : genericResolutionCandidates(parsed.subjects);
      }
    }
    const blockingFindingCount =
      parsed.severityCounts.moderate +
      parsed.severityCounts.high +
      parsed.severityCounts.critical +
      parsed.severityCounts.unknown;
    const remediation =
      parsed.remediation ??
      (parsed.findingCount === 0
        ? {
            disposition: 'not-needed' as const,
            compatibleFixAvailable: false,
            breakingFixAvailable: false,
            candidates: [],
          }
        : {
            disposition: 'unknown' as const,
            compatibleFixAvailable: false,
            breakingFixAvailable: false,
            candidates: [],
            resolutionCandidates: genericResolutionCandidates(parsed.subjects),
          });
    return {
      ...base,
      invocation: plan.invocation,
      exitCode: result.exitCode,
      findingCount: parsed.findingCount,
      blockingFindingCount,
      severityCounts: parsed.severityCounts,
      subjects: parsed.subjects,
      remediation,
      status: parsed.findingCount > 0 ? 'vulnerable' : 'clean',
      reason:
        parsed.findingCount > 0
          ? `${plan.tool} reported ${parsed.findingCount} known dependency vulnerability finding(s).`
          : `${plan.tool} completed without known dependency vulnerability findings.`,
    };
  } catch (error) {
    return {
      ...base,
      invocation: plan.invocation,
      status: unavailableError(error) ? 'tool-unavailable' : 'failed',
      reason: unavailableError(error)
        ? `${plan.tool} is not installed or cannot be resolved from this project environment.`
        : `${plan.tool} could not complete: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function collectDoctorDependencyAudit(input: {
  projectPath: string;
  runtime: DoctorDependencyAuditRuntime;
}): Promise<DoctorDependencyAuditEvidence> {
  const key = await auditCacheKey(input.projectPath, input.runtime);
  const cached = auditEvidenceCache.get(key);
  if (cached) return cached;
  const pending = collectDoctorDependencyAuditUncached(input);
  auditEvidenceCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    auditEvidenceCache.delete(key);
    throw error;
  }
}
