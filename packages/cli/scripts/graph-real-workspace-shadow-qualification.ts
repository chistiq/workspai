/**
 * Repository and CI entry for G8 real-workspace shadow qualification.
 * Runs TypeScript sources with `tsx`. Not a published CLI command.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createGraphG8RealWorkspacePlatformReport,
  runGraphRealWorkspaceQualification,
  writeAtomicJson,
} from '../src/graph-real-workspace-shadow.js';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRootFromSource = path.resolve(cliRoot, '../..');

function parseArgs(args: readonly string[]): {
  readonly mode: 'regression' | 'local-observation' | 'platform-report';
  readonly repositoryRoot: string;
  readonly referenceRoot?: string;
  readonly output?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error('All qualification arguments must be named.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value.`);
    if (values.has(key)) throw new Error(`${key} cannot be repeated.`);
    values.set(key, value);
    index += 1;
  }
  const allowed = new Set(['--mode', '--repository-root', '--reference-root', '--output']);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`Unsupported qualification argument: ${key}`);
  }
  const mode = values.get('--mode') ?? 'regression';
  if (mode !== 'regression' && mode !== 'local-observation' && mode !== 'platform-report') {
    throw new Error('--mode must be regression, local-observation or platform-report.');
  }
  const repositoryRoot = values.get('--repository-root') ?? repositoryRootFromSource;
  if (!path.isAbsolute(repositoryRoot)) {
    throw new Error('--repository-root must be absolute.');
  }
  const referenceRoot = values.get('--reference-root');
  if (referenceRoot && !path.isAbsolute(referenceRoot)) {
    throw new Error('--reference-root must be absolute.');
  }
  const outputArgument = values.get('--output');
  const output = outputArgument
    ? path.isAbsolute(outputArgument)
      ? outputArgument
      : path.resolve(repositoryRoot, outputArgument)
    : undefined;
  if (
    outputArgument &&
    !path.isAbsolute(outputArgument) &&
    outputArgument.split(/[\\/]/u).includes('..')
  ) {
    throw new Error('--output cannot traverse parent directories.');
  }
  return {
    mode,
    repositoryRoot,
    ...(referenceRoot ? { referenceRoot } : {}),
    ...(output ? { output } : {}),
  };
}

export async function runGraphRealWorkspaceShadowQualificationCli(
  args: readonly string[]
): Promise<{ readonly exitCode: number; readonly payload: unknown }> {
  const options = parseArgs(args);
  if (options.mode === 'platform-report') {
    const report = await createGraphG8RealWorkspacePlatformReport({
      repositoryRoot: options.repositoryRoot,
      mode: 'platform-report',
      ...(options.referenceRoot ? { referenceRoot: options.referenceRoot } : {}),
    });
    if (options.output) await writeAtomicJson(options.output, report);
    return { payload: report, exitCode: report.status === 'passed-platform' ? 0 : 4 };
  }
  const { result, exitCode } = await runGraphRealWorkspaceQualification({
    repositoryRoot: options.repositoryRoot,
    mode: options.mode,
    ...(options.referenceRoot ? { referenceRoot: options.referenceRoot } : {}),
    ...(options.output ? { output: options.output } : {}),
  });
  return { payload: result, exitCode };
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (invoked) {
  runGraphRealWorkspaceShadowQualificationCli(process.argv.slice(2))
    .then(({ payload, exitCode }) => {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(
        `${JSON.stringify({ schemaVersion: 'workspai.graph-real-workspace-qualification-error.v1', code: 'GRAPH_REAL_WORKSPACE_QUALIFICATION_FAILED', error: 'Real-workspace qualification failed before a report could be produced.' })}\n`
      );
      process.exitCode = 4;
    });
}
