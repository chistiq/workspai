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
import { isCiWorkflowLocator } from './delivery-locators.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { basenameOf, decodeUtf8, isRecord, uniqueStrings, warning } from './provider-support.js';
import { parseStructuredDocuments } from './structured-documents.js';

export const CI_WORKFLOW_PROVIDER_ID = 'workspai.graph.provider.ci-workflow';

const MAX_BYTES = 4 * 1024 * 1024;
const GITLAB_RESERVED = new Set([
  'stages',
  'variables',
  'workflow',
  'include',
  'default',
  'image',
  'services',
  'cache',
  'before_script',
  'after_script',
]);

function ciInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => isCiWorkflowLocator(input.locator))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.filter((entry): entry is string => typeof entry === 'string'));
  }
  if (isRecord(value)) return uniqueStrings(Object.keys(value));
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function jobsFromDocument(locator: string, source: string, document: unknown): string[] {
  const name = basenameOf(locator);
  if (name === 'Jenkinsfile') {
    return uniqueStrings(
      [...source.matchAll(/\bstage\s*\(\s*["']([^"']+)["']/gu)].map((match) => match[1] ?? '')
    );
  }
  if (/(?:^|\/)prow\/[^/]+\.(?:sh|py)$/iu.test(locator)) {
    return [name.replace(/\.(?:sh|py)$/iu, '')];
  }
  if (!isRecord(document)) return [];
  if (/(?:^|\/)\.gitlab-ci\./iu.test(locator)) {
    return uniqueStrings(
      Object.keys(document).filter((key) => !key.startsWith('.') && !GITLAB_RESERVED.has(key))
    );
  }
  const jobs = isRecord(document.jobs) ? Object.keys(document.jobs) : [];
  const workflowJobs =
    isRecord(document.workflows) && isRecord(document.workflows.jobs)
      ? Object.keys(document.workflows.jobs)
      : [];
  const stages = stringList(document.stages);
  return uniqueStrings([...jobs, ...workflowJobs, ...stages]);
}

export function createCiWorkflowProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: CI_WORKFLOW_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'CI workflow and pipeline topology',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'pipeline', 'command'],
      relationKinds: ['contains'],
      relationSemantics: ['declarative'] as const,
      factFamilies: ['delivery.ci-pipeline', 'delivery.ci-job'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 100_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: ['ci-workflows'],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) => isCiWorkflowLocator(locator));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? ['ci-workflows'] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = ciInputs(request.inputs);
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
      if (!repository.accepted) throw new Error('CI repository identity could not be resolved.');

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted) throw new Error('CI collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const source = decodeUtf8(
            await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
          );
          const name = basenameOf(input.locator);
          const document =
            name === 'Jenkinsfile' || /\.(?:sh|py)$/iu.test(name)
              ? undefined
              : parseStructuredDocuments(source, input.locator)[0];
          const jobs = jobsFromDocument(input.locator, source, document);
          const pipelineJobs = jobs.length > 0 ? jobs : ['pipeline'];
          const pipeline = await request.resolveIdentity({
            namespace: 'ci-workflow',
            kind: 'pipeline',
            relativeLocator: input.locator,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!pipeline.accepted) throw new Error('CI pipeline identity could not be resolved.');
          facts.push(
            createObservedEdgeFact({
              factId: `fact:ci-pipeline:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'delivery.ci-pipeline',
              subject: repository.value.reference,
              predicate: 'contains',
              object: pipeline.value.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId: `evidence:ci:${String(inputIndex).padStart(8, '0')}`,
              sourceKind: 'delivery-declaration',
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
            })
          );
          for (const [jobIndex, job] of pipelineJobs.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              throw new Error('CI facts exceeded the provider output budget.');
            }
            const command = await request.resolveIdentity({
              namespace: 'ci-workflow',
              kind: 'command',
              relativeLocator: `${input.locator}#${job}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!command.accepted) throw new Error('CI job identity could not be resolved.');
            facts.push(
              createObservedEdgeFact({
                factId: `fact:ci-job:${String(inputIndex).padStart(8, '0')}:${String(jobIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'delivery.ci-job',
                subject: pipeline.value.reference,
                predicate: 'contains',
                object: command.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId: `evidence:ci:${String(inputIndex).padStart(8, '0')}`,
                sourceKind: 'delivery-declaration',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
          }
        } catch {
          const failure = warning(
            'graph.ci-workflow-invalid',
            input.locator,
            'CI workflow input could not be admitted as a portable pipeline surface.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.ci-workflow-unreadable',
            scope: input.locator,
            reason: 'CI topology remained unknown because the workflow could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'ci-workflow', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:ci-workflow:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [{ dimension: 'ci-workflows', observed: inputs.length, expected: inputs.length }],
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
