import fs from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_KNOWLEDGE_CONFIDENCE_LEVELS,
  WORKSPACE_KNOWLEDGE_DERIVATIONS,
  WORKSPACE_KNOWLEDGE_ENTITY_KINDS,
  WORKSPACE_KNOWLEDGE_FRESHNESS_LEVELS,
  WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  WORKSPACE_KNOWLEDGE_RELATION_KINDS,
  WORKSPACE_KNOWLEDGE_TRUST_LEVELS,
} from '../../contracts/workspace-knowledge-graph-contract.js';
import { WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION } from '../../workspace-knowledge-graph-query.js';
import { WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION } from '../../workspace-graph-token-efficiency.js';

type Schema = {
  properties?: Record<string, any>;
};

function schema(name: string): any {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), 'contracts', 'workspace-intelligence', name),
      'utf8'
    )
  );
}

describe('workspace-knowledge-graph.v1 contract', () => {
  it('keeps ontology, proof taxonomy and schema source aligned', () => {
    const contract = schema('workspace-knowledge-graph.v1.json') as Schema;
    expect(contract.properties?.schemaVersion.const).toBe(WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION);
    expect(contract.properties?.entities.items.properties.kind.enum).toEqual([
      ...WORKSPACE_KNOWLEDGE_ENTITY_KINDS,
    ]);
    expect(contract.properties?.relations.items.properties.kind.enum).toEqual([
      ...WORKSPACE_KNOWLEDGE_RELATION_KINDS,
    ]);
    expect(contract.properties?.relations.items.properties.derivation.enum).toEqual([
      ...WORKSPACE_KNOWLEDGE_DERIVATIONS,
    ]);
    expect(contract.properties?.relations.items.properties.trust.enum).toEqual([
      ...WORKSPACE_KNOWLEDGE_TRUST_LEVELS,
    ]);
    expect(contract.properties?.relations.items.properties.confidence.enum).toEqual([
      ...WORKSPACE_KNOWLEDGE_CONFIDENCE_LEVELS,
    ]);
    expect(contract.properties?.proofs.items.properties.freshness.enum).toEqual([
      ...WORKSPACE_KNOWLEDGE_FRESHNESS_LEVELS,
    ]);
  });

  it('validates a generated graph including its referenced project topology', async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addSchema(schema('workspace-dependency-graph.v1.json'));
    const validate = ajv.compile(schema('workspace-knowledge-graph.v1.json'));
    const minimal = {
      schemaVersion: 'workspace-knowledge-graph.v1',
      generatedAt: '2026-07-21T00:00:00.000Z',
      source: {
        kind: 'workspace-model',
        artifact: '.workspai/reports/workspace-model.json',
        hashAlgorithm: 'sha256',
        hash: 'a'.repeat(64),
      },
      workspace: { name: 'demo' },
      projectTopology: {
        schemaVersion: 'workspace-dependency-graph.v1',
        generatedAt: '2026-07-21T00:00:00.000Z',
        nodes: [],
        edges: [],
        stats: {
          nodeCount: 0,
          edgeCount: 0,
          inferredEdges: 0,
          contractEdges: 0,
          manualEdges: 0,
          authoritativeEdges: 0,
          lowConfidenceEdges: 0,
          orphanCount: 0,
          connectedNodeCount: 0,
          density: 0,
          edgeCoverageRatio: 1,
          evidenceCoverageRatio: 1,
          hotspotCount: 0,
          hasCycle: false,
        },
      },
      entities: [],
      relations: [],
      proofs: [],
      providers: [],
      quality: {
        entityCount: 0,
        relationCount: 0,
        proofCount: 0,
        entityProofCoverageRatio: 1,
        relationProofCoverageRatio: 1,
        providerSuccessRatio: 1,
        conflictCount: 0,
        unknownCount: 0,
        portable: true,
        secretValuesEmitted: false,
      },
      diagnostics: [],
    };
    expect(validate(minimal), JSON.stringify(validate.errors)).toBe(true);

    const sourceKindsThatBypassTheModel = ['workspace-contract', 'workspace-sources'];
    for (const kind of sourceKindsThatBypassTheModel) {
      const invalid = structuredClone(minimal);
      invalid.source.kind = kind;
      expect(validate(invalid)).toBe(false);
    }

    const wrongArtifact = structuredClone(minimal);
    wrongArtifact.source.artifact = '.workspai/workspace.contract.json';
    expect(validate(wrongArtifact)).toBe(false);
  });

  it('publishes strict contracts for bounded retrieval and its token-efficiency report', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addSchema(schema('workspace-dependency-graph.v1.json'));
    ajv.addSchema(schema('workspace-knowledge-graph.v1.json'));
    const searchSchema = schema('workspace-knowledge-search.v1.json');
    ajv.addSchema(searchSchema);
    const validateSearch = ajv.getSchema(searchSchema.$id);
    const payload = {
      schemaVersion: WORKSPACE_KNOWLEDGE_SEARCH_SCHEMA_VERSION,
      query: 'billing api',
      kind: null,
      limit: 12,
      totalMatches: 0,
      truncated: false,
      entities: [],
      relatedEntities: [],
      relations: [],
      proofs: [],
    };
    expect(validateSearch?.(payload), JSON.stringify(validateSearch?.errors)).toBe(true);

    const validateReport = ajv.compile(schema('workspace-graph-token-efficiency.v1.json'));
    expect(
      validateReport({
        schemaVersion: WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION,
        generatedAt: '2026-07-21T00:00:00.000Z',
        workspacePath: '/workspace',
        query: 'billing api',
        graph: {
          schemaVersion: 'workspace-knowledge-graph.v1',
          sourceArtifact: '.workspai/reports/workspace-model.json',
          sourceHash: 'a'.repeat(64),
          entityCount: 0,
          relationCount: 0,
          proofCount: 0,
        },
        methodology: {
          id: 'indexed-corpus-vs-bounded-retrieval.v1',
          estimated: true,
          charsPerToken: 4,
          claimBoundary: 'Retrieval estimate only.',
        },
        corpus: {
          artifactCount: 1,
          characterCount: 400,
          estimatedTokens: 100,
          unreadableArtifacts: [],
        },
        retrieval: {
          matchCount: 0,
          characterCount: 200,
          estimatedTokens: 50,
          truncated: false,
          payload,
        },
        savings: {
          estimatedTokensAvoided: 50,
          reductionRatio: 2,
          reductionPercent: 50,
        },
      }),
      JSON.stringify(validateReport.errors)
    ).toBe(true);
  });
});
