import path from 'path';

export type DoctorRepairFixKind =
  | 'package-json-script'
  | 'file-create'
  | 'file-append'
  | 'file-copy'
  | 'dependency-sync'
  | 'command'
  | 'manual';

export type DoctorRepairRisk = 'safe' | 'guarded' | 'invasive';

export type DoctorRepairCapabilityStatus = 'available' | 'manual' | 'blocked';

export interface DoctorCommandInvocation {
  cwd: string;
  executable: string;
  args: string[];
}

export interface DoctorRepairStrategyStage {
  id: string;
  kind: 'diagnose' | 'safe-fix' | 'targeted-upgrade' | 'verify' | 'exception-review';
  description: string;
  risk: DoctorRepairRisk;
  invocation?: DoctorCommandInvocation;
  continueWhen: 'always' | 'previous-passed' | 'blocker-remains' | 'manual-decision';
}

type DoctorDependencyRepairTransactionBase = {
  schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1';
  state: 'planned';
  projectPath: string;
  ecosystem: string;
};

export type DoctorDependencyRepairTransaction =
  | (DoctorDependencyRepairTransactionBase & {
      kind: 'dependency-security';
      requiredStages: Array<'reconcile' | 'audit' | 'test' | 'build'>;
      completion: {
        manifestLockConsistent: true;
        auditClean: true;
        declaredTestsPass: true;
        declaredBuildPass: true;
        canonicalVerificationRequired: true;
      };
    })
  | (DoctorDependencyRepairTransactionBase & {
      kind: 'dependency-materialization';
      sourceMutationRequired: false;
      observableState: 'runtime-dependency-tree';
      requiredStages: Array<'reconcile' | 'test' | 'build'>;
      completion: {
        manifestLockConsistent: true;
        installedTreePresent: true;
        declaredTestsPass: true;
        declaredBuildPass: true;
        canonicalVerificationRequired: true;
      };
    });

export type DoctorRepairOperation =
  | {
      type: 'file-create';
      path: string;
      content: string;
      overwrite: false;
    }
  | {
      type: 'file-append';
      path: string;
      lines: string[];
      ensureNewline: boolean;
    }
  | {
      type: 'file-copy';
      sourcePath: string;
      path: string;
      overwrite: false;
    }
  | {
      type: 'package-json-script';
      path: string;
      scriptName: string;
      scriptValue: string;
    }
  | {
      type: 'json-edit';
      path: string;
      edits: Array<{
        pointer: string;
        value: string | number | boolean | null;
      }>;
    }
  | {
      type: 'env-key-add';
      path: string;
      keys: Array<{
        name: string;
        value: string;
        comment?: string;
      }>;
    }
  | {
      type: 'makefile-target';
      path: string;
      target: string;
      command: string;
      phony: boolean;
    };

export interface DoctorRepairCapability {
  id: string;
  issueId: string;
  title: string;
  status: DoctorRepairCapabilityStatus;
  fixKind: DoctorRepairFixKind;
  risk: DoctorRepairRisk;
  canAutoFix: boolean;
  canEditFiles: boolean;
  requiresApproval: boolean;
  requiresReview: boolean;
  files: string[];
  command?: string;
  invocation?: DoctorCommandInvocation;
  strategy?: DoctorRepairStrategyStage[];
  transaction?: DoctorDependencyRepairTransaction;
  operation?: DoctorRepairOperation;
  verifyCommand?: string;
  refreshCommands: string[];
  reason: string;
  limitations?: string[];
}

function quoteForShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildPackageScriptRepairCommand(input: {
  projectPath: string;
  scriptName: string;
  scriptValue: string;
}): string {
  const assignment = `scripts.${input.scriptName}=${input.scriptValue}`;
  return `cd ${quoteForShell(input.projectPath)} && npm pkg set ${quoteForShell(assignment)}`;
}

export function buildDoctorInternalRepairCommand(operation: DoctorRepairOperation): string {
  const encoded = Buffer.from(JSON.stringify(operation), 'utf8').toString('base64url');
  return `workspai:doctor:repair ${encoded}`;
}

export function buildDependencyMaterializationRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  ecosystem: string;
  executable: string;
  args: string[];
  files: string[];
  command: string;
  reason: string;
  limitations?: string[];
}): DoctorRepairCapability {
  return {
    id: `${input.issueId}.dependency-materialization`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: 'dependency-sync',
    risk: 'guarded',
    canAutoFix: true,
    canEditFiles: false,
    requiresApproval: true,
    requiresReview: false,
    files: input.files.map((file) => path.join(input.projectPath, file)),
    command: input.command,
    invocation: {
      cwd: input.projectPath,
      executable: input.executable,
      args: [...input.args],
    },
    transaction: {
      schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
      kind: 'dependency-materialization',
      state: 'planned',
      projectPath: input.projectPath,
      ecosystem: input.ecosystem,
      sourceMutationRequired: false,
      observableState: 'runtime-dependency-tree',
      requiredStages: ['reconcile', 'test', 'build'],
      completion: {
        manifestLockConsistent: true,
        installedTreePresent: true,
        declaredTestsPass: true,
        declaredBuildPass: true,
        canonicalVerificationRequired: true,
      },
    },
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

export function buildFileCreateRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  relativePath: string;
  content: string;
  reason: string;
  risk?: DoctorRepairRisk;
  requiresReview?: boolean;
  limitations?: string[];
}): DoctorRepairCapability {
  const filePath = path.join(input.projectPath, input.relativePath);
  const operation: DoctorRepairOperation = {
    type: 'file-create',
    path: filePath,
    content: input.content,
    overwrite: false,
  };

  return {
    id: `${input.issueId}.file-create`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: 'file-create',
    risk: input.risk ?? 'safe',
    canAutoFix: true,
    canEditFiles: true,
    requiresApproval: true,
    requiresReview: input.requiresReview ?? false,
    files: [filePath],
    command: buildDoctorInternalRepairCommand(operation),
    operation,
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

export function buildFileAppendRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  relativePath: string;
  lines: string[];
  reason: string;
  risk?: DoctorRepairRisk;
  requiresReview?: boolean;
  limitations?: string[];
}): DoctorRepairCapability {
  const filePath = path.join(input.projectPath, input.relativePath);
  const operation: DoctorRepairOperation = {
    type: 'file-append',
    path: filePath,
    lines: input.lines,
    ensureNewline: true,
  };

  return {
    id: `${input.issueId}.file-append`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: 'file-append',
    risk: input.risk ?? 'safe',
    canAutoFix: true,
    canEditFiles: true,
    requiresApproval: true,
    requiresReview: input.requiresReview ?? false,
    files: [filePath],
    command: buildDoctorInternalRepairCommand(operation),
    operation,
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

export function buildFileCopyRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  sourceRelativePath: string;
  targetRelativePath: string;
  reason: string;
  risk?: DoctorRepairRisk;
  requiresReview?: boolean;
  limitations?: string[];
}): DoctorRepairCapability {
  const sourcePath = path.join(input.projectPath, input.sourceRelativePath);
  const targetPath = path.join(input.projectPath, input.targetRelativePath);
  const operation: DoctorRepairOperation = {
    type: 'file-copy',
    sourcePath,
    path: targetPath,
    overwrite: false,
  };

  return {
    id: `${input.issueId}.file-copy`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: 'file-copy',
    risk: input.risk ?? 'safe',
    canAutoFix: true,
    canEditFiles: true,
    requiresApproval: true,
    requiresReview: input.requiresReview ?? false,
    files: [sourcePath, targetPath],
    command: buildDoctorInternalRepairCommand(operation),
    operation,
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

export function inferFrontendTestScriptValue(scripts: Record<string, string>): string | null {
  if (scripts.lint && scripts.lint.trim().length > 0) {
    return 'npm run lint';
  }

  if (scripts.build && scripts.build.trim().length > 0) {
    return 'npm run build';
  }

  return null;
}

export function buildMissingPackageScriptRepairCapability(input: {
  projectPath: string;
  frameworkDisplayName: string;
  scriptName: string;
  scriptValue: string | null;
}): DoctorRepairCapability {
  const issueId = `frontend-script-${input.scriptName}`;
  const packageJsonPath = path.join(input.projectPath, 'package.json');
  const refreshCommands = [
    'npx workspai doctor project --json',
    'npx workspai workspace verify --json',
  ];

  if (!input.scriptValue) {
    return {
      id: `${issueId}.manual`,
      issueId,
      title: `Define ${input.scriptName} script`,
      status: 'manual',
      fixKind: 'manual',
      risk: 'guarded',
      canAutoFix: false,
      canEditFiles: false,
      requiresApproval: true,
      requiresReview: true,
      files: [packageJsonPath],
      refreshCommands,
      reason: `No safe ${input.frameworkDisplayName} fallback script could be inferred from existing package.json scripts.`,
      limitations: [
        'Add a real test/lint/build command that matches the project quality gate before release.',
      ],
    };
  }

  return {
    id: `${issueId}.package-json-script`,
    issueId,
    title: `Add package.json ${input.scriptName} script`,
    status: 'available',
    fixKind: 'package-json-script',
    risk: 'guarded',
    canAutoFix: true,
    canEditFiles: true,
    requiresApproval: true,
    requiresReview: false,
    files: [packageJsonPath],
    command: buildPackageScriptRepairCommand({
      projectPath: input.projectPath,
      scriptName: input.scriptName,
      scriptValue: input.scriptValue,
    }),
    operation: {
      type: 'package-json-script',
      path: packageJsonPath,
      scriptName: input.scriptName,
      scriptValue: input.scriptValue,
    },
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands,
    reason: `Reuse the existing ${input.scriptValue} validation path as the ${input.scriptName} gate for ${input.frameworkDisplayName}.`,
  };
}

export function buildPackageScriptRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  scriptName: string;
  scriptValue: string;
  reason: string;
  risk?: DoctorRepairRisk;
  requiresReview?: boolean;
  limitations?: string[];
}): DoctorRepairCapability {
  const packageJsonPath = path.join(input.projectPath, 'package.json');

  return {
    id: `${input.issueId}.package-json-script`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: 'package-json-script',
    risk: input.risk ?? 'guarded',
    canAutoFix: true,
    canEditFiles: true,
    requiresApproval: true,
    requiresReview: input.requiresReview ?? false,
    files: [packageJsonPath],
    command: buildPackageScriptRepairCommand({
      projectPath: input.projectPath,
      scriptName: input.scriptName,
      scriptValue: input.scriptValue,
    }),
    operation: {
      type: 'package-json-script',
      path: packageJsonPath,
      scriptName: input.scriptName,
      scriptValue: input.scriptValue,
    },
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

export function buildMakefileTargetRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  targetName: string;
  command: string;
  reason: string;
  risk?: DoctorRepairRisk;
  requiresReview?: boolean;
  limitations?: string[];
}): DoctorRepairCapability {
  const filePath = path.join(input.projectPath, 'Makefile');
  const operation: DoctorRepairOperation = {
    type: 'makefile-target',
    path: filePath,
    target: input.targetName,
    command: input.command,
    phony: true,
  };

  return {
    id: `${input.issueId}.makefile-target`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: 'file-append',
    risk: input.risk ?? 'guarded',
    canAutoFix: true,
    canEditFiles: true,
    requiresApproval: true,
    requiresReview: input.requiresReview ?? true,
    files: [filePath],
    command: buildDoctorInternalRepairCommand(operation),
    operation,
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

export function buildCommandRepairCapability(input: {
  issueId: string;
  title: string;
  projectPath: string;
  command: string;
  invocation?: {
    executable: string;
    args: string[];
  };
  strategy?: DoctorRepairStrategyStage[];
  transaction?: DoctorDependencyRepairTransaction;
  files: string[];
  reason: string;
  fixKind?: DoctorRepairFixKind;
  risk?: DoctorRepairRisk;
  requiresReview?: boolean;
  limitations?: string[];
}): DoctorRepairCapability {
  return {
    id: `${input.issueId}.command`,
    issueId: input.issueId,
    title: input.title,
    status: 'available',
    fixKind: input.fixKind ?? 'command',
    risk: input.risk ?? 'guarded',
    canAutoFix: true,
    canEditFiles: false,
    requiresApproval: true,
    requiresReview: input.requiresReview ?? true,
    files: input.files.map((file) => path.join(input.projectPath, file)),
    command: `cd ${quoteForShell(input.projectPath)} && ${input.command}`,
    ...(input.invocation
      ? {
          invocation: {
            cwd: input.projectPath,
            executable: input.invocation.executable,
            args: [...input.invocation.args],
          },
        }
      : {}),
    ...(input.strategy ? { strategy: input.strategy.map((stage) => ({ ...stage })) } : {}),
    ...(input.transaction ? { transaction: structuredClone(input.transaction) } : {}),
    verifyCommand: 'npx workspai doctor project --json',
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}
