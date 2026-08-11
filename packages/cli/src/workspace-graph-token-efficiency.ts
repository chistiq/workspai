import path from 'node:path';

import fsExtra from 'fs-extra';

import type { WorkspaceKnowledgeGraph } from './contracts/workspace-knowledge-graph-contract.js';
import {
  searchKnowledgeGraph,
  type WorkspaceKnowledgeSearchResult,
} from './workspace-knowledge-graph-query.js';

const CHARS_PER_ESTIMATED_TOKEN = 4;
export const WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION =
  'workspace-graph-token-efficiency.v1' as const;

export type WorkspaceGraphTokenEfficiencyReport = {
  schemaVersion: typeof WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION;
  generatedAt: string;
  workspacePath: string;
  query: string;
  graph: {
    schemaVersion: WorkspaceKnowledgeGraph['schemaVersion'];
    sourceArtifact: string;
    sourceHash: string;
    entityCount: number;
    relationCount: number;
    proofCount: number;
  };
  methodology: {
    id: 'indexed-corpus-vs-bounded-retrieval.v1';
    estimated: true;
    charsPerToken: 4;
    claimBoundary: string;
  };
  corpus: {
    artifactCount: number;
    characterCount: number;
    estimatedTokens: number;
    unreadableArtifacts: string[];
  };
  retrieval: {
    matchCount: number;
    characterCount: number;
    estimatedTokens: number;
    truncated: boolean;
    payload: WorkspaceKnowledgeSearchResult;
  };
  savings: {
    estimatedTokensAvoided: number;
    reductionRatio: number;
    reductionPercent: number;
  };
};

function estimatedTokens(characters: number): number {
  return Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);
}

function containedPath(root: string, relativeArtifact: string): string | null {
  const candidate = path.resolve(root, relativeArtifact);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

async function externalArtifactRoots(workspacePath: string): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  const contractCandidates = [
    path.join(workspacePath, '.workspai', 'workspace.contract.json'),
    path.join(workspacePath, '.rapidkit', 'workspace.contract.json'),
  ];
  for (const contractPath of contractCandidates) {
    if (!(await fsExtra.pathExists(contractPath))) continue;
    try {
      const contract = (await fsExtra.readJson(contractPath)) as {
        projects?: Array<{ relativePath?: unknown; externalPath?: unknown }>;
      };
      for (const project of contract.projects ?? []) {
        if (
          typeof project.relativePath === 'string' &&
          typeof project.externalPath === 'string' &&
          path.isAbsolute(project.externalPath)
        ) {
          roots.set(
            project.relativePath.replace(/\\/g, '/').replace(/\/$/, ''),
            project.externalPath
          );
        }
      }
      break;
    } catch {
      // Contract validation is owned by workspace sync/verify. A malformed
      // contract simply leaves its external proof artifacts unreadable here.
    }
  }
  return roots;
}

function safeArtifactPath(
  workspacePath: string,
  artifact: string,
  externalRoots: Map<string, string>
): string | null {
  if (!artifact || path.isAbsolute(artifact)) return null;
  const root = path.resolve(workspacePath);
  const portableArtifact = artifact.replace(/\\/g, '/');
  for (const [prefix, externalRoot] of [...externalRoots.entries()].sort(
    ([left], [right]) => right.length - left.length
  )) {
    if (!portableArtifact.startsWith(`${prefix}/`)) continue;
    return containedPath(externalRoot, portableArtifact.slice(prefix.length + 1));
  }
  return containedPath(root, portableArtifact);
}

export async function buildWorkspaceGraphTokenEfficiencyReport(input: {
  workspacePath: string;
  graph: WorkspaceKnowledgeGraph;
  query: string;
  kind?: string;
  projectId?: string;
  limit?: number;
  now?: Date;
}): Promise<WorkspaceGraphTokenEfficiencyReport> {
  const workspacePath = path.resolve(input.workspacePath);
  const payload = searchKnowledgeGraph(input.graph, {
    query: input.query,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    limit: input.limit,
    projection: 'agent',
  });
  const artifacts = [...new Set(input.graph.proofs.map((proof) => proof.artifact))].sort();
  const unreadableArtifacts: string[] = [];
  const externalRoots = await externalArtifactRoots(workspacePath);
  let characterCount = 0;
  let artifactCount = 0;
  for (const artifact of artifacts) {
    const absolutePath = safeArtifactPath(workspacePath, artifact, externalRoots);
    if (!absolutePath) {
      unreadableArtifacts.push(artifact);
      continue;
    }
    try {
      const content = await fsExtra.readFile(absolutePath, 'utf8');
      characterCount += content.length;
      artifactCount += 1;
    } catch {
      unreadableArtifacts.push(artifact);
    }
  }
  const retrievalCharacters = JSON.stringify(payload).length;
  const corpusTokens = estimatedTokens(characterCount);
  const retrievalTokens = estimatedTokens(retrievalCharacters);
  const avoided = Math.max(0, corpusTokens - retrievalTokens);
  return {
    schemaVersion: WORKSPACE_GRAPH_TOKEN_EFFICIENCY_SCHEMA_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    workspacePath,
    query: input.query,
    graph: {
      schemaVersion: input.graph.schemaVersion,
      sourceArtifact: input.graph.source.artifact,
      sourceHash: input.graph.source.hash,
      entityCount: input.graph.entities.length,
      relationCount: input.graph.relations.length,
      proofCount: input.graph.proofs.length,
    },
    methodology: {
      id: 'indexed-corpus-vs-bounded-retrieval.v1',
      estimated: true,
      charsPerToken: CHARS_PER_ESTIMATED_TOKEN,
      claimBoundary:
        'Measures retrieval payload reduction against readable proof-source text; it does not claim equivalent answer quality or model-specific billing savings.',
    },
    corpus: {
      artifactCount,
      characterCount,
      estimatedTokens: corpusTokens,
      unreadableArtifacts,
    },
    retrieval: {
      matchCount: payload.entities.length,
      characterCount: retrievalCharacters,
      estimatedTokens: retrievalTokens,
      truncated: payload.truncated,
      payload,
    },
    savings: {
      estimatedTokensAvoided: avoided,
      reductionRatio:
        retrievalTokens === 0 ? 0 : Number((corpusTokens / retrievalTokens).toFixed(2)),
      reductionPercent:
        corpusTokens === 0 ? 0 : Number(((avoided / corpusTokens) * 100).toFixed(2)),
    },
  };
}
