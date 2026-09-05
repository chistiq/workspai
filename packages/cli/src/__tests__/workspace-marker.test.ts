import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsExtra from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  readWorkspaceMarker,
  resolveWorkspaceRegistrationName,
  writeWorkspaceMarker,
  updateWorkspaceMetadata,
  createNpmWorkspaceMarker,
  isValidWorkspaceMarker,
  WorkspaceMarker,
  WorkspaceMetadata,
} from '../workspace-marker';

describe('Workspace Marker', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = path.join(os.tmpdir(), `workspace-marker-test-${Date.now()}-${Math.random()}`);
    await fsExtra.ensureDir(testDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (testDir && (await fsExtra.pathExists(testDir))) {
      await fsExtra.remove(testDir);
    }
  });

  describe('readWorkspaceMarker', () => {
    it('should read and return valid workspace marker', async () => {
      const marker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, marker);

      const result = await readWorkspaceMarker(testDir);

      expect(result).toEqual(marker);
    });

    it('should return null if marker file does not exist', async () => {
      const result = await readWorkspaceMarker(testDir);
      expect(result).toBeNull();
    });

    it('should return null if marker file is invalid JSON', async () => {
      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputFile(markerPath, 'invalid json {{{', 'utf-8');

      const result = await readWorkspaceMarker(testDir);
      expect(result).toBeNull();
    });
  });

  describe('resolveWorkspaceRegistrationName', () => {
    it('preserves a marker-defined identity when it differs from the directory name', async () => {
      await fsExtra.outputJson(path.join(testDir, '.workspai-workspace'), {
        signature: 'RAPIDKIT_WORKSPACE',
        name: 'canonical-workspace-name',
      });

      await expect(resolveWorkspaceRegistrationName(testDir)).resolves.toBe(
        'canonical-workspace-name'
      );
    });

    it('falls back to the directory name for a legacy marker without a name', async () => {
      await fsExtra.outputJson(path.join(testDir, '.workspai-workspace'), {
        signature: 'RAPIDKIT_WORKSPACE',
      });

      await expect(resolveWorkspaceRegistrationName(testDir)).resolves.toBe(path.basename(testDir));
    });
  });

  describe('writeWorkspaceMarker', () => {
    it('should write new workspace marker when none exists', async () => {
      const marker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
      };

      await writeWorkspaceMarker(testDir, marker);

      const markerPath = path.join(testDir, '.workspai-workspace');
      expect(await fsExtra.pathExists(markerPath)).toBe(true);

      const written = await fsExtra.readJson(markerPath);
      expect(written.signature).toBe('RAPIDKIT_WORKSPACE');
      expect(written.name).toBe('test-workspace');
    });

    it('should preserve existing metadata when updating marker', async () => {
      const existingMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.15.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          vscode: {
            extensionVersion: '0.5.0',
            createdViaExtension: false,
            openCount: 5,
          },
        },
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, existingMarker);

      const newMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-02T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          npm: {
            packageVersion: '0.16.0',
            installMethod: 'poetry',
          },
        },
      };

      await writeWorkspaceMarker(testDir, newMarker);

      const written = await fsExtra.readJson(markerPath);
      // Both vscode and npm metadata should be preserved
      expect(written.metadata?.vscode?.extensionVersion).toBe('0.5.0');
      expect(written.metadata?.npm?.packageVersion).toBe('0.16.0');
    });

    it('should output valid JSON with proper formatting', async () => {
      const marker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
      };

      await writeWorkspaceMarker(testDir, marker);

      const markerPath = path.join(testDir, '.workspai-workspace');
      const content = await fsExtra.readFile(markerPath, 'utf-8');

      // Should be valid JSON
      const parsed = JSON.parse(content);
      expect(parsed.signature).toBe('RAPIDKIT_WORKSPACE');

      // Should end with newline
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should migrate legacy marker reads to the canonical marker on write', async () => {
      const legacyMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.15.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'legacy-workspace',
        metadata: {
          vscode: {
            extensionVersion: '0.5.0',
            createdViaExtension: true,
          },
        },
      };

      const legacyMarkerPath = path.join(testDir, '.rapidkit-workspace');
      const canonicalMarkerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(legacyMarkerPath, legacyMarker);

      await writeWorkspaceMarker(testDir, {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'workspai-cli',
        version: '0.42.0',
        createdAt: '2026-07-07T00:00:00Z',
        name: 'legacy-workspace',
        metadata: {
          npm: {
            packageVersion: '0.42.0',
            installMethod: 'venv',
          },
        },
      });

      expect(await fsExtra.pathExists(canonicalMarkerPath)).toBe(true);
      expect((await fsExtra.readJson(legacyMarkerPath)) as WorkspaceMarker).toEqual(legacyMarker);

      const written = (await fsExtra.readJson(canonicalMarkerPath)) as WorkspaceMarker;
      expect(written.createdBy).toBe('workspai-cli');
      expect(written.metadata?.vscode?.extensionVersion).toBe('0.5.0');
      expect(written.metadata?.npm?.packageVersion).toBe('0.42.0');
    });
  });

  describe('updateWorkspaceMetadata', () => {
    it('should update metadata in existing marker', async () => {
      const existingMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          npm: {
            packageVersion: '0.16.0',
          },
        },
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, existingMarker);

      const metadataUpdate: Partial<WorkspaceMetadata> = {
        python: {
          pythonVersion: '3.10',
          venvPath: '.venv',
        },
      };

      const result = await updateWorkspaceMetadata(testDir, metadataUpdate);

      expect(result).toBe(true);

      const written = (await fsExtra.readJson(markerPath)) as WorkspaceMarker;
      expect(written.metadata?.python?.pythonVersion).toBe('3.10');
      expect(written.metadata?.python?.venvPath).toBe('.venv');
      expect(written.metadata?.npm?.packageVersion).toBe('0.16.0');
    });

    it('should return false if marker does not exist', async () => {
      const metadataUpdate: Partial<WorkspaceMetadata> = {
        python: { pythonVersion: '3.10' },
      };

      const result = await updateWorkspaceMetadata(testDir, metadataUpdate);
      expect(result).toBe(false);
    });

    it('should deep merge vscode metadata', async () => {
      const existingMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          vscode: {
            extensionVersion: '0.5.0',
            createdViaExtension: true,
            openCount: 3,
          },
        },
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, existingMarker);

      const metadataUpdate: Partial<WorkspaceMetadata> = {
        vscode: {
          lastOpenedAt: '2024-01-10T12:00:00Z',
          openCount: 4,
        },
      };

      const result = await updateWorkspaceMetadata(testDir, metadataUpdate);

      expect(result).toBe(true);

      const written = (await fsExtra.readJson(markerPath)) as WorkspaceMarker;
      expect(written.metadata?.vscode?.extensionVersion).toBe('0.5.0');
      expect(written.metadata?.vscode?.openCount).toBe(4);
      expect(written.metadata?.vscode?.lastOpenedAt).toBe('2024-01-10T12:00:00Z');
      expect(written.metadata?.vscode?.createdViaExtension).toBe(true);
    });

    it('should deep merge npm metadata', async () => {
      const existingMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          npm: {
            packageVersion: '0.16.0',
            installMethod: 'poetry',
          },
        },
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, existingMarker);

      const metadataUpdate: Partial<WorkspaceMetadata> = {
        npm: {
          lastUsedAt: '2024-01-10T12:00:00Z',
        },
      };

      const result = await updateWorkspaceMetadata(testDir, metadataUpdate);

      expect(result).toBe(true);

      const written = (await fsExtra.readJson(markerPath)) as WorkspaceMarker;
      expect(written.metadata?.npm?.packageVersion).toBe('0.16.0');
      expect(written.metadata?.npm?.installMethod).toBe('poetry');
      expect(written.metadata?.npm?.lastUsedAt).toBe('2024-01-10T12:00:00Z');
    });

    it('should deep merge python metadata', async () => {
      const existingMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          python: {
            pythonVersion: '3.10',
          },
        },
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, existingMarker);

      const metadataUpdate: Partial<WorkspaceMetadata> = {
        python: {
          coreVersion: '0.2.2',
          venvPath: '.venv',
        },
      };

      const result = await updateWorkspaceMetadata(testDir, metadataUpdate);

      expect(result).toBe(true);

      const written = (await fsExtra.readJson(markerPath)) as WorkspaceMarker;
      expect(written.metadata?.python?.pythonVersion).toBe('3.10');
      expect(written.metadata?.python?.coreVersion).toBe('0.2.2');
      expect(written.metadata?.python?.venvPath).toBe('.venv');
    });

    it('should handle multiple metadata sections simultaneously', async () => {
      const existingMarker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          npm: { packageVersion: '0.16.0' },
        },
      };

      const markerPath = path.join(testDir, '.workspai-workspace');
      await fsExtra.outputJson(markerPath, existingMarker);

      const metadataUpdate: Partial<WorkspaceMetadata> = {
        vscode: { extensionVersion: '0.5.0', createdViaExtension: true },
        python: { pythonVersion: '3.10' },
      };

      await updateWorkspaceMetadata(testDir, metadataUpdate);

      const written = (await fsExtra.readJson(markerPath)) as WorkspaceMarker;
      expect(written.metadata?.npm?.packageVersion).toBe('0.16.0');
      expect(written.metadata?.vscode?.extensionVersion).toBe('0.5.0');
      expect(written.metadata?.python?.pythonVersion).toBe('3.10');
    });
  });

  describe('createNpmWorkspaceMarker', () => {
    it('should create marker with npm metadata', () => {
      const marker = createNpmWorkspaceMarker('my-workspace', '0.16.0', 'poetry');

      expect(marker.signature).toBe('RAPIDKIT_WORKSPACE');
      expect(marker.createdBy).toBe('workspai-cli');
      expect(marker.version).toBe('0.16.0');
      expect(marker.name).toBe('my-workspace');
      expect(marker.metadata?.npm?.packageVersion).toBe('0.16.0');
      expect(marker.metadata?.npm?.installMethod).toBe('poetry');
      expect(marker.metadata?.npm?.lastUsedAt).toBeDefined();
    });

    it('should create marker with explicit Python core state metadata', () => {
      const marker = createNpmWorkspaceMarker('my-workspace', '0.16.0', 'venv', {
        coreStatus: 'skipped',
        coreReason: 'user-opted-out',
      });

      expect(marker.metadata?.npm?.installMethod).toBe('venv');
      expect(marker.metadata?.python).toEqual({
        coreStatus: 'skipped',
        coreReason: 'user-opted-out',
      });
    });

    it('should create marker without install method', () => {
      const marker = createNpmWorkspaceMarker('my-workspace', '0.16.0');

      expect(marker.metadata?.npm?.packageVersion).toBe('0.16.0');
      expect(marker.metadata?.npm?.installMethod).toBeUndefined();
      expect(marker.metadata?.npm?.lastUsedAt).toBeDefined();
    });

    it('should set createdAt to current ISO timestamp', () => {
      const beforeTime = new Date();
      const marker = createNpmWorkspaceMarker('my-workspace', '0.16.0');
      const afterTime = new Date();

      const markerTime = new Date(marker.createdAt);

      expect(markerTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(markerTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should support all install methods', () => {
      const methods: Array<'poetry' | 'venv' | 'pipx'> = ['poetry', 'venv', 'pipx'];

      for (const method of methods) {
        const marker = createNpmWorkspaceMarker('ws', '0.16.0', method);
        expect(marker.metadata?.npm?.installMethod).toBe(method);
      }
    });
  });

  describe('isValidWorkspaceMarker', () => {
    it('should validate correct marker', () => {
      const marker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
      };

      expect(isValidWorkspaceMarker(marker)).toBe(true);
    });

    it('should validate marker with metadata', () => {
      const marker: WorkspaceMarker = {
        signature: 'RAPIDKIT_WORKSPACE',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
        metadata: {
          npm: { packageVersion: '0.16.0' },
        },
      };

      expect(isValidWorkspaceMarker(marker)).toBe(true);
    });

    it('should validate marker with all creators', () => {
      const creators: Array<'workspai-cli' | 'rapidkit-npm' | 'rapidkit-vscode' | 'rapidkit-cli'> =
        ['workspai-cli', 'rapidkit-npm', 'rapidkit-vscode', 'rapidkit-cli'];

      for (const creator of creators) {
        const marker = {
          signature: 'RAPIDKIT_WORKSPACE' as const,
          createdBy: creator,
          version: '0.16.0',
          createdAt: '2024-01-01T00:00:00Z',
          name: 'test-workspace',
        };

        expect(isValidWorkspaceMarker(marker)).toBe(true);
      }
    });

    it('should reject null', () => {
      expect(isValidWorkspaceMarker(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidWorkspaceMarker(undefined)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(isValidWorkspaceMarker('not an object')).toBe(false);
      expect(isValidWorkspaceMarker(123)).toBe(false);
      expect(isValidWorkspaceMarker([])).toBe(false);
    });

    it('should reject marker with invalid signature', () => {
      const marker = {
        signature: 'INVALID',
        createdBy: 'rapidkit-npm',
        version: '0.16.0',
        createdAt: '2024-01-01T00:00:00Z',
        name: 'test-workspace',
      };

      expect(isValidWorkspaceMarker(marker)).toBe(false);
    });

    it('should reject marker with missing required fields', () => {
      expect(
        isValidWorkspaceMarker({
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 'rapidkit-npm',
        })
      ).toBe(false);

      expect(
        isValidWorkspaceMarker({
          signature: 'RAPIDKIT_WORKSPACE',
          version: '0.16.0',
          createdAt: '2024-01-01T00:00:00Z',
          name: 'test-workspace',
        })
      ).toBe(false);
    });

    it('should reject marker with non-string required fields', () => {
      expect(
        isValidWorkspaceMarker({
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 123,
          version: '0.16.0',
          createdAt: '2024-01-01T00:00:00Z',
          name: 'test-workspace',
        })
      ).toBe(false);

      expect(
        isValidWorkspaceMarker({
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 'rapidkit-npm',
          version: 123,
          createdAt: '2024-01-01T00:00:00Z',
          name: 'test-workspace',
        })
      ).toBe(false);

      expect(
        isValidWorkspaceMarker({
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 'rapidkit-npm',
          version: '0.16.0',
          createdAt: 123,
          name: 'test-workspace',
        })
      ).toBe(false);

      expect(
        isValidWorkspaceMarker({
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 'rapidkit-npm',
          version: '0.16.0',
          createdAt: '2024-01-01T00:00:00Z',
          name: 123,
        })
      ).toBe(false);
    });
  });
});
