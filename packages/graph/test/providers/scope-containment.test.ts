import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_IDENTITY_SCHEME,
  type GraphFactBatch,
  type GraphProviderInput,
} from '../../src/contracts/index.js';
import {
  WORKSPACE_IDENTITY_INPUT_LOCATOR,
  createRepositoryFilesProvider,
  createScopeContainmentProvider,
  createStandardRepositoryProviders,
  isHostSuppliedGraphInputLocator,
} from '../../src/providers/index.js';

const scope = { kind: 'project' as const, projectIds: ['node-catalog-service'] as [string] };

function digestOf(content: string) {
  return {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(content).digest('hex'),
  };
}

function identityInput(content: string): GraphProviderInput {
  const bytes = new TextEncoder().encode(content);
  return {
    locator: WORKSPACE_IDENTITY_INPUT_LOCATOR,
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    digest: digestOf(content),
  };
}

describe('host-supplied workspace containment', () => {
  const provider = createScopeContainmentProvider();

  it('is not part of the standard repository provider set', () => {
    expect(
      createStandardRepositoryProviders().some(
        (item) => item.manifest.id === 'workspai.graph.provider.scope-containment'
      )
    ).toBe(false);
  });

  it('is not applicable until the host supplies workspai.workspace-identity', () => {
    expect(
      provider.detect({
        availableInputs: ['src/index.ts', 'package.json'],
        scopeKind: 'project',
        networkAllowed: false,
      })
    ).toMatchObject({ status: 'not-applicable', matchedInputs: [] });
    expect(
      provider.detect({
        availableInputs: [WORKSPACE_IDENTITY_INPUT_LOCATOR],
        scopeKind: 'workspace',
        networkAllowed: false,
      })
    ).toMatchObject({ status: 'applicable', matchedInputs: ['workspace-identity'] });
  });

  it('does not derive workspace identity from projectId or identity digests', async () => {
    const document = '{"workspaceId":"platform-workspace"}';
    const source = identityInput(document);
    const identities: string[] = [];
    const batch = (await provider.collect({
      scope,
      inputs: [source],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async (identity) => {
        identities.push(`${identity.kind}:${identity.relativeLocator}`);
        return {
          accepted: true as const,
          issues: [] as const,
          value: {
            reference: {
              id: `entity:${identity.kind}:${identity.relativeLocator}:sha256:${source.digest.value}`,
              identityScheme: GRAPH_IDENTITY_SCHEME,
              kind: identity.kind,
              scope,
            },
            normalizedLocator: identity.relativeLocator,
          },
        };
      },
      readInput: async () => new TextEncoder().encode(document),
    })) as GraphFactBatch;
    expect(batch.status).toBe('complete');
    expect(identities).toEqual(['workspace:platform-workspace', 'repository:.']);
    expect(identities.some((item) => item.includes('node-catalog-service'))).toBe(false);
    expect(batch.facts).toHaveLength(1);
    expect(batch.facts[0]?.inputDigest).toEqual(source.digest);
    expect(batch.facts[0]?.evidence[0]?.digest).toEqual(source.digest);
    expect(batch.facts[0]?.evidence[0]?.relativeLocator).toBe(WORKSPACE_IDENTITY_INPUT_LOCATOR);
    expect(batch.facts[0]?.factId).toBe(`fact:scope-containment:${source.digest.value}`);
  });

  it('leaves containment unknown when the host identity document is missing or invalid', async () => {
    const missing = (await provider.collect({
      scope,
      inputs: [
        {
          locator: 'src/index.ts',
          mediaType: 'text/plain',
          byteLength: 1,
          digest: digestOf('x'),
        },
      ],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async () => {
        throw new Error('identity must not be invented without host evidence');
      },
      readInput: async () => new Uint8Array(),
    })) as GraphFactBatch;
    expect(missing.status).toBe('partial');
    expect(missing.facts).toEqual([]);
    expect(missing.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.scope-containment-identity-missing' })
    );

    const invalid = (await provider.collect({
      scope,
      inputs: [identityInput('{"projectId":"node-catalog-service"}')],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async () => {
        throw new Error('identity must not be invented from an invalid document');
      },
      readInput: async () => new TextEncoder().encode('{"projectId":"node-catalog-service"}'),
    })) as GraphFactBatch;
    expect(invalid.status).toBe('partial');
    expect(invalid.facts).toEqual([]);
    expect(invalid.unknownZones).toContainEqual(
      expect.objectContaining({ code: 'graph.scope-containment-identity-invalid' })
    );
  });

  it('does not classify the host workspace-identity locator as a repository file', async () => {
    expect(isHostSuppliedGraphInputLocator(WORKSPACE_IDENTITY_INPUT_LOCATOR)).toBe(true);
    expect(isHostSuppliedGraphInputLocator('README.md')).toBe(false);
    const files = createRepositoryFilesProvider();
    const source = identityInput('{"workspaceId":"platform-workspace"}');
    const readme = {
      locator: 'README.md',
      mediaType: 'text/markdown',
      byteLength: 8,
      digest: digestOf('# readme'),
    };
    expect(
      files.detect({
        availableInputs: [WORKSPACE_IDENTITY_INPUT_LOCATOR],
        scopeKind: 'project',
        networkAllowed: false,
      })
    ).toMatchObject({ status: 'not-applicable', matchedInputs: [] });
    const batch = (await files.collect({
      scope,
      inputs: [source, readme],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async (identity) => ({
        accepted: true as const,
        issues: [] as const,
        value: {
          reference: {
            id: `entity:${identity.kind}:${identity.relativeLocator}`,
            identityScheme: GRAPH_IDENTITY_SCHEME,
            kind: identity.kind,
            scope,
          },
          normalizedLocator: identity.relativeLocator,
        },
      }),
      readInput: async () => new Uint8Array(),
    })) as GraphFactBatch;
    expect(batch.facts.map((fact) => fact.object.kind)).toEqual(['file']);
    expect(JSON.stringify(batch.facts)).toContain('README.md');
    expect(JSON.stringify(batch)).not.toContain(WORKSPACE_IDENTITY_INPUT_LOCATOR);
  });
});
