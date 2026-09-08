import { findRapidkitProjectRoot } from './project-command-capabilities.js';

export function missingShellActivationDiagnostic(start: string): string {
  const projectRoot = findRapidkitProjectRoot(start);
  return projectRoot
    ? `Workspai project found at ${projectRoot}, but no Python virtual environment or activation script is available.`
    : 'No Workspai project metadata, Python virtual environment, or activation script was found in this directory or its parents.';
}
