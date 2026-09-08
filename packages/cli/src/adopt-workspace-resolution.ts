import path from 'node:path';

import {
  assessWorkspaceBootstrapEligibility,
  formatWorkspaceBootstrapConflictMessage,
  isReasonableWorkspaceParent,
  type WorkspaceBootstrapAssessment,
} from './utils/workspace-bootstrap-eligibility.js';
import { resolveManagedDefaultImportWorkspacePath } from './utils/workspace-paths.js';

export type AdoptWorkspaceResolutionMode =
  'nearest' | 'explicit' | 'explicit-bootstrap' | 'default-auto' | 'parent-bootstrap';

export type AdoptOutsideWorkspaceMode = 'managed' | 'parent';

export interface ResolveAdoptWorkspaceTargetInput {
  sourcePath: string;
  dryRun?: boolean;
  outsideWorkspaceMode?: AdoptOutsideWorkspaceMode;
}

export interface ResolveAdoptWorkspaceTargetResult {
  workspacePath: string;
  resolution: AdoptWorkspaceResolutionMode;
  usedDefaultWorkspace: boolean;
  willCreateDefaultWorkspace: boolean;
  willBootstrapWorkspace: boolean;
  bootstrapTargetPath: string | null;
}

export interface AdoptOutsideWorkspaceChoice {
  parentEligible: boolean;
  parentAssessment: WorkspaceBootstrapAssessment;
}

export async function resolveAdoptOutsideWorkspaceChoice(input: {
  sourcePath: string;
}): Promise<AdoptOutsideWorkspaceChoice> {
  const sourcePath = path.resolve(input.sourcePath);
  const parentPath = path.dirname(sourcePath);
  const parentAssessment = await assessWorkspaceBootstrapEligibility(parentPath, {
    containedProjectPath: sourcePath,
  });
  const parentEligible =
    isReasonableWorkspaceParent(parentPath) &&
    (parentAssessment.status === 'eligible' || parentAssessment.status === 'valid-workspace');

  return {
    parentEligible,
    parentAssessment,
  };
}

export async function resolveExplicitAdoptWorkspaceTarget(
  explicitWorkspace: string,
  options: { dryRun?: boolean } = {}
): Promise<
  | { ok: true; result: ResolveAdoptWorkspaceTargetResult }
  | {
      ok: false;
      message: string;
      code: 'workspace.adopt.target-not-clean';
    }
> {
  const workspacePath = path.resolve(explicitWorkspace);
  const assessment = await assessWorkspaceBootstrapEligibility(workspacePath);

  if (assessment.status === 'valid-workspace') {
    return {
      ok: true,
      result: {
        workspacePath,
        resolution: 'explicit',
        usedDefaultWorkspace: false,
        willCreateDefaultWorkspace: false,
        willBootstrapWorkspace: false,
        bootstrapTargetPath: null,
      },
    };
  }

  if (assessment.status === 'eligible') {
    return {
      ok: true,
      result: {
        workspacePath,
        resolution: 'explicit-bootstrap',
        usedDefaultWorkspace: false,
        willCreateDefaultWorkspace: false,
        willBootstrapWorkspace: options.dryRun !== true,
        bootstrapTargetPath: workspacePath,
      },
    };
  }

  return {
    ok: false,
    code: 'workspace.adopt.target-not-clean',
    message: formatWorkspaceBootstrapConflictMessage(workspacePath, assessment),
  };
}

export async function resolveOutsideWorkspaceAdoptTarget(
  input: ResolveAdoptWorkspaceTargetInput
): Promise<
  | { ok: true; result: ResolveAdoptWorkspaceTargetResult }
  | { ok: false; message: string; code: string }
> {
  const sourcePath = path.resolve(input.sourcePath);
  const parentPath = path.dirname(sourcePath);
  const parentAssessment = await assessWorkspaceBootstrapEligibility(parentPath, {
    containedProjectPath: sourcePath,
  });
  const chosenMode = input.outsideWorkspaceMode ?? 'managed';

  if (chosenMode === 'managed') {
    const workspacePath = resolveManagedDefaultImportWorkspacePath();
    return {
      ok: true,
      result: {
        workspacePath,
        resolution: 'default-auto',
        usedDefaultWorkspace: true,
        willCreateDefaultWorkspace: input.dryRun !== true,
        willBootstrapWorkspace: false,
        bootstrapTargetPath: null,
      },
    };
  }

  if (chosenMode === 'parent') {
    if (!isReasonableWorkspaceParent(parentPath)) {
      return {
        ok: false,
        code: 'workspace.adopt.parent-not-eligible',
        message: `Parent folder cannot be turned into a workspace: ${parentPath}`,
      };
    }
    if (parentAssessment.status === 'valid-workspace') {
      return {
        ok: true,
        result: {
          workspacePath: parentPath,
          resolution: 'nearest',
          usedDefaultWorkspace: false,
          willCreateDefaultWorkspace: false,
          willBootstrapWorkspace: false,
          bootstrapTargetPath: null,
        },
      };
    }
    if (parentAssessment.status === 'eligible') {
      return {
        ok: true,
        result: {
          workspacePath: parentPath,
          resolution: 'parent-bootstrap',
          usedDefaultWorkspace: false,
          willCreateDefaultWorkspace: false,
          willBootstrapWorkspace: input.dryRun !== true,
          bootstrapTargetPath: parentPath,
        },
      };
    }
    return {
      ok: false,
      code: 'workspace.adopt.parent-not-clean',
      message: formatWorkspaceBootstrapConflictMessage(parentPath, parentAssessment),
    };
  }

  return {
    ok: false,
    code: 'workspace.adopt.mode-invalid',
    message: `Unsupported adopt workspace mode: ${String(chosenMode)}`,
  };
}

export function buildAdoptOutsideWorkspacePromptChoices(): Array<{
  name: string;
  value: AdoptOutsideWorkspaceMode;
}> {
  return [
    {
      name: 'Link it to the managed default workspace',
      value: 'managed',
    },
    {
      name: 'Turn the parent folder into a workspace (recommended)',
      value: 'parent',
    },
  ];
}

export function defaultAdoptOutsideWorkspacePromptIndex(): number {
  return 1;
}
