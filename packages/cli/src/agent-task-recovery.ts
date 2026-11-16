/** Portable argv data, never a shell program assembled from a user request. */
export type AgentTaskRecovery = {
  kind: 'retry' | 'select-project' | 'select-path' | 'native';
  message: string;
  requiredOption?: '--project' | '--path';
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
  limit: number;
  maxBytes: number;
};

export function taskContextRetry(
  request: AgentTaskRequest,
  overrides: Partial<AgentTaskRequest> = {}
): NonNullable<AgentTaskRecovery['command']> {
  const input = { ...request, ...overrides };
  return {
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
    ],
    cwd: '.',
    cwdBase: 'request-project-directory',
  };
}
