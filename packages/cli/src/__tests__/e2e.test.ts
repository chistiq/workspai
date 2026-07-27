import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'fs/promises';
import { closeSync, openSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { execa } from 'execa';
import { ensureDistBuilt } from './helpers/dist';

describe('E2E Tests', () => {
  let tempDir: string;
  let cliPath: string;

  function cliEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.NODE_ENV;
    delete env.NODE_OPTIONS;
    for (const key of Object.keys(env)) {
      if (key.startsWith('VITEST')) {
        delete env[key];
      }
    }
    return env;
  }

  function noPythonCliEnv(): NodeJS.ProcessEnv {
    const env = cliEnv();
    env.RAPIDKIT_FORCE_OFFLINE_CREATE_FALLBACK = '1';
    return env;
  }

  function runCliCaptured(args: string[], env: NodeJS.ProcessEnv = cliEnv()): string {
    const outputPath = join(tempDir, `cli-output-${Date.now()}-${Math.random()}.txt`);
    const fd = openSync(outputPath, 'w');
    try {
      const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: tempDir,
        encoding: 'utf8',
        env,
        stdio: ['ignore', fd, 'pipe'],
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      closeSync(fd);
    }

    try {
      return readFileSync(outputPath, 'utf8');
    } finally {
      rmSync(outputPath, { force: true });
    }
  }

  beforeEach(async () => {
    cliPath = ensureDistBuilt('E2E tests');
    tempDir = await mkdtemp(join(tmpdir(), 'rapidkit-e2e-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates FastAPI project through npm offline fallback successfully', async () => {
    const projectName = 'test-api';
    const projectPath = join(tempDir, projectName);

    await execa(
      process.execPath,
      [
        cliPath,
        'create',
        'project',
        'fastapi.standard',
        projectName,
        '--output',
        tempDir,
        '--skip-git',
        '--skip-install',
      ],
      {
        cwd: tempDir,
        env: noPythonCliEnv(),
      }
    );

    // Verify project structure
    await expect(fileExists(join(projectPath, 'pyproject.toml'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'rapidkit'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, '.workspai', 'project.json'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'src', 'main.py'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'src', 'routing', 'examples.py'))).resolves.toBe(
      true
    );
    await expect(fileExists(join(projectPath, 'tests', 'test_health.py'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, '.env.example'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'README.md'))).resolves.toBe(true);
  }, 60000);

  it('creates NestJS project through npm offline fallback successfully', async () => {
    const projectName = 'test-nest';
    const projectPath = join(tempDir, projectName);

    await execa(
      process.execPath,
      [
        cliPath,
        'create',
        'project',
        'nestjs.standard',
        projectName,
        '--output',
        tempDir,
        '--skip-git',
        '--skip-install',
      ],
      {
        cwd: tempDir,
        env: noPythonCliEnv(),
      }
    );

    // Verify project structure
    await expect(fileExists(join(projectPath, 'package.json'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'rapidkit'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, '.workspai', 'project.json'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'src', 'main.ts'))).resolves.toBe(true);
    await expect(
      fileExists(join(projectPath, 'src', 'examples', 'examples.module.ts'))
    ).resolves.toBe(true);
    await expect(fileExists(join(projectPath, '.env.example'))).resolves.toBe(true);
    await expect(fileExists(join(projectPath, 'README.md'))).resolves.toBe(true);

    // Verify package.json content
    const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf-8'));
    expect(packageJson.name).toBe('test-nest');
  }, 60000);

  it('creates workspace successfully', async () => {
    const workspaceName = 'test-workspace';
    const workspacePath = join(tempDir, workspaceName);

    await execa(
      process.execPath,
      [cliPath, workspaceName, '--skip-git', '--yes', '--output', tempDir],
      {
        cwd: tempDir,
        env: cliEnv(),
      }
    );

    // Verify workspace structure
    await expect(fileExists(join(workspacePath, 'README.md'))).resolves.toBe(true);
    await expect(fileExists(join(workspacePath, '.workspai'))).resolves.toBe(true);
    await expect(fileExists(join(workspacePath, '.workspai-workspace'))).resolves.toBe(true);
    await expect(fileExists(join(workspacePath, 'pyproject.toml'))).resolves.toBe(false);
    await expect(fileExists(join(workspacePath, 'poetry.toml'))).resolves.toBe(false);
  }, 30000);

  it('rejects invalid project names', async () => {
    const invalidNames = ['invalid name', '123-start', 'test@project', 'test project'];

    for (const invalidName of invalidNames) {
      await expect(
        execa('node', [cliPath, invalidName, '--template', 'fastapi', '--skip-git'], {
          cwd: tempDir,
          env: cliEnv(),
          reject: false,
        })
      ).resolves.toHaveProperty('exitCode', 1);
    }
  }, 30000);

  it('handles dry-run mode correctly for templates', async () => {
    const projectName = 'test-project';

    const stdout = runCliCaptured([projectName, '--template', 'fastapi', '--dry-run']);

    expect(stdout).toContain('Dry-run mode');
    expect(stdout.toLowerCase()).toContain('fastapi');
    expect(stdout).toContain(projectName);

    // Verify nothing was created
    await expect(fileExists(join(tempDir, projectName))).resolves.toBe(false);
  }, 15000);

  it('handles dry-run mode correctly for workspace', async () => {
    const workspaceName = 'test-workspace';

    const stdout = runCliCaptured([workspaceName, '--dry-run']);

    expect(stdout).toContain('Dry-run mode');
    expect(stdout.toLowerCase()).toContain('workspace');
    expect(stdout).toContain(workspaceName);

    // Verify nothing was created
    await expect(fileExists(join(tempDir, workspaceName))).resolves.toBe(false);
  }, 15000);

  it('shows version correctly', async () => {
    const { stdout } = await execa('node', [cliPath, '--version'], { env: cliEnv() });

    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 5000);

  it('shows help correctly', async () => {
    const stdout = runCliCaptured(['--help']);
    const createHelp = runCliCaptured(['create', 'project', '--help']);

    expect(stdout).toContain('Workspai');
    expect(stdout).toContain('npx workspai');
    expect(stdout).toContain('Canonical Workspace Model');
    expect(createHelp).toContain('--skip-git');
    expect(stdout).not.toContain('npx rapidkit');
  }, 5000);
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
