import fs from 'fs';
import path from 'path';

import type { CommandResult, RuntimeAdapter } from './types.js';

export type PhpCommandRunner = (command: string, args: string[], cwd: string) => Promise<number>;

type ComposerManifest = {
  scripts?: Record<string, unknown>;
};

export class PhpRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'php' as const;

  constructor(private readonly runCommand: PhpCommandRunner) {}

  private async run(command: string, args: string[], cwd: string): Promise<CommandResult> {
    return { exitCode: await this.runCommand(command, args, cwd) };
  }

  private hasComposer(projectPath: string): boolean {
    return fs.existsSync(path.join(projectPath, 'composer.json'));
  }

  private hasArtisan(projectPath: string): boolean {
    return fs.existsSync(path.join(projectPath, 'artisan'));
  }

  private hasComposerScript(projectPath: string, script: string): boolean {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'composer.json'), 'utf8')
      ) as ComposerManifest;
      return !!manifest.scripts && Object.prototype.hasOwnProperty.call(manifest.scripts, script);
    } catch {
      return false;
    }
  }

  private missingManifest(): CommandResult {
    return {
      exitCode: 1,
      message: 'composer.json was not found. Run the command from a PHP project root.',
    };
  }

  private unsupported(command: string): CommandResult {
    return {
      exitCode: 1,
      message: `No deterministic PHP ${command} command was detected. Add a "${command}" Composer script or the expected Laravel tooling.`,
    };
  }

  async checkPrereqs(): Promise<CommandResult> {
    const php = await this.run('php', ['--version'], process.cwd());
    if (php.exitCode !== 0) return php;
    return this.run('composer', ['--version'], process.cwd());
  }

  async initProject(projectPath: string): Promise<CommandResult> {
    if (!this.hasComposer(projectPath)) return this.missingManifest();
    return this.run('composer', ['install', '--no-interaction'], projectPath);
  }

  async runDev(projectPath: string): Promise<CommandResult> {
    if (this.hasComposerScript(projectPath, 'dev')) {
      return this.run('composer', ['run-script', 'dev'], projectPath);
    }
    if (this.hasArtisan(projectPath)) {
      return this.run('php', ['artisan', 'serve'], projectPath);
    }
    return this.unsupported('dev');
  }

  async runTest(projectPath: string): Promise<CommandResult> {
    if (this.hasArtisan(projectPath)) {
      return this.run('php', ['artisan', 'test'], projectPath);
    }
    if (this.hasComposerScript(projectPath, 'test')) {
      return this.run('composer', ['run-script', 'test'], projectPath);
    }
    return this.unsupported('test');
  }

  async runBuild(projectPath: string): Promise<CommandResult> {
    if (this.hasComposerScript(projectPath, 'build')) {
      return this.run('composer', ['run-script', 'build'], projectPath);
    }
    return this.unsupported('build');
  }

  async runStart(projectPath: string): Promise<CommandResult> {
    if (this.hasComposerScript(projectPath, 'start')) {
      return this.run('composer', ['run-script', 'start'], projectPath);
    }
    if (this.hasArtisan(projectPath)) {
      return this.run('php', ['artisan', 'serve'], projectPath);
    }
    return this.unsupported('start');
  }

  async runLint(projectPath: string): Promise<CommandResult> {
    for (const script of ['lint', 'analyse', 'analyze']) {
      if (this.hasComposerScript(projectPath, script)) {
        return this.run('composer', ['run-script', script], projectPath);
      }
    }
    return this.unsupported('lint');
  }

  async runFormat(projectPath: string): Promise<CommandResult> {
    for (const script of ['format', 'fmt']) {
      if (this.hasComposerScript(projectPath, script)) {
        return this.run('composer', ['run-script', script], projectPath);
      }
    }
    if (
      fs.existsSync(path.join(projectPath, 'vendor', 'bin', 'pint')) ||
      fs.existsSync(path.join(projectPath, 'pint.json'))
    ) {
      return this.run('php', ['vendor/bin/pint'], projectPath);
    }
    return this.unsupported('format');
  }

  async doctorHints(_projectPath: string): Promise<string[]> {
    return [
      'Install a supported PHP release and Composer, then keep both on PATH.',
      'Commit composer.lock for deterministic application installs.',
      'Expose test, lint, format, and build commands as Composer scripts when the framework does not provide them.',
    ];
  }
}
