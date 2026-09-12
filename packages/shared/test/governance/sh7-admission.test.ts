import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, relativePath), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('SH7 internal standalone-stability admission', () => {
  it('remains blocked while normative and remote gates are not passed', () => {
    const admission = readJson('governance/sh7-standalone-admission.v1.json') as {
      status?: string;
      admitted?: boolean;
      gates?: Array<{ id?: string; status?: string }>;
    };
    const gates = admission.gates ?? [];

    expect(admission).toMatchObject({ status: 'blocked', admitted: false });
    expect(gates).toHaveLength(13);
    expect(new Set(gates.map((gate) => gate.id)).size).toBe(gates.length);
    expect(gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'normative-semantic-lock', status: 'blocked' }),
        expect.objectContaining({ id: 'real-browser-runtime', status: 'pending-remote' }),
        expect.objectContaining({
          id: 'registered-internal-graph-consumer',
          status: 'passed-local',
        }),
        expect.objectContaining({ id: 'central-cli-bridge-absence', status: 'passed' }),
      ])
    );
    expect(gates.every((gate) => gate.status === 'passed')).toBe(false);
  });

  it('accepts registered internal consumers without treating local evidence as remote', () => {
    const admission = readJson('governance/sh7-standalone-admission.v1.json') as {
      policy?: Record<string, unknown>;
      gates?: Array<{ id?: string; status?: string; reason?: string }>;
    };

    expect(admission.policy).toMatchObject({
      pendingIsBlocking: true,
      localProxyCannotSatisfyRemoteEvidence: true,
      registeredInternalConsumerIsRequired: true,
      publicationMustRemainDisabledAfterAdmission: true,
    });
    expect(admission.gates?.find((gate) => gate.id === 'linux-installed-consumer')).toMatchObject({
      status: 'passed-local',
    });
    expect(
      admission.gates?.find((gate) => gate.id === 'registered-internal-graph-consumer')
    ).toMatchObject({
      status: 'passed-local',
    });
  });

  it('keeps npm publication fail-closed even after internal admission', () => {
    const manifest = readJson('package.json') as {
      private?: boolean;
      scripts?: Record<string, string>;
    };

    expect(manifest.private).toBe(true);
    expect(manifest.scripts?.prepublishOnly).toBe('node scripts/refuse-publish.mjs');
    expect(manifest.scripts?.['admission:check']).toBe(
      'node scripts/check-standalone-admission.mjs'
    );
    expect(manifest.scripts?.['admission:audit']).toContain('--allow-blocked');
  });

  it('retains external-consumer evidence as a future policy outside internal admission', () => {
    const admission = readJson('governance/sh7-standalone-admission.v1.json') as {
      gates?: Array<{ id?: string }>;
    };
    const policy = readJson('governance/sh7-external-consumer-evidence-policy.v1.json') as {
      status?: string;
      independence?: Record<string, unknown>;
      requiredAttestation?: {
        minimumUseCases?: number;
        requiredOutcomes?: string[];
        admissionValue?: string;
      };
      privacy?: Record<string, unknown>;
      rejectionRules?: string[];
    };

    expect(policy.status).toBe('required-not-satisfied');
    expect(policy.independence).toMatchObject({
      consumerOwnership: 'not-controlled-by-package-maintainer',
      monorepoSourceImports: 'forbidden',
      centralCliDependency: 'forbidden',
      fixtureOnlyConsumer: 'insufficient',
      internalWorkspaiPackage: 'insufficient',
    });
    expect(policy.requiredAttestation).toMatchObject({
      minimumUseCases: 2,
      admissionValue: 'useful',
    });
    expect(policy.requiredAttestation?.requiredOutcomes).toContain(
      'diagnostics-consumed-without-terminal-parsing'
    );
    expect(policy.privacy).toMatchObject({
      rawSource: 'prohibited',
      rawArtifactPayload: 'prohibited',
      credentialsAndSecrets: 'prohibited',
      publicEvidence: 'consent-required',
    });
    expect(policy.rejectionRules).toContain(
      'maintainer-authored-demo-does-not-prove-external-value'
    );
    expect(admission.gates?.map((gate) => gate.id)).not.toContain(
      'independent-external-consumer-value'
    );
  });

  it('audits the private internal candidate without authorizing SH8', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/check-standalone-admission.mjs', '--allow-blocked', '--json'],
      { cwd: packageRoot, encoding: 'utf8' }
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'blocked',
      admitted: false,
      standaloneStable: false,
      distribution: 'internal-only',
      npmPublication: 'prohibited',
      nextStage: 'SH8',
      nextStageAuthorized: false,
      failures: [],
    });
  });

  it('rejects forged admission while the registry remains unadmitted', () => {
    const resultRoot = path.join(packageRoot, 'test-results');
    fs.mkdirSync(resultRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(resultRoot, 'sh7-admission-'));
    temporary.push(directory);
    const admission = readJson('governance/sh7-standalone-admission.v1.json') as {
      status: string;
      admitted: boolean;
      standaloneStable: boolean;
      nextStageAuthorized: boolean;
      gates: Array<Record<string, unknown>>;
    };
    admission.gates = admission.gates.map((gate) => ({ ...gate, status: 'passed' }));
    admission.status = 'admitted';
    admission.admitted = true;
    admission.standaloneStable = true;
    admission.nextStageAuthorized = true;
    const manifest = path.join(directory, 'forged-admission.json');
    fs.writeFileSync(manifest, JSON.stringify(admission));
    const relative = path.relative(repositoryRoot, manifest).split(path.sep).join(path.posix.sep);

    const result = spawnSync(
      process.execPath,
      [
        'scripts/check-standalone-admission.mjs',
        '--allow-blocked',
        '--json',
        '--manifest',
        relative,
      ],
      { cwd: packageRoot, encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'invalid',
      admitted: false,
      standaloneStable: false,
      nextStageAuthorized: false,
    });
    expect(JSON.parse(result.stdout).failures).toContain(
      'admitted Shared state is not reflected by the package registry'
    );
  });
});
