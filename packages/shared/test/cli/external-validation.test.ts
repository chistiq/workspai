import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { WIS_GENERATED_CONTRACT_REGISTRY } from '../../src/registry/index.js';

import {
  SHARED_CLI_MAX_INPUT_BYTES,
  runSharedCli,
  type SharedCliIo,
  type SharedCliResult,
} from '../../src/cli/application.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliResultSchema = JSON.parse(
  fs.readFileSync(
    path.join(packageRoot, 'schemas/cli/workspai-shared-cli-result.v1.schema.json'),
    'utf8'
  )
) as object;
const validateCliResult = new Ajv2020({ strict: true, allErrors: true }).compile(cliResultSchema);

function parseCliResult(output: string): SharedCliResult {
  const result = JSON.parse(output) as SharedCliResult;
  expect(validateCliResult(result), JSON.stringify(validateCliResult.errors)).toBe(true);
  return result;
}

function fixture(relativePath: string): Uint8Array {
  return fs.readFileSync(path.join(packageRoot, relativePath));
}

function harness(input?: Uint8Array | Error): {
  io: SharedCliIo;
  output: () => string;
  reads: () => number;
} {
  let rendered = '';
  let readCount = 0;
  return {
    io: {
      async readInput(_locator, maxBytes) {
        readCount += 1;
        if (input instanceof Error) throw input;
        const value = input ?? new Uint8Array();
        if (value.byteLength > maxBytes) throw new RangeError('bounded fixture exceeded');
        return value;
      },
      writeOutput(value) {
        rendered += value;
      },
    },
    output: () => rendered,
    reads: () => readCount,
  };
}

async function jsonRun(args: readonly string[], input?: Uint8Array | Error) {
  const target = harness(input);
  const exitCode = await runSharedCli([...args, '--json'], target.io);
  return {
    exitCode,
    result: parseCliResult(target.output()),
    reads: target.reads(),
  };
}

describe('@workspai/shared external validation CLI application', () => {
  it('lists a deterministic redacted contract catalog without reading input', async () => {
    const first = await jsonRun(['schema', 'list']);
    const second = await jsonRun(['schema', 'list']);

    expect(first).toEqual(second);
    expect(first.exitCode).toBe(0);
    expect(first.reads).toBe(0);
    expect(first.result).toMatchObject({
      schemaVersion: 'workspai-shared-cli-result.v1',
      command: 'schema-list',
      status: 'succeeded',
    });
    expect(JSON.stringify(first.result)).not.toContain('schemas/src/');
  });

  it('validates current envelopes with structural and semantic rules', async () => {
    const outcome = await jsonRun(
      ['validate', '-', '--contract', 'core-result-envelope'],
      fixture('fixtures/core/v0.2.0-draft/valid-pass.json')
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result).toMatchObject({
      command: 'validate',
      status: 'succeeded',
      data: { validationMode: 'structural-and-semantic' },
    });
  });

  it('returns contract exit 3 and bounded diagnostics for invalid input', async () => {
    const outcome = await jsonRun(
      ['validate', 'artifact.json', '--contract', 'core-result-envelope'],
      fixture('fixtures/core/v0.2.0-draft/invalid-false-pass.json')
    );

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.status).toBe('invalid');
    expect(outcome.result.diagnostics).toEqual([
      expect.objectContaining({ code: 'WIS_SEMANTIC_FALSE_PASS', phase: 'semantic' }),
    ]);
    expect(outcome.result).not.toHaveProperty('data.value');
  });

  it('fails closed for an unknown contract without echoing the artifact', async () => {
    const outcome = await jsonRun(
      ['validate', '-', '--contract', 'unknown-contract'],
      new TextEncoder().encode('{"secret":"must-not-echo"}')
    );

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result).toMatchObject({
      status: 'unsupported',
      diagnostics: [expect.objectContaining({ code: 'WIS_CONTRACT_NOT_FOUND' })],
    });
    expect(outcome.reads).toBe(0);
    expect(JSON.stringify(outcome.result)).not.toContain('must-not-echo');
  });

  it('reports compatibility without returning the migrated payload', async () => {
    const outcome = await jsonRun(
      ['compatibility', '-'],
      fixture('fixtures/compatibility/core-result-envelope/previous-valid-pass.json')
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result).toMatchObject({
      command: 'compatibility',
      status: 'succeeded',
      data: {
        compatibility: 'migrated',
        sourceVersion: '0.1.0-draft',
        targetVersion: '0.2.0-draft',
      },
    });
    expect(outcome.result).not.toHaveProperty('data.value');
  });

  it('maps malformed, oversized and cancelled input to stable non-zero exits', async () => {
    const malformed = await jsonRun(
      ['validate', '-', '--contract', 'core-result-envelope'],
      new TextEncoder().encode('{')
    );
    const oversized = await jsonRun(
      ['validate', '-', '--contract', 'core-result-envelope'],
      new RangeError(`Input exceeds the ${SHARED_CLI_MAX_INPUT_BYTES}-byte safety limit.`)
    );
    const cancelledTarget = harness(fixture('fixtures/core/v0.2.0-draft/valid-pass.json'));
    const cancelledExit = await runSharedCli(
      ['validate', '-', '--contract', 'core-result-envelope', '--json'],
      cancelledTarget.io,
      { aborted: true }
    );
    const cancelled = parseCliResult(cancelledTarget.output());

    expect(malformed).toMatchObject({
      exitCode: 1,
      result: { diagnostics: [expect.objectContaining({ code: 'WIS_CLI_INPUT_INVALID' })] },
    });
    expect(oversized).toMatchObject({
      exitCode: 1,
      result: { diagnostics: [expect.objectContaining({ code: 'WIS_CLI_INPUT_LIMIT' })] },
    });
    expect(cancelledExit).toBe(130);
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      diagnostics: [expect.objectContaining({ code: 'WIS_CLI_CANCELLED' })],
    });
    expect(cancelledTarget.reads()).toBe(0);
  });

  it('renders human help and keeps JSON usage errors machine-readable', async () => {
    const help = harness();
    const helpExit = await runSharedCli([], help.io);
    const invalid = await jsonRun(['validate', '-', '--unknown']);

    expect(helpExit).toBe(0);
    expect(help.output()).toContain('workspai-shared validate');
    expect(invalid).toMatchObject({
      exitCode: 1,
      result: {
        command: 'help',
        status: 'failed',
        diagnostics: [expect.objectContaining({ code: 'WIS_CLI_USAGE' })],
      },
    });
  });

  it.each([
    ['--json', '--json'],
    ['validate', '-', '--contract', 'one', '--contract', 'two', '--json'],
    ['validate', '-', '--contract', '--json'],
    ['help', 'extra', '--json'],
    ['schema', 'list', 'extra', '--json'],
    ['validate', '-', '--json'],
    ['compatibility', '-', '--contract', 'core-result-envelope', '--json'],
    ['unknown', '--json'],
  ])('rejects ambiguous invocation %#', async (...args) => {
    const target = harness();
    const exitCode = await runSharedCli(args, target.io);
    const result = parseCliResult(target.output());

    expect(exitCode).toBe(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'WIS_CLI_USAGE', phase: 'usage' }),
    ]);
  });

  it('validates generic generated contracts with resource preflight', async () => {
    const valid = await jsonRun(
      ['validate', '-', '--contract', 'contract-catalog'],
      new TextEncoder().encode(JSON.stringify(WIS_GENERATED_CONTRACT_REGISTRY))
    );
    const invalid = await jsonRun(
      ['validate', '-', '--contract', 'contract-catalog'],
      new TextEncoder().encode('{}')
    );

    expect(valid).toMatchObject({
      exitCode: 0,
      result: { data: { validationMode: 'structural' } },
    });
    expect(invalid).toMatchObject({
      exitCode: 3,
      result: {
        status: 'invalid',
        diagnostics: [expect.objectContaining({ phase: 'structural', keyword: 'required' })],
      },
    });
  });

  it('covers unsupported and invalid compatibility without exposing input', async () => {
    const unsupported = await jsonRun(
      ['compatibility', '-'],
      fixture('fixtures/compatibility/core-result-envelope/unsupported-version.json')
    );
    const invalid = await jsonRun(['compatibility', '-'], new TextEncoder().encode('{}'));

    expect(unsupported).toMatchObject({
      exitCode: 3,
      result: { status: 'unsupported', data: { sourceVersion: '9.0.0' } },
    });
    expect(invalid).toMatchObject({
      exitCode: 3,
      result: { status: 'invalid', data: { targetVersion: '0.2.0-draft' } },
    });
  });

  it('observes cancellation after input and inside generated validation', async () => {
    const signal = { aborted: false };
    let output = '';
    const afterReadIo: SharedCliIo = {
      async readInput() {
        signal.aborted = true;
        return fixture('fixtures/core/v0.2.0-draft/valid-pass.json');
      },
      writeOutput(value) {
        output += value;
      },
    };
    const afterReadExit = await runSharedCli(
      ['validate', '-', '--contract', 'core-result-envelope', '--json'],
      afterReadIo,
      signal
    );

    expect(afterReadExit).toBe(130);
    expect(parseCliResult(output)).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'WIS_CLI_CANCELLED' })],
    });

    const validatorIo = harness(
      new TextEncoder().encode(JSON.stringify(WIS_GENERATED_CONTRACT_REGISTRY))
    );
    let cancellationChecks = 0;
    const validatorSignal = {
      get aborted() {
        cancellationChecks += 1;
        return cancellationChecks >= 3;
      },
    };
    const validatorExit = await runSharedCli(
      ['validate', '-', '--contract', 'contract-catalog', '--json'],
      validatorIo.io,
      validatorSignal
    );
    expect(validatorExit).toBe(130);
  });

  it('bounds decoded bytes and rejects invalid UTF-8 independently of the I/O adapter', async () => {
    let oversizedOutput = '';
    const oversizedExit = await runSharedCli(
      ['validate', '-', '--contract', 'core-result-envelope', '--json'],
      {
        async readInput() {
          return new Uint8Array(SHARED_CLI_MAX_INPUT_BYTES + 1);
        },
        writeOutput(value) {
          oversizedOutput += value;
        },
      }
    );
    const invalidUtf8 = await jsonRun(
      ['validate', '-', '--contract', 'core-result-envelope'],
      new Uint8Array([0xff])
    );

    expect(oversizedExit).toBe(1);
    expect(parseCliResult(oversizedOutput)).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'WIS_CLI_INPUT_LIMIT' })],
    });
    expect(invalidUtf8).toMatchObject({
      exitCode: 1,
      result: { diagnostics: [expect.objectContaining({ code: 'WIS_CLI_INPUT_INVALID' })] },
    });
  });

  it('renders human success and failure summaries for every command family', async () => {
    const schema = harness();
    const valid = harness(fixture('fixtures/core/v0.2.0-draft/valid-pass.json'));
    const compatibility = harness(
      fixture('fixtures/compatibility/core-result-envelope/previous-valid-pass.json')
    );
    const failureTarget = harness(new TextEncoder().encode('{'));

    expect(await runSharedCli(['schema', 'list'], schema.io)).toBe(0);
    expect(
      await runSharedCli(['validate', '-', '--contract', 'core-result-envelope'], valid.io)
    ).toBe(0);
    expect(await runSharedCli(['compatibility', '-'], compatibility.io)).toBe(0);
    expect(
      await runSharedCli(['validate', '-', '--contract', 'core-result-envelope'], failureTarget.io)
    ).toBe(1);

    expect(schema.output()).toContain('registered contracts');
    expect(valid.output()).toContain('Valid · core-result-envelope');
    expect(compatibility.output()).toContain('Compatible · migrated');
    expect(failureTarget.output()).toContain('FAILED · exit 1');
  });
});
