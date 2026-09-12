import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const GIT_HEAD_PROVIDER_ID = 'workspai.graph.provider.git-head';
const GIT_HEAD_LOCATOR = '.git/HEAD';

function admittedLocalBranch(value: string): string | undefined {
  const prefix = 'ref: refs/heads/';
  if (!value.startsWith(prefix)) return undefined;
  const branch = value.slice(prefix.length);
  if (
    branch.length === 0 ||
    branch.length > 512 ||
    branch.startsWith('.') ||
    branch.startsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    !/^[A-Za-z0-9._/-]+$/u.test(branch)
  ) {
    return undefined;
  }
  return branch;
}

export function createGitHeadProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: GIT_HEAD_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Git HEAD identity',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'branch', 'revision'],
      relationKinds: ['contains'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['git.head'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 5_000, maxFacts: 1, maxInputBytes: 4_096 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['git-head'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: request.availableInputs.includes(GIT_HEAD_LOCATOR) ? 'applicable' : 'not-applicable',
      matchedInputs: request.availableInputs.includes(GIT_HEAD_LOCATOR) ? ['git-head'] : [],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: async (request) => {
      const input = request.inputs.find((candidate) => candidate.locator === GIT_HEAD_LOCATOR);
      if (!input) throw new Error('Admitted Git HEAD input is unavailable.');
      const bytes = await request.readInput(input, { maxBytes: 4_096, signal: request.signal });
      const head = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
      const branch = admittedLocalBranch(head);
      const detached = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head);
      const unknown =
        branch || detached
          ? []
          : [
              {
                code: 'graph.git-head-format-unsupported',
                scope: 'repository',
                reason:
                  'Git HEAD is neither an admitted local branch reference nor a detached revision.',
              },
            ];
      const facts: GraphWorkspaceFact[] = [];
      if (branch || detached) {
        const repository = await request.resolveIdentity({
          namespace: 'workspai',
          kind: 'repository',
          relativeLocator: '.',
          caseSensitivity: 'sensitive',
          scope: request.scope,
        });
        const target = await request.resolveIdentity({
          namespace: 'git',
          kind: branch ? 'branch' : 'revision',
          relativeLocator: branch ? `refs/heads/${branch}` : `revision:${head}`,
          caseSensitivity: 'sensitive',
          scope: request.scope,
        });
        if (!repository.accepted || !target.accepted) {
          throw new Error('Git HEAD identity could not be resolved.');
        }
        facts.push({
          factId: `fact:git-head:${input.digest.value}`,
          factType: 'git.head',
          subject: repository.value.reference,
          predicate: 'contains',
          object: target.value.reference,
          scope: request.scope,
          evidence: [
            {
              id: 'evidence:git-head',
              sourceKind: 'git-head',
              relativeLocator: input.locator,
              digest: input.digest,
            },
          ],
          provenance: { id: manifest.id, version: manifest.version },
          derivation: 'observed',
          authority: 'observed',
          confidence: 1,
          freshness: { status: 'current' },
          truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
          observedAt: request.observedAt,
          inputDigest: input.digest,
          unknownZones: [],
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:git-head:${input.digest.value}`,
        scope: request.scope,
        inputs: [{ locator: input.locator, digest: input.digest }],
        facts,
        diagnostics: [],
        coverage: [{ dimension: 'git-head', observed: facts.length, expected: 1 }],
        unknownZones: unknown,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: facts.length === 1 ? 'complete' : 'partial',
        processing: [
          {
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'git-head-identity', version: manifest.version },
            outcome: facts.length === 1 ? 'processed' : 'unsupported',
            ...(facts.length === 1 ? { outputDigest: input.digest } : {}),
            diagnostics: [],
          },
        ],
      } satisfies GraphFactBatch;
    },
  };
}
