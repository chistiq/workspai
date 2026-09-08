#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '..');
const monorepoRoot = path.resolve(packageRoot, '..', '..');
const cacheRoot = path.join(monorepoRoot, 'node_modules', '.cache', 'workspai-prepush-gates');
const defaultTtlMs = 24 * 60 * 60 * 1000;

const gates = {
  'runtime-contract': {
    version: 1,
    label: 'runtime contract matrix',
    command: process.execPath,
    args: [path.join(scriptDirectory, 'runtime-acceptance-matrix.mjs'), '--contract-only'],
    inputs: [
      path.join(packageRoot, 'dist'),
      path.join(packageRoot, 'contracts'),
      path.join(packageRoot, 'templates'),
      path.join(scriptDirectory, 'runtime-acceptance-matrix.mjs'),
      path.join(packageRoot, 'package.json'),
      path.join(monorepoRoot, 'package-lock.json'),
    ],
  },
  'official-generators-contract': {
    version: 1,
    label: 'official generator contract smoke',
    command: process.execPath,
    args: [path.join(scriptDirectory, 'smoke-official-generators.mjs')],
    inputs: [
      path.join(packageRoot, 'dist'),
      path.join(packageRoot, 'contracts', 'create-planner-capabilities.v1.json'),
      path.join(scriptDirectory, 'smoke-official-generators.mjs'),
      path.join(packageRoot, 'package.json'),
      path.join(monorepoRoot, 'package-lock.json'),
    ],
  },
};

const gateId = process.argv[2];
const gate = gates[gateId];
if (!gate) {
  console.error(
    `Unknown cached pre-push gate "${gateId ?? ''}". Expected one of: ${Object.keys(gates).join(', ')}`
  );
  process.exit(2);
}

const ciValue = process.env.CI?.trim().toLowerCase();
const runningInCi = Boolean(ciValue && ciValue !== '0' && ciValue !== 'false');
let cacheEnabled = !runningInCi && process.env.WORKSPAI_PREPUSH_CACHE !== '0';
const ttlMs = readTtl();
let inputHash = null;
try {
  inputHash = hashGateInputs(gateId, gate);
} catch (error) {
  cacheEnabled = false;
  console.warn(
    `[prepush-cache] Could not fingerprint ${gate.label}; running without cache: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}
const cachePath = path.join(cacheRoot, `${gateId}.json`);

if (cacheEnabled) {
  const cached = readCacheRecord(cachePath);
  if (
    cached?.schemaVersion === 1 &&
    cached.gateId === gateId &&
    inputHash !== null &&
    cached.inputHash === inputHash &&
    typeof cached.passedAt === 'string'
  ) {
    const ageMs = Date.now() - Date.parse(cached.passedAt);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs) {
      console.log(
        `[prepush-cache] HIT ${gate.label} · unchanged inputs · passed ${formatAge(ageMs)} ago`
      );
      console.log('[prepush-cache] Set WORKSPAI_PREPUSH_CACHE=0 to force a fresh run.');
      process.exit(0);
    }
  }
}

console.log(
  `[prepush-cache] ${cacheEnabled ? 'MISS' : 'BYPASS'} ${gate.label} · running fresh validation`
);
const startedAt = Date.now();
const result = spawnSync(gate.command, gate.args, {
  cwd: packageRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[prepush-cache] ${gate.label} could not start: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[prepush-cache] ${gate.label} failed; no cache entry was written.`);
  process.exit(result.status ?? 1);
}

if (cacheEnabled) {
  try {
    writeCacheRecord(cachePath, {
      schemaVersion: 1,
      gateId,
      gateVersion: gate.version,
      inputHash,
      passedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    });
    console.log(`[prepush-cache] STORED ${gate.label} · ${inputHash.slice(0, 12)}`);
  } catch (error) {
    console.warn(
      `[prepush-cache] ${gate.label} passed, but its cache record could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function readTtl() {
  const configured = Number.parseInt(process.env.WORKSPAI_PREPUSH_CACHE_TTL_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : defaultTtlMs;
}

function hashGateInputs(id, definition) {
  const hash = createHash('sha256');
  hash.update('workspai-prepush-gate-cache-v1\0');
  hash.update(`${id}\0${definition.version}\0`);
  hash.update(`${process.platform}\0${process.arch}\0${process.versions.node}\0`);
  hash.update(`${process.execPath}\0${definition.command}\0${JSON.stringify(definition.args)}\0`);
  hash.update(`${JSON.stringify(relevantEnvironment())}\0`);
  for (const input of [...definition.inputs].sort()) {
    hashPath(hash, input, path.relative(monorepoRoot, input));
  }
  return hash.digest('hex');
}

function relevantEnvironment() {
  const exactKeys = new Set(['PATH', 'PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'npm_execpath']);
  return Object.entries(process.env)
    .filter(
      ([key]) =>
        exactKeys.has(key) ||
        key.startsWith('RAPIDKIT_') ||
        (key.startsWith('WORKSPAI_') && !key.startsWith('WORKSPAI_PREPUSH_CACHE')) ||
        key.startsWith('npm_config_')
    )
    .sort(([left], [right]) => left.localeCompare(right));
}

function hashPath(hash, absolutePath, logicalPath) {
  if (!existsSync(absolutePath)) {
    hash.update(`missing\0${logicalPath}\0`);
    return;
  }
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    hash.update(`symlink\0${logicalPath}\0${readlinkSync(absolutePath)}\0`);
    return;
  }
  if (stat.isDirectory()) {
    hash.update(`directory\0${logicalPath}\0`);
    for (const entry of readdirSync(absolutePath).sort()) {
      hashPath(hash, path.join(absolutePath, entry), path.posix.join(logicalPath, entry));
    }
    return;
  }
  if (!stat.isFile()) {
    hash.update(`unsupported\0${logicalPath}\0${stat.mode}\0`);
    return;
  }
  hash.update(`file\0${logicalPath}\0${stat.mode}\0${stat.size}\0`);
  hash.update(readFileSync(absolutePath));
  hash.update('\0');
}

function readCacheRecord(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeCacheRecord(filePath, record) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    try {
      renameSync(temporaryPath, filePath);
    } catch {
      rmSync(filePath, { force: true });
      renameSync(temporaryPath, filePath);
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function formatAge(ageMs) {
  if (ageMs < 60_000) return `${Math.max(0, Math.floor(ageMs / 1000))}s`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  return `${Math.floor(ageMs / 3_600_000)}h`;
}
