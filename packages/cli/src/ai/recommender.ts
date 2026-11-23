import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getModuleCatalog, type ModuleMetadata } from './module-catalog.js';
import { moduleEmbeddingText, moduleEmbeddingInputHash } from './module-embedding-input.js';
import { generateEmbedding, generateEmbeddings, isMockMode } from './openai-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ModuleEmbeddingData {
  model: string;
  dimension: number;
  generated_at: string;
  modules: Array<{
    id: string;
    name: string;
    embedding: number[];
    inputHash?: string;
  }>;
}

export interface RecommendationResult {
  module: ModuleMetadata;
  score: number;
  reason: string;
}

let embeddingsData: ModuleEmbeddingData | null = null;
const mockModuleEmbeddings = new Map<string, number[]>();
const runtimeModuleEmbeddings = new Map<string, { content: string; embedding: number[] }>();

async function getMockModuleEmbedding(module: ModuleMetadata): Promise<number[]> {
  const cached = mockModuleEmbeddings.get(module.id);
  if (cached) {
    return cached;
  }

  const embedding = await generateEmbedding(moduleEmbeddingText(module));
  mockModuleEmbeddings.set(module.id, embedding);
  return embedding;
}

async function getRuntimeModuleEmbeddings(
  modules: ModuleMetadata[],
  staticEmbeddings: ModuleEmbeddingData | null,
  queryDimension: number
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  const storedById = new Map(
    staticEmbeddings?.model === 'text-embedding-3-small'
      ? staticEmbeddings.modules
          .filter((entry) => entry && typeof entry.id === 'string')
          .map((entry) => [entry.id, entry])
      : []
  );
  const missing: ModuleMetadata[] = [];

  for (const module of modules) {
    const content = moduleEmbeddingText(module);
    const cached = runtimeModuleEmbeddings.get(module.id);
    if (cached?.content === content && cached.embedding.length === queryDimension) {
      embeddings.set(module.id, cached.embedding);
      continue;
    }

    const stored = storedById.get(module.id);
    if (
      stored?.inputHash === moduleEmbeddingInputHash(content) &&
      Array.isArray(stored.embedding) &&
      stored.embedding.length === queryDimension &&
      stored.embedding.every((value) => Number.isFinite(value))
    ) {
      embeddings.set(module.id, stored.embedding);
      continue;
    }
    missing.push(module);
  }

  if (missing.length === 0) return embeddings;

  const generated = await generateEmbeddings(missing.map(moduleEmbeddingText));
  if (generated.length !== missing.length) {
    throw new Error('Generated module embeddings did not match the current Core catalog.');
  }

  for (let index = 0; index < missing.length; index += 1) {
    const module = missing[index];
    const embedding = generated[index];
    if (
      !module ||
      !embedding ||
      embedding.length !== queryDimension ||
      !embedding.every((value) => Number.isFinite(value))
    ) {
      throw new Error(`Generated an invalid embedding for Core module ${module?.id ?? index}.`);
    }
    runtimeModuleEmbeddings.set(module.id, {
      content: moduleEmbeddingText(module),
      embedding,
    });
    embeddings.set(module.id, embedding);
  }

  return embeddings;
}

/**
 * Load pre-generated module embeddings from data file
 */
export function loadEmbeddings(): ModuleEmbeddingData {
  if (embeddingsData) {
    return embeddingsData;
  }

  const possiblePaths = [
    path.join(process.cwd(), 'data/modules-embeddings.json'),
    path.join(__dirname, '../../data/modules-embeddings.json'),
    path.join(__dirname, '../data/modules-embeddings.json'),
  ];

  for (const candidate of new Set(possiblePaths)) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (Array.isArray(parsed)) {
        embeddingsData = {
          model: 'mock-or-text-embedding-3-small',
          dimension: parsed[0]?.embedding?.length || 1536,
          generated_at: new Date().toISOString(),
          modules: parsed,
        };
        return embeddingsData;
      }
      if (parsed && typeof parsed.model === 'string' && Array.isArray(parsed.modules)) {
        embeddingsData = parsed as ModuleEmbeddingData;
        return embeddingsData;
      }
    } catch {
      // A missing or invalid cache must not stop recommendations.
    }
  }
  throw new Error('No usable embeddings file found');
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Generate human-readable reason for recommendation
 */
function generateReason(module: ModuleMetadata, query: string): string {
  const queryLower = query.toLowerCase();
  const matchedKeywords = module.keywords.filter(
    (k) => queryLower.includes(k) || k.includes(queryLower)
  );

  if (matchedKeywords.length > 0) {
    return `Matches: ${matchedKeywords.slice(0, 3).join(', ')}`;
  }

  return module.useCases[0] ? `Relevant for: ${module.useCases[0]}` : module.description;
}

/**
 * Recommend modules based on natural language query
 * Uses AI embeddings for semantic search
 */
export async function recommendModules(
  query: string,
  topK: number = 5
): Promise<RecommendationResult[]> {
  // Get dynamic module catalog
  const catalog = await getModuleCatalog();

  // Generate embedding for user query
  const queryEmbedding = await generateEmbedding(query);

  if (isMockMode()) {
    const scores = await Promise.all(
      catalog.map(async (module) => {
        const moduleEmbedding = await getMockModuleEmbedding(module);
        return {
          module,
          score: cosineSimilarity(queryEmbedding, moduleEmbedding),
          reason: generateReason(module, query),
        };
      })
    );

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  // Load pre-generated embeddings
  let embeddings: ModuleEmbeddingData | null = null;
  try {
    embeddings = loadEmbeddings();
  } catch {
    // Generate embeddings from the current catalog when no cache is usable.
  }
  const moduleEmbeddings = await getRuntimeModuleEmbeddings(
    catalog,
    embeddings,
    queryEmbedding.length
  );
  const scores: RecommendationResult[] = catalog.flatMap((module) => {
    const embedding = moduleEmbeddings.get(module.id);
    if (!embedding) return [];
    return [
      {
        module,
        score: cosineSimilarity(queryEmbedding, embedding),
        reason: generateReason(module, query),
      },
    ];
  });

  // Sort by score (highest first) and return top K
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

/**
 * Check if module dependencies are satisfied
 */
export async function checkDependencies(
  moduleId: string,
  installedModules: string[]
): Promise<{
  satisfied: boolean;
  missing: string[];
}> {
  const catalog = await getModuleCatalog();
  const module = catalog.find((m) => m.id === moduleId);
  if (!module) {
    return { satisfied: true, missing: [] };
  }

  const missing = module.dependencies.filter((dep) => !installedModules.includes(dep));

  return {
    satisfied: missing.length === 0,
    missing,
  };
}

/**
 * Get installation order for modules (topological sort)
 * Ensures dependencies are installed before dependent modules
 */
export async function getInstallationOrder(moduleIds: string[]): Promise<string[]> {
  const catalog = await getModuleCatalog();
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(moduleId: string) {
    if (visited.has(moduleId)) {
      return;
    }

    visited.add(moduleId);

    const module = catalog.find((m) => m.id === moduleId);
    if (module) {
      // Visit dependencies first (depth-first)
      for (const dep of module.dependencies) {
        visit(dep);
      }
    }

    order.push(moduleId);
  }

  // Visit all requested modules
  for (const moduleId of moduleIds) {
    visit(moduleId);
  }

  return order;
}
