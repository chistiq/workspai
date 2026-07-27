import path from 'path';

import fsExtra from 'fs-extra';

export type GeneratorVersionEvidence = {
  policy: 'latest-stable';
  requested_channel: 'latest' | 'stable';
  host: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  declared: Record<string, string>;
  resolved: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;

export async function collectGeneratorVersionEvidence(
  projectPath: string,
  requestedChannel: GeneratorVersionEvidence['requested_channel']
): Promise<GeneratorVersionEvidence> {
  const declared: Record<string, string> = {};
  const resolved: Record<string, string> = {};

  await collectNodeVersionEvidence(projectPath, declared, resolved);
  await collectComposerVersionEvidence(projectPath, declared, resolved);

  return {
    policy: 'latest-stable',
    requested_channel: requestedChannel,
    host: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    declared: sortRecord(declared),
    resolved: sortRecord(resolved),
  };
}

async function collectNodeVersionEvidence(
  projectPath: string,
  declared: Record<string, string>,
  resolved: Record<string, string>
): Promise<void> {
  const packagePath = path.join(projectPath, 'package.json');
  if (!(await fsExtra.pathExists(packagePath))) return;

  const manifest = (await fsExtra.readJson(packagePath)) as JsonRecord;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const dependencies = asStringRecord(manifest[section]);
    for (const [name, version] of Object.entries(dependencies)) {
      declared[`npm:${name}`] = version;
    }
  }
  for (const [name, version] of Object.entries(asStringRecord(manifest.engines))) {
    declared[`engine:${name}`] = version;
  }

  const lockPath = path.join(projectPath, 'package-lock.json');
  if (!(await fsExtra.pathExists(lockPath))) return;
  const lock = (await fsExtra.readJson(lockPath)) as JsonRecord;
  const packages = asObjectRecord(lock.packages);
  for (const dependencyName of Object.keys(declared)
    .filter((key) => key.startsWith('npm:'))
    .map((key) => key.slice(4))) {
    const packageEntry = asObjectRecord(packages[`node_modules/${dependencyName}`]);
    if (typeof packageEntry.version === 'string') {
      resolved[`npm:${dependencyName}`] = packageEntry.version;
    }
  }
}

async function collectComposerVersionEvidence(
  projectPath: string,
  declared: Record<string, string>,
  resolved: Record<string, string>
): Promise<void> {
  const composerPath = path.join(projectPath, 'composer.json');
  if (!(await fsExtra.pathExists(composerPath))) return;

  const manifest = (await fsExtra.readJson(composerPath)) as JsonRecord;
  for (const section of ['require', 'require-dev'] as const) {
    for (const [name, version] of Object.entries(asStringRecord(manifest[section]))) {
      declared[`composer:${name}`] = version;
    }
  }

  const lockPath = path.join(projectPath, 'composer.lock');
  if (!(await fsExtra.pathExists(lockPath))) return;
  const lock = (await fsExtra.readJson(lockPath)) as JsonRecord;
  for (const section of ['packages', 'packages-dev'] as const) {
    const packages = Array.isArray(lock[section]) ? lock[section] : [];
    for (const candidate of packages) {
      const packageEntry = asObjectRecord(candidate);
      if (typeof packageEntry.name === 'string' && typeof packageEntry.version === 'string') {
        resolved[`composer:${packageEntry.name}`] = packageEntry.version;
      }
    }
  }
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function asObjectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}
