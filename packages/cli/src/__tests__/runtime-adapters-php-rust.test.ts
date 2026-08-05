import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PhpRuntimeAdapter } from '../runtime-adapters/php.js';
import { RustRuntimeAdapter } from '../runtime-adapters/rust.js';

const temporaryProjects = new Set<string>();

function temporaryProject(prefix: string): string {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryProjects.add(projectPath);
  return projectPath;
}

function writeComposerProject(
  scripts: Record<string, string> = {},
  options: { artisan?: boolean; pint?: boolean; invalidManifest?: boolean } = {}
): string {
  const projectPath = temporaryProject('workspai-php-adapter-');
  fs.writeFileSync(
    path.join(projectPath, 'composer.json'),
    options.invalidManifest ? '{invalid' : JSON.stringify({ scripts })
  );
  if (options.artisan) fs.writeFileSync(path.join(projectPath, 'artisan'), '');
  if (options.pint) {
    fs.mkdirSync(path.join(projectPath, 'vendor', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'vendor', 'bin', 'pint'), '');
  }
  return projectPath;
}

function writeRustProject(): string {
  const projectPath = temporaryProject('workspai-rust-adapter-');
  fs.writeFileSync(path.join(projectPath, 'Cargo.toml'), '[package]\nname = "fixture"\n');
  return projectPath;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const projectPath of temporaryProjects) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
  temporaryProjects.clear();
});

describe('PhpRuntimeAdapter', () => {
  it('requires PHP before Composer and preserves the failing prerequisite result', async () => {
    const failedRun = vi.fn().mockResolvedValueOnce(7);
    const failed = await new PhpRuntimeAdapter(failedRun).checkPrereqs();
    expect(failed).toEqual(
      expect.objectContaining({
        exitCode: 7,
        message: expect.stringContaining('php --version'),
      })
    );
    expect(failedRun).toHaveBeenCalledTimes(1);
    expect(failedRun).toHaveBeenCalledWith('php', ['--version'], process.cwd());

    const successfulRun = vi.fn().mockResolvedValue(0);
    const successful = await new PhpRuntimeAdapter(successfulRun).checkPrereqs();
    expect(successful).toEqual({ exitCode: 0 });
    expect(successfulRun).toHaveBeenNthCalledWith(1, 'php', ['--version'], process.cwd());
    expect(successfulRun).toHaveBeenNthCalledWith(2, 'composer', ['--version'], process.cwd());
  });

  it('fails closed when composer.json is missing and initializes deterministic installs', async () => {
    const run = vi.fn().mockResolvedValue(0);
    const adapter = new PhpRuntimeAdapter(run);
    const missingProject = temporaryProject('workspai-php-missing-');

    await expect(adapter.initProject(missingProject)).resolves.toEqual(
      expect.objectContaining({ exitCode: 1, message: expect.stringContaining('composer.json') })
    );
    expect(run).not.toHaveBeenCalled();

    const projectPath = writeComposerProject();
    await expect(adapter.initProject(projectPath)).resolves.toEqual({ exitCode: 0 });
    expect(run).toHaveBeenCalledWith('composer', ['install', '--no-interaction'], projectPath);
  });

  it('routes every declared lifecycle script through Composer', async () => {
    const projectPath = writeComposerProject({
      dev: 'php server.php',
      test: 'phpunit',
      build: 'php build.php',
      start: 'php server.php',
      lint: 'phpcs',
      format: 'pint',
    });
    const run = vi.fn().mockResolvedValue(0);
    const adapter = new PhpRuntimeAdapter(run);

    await adapter.runDev(projectPath);
    await adapter.runTest(projectPath);
    await adapter.runBuild(projectPath);
    await adapter.runStart(projectPath);
    await adapter.runLint(projectPath);
    await adapter.runFormat(projectPath);

    for (const script of ['dev', 'test', 'build', 'start', 'lint', 'format']) {
      expect(run).toHaveBeenCalledWith('composer', ['run-script', script], projectPath);
    }
  });

  it('uses Laravel and Pint fallbacks when explicit scripts are absent', async () => {
    const projectPath = writeComposerProject({}, { artisan: true, pint: true });
    const run = vi.fn().mockResolvedValue(0);
    const adapter = new PhpRuntimeAdapter(run);

    await adapter.runDev(projectPath);
    await adapter.runTest(projectPath);
    await adapter.runStart(projectPath);
    await adapter.runFormat(projectPath);

    expect(run).toHaveBeenCalledWith('php', ['artisan', 'serve'], projectPath);
    expect(run).toHaveBeenCalledWith('php', ['artisan', 'test'], projectPath);
    expect(run).toHaveBeenCalledWith('php', ['vendor/bin/pint'], projectPath);
  });

  it('supports analyze/fmt aliases and returns actionable unsupported results', async () => {
    const aliasesProject = writeComposerProject({ analyze: 'phpstan', fmt: 'pint' });
    const run = vi.fn().mockResolvedValue(0);
    const adapter = new PhpRuntimeAdapter(run);
    await adapter.runLint(aliasesProject);
    await adapter.runFormat(aliasesProject);
    expect(run).toHaveBeenCalledWith('composer', ['run-script', 'analyze'], aliasesProject);
    expect(run).toHaveBeenCalledWith('composer', ['run-script', 'fmt'], aliasesProject);

    const invalidProject = writeComposerProject({}, { invalidManifest: true });
    for (const result of await Promise.all([
      adapter.runDev(invalidProject),
      adapter.runTest(invalidProject),
      adapter.runBuild(invalidProject),
      adapter.runStart(invalidProject),
      adapter.runLint(invalidProject),
      adapter.runFormat(invalidProject),
    ])) {
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('No deterministic PHP');
    }
  });

  it('publishes deterministic operator guidance', async () => {
    const hints = await new PhpRuntimeAdapter(vi.fn()).doctorHints('/tmp/project');
    expect(hints).toHaveLength(3);
    expect(hints.join(' ')).toContain('composer.lock');
  });

  it('keeps failed Composer executions actionable', async () => {
    const projectPath = writeComposerProject();
    const result = await new PhpRuntimeAdapter(vi.fn().mockResolvedValue(127)).initProject(
      projectPath
    );

    expect(result).toEqual(
      expect.objectContaining({
        exitCode: 127,
        message: expect.stringContaining('composer install --no-interaction'),
      })
    );
  });
});

describe('RustRuntimeAdapter', () => {
  it('routes every lifecycle operation through canonical Cargo arguments', async () => {
    const projectPath = writeRustProject();
    const run = vi.fn().mockResolvedValue(0);
    const adapter = new RustRuntimeAdapter(run);

    await adapter.checkPrereqs();
    await adapter.initProject(projectPath);
    await adapter.runDev(projectPath);
    await adapter.runTest(projectPath);
    await adapter.runBuild(projectPath);
    await adapter.runStart(projectPath);
    await adapter.runLint(projectPath);
    await adapter.runFormat(projectPath);

    expect(run).toHaveBeenCalledWith('cargo', ['--version'], process.cwd());
    expect(run).toHaveBeenCalledWith('cargo', ['fetch'], projectPath);
    expect(run).toHaveBeenCalledWith('cargo', ['run'], projectPath);
    expect(run).toHaveBeenCalledWith('cargo', ['test', '--all-targets'], projectPath);
    expect(run).toHaveBeenCalledWith('cargo', ['build', '--release'], projectPath);
    expect(run).toHaveBeenCalledWith('cargo', ['run', '--release'], projectPath);
    expect(run).toHaveBeenCalledWith(
      'cargo',
      ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'],
      projectPath
    );
    expect(run).toHaveBeenCalledWith('cargo', ['fmt', '--all'], projectPath);
  });

  it('fails closed for every project operation when Cargo.toml is absent', async () => {
    const projectPath = temporaryProject('workspai-rust-missing-');
    const run = vi.fn().mockResolvedValue(0);
    const adapter = new RustRuntimeAdapter(run);

    for (const result of await Promise.all([
      adapter.initProject(projectPath),
      adapter.runDev(projectPath),
      adapter.runTest(projectPath),
      adapter.runBuild(projectPath),
      adapter.runStart(projectPath),
      adapter.runLint(projectPath),
      adapter.runFormat(projectPath),
    ])) {
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('Cargo.toml');
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('preserves Cargo exit codes and publishes deterministic operator guidance', async () => {
    const projectPath = writeRustProject();
    const adapter = new RustRuntimeAdapter(vi.fn().mockResolvedValue(9));
    await expect(adapter.runBuild(projectPath)).resolves.toEqual(
      expect.objectContaining({
        exitCode: 9,
        message: expect.stringContaining('cargo build --release'),
      })
    );
    const hints = await adapter.doctorHints(projectPath);
    expect(hints).toHaveLength(3);
    expect(hints.join(' ')).toContain('Cargo.lock');
  });
});
