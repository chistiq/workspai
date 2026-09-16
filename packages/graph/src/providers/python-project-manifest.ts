import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
} from '../contracts/index.js';
import { isPythonProjectManifestLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { decodeUtf8, warning } from './provider-support.js';

export const PYTHON_PROJECT_MANIFEST_PROVIDER_ID =
  'workspai.graph.provider.python-project-manifest';

const MAX_BYTES = 2 * 1024 * 1024;

function manifestInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isPythonProjectManifestLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

export function parseTomlStringTable(
  contents: string,
  table: string
): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  let active = false;
  for (const line of contents.split(/\r?\n/u)) {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line)?.[1]?.trim();
    if (header) {
      active = header === table;
      continue;
    }
    if (!active || /^\s*(?:#|$)/u.test(line)) continue;
    const match = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=\s*["']([^"']+)["']/u.exec(
      line
    );
    const key = match?.[1] ?? match?.[2] ?? match?.[3];
    const value = match?.[4];
    if (key && value) entries.push([key, value]);
  }
  return entries;
}

export function createPythonProjectManifestProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: PYTHON_PROJECT_MANIFEST_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Python project manifest scripts',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'api'],
      relationKinds: ['exposes'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['manifest.python-script'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 20_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['python-project-manifest'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        isPythonProjectManifestLocator(locator)
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['python-project-manifest'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = manifestInputs(request.inputs);
      const facts: GraphFactBatch['facts'][number][] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted)
        throw new Error('Python manifest repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Python manifest collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          const scripts = parseTomlStringTable(source, 'project.scripts');
          for (const [scriptIndex, [script]] of scripts.entries()) {
            const api = await request.resolveIdentity({
              namespace: 'python-console-script',
              kind: 'api',
              relativeLocator: `scripts/${encodeURIComponent(script)}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!api.accepted)
              throw new Error('Python console script identity could not be resolved.');
            facts.push(
              createObservedEdgeFact({
                factId: `fact:python-script:${String(inputIndex).padStart(8, '0')}:${String(scriptIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'manifest.python-script',
                subject: repository.value.reference,
                predicate: 'exposes',
                object: api.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId: `evidence:python-manifest:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'package-manifest',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
          }
        } catch {
          const failure = warning(
            'graph.python-manifest-invalid',
            input.locator,
            'Python project manifest could not be admitted as a portable script surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.python-manifest-unreadable',
            scope: input.locator,
            reason:
              'Python console scripts remained unknown because the manifest could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'python-project-manifest', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:python-project-manifest:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'python-manifests',
            observed: inputs.length,
            expected: inputs.length,
          },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status:
          processing.some((entry) => entry.outcome !== 'processed') || unknownZones.length > 0
            ? 'partial'
            : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
