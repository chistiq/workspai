import {
  WIS_CURRENT_CORE_VERSION,
  negotiateWisCoreResultEnvelope,
} from '../compatibility/index.js';
import { WIS_GENERATED_CONTRACT_REGISTRY, getWisGeneratedContract } from '../registry/index.js';
import {
  MAX_WIS_VALIDATION_LIMITS,
  validateWisCoreResultEnvelope,
  validateWisGeneratedContractStructure,
  type WisValidationCancellationSignal,
} from '../validation/index.js';

export const SHARED_CLI_RESULT_SCHEMA_VERSION = 'workspai-shared-cli-result.v1' as const;
export const SHARED_CLI_MAX_INPUT_BYTES = MAX_WIS_VALIDATION_LIMITS.maxTotalStringLength;

export interface SharedCliIo {
  readInput(locator: string, maxBytes: number): Promise<Uint8Array>;
  writeOutput(value: string): void;
}

export interface SharedCliDiagnostic {
  readonly code: string;
  readonly phase:
    | 'usage'
    | 'input'
    | 'resource'
    | 'structural'
    | 'semantic'
    | 'compatibility'
    | 'internal'
    | 'cancellation';
  readonly path: string;
  readonly message: string;
  readonly keyword?: string;
}

export interface SharedCliResult {
  readonly schemaVersion: typeof SHARED_CLI_RESULT_SCHEMA_VERSION;
  readonly command: 'help' | 'schema-list' | 'validate' | 'compatibility';
  readonly status: 'succeeded' | 'invalid' | 'unsupported' | 'failed' | 'cancelled';
  readonly exitCode: 0 | 1 | 3 | 130;
  readonly diagnostics: readonly SharedCliDiagnostic[];
  readonly data?: Readonly<Record<string, unknown>>;
}

interface ParsedInvocation {
  readonly command: SharedCliResult['command'];
  readonly json: boolean;
  readonly locator?: string;
  readonly contract?: string;
}

class CliUsageError extends Error {}

function usageDiagnostic(message: string): SharedCliDiagnostic {
  return { code: 'WIS_CLI_USAGE', phase: 'usage', path: '', message };
}

function failure(
  command: SharedCliResult['command'],
  status: SharedCliResult['status'],
  exitCode: SharedCliResult['exitCode'],
  diagnostic: SharedCliDiagnostic
): SharedCliResult {
  return {
    schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
    command,
    status,
    exitCode,
    diagnostics: [diagnostic],
  };
}

function parseInvocation(args: readonly string[]): ParsedInvocation {
  const remaining: string[] = [];
  let json = false;
  let contract: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (json) throw new CliUsageError('--json may be specified only once.');
      json = true;
    } else if (argument === '--contract') {
      if (contract !== undefined) {
        throw new CliUsageError('--contract may be specified only once.');
      }
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new CliUsageError('--contract requires a contract key or ID.');
      }
      contract = value;
      index += 1;
    } else if (argument.startsWith('--')) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    } else {
      remaining.push(argument);
    }
  }

  if (remaining.length === 0 || remaining[0] === 'help') {
    if (remaining.length > 1 || contract !== undefined) {
      throw new CliUsageError('help does not accept positional arguments or --contract.');
    }
    return { command: 'help', json };
  }
  if (remaining[0] === 'schema' && remaining[1] === 'list') {
    if (remaining.length !== 2 || contract !== undefined) {
      throw new CliUsageError('schema list accepts only --json.');
    }
    return { command: 'schema-list', json };
  }
  if (remaining[0] === 'validate') {
    if (remaining.length !== 2 || !contract) {
      throw new CliUsageError(
        'validate requires one file or - for stdin and --contract <key-or-id>.'
      );
    }
    return { command: 'validate', json, locator: remaining[1], contract };
  }
  if (remaining[0] === 'compatibility') {
    if (remaining.length !== 2 || contract !== undefined) {
      throw new CliUsageError('compatibility requires one file or - for stdin.');
    }
    return { command: 'compatibility', json, locator: remaining[1] };
  }
  throw new CliUsageError('Unknown command. Use schema list, validate, or compatibility.');
}

function decodeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > SHARED_CLI_MAX_INPUT_BYTES) {
    throw new RangeError(`Input exceeds the ${SHARED_CLI_MAX_INPUT_BYTES}-byte safety limit.`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function normalizeDiagnostic(value: Record<string, unknown>): SharedCliDiagnostic {
  const keyword = typeof value.keyword === 'string' ? value.keyword : undefined;
  const rawCode = typeof value.code === 'string' ? value.code : undefined;
  const phase =
    value.phase === 'resource' ||
    value.phase === 'structural' ||
    value.phase === 'semantic' ||
    value.phase === 'compatibility'
      ? value.phase
      : 'structural';
  return {
    code:
      rawCode ??
      `WIS_STRUCTURAL_${(keyword ?? 'INVALID').replaceAll(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`,
    phase,
    path:
      typeof value.path === 'string'
        ? value.path
        : typeof value.instancePath === 'string'
          ? value.instancePath
          : '',
    message: typeof value.message === 'string' ? value.message : 'Contract validation failed.',
    ...(keyword ? { keyword } : {}),
  };
}

function helpResult(): SharedCliResult {
  return {
    schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
    command: 'help',
    status: 'succeeded',
    exitCode: 0,
    diagnostics: [],
    data: {
      usage: [
        'workspai-shared schema list [--json]',
        'workspai-shared validate <file|-> --contract <key-or-id> [--json]',
        'workspai-shared compatibility <file|-> [--json]',
      ],
    },
  };
}

function schemaListResult(): SharedCliResult {
  return {
    schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
    command: 'schema-list',
    status: 'succeeded',
    exitCode: 0,
    diagnostics: [],
    data: {
      portfolioDigest: WIS_GENERATED_CONTRACT_REGISTRY.portfolioDigest,
      contracts: WIS_GENERATED_CONTRACT_REGISTRY.contracts.map((contract) => ({
        key: contract.key,
        id: contract.id,
        version: contract.version,
        digest: contract.digest,
        dependencies: contract.dependencies,
      })),
    },
  };
}

async function readArtifact(
  invocation: ParsedInvocation,
  io: SharedCliIo,
  signal?: WisValidationCancellationSignal
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly result: SharedCliResult }
> {
  if (signal?.aborted) {
    return {
      ok: false,
      result: failure(invocation.command, 'cancelled', 130, {
        code: 'WIS_CLI_CANCELLED',
        phase: 'cancellation',
        path: '',
        message: 'Validation was cancelled before input was read.',
      }),
    };
  }
  try {
    const bytes = await io.readInput(invocation.locator ?? '', SHARED_CLI_MAX_INPUT_BYTES);
    if (signal?.aborted) {
      return {
        ok: false,
        result: failure(invocation.command, 'cancelled', 130, {
          code: 'WIS_CLI_CANCELLED',
          phase: 'cancellation',
          path: '',
          message: 'Validation was cancelled while input was read.',
        }),
      };
    }
    return { ok: true, value: decodeJson(bytes) };
  } catch (error) {
    const message =
      error instanceof RangeError
        ? error.message
        : error instanceof SyntaxError
          ? 'Input is not valid JSON.'
          : 'Input could not be read as a bounded UTF-8 JSON document.';
    return {
      ok: false,
      result: failure(invocation.command, 'failed', 1, {
        code: error instanceof RangeError ? 'WIS_CLI_INPUT_LIMIT' : 'WIS_CLI_INPUT_INVALID',
        phase: 'input',
        path: '',
        message,
      }),
    };
  }
}

function validateResult(
  invocation: ParsedInvocation,
  artifact: unknown,
  signal?: WisValidationCancellationSignal
): SharedCliResult {
  const contract = getWisGeneratedContract(invocation.contract ?? '');
  if (!contract) {
    return failure('validate', 'unsupported', 3, {
      code: 'WIS_CONTRACT_NOT_FOUND',
      phase: 'structural',
      path: '',
      message: 'The requested contract key or ID is not registered.',
    });
  }
  const result =
    contract.key === 'core-result-envelope'
      ? validateWisCoreResultEnvelope(artifact, { signal })
      : validateWisGeneratedContractStructure(contract.id, artifact, { signal });
  if (!result.valid) {
    const diagnostics = ('diagnostics' in result ? result.diagnostics : result.errors).map(
      (diagnostic) => normalizeDiagnostic(diagnostic as Record<string, unknown>)
    );
    const cancelled = diagnostics.some(
      (diagnostic) => diagnostic.code === 'WIS_RESOURCE_CANCELLED'
    );
    return {
      schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
      command: 'validate',
      status: cancelled ? 'cancelled' : 'invalid',
      exitCode: cancelled ? 130 : 3,
      diagnostics,
      data: {
        contract: { key: contract.key, id: contract.id, version: contract.version },
        validationMode:
          contract.key === 'core-result-envelope' ? 'structural-and-semantic' : 'structural',
      },
    };
  }
  return {
    schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
    command: 'validate',
    status: 'succeeded',
    exitCode: 0,
    diagnostics: [],
    data: {
      contract: { key: contract.key, id: contract.id, version: contract.version },
      validationMode:
        contract.key === 'core-result-envelope' ? 'structural-and-semantic' : 'structural',
    },
  };
}

function compatibilityResult(
  artifact: unknown,
  signal?: WisValidationCancellationSignal
): SharedCliResult {
  const result = negotiateWisCoreResultEnvelope(artifact, { signal });
  if (!result.compatible) {
    const cancelled = result.diagnostics.some(
      (diagnostic) => diagnostic.code === 'WIS_RESOURCE_CANCELLED'
    );
    return {
      schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
      command: 'compatibility',
      status: cancelled ? 'cancelled' : result.status === 'unsupported' ? 'unsupported' : 'invalid',
      exitCode: cancelled ? 130 : 3,
      diagnostics: result.diagnostics.map((diagnostic) =>
        normalizeDiagnostic(diagnostic as unknown as Record<string, unknown>)
      ),
      data: {
        targetVersion: result.targetVersion,
        ...(result.sourceVersion ? { sourceVersion: result.sourceVersion } : {}),
      },
    };
  }
  return {
    schemaVersion: SHARED_CLI_RESULT_SCHEMA_VERSION,
    command: 'compatibility',
    status: 'succeeded',
    exitCode: 0,
    diagnostics: [],
    data: {
      compatibility: result.status,
      sourceVersion: result.sourceVersion,
      targetVersion: WIS_CURRENT_CORE_VERSION,
      migrations: result.migrations,
      losses: result.losses,
    },
  };
}

function renderHuman(result: SharedCliResult): string {
  if (result.command === 'help') {
    return `Workspai Shared contract validator\n${(result.data?.usage as string[]).join('\n')}`;
  }
  if (result.command === 'schema-list' && result.status === 'succeeded') {
    const contracts = result.data?.contracts as Array<{ key: string; version: string }>;
    return [
      'Workspai Shared registered contracts',
      ...contracts.map((item) => `- ${item.key} · ${item.version}`),
    ].join('\n');
  }
  if (result.status === 'succeeded' && result.command === 'validate') {
    const contract = result.data?.contract as { key: string; version: string };
    return `Valid · ${contract.key} · ${contract.version}`;
  }
  if (result.status === 'succeeded' && result.command === 'compatibility') {
    return `Compatible · ${String(result.data?.compatibility)} · ${String(result.data?.sourceVersion)} → ${String(result.data?.targetVersion)}`;
  }
  return [
    `${result.status.toUpperCase()} · exit ${result.exitCode}`,
    ...result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
  ].join('\n');
}

export async function runSharedCli(
  args: readonly string[],
  io: SharedCliIo,
  signal?: WisValidationCancellationSignal
): Promise<number> {
  let invocation: ParsedInvocation;
  try {
    invocation = parseInvocation(args);
  } catch (error) {
    const result = failure(
      'help',
      'failed',
      1,
      usageDiagnostic(
        error instanceof CliUsageError ? error.message : 'Arguments could not be parsed.'
      )
    );
    io.writeOutput(`${args.includes('--json') ? JSON.stringify(result) : renderHuman(result)}\n`);
    return result.exitCode;
  }

  let result: SharedCliResult;
  if (invocation.command === 'help') {
    result = helpResult();
  } else if (invocation.command === 'schema-list') {
    result = schemaListResult();
  } else if (
    invocation.command === 'validate' &&
    !getWisGeneratedContract(invocation.contract ?? '')
  ) {
    result = failure('validate', 'unsupported', 3, {
      code: 'WIS_CONTRACT_NOT_FOUND',
      phase: 'structural',
      path: '',
      message: 'The requested contract key or ID is not registered.',
    });
  } else {
    const artifact = await readArtifact(invocation, io, signal);
    result = !artifact.ok
      ? artifact.result
      : invocation.command === 'validate'
        ? validateResult(invocation, artifact.value, signal)
        : compatibilityResult(artifact.value, signal);
  }

  io.writeOutput(`${invocation.json ? JSON.stringify(result) : renderHuman(result)}\n`);
  return result.exitCode;
}
