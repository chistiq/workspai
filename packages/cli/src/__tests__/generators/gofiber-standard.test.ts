import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateGoFiberKit } from '../../generators/gofiber-standard.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock execa to avoid actual Go/git calls
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: vi.fn().mockImplementation((cmd: string, _args: string[], _opts: unknown) => {
      if (cmd === 'go') {
        return Promise.resolve({
          stdout: 'go version go1.26.0 linux/amd64',
          stderr: '',
          exitCode: 0,
        });
      }
      if (cmd === 'git') {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    }),
  };
});

// Silence spinner output in tests
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('generateGoFiberKit', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `gofiber-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('basic scaffold', () => {
    it('should generate project directory', async () => {
      const projectPath = path.join(testDir, 'my-fiber-api');
      await generateGoFiberKit(projectPath, { project_name: 'my-fiber-api', skipGit: true });
      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create all expected Go source files', async () => {
      const projectPath = path.join(testDir, 'fiber-src-test');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-src-test', skipGit: true });

      const expectedFiles = [
        'cmd/server/main.go',
        'go.mod',
        'internal/config/config.go',
        'internal/config/config_test.go',
        'internal/server/server.go',
        'internal/middleware/requestid.go',
        'internal/middleware/requestid_test.go',
        'internal/middleware/cors.go',
        'internal/middleware/cors_test.go',
        'internal/middleware/ratelimit.go',
        'internal/middleware/ratelimit_test.go',
        'internal/apierr/apierr.go',
        'internal/apierr/apierr_test.go',
        'internal/handlers/health.go',
        'internal/handlers/health_test.go',
        'internal/handlers/example.go',
        'internal/handlers/example_test.go',
        'internal/server/server_test.go',
        'docs/doc.go',
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(projectPath, file);
        const exists = await fs
          .stat(filePath)
          .then(() => true)
          .catch(() => false);
        expect(exists, `Expected file to exist: ${file}`).toBe(true);
      }
    });

    it('should create config and tooling files', async () => {
      const projectPath = path.join(testDir, 'fiber-config-test');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-config-test', skipGit: true });

      const expectedFiles = [
        '.air.toml',
        'Dockerfile',
        'docker-compose.yml',
        'Makefile',
        '.golangci.yml',
        '.env.example',
        '.gitignore',
        '.github/workflows/ci.yml',
        '.github/dependabot.yml',
        'README.md',
        '.workspai/project.json',
        '.workspai/context.json',
        '.workspai/project.json',
        '.workspai/context.json',
        'rapidkit',
        'rapidkit.cmd',
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(projectPath, file);
        const exists = await fs
          .stat(filePath)
          .then(() => true)
          .catch(() => false);
        expect(exists, `Expected file to exist: ${file}`).toBe(true);
      }
    });

    it('should generate a Windows launcher that does not require GNU Make', async () => {
      const projectPath = path.join(testDir, 'fiber-windows-launcher');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-windows-launcher',
        skipGit: true,
      });

      const launcher = await fs.readFile(path.join(projectPath, 'rapidkit.cmd'), 'utf8');
      expect(launcher).toContain('go run ./cmd/server');
      expect(launcher).toContain(
        'go build -buildvcs=false -o bin\\fiber-windows-launcher.exe ./cmd/server'
      );
      expect(launcher).toContain('go test ./... -v -race');
      expect(launcher).toContain('gofmt -w .');
      expect(launcher).not.toContain('make dev');
      expect(launcher).not.toContain('make test');
    });
  });

  describe('default variable values', () => {
    it('should use project_name as module_path when not specified', async () => {
      const projectPath = path.join(testDir, 'fiber-defaults');
      await generateGoFiberKit(projectPath, { project_name: 'my-api', skipGit: true });

      const goMod = await fs.readFile(path.join(projectPath, 'go.mod'), 'utf8');
      expect(goMod).toContain('module my-api');
    });

    it('should use the supported Go 1.26 baseline by default', async () => {
      const projectPath = path.join(testDir, 'fiber-go-version');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-go-version', skipGit: true });

      const goMod = await fs.readFile(path.join(projectPath, 'go.mod'), 'utf8');
      expect(goMod).toContain('go 1.26');
    });

    it('should use port 3000 by default', async () => {
      const projectPath = path.join(testDir, 'fiber-port-default');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-port-default', skipGit: true });

      const envExample = await fs.readFile(path.join(projectPath, '.env.example'), 'utf8');
      expect(envExample).toContain('3000');
    });

    it('should set RapidKit User as default author', async () => {
      const projectPath = path.join(testDir, 'fiber-author-default');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-author-default',
        skipGit: true,
      });

      const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8');
      expect(readme).toContain('fiber-author-default');
    });
  });

  describe('custom variable values', () => {
    it('should use custom module_path in go.mod', async () => {
      const projectPath = path.join(testDir, 'fiber-custom-mod');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-custom-mod',
        module_path: 'github.com/acme/my-fiber-api',
        skipGit: true,
      });

      const goMod = await fs.readFile(path.join(projectPath, 'go.mod'), 'utf8');
      expect(goMod).toContain('module github.com/acme/my-fiber-api');
    });

    it('should use custom port in env.example', async () => {
      const projectPath = path.join(testDir, 'fiber-custom-port');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-custom-port',
        port: '8080',
        skipGit: true,
      });

      const envExample = await fs.readFile(path.join(projectPath, '.env.example'), 'utf8');
      expect(envExample).toContain('8080');
    });

    it('should use custom go_version', async () => {
      const projectPath = path.join(testDir, 'fiber-go-ver');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-go-ver',
        go_version: '1.22',
        skipGit: true,
      });

      const goMod = await fs.readFile(path.join(projectPath, 'go.mod'), 'utf8');
      expect(goMod).toContain('go 1.22');
    });

    it('should embed custom description in README', async () => {
      const projectPath = path.join(testDir, 'fiber-custom-desc');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-custom-desc',
        description: 'My awesome Fiber API for production',
        skipGit: true,
      });

      const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8');
      expect(readme).toContain('My awesome Fiber API for production');
    });

    it('should use custom author in README', async () => {
      const projectPath = path.join(testDir, 'fiber-custom-author');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-custom-author',
        author: 'Jane Doe',
        skipGit: true,
      });

      const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8');
      expect(readme).toBeDefined();
    });
  });

  describe('file content verification', () => {
    it('should generate valid go.mod with Fiber dependency', async () => {
      const projectPath = path.join(testDir, 'fiber-gomod');
      await generateGoFiberKit(projectPath, { project_name: 'myapp', skipGit: true });

      const goMod = await fs.readFile(path.join(projectPath, 'go.mod'), 'utf8');
      expect(goMod).toContain('module myapp');
      expect(goMod).toContain('github.com/gofiber/fiber/v2 v2.52.15');
    });

    it('should generate main.go with correct package', async () => {
      const projectPath = path.join(testDir, 'fiber-maingo');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-maingo', skipGit: true });

      const mainGo = await fs.readFile(path.join(projectPath, 'cmd/server/main.go'), 'utf8');
      expect(mainGo).toContain('package main');
      expect(mainGo).toContain('func main()');
    });

    it('should generate Dockerfile with multi-stage build', async () => {
      const projectPath = path.join(testDir, 'fiber-dockerfile');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-dockerfile', skipGit: true });

      const dockerfile = await fs.readFile(path.join(projectPath, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain('FROM');
      expect(dockerfile).toContain('go build');
    });

    it('should generate a Dockerfile that does not require go.sum after skip-install', async () => {
      const projectPath = path.join(testDir, 'fiber-dockerfile-skip-install');
      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-dockerfile-skip-install',
        skipGit: true,
        skipInstall: true,
      });

      const dockerfile = await fs.readFile(path.join(projectPath, 'Dockerfile'), 'utf8');
      await expect(fs.stat(path.join(projectPath, 'go.sum'))).rejects.toThrow();
      expect(dockerfile).toContain('COPY go.mod ./');
      expect(dockerfile).not.toContain('COPY go.mod go.sum');
    });

    it('should generate valid .workspai/project.json', async () => {
      const projectPath = path.join(testDir, 'fiber-marker');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-marker', skipGit: true });

      const projectJson = JSON.parse(
        await fs.readFile(path.join(projectPath, '.workspai/project.json'), 'utf8')
      );
      expect(projectJson.kit_name).toBe('gofiber.standard');
      expect(projectJson.module_support).toBe(false);
    });

    it('should generate Makefile with dev and test targets', async () => {
      const projectPath = path.join(testDir, 'fiber-makefile');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-makefile', skipGit: true });

      const makefile = await fs.readFile(path.join(projectPath, 'Makefile'), 'utf8');
      expect(makefile).toContain('dev');
      expect(makefile).toContain('test');
    });

    it('should generate GitHub Actions workflow', async () => {
      const projectPath = path.join(testDir, 'fiber-ci');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-ci', skipGit: true });

      const workflow = await fs.readFile(
        path.join(projectPath, '.github/workflows/ci.yml'),
        'utf8'
      );
      expect(workflow).toContain('go');
      expect(workflow).toContain('actions/setup-go@v7');
      expect(workflow).toContain('golangci/golangci-lint-action@v9');
      expect(workflow).toContain('version: v2.12.2');
      expect(workflow).toContain('permissions:\n  contents: read');
      expect(workflow).not.toContain('version: latest');
    });

    it('should generate .golangci.yml linter config', async () => {
      const projectPath = path.join(testDir, 'fiber-lint');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-lint', skipGit: true });

      const lint = await fs.readFile(path.join(projectPath, '.golangci.yml'), 'utf8');
      expect(lint).toContain('version: "2"');
      expect(lint).toContain('formatters:');
      expect(lint).not.toContain('linters-settings:');
    });

    it('should generate .air.toml for hot reload', async () => {
      const projectPath = path.join(testDir, 'fiber-air');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-air', skipGit: true });

      const airToml = await fs.readFile(path.join(projectPath, '.air.toml'), 'utf8');
      expect(airToml).toContain('root');
    });

    it('should generate handler with health endpoint', async () => {
      const projectPath = path.join(testDir, 'fiber-health');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-health', skipGit: true });

      const healthHandler = await fs.readFile(
        path.join(projectPath, 'internal/handlers/health.go'),
        'utf8'
      );
      expect(healthHandler).toContain('package handlers');
    });

    it('should generate config.go with env var loading', async () => {
      const projectPath = path.join(testDir, 'fiber-config');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-config', skipGit: true });

      const configGo = await fs.readFile(
        path.join(projectPath, 'internal/config/config.go'),
        'utf8'
      );
      expect(configGo).toContain('package config');
    });

    it('should generate rapidkit shell script', async () => {
      const projectPath = path.join(testDir, 'fiber-script');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-script', skipGit: true });

      const script = await fs.readFile(path.join(projectPath, 'rapidkit'), 'utf8');
      expect(script).toContain('rapidkit');
    });
  });

  describe('skipGit option', () => {
    it('should skip git init when skipGit is true', async () => {
      const { execa } = await import('execa');
      const mockedExeca = vi.mocked(execa);

      const projectPath = path.join(testDir, 'fiber-skipgit');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-skipgit', skipGit: true });

      const gitCalls = mockedExeca.mock.calls.filter((c) => c[0] === 'git');
      expect(gitCalls).toHaveLength(0);
    });

    it('should run git init when skipGit is false', async () => {
      const { execa } = await import('execa');
      const mockedExeca = vi.mocked(execa);
      mockedExeca.mockClear();

      const projectPath = path.join(testDir, 'fiber-withgit');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-withgit', skipGit: false });

      const gitCalls = mockedExeca.mock.calls.filter((c) => c[0] === 'git');
      expect(gitCalls.length).toBeGreaterThan(0);
    });

    it('should default skipGit to false', async () => {
      const { execa } = await import('execa');
      const mockedExeca = vi.mocked(execa);
      mockedExeca.mockClear();

      const projectPath = path.join(testDir, 'fiber-defaultgit');
      await generateGoFiberKit(projectPath, { project_name: 'fiber-defaultgit' });

      const gitCalls = mockedExeca.mock.calls.filter((c) => c[0] === 'git');
      expect(gitCalls.length).toBeGreaterThan(0);
    });
  });

  describe('error resilience', () => {
    it('should not invoke host tools when install and git are skipped', async () => {
      const { execa } = await import('execa');
      const projectPath = path.join(testDir, 'fiber-offline');

      await generateGoFiberKit(projectPath, {
        project_name: 'fiber-offline',
        skipGit: true,
        skipInstall: true,
      });

      expect(execa).not.toHaveBeenCalled();
      expect(await fs.readFile(path.join(projectPath, 'go.mod'), 'utf8')).toContain(
        'module fiber-offline'
      );
    });

    it('should succeed scaffold even if go is not installed', async () => {
      const { execa } = await import('execa');
      const mockedExeca = vi.mocked(execa);
      mockedExeca.mockImplementation((cmd: string) => {
        if (cmd === 'go') return Promise.reject(new Error('go: not found'));
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      const projectPath = path.join(testDir, 'fiber-no-go');
      await expect(
        generateGoFiberKit(projectPath, { project_name: 'fiber-no-go', skipGit: true })
      ).resolves.not.toThrow();

      // Files should still be created
      const goMod = await fs
        .stat(path.join(projectPath, 'go.mod'))
        .then(() => true)
        .catch(() => false);
      expect(goMod).toBe(true);
    });

    it('should succeed even if go mod tidy fails', async () => {
      const { execa } = await import('execa');
      const mockedExeca = vi.mocked(execa);
      mockedExeca.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'go' && args?.[0] === 'mod') {
          return Promise.reject(new Error('go mod tidy failed'));
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      const projectPath = path.join(testDir, 'fiber-modtidy-fail');
      await expect(
        generateGoFiberKit(projectPath, { project_name: 'fiber-modtidy-fail', skipGit: true })
      ).resolves.not.toThrow();
    });

    it('should succeed even if git init fails', async () => {
      const { execa } = await import('execa');
      const mockedExeca = vi.mocked(execa);
      mockedExeca.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git') return Promise.reject(new Error('git not found'));
        if (cmd === 'go' && args?.[0] === 'version') {
          return Promise.resolve({ stdout: 'go version go1.26', stderr: '', exitCode: 0 } as any);
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any);
      });

      const projectPath = path.join(testDir, 'fiber-git-fail');
      await expect(
        generateGoFiberKit(projectPath, { project_name: 'fiber-git-fail', skipGit: false })
      ).resolves.not.toThrow();
    });
  });

  describe('project_name handling', () => {
    it('should handle hyphenated project names', async () => {
      const projectPath = path.join(testDir, 'my-fiber-service');
      await generateGoFiberKit(projectPath, {
        project_name: 'my-fiber-service',
        skipGit: true,
      });

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle underscored project names', async () => {
      const projectPath = path.join(testDir, 'my_fiber_service');
      await generateGoFiberKit(projectPath, {
        project_name: 'my_fiber_service',
        skipGit: true,
      });

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });
  });
});
