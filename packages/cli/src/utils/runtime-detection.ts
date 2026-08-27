import fs from 'fs';
import path from 'path';

import {
  detectBackendFrameworkFromProject,
  detectBackendFrameworkFromHints,
  isWorkspaiManagedLinkedProjectMetadata,
} from './backend-framework-contract.js';
import { projectMetadataCandidates } from './workspace-paths.js';

export type RapidkitProjectJson = Record<string, unknown> | null;

export function detectBackendRuntime(
  projectJson: RapidkitProjectJson,
  projectPath: string
): string {
  const authoredProjectJson = isWorkspaiManagedLinkedProjectMetadata(projectJson)
    ? null
    : projectJson;
  const hinted = detectBackendFrameworkFromHints({
    runtime:
      typeof authoredProjectJson?.runtime === 'string'
        ? (authoredProjectJson.runtime as string)
        : undefined,
    framework:
      typeof authoredProjectJson?.framework === 'string'
        ? (authoredProjectJson.framework as string)
        : undefined,
    kitName:
      typeof authoredProjectJson?.kit_name === 'string'
        ? (authoredProjectJson.kit_name as string)
        : typeof authoredProjectJson?.kit === 'string'
          ? (authoredProjectJson.kit as string)
          : undefined,
  });

  if (hinted.runtime !== 'unknown') {
    return hinted.runtime;
  }

  return detectBackendFrameworkFromProject(projectPath, authoredProjectJson).runtime;
}

export function readRapidkitProjectJson(start: string): RapidkitProjectJson {
  let currentPath = start;

  while (true) {
    for (const candidate of projectMetadataCandidates(currentPath, 'project.json')) {
      if (fs.existsSync(candidate)) {
        try {
          return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        } catch {
          return null;
        }
      }
    }

    const parent = path.dirname(currentPath);
    if (parent === currentPath) break;
    currentPath = parent;
  }

  return null;
}

export function isGoProject(projectJson: RapidkitProjectJson, projectPath: string): boolean {
  return detectBackendRuntime(projectJson, projectPath) === 'go';
}

export function isNodeProject(projectJson: RapidkitProjectJson, projectPath: string): boolean {
  return detectBackendRuntime(projectJson, projectPath) === 'node';
}

export function isJavaProject(projectJson: RapidkitProjectJson, projectPath: string): boolean {
  return detectBackendRuntime(projectJson, projectPath) === 'java';
}

export function isDotnetProject(projectJson: RapidkitProjectJson, projectPath: string): boolean {
  return detectBackendRuntime(projectJson, projectPath) === 'dotnet';
}

export function isPythonProject(projectJson: RapidkitProjectJson, projectPath: string): boolean {
  return detectBackendRuntime(projectJson, projectPath) === 'python';
}
