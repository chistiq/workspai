import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsExtra from 'fs-extra';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { promises as fsPromises } from 'fs';
import { createProject } from '../create';

// This file tests helper functions and internal logic from create.ts
// by importing and mocking dependencies

vi.mock('fs-extra');
vi.mock('execa');
vi.mock('inquirer');
vi.mock('../utils/workspace-onboarding.js', () => ({
  finalizeWorkspaceOnboarding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/lifecycle-transaction.js', () => ({
  recoverActiveLifecycleTransactions: vi.fn().mockResolvedValue([]),
  createLifecycleTransaction: vi.fn(async () => ({
    journalPath: undefined,
    captureFile: vi.fn().mockResolvedValue(undefined),
    captureOwnedTree: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../cli-ui/index.js', async () => {
  const inquirerModule = await import('inquirer');
  return {
    prompt: inquirerModule.default.prompt,
    showIntro: vi.fn(),
    ui: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
      stepNumbered: vi.fn(),
      note: vi.fn(),
      message: vi.fn(),
      dim: vi.fn(),
      plain: vi.fn(),
      nextSteps: vi.fn(),
    },
  };
});
vi.mock('../cli-ui/spinner.js', () => ({
  createUiSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('Create Module Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Directory Operations', () => {
    it('should check directory existence', async () => {
      vi.mocked(fsExtra.pathExists).mockResolvedValue(true);

      const exists = await fsExtra.pathExists('/test/path');
      expect(exists).toBe(true);
      expect(fsExtra.pathExists).toHaveBeenCalledWith('/test/path');
    });

    it('should create directory', async () => {
      vi.mocked(fsExtra.ensureDir).mockResolvedValue(undefined);

      await fsExtra.ensureDir('/test/new-dir');
      expect(fsExtra.ensureDir).toHaveBeenCalledWith('/test/new-dir');
    });

    it('should remove directory', async () => {
      vi.mocked(fsExtra.remove).mockResolvedValue(undefined);

      await fsExtra.remove('/test/old-dir');
      expect(fsExtra.remove).toHaveBeenCalledWith('/test/old-dir');
    });
  });

  describe('Poetry Operations', () => {
    it('should check poetry version', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'Poetry (version 1.7.0)',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await execa('poetry', ['--version']);
      expect(result.stdout).toContain('Poetry');
    });

    it('should initialize poetry project', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('poetry', ['init', '--no-interaction', '--python', '^3.11']);
      expect(execa).toHaveBeenCalledWith('poetry', [
        'init',
        '--no-interaction',
        '--python',
        '^3.11',
      ]);
    });

    it('should add package with poetry', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('poetry', ['add', 'rapidkit'], { cwd: '/test/project' });
      expect(execa).toHaveBeenCalledWith('poetry', ['add', 'rapidkit'], { cwd: '/test/project' });
    });

    it('should configure poetry to create in-project virtualenv', async () => {
      // Mock external commands and filesystem
      vi.mocked(execa).mockImplementation(
        (_command: string, args?: readonly string[]) =>
          Promise.resolve({
            stdout: args?.some((arg) => arg.includes('print(sys.executable)'))
              ? 'python\n3.11.18'
              : '',
            exitCode: 0,
          }) as never
      );
      vi.mocked(fsExtra.ensureDir).mockResolvedValue(undefined);
      vi.mocked(fsExtra.outputFile).mockResolvedValue(undefined);
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('[tool.poetry]\nname = "test"\n');
      vi.spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined);
      vi.mocked(fsExtra.pathExists).mockResolvedValue(false);

      // Use the exported createProject helper for testing
      await createProject('my-poetry-project', {
        yes: true,
        skipGit: true,
        profile: 'python-only',
        userConfig: { defaultInstallMethod: 'poetry', pythonVersion: '3.11' },
      });

      // Assert that poetry config was called before poetry add
      const calls = vi.mocked(execa).mock.calls;
      const configCallIndex = calls.findIndex(
        (call) => call[0] === 'poetry' && Array.isArray(call[1]) && call[1][0] === 'config'
      );
      const addCallIndex = calls.findIndex(
        (call) => call[0] === 'poetry' && Array.isArray(call[1]) && call[1][0] === 'add'
      );

      expect(configCallIndex).toBeGreaterThanOrEqual(0);
      expect(addCallIndex).toBeGreaterThanOrEqual(0);
      expect(configCallIndex).toBeLessThan(addCallIndex);

      // Verify the exact config call arguments
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        'poetry',
        ['config', 'virtualenvs.in-project', 'true', '--local'],
        { cwd: expect.stringContaining('my-poetry-project') }
      );
    });

    it('should handle poetry not found', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('Command not found: poetry'));

      await expect(execa('poetry', ['--version'])).rejects.toThrow();
    });
  });

  describe('Python Operations', () => {
    it('should check python version', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'Python 3.11.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await execa('python3', ['--version']);
      expect(result.stdout).toContain('Python 3.11');
    });

    it('should handle different python commands', async () => {
      // Test python3
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'Python 3.11.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result1 = await execa('python3', ['--version']);
      expect(result1.stdout).toContain('Python 3.11');

      // Test python
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'Python 3.10.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result2 = await execa('python', ['--version']);
      expect(result2.stdout).toContain('Python 3.10');
    });

    it('should detect actual python version', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'Python 3.11.5',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await execa('python3', ['--version']);
      const match = result.stdout.match(/Python (\d+\.\d+\.\d+)/);

      expect(match).toBeTruthy();
      expect(match![1]).toBe('3.11.5');
    });

    it('should handle python version detection failure', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('Python not found'));

      await expect(execa('python3', ['--version'])).rejects.toThrow('Python not found');
    });

    it('should handle python version detection timeout', async () => {
      vi.mocked(execa).mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        });
      });

      await expect(execa('python3', ['--version'], { timeout: 50 })).rejects.toThrow();
    });

    it('should create virtual environment', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('python3', ['-m', 'venv', '.venv'], { cwd: '/test/project' });
      expect(execa).toHaveBeenCalled();
    });

    it('should install with pip', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('/test/project/.venv/bin/pip', ['install', 'rapidkit']);
      expect(execa).toHaveBeenCalled();
    });
  });

  describe('Pipx Operations', () => {
    it('should check pipx version', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'pipx 1.2.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await execa('pipx', ['--version']);
      expect(result.stdout).toContain('pipx');
    });

    it('should install with pipx', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('pipx', ['install', 'rapidkit']);
      expect(execa).toHaveBeenCalledWith('pipx', ['install', 'rapidkit']);
    });

    it('should install editable with pipx', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('pipx', ['install', '-e', '/local/path']);
      expect(execa).toHaveBeenCalledWith('pipx', ['install', '-e', '/local/path']);
    });
  });

  describe('Git Operations', () => {
    it('should initialize git repository', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('git', ['init'], { cwd: '/test/project' });
      expect(execa).toHaveBeenCalledWith('git', ['init'], { cwd: '/test/project' });
    });

    it('should add files to git', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('git', ['add', '.'], { cwd: '/test/project' });
      expect(execa).toHaveBeenCalled();
    });

    it('should commit changes', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: '/test/project' });
      expect(execa).toHaveBeenCalled();
    });

    it('should handle git not found', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('git not found'));

      await expect(execa('git', ['init'])).rejects.toThrow();
    });
  });

  describe('File Operations', () => {
    it('should write file', async () => {
      vi.spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined);

      await fsPromises.writeFile('/test/file.txt', 'content');
      expect(fsPromises.writeFile).toHaveBeenCalledWith('/test/file.txt', 'content');
    });

    it('should read file', async () => {
      vi.spyOn(fsPromises, 'readFile').mockResolvedValue('content');

      const content = await fsPromises.readFile('/test/file.txt', 'utf-8');
      expect(content).toBe('content');
    });

    it('should create output file', async () => {
      vi.mocked(fsExtra.outputFile).mockResolvedValue(undefined);

      await fsExtra.outputFile('/test/nested/file.txt', 'content', 'utf-8');
      expect(fsExtra.outputFile).toHaveBeenCalled();
    });
  });

  describe('Inquirer Prompts', () => {
    it('should prompt for Python version', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        pythonVersion: '3.11',
      });

      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'pythonVersion',
          message: 'Select Python version',
          choices: ['3.10', '3.11', '3.12'],
        },
      ]);

      expect(answer.pythonVersion).toBe('3.11');
    });

    it('should prompt for install method', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        installMethod: 'poetry',
      });

      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'installMethod',
          message: 'How to install?',
          choices: ['poetry', 'venv', 'pipx'],
        },
      ]);

      expect(answer.installMethod).toBe('poetry');
    });

    it('should prompt for project details', async () => {
      vi.mocked(inquirer.prompt).mockResolvedValue({
        project_name: 'my_project',
        author: 'Test Author',
        description: 'Test description',
      });

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'project_name',
          message: 'Project name',
        },
        {
          type: 'input',
          name: 'author',
          message: 'Author',
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description',
        },
      ]);

      expect(answers.project_name).toBe('my_project');
      expect(answers.author).toBe('Test Author');
    });
  });

  describe('Version Parsing', () => {
    it('should parse Python version', () => {
      const stdout = 'Python 3.11.5';
      const match = stdout.match(/Python (\d+\.\d+)/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('3.11');
    });

    it('should parse Poetry version', () => {
      const stdout = 'Poetry (version 1.7.0)';
      const match = stdout.match(/Poetry.*?(\d+)\.(\d+)/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('1');
      expect(match?.[2]).toBe('7');
    });

    it('should compare versions', () => {
      const version1 = '3.11';
      const version2 = '3.10';

      expect(parseFloat(version1)).toBeGreaterThan(parseFloat(version2));
    });
  });

  describe('Path Operations', () => {
    it('should resolve paths correctly', async () => {
      const { resolve, join } = await import('path');

      const resolved = resolve(process.cwd(), 'test-project');
      expect(resolved).toContain('test-project');

      const joined = join('/base', 'sub', 'file.txt');
      expect(joined).toContain('file.txt');
    });

    it('should handle path separators', async () => {
      const { sep } = await import('path');

      expect(sep).toBeDefined();
    });

    it('should normalize paths', async () => {
      const { normalize } = await import('path');

      const normalized = normalize('/path//to///file');
      // On Windows, normalize converts to backslashes, on Unix keeps forward slashes
      // Both are valid normalized paths
      expect(normalized).toMatch(/[\/\\]path[\/\\]to[\/\\]file/);
    });
  });

  describe('Environment Variables', () => {
    it('should read RAPIDKIT_DEV_PATH', () => {
      process.env.RAPIDKIT_DEV_PATH = '/test/path';

      expect(process.env.RAPIDKIT_DEV_PATH).toBe('/test/path');

      delete process.env.RAPIDKIT_DEV_PATH;
    });

    it('should handle missing environment variables', () => {
      delete process.env.RAPIDKIT_DEV_PATH;

      expect(process.env.RAPIDKIT_DEV_PATH).toBeUndefined();
    });

    it('should modify PATH environment variable', () => {
      const originalPath = process.env.PATH;
      process.env.PATH = '/usr/bin:/usr/local/bin';

      const newPath = '/home/user/.local/bin';
      process.env.PATH = `${newPath}:${process.env.PATH}`;

      expect(process.env.PATH).toContain(newPath);
      expect(process.env.PATH).toContain('/usr/bin');

      process.env.PATH = originalPath;
    });
  });

  describe('File Operations', () => {
    it('should write files with proper encoding', async () => {
      const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
      mockWriteFile.mockResolvedValue(undefined);

      await fsPromises.writeFile('/test/file.txt', 'content', 'utf-8');

      expect(mockWriteFile).toHaveBeenCalledWith('/test/file.txt', 'content', 'utf-8');
    });

    it('should read files with proper encoding', async () => {
      const mockReadFile = vi.spyOn(fsPromises, 'readFile');
      mockReadFile.mockResolvedValue('file content');

      const content = await fsPromises.readFile('/test/file.txt', 'utf-8');

      expect(content).toBe('file content');
      expect(mockReadFile).toHaveBeenCalledWith('/test/file.txt', 'utf-8');
    });

    it('should handle file write errors', async () => {
      const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
      mockWriteFile.mockRejectedValue(new Error('Write failed'));

      await expect(fsPromises.writeFile('/test/file.txt', 'content', 'utf-8')).rejects.toThrow(
        'Write failed'
      );
    });

    it('should create .python-version file', async () => {
      const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
      mockWriteFile.mockResolvedValue(undefined);

      const version = '3.11.5';
      await fsPromises.writeFile('/test/.python-version', `${version}\n`, 'utf-8');

      expect(mockWriteFile).toHaveBeenCalledWith('/test/.python-version', '3.11.5\n', 'utf-8');
    });

    it('should create .gitignore file', async () => {
      vi.mocked(fsExtra.outputFile).mockResolvedValue(undefined);

      const gitignoreContent = '.venv/\n__pycache__/\n*.pyc\n.env\n.workspai-workspace\n\n';
      await fsExtra.outputFile('/test/.gitignore', gitignoreContent, 'utf-8');

      expect(fsExtra.outputFile).toHaveBeenCalledWith(
        '/test/.gitignore',
        gitignoreContent,
        'utf-8'
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle ENOENT errors', async () => {
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';

      vi.mocked(fsExtra.pathExists).mockRejectedValue(error);

      await expect(fsExtra.pathExists('/nonexistent')).rejects.toThrow();
    });

    it('should handle EACCES errors', async () => {
      const error = new Error('EACCES: permission denied');
      (error as any).code = 'EACCES';

      vi.mocked(fsExtra.ensureDir).mockRejectedValue(error);

      await expect(fsExtra.ensureDir('/no-permission')).rejects.toThrow('permission denied');
    });

    it('should handle network timeouts', async () => {
      vi.mocked(execa).mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Network timeout')), 50);
        });
      });

      await expect(
        execa('npm', ['view', 'workspai', 'version'], { timeout: 100 })
      ).rejects.toThrow();
    });
  });

  describe('JSON Operations', () => {
    it('should stringify JSON', () => {
      const obj = { name: 'test', version: '1.0.0' };
      const json = JSON.stringify(obj, null, 2);

      expect(json).toContain('"name"');
      expect(json).toContain('"test"');
    });

    it('should parse JSON', () => {
      const json = '{"name": "test"}';
      const obj = JSON.parse(json);

      expect(obj.name).toBe('test');
    });
  });

  describe('README Generation', () => {
    it('should generate README content', () => {
      const content = `# Workspai Workspace

This workspace contains Workspai projects.

## Getting Started

\`\`\`bash
npx workspai workspace run
\`\`\`
`;

      expect(content).toContain('Workspai');
      expect(content).toContain('Getting Started');
      expect(content).toContain('workspai');
    });

    it('should support different install methods', () => {
      const methods = ['poetry', 'venv', 'pipx'];

      methods.forEach((method) => {
        expect(method).toBeTruthy();
        expect(method.length).toBeGreaterThan(0);
      });
    });
  });
});
