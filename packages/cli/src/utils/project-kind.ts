import path from 'path';

import fsExtra from 'fs-extra';
import { projectMetadataCandidates } from './workspace-paths.js';

export type WorkspaceProjectKind =
  | 'backend'
  | 'frontend'
  | 'desktop'
  | 'extension'
  | 'service'
  | 'worker'
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
  | 'library'
  | 'infrastructure'
  | 'documentation'
  | 'quality'
  | 'unknown';

const PROJECT_KIND_VALUES = new Set<WorkspaceProjectKind>([
  'backend',
  'desktop',
  'extension',
  'service',
  'frontend',
  'worker',
  'library',
  'infra',
  'docs',
  'test-suite',
  'unknown',
]);

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
  projectJson?: Record<string, unknown> | null
): Promise<WorkspaceProjectKind> {
  const metadata =
    projectJson ??
    (await readFirstProjectMetadata(projectMetadataCandidates(projectPath, 'project.json')));
  const metadataKind = normalizeProjectKind(metadata?.kind) ?? normalizeProjectKind(metadata?.type);
  if (metadataKind) {
    return metadataKind;
  }

  const kit = typeof metadata?.kit_name === 'string' ? metadata.kit_name : metadata?.kit;
  const framework = typeof metadata?.framework === 'string' ? metadata.framework : null;
  const runtime = typeof metadata?.runtime === 'string' ? metadata.runtime : null;
  const serviceSignals = `${typeof kit === 'string' ? kit : ''} ${framework ?? ''} ${runtime ?? ''}`
    .trim()
    .toLowerCase();

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
    /\b(fastapi|nestjs|springboot|spring boot|gofiber|gogin|dotnet|webapi|django|flask|express|fastify|python|node|java|go|rust|php|ruby|elixir)\b/.test(
      serviceSignals
    )
  ) {
    return 'backend';
  }

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
    if (packageJson.private === true && !dependencies.express && !dependencies['@nestjs/core']) {
      return 'library';
    }
  }

  if (
    (await fsExtra.pathExists(path.join(projectPath, 'Dockerfile'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'docker-compose.yml'))) ||
    (await fsExtra.pathExists(path.join(projectPath, 'terraform.tf')))
  ) {
    return 'infra';
  }

  return 'backend';
}
