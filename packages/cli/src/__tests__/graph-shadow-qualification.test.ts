import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGraphShadowQualification } from '../../scripts/graph-shadow-qualification.js';
import {
  GRAPH_SHADOW_DEFAULT_LIMITS,
  createGraphShadowResourceBudgetDigest,
} from '../graph-shadow-parity.js';

const roots: string[] = [];
const digest = `sha256:${'a'.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  root: string;
  legacy: string;
  packageArtifact: string;
  binding: string;
  output: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspai-graph-shadow-'));
  roots.push(root);
  const legacy = path.join(root, 'legacy.json');
  const packageArtifact = path.join(root, 'package.json');
  const binding = path.join(root, 'binding.json');
  const output = path.join(root, 'report.json');
  await writeFile(
    legacy,
    JSON.stringify({
      schemaVersion: 'workspace-knowledge-graph.v1',
      entities: [
        {
          id: 'legacy:file',
          kind: 'file',
          identity: { key: 'file:src/index.ts' },
          proofIds: ['p1'],
        },
      ],
      relations: [],
      proofs: [{ id: 'p1', artifact: 'src/index.ts' }],
      quality: { unknownCount: 0, completeness: { status: 'complete' } },
      diagnostics: [],
    })
  );
  await writeFile(
    packageArtifact,
    JSON.stringify({
      graph: {
        contract: { id: 'workspai.graph.canonical-graph', version: '0.1.0-candidate' },
        generation: {
          inputsDigest: { algorithm: 'sha256', value: digest.slice('sha256:'.length) },
          providerSetDigest: { algorithm: 'sha256', value: digest.slice('sha256:'.length) },
          compositionPolicyDigest: {
            algorithm: 'sha256',
            value: digest.slice('sha256:'.length),
          },
        },
        nodes: [{ id: 'file:src/index.ts', kind: 'file' }],
        edges: [
          {
            id: 'edge:evidence',
            from: 'file:src/index.ts',
            to: 'file:src/index.ts',
            relation: 'contains',
            proof: { evidence: [{ relativeLocator: 'src/index.ts' }] },
          },
        ],
        unresolved: [],
        diagnostics: [],
      },
      quality: { unknownZones: [], unsupportedZones: [], coverage: [] },
    })
  );
  await writeFile(
    binding,
    JSON.stringify({
      sourceFixtureDigest: digest,
      scopeDigest: digest,
      providerProfileDigest: digest,
      graphPolicyDigest: digest,
      redactionAuthorizationDigest: digest,
      resourceBudgetDigest: createGraphShadowResourceBudgetDigest(GRAPH_SHADOW_DEFAULT_LIMITS),
      legacyCli: { version: '0.75.1', commit: 'b'.repeat(40) },
      graphPackage: { version: '0.0.0-development', commit: 'c'.repeat(40) },
    })
  );
  return { root, legacy, packageArtifact, binding, output };
}

describe('Graph shadow qualification runner', () => {
  it('writes a deterministic, path-free report and maps differences to a blocking exit code', async () => {
    const files = await fixture();
    const result = await runGraphShadowQualification([
      '--legacy',
      files.legacy,
      '--package',
      files.packageArtifact,
      '--binding',
      files.binding,
      '--profile',
      'real-repository.v1',
      '--output',
      files.output,
    ]);

    expect(result).toMatchObject({ report: { status: 'different' }, exitCode: 3 });
    const output = await readFile(files.output, 'utf8');
    expect(JSON.parse(output)).toEqual(result.report);
    expect(output).not.toContain(files.root);
    expect(result.report.receipt.authority).toBe('released-cli');
  });

  it('does not overwrite an existing output if report publication cannot complete atomically', async () => {
    const files = await fixture();
    await writeFile(files.output, 'preserved\n');
    await expect(
      runGraphShadowQualification([
        '--legacy',
        files.legacy,
        '--package',
        files.packageArtifact,
        '--binding',
        files.binding,
        '--profile',
        'real-repository.v1',
        '--output',
        files.output,
      ])
    ).rejects.toThrow();
    expect(await readFile(files.output, 'utf8')).toBe('preserved\n');
  });

  it('binds the emitted receipt to the complete report content', async () => {
    const files = await fixture();
    const { report } = await runGraphShadowQualification([
      '--legacy',
      files.legacy,
      '--package',
      files.packageArtifact,
      '--binding',
      files.binding,
      '--profile',
      'real-repository.v1',
    ]);
    expect(report.receipt.comparison.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(createHash('sha256').update(JSON.stringify(report)).digest('hex')).not.toBe(
      report.receipt.comparison.reportDigest.slice('sha256:'.length)
    );
  });

  it('consumes the exact released and standalone CLI envelopes without manual conversion', async () => {
    const files = await fixture();
    const legacy = JSON.parse(await readFile(files.legacy, 'utf8')) as unknown;
    const packageArtifact = JSON.parse(await readFile(files.packageArtifact, 'utf8')) as {
      graph: unknown;
      quality: { unknownZones: unknown[]; unsupportedZones: unknown[]; coverage: unknown[] };
    };
    await writeFile(files.legacy, JSON.stringify({ graph: {}, knowledgeGraph: legacy }));
    await writeFile(
      files.packageArtifact,
      JSON.stringify({
        schemaVersion: 'workspai.graph.cli-result.v1',
        command: 'inspect',
        status: 'complete',
        data: {
          build: {
            graph: packageArtifact.graph,
            quality: {
              unknownZones: packageArtifact.quality.unknownZones,
              unsupportedZones: packageArtifact.quality.unsupportedZones,
              graph: { coverage: packageArtifact.quality.coverage },
            },
          },
        },
        diagnostics: [],
      })
    );

    const result = await runGraphShadowQualification([
      '--legacy',
      files.legacy,
      '--package',
      files.packageArtifact,
      '--binding',
      files.binding,
      '--profile',
      'real-repository.v1',
    ]);
    expect(result.report.status).not.toBe('failed');
  });

  it('rejects oversized control artifacts before either graph payload is compared', async () => {
    const files = await fixture();
    await writeFile(files.binding, JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }));
    await expect(
      runGraphShadowQualification([
        '--legacy',
        files.legacy,
        '--package',
        files.packageArtifact,
        '--binding',
        files.binding,
        '--profile',
        'real-repository.v1',
      ])
    ).rejects.toThrow('bounded regular file');
  });
});
