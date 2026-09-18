import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const script = path.join(packageRoot, 'scripts/check-g8-real-workspace-matrix-admission.mjs');
const validReport = JSON.parse(
  fs.readFileSync(
    path.join(packageRoot, 'fixtures/g8/valid-real-workspace-platform-report.json'),
    'utf8'
  )
) as Record<string, unknown>;
const temporaryDirectories: string[] = [];
const sourceCommit = 'a'.repeat(40);
const testedCommit = 'b'.repeat(40);

function repositoryRelative(file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function platformReport(
  runnerOs: 'Linux' | 'macOS' | 'Windows',
  platform: 'linux' | 'darwin' | 'win32',
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...structuredClone(validReport),
    environment: { platform, architecture: 'x64', node: 'v20.19.0' },
    platformEvidence: { status: 'passed', runnerOs, runnerArch: 'X64' },
    ci: {
      provider: 'github-actions',
      runId: '1234567890',
      event: 'pull_request',
      sourceCommit,
      testedCommit,
    },
    ...extra,
  };
}

function createEvidenceDirectory(
  reports: Record<string, Record<string, unknown>> = {
    Linux: platformReport('Linux', 'linux'),
    macOS: platformReport('macOS', 'darwin'),
    Windows: platformReport('Windows', 'win32'),
  }
): string {
  const testResultsRoot = path.join(repositoryRoot, 'test-results');
  fs.mkdirSync(testResultsRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testResultsRoot, 'graph-g8-real-workspace-matrix-'));
  temporaryDirectories.push(directory);
  for (const [runnerOs, report] of Object.entries(reports)) {
    fs.writeFileSync(
      path.join(directory, `graph-g8-real-workspace-${runnerOs}.json`),
      `${JSON.stringify(report)}\n`
    );
  }
  return directory;
}

function runAdmission(
  directory: string,
  extraArgs: string[] = [],
  source = sourceCommit,
  tested = testedCommit
) {
  const output = path.join(directory, `candidate-${randomSuffix()}.json`);
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--evidence-directory',
      repositoryRelative(directory),
      '--source-commit',
      source,
      '--tested-commit',
      tested,
      '--output',
      repositoryRelative(output),
      ...extraArgs,
    ],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    output: fs.existsSync(output)
      ? (JSON.parse(fs.readFileSync(output, 'utf8')) as Record<string, unknown>)
      : undefined,
  };
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Graph G8 real-workspace matrix admission', () => {
  it('accepts one same-run Linux, macOS and Windows candidate without authorizing G9', () => {
    const result = runAdmission(createEvidenceDirectory());
    expect(result.stderr, result.stdout).toBe('');
    expect(result.status).toBe(0);
    expect(result.output).toMatchObject({
      stage: 'G8',
      status: 'pr-candidate',
      admitted: false,
      nextStageAuthorized: false,
      crossPlatformAdmission: 'pending',
      currentGraphAuthority: 'official-internal-graph-capability',
      failures: [],
    });
  });

  it('rejects a missing platform', () => {
    const directory = createEvidenceDirectory();
    fs.rmSync(path.join(directory, 'graph-g8-real-workspace-Windows.json'));
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: evidence is missing']),
    });
  });

  it('rejects a duplicate platform', () => {
    const directory = createEvidenceDirectory();
    fs.writeFileSync(
      path.join(directory, 'graph-g8-real-workspace-Windows-duplicate.json'),
      fs.readFileSync(path.join(directory, 'graph-g8-real-workspace-Windows.json'))
    );
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: duplicate platform evidence']),
    });
  });

  it('rejects mixed GitHub run IDs', () => {
    const directory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: platformReport('Windows', 'win32', {
        ci: {
          provider: 'github-actions',
          runId: '999',
          event: 'pull_request',
          sourceCommit,
          testedCommit,
        },
      }),
    });
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'Windows: evidence was mixed across GitHub runs or events',
      ]),
    });
  });

  it('rejects mismatched source or tested commits', () => {
    const directory = createEvidenceDirectory();
    expect(runAdmission(directory, [], sourceCommit, 'c'.repeat(40)).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([expect.stringMatching(/tested commit/)]),
    });
  });

  it('rejects forged authority, write claims, fallback claims and invalid receipts', () => {
    const forged = platformReport('Windows', 'win32', {
      receipt: {
        schemaVersion: 'workspai.graph-model-authority-receipt.v1-candidate',
        epoch: 'package-shadow',
        executionPath: 'compared',
        comparison: {
          status: 'incomparable',
          profile: 'g8-real-workspace.v1',
          reportDigest: `sha256:${'2'.repeat(64)}`,
        },
        authority: 'package-authoritative',
        packageWrites: 'allowed',
        fallback: 'silent',
      },
    });
    const directory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: forged,
    });
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'Windows: invalid or missing authority receipt',
        'Windows: forged authority',
        'Windows: write claim',
        'Windows: fallback claim',
      ]),
    });

    const missingReceipt = platformReport('Windows', 'win32');
    delete missingReceipt.receipt;
    const missingDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: missingReceipt,
    });
    expect(runAdmission(missingDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: invalid or missing authority receipt']),
    });
  });

  it('rejects an unversioned mapping', () => {
    const directory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: platformReport('Windows', 'win32', { mappingVersion: 'latest' }),
    });
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: mapping version is missing or unversioned']),
    });
  });

  it('rejects absolute and parent-traversal evidence paths', () => {
    const directory = createEvidenceDirectory();
    const absolute = spawnSync(
      process.execPath,
      [
        script,
        '--evidence-directory',
        directory,
        '--source-commit',
        sourceCommit,
        '--tested-commit',
        testedCommit,
        '--output',
        repositoryRelative(path.join(directory, 'out.json')),
      ],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    expect(absolute.status).not.toBe(0);
    expect(absolute.stderr).toMatch(/portable repository-relative path/);

    const traversal = spawnSync(
      process.execPath,
      [
        script,
        '--evidence-directory',
        '../packages/graph',
        '--source-commit',
        sourceCommit,
        '--tested-commit',
        testedCommit,
        '--output',
        'packages/graph/governance/g8-forged.json',
      ],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    expect(traversal.status).not.toBe(0);
    expect(traversal.stderr).toMatch(/portable repository-relative path/);
  });

  it('rejects symlink substitution and oversized evidence', () => {
    const directory = createEvidenceDirectory();
    const target = path.join(directory, 'graph-g8-real-workspace-Windows.json');
    const linked = path.join(directory, 'linked.json');
    fs.renameSync(target, linked);
    fs.symlinkSync(linked, target);
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        expect.stringMatching(/oversized or substituted evidence|Windows: evidence is missing/),
      ]),
    });

    const oversizedDirectory = createEvidenceDirectory();
    fs.writeFileSync(
      path.join(oversizedDirectory, 'graph-g8-real-workspace-Windows.json'),
      `${'x'.repeat(1024 * 1024 + 8)}\n`
    );
    expect(runAdmission(oversizedDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        expect.stringMatching(/oversized or substituted evidence/),
      ]),
    });
  });

  it('rejects report digest tampering and inventory drift', () => {
    const tampered = platformReport('Windows', 'win32', {
      reportDigest: `sha256:${'9'.repeat(64)}`,
    });
    const tamperDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: tampered,
    });
    expect(runAdmission(tamperDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: report digest tampering']),
    });

    const drifted = platformReport('Windows', 'win32', {
      inventoryDigest: `sha256:${'8'.repeat(64)}`,
    });
    const driftDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: drifted,
    });
    expect(runAdmission(driftDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: platform semantic parity drifted']),
    });
  });

  it('rejects incomparable corpus results and cross-OS semantic output drift', () => {
    const incomparable = platformReport('Windows', 'win32');
    const qualification = structuredClone(incomparable.qualification) as {
      observations: { comparison: Record<string, unknown> }[];
    };
    qualification.observations[0]!.comparison.status = 'incomparable';
    qualification.observations[0]!.comparison.approvedDifferences = 1;
    qualification.observations[0]!.comparison.differenceCodes = ['GRAPH_SHADOW_NODE_SET_DIFFERENT'];
    const incomparableDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: {
        ...incomparable,
        comparisonStatus: 'incomparable',
        differenceCodes: ['GRAPH_SHADOW_NODE_SET_DIFFERENT'],
        qualification,
      },
    });
    expect(runAdmission(incomparableDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: corpus is not semantically equivalent']),
    });

    const driftedDigest = `sha256:${'9'.repeat(64)}`;
    const drifted = platformReport('Windows', 'win32');
    const driftedQualification = structuredClone(drifted.qualification) as {
      observations: { comparison: Record<string, unknown> }[];
    };
    driftedQualification.observations[0]!.comparison.semanticOutputDigest = driftedDigest;
    const digestDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: {
        ...drifted,
        semanticOutputDigest: driftedDigest,
        qualification: driftedQualification,
      },
    });
    expect(runAdmission(digestDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: platform semantic parity drifted']),
    });
  });

  it('rejects observed mutation, cwd authority and machine-local path leaks with a non-zero exit', () => {
    const mutated = platformReport('Windows', 'win32');
    const mutatedQualification = structuredClone(mutated.qualification) as {
      mutatedCanonicalArtifacts: boolean;
      usedProcessCwdAsAuthority: boolean;
    };
    mutatedQualification.mutatedCanonicalArtifacts = true;
    mutatedQualification.usedProcessCwdAsAuthority = true;
    const mutatedDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: { ...mutated, qualification: mutatedQualification },
    });
    expect(runAdmission(mutatedDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'Windows: canonical artifact mutation was observed',
        'Windows: process.cwd was used as project authority',
      ]),
    });

    const leaked = platformReport('Windows', 'win32', {
      environment: { platform: 'win32', architecture: 'x64', node: '/home/example/secret' },
    });
    const leakedResult = runAdmission(
      createEvidenceDirectory({
        Linux: platformReport('Linux', 'linux'),
        macOS: platformReport('macOS', 'darwin'),
        Windows: leaked,
      })
    );
    expect(leakedResult.status).toBe(1);
    expect(leakedResult.output).toMatchObject({
      status: 'blocked',
      admitted: false,
      failures: expect.arrayContaining(['Windows: machine-local path']),
    });
  });

  it('refuses to overwrite existing matrix output', () => {
    const directory = createEvidenceDirectory();
    const outputDirectory = fs.mkdtempSync(
      path.join(repositoryRoot, 'test-results', 'graph-g8-real-workspace-output-')
    );
    temporaryDirectories.push(outputDirectory);
    const output = path.join(outputDirectory, 'candidate.json');
    fs.writeFileSync(output, 'preserved\n');
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--evidence-directory',
        repositoryRelative(directory),
        '--source-commit',
        sourceCommit,
        '--tested-commit',
        testedCommit,
        '--output',
        repositoryRelative(output),
      ],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/cannot overwrite existing evidence/);
    expect(fs.readFileSync(output, 'utf8')).toBe('preserved\n');
  });

  it('rejects version bindings that are not the tested commit and nested digest drift', () => {
    const wrongCommit = platformReport('Windows', 'win32', {
      versions: {
        cli: { version: '0.75.1', commit: 'c'.repeat(40) },
        graphPackage: { version: '0.0.0-development', commit: testedCommit },
      },
    });
    const commitDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: wrongCommit,
    });
    expect(runAdmission(commitDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'Windows: CLI or Graph package version binding is invalid',
      ]),
    });

    const drifted = platformReport('Windows', 'win32');
    const driftedQualification = structuredClone(drifted.qualification) as {
      observations: { comparison: Record<string, unknown> }[];
    };
    driftedQualification.observations[0]!.comparison.scopeDigest = `sha256:${'9'.repeat(64)}`;
    const scopeDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: {
        ...drifted,
        qualification: driftedQualification,
      },
    });
    expect(runAdmission(scopeDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining(['Windows: scope digest tampering']),
    });

    const unrecomputed = platformReport('Windows', 'win32');
    const unrecomputedQualification = structuredClone(unrecomputed.qualification) as {
      mutatedCanonicalArtifacts: boolean;
    };
    unrecomputedQualification.mutatedCanonicalArtifacts = true;
    const digestDirectory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: {
        ...unrecomputed,
        qualification: unrecomputedQualification,
      },
    });
    expect(runAdmission(digestDirectory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'Windows: canonical artifact mutation was observed',
        'Windows: report digest was not recomputable from the qualification payload',
      ]),
    });
  });

  it('rejects partial package execution and G9 authorization', () => {
    const directory = createEvidenceDirectory({
      Linux: platformReport('Linux', 'linux'),
      macOS: platformReport('macOS', 'darwin'),
      Windows: platformReport('Windows', 'win32', {
        packageExecutionStatus: 'partial',
        nextStageAuthorized: true,
      }),
    });
    expect(runAdmission(directory).output).toMatchObject({
      admitted: false,
      failures: expect.arrayContaining([
        'Windows: G8 authority or admission boundary drifted',
        'Windows: package execution was partial or missing',
      ]),
    });
  });
});
