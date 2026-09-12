import { randomUUID } from 'node:crypto';
import { link, lstat, open, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  runGraphShadowComparison,
} from '../src/graph-shadow-parity.js';
import type {
  GraphShadowComparisonBinding,
  GraphShadowComparisonPolicy,
  GraphShadowParityReport,
} from '../src/contracts/graph-shadow-parity-contract.js';

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_CONTROL_BYTES = 1024 * 1024;

interface QualificationOptions {
  legacy: string;
  package: string;
  binding: string;
  policy?: string;
  profile: string;
  output?: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Accepts the direct v1 artifact and the released CLI `workspace graph emit` envelope. */
export function normalizeLegacyGraphArtifact(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (value.schemaVersion === 'workspace-knowledge-graph.v1') return value;
  return value.knowledgeGraph ?? value;
}

/** Accepts the direct package projection and the standalone Graph CLI envelope. */
export function normalizePackageGraphArtifact(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (isObject(value.graph) && isObject(value.quality)) return value;
  const data = isObject(value.data) ? value.data : undefined;
  const build = data && isObject(data.build) ? data.build : undefined;
  const quality = build && isObject(build.quality) ? build.quality : undefined;
  if (!build || !isObject(build.graph) || !quality) return value;
  const graphQuality = isObject(quality.graph) ? quality.graph : undefined;
  return {
    graph: build.graph,
    quality: {
      unknownZones: Array.isArray(quality.unknownZones) ? quality.unknownZones : [],
      unsupportedZones: Array.isArray(quality.unsupportedZones) ? quality.unsupportedZones : [],
      coverage: graphQuality && Array.isArray(graphQuality.coverage) ? graphQuality.coverage : [],
    },
  };
}

function parseArgs(args: readonly string[]): QualificationOptions {
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
  for (const required of ['--legacy', '--package', '--binding', '--profile']) {
    if (!values.has(required)) throw new Error(`${required} is required.`);
  }
  for (const key of values.keys()) {
    if (
      !['--legacy', '--package', '--binding', '--policy', '--profile', '--output'].includes(key)
    ) {
      throw new Error(`Unsupported qualification argument: ${key}`);
    }
  }
  const profile = values.get('--profile') as string;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(profile)) {
    throw new Error('--profile must be a portable identifier.');
  }
  return {
    legacy: values.get('--legacy') as string,
    package: values.get('--package') as string,
    binding: values.get('--binding') as string,
    ...(values.get('--policy') ? { policy: values.get('--policy') } : {}),
    profile,
    ...(values.get('--output') ? { output: values.get('--output') } : {}),
  };
}

async function readBoundedJson(file: string, maxBytes = MAX_ARTIFACT_BYTES): Promise<unknown> {
  const pathMetadata = await lstat(file);
  if (pathMetadata.isSymbolicLink()) {
    throw new Error('Qualification input cannot be a symbolic link.');
  }
  const handle = await open(file, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) {
      throw new Error('Qualification input must be a bounded regular file.');
    }
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
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

export async function runGraphShadowQualification(
  args: readonly string[]
): Promise<{ report: GraphShadowParityReport; exitCode: number }> {
  const options = parseArgs(args);
  const [legacy, packageArtifact, binding, policy] = await Promise.all([
    readBoundedJson(options.legacy),
    readBoundedJson(options.package),
    readBoundedJson(options.binding, MAX_CONTROL_BYTES),
    options.policy
      ? readBoundedJson(options.policy, MAX_CONTROL_BYTES)
      : Promise.resolve(undefined),
  ]);
  const report = await runGraphShadowComparison({
    profile: options.profile,
    binding: binding as GraphShadowComparisonBinding,
    policy: policy as GraphShadowComparisonPolicy | undefined,
    limits: GRAPH_SHADOW_DEFAULT_LIMITS,
    legacy: async () => normalizeLegacyGraphArtifact(legacy),
    package: async () => normalizePackageGraphArtifact(packageArtifact),
  });
  if (options.output) await writeAtomic(options.output, report);
  const exitCode =
    report.status === 'equivalent'
      ? 0
      : report.status === 'incomparable'
        ? 2
        : report.status === 'different'
          ? 3
          : 4;
  return { report, exitCode };
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (invoked) {
  runGraphShadowQualification(process.argv.slice(2))
    .then(({ report, exitCode }) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(
        `${JSON.stringify({ schemaVersion: 'workspai.graph-shadow-qualification-error.v1', code: 'GRAPH_SHADOW_QUALIFICATION_FAILED', error: 'Qualification failed before a report could be produced.' })}\n`
      );
      process.exitCode = 4;
    });
}
