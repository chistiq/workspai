import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGraphLiveShadowQualification } from '../../scripts/graph-live-shadow-qualification.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowProjectScopeDigest,
  createGraphShadowReadOnlyAuthorizationDigest,
  createGraphShadowResourceBudgetDigest,
} from '../graph-shadow-parity.js';

const roots: string[] = [];
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  readonly root: string;
  readonly projectRoot: string;
  readonly legacy: string;
  readonly binding: string;
  readonly output: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-live-graph-shadow-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project-a');
  await mkdir(projectRoot);
  await writeFile(path.join(projectRoot, 'README.md'), '# project a\n');
  const legacy = path.join(root, 'legacy.json');
  const binding = path.join(root, 'binding.json');
  const output = path.join(root, 'result.json');
  await writeFile(
    legacy,
    JSON.stringify({
      schemaVersion: 'workspace-knowledge-graph.v1',
      generatedAt: '2026-09-12T00:00:00.000Z',
      source: { hash: digest('legacy'), inputs: { scopes: [] } },
      entities: [
        {
          id: 'legacy:a',
          kind: 'project',
          projectId: 'project-a',
          identity: { key: 'project:project-a' },
          proofIds: [],
        },
        {
          id: 'legacy:b',
          kind: 'project',
          projectId: 'project-b',
          identity: { key: 'project:project-b' },
          proofIds: [],
        },
      ],
      relations: [],
      proofs: [],
      providers: [],
      quality: { unknownCount: 0, completeness: { status: 'complete' } },
      diagnostics: [],
    })
  );
  await writeFile(
    binding,
    JSON.stringify({
      sourceFixtureDigest: digest('source'),
      scopeDigest: createGraphShadowProjectScopeDigest('project-a'),
      providerProfileDigest: digest('providers'),
      graphPolicyDigest: digest('policy'),
      redactionAuthorizationDigest: createGraphShadowReadOnlyAuthorizationDigest(),
      resourceBudgetDigest: createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS),
      legacyCli: { version: '0.75.1', commit: 'a'.repeat(40) },
      graphPackage: { version: '0.0.0-development', commit: 'b'.repeat(40) },
    })
  );
  return { root, projectRoot, legacy, binding, output };
}

function args(files: Awaited<ReturnType<typeof fixture>>): string[] {
  return [
    '--legacy',
    files.legacy,
    '--project-root',
    files.projectRoot,
    '--project-id',
    'project-a',
    '--binding',
    files.binding,
    '--profile',
    'g8-live-project.v1',
  ];
}

describe('Graph live shadow qualification', () => {
  it('scopes legacy truth and executes the package without changing authority', async () => {
    const files = await fixture();
    const preliminary = await runGraphLiveShadowQualification(args(files));
    const semanticBinding = preliminary.result.packageExecution.semanticBinding;
    expect(semanticBinding).toBeDefined();
    const binding = JSON.parse(await readFile(files.binding, 'utf8')) as Record<string, unknown>;
    await writeFile(files.binding, JSON.stringify({ ...binding, ...semanticBinding }));
    const { result, exitCode } = await runGraphLiveShadowQualification([
      ...args(files),
      '--output',
      files.output,
    ]);

    expect(exitCode, JSON.stringify(result)).toBe(3);
    expect(result).toMatchObject({
      schemaVersion: 'workspai.graph-live-shadow-qualification.v1-candidate',
      project: { id: 'project-a' },
      packageExecution: { status: 'complete', inputFiles: 1 },
      report: {
        status: 'different',
        metrics: { legacyNodes: 1 },
        receipt: { authority: 'released-cli', packageWrites: 'prohibited', fallback: 'prohibited' },
      },
    });
    const persisted = await readFile(files.output, 'utf8');
    expect(JSON.parse(persisted)).toEqual(result);
    expect(persisted).not.toContain(files.root);
  });

  it('rejects a symlinked project boundary before either Graph path executes', async () => {
    const files = await fixture();
    const linkedRoot = path.join(files.root, 'linked-project');
    await symlink(files.projectRoot, linkedRoot, 'dir');

    await expect(
      runGraphLiveShadowQualification([
        ...args(files).map((value) => (value === files.projectRoot ? linkedRoot : value)),
      ])
    ).rejects.toThrow('--project-root must be a real directory.');
  });

  it('does not overwrite an existing qualification result', async () => {
    const files = await fixture();
    await writeFile(files.output, 'preserved\n');
    await expect(
      runGraphLiveShadowQualification([...args(files), '--output', files.output])
    ).rejects.toThrow();
    expect(await readFile(files.output, 'utf8')).toBe('preserved\n');
  });
});
