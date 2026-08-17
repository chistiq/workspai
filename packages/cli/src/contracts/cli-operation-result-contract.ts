export const CLI_OPERATION_RESULT_SCHEMA_VERSION = 'workspai-cli-operation-result-v1' as const;
export const CLI_OPERATION_RESULT_CONTRACT_PATH = 'contracts/cli-operation-result.v1.json' as const;

export type CliOperationError = { code: string; message: string };

export type CliOperationResult = {
  schemaVersion: typeof CLI_OPERATION_RESULT_SCHEMA_VERSION;
  operation: string;
  status: 'success' | 'error';
  exitCode: number;
  artifact?: unknown;
  outputPath?: string;
  error?: CliOperationError;
  context?: Record<string, unknown>;
  examples?: string[];
  nextActions?: string[];
};

export function cliOperationSuccess(
  operation: string,
  artifact: unknown,
  outputPath?: string,
  exitCode = 0
): CliOperationResult {
  return {
    schemaVersion: CLI_OPERATION_RESULT_SCHEMA_VERSION,
    operation,
    status: 'success',
    exitCode,
    artifact,
    ...(outputPath ? { outputPath } : {}),
  };
}

export function cliOperationError(input: {
  operation: string;
  code: string;
  message: string;
  exitCode?: number;
  context?: Record<string, unknown>;
  examples?: string[];
  nextActions?: string[];
}): CliOperationResult {
  return {
    schemaVersion: CLI_OPERATION_RESULT_SCHEMA_VERSION,
    operation: input.operation,
    status: 'error',
    exitCode: input.exitCode ?? 1,
    error: { code: input.code, message: input.message },
    ...(input.context ? { context: input.context } : {}),
    ...(input.examples ? { examples: input.examples } : {}),
    ...(input.nextActions ? { nextActions: input.nextActions } : {}),
  };
}

export function buildCliOperationResultSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://workspai.dev/schemas/cli-operation-result.v1.json',
    title: 'Workspai CLI Operation Result',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'operation', 'status', 'exitCode'],
    properties: {
      schemaVersion: { const: CLI_OPERATION_RESULT_SCHEMA_VERSION },
      operation: { type: 'string', minLength: 1 },
      status: { enum: ['success', 'error'] },
      exitCode: { type: 'integer', minimum: 0 },
      artifact: {},
      outputPath: { type: 'string', minLength: 1 },
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', minLength: 1 },
          message: { type: 'string', minLength: 1 },
        },
      },
      context: { type: 'object', additionalProperties: true },
      examples: { type: 'array', items: { type: 'string', minLength: 1 } },
      nextActions: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
    allOf: [
      {
        if: { properties: { status: { const: 'success' } }, required: ['status'] },
        then: { required: ['artifact'], not: { required: ['error'] } },
      },
      {
        if: { properties: { status: { const: 'error' } }, required: ['status'] },
        then: { required: ['error'], not: { required: ['artifact'] } },
      },
    ],
  } as const;
}
