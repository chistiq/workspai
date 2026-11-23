#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, '..');
const coreRoot = path.resolve(
  process.env.RAPIDKIT_CORE_ROOT || path.resolve(scriptDir, '../../../../core')
);
const outputPath = path.join(cliRoot, 'src/ai/core-module-catalog.v1.json');
const modulesRoot = path.join(coreRoot, 'src/modules');
const syncKits = process.argv.includes('--with-kits');

function fail(message) {
  console.error(`[core-catalog-sync] ${message}`);
  process.exit(1);
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end < start) {
      throw new Error('Core module-list command did not return a JSON object.');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

if (!fs.existsSync(path.join(coreRoot, 'pyproject.toml')) || !fs.existsSync(modulesRoot)) {
  fail(
    `RapidKit Core source was not found at ${coreRoot}. Set RAPIDKIT_CORE_ROOT to its checkout.`
  );
}

const pyproject = fs.readFileSync(path.join(coreRoot, 'pyproject.toml'), 'utf8');
const coreVersion = pyproject.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
if (!coreVersion) fail('Could not read the Core project version from pyproject.toml.');
const requiresPython = pyproject.match(/^python\s*=\s*["']([^"']+)["']/m)?.[1];
if (!requiresPython) fail('Could not read Core requires-python from pyproject.toml.');
const minimumPython = requiresPython.match(/(?:^|,)\s*>=\s*(\d+\.\d+)/)?.[1];
if (!minimumPython)
  fail(`Could not determine Core's minimum Python version from ${requiresPython}.`);

const result = spawnSync(
  'poetry',
  [
    'run',
    'python',
    '-m',
    'rapidkit',
    'modules',
    'list',
    '--detailed',
    '--json-schema',
    '1',
    '--json',
  ],
  {
    cwd: coreRoot,
    env: { ...process.env, PYTHONPATH: path.join(coreRoot, 'src'), PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  }
);
if (result.error) fail(`Could not execute the Core module inventory: ${result.error.message}`);
if (result.status !== 0) {
  fail(
    `Core module inventory failed with exit code ${String(result.status)}.\n${result.stderr || result.stdout}`
  );
}

let response;
try {
  response = parseJsonOutput(result.stdout || '');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (response?.schema_version !== 1 || !Array.isArray(response.modules)) {
  fail('Core returned an unsupported module inventory schema. Expected schema_version 1.');
}
if (response.stats?.invalid > 0) {
  fail(
    `Core reported ${response.stats.invalid} invalid module(s); refusing to sync a partial catalog.`
  );
}
if (response.modules.length === 0 || response.stats?.returned !== response.modules.length) {
  fail('Core returned an empty or internally inconsistent module inventory.');
}

const modules = response.modules.map((module) => {
  const slug = typeof module.slug === 'string' ? module.slug.trim() : '';
  const name = typeof module.display_name === 'string' ? module.display_name.trim() : '';
  if (!slug.startsWith('free/') || !name || typeof module.category !== 'string') {
    fail(`Core returned a module with invalid identity or category: ${JSON.stringify(module)}`);
  }

  const moduleDir = path.resolve(modulesRoot, ...slug.split('/'));
  if (!moduleDir.startsWith(`${modulesRoot}${path.sep}`)) {
    fail(`Core returned a module path outside its module source tree: ${slug}`);
  }
  const manifestPath = path.join(moduleDir, 'module.yaml');
  if (!fs.existsSync(manifestPath)) fail(`Missing module manifest for ${slug}.`);
  const manifest = parseYaml(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || manifest.name !== module.name) {
    fail(`Module manifest identity does not match the CLI inventory for ${slug}.`);
  }

  const profileNames = Object.keys(manifest.profile_inherits || {});
  const hasFastApi = profileNames.some((profile) => profile.toLowerCase().includes('fastapi'));
  const hasNestJs = profileNames.some((profile) => profile.toLowerCase().includes('nestjs'));
  const framework = hasFastApi && hasNestJs ? 'both' : hasNestJs ? 'nestjs' : 'fastapi';
  const capabilities = stringArray(module.capabilities || manifest.capabilities);
  const description =
    (typeof module.description === 'string' && module.description.trim()) ||
    `${name} module for RapidKit projects.`;

  return {
    id: slug,
    name,
    category: module.category.trim().toLowerCase(),
    description,
    longDescription: capabilities.length
      ? `${description} Capabilities: ${capabilities.join(', ')}.`
      : description,
    keywords: stringArray(module.tags || manifest.tags).map((tag) => tag.toLowerCase()),
    framework,
    dependencies: stringArray(manifest.depends_on),
    useCases: capabilities,
  };
});

modules.sort((a, b) => a.id.localeCompare(b.id));
if (new Set(modules.map((module) => module.id)).size !== modules.length) {
  fail('Core returned duplicate module IDs.');
}

const snapshot = {
  schemaVersion: 'rapidkit-module-catalog.v1',
  coreVersion,
  requiresPython,
  minimumPython,
  sourceSchemaVersion: response.schema_version,
  catalogDigest: `sha256:${createHash('sha256').update(JSON.stringify(modules)).digest('hex')}`,
  moduleCount: modules.length,
  modules,
};
if (syncKits) {
  for (const kit of ['fastapi/standard', 'fastapi/ddd', 'nestjs/standard']) {
    if (!fs.existsSync(path.join(coreRoot, 'src/kits', kit, 'templates'))) {
      fail(`Missing Core kit template tree: ${kit}.`);
    }
  }
  if (!fs.existsSync(path.join(coreRoot, 'src/kits/base/templates/common/env.example.j2'))) {
    fail('Missing Core common environment template.');
  }
  const kitResult = spawnSync('bash', [path.join(scriptDir, 'sync-kits.sh')], {
    cwd: cliRoot,
    env: { ...process.env, RAPIDKIT_CORE_ROOT: coreRoot },
    stdio: 'inherit',
  });
  if (kitResult.error || kitResult.status !== 0) {
    fail(`Kit sync failed: ${kitResult.error?.message ?? kitResult.status}`);
  }
}
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(
  `[core-catalog-sync] Synced ${modules.length} validated modules from RapidKit Core ${coreVersion} to ${path.relative(cliRoot, outputPath)}.`
);
