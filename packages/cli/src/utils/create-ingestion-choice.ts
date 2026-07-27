import path from 'node:path';
import { homedir } from 'node:os';

import { isGitUrl } from '../import-project.js';
import { hasWorkspaceRootMarkers } from './workspace-paths.js';

export type InteractiveCreateTarget = 'workspace' | 'project' | 'existing';

export type InteractiveCreateTargetChoice = {
  name: string;
  value: InteractiveCreateTarget;
};

export type ExistingSoftwareSourcePrompt = {
  type: 'input';
  name: 'source';
  message: string;
  validate: (value: string) => true | string;
};

export type ExistingSoftwareSource =
  | { kind: 'workspace-archive'; source: string }
  | { kind: 'git-project'; source: string }
  | { kind: 'local-workspace'; source: string }
  | { kind: 'local-project'; source: string };

export function buildInteractiveCreateTargetChoices(
  currentWorkspaceName?: string | null
): InteractiveCreateTargetChoice[] {
  const addExisting: InteractiveCreateTargetChoice = {
    name: 'Add existing software (local project, Git repository, or workspace)',
    value: 'existing',
  };
  if (currentWorkspaceName) {
    return [
      { name: 'Create a project', value: 'project' },
      addExisting,
      {
        name: 'Create another workspace (outside the current workspace)…',
        value: 'workspace',
      },
    ];
  }
  return [
    { name: 'Create a workspace', value: 'workspace' },
    { name: 'Create a project', value: 'project' },
    addExisting,
  ];
}

export function buildExistingSoftwareSourcePrompt(): ExistingSoftwareSourcePrompt {
  return {
    type: 'input',
    name: 'source',
    message: 'Local path, Git URL, or Workspai archive:',
    validate: (value: string) => value.trim().length > 0 || 'A source is required',
  };
}

export function classifyExistingSoftwareSource(rawSource: string): ExistingSoftwareSource {
  const trimmedSource = rawSource.trim();
  const expandedSource = trimmedSource.startsWith('~/')
    ? path.join(homedir(), trimmedSource.slice(2))
    : trimmedSource;
  const archive =
    /\.(?:workspai|rapidkit)-archive\.zip(?:[?#].*)?$/i.test(expandedSource) ||
    (!isGitUrl(expandedSource) && /\.zip$/i.test(expandedSource));
  if (archive) {
    return {
      kind: 'workspace-archive',
      source: isGitUrl(expandedSource) ? expandedSource : path.resolve(expandedSource),
    };
  }
  if (isGitUrl(expandedSource)) {
    return { kind: 'git-project', source: expandedSource };
  }
  const resolvedSource = path.resolve(expandedSource);
  if (hasWorkspaceRootMarkers(resolvedSource)) {
    return { kind: 'local-workspace', source: resolvedSource };
  }
  return { kind: 'local-project', source: resolvedSource };
}
