import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getModuleCatalog,
  getModuleById,
  getModulesByCategory,
  searchModules,
  getAllModuleIds,
  getModuleCatalogSync,
} from '../../ai/module-catalog.js';

vi.mock('../../core-bridge/pythonRapidkitExec.js', () => ({
  runCoreRapidkitCapture: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: '' })),
}));

import { runCoreRapidkitCapture } from '../../core-bridge/pythonRapidkitExec.js';

const mockedPythonCapture = vi.mocked(runCoreRapidkitCapture);

describe('AI Module Catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPythonCapture.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 } as any);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getModuleCatalog', () => {
    it('should return array of modules', async () => {
      const catalog = await getModuleCatalog();

      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThan(0);
    });

    it('should have required module fields', async () => {
      const catalog = await getModuleCatalog();
      const firstModule = catalog[0];

      expect(firstModule).toHaveProperty('id');
      expect(firstModule).toHaveProperty('name');
      expect(firstModule).toHaveProperty('category');
      expect(firstModule).toHaveProperty('description');
      expect(firstModule).toHaveProperty('keywords');
      expect(firstModule).toHaveProperty('framework');
    });

    it('should have valid category types', async () => {
      const catalog = await getModuleCatalog();
      const validCategories = [
        'auth',
        'database',
        'payment',
        'communication',
        'infrastructure',
        'security',
        'analytics',
      ];

      catalog.forEach((module) => {
        expect(validCategories).toContain(module.category);
      });
    });

    it('should have valid framework types', async () => {
      const catalog = await getModuleCatalog();
      const validFrameworks = ['fastapi', 'nestjs', 'both'];

      catalog.forEach((module) => {
        expect(validFrameworks).toContain(module.framework);
      });
    });

    it('should cache results', async () => {
      const catalog1 = await getModuleCatalog();
      const catalog2 = await getModuleCatalog();

      // Should return same reference (cached)
      expect(catalog1).toBe(catalog2);
    });
  });

  describe('getModuleById', () => {
    it('should return module by id', async () => {
      const catalog = await getModuleCatalog();
      const firstModuleId = catalog[0].id;

      const module = await getModuleById(firstModuleId);

      expect(module).toBeDefined();
      expect(module?.id).toBe(firstModuleId);
    });

    it('should return undefined for non-existent id', async () => {
      const module = await getModuleById('non-existent-module-id-12345');

      expect(module).toBeUndefined();
    });

    it('should handle empty string id', async () => {
      const module = await getModuleById('');

      expect(module).toBeUndefined();
    });
  });

  describe('getModulesByCategory', () => {
    it('should return modules for valid category', async () => {
      const authModules = await getModulesByCategory('auth');

      expect(Array.isArray(authModules)).toBe(true);
      authModules.forEach((module) => {
        expect(module.category).toBe('auth');
      });
    });

    it('should return empty array for non-existent category', async () => {
      const modules = await getModulesByCategory('non-existent' as any);

      expect(Array.isArray(modules)).toBe(true);
      expect(modules.length).toBe(0);
    });

    it('should return all infrastructure modules', async () => {
      const infraModules = await getModulesByCategory('infrastructure');

      expect(infraModules.length).toBeGreaterThan(0);
      infraModules.forEach((module) => {
        expect(module.category).toBe('infrastructure');
      });
    });
  });

  describe('searchModules', () => {
    it('should find modules by keyword', async () => {
      const results = await searchModules('auth');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should search in name', async () => {
      const catalog = await getModuleCatalog();
      const firstModule = catalog[0];

      const results = await searchModules(firstModule.name.toLowerCase());

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((m) => m.id === firstModule.id)).toBe(true);
    });

    it('should search in description', async () => {
      const results = await searchModules('authentication');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should search in keywords', async () => {
      const catalog = await getModuleCatalog();
      const moduleWithKeywords = catalog.find((m) => m.keywords.length > 0);

      if (moduleWithKeywords) {
        const keyword = moduleWithKeywords.keywords[0];
        const results = await searchModules(keyword);

        expect(results.some((m) => m.id === moduleWithKeywords.id)).toBe(true);
      }
    });

    it('should be case-insensitive', async () => {
      const lowerResults = await searchModules('auth');
      const upperResults = await searchModules('AUTH');
      const mixedResults = await searchModules('AuTh');

      expect(lowerResults.length).toBe(upperResults.length);
      expect(lowerResults.length).toBe(mixedResults.length);
    });

    it('should return empty array for no matches', async () => {
      const results = await searchModules('xyzzz12345nonexistent');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should handle empty query', async () => {
      const results = await searchModules('');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('getAllModuleIds', () => {
    it('should return array of module ids', async () => {
      const ids = await getAllModuleIds();

      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
    });

    it('should return unique ids', async () => {
      const ids = await getAllModuleIds();
      const uniqueIds = [...new Set(ids)];

      expect(ids.length).toBe(uniqueIds.length);
    });

    it('should have no empty ids', async () => {
      const ids = await getAllModuleIds();

      ids.forEach((id) => {
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Module Data Validation', () => {
    it('should have valid module structure', async () => {
      const catalog = await getModuleCatalog();

      catalog.forEach((module) => {
        // Required fields
        expect(module.id).toBeTruthy();
        expect(module.name).toBeTruthy();
        expect(module.category).toBeTruthy();
        expect(module.description).toBeTruthy();

        // Array fields
        expect(Array.isArray(module.keywords)).toBe(true);
        expect(Array.isArray(module.dependencies)).toBe(true);
        expect(Array.isArray(module.useCases)).toBe(true);

        // String fields
        expect(typeof module.id).toBe('string');
        expect(typeof module.name).toBe('string');
        expect(typeof module.description).toBe('string');
        expect(typeof module.longDescription).toBe('string');
      });
    });

    it('should have valid dependency references', async () => {
      const catalog = await getModuleCatalog();
      const _allIds = catalog.map((m) => m.id);

      catalog.forEach((module) => {
        module.dependencies.forEach((depId) => {
          // Dependencies should reference existing modules (or be external)
          // For now just check they are strings
          expect(typeof depId).toBe('string');
        });
      });
    });
  });

  describe('Python contract parsing', () => {
    it('uses slug as canonical module id when provided', async () => {
      vi.resetModules();
      mockedPythonCapture.mockImplementation(async (_args: string[]) => {
        return {
          stdout: JSON.stringify({
            schema_version: 1,
            modules: [
              {
                slug: 'paid/auth/advanced_mfa',
                name: 'advanced_mfa',
                display_name: 'Advanced MFA',
                category: 'auth',
                description: 'Advanced authentication',
                tags: ['Security', 'AUTH'],
                status: 'active',
                version: '1.0.0',
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      });

      const catalogModule = await import('../../ai/module-catalog.js');
      const catalog = await catalogModule.getModuleCatalog();
      expect(catalog[0].id).toBe('paid/auth/advanced_mfa');
    });

    it('searches keywords case-insensitively for mixed-case tags', async () => {
      vi.resetModules();
      mockedPythonCapture.mockImplementation(async (_args: string[]) => {
        return {
          stdout: JSON.stringify({
            schema_version: 1,
            modules: [
              {
                slug: 'security/risk_guard',
                name: 'risk_guard',
                display_name: 'Risk Guard',
                category: 'security',
                description: 'Risk controls',
                tags: ['RiSk', 'Guard'],
                status: 'active',
                version: '1.0.0',
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      });

      const catalogModule = await import('../../ai/module-catalog.js');
      const results = await catalogModule.searchModules('risk');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('security/risk_guard');
    });

    it('normalizes alternate identities, categories, frameworks, and array fields', async () => {
      vi.resetModules();
      mockedPythonCapture.mockResolvedValue({
        stdout: `noise before JSON ${JSON.stringify({
          data: [
            {
              id: 'billing',
              display_name: 'Billing',
              category: 'billing',
              summary: 'Pay',
              framework: 'FastAPI',
              keywords: ['PAY', 1],
              dependencies: ['auth', 2],
              useCases: ['checkout'],
            },
            {
              module_id: 'mail',
              name: 'Mail',
              category: 'communication',
              description: 'Send',
              framework: 'NestJS',
              tags: ['Mail'],
              use_cases: ['notify'],
            },
            { name: 'metrics', category: 'analytics', description: 'Observe', framework: null },
            { name: '', category: 'unknown' },
            null,
          ],
        })}`,
        stderr: '',
        exitCode: 0,
      } as any);
      const catalogModule = await import('../../ai/module-catalog.js');
      const catalog = await catalogModule.getModuleCatalog();
      expect(catalog).toHaveLength(3);
      expect(catalog[0]).toMatchObject({
        id: 'billing',
        category: 'payment',
        framework: 'fastapi',
        keywords: ['pay'],
        dependencies: ['auth'],
        useCases: ['checkout'],
        longDescription: 'Pay',
      });
      expect(catalog[1]).toMatchObject({ id: 'Mail', framework: 'nestjs', useCases: ['notify'] });
      expect(catalog[2]).toMatchObject({ id: 'metrics', category: 'analytics', framework: 'both' });
      expect(catalogModule.getModuleCatalogSync()).toBe(catalog);
    });

    it('accepts a top-level array response', async () => {
      vi.resetModules();
      mockedPythonCapture.mockResolvedValue({
        stdout: JSON.stringify([
          { slug: 'db', display_name: 'Database', category: 'database', description: 'DB' },
        ]),
        stderr: '',
        exitCode: 0,
      } as any);
      const catalogModule = await import('../../ai/module-catalog.js');
      await expect(catalogModule.getModuleCatalog()).resolves.toMatchObject([
        { id: 'db', category: 'database' },
      ]);
    });

    it('falls back for malformed JSON, failed core commands, and empty responses', async () => {
      for (const result of [
        { stdout: 'not-json', stderr: '', exitCode: 0 },
        { stdout: '', stderr: 'core unavailable', exitCode: 2 },
      ]) {
        vi.resetModules();
        mockedPythonCapture.mockResolvedValue(result as any);
        const catalogModule = await import('../../ai/module-catalog.js');
        expect((await catalogModule.getModuleCatalog()).length).toBeGreaterThan(0);
      }

      vi.resetModules();
      mockedPythonCapture.mockResolvedValue({
        stdout: '{"modules":[]}',
        stderr: '',
        exitCode: 0,
      } as any);
      const emptyModule = await import('../../ai/module-catalog.js');
      expect((await emptyModule.getModuleCatalog()).length).toBeGreaterThan(0);
    });

    it('returns the synchronous fallback before any dynamic fetch', async () => {
      vi.resetModules();
      const catalogModule = await import('../../ai/module-catalog.js');
      expect(catalogModule.getModuleCatalogSync().length).toBeGreaterThan(0);
      expect(getModuleCatalogSync().length).toBeGreaterThan(0);
    });
  });
});
