/** Portable argv data, never a shell program assembled from a user request. */
export type AgentTaskRecovery = {
  kind: 'retry' | 'select-project' | 'select-path' | 'select-workspace' | 'native';
  message: string;
  requiredOption?: '--project' | '--path' | '--workspace' | '--workspace-default';
  command?: {
    executable: 'workspai';
    args: string[];
    cwd: '.';
    cwdBase: 'request-project-directory';
  };
};

export type AgentTaskRequest = {
  task: string;
  forAgent: string;
  project: string;
  path?: string;
  workspaceChoice?: 'managed-default' | 'explicit';
  limit: number;
  maxBytes: number;
};

export function taskContextRetry(
  request: AgentTaskRequest,
  overrides: Partial<AgentTaskRequest> = {}
): AgentTaskRecovery {
  const input = { ...request, ...overrides };
  if (input.workspaceChoice === 'explicit') {
    return {
      kind: 'select-workspace',
      requiredOption: '--workspace',
      message: `Repeat the exact user-approved canonical workspace root with --workspace. Retry the same project and task with --limit ${input.limit} and --max-bytes ${input.maxBytes}; preserve the existing --path selection when present.`,
    };
  }
  return {
    kind: 'retry',
    message: 'Retry once with the exact packet options and preserve project, task and host.',
    command: {
      executable: 'workspai',
      args: [
        'agent',
        'context',
        '--project',
        input.project,
        '--task',
        input.task,
        '--for-agent',
        input.forAgent,
        '--limit',
        String(input.limit),
        '--max-bytes',
        String(input.maxBytes),
        ...(input.path === undefined ? [] : ['--path', input.path]),
        ...(input.workspaceChoice === 'managed-default' ? ['--workspace-default'] : []),
      ],
      cwd: '.',
      cwdBase: 'request-project-directory',
    },
  };
}
