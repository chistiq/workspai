import fs from 'fs';
import path from 'path';

import type { CommandResult, RuntimeAdapter } from './types.js';

export type RustCommandRunner = (command: string, args: string[], cwd: string) => Promise<number>;

export class RustRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'rust' as const;

  constructor(private readonly runCommand: RustCommandRunner) {}

  private async run(args: string[], cwd: string): Promise<CommandResult> {
    return { exitCode: await this.runCommand('cargo', args, cwd) };
  }

  private hasManifest(projectPath: string): boolean {
    return fs.existsSync(path.join(projectPath, 'Cargo.toml'));
  }

  private missingManifest(): CommandResult {
    return {
      exitCode: 1,
      message: 'Cargo.toml was not found. Run the command from a Rust project root.',
    };
  }

  async checkPrereqs(): Promise<CommandResult> {
    return this.run(['--version'], process.cwd());
  }

  async initProject(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(['fetch'], projectPath);
  }

  async runDev(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(['run'], projectPath);
  }

  async runTest(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(['test', '--all-targets'], projectPath);
  }

  async runBuild(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(['build', '--release'], projectPath);
  }

  async runStart(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(['run', '--release'], projectPath);
  }

  async runLint(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(
      ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'],
      projectPath
    );
  }

  async runFormat(projectPath: string): Promise<CommandResult> {
    if (!this.hasManifest(projectPath)) return this.missingManifest();
    return this.run(['fmt', '--all'], projectPath);
  }

  async doctorHints(_projectPath: string): Promise<string[]> {
    return [
      'Install the Rust toolchain with rustup and ensure cargo is on PATH.',
      'Use Cargo.lock for deterministic application builds.',
      'Install rustfmt and clippy components for format and lint lifecycle commands.',
    ];
  }
}
