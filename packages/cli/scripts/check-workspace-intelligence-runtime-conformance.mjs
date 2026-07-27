#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const packageRoot = process.cwd();
const cliPath = path.join(packageRoot, 'dist', 'index.js');
const chainPath = path.join(packageRoot, 'contracts', 'workspace-intelligence-chain.v1.json');
const contractsRoot = path.join(packageRoot, 'contracts');

function fail(message) {
  throw new Error(`[workspace-intelligence-runtime] ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildSchemaPathIndex(directory) {
  const schemas = new Map();
  const visit = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const schema = readJson(absolutePath);
      if (typeof schema.$id !== 'string' || schema.$id.length === 0) continue;
      const existing = schemas.get(schema.$id);
      if (existing && existing !== absolutePath) {
        fail(
          `duplicate schema $id ${schema.$id}: ${path.relative(packageRoot, existing)} and ${path.relative(packageRoot, absolutePath)}`
        );
      }
      schemas.set(schema.$id, absolutePath);
    }
  };
  visit(directory);
  return schemas;
}

const schemaPathById = buildSchemaPathIndex(contractsRoot);

function registerRelativeSchemaDependencies(ajv, schema, schemaPath, visited = new Set()) {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) {
      let referenceId;
      try {
        referenceId = new URL(value.$ref, schema.$id).href.split('#')[0];
      } catch {
        referenceId = value.$ref.split('#')[0];
      }
      const referencePath =
        schemaPathById.get(referenceId) ??
        path.resolve(path.dirname(schemaPath), value.$ref.split('#')[0]);
      if (fs.existsSync(referencePath)) {
        const normalizedPath = path.resolve(referencePath);
        if (!visited.has(normalizedPath)) {
          visited.add(normalizedPath);
          const referencedSchema = readJson(normalizedPath);
          registerRelativeSchemaDependencies(ajv, referencedSchema, normalizedPath, visited);
          ajv.addSchema(referencedSchema);
        }
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(schema);
}

if (!fs.existsSync(cliPath)) {
  fail('dist/index.js is missing; run the build before this conformance gate');
}

const contract = readJson(chainPath);
const artifactRegistry = new Map(
  contract.runtimeRegistry.artifacts.map((artifact) => [artifact.path, artifact])
);
const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-runtime-contract-'));

function writeJson(relativePath, payload) {
  const target = path.join(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
}

function validateArtifact(relativePath) {
  const descriptor = artifactRegistry.get(relativePath);
  if (!descriptor) fail(`produced artifact is absent from runtime registry: ${relativePath}`);
  const artifactPath = path.join(workspacePath, relativePath);
  if (!fs.existsSync(artifactPath)) fail(`declared artifact was not written: ${relativePath}`);
  if (!descriptor.schemaContract) return;

  const payload = readJson(artifactPath);
  if (payload.schemaVersion !== descriptor.schemaVersion) {
    fail(
      `${relativePath} schemaVersion is ${String(payload.schemaVersion)}, expected ${descriptor.schemaVersion}`
    );
  }
  const schemaPath = path.join(packageRoot, descriptor.schemaContract);
  const schema = readJson(schemaPath);
  const AjvConstructor = schema.$schema?.includes('2020-12') ? Ajv2020 : Ajv;
  const ajv = new AjvConstructor({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  registerRelativeSchemaDependencies(ajv, schema, schemaPath);
  const valid = ajv.validate(schema, payload);
  if (!valid) {
    fail(
      `${relativePath} violates ${descriptor.schemaContract}: ${ajv.errorsText(ajv.errors)}\n${JSON.stringify(ajv.errors, null, 2)}`
    );
  }
}

function runCli(command, label, exitPolicy = 'stop-on-error') {
  const result = spawnSync(process.execPath, [cliPath, ...command], {
    cwd: workspacePath,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      NO_COLOR: '1',
      CI: '1',
      RAPIDKIT_SKIP_LOCK_SYNC: '1',
      WORKSPAI_NO_UPDATE_CHECK: '1',
      WORKSPAI_DEBUG_ARGS: '1',
    },
  });
  if (result.error) fail(`${label} could not execute: ${result.error.message}`);
  if (result.status !== 0 && exitPolicy !== 'continue-on-structured-verdict') {
    fail(`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

try {
  fs.writeFileSync(path.join(workspacePath, '.workspai-workspace'), '{}\n');
  writeJson('.workspai/workspace.json', {
    workspace_name: 'runtime-contract-fixture',
    profile: 'minimal',
  });
  writeJson('.workspai/workspace.contract.json', {
    kind: 'rapidkit.workspace.contract',
    schemaVersion: 1,
    workspace: { name: 'runtime-contract-fixture' },
    projects: [{ slug: 'app', relativePath: 'app', contracts: {} }],
  });
  writeJson('app/package.json', {
    name: '@workspai/runtime-contract-fixture',
    version: '1.0.0',
    scripts: { test: 'node --version', build: 'node --version' },
  });
  writeJson('app/.workspai/project.json', {
    name: 'app',
    runtime: 'node',
    kit_name: 'vite-react',
  });

  // A diff baseline is a boundary input from an earlier state, never an artifact
  // created immediately before diff in the same canonical execution chain.
  runCli(['workspace', 'model', '--json', '--write'], 'baseline model');
  runCli(['workspace', 'snapshot', '--json'], 'baseline snapshot');
  validateArtifact('.workspai/reports/workspace-model-snapshot.json');
  writeJson('app/package.json', {
    name: '@workspai/runtime-contract-fixture',
    version: '1.0.1',
    scripts: { test: 'node --version', build: 'node --version' },
  });
  writeJson('.workspai/workspace.contract.json', {
    kind: 'rapidkit.workspace.contract',
    schemaVersion: 1,
    workspace: { name: 'runtime-contract-fixture' },
    projects: [
      { slug: 'app', relativePath: 'app', contracts: {} },
      { slug: 'worker', relativePath: 'worker', contracts: {} },
    ],
  });
  writeJson('worker/package.json', {
    name: '@workspai/runtime-contract-worker',
    version: '1.0.0',
    scripts: { test: 'node --version', build: 'node --version' },
  });
  writeJson('worker/.workspai/project.json', {
    name: 'worker',
    runtime: 'node',
    kit_name: 'vite-react',
  });

  for (const step of contract.steps) {
    runCli(step.command, step.id, step.exitPolicy);
    for (const artifactPath of step.produces) validateArtifact(artifactPath);
  }

  const diff = readJson(
    path.join(workspacePath, '.workspai/reports/workspace-model-diff-last-run.json')
  );
  if (diff.fromHash === diff.toHash || diff.summary?.changed !== true) {
    fail('diff did not observe the fixture mutation against the explicit baseline');
  }

  console.log(
    `[workspace-intelligence-runtime] ${contract.steps.length} steps and ${contract.steps.reduce((sum, step) => sum + step.produces.length, 0)} artifacts conform`
  );
} finally {
  fs.rmSync(workspacePath, { recursive: true, force: true });
}
