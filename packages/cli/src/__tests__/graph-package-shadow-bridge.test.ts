import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runPreparedProjectGraphShadow,
  type PreparedProjectGraphShadowRequest,
} from '../graph-package-shadow-bridge.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  createGraphShadowResourceBudgetDigest,
  type LegacyGraphShadowInput,
} from '../graph-shadow-parity.js';

const roots: string[] = [];
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function legacy(): LegacyGraphShadowInput {
  return {
    schemaVersion: 'workspace-knowledge-graph.v1',
    entities: [],
    relations: [],
    proofs: [],
    quality: { unknownCount: 0, completeness: { status: 'complete' } },
    diagnostics: [],
  };
}

async function request(): Promise<PreparedProjectGraphShadowRequest> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-bridge-'));
  roots.push(projectRoot);
  await writeFile(path.join(projectRoot, 'README.md'), '# fixture\n');
  return {
    context: { projectId: 'fixture', projectRoot },
    profile: 'g8-prepared-project.v1',
    binding: {
      sourceFixtureDigest: digest('source'),
      scopeDigest: createGraphShadowProjectScopeDigest('fixture'),
      providerProfileDigest: digest('providers'),
      graphPolicyDigest: digest('policy'),
      redactionAuthorizationDigest: createGraphShadowReadOnlyAuthorizationDigest(),
      resourceBudgetDigest: createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS),
      legacyCli: { version: '0.75.1', commit: 'a'.repeat(40) },
      graphPackage: { version: '0.0.0-development', commit: 'b'.repeat(40) },
    },
    legacy: vi.fn(async () => legacy()),
  };
}

describe('prepared project Graph shadow bridge', () => {
  it('runs the package read-only and preserves released CLI authority', async () => {
    const input = await request();
    const result = await runPreparedProjectGraphShadow(input);

    expect(result.packageExecution.status).not.toBe('not-executed');
    expect(result.packageExecution.inputFiles).toBe(1);
    expect(result.packageExecution.semanticBinding).toEqual({
      sourceFixtureDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      providerProfileDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      graphPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(result.report.receipt).toMatchObject({
      epoch: 'package-shadow',
      authority: 'released-cli',
      packageWrites: 'prohibited',
      fallback: 'prohibited',
    });
    expect(input.legacy).toHaveBeenCalledTimes(1);
  });

  it('fails before package execution for an invalid comparison binding', async () => {
    const input = await request();
    const result = await runPreparedProjectGraphShadow({
      ...input,
      binding: { ...input.binding, scopeDigest: 'latest' },
    });

    expect(result.report.status).toBe('failed');
    expect(result.packageExecution.status).toBe('not-executed');
    expect(input.legacy).not.toHaveBeenCalled();
  });

  it('fails before package execution for a valid but different prepared-project scope', async () => {
    const input = await request();
    const result = await runPreparedProjectGraphShadow({
      ...input,
      binding: {
        ...input.binding,
        scopeDigest: createGraphShadowProjectScopeDigest('another-project'),
      },
    });

    expect(result.report.status).toBe('failed');
    expect(result.report.differences).toContainEqual(
      expect.objectContaining({
        code: 'GRAPH_SHADOW_CONTEXT_BINDING_MISMATCH',
        key: 'scopeDigest',
      })
    );
    expect(result.packageExecution.status).toBe('not-executed');
    expect(input.legacy).not.toHaveBeenCalled();
  });

  it('does not infer cwd or execute a malformed prepared context', async () => {
    const input = await request();
    const result = await runPreparedProjectGraphShadow({
      ...input,
      context: { ...input.context, projectRoot: 'relative/project' },
    });

    expect(result.report.status).toBe('failed');
    expect(result.report.receipt.fallback).toBe('prohibited');
    expect(result.packageExecution.status).toBe('not-executed');
  });
});
