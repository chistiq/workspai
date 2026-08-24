import type { Dirent } from 'fs';
import path from 'path';

import fsExtra from 'fs-extra';
import { parse } from 'yaml';
import { projectMetadataCandidates } from './workspace-paths.js';

export type WorkspaceProjectKind =
  | 'backend'
  | 'frontend'
  | 'desktop'
  | 'extension'
  | 'service'
  | 'worker'
  | 'platform'
  | 'library'
  | 'infra'
  | 'docs'
  | 'test-suite'
  | 'unknown';

export type WorkspaceProjectCategory =
  | 'backend'
  | 'frontend'
  | 'desktop'
  | 'extension'
  | 'platform'
  | 'library'
  | 'infrastructure'
  | 'documentation'
  | 'quality'
  | 'unknown';

export type WorkspaceProjectKindHints = {
  runtime?: string | null;
  framework?: string | null;
  kit?: string | null;
};

const PROJECT_KIND_VALUES = new Set<WorkspaceProjectKind>([
  'backend',
  'desktop',
  'extension',
  'service',
  'frontend',
  'worker',
  'platform',
  'library',
  'infra',
  'docs',
  'test-suite',
  'unknown',
]);

const GO_COMMAND_DISCOVERY_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.workspai',
  'vendor',
  'node_modules',
  'test',
  'tests',
  'testdata',
  'fixtures',
  'samples',
  'examples',
  'third_party',
]);

const COMPOSITE_LIBRARY_DISCOVERY_IGNORED_DIRECTORIES = new Set([
  ...GO_COMMAND_DISCOVERY_IGNORED_DIRECTORIES,
  '.cache',
  '.venv',
  'build',
  'dist',
  'target',
]);

async function hasMultipleGoCommandPackages(projectPath: string): Promise<boolean> {
  let commandCount = 0;

  const visit = async (directory: string, depth: number): Promise<boolean> => {
    if (depth > 5) return false;

    let entries: Dirent[];
    try {
      entries = await fsExtra.readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isFile() && entry.name === 'main.go') {
        const source = await fsExtra
          .readFile(path.join(directory, entry.name), 'utf8')
          .catch(() => '');
        if (/^\s*package\s+main\b/m.test(source)) {
          commandCount += 1;
          if (commandCount > 1) return true;
        }
      }
      if (
        entry.isDirectory() &&
        !GO_COMMAND_DISCOVERY_IGNORED_DIRECTORIES.has(entry.name) &&
        (await visit(path.join(directory, entry.name), depth + 1))
      ) {
        return true;
      }
    }
    return false;
  };

  return visit(projectPath, 0);
}

async function hasNativeBindingLibraryTopology(
  projectPath: string,
  runtime: string | null | undefined
): Promise<boolean> {
  if (runtime !== 'c' && runtime !== 'cpp') return false;

  const manifestFamilies = new Set<string>();
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3 || manifestFamilies.size >= 3) return;
    let entries: Dirent[];
    try {
      entries = await fsExtra.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'cmakelists.txt' || name === 'meson.build') manifestFamilies.add('native');
        else if (name === 'pyproject.toml' || name === 'setup.py') manifestFamilies.add('python');
        else if (name === 'description' && path.basename(directory).toLowerCase() === 'r')
          manifestFamilies.add('r');
        else if (name.endsWith('.gemspec')) manifestFamilies.add('ruby');
        else if (name === 'pom.xml' || name === 'build.gradle' || name === 'build.gradle.kts')
          manifestFamilies.add('java');
        else if (name === 'cargo.toml') manifestFamilies.add('rust');
        else if (name === 'go.mod') manifestFamilies.add('go');
        else if (name === 'package.json') manifestFamilies.add('node');
      } else if (
        entry.isDirectory() &&
        !COMPOSITE_LIBRARY_DISCOVERY_IGNORED_DIRECTORIES.has(entry.name)
      ) {
        await visit(path.join(directory, entry.name), depth + 1);
      }
    }
  };

  await visit(projectPath, 0);
  return manifestFamilies.has('native') && manifestFamilies.size >= 3;
}

async function hasJvmModuleAggregator(projectPath: string): Promise<boolean> {
  const pom = await fsExtra.readFile(path.join(projectPath, 'pom.xml'), 'utf8').catch(() => '');
  const modulesBlock = pom.match(/<modules\b[^>]*>([\s\S]*?)<\/modules>/iu)?.[1] ?? '';
  if ((modulesBlock.match(/<module\b[^>]*>[^<]+<\/module>/giu) ?? []).length >= 2) return true;

  for (const fileName of ['settings.gradle', 'settings.gradle.kts']) {
    const settings = await fsExtra
      .readFile(path.join(projectPath, fileName), 'utf8')
      .catch(() => '');
    if (!settings) continue;
    const includedProjects = new Set(
      [...settings.matchAll(/['"](:[^'"]+)['"]/gu)].map((match) => match[1])
    );
    if (includedProjects.size >= 2) return true;
  }
  return false;
}

async function hasMultiServiceComposeTopology(projectPath: string): Promise<boolean> {
  for (const fileName of [
    'compose.yaml',
    'compose.yml',
    'docker-compose.yaml',
    'docker-compose.yml',
  ]) {
    const source = await fsExtra.readFile(path.join(projectPath, fileName), 'utf8').catch(() => '');
    if (!source) continue;

    try {
      const document = parse(source) as {
        services?: Record<
          string,
          {
            build?: string | { context?: string; dockerfile?: string };
            ports?: unknown;
            depends_on?: unknown;
          }
        >;
      } | null;
      const services = document?.services ?? {};
      const buildServices = Object.entries(services)
        .map(([serviceName, service]) => {
          const identity = (() => {
            if (typeof service?.build === 'string') return `${service.build}|Dockerfile`;
            if (!service?.build || typeof service.build !== 'object') return null;
            const context = service.build.context;
            if (typeof context !== 'string' || context.length === 0) return null;
            const dockerfile =
              'dockerfile' in service.build && typeof service.build.dockerfile === 'string'
                ? service.build.dockerfile
                : 'Dockerfile';
            return `${context}|${dockerfile}`;
          })();
          return identity
            ? {
                serviceName,
                service,
                identity: identity.replaceAll('\\', '/').replace(/\/$/, ''),
              }
            : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const buildIdentities = new Set(buildServices.map((entry) => entry.identity));
      if (buildIdentities.size < 2) continue;

      const buildServiceNames = new Set(buildServices.map((entry) => entry.serviceName));
      const endpointBearingBuilds = new Set(
        buildServices
          .filter(({ service }) => Array.isArray(service.ports) && service.ports.length > 0)
          .map(({ identity }) => identity)
      );
      const hasBuildServiceDependency = buildServices.some(({ service }) => {
        const dependencies = Array.isArray(service.depends_on)
          ? service.depends_on
          : service.depends_on && typeof service.depends_on === 'object'
            ? Object.keys(service.depends_on)
            : [];
        return dependencies.some(
          (dependency) => typeof dependency === 'string' && buildServiceNames.has(dependency)
        );
      });

      // Compose is also widely used as a build/test matrix for libraries. A
      // collection of Dockerfiles is therefore not sufficient proof of an
      // operational service platform: require explicit runtime orchestration.
      if (endpointBearingBuilds.size >= 2 || hasBuildServiceDependency) return true;
    } catch {
      // Invalid Compose input is diagnosed by its owning provider. Taxonomy
      // must remain conservative instead of inferring a platform from it.
    }
  }
  return false;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await fsExtra.pathExists(filePath))) {
      return null;
    }
    const raw = await fsExtra.readJSON(filePath);
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readFirstProjectMetadata(
  candidates: string[]
): Promise<Record<string, unknown> | null> {
  for (const candidate of candidates) {
    const payload = await readJsonIfExists(candidate);
    if (payload) {
      return payload;
    }
  }
  return null;
}

function normalizeProjectKind(raw: unknown): WorkspaceProjectKind | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toLowerCase() as WorkspaceProjectKind;
  if (!PROJECT_KIND_VALUES.has(normalized)) {
    return null;
  }
  // `service` was the pre-taxonomy backend value. Read it forever, but do not
  // keep emitting it into new model/graph generations.
  return normalized === 'service' ? 'backend' : normalized;
}

export function categorizeWorkspaceProjectKind(
  kind: WorkspaceProjectKind
): WorkspaceProjectCategory {
  switch (kind) {
    case 'backend':
    case 'service':
    case 'worker':
      return 'backend';
    case 'frontend':
    case 'desktop':
    case 'extension':
    case 'library':
    case 'platform':
      return kind;
    case 'infra':
      return 'infrastructure';
    case 'docs':
      return 'documentation';
    case 'test-suite':
      return 'quality';
    default:
      return 'unknown';
  }
}

export async function inferWorkspaceProjectKind(
  projectPath: string,
  projectJson?: Record<string, unknown> | null,
  hints: WorkspaceProjectKindHints = {}
): Promise<WorkspaceProjectKind> {
  const metadata =
    projectJson ??
    (await readFirstProjectMetadata(projectMetadataCandidates(projectPath, 'project.json')));
  const metadataKind = normalizeProjectKind(metadata?.kind) ?? normalizeProjectKind(metadata?.type);
  if (metadataKind) {
    return metadataKind;
  }

  const kit =
    typeof metadata?.kit_name === 'string'
      ? metadata.kit_name
      : typeof metadata?.kit === 'string'
        ? metadata.kit
        : hints.kit;
  const framework = typeof metadata?.framework === 'string' ? metadata.framework : hints.framework;
  const runtime = typeof metadata?.runtime === 'string' ? metadata.runtime : hints.runtime;
  const serviceSignals = `${typeof kit === 'string' ? kit : ''} ${framework ?? ''} ${runtime ?? ''}`
    .trim()
    .toLowerCase();

  if (await hasMultiServiceComposeTopology(projectPath)) {
    return 'platform';
  }

  if (/\b(tauri|electron|wails|desktop)\b/.test(serviceSignals)) {
    return 'desktop';
  }

  if (
    /\b(vscode-extension|visual studio code extension|jetbrains-plugin|browser-extension)\b/.test(
      serviceSignals
    )
  ) {
    return 'extension';
  }

  if (
    /\b(frontend|nextjs|next\.js|react|vue|svelte|vite|angular|astro|remix|nuxt)\b/.test(
      serviceSignals
    )
  ) {
    return 'frontend';
  }

  if (
    /\b(fastapi|nestjs|springboot|spring boot|gofiber|gogin|webapi|django|flask|express|fastify|laravel|rails|phoenix|axum|actix|rocket)\b/.test(
      serviceSignals
    )
  ) {
    return 'backend';
  }

  const cargoToml = await fsExtra
    .readFile(path.join(projectPath, 'Cargo.toml'), 'utf8')
    .catch(() => '');
  const isCargoWorkspace =
    /^\s*\[workspace\]\s*$/m.test(cargoToml) && !/^\s*\[package\]\s*$/m.test(cargoToml);
  const packageJson = await readJsonIfExists(path.join(projectPath, 'package.json'));
  if (packageJson) {
    const dependencies = {
      ...((packageJson.dependencies as Record<string, unknown> | undefined) ?? {}),
      ...((packageJson.devDependencies as Record<string, unknown> | undefined) ?? {}),
    };
    const scripts = ((packageJson.scripts as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    const scriptText = Object.values(scripts)
      .filter((item): item is string => typeof item === 'string')
      .join(' ')
      .toLowerCase();
    const engines = ((packageJson.engines as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    const categories = Array.isArray(packageJson.categories)
      ? packageJson.categories.filter((item): item is string => typeof item === 'string')
      : [];
    const hasWorkspaceDeclaration =
      Array.isArray(packageJson.workspaces) ||
      (packageJson.workspaces !== null && typeof packageJson.workspaces === 'object');

    if (
      dependencies['@tauri-apps/api'] ||
      dependencies['@tauri-apps/cli'] ||
      (await fsExtra.pathExists(path.join(projectPath, 'src-tauri', 'tauri.conf.json'))) ||
      (await fsExtra.pathExists(path.join(projectPath, 'src-tauri', 'tauri.conf.json5')))
    ) {
      return 'desktop';
    }
    if (
      dependencies.electron ||
      dependencies['@electron-forge/cli'] ||
      scriptText.includes('electron-forge') ||
      scriptText.includes('electron ')
    ) {
      return 'desktop';
    }
    if (
      typeof engines.vscode === 'string' ||
      categories.some((category) => category.toLowerCase() === 'extension packs') ||
      (packageJson.publisher && (packageJson.activationEvents || packageJson.contributes))
    ) {
      return 'extension';
    }

    if (
      dependencies.next ||
      dependencies.react ||
      dependencies.vue ||
      dependencies.svelte ||
      dependencies.vite ||
      dependencies['@angular/core'] ||
      scriptText.includes('next ') ||
      scriptText.includes('vite ')
    ) {
      return 'frontend';
    }
    if (hasWorkspaceDeclaration || isCargoWorkspace) {
      return 'platform';
    }
    if (packageJson.private === true && !dependencies.express && !dependencies['@nestjs/core']) {
      return 'library';
    }
  }

  if (isCargoWorkspace) {
    return 'platform';
  }

  if (await hasJvmModuleAggregator(projectPath)) {
    return 'platform';
  }

  const hasGoWorkspace = await fsExtra.pathExists(path.join(projectPath, 'go.work'));
  if (hasGoWorkspace) {
    return 'platform';
  }

  if (
    (await fsExtra.pathExists(path.join(projectPath, 'go.mod'))) &&
    (await hasMultipleGoCommandPackages(projectPath))
  ) {
    return 'platform';
  }

  if (await hasNativeBindingLibraryTopology(projectPath, runtime)) {
    return 'library';
  }

  if (
    (await fsExtra.pathExists(path.join(projectPath, 'Dockerfile'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'compose.yaml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'compose.yml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'docker-compose.yml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'docker-compose.yaml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'terraform.tf')))
  ) {
    return 'infra';
  }

  return 'backend';
}
