import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DotnetRuntimeAdapter } from '../runtime-adapters/dotnet.js';
import { GoRuntimeAdapter } from '../runtime-adapters/go.js';
import { JavaRuntimeAdapter } from '../runtime-adapters/java.js';
import { NodeRuntimeAdapter } from '../runtime-adapters/node.js';
import { PythonRuntimeAdapter } from '../runtime-adapters/python.js';
import { PhpRuntimeAdapter } from '../runtime-adapters/php.js';
import { RustRuntimeAdapter } from '../runtime-adapters/rust.js';
import { areRuntimeAdaptersEnabled, getRuntimeAdapter } from '../runtime-adapters/index.js';

const normalizePath = (value: string | undefined): string => (value || '').replace(/\\/g, '/');
const ORIGINAL_JAVA_HOME = process.env.JAVA_HOME;

function mockNodePackageScripts(
  projectPath: string,
  scripts: Record<string, string>,
  lockfile: 'package-lock.json' | 'pnpm-lock.yaml' | 'yarn.lock' = 'package-lock.json'
): void {
  const packageJson = JSON.stringify({ scripts });
  vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
    const normalized = normalizePath(String(p));
    if (normalized.endsWith(`${projectPath}/package.json`)) return true;
    if (normalized.endsWith(`${projectPath}/${lockfile}`)) return true;
    if (
      lockfile !== 'package-lock.json' &&
      normalized.endsWith(`${projectPath}/package-lock.json`)
    ) {
      return false;
    }
    return false;
  });
  vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathOrFileDescriptor) => {
    const normalized = normalizePath(String(p));
    if (normalized.endsWith(`${projectPath}/package.json`)) {
      return packageJson;
    }
    throw new Error(`Unexpected readFileSync path: ${String(p)}`);
  });
}

describe('Runtime Adapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RAPIDKIT_ENABLE_RUNTIME_ADAPTERS;
    delete process.env.RAPIDKIT_DEP_SHARING_MODE;
    delete process.env.RAPIDKIT_WORKSPACE_PATH;
    delete process.env.npm_config_cache;
    delete process.env.npm_config_store_dir;
    delete process.env.PIP_CACHE_DIR;
    delete process.env.POETRY_CACHE_DIR;
    delete process.env.GOMODCACHE;
    delete process.env.GOCACHE;
    delete process.env.MAVEN_OPTS;
    delete process.env.GRADLE_USER_HOME;
    delete process.env.RAPIDKIT_GRADLE_NO_DAEMON;
    if (typeof ORIGINAL_JAVA_HOME === 'undefined') {
      delete process.env.JAVA_HOME;
    } else {
      process.env.JAVA_HOME = ORIGINAL_JAVA_HOME;
    }
  });

  describe('GoRuntimeAdapter', () => {
    it('runs go mod tidy for initProject', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('go', ['mod', 'tidy'], '/tmp/project');
    });

    it('uses make run when Makefile exists', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const result = await adapter.runDev('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('make', ['run'], '/tmp/project');
    });

    it('falls back to go run when Makefile is missing', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await adapter.runDev('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('go', ['run', './.'], '/tmp/project');
    });

    it('uses native Go commands instead of Make on Windows', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      await adapter.runDev('/tmp/project');
      await adapter.runLint('/tmp/project');
      await adapter.runFormat('/tmp/project');

      expect(run).not.toHaveBeenCalledWith('make', expect.any(Array), '/tmp/project');
      expect(run).toHaveBeenCalledWith('go', ['run', './main.go'], '/tmp/project');
      expect(run).toHaveBeenCalledWith('golangci-lint', ['run', './...'], '/tmp/project');
      expect(run).toHaveBeenCalledWith('go', ['fmt', './...'], '/tmp/project');
    });

    it('uses cmd/server as Go run target when present', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized.endsWith('/tmp/project/cmd') || normalized.endsWith('/cmd/server/main.go')
        );
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation((p: fs.PathLike, options?: unknown) => {
        const normalized = normalizePath(String(p));
        if (normalized.endsWith('/tmp/project/cmd') && options) {
          return [
            {
              name: 'server',
              isDirectory: () => true,
            },
          ] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      });

      const result = await adapter.runDev('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('go', ['run', './cmd/server'], '/tmp/project');
    });

    it('uses project-isolated go caches in isolated mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'isolated';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';
      const run = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.GOMODCACHE)).toContain(
          '/tmp/project/.workspai/cache/go/mod'
        );
        expect(normalizePath(process.env.GOCACHE)).toContain(
          '/tmp/project/.workspai/cache/go/build'
        );
        return 0;
      });
      const adapter = new GoRuntimeAdapter(run);

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(0);
    });

    it('uses workspace-shared go caches in shared-runtime-caches mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-runtime-caches';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';
      const run = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.GOMODCACHE)).toContain(
          '/tmp/workspace/.workspai/cache/go/mod'
        );
        expect(normalizePath(process.env.GOCACHE)).toContain(
          '/tmp/workspace/.workspai/cache/go/build'
        );
        return 0;
      });
      const adapter = new GoRuntimeAdapter(run);

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(0);
    });

    it('runs test/build/start commands via go adapter branches', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await adapter.runTest('/tmp/project');
      await adapter.runBuild('/tmp/project');
      await adapter.runStart('/tmp/project');

      expect(run).toHaveBeenCalledWith('go', ['test', './...'], '/tmp/project');
      expect(run).toHaveBeenCalledWith('go', ['build', '-buildvcs=false', './...'], '/tmp/project');
      expect(run).toHaveBeenCalledWith('go', ['run', './.'], '/tmp/project');
    });

    it('runs binary directly for start when built binary exists', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new GoRuntimeAdapter(run);
      const expectedBinary =
        process.platform === 'win32' ? '/tmp/project/server.exe' : '/tmp/project/server';
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith(process.platform === 'win32' ? '/server.exe' : '/server')
      );

      const result = await adapter.runStart('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(normalizePath(run.mock.calls[0][0])).toBe(expectedBinary);
      expect(run).toHaveBeenCalledWith(expect.any(String), [], '/tmp/project');
    });
  });

  describe('PythonRuntimeAdapter', () => {
    it('runs prereq check via doctor check command', async () => {
      const runCore = vi.fn().mockResolvedValue(0);
      const adapter = new PythonRuntimeAdapter(runCore);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
      expect(runCore).toHaveBeenCalledWith(['doctor', 'check'], process.cwd());
    });

    it('falls back to legacy doctor command when doctor check fails', async () => {
      const runCore = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      const adapter = new PythonRuntimeAdapter(runCore);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
      expect(runCore).toHaveBeenNthCalledWith(1, ['doctor', 'check'], process.cwd());
      expect(runCore).toHaveBeenNthCalledWith(2, ['doctor'], process.cwd());
    });

    it('delegates initProject to core runner', async () => {
      const runCore = vi.fn().mockResolvedValue(0);
      const adapter = new PythonRuntimeAdapter(runCore);

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(runCore).toHaveBeenCalledWith(['init'], '/tmp/project');
    });

    it('delegates runDev to core runner', async () => {
      const runCore = vi.fn().mockResolvedValue(0);
      const adapter = new PythonRuntimeAdapter(runCore);

      const result = await adapter.runDev('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(runCore).toHaveBeenCalledWith(['dev'], '/tmp/project');
    });

    it('uses shared python caches in shared-runtime-caches mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-runtime-caches';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      const runCore = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.PIP_CACHE_DIR)).toContain(
          '/tmp/workspace/.workspai/cache/python/pip'
        );
        expect(normalizePath(process.env.POETRY_CACHE_DIR)).toContain(
          '/tmp/workspace/.workspai/cache/python/poetry'
        );
        return 0;
      });
      const adapter = new PythonRuntimeAdapter(runCore);

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(runCore).toHaveBeenCalledWith(['init'], '/tmp/project');
    });

    it('keeps project-isolated python caches for shared-node-deps alias mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-node-deps';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      const runCore = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.PIP_CACHE_DIR)).toContain(
          '/tmp/project/.workspai/cache/python/pip'
        );
        expect(normalizePath(process.env.POETRY_CACHE_DIR)).toContain(
          '/tmp/project/.workspai/cache/python/poetry'
        );
        return 0;
      });
      const adapter = new PythonRuntimeAdapter(runCore);

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(0);
      expect(runCore).toHaveBeenCalledWith(['init'], '/tmp/project');
    });

    it('delegates test/build/start to core runner', async () => {
      const runCore = vi.fn().mockResolvedValue(0);
      const adapter = new PythonRuntimeAdapter(runCore);

      await adapter.runTest('/tmp/project');
      await adapter.runBuild('/tmp/project');
      await adapter.runStart('/tmp/project');

      expect(runCore).toHaveBeenCalledWith(['test'], '/tmp/project');
      expect(runCore).toHaveBeenCalledWith(['build'], '/tmp/project');
      expect(runCore).toHaveBeenCalledWith(['start'], '/tmp/project');
    });

    it('discovers workspace policy and uses its shared python cache mode', async () => {
      delete process.env.RAPIDKIT_DEP_SHARING_MODE;
      delete process.env.RAPIDKIT_WORKSPACE_PATH;
      vi.spyOn(fs, 'existsSync').mockImplementation((candidate: fs.PathLike) => {
        const normalized = normalizePath(String(candidate));
        return (
          normalized === '/tmp/workspace/.workspai-workspace' ||
          normalized.endsWith('/.workspai/policies.yml')
        );
      });
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        'mode: strict\ndependency_sharing_mode: shared-runtime-caches # enterprise\n'
      );
      const runCore = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.PIP_CACHE_DIR)).toBe(
          '/tmp/workspace/.workspai/cache/python/pip'
        );
        return 0;
      });
      const adapter = new PythonRuntimeAdapter(runCore);
      await adapter.initProject('/tmp/workspace/projects/api');
    });

    it('falls back to isolated caches for absent, unreadable, or invalid workspace policy', async () => {
      delete process.env.RAPIDKIT_DEP_SHARING_MODE;
      delete process.env.RAPIDKIT_WORKSPACE_PATH;
      const exists = vi.spyOn(fs, 'existsSync');
      exists.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(false);
      const runCore = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.PIP_CACHE_DIR)).toContain(
          '/tmp/no-workspace/project/.workspai/cache/python/pip'
        );
        return 0;
      });
      await new PythonRuntimeAdapter(runCore).initProject('/tmp/no-workspace/project');

      vi.restoreAllMocks();
      vi.spyOn(fs, 'existsSync').mockImplementation((candidate: fs.PathLike) => {
        const normalized = normalizePath(String(candidate));
        return (
          normalized === '/tmp/workspace/.workspai-workspace' ||
          normalized.endsWith('/policies.yml')
        );
      });
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('unreadable');
      });
      const unreadableRun = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.PIP_CACHE_DIR)).toContain(
          '/tmp/workspace/project/.workspai/cache/python/pip'
        );
        return 0;
      });
      await new PythonRuntimeAdapter(unreadableRun).initProject('/tmp/workspace/project');
    });

    it('restores pre-existing cache variables even when the core runner rejects', async () => {
      process.env.PIP_CACHE_DIR = '/original/pip';
      process.env.POETRY_CACHE_DIR = '/original/poetry';
      const adapter = new PythonRuntimeAdapter(vi.fn().mockRejectedValue(new Error('core failed')));
      await expect(adapter.runTest('/tmp/project')).rejects.toThrow('core failed');
      expect(process.env.PIP_CACHE_DIR).toBe('/original/pip');
      expect(process.env.POETRY_CACHE_DIR).toBe('/original/poetry');
    });

    it('returns actionable doctor hints', async () => {
      const hints = await new PythonRuntimeAdapter(vi.fn()).doctorHints('/tmp/project');
      expect(hints).toHaveLength(3);
      expect(hints.join(' ')).toContain('doctor workspace');
    });
  });

  describe('JavaRuntimeAdapter', () => {
    it('passes prereq checks in workspace root when Java projects have wrappers', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/workspace');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized === '/tmp/workspace/.rapidkit-workspace' ||
          normalized === '/tmp/workspace/services/orders-api/pom.xml' ||
          normalized === '/tmp/workspace/services/orders-api/mvnw'
        );
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation(((targetPath: fs.PathLike) => {
        const normalized = normalizePath(String(targetPath));
        if (normalized === '/tmp/workspace') {
          return [
            {
              name: 'services',
              isDirectory: () => true,
            },
          ] as unknown as fs.Dirent[];
        }
        if (normalized === '/tmp/workspace/services') {
          return [
            {
              name: 'orders-api',
              isDirectory: () => true,
            },
          ] as unknown as fs.Dirent[];
        }
        if (normalized === '/tmp/workspace/services/orders-api') {
          return [] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('java', ['-version'], '/tmp/workspace');
      expect(run).not.toHaveBeenCalledWith('mvn', ['-version'], '/tmp/workspace');
      expect(run).not.toHaveBeenCalledWith('gradle', ['--version'], '/tmp/workspace');
    });

    it('fails prereq checks in workspace root when Maven wrapper is missing and Maven is unavailable', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java') return 0;
        if (command === 'mvn') return 1;
        return 0;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/workspace');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized === '/tmp/workspace/.rapidkit-workspace' ||
          normalized === '/tmp/workspace/services/orders-api/pom.xml'
        );
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation(((targetPath: fs.PathLike) => {
        const normalized = normalizePath(String(targetPath));
        if (normalized === '/tmp/workspace') {
          return [
            {
              name: 'services',
              isDirectory: () => true,
            },
          ] as unknown as fs.Dirent[];
        }
        if (normalized === '/tmp/workspace/services') {
          return [
            {
              name: 'orders-api',
              isDirectory: () => true,
            },
          ] as unknown as fs.Dirent[];
        }
        if (normalized === '/tmp/workspace/services/orders-api') {
          return [] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Maven is required');
      expect(run).toHaveBeenCalledWith('mvn', ['-version'], '/tmp/workspace');
    });

    it('fails prereq checks in workspace root when nested Maven project requires higher Java than installed', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(
        adapter as unknown as {
          detectInstalledJavaMajor: (command: string, cwd: string) => Promise<number | null>;
        },
        'detectInstalledJavaMajor'
      ).mockResolvedValue(17);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/workspace');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized === '/tmp/workspace/.rapidkit-workspace' ||
          normalized === '/tmp/workspace/services/orders-api/pom.xml' ||
          normalized === '/tmp/workspace/services/orders-api/mvnw' ||
          normalized === '/tmp/workspace/services/payments-api/pom.xml' ||
          normalized === '/tmp/workspace/services/payments-api/mvnw'
        );
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation(((targetPath: fs.PathLike) => {
        const normalized = normalizePath(String(targetPath));
        if (normalized === '/tmp/workspace') {
          return [{ name: 'services', isDirectory: () => true }] as unknown as fs.Dirent[];
        }
        if (normalized === '/tmp/workspace/services') {
          return [
            { name: 'orders-api', isDirectory: () => true },
            { name: 'payments-api', isDirectory: () => true },
          ] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathOrFileDescriptor) => {
        const normalized = normalizePath(String(p));
        if (normalized === '/tmp/workspace/services/orders-api/pom.xml') {
          return '<java.version>21</java.version>';
        }
        if (normalized === '/tmp/workspace/services/payments-api/pom.xml') {
          return '<java.version>17</java.version>';
        }
        return '';
      });

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Detected Java 17');
      expect(result.message).toContain('require Java 21+');
      // path.relative uses OS separator; normalize to forward slash for assertion
      expect(normalizePath(result.message ?? '')).toContain('services/orders-api');
    });

    it('passes prereq checks in workspace root when all nested Maven projects satisfy installed Java version', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(
        adapter as unknown as {
          detectInstalledJavaMajor: (command: string, cwd: string) => Promise<number | null>;
        },
        'detectInstalledJavaMajor'
      ).mockResolvedValue(21);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/workspace');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized === '/tmp/workspace/.rapidkit-workspace' ||
          normalized === '/tmp/workspace/services/orders-api/pom.xml' ||
          normalized === '/tmp/workspace/services/orders-api/mvnw'
        );
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation(((targetPath: fs.PathLike) => {
        const normalized = normalizePath(String(targetPath));
        if (normalized === '/tmp/workspace') {
          return [{ name: 'services', isDirectory: () => true }] as unknown as fs.Dirent[];
        }
        if (normalized === '/tmp/workspace/services') {
          return [{ name: 'orders-api', isDirectory: () => true }] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathOrFileDescriptor) => {
        const normalized = normalizePath(String(p));
        if (normalized === '/tmp/workspace/services/orders-api/pom.xml') {
          return '<java.version>21</java.version>';
        }
        return '';
      });

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
    });

    it('fails prereq checks when Maven without wrapper does not meet the minimum supported version', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java' || command === 'mvn') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);
      const checkSystemMavenVersion = vi
        .spyOn(
          adapter as unknown as {
            checkSystemMavenVersion: (
              cwd: string
            ) => Promise<{ exitCode: number; message?: string }>;
          },
          'checkSystemMavenVersion'
        )
        .mockResolvedValue({
          exitCode: 1,
          message: 'Maven 3.8.8 detected; Maven 3.9+ is required.',
        });

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/java-project');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/java-project/pom.xml')
      );
      vi.spyOn(fs, 'readFileSync').mockReturnValue('<java.version>21</java.version>');

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Maven 3.8.8 detected');
      expect(checkSystemMavenVersion).toHaveBeenCalledWith('/tmp/java-project');
    });

    it('fails prereq checks when detected Java major is below pom.xml requirement', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java' || command === 'mvn') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(
        adapter as unknown as {
          detectInstalledJavaMajor: (command: string, cwd: string) => Promise<number | null>;
        },
        'detectInstalledJavaMajor'
      ).mockResolvedValue(17);
      vi.spyOn(
        adapter as unknown as {
          checkSystemMavenVersion: (cwd: string) => Promise<{ exitCode: number; message?: string }>;
        },
        'checkSystemMavenVersion'
      ).mockResolvedValue({ exitCode: 0 });

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/java-project');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/java-project/pom.xml')
      );
      vi.spyOn(fs, 'readFileSync').mockReturnValue('<java.version>21</java.version>');

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Detected Java 17, but project requires Java 21+');
    });

    it('runs dependency go-offline for initProject', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      const result = await adapter.initProject('/tmp/java-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith(
        'mvn',
        ['-B', '-q', '-DskipTests', 'dependency:go-offline'],
        '/tmp/java-project'
      );
    });

    it('uses workspace-shared Maven cache in shared-runtime-caches mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-runtime-caches';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      const run = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.MAVEN_OPTS)).toContain(
          '/tmp/workspace/.workspai/cache/java/m2'
        );
        return 0;
      });
      const adapter = new JavaRuntimeAdapter(run);

      const result = await adapter.initProject('/tmp/java-project');

      expect(result.exitCode).toBe(0);
    });

    it('uses mvnw.cmd on Windows when wrapper is present', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/java-project/pom.xml') ||
          normalized.endsWith('/tmp/java-project/mvnw.cmd')
          ? true
          : false;
      });

      const result = await adapter.initProject('/tmp/java-project');

      expect(result.exitCode).toBe(0);
      expect(normalizePath(run.mock.calls[0][0] as string)).toBe('/tmp/java-project/mvnw.cmd');
      expect(run.mock.calls[0][1]).toEqual(['-B', '-q', '-DskipTests', 'dependency:go-offline']);
      expect(run.mock.calls[0][2]).toBe('/tmp/java-project');
      platformSpy.mockRestore();
    });

    it('runs an existing jar directly for start', async () => {
      delete process.env.JAVA_HOME;
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).includes('/tmp/java-project/target')
      );
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['demo-0.1.0.jar'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const result = await adapter.runStart('/tmp/java-project');

      expect(result.exitCode).toBe(0);
      expect(run.mock.calls[0][0]).toBe('java');
      expect(run.mock.calls[0][1][0]).toBe('-jar');
      expect(normalizePath(run.mock.calls[0][1][1] as string)).toBe(
        '/tmp/java-project/target/demo-0.1.0.jar'
      );
      expect(run.mock.calls[0][2]).toBe('/tmp/java-project');
    });

    it('uses JAVA_HOME java binary when PATH java is unavailable', async () => {
      process.env.JAVA_HOME = '/opt/jdk-21';
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized.includes('/opt/jdk-21/bin/java') ||
          normalized.includes('/tmp/java-project/target')
        );
      });
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['demo-0.1.0.jar'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const result = await adapter.runStart('/tmp/java-project');

      expect(result.exitCode).toBe(0);
      expect(normalizePath(run.mock.calls[0][0])).toContain('/opt/jdk-21/bin/java');
    });

    it('uses gradle wrapper for init/test/build when gradle project is detected', async () => {
      process.env.RAPIDKIT_GRADLE_NO_DAEMON = '1';
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew')
          ? true
          : false;
      });
      vi.spyOn(fs, 'statSync').mockReturnValue({ mode: 0o755 } as fs.Stats);

      await adapter.initProject('/tmp/gradle-project');
      await adapter.runTest('/tmp/gradle-project');
      await adapter.runBuild('/tmp/gradle-project');

      const gradlew = normalizePath(run.mock.calls[0][0] as string);
      expect(gradlew).toBe('/tmp/gradle-project/gradlew');
      expect(run.mock.calls[0][1]).toEqual(['--no-daemon', 'dependencies']);
      expect(run.mock.calls[1][1]).toEqual(['--no-daemon', 'test']);
      expect(run.mock.calls[2][1]).toEqual(['--no-daemon', 'bootJar']);
    });

    it('uses gradle wrapper without --no-daemon by default in local mode', async () => {
      delete process.env.CI;
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew')
          ? true
          : false;
      });
      vi.spyOn(fs, 'statSync').mockReturnValue({ mode: 0o755 } as fs.Stats);

      await adapter.initProject('/tmp/gradle-project');

      expect(normalizePath(run.mock.calls[0][0] as string)).toBe('/tmp/gradle-project/gradlew');
      expect(run.mock.calls[0][1]).toEqual(['dependencies']);
    });

    it('repairs non-executable gradlew before running on Unix', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);
      const chmodSync = vi.spyOn(fs, 'chmodSync').mockImplementation(() => undefined);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew')
          ? true
          : false;
      });
      let wrapperStats = 0;
      vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        if (normalized.endsWith('/tmp/gradle-project/gradlew')) {
          wrapperStats += 1;
          return { mode: wrapperStats > 1 ? 0o755 : 0o644 } as fs.Stats;
        }
        return { mode: 0o755 } as fs.Stats;
      }) as typeof fs.statSync);

      await adapter.initProject('/tmp/gradle-project');

      expect(chmodSync).toHaveBeenCalledWith(expect.stringMatching(/gradlew$/), 0o755);
      expect(normalizePath(run.mock.calls[0][0] as string)).toBe('/tmp/gradle-project/gradlew');
      expect(run.mock.calls[0][1]).toEqual(['dependencies']);
      platformSpy.mockRestore();
    });

    it('falls back to sh wrapper invocation when wrapper permission repair fails', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        throw new Error('chmod denied');
      });

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew')
          ? true
          : false;
      });
      vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        if (normalized.endsWith('/tmp/gradle-project/gradlew')) {
          return { mode: 0o644 } as fs.Stats;
        }
        return { mode: 0o755 } as fs.Stats;
      }) as typeof fs.statSync);

      await adapter.initProject('/tmp/gradle-project');

      expect(run.mock.calls[0][0]).toBe('sh');
      expect(normalizePath(run.mock.calls[0][1][0] as string)).toBe('/tmp/gradle-project/gradlew');
      expect(run.mock.calls[0][1][1]).toBe('dependencies');
      platformSpy.mockRestore();
    });

    it('uses shared Gradle cache in shared-runtime-caches mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-runtime-caches';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      const run = vi.fn().mockImplementation(async () => {
        expect(normalizePath(process.env.GRADLE_USER_HOME)).toContain(
          '/tmp/workspace/.workspai/cache/java/gradle'
        );
        return 0;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew')
          ? true
          : false;
      });

      const result = await adapter.initProject('/tmp/gradle-project');

      expect(result.exitCode).toBe(0);
      expect(process.env.GRADLE_USER_HOME).toBeUndefined();
    });

    it('uses gradlew.bat on Windows when wrapper is present', async () => {
      const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);
      const expectedArgs = process.env.CI === 'true' ? ['--no-daemon', 'bootJar'] : ['bootJar'];

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew.bat')
          ? true
          : false;
      });

      const result = await adapter.runBuild('/tmp/gradle-project');

      expect(result.exitCode).toBe(0);
      expect(normalizePath(run.mock.calls[0][0] as string)).toBe('/tmp/gradle-project/gradlew.bat');
      expect(run.mock.calls[0][1]).toEqual(expectedArgs);
      platformSpy.mockRestore();
    });

    it('starts from build/libs when only gradle jar exists', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.includes('/tmp/gradle-project/build/libs');
      });
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['demo-0.1.0.jar'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const result = await adapter.runStart('/tmp/gradle-project');

      expect(result.exitCode).toBe(0);
      expect(run.mock.calls[0][0]).toBe('java');
      expect(normalizePath(run.mock.calls[0][1][1] as string)).toBe(
        '/tmp/gradle-project/build/libs/demo-0.1.0.jar'
      );
      expect(run.mock.calls[0][2]).toBe('/tmp/gradle-project');
    });

    it('accepts uppercase JAR extension when resolving build output', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.includes('/tmp/java-project/target');
      });
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['demo-0.1.0.JAR'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const result = await adapter.runStart('/tmp/java-project');

      expect(result.exitCode).toBe(0);
      expect(run.mock.calls[0][0]).toBe('java');
      expect(normalizePath(run.mock.calls[0][1][1] as string)).toBe(
        '/tmp/java-project/target/demo-0.1.0.JAR'
      );
      expect(run.mock.calls[0][2]).toBe('/tmp/java-project');
    });

    it('returns a clear message when Java build fails because pom.xml or build.gradle is invalid', async () => {
      const run = vi.fn().mockResolvedValue(2);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/java-project/pom.xml');
      });

      const result = await adapter.runBuild('/tmp/java-project');

      expect(result.exitCode).toBe(2);
      expect(result.message).toContain(
        'Java build failed. Verify pom.xml/build.gradle syntax and dependencies'
      );
    });

    it('returns a clear message when no runnable jar is produced after a successful build', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/java-project/pom.xml');
      });

      const result = await adapter.runStart('/tmp/java-project');

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('no runnable JAR was found');
      expect(run).toHaveBeenCalledWith('mvn', ['-DskipTests', 'package'], '/tmp/java-project');
    });

    it('falls back to "java" when JAVA_HOME is set but candidate binary is missing', async () => {
      process.env.JAVA_HOME = '/opt/missing-jdk';
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/java-project');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/java-project/pom.xml');
        // /opt/missing-jdk/bin/java → false
      });
      vi.spyOn(fs, 'readFileSync').mockReturnValue('<java.version>21</java.version>');
      vi.spyOn(
        adapter as unknown as {
          detectInstalledJavaMajor: (cmd: string, cwd: string) => Promise<number | null>;
        },
        'detectInstalledJavaMajor'
      ).mockResolvedValue(21);
      vi.spyOn(
        adapter as unknown as {
          checkSystemMavenVersion: (cwd: string) => Promise<{ exitCode: number }>;
        },
        'checkSystemMavenVersion'
      ).mockResolvedValue({ exitCode: 0 });

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('java', ['-version'], '/tmp/java-project');
    });

    it('returns parseMavenVersion null for null/undefined/garbage input', () => {
      const adapter = new JavaRuntimeAdapter(vi.fn());
      const parseMavenVersion = (
        adapter as unknown as {
          parseMavenVersion: (raw: string | null | undefined) => [number, number, number] | null;
        }
      ).parseMavenVersion.bind(adapter);

      expect(parseMavenVersion(null)).toBeNull();
      expect(parseMavenVersion(undefined)).toBeNull();
      expect(parseMavenVersion('not a maven version')).toBeNull();
    });

    it('parses valid Apache Maven version string', () => {
      const adapter = new JavaRuntimeAdapter(vi.fn());
      const parseMavenVersion = (
        adapter as unknown as {
          parseMavenVersion: (raw: string | null | undefined) => [number, number, number] | null;
        }
      ).parseMavenVersion.bind(adapter);

      expect(parseMavenVersion('Apache Maven 3.9.9 (abc123)')).toEqual([3, 9, 9]);
      expect(parseMavenVersion('\nApache Maven 4.0.0\n')).toEqual([4, 0, 0]);
    });

    it('compares Maven versions with isMavenVersionAtLeast correctly', () => {
      const adapter = new JavaRuntimeAdapter(vi.fn());
      const check = (
        adapter as unknown as {
          isMavenVersionAtLeast: (
            v: [number, number, number],
            min: [number, number, number]
          ) => boolean;
        }
      ).isMavenVersionAtLeast.bind(adapter);

      expect(check([3, 9, 9], [3, 9, 0])).toBe(true);
      expect(check([3, 8, 9], [3, 9, 0])).toBe(false);
      expect(check([4, 0, 0], [3, 9, 0])).toBe(true);
      expect(check([3, 9, 0], [3, 9, 0])).toBe(true);
    });

    it('falls back to sh for mvnw when chmod fails', async () => {
      const _platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        throw new Error('chmod denied');
      });
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized.endsWith('/tmp/java-project/pom.xml') ||
          normalized.endsWith('/tmp/java-project/mvnw')
        );
      });
      vi.spyOn(fs, 'statSync').mockReturnValue({ mode: 0o644 } as fs.Stats);

      await adapter.initProject('/tmp/java-project');

      expect(run.mock.calls[0][0]).toBe('sh');
      expect(normalizePath(run.mock.calls[0][1][0] as string)).toBe('/tmp/java-project/mvnw');
      expect(run.mock.calls[0][1].slice(1)).toEqual([
        '-B',
        '-q',
        '-DskipTests',
        'dependency:go-offline',
      ]);
      expect(run.mock.calls[0][2]).toBe('/tmp/java-project');
    });

    it('falls back to system gradle command when no gradlew is present', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/gradle-project/build.gradle');
      });

      await adapter.initProject('/tmp/gradle-project');

      expect(run).toHaveBeenCalledWith(
        'gradle',
        expect.arrayContaining(['dependencies']),
        '/tmp/gradle-project'
      );
    });

    it('uses Maven spring-boot:run for runDev on Maven project', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/java-project/pom.xml');
      });

      await adapter.runDev('/tmp/java-project');

      expect(run).toHaveBeenCalledWith('mvn', ['spring-boot:run'], '/tmp/java-project');
    });

    it('uses Gradle bootRun for runDev on Gradle project', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized.endsWith('/tmp/gradle-project/build.gradle') ||
          normalized.endsWith('/tmp/gradle-project/gradlew')
        );
      });
      vi.spyOn(fs, 'statSync').mockReturnValue({ mode: 0o755 } as fs.Stats);

      await adapter.runDev('/tmp/gradle-project');

      expect(normalizePath(run.mock.calls[0][0] as string)).toBe('/tmp/gradle-project/gradlew');
      expect(run.mock.calls[0][1]).toEqual(expect.arrayContaining(['bootRun']));
      expect(run.mock.calls[0][2]).toBe('/tmp/gradle-project');
    });

    it('skips inaccessible directories in discoverWorkspaceJavaProjects without crashing', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java' || command === 'mvn') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(
        adapter as unknown as {
          checkSystemMavenVersion: (cwd: string) => Promise<{ exitCode: number }>;
        },
        'checkSystemMavenVersion'
      ).mockResolvedValue({ exitCode: 0 });

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/workspace');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        return normalizePath(String(p)) === '/tmp/workspace/.rapidkit-workspace';
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation(((targetPath: fs.PathLike) => {
        const normalized = normalizePath(String(targetPath));
        if (normalized === '/tmp/workspace') {
          return [{ name: 'protected', isDirectory: () => true }] as unknown as fs.Dirent[];
        }
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }) as unknown as typeof fs.readdirSync);

      const result = await adapter.checkPrereqs();

      // Should not throw; inaccessible dir is silently skipped
      expect(result).toHaveProperty('exitCode');
    });

    it('discoverWorkspaceJavaProjects skips non-directory and excluded-name entries', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java' || command === 'mvn') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(
        adapter as unknown as {
          checkSystemMavenVersion: (cwd: string) => Promise<{ exitCode: number }>;
        },
        'checkSystemMavenVersion'
      ).mockResolvedValue({ exitCode: 0 });

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/workspace');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        return normalizePath(String(p)) === '/tmp/workspace/.rapidkit-workspace';
      });
      vi.spyOn(fs, 'readdirSync').mockImplementation(((targetPath: fs.PathLike) => {
        const normalized = normalizePath(String(targetPath));
        if (normalized === '/tmp/workspace') {
          return [
            { name: 'README.md', isDirectory: () => false },
            { name: 'node_modules', isDirectory: () => true },
            { name: '.git', isDirectory: () => true },
            { name: 'target', isDirectory: () => true },
          ] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      }) as unknown as typeof fs.readdirSync);

      const result = await adapter.checkPrereqs();

      // None of the excluded entries should produce a Java project discovery
      expect(run).not.toHaveBeenCalledWith('gradle', expect.anything(), expect.anything());
      expect(result).toHaveProperty('exitCode');
    });

    it('reports JAVA_HOME version mismatch via release file when live java is newer', async () => {
      process.env.JAVA_HOME = '/opt/jdk-17';
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/java-project');
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return (
          normalized.endsWith('/tmp/java-project/pom.xml') ||
          normalized.endsWith('/opt/jdk-17/release')
        );
      });
      vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const normalized = normalizePath(String(p));
        if (normalized.endsWith('/tmp/java-project/pom.xml'))
          return '<java.version>21</java.version>';
        if (normalized.endsWith('/opt/jdk-17/release'))
          return 'JAVA_VERSION="17.0.9"\nOS_ARCH="amd64"';
        return '';
      }) as typeof fs.readFileSync);
      vi.spyOn(
        adapter as unknown as {
          detectInstalledJavaMajor: (cmd: string, cwd: string) => Promise<number | null>;
        },
        'detectInstalledJavaMajor'
      ).mockResolvedValue(21);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Detected JAVA_HOME version 17');
      expect(result.message).toContain('requires Java 21+');
    });

    it('passes checkPrereqs via maven system probe when no project file detected', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java' || command === 'mvn') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(
        adapter as unknown as {
          checkSystemMavenVersion: (cwd: string) => Promise<{ exitCode: number }>;
        },
        'checkSystemMavenVersion'
      ).mockResolvedValue({ exitCode: 0 });

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/generic-project');
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('mvn', ['-version'], '/tmp/generic-project');
    });

    it('passes checkPrereqs via gradle system probe when maven is unavailable', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java' || command === 'gradle') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/generic-project');
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('gradle', ['--version'], '/tmp/generic-project');
    });

    it('fails checkPrereqs with helpful message when neither maven nor gradle is available', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java') return 0;
        return 1;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(process, 'cwd').mockReturnValue('/tmp/generic-project');
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await adapter.checkPrereqs();

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Neither Maven nor Gradle');
    });

    it('runBuildTool propagates thrown exception as structured error message', async () => {
      const run = vi.fn().mockRejectedValue(new Error('spawn ENOENT: mvn not found'));
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/java-project/pom.xml')
      );

      const result = await adapter.runBuild('/tmp/java-project');

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Java command execution failed');
      expect(result.message).toContain('spawn ENOENT');
    });

    it('runStart returns build failure immediately when runBuild returns non-zero', async () => {
      const run = vi.fn().mockImplementation(async (command: string) => {
        if (command === 'java') return 0;
        return 2;
      });
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
        const normalized = normalizePath(String(p));
        return normalized.endsWith('/tmp/java-project/pom.xml');
      });
      vi.spyOn(fs, 'readdirSync').mockReturnValue(
        [] as unknown as ReturnType<typeof fs.readdirSync>
      );

      const result = await adapter.runStart('/tmp/java-project');

      expect(result.exitCode).toBe(2);
    });

    it('warmSetupCache returns error message when mkdirSync throws', async () => {
      const adapter = new JavaRuntimeAdapter(vi.fn());
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      const result = await adapter.warmSetupCache('/tmp/java-project');

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Failed to prepare Java cache directories');
    });

    it('restores pre-existing MAVEN_OPTS and GRADLE_USER_HOME after cache env wrapper', async () => {
      process.env.MAVEN_OPTS = '-Xmx512m';
      process.env.GRADLE_USER_HOME = '/original/gradle';

      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);

      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/java-project/pom.xml')
      );

      await adapter.initProject('/tmp/java-project');

      expect(process.env.MAVEN_OPTS).toBe('-Xmx512m');
      expect(process.env.GRADLE_USER_HOME).toBe('/original/gradle');
    });

    it('uses Maven Spotless goals for lint and format', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new JavaRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/java-project/pom.xml')
      );
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        '<artifactId>spotless-maven-plugin</artifactId>'
      );

      await adapter.runLint('/tmp/java-project');
      await adapter.runFormat('/tmp/java-project');

      expect(run).toHaveBeenCalledWith('mvn', ['spotless:check'], '/tmp/java-project');
      expect(run).toHaveBeenCalledWith('mvn', ['spotless:apply'], '/tmp/java-project');
    });
  });

  describe('NodeRuntimeAdapter', () => {
    it('uses npm install when package-lock pins npm for initProject', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new NodeRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/node-project/package-lock.json')
      );

      const result = await adapter.initProject('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('npm', ['install'], '/tmp/node-project');
    });

    it('uses pnpm when pnpm-lock exists', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new NodeRuntimeAdapter(run);
      mockNodePackageScripts('/tmp/node-project', { dev: 'vite' }, 'pnpm-lock.yaml');

      const result = await adapter.runDev('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('pnpm', ['run', 'dev'], '/tmp/node-project');
    });

    it('uses yarn when yarn lock exists', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new NodeRuntimeAdapter(run);
      mockNodePackageScripts('/tmp/node-project', { build: 'vite build' }, 'yarn.lock');

      const result = await adapter.runBuild('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('yarn', ['run', 'build'], '/tmp/node-project');
    });

    it('uses workspace-shared node cache with prefer-offline in shared modes', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-runtime-caches';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      const run = vi.fn().mockImplementation(async (command: string) => {
        expect(command).toBe('npm');
        expect(normalizePath(process.env.npm_config_cache)).toContain(
          '/tmp/workspace/.workspai/cache/node/npm-cache'
        );
        return 0;
      });
      const adapter = new NodeRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/node-project/package-lock.json')
      );

      const result = await adapter.initProject('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith('npm', ['install', '--prefer-offline'], '/tmp/node-project');
    });

    it('uses pnpm store/cache paths in shared-node-deps alias mode', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-node-deps';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      const run = vi.fn().mockImplementation(async (command: string) => {
        expect(command).toBe('pnpm');
        expect(normalizePath(process.env.npm_config_store_dir)).toContain(
          '/tmp/workspace/.workspai/cache/node/pnpm-store'
        );
        expect(normalizePath(process.env.npm_config_cache)).toContain(
          '/tmp/workspace/.workspai/cache/node/pnpm-cache'
        );
        return 0;
      });

      const adapter = new NodeRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        String(p).includes('pnpm-lock.yaml')
      );

      const result = await adapter.initProject('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith(
        'pnpm',
        ['install', '--prefer-offline'],
        '/tmp/node-project'
      );
    });

    it('uses yarn cache path and restores env after init', async () => {
      process.env.RAPIDKIT_DEP_SHARING_MODE = 'shared-runtime-caches';
      process.env.RAPIDKIT_WORKSPACE_PATH = '/tmp/workspace';

      let seenCache = '';
      const run = vi.fn().mockImplementation(async (command: string) => {
        expect(command).toBe('yarn');
        seenCache = process.env.npm_config_cache || '';
        return 0;
      });

      const adapter = new NodeRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        String(p).includes('yarn.lock')
      );

      const result = await adapter.initProject('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(normalizePath(seenCache)).toContain('/tmp/workspace/.workspai/cache/node/yarn-cache');
      expect(process.env.npm_config_cache).toBeUndefined();
    });

    it('runs test/start scripts through npm adapter branches', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new NodeRuntimeAdapter(run);
      mockNodePackageScripts('/tmp/node-project', {
        test: 'vitest',
        start: 'node dist/index.js',
      });

      await adapter.runTest('/tmp/node-project');
      await adapter.runStart('/tmp/node-project');

      expect(run).toHaveBeenCalledWith(
        'npm',
        ['run-script', 'test', '--foreground-scripts'],
        '/tmp/node-project'
      );
      expect(run).toHaveBeenCalledWith(
        'npm',
        ['run-script', 'start', '--foreground-scripts'],
        '/tmp/node-project'
      );
    });

    it('resolves vite preview for start lifecycle command', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new NodeRuntimeAdapter(run);
      mockNodePackageScripts('/tmp/node-project', {
        dev: 'vite',
        preview: 'vite preview',
        build: 'vite build',
      });

      const result = await adapter.runStart('/tmp/node-project');

      expect(result.exitCode).toBe(0);
      expect(run).toHaveBeenCalledWith(
        'npm',
        ['run-script', 'preview', '--foreground-scripts'],
        '/tmp/node-project'
      );
    });
  });

  describe('DotnetRuntimeAdapter', () => {
    it('uses native dotnet commands instead of Make on Windows', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new DotnetRuntimeAdapter(run);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(
        '<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>'
      );

      await adapter.runLint('/tmp/dotnet-project');
      await adapter.runFormat('/tmp/dotnet-project');

      expect(run).not.toHaveBeenCalledWith('make', expect.any(Array), '/tmp/dotnet-project');
      expect(run).toHaveBeenCalledWith('dotnet', ['build', '-warnaserror'], '/tmp/dotnet-project');
      expect(run).toHaveBeenCalledWith(
        'dotnet',
        ['format', '--verify-no-changes'],
        '/tmp/dotnet-project'
      );
    });

    it('discovers nested ASP.NET Core project files for lifecycle commands', async () => {
      const run = vi.fn().mockResolvedValue(0);
      const adapter = new DotnetRuntimeAdapter(run);
      const projectFile = path.join('/tmp/dotnet-project', 'src', 'Api', 'Api.csproj');
      vi.spyOn(fs, 'readdirSync').mockImplementation((p: fs.PathLike, options?: unknown) => {
        const normalized = normalizePath(String(p));
        if (!options) {
          return [] as unknown as string[];
        }
        if (options && normalized.endsWith('/tmp/dotnet-project')) {
          return [
            { name: 'src', isDirectory: () => true, isFile: () => false },
          ] as unknown as fs.Dirent[];
        }
        if (options && normalized.endsWith('/tmp/dotnet-project/src')) {
          return [
            { name: 'Api', isDirectory: () => true, isFile: () => false },
          ] as unknown as fs.Dirent[];
        }
        if (options && normalized.endsWith('/tmp/dotnet-project/src/Api')) {
          return [
            { name: 'Api.csproj', isDirectory: () => false, isFile: () => true },
          ] as unknown as fs.Dirent[];
        }
        return [] as unknown as fs.Dirent[];
      });

      await adapter.runDev('/tmp/dotnet-project');
      await adapter.runTest('/tmp/dotnet-project');
      await adapter.runBuild('/tmp/dotnet-project');
      await adapter.runStart('/tmp/dotnet-project');

      expect(run).toHaveBeenCalledWith('dotnet', ['--version'], '/tmp/dotnet-project');
      expect(run).toHaveBeenCalledWith(
        'dotnet',
        ['run', '--project', projectFile],
        '/tmp/dotnet-project'
      );
      expect(run).toHaveBeenCalledWith('dotnet', ['test', projectFile], '/tmp/dotnet-project');
      expect(run).toHaveBeenCalledWith(
        'dotnet',
        ['build', projectFile, '-c', 'Release'],
        '/tmp/dotnet-project'
      );
      expect(run).toHaveBeenCalledWith(
        'dotnet',
        ['run', '--project', projectFile],
        '/tmp/dotnet-project'
      );
    });
  });

  describe('adapter factory and feature flag', () => {
    it('keeps adapters disabled by default', () => {
      expect(areRuntimeAdaptersEnabled()).toBe(false);
    });

    it('enables adapters with environment flag', () => {
      process.env.RAPIDKIT_ENABLE_RUNTIME_ADAPTERS = '1';
      expect(areRuntimeAdaptersEnabled()).toBe(true);
    });

    it('returns go adapter from factory', async () => {
      const adapter = getRuntimeAdapter('go', {
        runCommandInCwd: vi.fn().mockResolvedValue(0),
        runCoreRapidkit: vi.fn().mockResolvedValue(0),
      });

      expect(adapter.runtime).toBe('go');
      const result = await adapter.checkPrereqs();
      expect(result.exitCode).toBe(0);
    });

    it('returns python adapter from factory', async () => {
      const runCoreRapidkit = vi.fn().mockResolvedValue(0);
      const adapter = getRuntimeAdapter('python', {
        runCommandInCwd: vi.fn().mockResolvedValue(0),
        runCoreRapidkit,
      });

      expect(adapter.runtime).toBe('python');
      const result = await adapter.initProject('/tmp/project');
      expect(result.exitCode).toBe(0);
      expect(runCoreRapidkit).toHaveBeenCalledWith(
        ['init'],
        expect.objectContaining({ cwd: '/tmp/project' })
      );
    });

    it('returns node adapter from factory', async () => {
      delete process.env.RAPIDKIT_DEP_SHARING_MODE;
      delete process.env.RAPIDKIT_WORKSPACE_PATH;
      // Mock fs.existsSync so no .rapidkit-workspace marker is found on the local filesystem
      vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) =>
        normalizePath(String(p)).endsWith('/tmp/project/package-lock.json')
      );
      const runCommandInCwd = vi.fn().mockResolvedValue(0);
      const adapter = getRuntimeAdapter('node', {
        runCommandInCwd,
        runCoreRapidkit: vi.fn().mockResolvedValue(0),
      });

      expect(adapter.runtime).toBe('node');
      const result = await adapter.initProject('/tmp/project');
      expect(result.exitCode).toBe(0);
      expect(runCommandInCwd).toHaveBeenCalledWith('npm', ['install'], '/tmp/project');
    });

    it('returns java adapter from factory', async () => {
      const runCommandInCwd = vi.fn().mockResolvedValue(0);
      const adapter = getRuntimeAdapter('java', {
        runCommandInCwd,
        runCoreRapidkit: vi.fn().mockResolvedValue(0),
      });

      expect(adapter.runtime).toBe('java');
      const result = await adapter.initProject('/tmp/project');
      expect(result.exitCode).toBe(0);
      expect(runCommandInCwd).toHaveBeenCalledWith(
        'mvn',
        ['-B', '-q', '-DskipTests', 'dependency:go-offline'],
        '/tmp/project'
      );
    });

    it('returns dotnet adapter from factory', async () => {
      const runCommandInCwd = vi.fn().mockResolvedValue(0);
      const adapter = getRuntimeAdapter('dotnet', {
        runCommandInCwd,
        runCoreRapidkit: vi.fn().mockResolvedValue(0),
      });

      expect(adapter.runtime).toBe('dotnet');
      const result = await adapter.initProject('/tmp/project');
      expect(result.exitCode).toBe(0);
      expect(runCommandInCwd).toHaveBeenCalledWith('dotnet', ['restore'], '/tmp/project');
    });

    it('returns PHP and Rust adapters from the canonical factory', () => {
      const deps = {
        runCommandInCwd: vi.fn().mockResolvedValue(0),
        runCoreRapidkit: vi.fn().mockResolvedValue(0),
      };

      expect(getRuntimeAdapter('php', deps)).toBeInstanceOf(PhpRuntimeAdapter);
      expect(getRuntimeAdapter('rust', deps)).toBeInstanceOf(RustRuntimeAdapter);
    });

    it('returns actionable dotnet restore diagnostics', async () => {
      const runCommandInCwd = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      const adapter = getRuntimeAdapter('dotnet', {
        runCommandInCwd,
        runCoreRapidkit: vi.fn().mockResolvedValue(0),
      });

      const result = await adapter.initProject('/tmp/project');

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('dotnet restore failed');
    });
  });
});
