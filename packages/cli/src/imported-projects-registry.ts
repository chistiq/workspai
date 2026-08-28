import crypto from 'node:crypto';
import fsExtra from 'fs-extra';
import * as path from 'path';
import { workspaceMetadataCandidates, workspaceMetadataPath } from './utils/workspace-paths.js';
import { withInterprocessLock } from './utils/interprocess-lock.js';

import type {
  BackendConfidence,
  BackendImportStack,
  BackendRuntimeFamily,
  BackendSupportTier,
} from './utils/backend-framework-contract.js';

export interface ImportedProjectRegistryEntry {
  name: string;
  path: string;
  relativePath?: string;
  stack: BackendImportStack;
  runtime?: BackendRuntimeFamily;
  framework?: string;
  frameworkDisplayName?: string;
  supportTier?: BackendSupportTier;
  moduleSupport?: boolean;
  confidence: BackendConfidence;
  source?: 'local-folder' | 'git-url' | 'adopted-local';
  relationship?: 'imported' | 'adopted';
  importedAt: string;
}

interface ImportedProjectsRegistryFile {
  version: 1;
  updatedAt: string;
  projects: ImportedProjectRegistryEntry[];
}

async function writeRegistryFileAtomic(
  filePath: string,
  payload: ImportedProjectsRegistryFile
): Promise<void> {
  await fsExtra.ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    await fsExtra.writeJSON(temporaryPath, payload, { spaces: 2 });
    await fsExtra.move(temporaryPath, filePath, { overwrite: true });
  } finally {
    await fsExtra.remove(temporaryPath).catch(() => undefined);
  }
}

function registryFilePath(workspacePath: string): string {
  return workspaceMetadataPath(workspacePath, 'imported-projects.json');
}

export async function readImportedProjectsRegistry(
  workspacePath: string
): Promise<ImportedProjectRegistryEntry[]> {
  const filePath = (
    await Promise.all(
      workspaceMetadataCandidates(workspacePath, 'imported-projects.json').map(async (candidate) =>
        (await fsExtra.pathExists(candidate)) ? candidate : null
      )
    )
  ).find((candidate): candidate is string => typeof candidate === 'string');

  if (!filePath) {
    return [];
  }

  try {
    const raw: unknown = await fsExtra.readJSON(filePath);
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as { version?: unknown }).version !== 1 ||
      !Array.isArray((raw as { projects?: unknown }).projects)
    ) {
      throw new Error('expected a version 1 registry with a projects array');
    }
    const projects = (raw as { projects: unknown[] }).projects;
    const validProjects = projects.filter((item: unknown): item is ImportedProjectRegistryEntry => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const candidate = item as ImportedProjectRegistryEntry;
      return (
        typeof candidate.name === 'string' &&
        typeof candidate.path === 'string' &&
        typeof candidate.stack === 'string' &&
        typeof candidate.confidence === 'string' &&
        typeof candidate.importedAt === 'string'
      );
    });
    if (validProjects.length !== projects.length) {
      throw new Error('one or more project entries are invalid');
    }
    return validProjects;
  } catch (error) {
    throw new Error(`Imported-project registry is invalid: ${filePath}`, { cause: error });
  }
}

export async function upsertImportedProjectsRegistry(
  workspacePath: string,
  entries: ImportedProjectRegistryEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const filePath = registryFilePath(workspacePath);
  await withInterprocessLock(
    `${filePath}.lock`,
    async () => {
      const existing = await readImportedProjectsRegistry(workspacePath);
      const byPath = new Map<string, ImportedProjectRegistryEntry>();

      for (const item of existing) byPath.set(item.path, item);
      for (const item of entries) byPath.set(item.path, item);

      const projects = Array.from(byPath.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({ ...item }));
      await writeRegistryFileAtomic(filePath, {
        version: 1,
        updatedAt: new Date().toISOString(),
        projects,
      });
    },
    { timeoutMs: 30_000, staleMs: 60_000, purpose: 'imported-projects-registry-upsert' }
  );
}

export async function removeImportedProjectsRegistryEntries(
  workspacePath: string,
  projectPaths: string[]
): Promise<void> {
  if (projectPaths.length === 0) {
    return;
  }

  const filePath = registryFilePath(workspacePath);
  await withInterprocessLock(
    `${filePath}.lock`,
    async () => {
      const existing = await readImportedProjectsRegistry(workspacePath);
      const blockedPaths = new Set(projectPaths.map((item) => path.resolve(item)));
      const projects = existing.filter((item) => !blockedPaths.has(path.resolve(item.path)));
      await writeRegistryFileAtomic(filePath, {
        version: 1,
        updatedAt: new Date().toISOString(),
        projects,
      });
    },
    { timeoutMs: 30_000, staleMs: 60_000, purpose: 'imported-projects-registry-remove' }
  );
}
