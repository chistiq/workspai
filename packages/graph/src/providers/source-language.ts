import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphUnknownZone,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { graphUnknownObservation } from '../domain/unknown-cause.js';
import { createObservedEdgeFact, extensionOf } from './observed-edge-fact.js';

export const SOURCE_LANGUAGE_PROVIDER_ID = 'workspai.graph.provider.source-language';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.c': 'c',
  '.cc': 'cpp',
  '.cjs': 'javascript',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cs': 'csharp',
  '.cts': 'typescript',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.go': 'go',
  '.h': 'c',
  '.hh': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.java': 'java',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.m': 'objective-c',
  '.mjs': 'javascript',
  '.mm': 'objective-c',
  '.mts': 'typescript',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.swift': 'swift',
  '.ts': 'typescript',
  '.tsx': 'typescript',
});

function languageInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => LANGUAGE_BY_EXTENSION[extensionOf(input.locator)])
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function warning(code: string, scope: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path: scope, message };
}

export function createSourceLanguageProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: SOURCE_LANGUAGE_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Source language inventory',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'language'],
      relationKinds: ['uses-language'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['source.language'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 10_000 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['source-language'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        Boolean(LANGUAGE_BY_EXTENSION[extensionOf(locator)])
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['source-language'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = languageInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphUnknownZone[] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted) {
        throw new Error('Source language repository identity could not be resolved.');
      }
      const languages = new Map<string, GraphProviderInput>();
      for (const input of inputs) {
        const language = LANGUAGE_BY_EXTENSION[extensionOf(input.locator)];
        if (!language) continue;
        const existing = languages.get(language);
        if (!existing || input.locator.localeCompare(existing.locator) < 0) {
          languages.set(language, input);
        }
      }
      const ordered = [...languages.entries()].sort(([left], [right]) => left.localeCompare(right));
      const seen = new Set<string>();
      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Source language collection was cancelled.');
        const language = LANGUAGE_BY_EXTENSION[extensionOf(input.locator)];
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          if (language && !seen.has(language) && facts.length < manifest.limits.maxFacts) {
            const identity = await request.resolveIdentity({
              namespace: 'workspai',
              kind: 'language',
              relativeLocator: language,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!identity.accepted) throw new Error('Language identity could not be resolved.');
            const representative = languages.get(language) ?? input;
            facts.push(
              createObservedEdgeFact({
                factId: `fact:source-language:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'source.language',
                subject: repository.value.reference,
                predicate: 'uses-language',
                object: identity.value.reference,
                request,
                source: representative,
                provider: manifest,
                evidenceId: `evidence:source-language:${language}`,
                sourceKind: 'source-file',
                derivation: 'extracted',
                authority: 'observed',
                confidence: 0.9,
              })
            );
            seen.add(language);
          }
        } catch {
          const failure = warning(
            'graph.source-language-invalid',
            input.locator,
            'Language inventory could not resolve a portable identity for this source input.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push(
            graphUnknownObservation({
              code: 'graph.source-language-unresolved',
              scope: input.locator,
              reason: 'Language identity remained unknown because inventory evidence was rejected.',
              provider: SOURCE_LANGUAGE_PROVIDER_ID,
              stage: 'provider-collect',
            })
          );
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'source-language', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }
      if (ordered.length > facts.length) {
        unknownZones.push(
          graphUnknownObservation({
            code: 'graph.source-language-truncated',
            scope: '.',
            reason: 'Language identities exceeded the provider output budget.',
            provider: SOURCE_LANGUAGE_PROVIDER_ID,
            stage: 'provider-collect',
          })
        );
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:source-language:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [{ dimension: 'source-language', observed: seen.size, expected: languages.size }],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some((entry) => entry.outcome !== 'processed') ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
