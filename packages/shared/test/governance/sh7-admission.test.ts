import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, relativePath), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('SH7 standalone-stability admission', () => {
  it('remains blocked while every external and normative gate is not passed', () => {
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
          id: 'independent-external-consumer-value',
          status: 'blocked',
        }),
        expect.objectContaining({ id: 'central-cli-bridge-absence', status: 'passed' }),
      ])
    );
    expect(gates.every((gate) => gate.status === 'passed')).toBe(false);
  });

  it('does not treat local proxies or internal consumers as admission evidence', () => {
    const admission = readJson('governance/sh7-standalone-admission.v1.json') as {
      policy?: Record<string, unknown>;
      gates?: Array<{ id?: string; status?: string; reason?: string }>;
    };

    expect(admission.policy).toMatchObject({
      pendingIsBlocking: true,
      localProxyCannotSatisfyRemoteEvidence: true,
      internalConsumerCannotSatisfyIndependentExternalValue: true,
    });
    expect(admission.gates?.find((gate) => gate.id === 'linux-installed-consumer')).toMatchObject({
      status: 'passed-local',
    });
    expect(
      admission.gates?.find((gate) => gate.id === 'independent-external-consumer-value')?.reason
    ).toContain('neither is an independently owned external consumer');
  });

  it('keeps publication fail-closed until a later admitted closure', () => {
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

  it('requires independently owned, useful and privacy-safe consumer evidence', () => {
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
  });
});
