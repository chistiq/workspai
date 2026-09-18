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
import { isPackageJsonLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { decodeUtf8, isRecord, scalarString, warning } from './provider-support.js';

export const VSCODE_EXTENSION_MANIFEST_PROVIDER_ID =
  'workspai.graph.provider.vscode-extension-manifest';

const MAX_BYTES = 2 * 1024 * 1024;

function manifestInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isPackageJsonLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function isVscodeManifest(value: Record<string, unknown>): boolean {
  const engines = isRecord(value.engines) ? value.engines : {};
  return Boolean(scalarString(engines.vscode) || isRecord(value.contributes));
}

export function createVscodeExtensionManifestProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: VSCODE_EXTENSION_MANIFEST_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'VS Code extension manifest commands',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'package', 'api'],
      relationKinds: ['contains', 'exposes'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['manifest.vscode-extension', 'manifest.vscode-command'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 50_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['vscode-extension-manifest'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => isPackageJsonLocator(locator));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['vscode-extension-manifest'] : [],
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
        throw new Error('VS Code repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('VS Code extension collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const value: unknown = JSON.parse(
            decodeUtf8(
              await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
            )
          );
          if (!isRecord(value) || !isVscodeManifest(value)) {
            processing.push({
              input: { locator: input.locator, digest: input.digest },
              provider: { id: manifest.id, version: manifest.version },
              stage: { id: 'vscode-extension-manifest', version: manifest.version },
              outcome: 'processed',
              outputDigest: input.digest,
              diagnostics: [],
            });
            continue;
          }
          const extension = await request.resolveIdentity({
            namespace: 'vscode-extension',
            kind: 'package',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!extension.accepted)
            throw new Error('VS Code extension identity could not be resolved.');
          facts.push(
            createObservedEdgeFact({
              factId: `fact:vscode-extension:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'manifest.vscode-extension',
              subject: repository.value.reference,
              predicate: 'contains',
              object: extension.value.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:vscode:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'package-manifest',
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
            })
          );
          const contributes = isRecord(value.contributes) ? value.contributes : {};
          const commands = Array.isArray(contributes.commands) ? contributes.commands : [];
          for (const [commandIndex, rawCommand] of commands.entries()) {
            const command = isRecord(rawCommand) ? rawCommand : {};
            const commandId = scalarString(command.command);
            if (!commandId) continue;
            const api = await request.resolveIdentity({
              namespace: 'vscode-command',
              kind: 'api',
              relativeLocator: `commands/${encodeURIComponent(commandId)}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!api.accepted) throw new Error('VS Code command identity could not be resolved.');
            facts.push(
              createObservedEdgeFact({
                factId: `fact:vscode-command:${String(inputIndex).padStart(8, '0')}:${String(commandIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'manifest.vscode-command',
                subject: extension.value.reference,
                predicate: 'exposes',
                object: api.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId: `evidence:vscode:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'package-manifest',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
          }
        } catch {
          const failure = warning(
            'graph.vscode-manifest-invalid',
            input.locator,
            'VS Code extension manifest could not be admitted as a portable command surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.vscode-manifest-unreadable',
            scope: input.locator,
            reason: 'VS Code commands remained unknown because the manifest could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'vscode-extension-manifest', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:vscode-extension-manifest:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          {
            dimension: 'vscode-manifests',
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
