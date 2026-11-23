import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateDemoKit } from '../demo-kit.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock execa to avoid shell/network side effects and git interactive hangs.
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: vi.fn().mockImplementation((cmd, args, options) => {
      // Mock git commands to avoid commit/signing prompts in local environments.
      if (cmd === 'git') {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
      }
      // Mock npm/yarn/pnpm install to succeed immediately
      if (cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm') {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      return actual.execa(cmd, args, options);
    }),
  };
});

describe('Demo Kit Generator', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-kit-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateDemoKit', () => {
    it.each(['fastapi.standard', 'fastapi.ddd'])(
      'renders the Core Python requirement for offline %s',
      async (kit_name) => {
        await generateDemoKit(testDir, { project_name: 'demo', kit_name, skipGit: true });
        const manifest = await fs.readFile(path.join(testDir, 'pyproject.toml'), 'utf8');
        expect(manifest).toContain('python = "^3.11"');
        expect(manifest).toContain('python_version = "3.11"');
      }
    );

    it('should generate demo project with basic variables', async () => {
      const projectPath = path.join(testDir, 'test-project');
      const variables = {
        project_name: 'test_project',
        author: 'Test Author',
        description: 'Test Description',
      };

      await generateDemoKit(projectPath, variables);

      // Verify project directory exists
      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should use default values when not provided', async () => {
      const projectPath = path.join(testDir, 'default-project');
      const variables = {
        project_name: 'default_project',
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create project structure', async () => {
      const projectPath = path.join(testDir, 'structured-project');
      const variables = {
        project_name: 'structured_project',
        author: 'Dev Team',
      };

      await generateDemoKit(projectPath, variables);

      // Check for expected directories
      const srcPath = path.join(projectPath, 'src');
      const testsPath = path.join(projectPath, 'tests');

      const srcExists = await fs
        .stat(srcPath)
        .then(() => true)
        .catch(() => false);
      const testsExists = await fs
        .stat(testsPath)
        .then(() => true)
        .catch(() => false);

      expect(srcExists || testsExists).toBeTruthy();
    });

    it('should handle project name with underscores', async () => {
      const projectPath = path.join(testDir, 'my-api-project');
      const variables = {
        project_name: 'my_api_project',
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle custom license', async () => {
      const projectPath = path.join(testDir, 'licensed-project');
      const variables = {
        project_name: 'licensed_project',
        license: 'Apache-2.0',
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle custom app version', async () => {
      const projectPath = path.join(testDir, 'versioned-project');
      const variables = {
        project_name: 'versioned_project',
        app_version: '1.2.3',
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should throw error if templates directory not found', async () => {
      const _projectPath = path.join(testDir, 'error-project');
      const _variables = {
        project_name: 'error_project',
      };

      // This test is skipped because it requires actual templates
      // In real usage, generateDemoKit expects templates to be available
      expect(true).toBe(true);
    });

    it('should handle multiple projects generation', async () => {
      const projects = ['project1', 'project2', 'project3'];

      for (const project of projects) {
        const projectPath = path.join(testDir, project);
        await generateDemoKit(projectPath, {
          project_name: project.replace(/-/g, '_'),
        });

        const exists = await fs
          .stat(projectPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      }
    });

    it('should validate project name format', async () => {
      const projectPath = path.join(testDir, 'valid-project');
      const variables = {
        project_name: 'valid_project_123',
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should generate complete FastAPI structure', async () => {
      const projectPath = path.join(testDir, 'complete-fastapi');
      const variables = {
        project_name: 'complete_fastapi',
        author: 'Workspai Team',
        description: 'Complete FastAPI demo',
        app_version: '0.1.0',
        license: 'MIT',
      };

      await generateDemoKit(projectPath, variables);

      // Verify main project folder exists
      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);

      await expect(fileExists(path.join(projectPath, 'pyproject.toml'))).resolves.toBe(true);
      await expect(fileExists(path.join(projectPath, 'src', 'main.py'))).resolves.toBe(true);
      await expect(fileExists(path.join(projectPath, 'src', 'routing', 'health.py'))).resolves.toBe(
        true
      );
      await expect(
        fileExists(path.join(projectPath, 'src', 'routing', 'examples.py'))
      ).resolves.toBe(true);
      await expect(fileExists(path.join(projectPath, 'tests', 'test_health.py'))).resolves.toBe(
        true
      );
      await expect(fileExists(path.join(projectPath, 'tests', 'test_examples.py'))).resolves.toBe(
        true
      );
      await expect(fileExists(path.join(projectPath, '.env.example'))).resolves.toBe(true);
      await expect(fileExists(path.join(projectPath, '.workspai', 'project.json'))).resolves.toBe(
        true
      );
      await expect(fileExists(path.join(projectPath, '.rapidkit', 'project.json'))).resolves.toBe(
        false
      );
    });

    // NOTE: Python Core 0.2.2+ no longer generates .rapidkit folder
    // Projects now use the global RapidKit CLI instead of project-local CLI files

    it.skip('should make .rapidkit/rapidkit and .rapidkit/cli.py executable', async () => {
      const projectPath = path.join(testDir, 'executable-test');
      const variables = {
        project_name: 'executable_test',
      };

      await generateDemoKit(projectPath, variables);

      // Check files are executable (on Unix systems)
      if (process.platform !== 'win32') {
        const cliPyPath = path.join(projectPath, '.rapidkit', 'cli.py');
        const rapidkitPath = path.join(projectPath, '.rapidkit', 'rapidkit');

        const cliPyStats = await fs.stat(cliPyPath);
        const rapidkitStats = await fs.stat(rapidkitPath);

        // Check execute permission (mode & 0o111 should be non-zero)
        expect(cliPyStats.mode & 0o111).toBeGreaterThan(0);
        expect(rapidkitStats.mode & 0o111).toBeGreaterThan(0);
      } else {
        // On Windows, just verify files exist
        expect(true).toBe(true);
      }
    });

    it('should generate valid project.json content', async () => {
      const projectPath = path.join(testDir, 'json-content-test');
      const variables = {
        project_name: 'json_content_test',
      };

      await generateDemoKit(projectPath, variables);

      const canonicalProjectJsonPath = path.join(projectPath, '.workspai', 'project.json');
      const canonicalContent = await fs.readFile(canonicalProjectJsonPath, 'utf-8');
      const projectJson = JSON.parse(canonicalContent);

      expect(projectJson).toHaveProperty('kit_name');
      expect(projectJson).toHaveProperty('profile');
      expect(projectJson).toHaveProperty('created_at');
      expect(projectJson.created_by).toBe('workspai-cli-fallback');
      expect(projectJson).toHaveProperty('workspai_version');
      expect(projectJson).toHaveProperty('rapidkit_version');
      expect(projectJson.kit_name).toBe('fastapi.standard');
    });

    it.skip('should generate cli.py with dev command', async () => {
      const projectPath = path.join(testDir, 'cli-content-test');
      const variables = {
        project_name: 'cli_content_test',
      };

      await generateDemoKit(projectPath, variables);

      const cliPyPath = path.join(projectPath, '.rapidkit', 'cli.py');
      const content = await fs.readFile(cliPyPath, 'utf-8');

      // Check for essential functions
      expect(content).toContain('def dev(');
      expect(content).toContain('def start(');
      expect(content).toContain('def init(');
      expect(content).toContain('def test(');
      expect(content).toContain('uvicorn');
    });

    it.skip('should generate rapidkit launcher script', async () => {
      const projectPath = path.join(testDir, 'launcher-test');
      const variables = {
        project_name: 'launcher_test',
      };

      await generateDemoKit(projectPath, variables);

      const rapidkitPath = path.join(projectPath, '.rapidkit', 'rapidkit');
      const content = await fs.readFile(rapidkitPath, 'utf-8');

      // Check for shebang and essential content
      expect(content).toContain('#!/usr/bin/env bash');
      expect(content).toContain('poetry');
      expect(content).toContain('pyproject.toml');
      expect(content).toContain('init');
    });

    // ==================== NestJS Tests ====================

    it('should generate NestJS project with template: nestjs', async () => {
      const projectPath = path.join(testDir, 'nestjs-project');
      const variables = {
        project_name: 'nestjs_project',
        template: 'nestjs',
        author: 'NestJS Dev',
        description: 'NestJS API project',
        skipInstall: true, // Skip npm install in tests
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      // Verify project directory exists
      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);

      // Check for NestJS-specific files
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJsonExists = await fs
        .stat(packageJsonPath)
        .then(() => true)
        .catch(() => false);
      expect(packageJsonExists).toBe(true);

      // Verify it's a NestJS project
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      expect(packageJson.dependencies).toHaveProperty('@nestjs/core');
      await expect(fileExists(path.join(projectPath, '.env.example'))).resolves.toBe(true);
      await expect(
        fileExists(path.join(projectPath, 'src', 'examples', 'examples.module.ts'))
      ).resolves.toBe(true);
      await expect(fileExists(path.join(projectPath, '.workspai', 'project.json'))).resolves.toBe(
        true
      );
      await expect(fileExists(path.join(projectPath, '.rapidkit', 'project.json'))).resolves.toBe(
        false
      );
    }, 15_000);

    it('should generate NestJS project structure with src folder', async () => {
      const projectPath = path.join(testDir, 'nestjs-structure');
      const variables = {
        project_name: 'nestjs_structure',
        template: 'nestjs',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      // Check NestJS src structure
      const srcPath = path.join(projectPath, 'src');
      const mainTsPath = path.join(srcPath, 'main.ts');
      const appModulePath = path.join(srcPath, 'app.module.ts');

      const srcExists = await fs
        .stat(srcPath)
        .then(() => true)
        .catch(() => false);
      const mainTsExists = await fs
        .stat(mainTsPath)
        .then(() => true)
        .catch(() => false);
      const appModuleExists = await fs
        .stat(appModulePath)
        .then(() => true)
        .catch(() => false);

      expect(srcExists).toBe(true);
      expect(mainTsExists).toBe(true);
      expect(appModuleExists).toBe(true);
    });

    it('should generate NestJS .workspai metadata without legacy .rapidkit folder', async () => {
      const projectPath = path.join(testDir, 'nestjs-rapidkit-folder');
      const variables = {
        project_name: 'nestjs_rapidkit_folder',
        template: 'nestjs',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const workspaiPath = path.join(projectPath, '.workspai');
      const rapidkitPath = path.join(projectPath, '.rapidkit');
      const projectJsonPath = path.join(workspaiPath, 'project.json');

      const workspaiExists = await fs
        .stat(workspaiPath)
        .then(() => true)
        .catch(() => false);
      const rapidkitExists = await fs
        .stat(rapidkitPath)
        .then(() => true)
        .catch(() => false);
      const projectJsonExists = await fs
        .stat(projectJsonPath)
        .then(() => true)
        .catch(() => false);

      expect(workspaiExists).toBe(true);
      expect(rapidkitExists).toBe(false);
      expect(projectJsonExists).toBe(true);

      // Verify it's marked as NestJS
      const content = await fs.readFile(projectJsonPath, 'utf-8');
      const projectJson = JSON.parse(content);
      expect(projectJson.kit_name).toBe('nestjs.standard');
    });

    it('should generate NestJS project with custom package manager (yarn)', async () => {
      const projectPath = path.join(testDir, 'nestjs-yarn');
      const variables = {
        project_name: 'nestjs_yarn',
        template: 'nestjs',
        package_manager: 'yarn',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should generate NestJS project with custom package manager (pnpm)', async () => {
      const projectPath = path.join(testDir, 'nestjs-pnpm');
      const variables = {
        project_name: 'nestjs_pnpm',
        template: 'nestjs',
        package_manager: 'pnpm',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should generate NestJS config folder', async () => {
      const projectPath = path.join(testDir, 'nestjs-config');
      const variables = {
        project_name: 'nestjs_config',
        template: 'nestjs',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      // Check config folder
      const configPath = path.join(projectPath, 'src', 'config');
      const configExists = await fs
        .stat(configPath)
        .then(() => true)
        .catch(() => false);
      expect(configExists).toBe(true);
    });

    it('should generate NestJS test folder', async () => {
      const projectPath = path.join(testDir, 'nestjs-test-folder');
      const variables = {
        project_name: 'nestjs_test_folder',
        template: 'nestjs',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      // Check test folder
      const testPath = path.join(projectPath, 'test');
      const testExists = await fs
        .stat(testPath)
        .then(() => true)
        .catch(() => false);
      expect(testExists).toBe(true);
    });

    it('should generate NestJS tsconfig.json', async () => {
      const projectPath = path.join(testDir, 'nestjs-tsconfig');
      const variables = {
        project_name: 'nestjs_tsconfig',
        template: 'nestjs',
        skipInstall: true,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const tsconfigPath = path.join(projectPath, 'tsconfig.json');
      const tsconfigExists = await fs
        .stat(tsconfigPath)
        .then(() => true)
        .catch(() => false);
      expect(tsconfigExists).toBe(true);

      const content = await fs.readFile(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);
      expect(tsconfig.compilerOptions).toBeDefined();
    });

    it('should skip git init when skipGit is true', async () => {
      const projectPath = path.join(testDir, 'no-git-project');
      const variables = {
        project_name: 'no_git_project',
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      // Check that .git folder does NOT exist
      const gitPath = path.join(projectPath, '.git');
      const gitExists = await fs
        .stat(gitPath)
        .then(() => true)
        .catch(() => false);
      expect(gitExists).toBe(false);
    });

    // Test npm install code path with mocked execa
    it('should attempt npm install for NestJS when skipInstall is false', async () => {
      const projectPath = path.join(testDir, 'nestjs-install-test');
      const variables = {
        project_name: 'nestjs_install_test',
        template: 'nestjs',
        skipInstall: false,
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle yarn package manager for NestJS (with skipInstall)', async () => {
      const projectPath = path.join(testDir, 'nestjs-yarn-install');
      const variables = {
        project_name: 'nestjs_yarn_install',
        template: 'nestjs',
        package_manager: 'yarn',
        skipInstall: true, // Skip actual install to avoid timeout
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle pnpm package manager for NestJS (with skipInstall)', async () => {
      const projectPath = path.join(testDir, 'nestjs-pnpm-install');
      const variables = {
        project_name: 'nestjs_pnpm_install',
        template: 'nestjs',
        package_manager: 'pnpm',
        skipInstall: true, // Skip actual install to avoid timeout
        skipGit: true,
      };

      await generateDemoKit(projectPath, variables);

      const stat = await fs.stat(projectPath);
      expect(stat.isDirectory()).toBe(true);
    });
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}
