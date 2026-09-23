import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');

export const NATIVE_MEASUREMENT_SCHEMA = 'workspai.graph.native-composition-measurement.v1';
export const MEASUREMENT_ORDERS = Object.freeze([
  Object.freeze(['typescript', 'rust', 'rust', 'typescript']),
  Object.freeze(['rust', 'typescript', 'typescript', 'rust']),
]);

export function median(values) {
  const ordered = [...values]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (ordered.length === 0) return undefined;
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[mid - 1] + ordered[mid]) / 2 : ordered[mid];
}

export function percentile95(values) {
  const ordered = [...values]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (ordered.length === 0) return undefined;
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(0.95 * ordered.length) - 1));
  return ordered[index];
}

function sameIdentity(left, right) {
  return (
    left.sourceCommit === right.sourceCommit &&
    left.referenceCommit === right.referenceCommit &&
    left.referenceDirty === right.referenceDirty &&
    left.node === right.node &&
    left.binaryDigest === right.binaryDigest &&
    left.protocolVersion === right.protocolVersion &&
    left.snapshotFormatVersion === right.snapshotFormatVersion &&
    left.status === right.status &&
    left.fallback === right.fallback &&
    left.truncated === right.truncated &&
    left.factDigest === right.factDigest &&
    left.contentDigest === right.contentDigest
  );
}

export function samplesComparable(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return { comparable: false, reason: 'at-least-two-samples' };
  }
  const first = samples[0];
  for (const sample of samples.slice(1)) {
    if (!sameIdentity(first, sample)) return { comparable: false, reason: 'identity-or-output' };
    const loadDelta = Math.abs(Number(first.load1) - Number(sample.load1));
    if (!Number.isFinite(loadDelta) || loadDelta > 1) {
      return { comparable: false, reason: 'load' };
    }
  }
  const modes = new Set(samples.map((sample) => sample.mode));
  if (!modes.has('typescript') || !modes.has('rust')) {
    return { comparable: false, reason: 'missing-mode' };
  }
  if (samples.some((sample) => sample.mode === 'rust' && sample.fallback !== '')) {
    return { comparable: false, reason: 'rust-fallback' };
  }
  return { comparable: true, reason: '' };
}

export function summarizeSamples(samples) {
  const verdict = samplesComparable(samples);
  const byMode = (mode, field) =>
    samples.filter((sample) => sample.mode === mode).map((sample) => sample[field]);
  return {
    comparable: verdict.comparable,
    rejection: verdict.reason,
    admitted: false,
    qualified: false,
    typescript: {
      wallMs: {
        median: median(byMode('typescript', 'wallMs')),
        p95: percentile95(byMode('typescript', 'wallMs')),
      },
      compositionMs: {
        median: median(byMode('typescript', 'compositionMs')),
        p95: percentile95(byMode('typescript', 'compositionMs')),
      },
      processTreeRssBytes: {
        median: median(byMode('typescript', 'processTreeRssBytes')),
        p95: percentile95(byMode('typescript', 'processTreeRssBytes')),
      },
    },
    rust: {
      wallMs: {
        median: median(byMode('rust', 'wallMs')),
        p95: percentile95(byMode('rust', 'wallMs')),
      },
      compositionMs: {
        median: median(byMode('rust', 'compositionMs')),
        p95: percentile95(byMode('rust', 'compositionMs')),
      },
      processTreeRssBytes: {
        median: median(byMode('rust', 'processTreeRssBytes')),
        p95: percentile95(byMode('rust', 'processTreeRssBytes')),
      },
    },
  };
}

function command(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
  };
}

export function measurementIdentity(referenceRoot) {
  const head = command('git', ['rev-parse', 'HEAD'], repositoryRoot);
  const upstream = command(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    repositoryRoot
  );
  const node = process.version;
  const rustc = command('rustc', ['--version'], repositoryRoot);
  const binaryPath = path.join(repositoryRoot, 'target/release/graph-compose-graph');
  const binaryDigest = existsSync(binaryPath)
    ? createHash('sha256').update(readFileSync(binaryPath)).digest('hex')
    : '';
  let referenceCommit = '';
  let referenceDirty = '';
  if (referenceRoot) {
    const commit = command('git', ['rev-parse', 'HEAD'], referenceRoot);
    const dirty = command('git', ['status', '--porcelain'], referenceRoot);
    referenceCommit = commit.status === 0 ? commit.stdout : '';
    referenceDirty =
      dirty.status === 0 ? String(dirty.stdout ? dirty.stdout.split('\n').length : 0) : '';
  }
  return {
    schema: NATIVE_MEASUREMENT_SCHEMA,
    admitted: false,
    qualified: false,
    sourceCommit: head.status === 0 ? head.stdout : '',
    upstream: upstream.status === 0 ? upstream.stdout : '',
    referenceCommit,
    referenceDirty,
    node,
    rustc: rustc.status === 0 ? rustc.stdout : '',
    platform: `${process.platform}-${process.arch}`,
    binaryDigest,
    protocolVersion: 2,
    snapshotFormat: 'WGP1',
    snapshotFormatVersion: 1,
    kernelDefault: false,
    compatMaterialization: false,
    tempScratch: path.basename(tmpdir()),
  };
}

function selfCheck() {
  const base = {
    sourceCommit: 'a',
    referenceCommit: 'b',
    referenceDirty: '0',
    node: 'v24',
    binaryDigest: 'abc',
    protocolVersion: 2,
    snapshotFormatVersion: 1,
    status: 'partial',
    fallback: '',
    truncated: false,
    factDigest: 'f'.repeat(64),
    contentDigest: 'c'.repeat(64),
    load1: 1.2,
  };
  const samples = [
    { ...base, mode: 'typescript', wallMs: 100, compositionMs: 40, processTreeRssBytes: 1000 },
    { ...base, mode: 'rust', wallMs: 70, compositionMs: 20, processTreeRssBytes: 700 },
    { ...base, mode: 'rust', wallMs: 80, compositionMs: 22, processTreeRssBytes: 720, load1: 1.4 },
    { ...base, mode: 'typescript', wallMs: 110, compositionMs: 44, processTreeRssBytes: 1100 },
  ];
  const summary = summarizeSamples(samples);
  if (!summary.comparable) throw new Error(`expected comparable: ${summary.rejection}`);
  if (summary.admitted !== false || summary.qualified !== false)
    throw new Error('admission must stay false');
  if (summary.rust.compositionMs.median !== 21) throw new Error('median');
  const mismatched = summarizeSamples([
    { ...samples[0] },
    { ...samples[1], factDigest: 'd'.repeat(64) },
  ]);
  if (mismatched.comparable || mismatched.rejection !== 'identity-or-output') {
    throw new Error('digest mismatch must be rejected');
  }
  const loaded = summarizeSamples([
    { ...samples[0], load1: 4 },
    { ...samples[1], load1: 1 },
  ]);
  if (loaded.comparable || loaded.rejection !== 'load')
    throw new Error('load mismatch must be rejected');
  const fallback = summarizeSamples([
    { ...samples[0] },
    { ...samples[1], fallback: 'binary-missing' },
  ]);
  if (fallback.comparable) throw new Error('fallback must be rejected');
  const identity = measurementIdentity();
  if (
    identity.admitted !== false ||
    identity.qualified !== false ||
    identity.protocolVersion !== 2
  ) {
    throw new Error('identity envelope');
  }
  if (identity.tempScratch.includes('/') || identity.tempScratch.includes('\\')) {
    throw new Error('portable evidence must not record an absolute temp path');
  }
  process.stdout.write(`${JSON.stringify({ check: 'pass', orders: MEASUREMENT_ORDERS.length })}\n`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runSample(root, mode) {
  const result = spawnSync(
    'npx',
    ['vitest', 'run', 'test/application/native-composition-sample.test.ts', '--reporter=dot'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WORKSPAI_GRAPH_MEASURE_ROOT: root,
        WORKSPAI_GRAPH_MEASURE_MODE: mode,
      },
    }
  );
  const line = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('MEASURE_SAMPLE='));
  if (!line) {
    throw new Error(result.stderr || result.stdout || `sample-missing:${result.status}`);
  }
  return JSON.parse(line.slice('MEASURE_SAMPLE='.length));
}

function executeCampaign(root) {
  const identity = measurementIdentity(root);
  const requested = Number(argument('--orders') ?? MEASUREMENT_ORDERS.length);
  const orders = MEASUREMENT_ORDERS.slice(0, Number.isFinite(requested) ? requested : 0);
  const samples = [];
  for (const order of orders) {
    for (const mode of order) {
      const measured = runSample(root, mode);
      samples.push({
        ...measured,
        sourceCommit: identity.sourceCommit,
        referenceCommit: identity.referenceCommit,
        referenceDirty: identity.referenceDirty,
        node: identity.node,
        binaryDigest: identity.binaryDigest,
        protocolVersion: identity.protocolVersion,
        snapshotFormatVersion: identity.snapshotFormatVersion,
      });
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ...identity,
        orders,
        samples,
        summary: summarizeSamples(samples),
        admitted: false,
        qualified: false,
      },
      null,
      2
    )}\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check-harness')) selfCheck();
  else if (process.argv.includes('--execute')) {
    const root = argument('--root');
    if (!root) {
      process.stderr.write('Missing --root\n');
      process.exitCode = 2;
    } else executeCampaign(root);
  } else {
    process.stderr.write(
      'Usage: node scripts/measure-native-composition.mjs --check-harness | --execute --root <repository> [--orders N]\n'
    );
    process.exitCode = 2;
  }
}
