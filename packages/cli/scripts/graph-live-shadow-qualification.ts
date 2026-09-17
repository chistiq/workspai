import { randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  GraphShadowComparisonBinding,
  GraphShadowComparisonPolicy,
  GraphShadowParityReport,
} from '../src/contracts/graph-shadow-parity-contract.js';
import {
  runPreparedProjectGraphShadow,
  type PreparedProjectGraphShadowResult,
} from '../src/graph-package-shadow-bridge.js';
import { normalizeLegacyGraphArtifact } from './graph-shadow-qualification.js';
import { projectWorkspaceKnowledgeGraph } from '../src/workspace-knowledge-graph-projection.js';
import type { WorkspaceKnowledgeGraph } from '../src/contracts/workspace-knowledge-graph-contract.js';

const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const MAX_CONTROL_BYTES = 1024 * 1024;
const RESULT_SCHEMA_VERSION = 'workspai.graph-live-shadow-qualification.v1-candidate' as const;

interface LiveQualificationOptions {
  readonly legacy: string;
  readonly projectRoot: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly binding: string;
  readonly policy?: string;
  readonly profile: string;
  readonly output?: string;
}

export interface GraphLiveShadowQualificationResult {
  readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly project: { readonly id: string };
  readonly packageExecution: PreparedProjectGraphShadowResult['packageExecution'];
  readonly report: GraphShadowParityReport;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseArgs(args: readonly string[]): LiveQualificationOptions {
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
  const allowed = new Set([
    '--legacy',
    '--project-root',
    '--project-id',
    '--workspace-id',
    '--binding',
    '--policy',
    '--profile',
    '--output',
  ]);
  for (const key of values.keys()) {
    if (!allowed.has(key)) throw new Error(`Unsupported qualification argument: ${key}`);
  }
  for (const required of [
    '--legacy',
    '--project-root',
    '--project-id',
    '--workspace-id',
    '--binding',
    '--profile',
  ]) {
    if (!values.has(required)) throw new Error(`${required} is required.`);
  }
  const projectId = values.get('--project-id') as string;
  const workspaceId = values.get('--workspace-id') as string;
  const profile = values.get('--profile') as string;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u.test(projectId)) {
    throw new Error('--project-id must be a portable identifier.');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u.test(workspaceId)) {
    throw new Error('--workspace-id must be a portable identifier.');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(profile)) {
    throw new Error('--profile must be a portable identifier.');
  }
  return {
    legacy: values.get('--legacy') as string,
    projectRoot: values.get('--project-root') as string,
    projectId,
    workspaceId,
    binding: values.get('--binding') as string,
    ...(values.get('--policy') ? { policy: values.get('--policy') } : {}),
    profile,
    ...(values.get('--output') ? { output: values.get('--output') } : {}),
  };
}

async function readBoundedJson(file: string, maxBytes: number): Promise<unknown> {
  const target = path.resolve(file);
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maxBytes) {
    throw new Error('Qualification input must be a bounded regular file.');
  }
  const handle = await open(target, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) {
      throw new Error('Qualification input must be a bounded regular file.');
    }
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

async function resolveProjectRoot(projectRoot: string): Promise<string> {
  if (!path.isAbsolute(projectRoot)) throw new Error('--project-root must be absolute.');
  const metadata = await lstat(projectRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('--project-root must be a real directory.');
  }
  return realpath(projectRoot);
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  const target = path.resolve(file);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`
  );
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    await link(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function scopedLegacyGraph(value: unknown, projectId: string): unknown {
  const normalized = normalizeLegacyGraphArtifact(value);
  if (!isObject(normalized) || normalized.schemaVersion !== 'workspace-knowledge-graph.v1') {
    return normalized;
  }
  return projectWorkspaceKnowledgeGraph(
    normalized as unknown as WorkspaceKnowledgeGraph,
    projectId
  );
}

export async function runGraphLiveShadowQualification(
  args: readonly string[]
): Promise<{ readonly result: GraphLiveShadowQualificationResult; readonly exitCode: number }> {
  const options = parseArgs(args);
  const [legacy, binding, policy, projectRoot] = await Promise.all([
    readBoundedJson(options.legacy, MAX_GRAPH_BYTES),
    readBoundedJson(options.binding, MAX_CONTROL_BYTES),
    options.policy
      ? readBoundedJson(options.policy, MAX_CONTROL_BYTES)
      : Promise.resolve(undefined),
    resolveProjectRoot(options.projectRoot),
  ]);
  const execution = await runPreparedProjectGraphShadow({
    context: {
      projectId: options.projectId,
      projectRoot,
      workspaceId: options.workspaceId,
    },
    profile: options.profile,
    binding: binding as GraphShadowComparisonBinding,
    policy: policy as GraphShadowComparisonPolicy | undefined,
    legacy: async () => scopedLegacyGraph(legacy, options.projectId) as never,
  });
  const result: GraphLiveShadowQualificationResult = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    project: { id: options.projectId },
    packageExecution: execution.packageExecution,
    report: execution.report,
  };
  if (options.output) await writeAtomic(options.output, result);
  const exitCode =
    result.report.status === 'equivalent'
      ? 0
      : result.report.status === 'incomparable'
        ? 2
        : result.report.status === 'different'
          ? 3
          : 4;
  return { result, exitCode };
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (invoked) {
  runGraphLiveShadowQualification(process.argv.slice(2))
    .then(({ result, exitCode }) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(
        `${JSON.stringify({ schemaVersion: 'workspai.graph-live-shadow-qualification-error.v1', code: 'GRAPH_LIVE_SHADOW_QUALIFICATION_FAILED', error: 'Live qualification failed before a report could be produced.' })}\n`
      );
      process.exitCode = 4;
    });
}
