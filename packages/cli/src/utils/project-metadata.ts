import fs from 'fs';
import path from 'path';
import fsExtra from 'fs-extra';

import {
  detectBackendFrameworkFromProject,
  detectBackendFrameworkFromHints,
  isWorkspaiManagedLinkedProjectMetadata,
  type BackendFrameworkDetection,
} from './backend-framework-contract.js';
import { resolveKitDefinition } from './kit-registry.js';
import { readRapidkitProjectJson, type RapidkitProjectJson } from './runtime-detection.js';
import { projectMetadataCandidates, projectMetadataPath } from './workspace-paths.js';

const CANONICAL_PROJECT_METADATA_FILES = [
  'project.json',
  'context.json',
  'file-hashes.json',
] as const;

export async function canonicalizeProjectMetadata(projectRoot: string): Promise<string[]> {
  const root = path.resolve(projectRoot);
  const written: string[] = [];
  for (const fileName of CANONICAL_PROJECT_METADATA_FILES) {
    const canonicalPath = projectMetadataPath(root, fileName);
    if (await fsExtra.pathExists(canonicalPath)) continue;
    const legacyPath = path.join(root, '.rapidkit', fileName);
    if (!(await fsExtra.pathExists(legacyPath))) continue;
    const payload = await fsExtra.readJson(legacyPath);
    await fsExtra.ensureDir(path.dirname(canonicalPath));
    const temporaryPath = `${canonicalPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsExtra.writeJson(temporaryPath, payload, { spaces: 2 });
      await fsExtra.move(temporaryPath, canonicalPath, { overwrite: false });
      written.push(canonicalPath);
    } finally {
      await fsExtra.remove(temporaryPath).catch(() => undefined);
    }
  }
  return written;
}

export type RapidkitContextJson = Record<string, unknown> | null;

export interface ProjectMetadata {
  projectRoot: string;
  projectJson: RapidkitProjectJson;
  contextJson: RapidkitContextJson;
  detection: BackendFrameworkDetection;
  moduleSupport: boolean;
  engine: ProjectEngine;
}

export type ProjectEngine =
  'npm' | 'pip' | 'python' | 'poetry' | 'venv' | 'pipx' | 'uv' | 'unknown';

export function readRapidkitContextJson(projectRoot: string): RapidkitContextJson {
  for (const contextPath of projectMetadataCandidates(projectRoot, 'context.json')) {
    if (!fs.existsSync(contextPath)) {
      continue;
    }
    try {
      return JSON.parse(fs.readFileSync(contextPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function readContextEngine(contextJson: RapidkitContextJson): ProjectMetadata['engine'] {
  const engine = contextJson?.engine;
  if (
    engine === 'npm' ||
    engine === 'pip' ||
    engine === 'python' ||
    engine === 'poetry' ||
    engine === 'venv' ||
    engine === 'pipx' ||
    engine === 'uv'
  ) {
    return engine;
  }
  return 'unknown';
}

function resolveModuleSupport(
  projectJson: RapidkitProjectJson,
  contextJson: RapidkitContextJson
): boolean {
  if (projectJson?.module_support === false || contextJson?.module_support === false) {
    return false;
  }

  if (!projectJson && contextJson) {
    return false;
  }

  const kitName =
    typeof projectJson?.kit_name === 'string'
      ? projectJson.kit_name
      : typeof projectJson?.kit === 'string'
        ? projectJson.kit
        : typeof contextJson?.kit === 'string'
          ? contextJson.kit
          : undefined;
  const kit = kitName ? resolveKitDefinition(kitName) : undefined;
  if (kit?.owner === 'core' && kit.moduleSupport === true) {
    return true;
  }

  return false;
}

function resolveDetection(
  projectRoot: string,
  projectJson: RapidkitProjectJson,
  contextJson: RapidkitContextJson
): BackendFrameworkDetection {
  const authoredProjectJson = isWorkspaiManagedLinkedProjectMetadata(projectJson)
    ? null
    : projectJson;
  const hinted = detectBackendFrameworkFromHints({
    runtime:
      typeof authoredProjectJson?.runtime === 'string'
        ? authoredProjectJson.runtime
        : typeof contextJson?.runtime === 'string'
          ? (contextJson.runtime as string)
          : undefined,
    framework:
      typeof authoredProjectJson?.framework === 'string'
        ? authoredProjectJson.framework
        : typeof contextJson?.framework === 'string'
          ? (contextJson.framework as string)
          : undefined,
    kitName:
      typeof authoredProjectJson?.kit_name === 'string'
        ? authoredProjectJson.kit_name
        : typeof authoredProjectJson?.kit === 'string'
          ? authoredProjectJson.kit
          : typeof contextJson?.kit === 'string'
            ? (contextJson.kit as string)
            : undefined,
  });

  if (hinted.key !== 'unknown') {
    return hinted;
  }

  return detectBackendFrameworkFromProject(projectRoot, authoredProjectJson);
}

export function readProjectMetadata(projectRoot: string): ProjectMetadata | null {
  const resolvedRoot = path.resolve(projectRoot);
  const hasProjectMetadata = [
    ...projectMetadataCandidates(resolvedRoot, 'project.json'),
    ...projectMetadataCandidates(resolvedRoot, 'context.json'),
  ].some((candidate) => fs.existsSync(candidate));
  if (!hasProjectMetadata) {
    return null;
  }

  const projectJson = readRapidkitProjectJson(resolvedRoot);
  const contextJson = readRapidkitContextJson(resolvedRoot);
  const detection = resolveDetection(resolvedRoot, projectJson, contextJson);

  return {
    projectRoot: resolvedRoot,
    projectJson,
    contextJson,
    detection,
    moduleSupport: resolveModuleSupport(projectJson, contextJson),
    engine: readContextEngine(contextJson),
  };
}
