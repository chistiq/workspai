import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const SCOPE_CONTAINMENT_PROVIDER_ID = 'workspai.graph.provider.scope-containment';
export const WORKSPACE_IDENTITY_INPUT_LOCATOR = 'workspai.workspace-identity';

/** Host-only locators must never be classified as repository files. */
export function isHostSuppliedGraphInputLocator(locator: string): boolean {
  return locator === WORKSPACE_IDENTITY_INPUT_LOCATOR;
}

const PORTABLE_WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;

function parseWorkspaceIdentityDocument(bytes: Uint8Array): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'workspaceId') return null;
  const workspaceId = (parsed as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId !== 'string' || !PORTABLE_WORKSPACE_ID.test(workspaceId)) return null;
  if (workspaceId === '.' || workspaceId === '..') return null;
  if (workspaceId.includes('/') || workspaceId.includes('\\') || workspaceId.includes('\0')) {
    return null;
  }
  return workspaceId;
}

export function createScopeContainmentProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: SCOPE_CONTAINMENT_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Host-supplied workspace containment',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['workspace', 'repository'],
      relationKinds: ['contains'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['scope.containment'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 5_000, maxFacts: 1 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['workspace-identity'],
    incremental: 'none' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.includes(WORKSPACE_IDENTITY_INPUT_LOCATOR);
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['workspace-identity'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      if (request.signal?.aborted) throw new Error('Scope containment collection was cancelled.');
      const identityInput = request.inputs.find(
        (input) => input.locator === WORKSPACE_IDENTITY_INPUT_LOCATOR
      );
      const unknownBatch = (reason: string, code: string): GraphFactBatch => ({
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: 'batch:scope-containment',
        scope: request.scope,
        inputs: identityInput
          ? [{ locator: identityInput.locator, digest: identityInput.digest }]
          : request.inputs.slice(0, 1).map((input) => ({
              locator: input.locator,
              digest: input.digest,
            })),
        facts: [],
        diagnostics: [],
        coverage: [{ dimension: 'scope-containment', observed: 0, expected: 1 }],
        unknownZones: [
          {
            code,
            scope: WORKSPACE_IDENTITY_INPUT_LOCATOR,
            reason,
          },
        ],
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: 'partial',
        processing: identityInput
          ? [
              {
                input: { locator: identityInput.locator, digest: identityInput.digest },
                provider: { id: manifest.id, version: manifest.version },
                stage: { id: 'scope-containment', version: manifest.version },
                outcome: 'failed',
                diagnostics: [],
              },
            ]
          : [],
      });
      if (!identityInput) {
        return unknownBatch(
          'Workspace containment is unknown because the host did not supply workspai.workspace-identity evidence.',
          'graph.scope-containment-identity-missing'
        );
      }
      const bytes = await request.readInput(identityInput, {
        maxBytes: 4 * 1024,
        signal: request.signal,
      });
      const workspaceId = parseWorkspaceIdentityDocument(bytes);
      if (!workspaceId) {
        return unknownBatch(
          'Workspace containment is unknown because the host identity document is invalid.',
          'graph.scope-containment-identity-invalid'
        );
      }
      const workspace = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'workspace',
        relativeLocator: workspaceId,
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!workspace.accepted || !repository.accepted) {
        throw new Error('Scope containment identities could not be resolved.');
      }
      const facts: GraphWorkspaceFact[] = [
        {
          factId: `fact:scope-containment:${identityInput.digest.value}`,
          factType: 'scope.containment',
          subject: workspace.value.reference,
          predicate: 'contains',
          object: repository.value.reference,
          scope: request.scope,
          evidence: [
            {
              id: 'evidence:scope-containment',
              sourceKind: 'workspace-identity',
              relativeLocator: identityInput.locator,
              digest: identityInput.digest,
            },
          ],
          provenance: { id: manifest.id, version: manifest.version },
          derivation: 'declared',
          authority: 'declared',
          confidence: 1,
          freshness: { status: 'current' },
          truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
          observedAt: request.observedAt,
          inputDigest: identityInput.digest,
          unknownZones: [],
        },
      ];

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: 'batch:scope-containment',
        scope: request.scope,
        inputs: [{ locator: identityInput.locator, digest: identityInput.digest }],
        facts,
        diagnostics: [],
        coverage: [{ dimension: 'scope-containment', observed: 1, expected: 1 }],
        unknownZones: [],
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: 'complete',
        processing: [
          {
            input: { locator: identityInput.locator, digest: identityInput.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'scope-containment', version: manifest.version },
            outcome: 'processed',
            outputDigest: identityInput.digest,
            diagnostics: [],
          },
        ],
      } satisfies GraphFactBatch;
    },
  };
}
