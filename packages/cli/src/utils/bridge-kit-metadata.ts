import fs from 'fs';
import path from 'path';

import fsExtra from 'fs-extra';

import { isPythonCoreContextEngine } from '../core-bridge/coreForwarding.js';
import { getVersion } from '../update-checker.js';
import { resolveKitDefinition, type KitDefinition } from './kit-registry.js';
import {
  LEGACY_RAPIDKIT_WORKSPACE_MARKER,
  WORKSPAI_WORKSPACE_MARKER,
  projectMetadataPath,
} from './workspace-paths.js';

export async function enrichBridgeBackedProjectMetadata(projectRoot: string): Promise<boolean> {
  const root = path.resolve(projectRoot);
  const projectJsonPath = projectMetadataPath(root, 'project.json');
  if (!(await fsExtra.pathExists(projectJsonPath))) {
    return false;
  }

  const existingProject = await readJsonRecord(projectJsonPath);
  if (!existingProject) {
    return false;
  }

  const kitName =
    (typeof existingProject.kit_name === 'string' && existingProject.kit_name) ||
    (typeof existingProject.kit === 'string' && existingProject.kit) ||
    undefined;
  const kit = resolveKitDefinition(kitName);
  if (!kit || kit.owner !== 'core') {
    return false;
  }

  const projectName = authoredString(existingProject.name) || path.basename(root);
  const pythonProjectEngine = await detectPythonInstallEngineFromProject(root);
  const contextJsonPath = projectMetadataPath(root, 'context.json');
  const existingContext = (await readJsonRecord(contextJsonPath)) ?? {};
  const contextEngine = await resolveBridgeContextEngine({
    kit,
    projectRoot: root,
    existingContextEngine: existingContext.engine,
    pythonProjectEngine,
  });
  const coreVersion = resolveRapidkitCoreVersion(existingProject);
  const generatedAt =
    authoredString(existingProject.generated_at) ||
    authoredString(existingProject.created_at) ||
    new Date().toISOString();

  const nextProject: Record<string, unknown> = {
    ...existingProject,
    schema_version:
      authoredString(existingProject.schema_version) ?? existingProject.schema_version ?? '1.0',
    name: authoredString(existingProject.name) || projectName,
    slug: authoredString(existingProject.slug) || projectName,
    kind: authoredString(existingProject.kind) || kit.category,
    project_type: authoredString(existingProject.project_type) || kit.category,
    category: authoredString(existingProject.category) || kit.category,
    runtime: authoredString(existingProject.runtime) || kit.runtime,
    framework: authoredString(existingProject.framework) || kit.framework,
    kit_name: kit.id,
    kit: authoredString(existingProject.kit) || kit.id,
    engine:
      kit.runtime === 'node'
        ? authoredString(existingProject.engine) === 'npm'
          ? existingProject.engine
          : 'npm'
        : pythonProjectEngine ||
          (isPythonCoreContextEngine(existingProject.engine)
            ? existingProject.engine
            : contextEngine),
    module_support:
      typeof existingProject.module_support === 'boolean'
        ? existingProject.module_support
        : kit.moduleSupport,
    workspai_version: authoredString(existingProject.workspai_version) || getVersion(),
    generated_by: authoredString(existingProject.generated_by) || 'workspai',
    generated_at: generatedAt,
    generator: existingProject.generator ?? {
      id: kit.id,
      source: 'rapidkit-core-bridge',
      official: false,
    },
  };
  if (coreVersion && nextProject.rapidkit_core_version === undefined) {
    nextProject.rapidkit_core_version = coreVersion;
  }

  const nextContext: Record<string, unknown> = {
    ...existingContext,
    engine: contextEngine,
    project: authoredString(existingContext.project) || projectName,
    kind: authoredString(existingContext.kind) || kit.category,
    category: authoredString(existingContext.category) || kit.category,
    runtime: authoredString(existingContext.runtime) || kit.runtime,
    framework: authoredString(existingContext.framework) || kit.framework,
    source: authoredString(existingContext.source) || 'core-bridge',
  };

  await fsExtra.ensureDir(path.dirname(projectJsonPath));
  await fsExtra.writeJson(projectJsonPath, nextProject, { spaces: 2 });
  await fsExtra.writeJson(contextJsonPath, nextContext, { spaces: 2 });
  return true;
}

function authoredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function resolveRapidkitCoreVersion(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.rapidkit_core_version === 'string' && payload.rapidkit_core_version.trim()) {
    return payload.rapidkit_core_version;
  }
  const generatedBy = authoredString(payload.generated_by);
  const createdBy = authoredString(payload.created_by);
  const version = authoredString(payload.rapidkit_version);
  if (!version) return undefined;
  if (generatedBy === 'workspai' || createdBy === 'workspai-cli-fallback') {
    return undefined;
  }
  if (payload.schema_version) {
    return undefined;
  }
  return version;
}

async function detectPythonInstallEngineFromProject(
  projectRoot: string
): Promise<'poetry' | 'uv' | 'pip' | undefined> {
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (await fsExtra.pathExists(pyprojectPath)) {
    const content = await fsExtra.readFile(pyprojectPath, 'utf8');
    if (/\[tool\.poetry\]/.test(content)) return 'poetry';
    if (/\[tool\.uv\]/.test(content)) return 'uv';
  }
  if (await fsExtra.pathExists(path.join(projectRoot, 'uv.lock'))) return 'uv';
  if (await fsExtra.pathExists(path.join(projectRoot, 'requirements.txt'))) return 'pip';
  return undefined;
}

async function resolveBridgeContextEngine(input: {
  kit: KitDefinition;
  projectRoot: string;
  existingContextEngine: unknown;
  pythonProjectEngine: 'poetry' | 'uv' | 'pip' | undefined;
}): Promise<string> {
  if (input.kit.runtime === 'python') {
    return (
      input.pythonProjectEngine ||
      fallbackPythonControlPlaneEngine(input.existingContextEngine) ||
      'pip'
    );
  }

  const existing = fallbackPythonControlPlaneEngine(input.existingContextEngine, {
    allowPip: false,
  });
  if (existing) return existing;
  const workspaceEngine = await detectWorkspacePythonControlPlaneEngine(input.projectRoot);
  if (workspaceEngine) return workspaceEngine;
  return fallbackPythonControlPlaneEngine(input.existingContextEngine) || 'pip';
}

function fallbackPythonControlPlaneEngine(
  value: unknown,
  options: { allowPip?: boolean } = {}
): string | undefined {
  if (!isPythonCoreContextEngine(value)) return undefined;
  if (options.allowPip === false && (value === 'pip' || value === 'python')) {
    return undefined;
  }
  return value;
}

async function detectWorkspacePythonControlPlaneEngine(
  startPath: string
): Promise<'poetry' | 'venv' | 'pipx' | undefined> {
  let current = path.resolve(startPath);
  while (true) {
    for (const markerName of [WORKSPAI_WORKSPACE_MARKER, LEGACY_RAPIDKIT_WORKSPACE_MARKER]) {
      const markerPath = path.join(current, markerName);
      if (!fs.existsSync(markerPath)) continue;
      const marker = await readJsonRecord(markerPath);
      const installMethod = (marker?.metadata as Record<string, unknown> | undefined)?.npm as
        Record<string, unknown> | undefined;
      const method = installMethod?.installMethod;
      if (method === 'poetry' || method === 'venv' || method === 'pipx') {
        return method;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  if (!(await fsExtra.pathExists(filePath))) return null;
  try {
    const payload = await fsExtra.readJson(filePath);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
