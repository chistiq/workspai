import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cosineSimilarity,
  recommendModules,
  checkDependencies,
  getInstallationOrder,
} from '../../ai/recommender.js';
import { enableMockMode } from '../../ai/openai-client.js';

function normalizeFsPath(value: unknown): string {
  return path.resolve(String(value)).replace(/^\/private(?=\/var\/)/, '');
}

describe('AI Recommender', () => {
  beforeEach(() => {
    // Enable mock mode to avoid OpenAI API calls
    enableMockMode();
  });

  describe('cosineSimilarity', () => {
    it('should calculate cosine similarity correctly', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];

      const similarity = cosineSimilarity(a, b);

      expect(similarity).toBeCloseTo(1.0, 2);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];

      const similarity = cosineSimilarity(a, b);

      expect(similarity).toBeCloseTo(0, 2);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];

      const similarity = cosineSimilarity(a, b);

      expect(similarity).toBeCloseTo(-1, 2);
    });

    it('should throw error for different length vectors', () => {
      const a = [1, 0, 0];
      const b = [1, 0];

      expect(() => cosineSimilarity(a, b)).toThrow('Vectors must have the same length');
    });

    it('should handle zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];

      const similarity = cosineSimilarity(a, b);

      expect(similarity).toBe(0);
    });

    it('should calculate correctly for real embeddings', () => {
      // Similar vectors
      const a = [0.5, 0.8, 0.1];
      const b = [0.4, 0.9, 0.2];

      const similarity = cosineSimilarity(a, b);

      expect(similarity).toBeGreaterThan(0.9);
      expect(similarity).toBeLessThanOrEqual(1.0);
    });
  });

  describe('recommendModules', () => {
    it('should return recommendations for a query', async () => {
      const recommendations = await recommendModules('authentication', 5);

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.length).toBeLessThanOrEqual(5);
    });

    it('should return module with score and reason', async () => {
      const recommendations = await recommendModules('database', 3);

      recommendations.forEach((rec) => {
        expect(rec).toHaveProperty('module');
        expect(rec).toHaveProperty('score');
        expect(rec).toHaveProperty('reason');

        expect(rec.module).toHaveProperty('id');
        expect(rec.module).toHaveProperty('name');
        expect(typeof rec.score).toBe('number');
        expect(typeof rec.reason).toBe('string');
      });
    });

    it('should sort by score descending', async () => {
      const recommendations = await recommendModules('payment gateway', 5);

      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i - 1].score).toBeGreaterThanOrEqual(recommendations[i].score);
      }
    });

    it('should respect topK limit', async () => {
      const recs3 = await recommendModules('security', 3);
      const recs10 = await recommendModules('security', 10);

      expect(recs3.length).toBeLessThanOrEqual(3);
      expect(recs10.length).toBeLessThanOrEqual(10);
    });

    it('should have scores between -1 and 1', async () => {
      const recommendations = await recommendModules('cache redis', 5);

      recommendations.forEach((rec) => {
        expect(rec.score).toBeGreaterThanOrEqual(-1);
        expect(rec.score).toBeLessThanOrEqual(1);
      });
    });

    it('should handle empty query gracefully', async () => {
      const recommendations = await recommendModules('', 5);

      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('should handle special characters in query', async () => {
      const recommendations = await recommendModules('auth@#$%^', 3);

      expect(Array.isArray(recommendations)).toBe(true);
    });
  });

  describe('checkDependencies', () => {
    it('should return satisfied for module with no dependencies', async () => {
      const result = await checkDependencies('some-module', []);

      expect(result).toHaveProperty('satisfied');
      expect(result).toHaveProperty('missing');
      expect(Array.isArray(result.missing)).toBe(true);
    });

    it('should detect missing dependencies', async () => {
      // This test needs actual module data
      // For now just check structure
      const result = await checkDependencies('test-module', []);

      expect(typeof result.satisfied).toBe('boolean');
      expect(Array.isArray(result.missing)).toBe(true);
    });

    it('should handle empty installed modules list', async () => {
      const result = await checkDependencies('any-module', []);

      expect(result).toBeDefined();
      expect(typeof result.satisfied).toBe('boolean');
    });

    it('should handle non-existent module', async () => {
      const result = await checkDependencies('non-existent-12345', ['dep1', 'dep2']);

      // Should return satisfied for unknown modules
      expect(result.satisfied).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe('getInstallationOrder', () => {
    it('should return installation order for modules', async () => {
      const order = await getInstallationOrder(['module1', 'module2']);

      expect(Array.isArray(order)).toBe(true);
    });

    it('should handle single module', async () => {
      const order = await getInstallationOrder(['single-module']);

      expect(Array.isArray(order)).toBe(true);
    });

    it('should handle empty array', async () => {
      const order = await getInstallationOrder([]);

      expect(Array.isArray(order)).toBe(true);
      expect(order.length).toBe(0);
    });

    it('should maintain module ids', async () => {
      const moduleIds = ['module-a', 'module-b', 'module-c'];
      const order = await getInstallationOrder(moduleIds);

      // All modules should be in order
      moduleIds.forEach((id) => {
        expect(order).toContain(id);
      });
    });

    it('should handle modules with dependencies', async () => {
      // This would need real module data with dependencies
      const order = await getInstallationOrder(['dep-module', 'base-module']);

      expect(Array.isArray(order)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long queries', async () => {
      const longQuery = 'authentication '.repeat(100);
      const recommendations = await recommendModules(longQuery, 3);

      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('should handle symbolic characters', async () => {
      const recommendations = await recommendModules(
        `authentication ${String.fromCodePoint(0x1f510)} security`,
        3
      );

      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('should handle newlines and special whitespace', async () => {
      const recommendations = await recommendModules('auth\n\t\r\n  database', 3);

      expect(Array.isArray(recommendations)).toBe(true);
    });
  });

  describe('loadEmbeddings and non-mock branch coverage', () => {
    it('loads embeddings from array format', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-reco-arr-'));
      const prev = process.cwd();
      const targetPath = path.join(root, 'data', 'modules-embeddings.json');
      const realExists = fs.existsSync.bind(fs);
      const realRead = fs.readFileSync.bind(fs);
      const normalizedTargetPath = normalizeFsPath(targetPath);
      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        return normalizeFsPath(p) === normalizedTargetPath;
      });
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, options?: any) => {
        if (normalizeFsPath(p) === normalizedTargetPath) {
          return JSON.stringify([
            {
              id: 'auth_core',
              name: 'Auth Core',
              embedding: [0.2, 0.1, 0.7],
            },
          ]);
        }
        return realRead(p, options);
      });

      try {
        process.chdir(root);
        expect(realExists(targetPath)).toBe(false);

        vi.resetModules();
        const mod = await import('../../ai/recommender.js');
        const data = mod.loadEmbeddings();
        expect(data.modules.length).toBe(1);
        expect(data.dimension).toBe(3);
      } finally {
        existsSpy.mockRestore();
        readSpy.mockRestore();
        process.chdir(prev);
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('recommends from pre-generated embeddings in non-mock mode', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-reco-obj-'));
      const prev = process.cwd();
      const targetPath = path.join(root, 'data', 'modules-embeddings.json');
      const realRead = fs.readFileSync.bind(fs);
      const normalizedTargetPath = normalizeFsPath(targetPath);
      const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        return normalizeFsPath(p) === normalizedTargetPath;
      });
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, options?: any) => {
        if (normalizeFsPath(p) === normalizedTargetPath) {
          return JSON.stringify({
            model: 'text-embedding-3-small',
            dimension: 3,
            generated_at: new Date().toISOString(),
            modules: [
              {
                id: 'authentication-core',
                name: 'Authentication Core',
                embedding: [0.9, 0.1, 0.1],
              },
              { id: 'redis-cache', name: 'Redis Cache', embedding: [0.1, 0.9, 0.1] },
            ],
          });
        }
        return realRead(p, options);
      });

      try {
        process.chdir(root);
        vi.resetModules();
        vi.doMock('../../ai/openai-client.js', () => ({
          generateEmbedding: vi.fn(async () => [0.8, 0.1, 0.1]),
          isMockMode: vi.fn(() => false),
        }));
        vi.doMock('../../ai/module-catalog.js', () => ({
          getModuleCatalog: vi.fn(async () => [
            {
              id: 'authentication-core',
              name: 'Authentication Core',
              category: 'auth',
              description: 'Auth',
              longDescription: 'Authentication module',
              keywords: ['authentication', 'auth'],
              framework: 'both',
              dependencies: [],
              useCases: ['login'],
            },
            {
              id: 'redis-cache',
              name: 'Redis Cache',
              category: 'db',
              description: 'Cache',
              longDescription: 'Caching module',
              keywords: ['cache'],
              framework: 'both',
              dependencies: [],
              useCases: ['performance'],
            },
          ]),
        }));

        const mod = await import('../../ai/recommender.js');
        const recs = await mod.recommendModules('authentication', 1);
        expect(recs.length).toBe(1);
        expect(recs[0].module.id).toBe('authentication-core');
      } finally {
        vi.doUnmock('../../ai/openai-client.js');
        vi.doUnmock('../../ai/module-catalog.js');
        existsSpy.mockRestore();
        readSpy.mockRestore();
        process.chdir(prev);
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('Performance', () => {
    it('should complete recommendation in reasonable time', async () => {
      const start = Date.now();
      await recommendModules('authentication system with jwt', 5);
      const duration = Date.now() - start;

      // Should complete in less than 5 seconds (generous for mock mode)
      expect(duration).toBeLessThan(5000);
    });

    it('should handle multiple concurrent requests', async () => {
      const promises = [
        recommendModules('auth', 3),
        recommendModules('database', 3),
        recommendModules('payment', 3),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach((recs) => {
        expect(Array.isArray(recs)).toBe(true);
      });
    });
  });
});
