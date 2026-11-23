import { isMockMode } from './openai-client.js';
import { runCoreRapidkitCapture } from '../core-bridge/pythonRapidkitExec.js';
import coreModuleCatalog from './core-module-catalog.v1.json';

export interface ModuleMetadata {
  id: string;
  name: string;
  category:
    'auth' | 'database' | 'payment' | 'communication' | 'infrastructure' | 'security' | 'analytics';
  description: string;
  longDescription: string;
  keywords: string[];
  framework: 'fastapi' | 'nestjs' | 'both';
  dependencies: string[];
  useCases: string[];
}

interface PythonModuleShape {
  slug?: string;
  id?: string;
  module_id?: string;
  name?: string;
  display_name?: string;
  category?: string;
  description?: string;
  summary?: string;
  long_description?: string;
  keywords?: string[];
  tags?: string[];
  framework?: unknown;
  frameworks?: unknown;
  compatibility?: { frameworks?: unknown };
  dependencies?: string[];
  module_dependencies?: string[];
  depends_on?: string[];
  use_cases?: string[];
  useCases?: string[];
  capabilities?: string[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toPythonModuleShape(value: unknown): PythonModuleShape {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as PythonModuleShape;
}

// Generated from the current Core module inventory. This is the offline and mock-mode source of truth.
const FALLBACK_MODULE_CATALOG = coreModuleCatalog.modules.map((module) => ({
  ...module,
  category: mapPythonCategory(module.category),
})) as ModuleMetadata[];

const bundledById = new Map(FALLBACK_MODULE_CATALOG.map((module) => [module.id, module]));

// Cache for dynamic module catalog
let cachedModules: ModuleMetadata[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Convert Python CLI output to ModuleMetadata.
 */
function parsePythonModule(pyModule: unknown): ModuleMetadata {
  const moduleShape = toPythonModuleShape(pyModule);
  const id = moduleShape.slug || moduleShape.name || moduleShape.id || moduleShape.module_id || '';
  const rawKeywords = asStringArray(moduleShape.keywords ?? moduleShape.tags);
  const description = moduleShape.description || moduleShape.summary || '';
  const framework =
    moduleShape.framework ?? moduleShape.compatibility?.frameworks ?? moduleShape.frameworks;
  const bundled = bundledById.get(id);
  const dependencies =
    moduleShape.module_dependencies ?? moduleShape.depends_on ?? moduleShape.dependencies;

  return {
    id,
    name: moduleShape.display_name || moduleShape.name || '',
    category: mapPythonCategory(moduleShape.category || 'infrastructure'),
    description,
    longDescription: moduleShape.long_description || description,
    keywords: rawKeywords.map((keyword) => keyword.toLowerCase()),
    framework: framework == null ? (bundled?.framework ?? 'both') : mapPythonFramework(framework),
    dependencies: Array.isArray(dependencies)
      ? asStringArray(dependencies)
      : (bundled?.dependencies ?? []),
    useCases: asStringArray(
      moduleShape.use_cases ?? moduleShape.useCases ?? moduleShape.capabilities
    ),
  };
}

/**
 * Map Core's richer category taxonomy to the stable categories exposed by the CLI recommender.
 */
function mapPythonCategory(category: string): ModuleMetadata['category'] {
  const normalized = category.toLowerCase();
  const categoryMap: Record<string, ModuleMetadata['category']> = {
    auth: 'auth',
    authentication: 'auth',
    users: 'auth',
    database: 'database',
    payment: 'payment',
    billing: 'payment',
    communication: 'communication',
    infrastructure: 'infrastructure',
    ai: 'infrastructure',
    business: 'infrastructure',
    cache: 'infrastructure',
    essentials: 'infrastructure',
    tasks: 'infrastructure',
    security: 'security',
    analytics: 'analytics',
    observability: 'analytics',
  };

  return categoryMap[normalized] || 'infrastructure';
}

/**
 * Map Python framework to the CLI's supported framework labels.
 */
function mapPythonFramework(framework: unknown): 'fastapi' | 'nestjs' | 'both' {
  if (!framework) return 'both';
  const normalized = (
    Array.isArray(framework) ? framework.join(' ') : String(framework)
  ).toLowerCase();
  const supportsFastApi = normalized.includes('fastapi');
  const supportsNestJs = normalized.includes('nest');
  if (supportsFastApi && supportsNestJs) return 'both';
  if (supportsFastApi) return 'fastapi';
  if (supportsNestJs) return 'nestjs';
  return 'both';
}

function mergeBundledCoreMetadata(modules: ModuleMetadata[]): ModuleMetadata[] {
  return modules.map((module) => {
    const bundled = bundledById.get(module.id);
    if (!bundled) return module;
    return {
      ...bundled,
      ...module,
      longDescription: module.longDescription || bundled.longDescription,
      keywords: module.keywords.length ? module.keywords : bundled.keywords,
      useCases: module.useCases.length ? module.useCases : bundled.useCases,
    };
  });
}

/**
 * Fetch modules from Python Core (rapidkit modules list --json-schema 1).
 */
async function fetchModulesFromPythonCore(): Promise<ModuleMetadata[]> {
  try {
    const result = await runCoreRapidkitCapture(
      ['modules', 'list', '--detailed', '--json-schema', '1'],
      { cwd: process.cwd() }
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Python Core modules command failed');
    }

    // Python Core may output progress text before either an object or a top-level array.
    const stdout = result.stdout.trim();
    let payload: unknown;
    try {
      payload = JSON.parse(stdout);
    } catch {
      const objectStart = stdout.indexOf('{');
      const arrayStart = stdout.indexOf('[');
      const starts = [objectStart, arrayStart].filter((index) => index >= 0);
      if (starts.length === 0) throw new Error('Python Core modules response did not contain JSON');
      const start = Math.min(...starts);
      const closing = stdout[start] === '[' ? ']' : '}';
      const end = stdout.lastIndexOf(closing);
      if (end < start) throw new Error('Python Core modules response contained incomplete JSON');
      payload = JSON.parse(stdout.slice(start, end + 1));
    }

    let modules: unknown[] = [];
    if (Array.isArray(payload)) {
      modules = payload;
    } else if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      if (Array.isArray(record.modules)) {
        modules = record.modules;
      } else if (Array.isArray(record.data)) {
        modules = record.data;
      }
    }

    return mergeBundledCoreMetadata(
      modules.map(parsePythonModule).filter((module) => module.id && module.name)
    );
  } catch (error: unknown) {
    const execError = error as { message?: string };
    console.warn('⚠️  Failed to fetch modules from Python Core:', execError.message);
    console.warn(
      `   Using bundled Core ${coreModuleCatalog.coreVersion} catalog (${FALLBACK_MODULE_CATALOG.length} modules)`
    );
    return FALLBACK_MODULE_CATALOG;
  }
}

/**
 * Get module catalog (dynamic from Python Core or the synced offline snapshot).
 */
export async function getModuleCatalog(): Promise<ModuleMetadata[]> {
  const now = Date.now();

  if (isMockMode()) {
    cachedModules = FALLBACK_MODULE_CATALOG;
    lastFetchTime = now;
    return cachedModules;
  }

  if (cachedModules && now - lastFetchTime < CACHE_TTL) {
    return cachedModules;
  }

  cachedModules = await fetchModulesFromPythonCore();
  lastFetchTime = now;

  if (cachedModules.length === 0) {
    console.warn('⚠️  Python Core returned no modules; using the bundled catalog');
    cachedModules = FALLBACK_MODULE_CATALOG;
  }

  return cachedModules;
}

/**
 * Get module catalog synchronously (for backward compatibility).
 * Uses the fetched catalog or the latest bundled snapshot.
 */
export function getModuleCatalogSync(): ModuleMetadata[] {
  return cachedModules || FALLBACK_MODULE_CATALOG;
}

/**
 * Get module by ID.
 */
export async function getModuleById(id: string): Promise<ModuleMetadata | undefined> {
  const catalog = await getModuleCatalog();
  return catalog.find((module) => module.id === id);
}

/**
 * Get modules by category.
 */
export async function getModulesByCategory(category: string): Promise<ModuleMetadata[]> {
  const catalog = await getModuleCatalog();
  return catalog.filter((module) => module.category === category);
}

/**
 * Search modules by keyword.
 */
export async function searchModules(query: string): Promise<ModuleMetadata[]> {
  if (!query || query.trim() === '') return [];

  const catalog = await getModuleCatalog();
  const lowerQuery = query.toLowerCase();
  return catalog.filter(
    (module) =>
      module.name.toLowerCase().includes(lowerQuery) ||
      module.description.toLowerCase().includes(lowerQuery) ||
      module.keywords.some((keyword) => keyword.toLowerCase().includes(lowerQuery)) ||
      module.useCases.some((useCase) => useCase.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get all module IDs.
 */
export async function getAllModuleIds(): Promise<string[]> {
  const catalog = await getModuleCatalog();
  return catalog.map((module) => module.id);
}
