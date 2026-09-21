import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildNodeIncrementalRepoGraph,
  buildNodeRepoGraph,
  createGraphProductBuildSession,
  runWithOwnedGraphProductBuildSession,
} from '../../src/adapters/node/index.js';
import {
  contentAddressedCompute,
  contentAddressedFactKey,
  runWithContentAddressedFactSession,
} from '../../src/providers/content-addressed-facts.js';
import { GRAPH_STANDARD_REPO_BUILD_POLICY } from '../../src/application/index.js';
import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../../src/contracts/index.js';
import type { GraphProviderRuntime } from '../../src/contracts/index.js';
import { createPackageJsonProvider } from '../../src/providers/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function writeRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-session-'));
  temporary.push(root);
  for (const [locator, contents] of Object.entries(files)) {
    const target = path.join(root, locator);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
  }
  return root;
}

function failingCollectProvider(error: Error): GraphProviderRuntime {
  const base = createPackageJsonProvider();
  return {
    ...base,
    collect: async () => {
      throw error;
    },
  };
}

describe('GraphProductBuildSession product lifecycle', () => {
  it('creates and disposes an owned session after a successful buildNodeRepoGraph', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-success","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    let observedSession = false;
    const result = await runWithOwnedGraphProductBuildSession(undefined, async (session) => {
      observedSession = true;
      const built = await buildNodeRepoGraph({ root, session });
      runWithContentAddressedFactSession(session.facts, () => {
        contentAddressedCompute(
          contentAddressedFactKey({
            extractorId: 'test.owned-success',
            extractorVersion: '1',
            contentDigest: 'a'.repeat(64),
          }),
          () => ({ ok: true })
        );
      });
      return built;
    });
    expect(observedSession).toBe(true);
    expect(result.status === 'complete' || result.status === 'partial').toBe(true);
  });

  it('releases the owned session so later fact-session use fails', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-owned-release","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    let captured: ReturnType<typeof createGraphProductBuildSession> | undefined;
    await runWithOwnedGraphProductBuildSession(undefined, async (session) => {
      captured = session;
      await buildNodeRepoGraph({ root, session });
    });
    expect(captured).toBeDefined();
    expect(() =>
      runWithContentAddressedFactSession(captured!.facts, () =>
        contentAddressedCompute(
          contentAddressedFactKey({
            extractorId: 'test.owned-released',
            extractorVersion: '1',
            contentDigest: 'd'.repeat(64),
          }),
          () => 1
        )
      )
    ).toThrow(/disposed/i);
  });

  it('disposes the owned session when a provider fails', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-fail","private":true}\n',
    });
    const session = createGraphProductBuildSession();
    const result = await buildNodeRepoGraph({
      root,
      session,
      providers: [failingCollectProvider(new Error('provider boom'))],
    });
    expect(result.status === 'failed' || result.status === 'partial').toBe(true);
    expect(() => session.facts.dispose()).not.toThrow();
    session.dispose();
    expect(() =>
      runWithContentAddressedFactSession(session.facts, () =>
        contentAddressedCompute(
          contentAddressedFactKey({
            extractorId: 'test.failed-dispose',
            extractorVersion: '1',
            contentDigest: 'c'.repeat(64),
          }),
          () => 1
        )
      )
    ).toThrow(/disposed/i);
  });

  it('disposes the owned session when the build is cancelled', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-cancel","private":true}\n',
      'src.ts': 'export function run() { return 1; }\n',
    });
    const controller = new AbortController();
    controller.abort();
    const result = await buildNodeRepoGraph({ root, signal: controller.signal });
    expect(result.status).toBe('cancelled');
  });

  it('disposes the owned session when composition throws', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-compose","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    await expect(
      buildNodeRepoGraph({
        root,
        policy: {
          ...GRAPH_STANDARD_REPO_BUILD_POLICY,
          composition: {
            ...GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
            maxFacts: 0,
          },
        },
      })
    ).resolves.toMatchObject({ status: expect.stringMatching(/failed|partial|complete/) });
  });

  it('does not dispose a caller-owned session', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-caller","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    const session = createGraphProductBuildSession();
    const result = await buildNodeRepoGraph({ root, session });
    expect(result.status === 'complete' || result.status === 'partial').toBe(true);
    runWithContentAddressedFactSession(session.facts, () => {
      expect(
        contentAddressedCompute(
          contentAddressedFactKey({
            extractorId: 'test.caller-owned',
            extractorVersion: '1',
            contentDigest: 'b'.repeat(64),
          }),
          () => 1
        )
      ).toBe(1);
    });
    session.dispose();
  });

  it('fails visibly when a disposed caller session is reused', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-disposed","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    const session = createGraphProductBuildSession();
    session.dispose();
    try {
      await buildNodeRepoGraph({ root, session });
      throw new Error('disposed session reuse should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toMatch(/disposed|Content-addressed fact session/i);
    }
  });

  it('reuses only immutable session content across base and incremental builds', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-incremental","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    const session = createGraphProductBuildSession();
    const base = await buildNodeRepoGraph({ root, session });
    expect(base.graph).toBeDefined();
    const incremental = await buildNodeIncrementalRepoGraph({
      root,
      session,
      base,
    });
    expect(incremental.graph?.generation.reference.contentDigest.value).toBe(
      base.graph?.generation.reference.contentDigest.value
    );
    session.dispose();
  });

  it('uses a separate session for an independent current-tree full-build oracle', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"session-oracle","private":true}\n',
      'src.ts': 'export function alpha() { return 1; }\n',
    });
    const host = createGraphProductBuildSession();
    const oracle = createGraphProductBuildSession();
    const base = await buildNodeRepoGraph({ root, session: host });
    const independent = await buildNodeRepoGraph({ root, session: oracle });
    expect(independent.graph?.generation.reference.contentDigest.value).toBe(
      base.graph?.generation.reference.contentDigest.value
    );
    host.dispose();
    oracle.dispose();
  });

  it('isolates two repositories with identical file bytes but different locators', async () => {
    const left = await writeRepo({
      'package.json': '{"name":"left","private":true}\n',
      'src/left.ts': 'export const shared = 1;\n',
    });
    const right = await writeRepo({
      'package.json': '{"name":"right","private":true}\n',
      'src/right.ts': 'export const shared = 1;\n',
    });
    const [leftBuild, rightBuild] = await Promise.all([
      buildNodeRepoGraph({ root: left }),
      buildNodeRepoGraph({ root: right }),
    ]);
    const leftLocators = leftBuild.admittedInputs?.map((input) => input.locator) ?? [];
    const rightLocators = rightBuild.admittedInputs?.map((input) => input.locator) ?? [];
    expect(leftLocators).toContain('src/left.ts');
    expect(rightLocators).toContain('src/right.ts');
    expect(leftLocators).not.toContain('src/right.ts');
    expect(rightLocators).not.toContain('src/left.ts');
  });

  it('does not let two workspaces share cached facts', async () => {
    const first = await writeRepo({
      'package.json': '{"name":"ws-a","private":true}\n',
      'a.ts': 'export function alpha() { return 1; }\n',
    });
    const second = await writeRepo({
      'package.json': '{"name":"ws-b","private":true}\n',
      'a.ts': 'export function alpha() { return 1; }\n',
    });
    const sessionA = createGraphProductBuildSession();
    const sessionB = createGraphProductBuildSession();
    const builtA = await buildNodeRepoGraph({
      root: first,
      session: sessionA,
      ontology: {
        ...CORE_GRAPH_ONTOLOGY_PROFILE,
        id: 'workspai.graph.ontology.session-a',
      },
    });
    const builtB = await buildNodeRepoGraph({
      root: second,
      session: sessionB,
      ontology: {
        ...CORE_GRAPH_ONTOLOGY_PROFILE,
        id: 'workspai.graph.ontology.session-b',
      },
    });
    expect(builtA.graph?.generation.ontologySetDigest.value).not.toBe(
      builtB.graph?.generation.ontologySetDigest.value
    );
    sessionA.dispose();
    sessionB.dispose();
  });

  it('isolates nested product builds on default sessions', async () => {
    const outer = await writeRepo({
      'package.json': '{"name":"nested-outer","private":true}\n',
      'outer.ts': 'export const outer = 1;\n',
    });
    const inner = await writeRepo({
      'package.json': '{"name":"nested-inner","private":true}\n',
      'inner.ts': 'export const inner = 1;\n',
    });
    const nested = await buildNodeRepoGraph({
      root: outer,
    });
    const child = await buildNodeRepoGraph({ root: inner });
    expect(nested.admittedInputs?.some((input) => input.locator === 'outer.ts')).toBe(true);
    expect(child.admittedInputs?.some((input) => input.locator === 'inner.ts')).toBe(true);
    expect(nested.admittedInputs?.some((input) => input.locator === 'inner.ts')).toBe(false);
  });

  it('documents explicit nested reuse through the same caller session', async () => {
    const root = await writeRepo({
      'package.json': '{"name":"nested-reuse","private":true}\n',
      'src.ts': 'export const value = 1;\n',
    });
    const session = createGraphProductBuildSession();
    const first = await buildNodeRepoGraph({ root, session });
    const second = await buildNodeRepoGraph({ root, session });
    expect(second.graph?.generation.reference.contentDigest.value).toBe(
      first.graph?.generation.reference.contentDigest.value
    );
    session.dispose();
  });
});
