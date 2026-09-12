import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';

export const PACKAGE_JSON_PROVIDER_ID = 'workspai.graph.provider.package-json';

const MAX_PACKAGE_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DEPENDENCIES_PER_MANIFEST = 10_000;

function packageJsonInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => input.locator === 'package.json' || input.locator.endsWith('/package.json'))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function dependencyNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value).filter((name) => name.length > 0);
}

function packageDirectory(locator: string): string {
  const separator = locator.lastIndexOf('/');
  return separator === -1 ? '.' : locator.slice(0, separator);
}

function diagnostic(code: string, path: string, message: string): GraphDiagnostic {
  return { code, severity: 'warning', path, message };
}

export function createPackageJsonProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: PACKAGE_JSON_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Package.json declarations',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'package', 'command'],
      relationKinds: ['contains', 'depends-on', 'declares'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['manifest.package', 'manifest.dependency', 'manifest.script'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: {
      maxDurationMs: 30_000,
      maxFacts: 200_000,
      maxInputBytes: MAX_PACKAGE_JSON_BYTES,
    },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['package.json'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => ({
      contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
      provider: { id: manifest.id, version: manifest.version },
      status: request.availableInputs.some(
        (locator) => locator === 'package.json' || locator.endsWith('/package.json')
      )
        ? 'applicable'
        : 'not-applicable',
      matchedInputs: request.availableInputs.some(
        (locator) => locator === 'package.json' || locator.endsWith('/package.json')
      )
        ? ['package.json']
        : [],
      missingPermissions: [],
      diagnostics: [],
    }),
    collect: async (request) => {
      const inputs = packageJsonInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
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
      if (!repository.accepted) {
        throw new Error('Package manifest repository identity could not be resolved.');
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('Package manifest collection was cancelled.');
        try {
          const bytes = await request.readInput(input, {
            maxBytes: MAX_PACKAGE_JSON_BYTES,
            signal: request.signal,
          });
          const value: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          );
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error('Package manifest root is not an object.');
          }
          const record = value as Record<string, unknown>;
          const declaredName =
            typeof record.name === 'string' && record.name.trim() ? record.name : null;
          const packageLocator = `${packageDirectory(input.locator)}#${declaredName ?? 'unnamed'}`;
          if (!declaredName) {
            unknownZones.push({
              code: 'graph.package-name-undeclared',
              scope: input.locator,
              reason: 'The package manifest does not declare a package name.',
            });
          }
          const packageIdentity = await request.resolveIdentity({
            namespace: 'npm-project',
            kind: 'package',
            relativeLocator: packageLocator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!packageIdentity.accepted) throw new Error('Package identity could not be resolved.');

          facts.push({
            factId: `fact:package-json:contains:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
            factType: 'manifest.package',
            subject: repository.value.reference,
            predicate: 'contains',
            object: packageIdentity.value.reference,
            scope: request.scope,
            evidence: [
              {
                id: `evidence:package-json:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'package-manifest',
                relativeLocator: input.locator,
                digest: input.digest,
              },
            ],
            provenance: { id: manifest.id, version: manifest.version },
            derivation: 'declared',
            authority: 'declared',
            confidence: 1,
            freshness: { status: 'current' },
            truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
            observedAt: request.observedAt,
            inputDigest: input.digest,
            unknownZones: declaredName
              ? []
              : [
                  {
                    code: 'graph.package-name-undeclared',
                    scope: input.locator,
                    reason: 'The package manifest does not declare a package name.',
                  },
                ],
          });

          const dependencies = [
            ...new Set([
              ...dependencyNames(record.dependencies),
              ...dependencyNames(record.devDependencies),
              ...dependencyNames(record.peerDependencies),
              ...dependencyNames(record.optionalDependencies),
            ]),
          ].sort((left, right) => left.localeCompare(right));
          const futureManifestFacts = inputs.length - inputIndex - 1;
          const remainingFactBudget = Math.max(
            0,
            manifest.limits.maxFacts - facts.length - futureManifestFacts
          );
          const admittedDependencies = dependencies.slice(
            0,
            Math.min(MAX_DEPENDENCIES_PER_MANIFEST, remainingFactBudget)
          );
          if (dependencies.length > admittedDependencies.length) {
            diagnostics.push(
              diagnostic(
                'graph.package-dependency-limit-reached',
                input.locator,
                'Package dependencies exceeded the provider fact budget and were truncated.'
              )
            );
            unknownZones.push({
              code: 'graph.package-dependencies-truncated',
              scope: input.locator,
              reason: 'Some declared dependencies were omitted by the provider resource policy.',
            });
          }
          for (const [dependencyIndex, dependencyName] of admittedDependencies.entries()) {
            const dependency = await request.resolveIdentity({
              namespace: 'npm-package',
              kind: 'package',
              relativeLocator: `dependency:${dependencyName}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!dependency.accepted) throw new Error('Dependency identity could not be resolved.');
            facts.push({
              factId: `fact:package-json:dependency:${String(inputIndex).padStart(8, '0')}:${String(dependencyIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'manifest.dependency',
              subject: packageIdentity.value.reference,
              predicate: 'depends-on',
              object: dependency.value.reference,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:package-json:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'package-manifest',
                  relativeLocator: input.locator,
                  digest: input.digest,
                },
              ],
              provenance: { id: manifest.id, version: manifest.version },
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
              freshness: { status: 'current' },
              truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
              observedAt: request.observedAt,
              inputDigest: input.digest,
              unknownZones: [],
            });
          }
          const scripts = dependencyNames(record.scripts).sort((left, right) =>
            left.localeCompare(right)
          );
          const admittedScripts = scripts.slice(
            0,
            Math.max(0, manifest.limits.maxFacts - facts.length - futureManifestFacts)
          );
          if (scripts.length > admittedScripts.length) {
            diagnostics.push(
              diagnostic(
                'graph.package-script-limit-reached',
                input.locator,
                'Package scripts exceeded the provider fact budget and were truncated.'
              )
            );
            unknownZones.push({
              code: 'graph.package-scripts-truncated',
              scope: input.locator,
              reason:
                'Some declared script identities were omitted by the provider resource policy.',
            });
          }
          for (const [scriptIndex, scriptName] of admittedScripts.entries()) {
            const command = await request.resolveIdentity({
              namespace: 'npm-script',
              kind: 'command',
              relativeLocator: `${packageLocator}:${scriptName}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!command.accepted)
              throw new Error('Package script identity could not be resolved.');
            facts.push({
              factId: `fact:package-json:script:${String(inputIndex).padStart(8, '0')}:${String(scriptIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'manifest.script',
              subject: packageIdentity.value.reference,
              predicate: 'declares',
              object: command.value.reference,
              scope: request.scope,
              evidence: [
                {
                  id: `evidence:package-json:${String(inputIndex).padStart(8, '0')}`,
                  sourceKind: 'package-manifest',
                  relativeLocator: input.locator,
                  digest: input.digest,
                },
              ],
              provenance: { id: manifest.id, version: manifest.version },
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
              freshness: { status: 'current' },
              truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
              observedAt: request.observedAt,
              inputDigest: input.digest,
              unknownZones: [],
            });
          }
          const truncated =
            dependencies.length > admittedDependencies.length ||
            scripts.length > admittedScripts.length;
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'package-json-declarations', version: manifest.version },
            outcome: truncated ? 'omitted' : 'processed',
            ...(truncated ? {} : { outputDigest: input.digest }),
            diagnostics: diagnostics.filter((entry) => entry.path === input.locator),
          });
        } catch {
          const failure = diagnostic(
            'graph.package-manifest-invalid',
            input.locator,
            'Package manifest could not be parsed within the admitted provider boundary.'
          );
          diagnostics.push(failure);
          unknownZones.push({
            code: 'graph.package-manifest-unreadable',
            scope: input.locator,
            reason: 'Package declarations are unknown because the manifest could not be admitted.',
          });
          processing.push({
            input: { locator: input.locator, digest: input.digest },
            provider: { id: manifest.id, version: manifest.version },
            stage: { id: 'package-json-declarations', version: manifest.version },
            outcome: 'failed',
            diagnostics: [failure],
          });
        }
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:package-json:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'package-manifests', observed: inputs.length, expected: inputs.length },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some(
          (entry) => entry.outcome === 'failed' || entry.outcome === 'omitted'
        )
          ? 'partial'
          : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
