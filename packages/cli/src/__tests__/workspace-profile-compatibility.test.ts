import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectWorkspaceProfileRuntimes,
  resolveWorkspaceProfileCompatibility,
  resolveWorkspaceProfileProjectCompatibility,
} from '../workspace-profile-compatibility';

const createdPaths: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dirPath = await fsExtra.mkdtemp(path.join(os.tmpdir(), prefix));
  createdPaths.push(dirPath);
  return dirPath;
}

afterEach(async () => {
  while (createdPaths.length > 0) {
    const target = createdPaths.pop();
    if (target) {
      await fsExtra.remove(target);
    }
  }
});

describe('workspace profile compatibility', () => {
  it('allows empty single-runtime profiles until projects are discovered', () => {
    const result = resolveWorkspaceProfileCompatibility({
      profile: 'node-only',
      runtimes: [],
    });

    expect(result).toMatchObject({
      ok: true,
      checkId: 'profile.node-only',
      status: 'passed',
      message: 'node-only profile validated for discovered projects.',
    });
  });

  it('warns when a single-runtime profile sees multiple runtimes', () => {
    const result = resolveWorkspaceProfileCompatibility({
      profile: 'node-only',
      runtimes: ['node', 'python'],
    });

    expect(result).toMatchObject({
      ok: false,
      checkId: 'profile.node-only',
      status: 'failed',
      severity: 'warning',
      recommendedProfile: 'polyglot',
      recommendedCommand: 'npx workspai bootstrap --profile polyglot',
      ciRecommendedCommand: 'npx workspai bootstrap --profile polyglot --ci --json',
      message: 'node-only profile mismatch: detected runtimes [node, python].',
    });
  });

  it('upgrades warning severity to error in strict mode', () => {
    const result = resolveWorkspaceProfileProjectCompatibility({
      profile: 'node-only',
      runtime: 'python',
      subjectLabel: 'studio-api',
      mode: 'strict',
    });

    expect(result).toMatchObject({
      ok: false,
      severity: 'error',
      recommendedProfile: 'polyglot',
      message: 'Project "studio-api" is Python, but workspace profile is "node-only".',
    });
  });

  it('treats bun and deno as node-family runtimes for profile compatibility', () => {
    const result = resolveWorkspaceProfileCompatibility({
      profile: 'node-only',
      runtimes: ['bun', 'deno'],
    });

    expect(result.ok).toBe(true);
    expect(result.runtimes).toEqual(['deno', 'bun']);
  });

  it('treats scala and kotlin as java-family runtimes for profile compatibility', () => {
    const result = resolveWorkspaceProfileCompatibility({
      profile: 'java-only',
      runtimes: ['scala', 'kotlin'],
    });

    expect(result.ok).toBe(true);
    expect(result.runtimes).toEqual(['kotlin', 'scala']);
  });

  it('keeps every known backend runtime out of the unknown compatibility bucket', () => {
    const knownRuntimes = [
      'python',
      'node',
      'go',
      'java',
      'php',
      'ruby',
      'dotnet',
      'rust',
      'elixir',
      'clojure',
      'scala',
      'kotlin',
      'deno',
      'bun',
      'c',
      'cpp',
    ];

    const result = resolveWorkspaceProfileCompatibility({
      profile: 'minimal',
      runtimes: knownRuntimes,
    });

    expect(result.runtimes).toEqual([
      'node',
      'deno',
      'bun',
      'python',
      'go',
      'java',
      'kotlin',
      'scala',
      'dotnet',
      'php',
      'ruby',
      'rust',
      'elixir',
      'clojure',
      'c',
      'cpp',
    ]);
    expect(result.runtimes).not.toContain('unknown');
  });

  it('treats observed runtimes as real profile mix members instead of unknown', () => {
    const result = resolveWorkspaceProfileCompatibility({
      profile: 'minimal',
      runtimes: ['node', 'rust', 'cpp'],
    });

    expect(result).toMatchObject({
      ok: false,
      recommendedProfile: 'polyglot',
      message: 'minimal profile mismatch: multiple runtimes detected [node, rust, cpp].',
    });
    expect(result.runtimes).toEqual(['node', 'rust', 'cpp']);
  });

  it('excludes stale registry runtime when a linked project is being re-observed', async () => {
    const workspacePath = await makeTempDir('workspace-profile-readopt-');
    const projectPath = await makeTempDir('workspace-profile-readopt-project-');
    await fsExtra.ensureDir(path.join(workspacePath, '.workspai'));
    await fsExtra.writeJson(path.join(workspacePath, '.workspai', 'imported-projects.json'), {
      version: 1,
      updatedAt: '2026-08-28T00:00:00.000Z',
      projects: [
        {
          name: 'sdk',
          path: projectPath,
          stack: 'unknown',
          runtime: 'unknown',
          confidence: 'low',
          importedAt: '2026-08-28T00:00:00.000Z',
        },
      ],
    });

    await expect(
      collectWorkspaceProfileRuntimes(workspacePath, {
        additionalRuntimes: ['python'],
        excludeProjectPath: projectPath,
      })
    ).resolves.toEqual(['python']);
  });

  it('blocks observed runtimes against single-runtime profiles in strict mode', () => {
    const result = resolveWorkspaceProfileProjectCompatibility({
      profile: 'node-only',
      runtime: 'rust',
      subjectLabel: 'native-worker',
      mode: 'strict',
    });

    expect(result).toMatchObject({
      ok: false,
      severity: 'error',
      recommendedProfile: 'polyglot',
      message: 'Project "native-worker" is Rust, but workspace profile is "node-only".',
    });
  });

  it('collects runtimes from internal projects and imported/adopted registry entries', async () => {
    const workspacePath = await makeTempDir('rapidkit-profile-runtime-workspace-');
    const internalNodeProject = path.join(workspacePath, 'portal-web');
    const internalRustProject = path.join(workspacePath, 'ledger-service');
    const internalCppProject = path.join(workspacePath, 'native-worker');
    const externalPythonProject = await makeTempDir('rapidkit-profile-runtime-external-');

    await fsExtra.ensureDir(path.join(internalNodeProject, '.rapidkit'));
    await fsExtra.writeJson(path.join(internalNodeProject, '.rapidkit', 'project.json'), {
      name: 'portal-web',
      runtime: 'node',
    });
    await fsExtra.ensureDir(path.join(internalRustProject, '.rapidkit'));
    await fsExtra.writeJson(path.join(internalRustProject, '.rapidkit', 'project.json'), {
      name: 'ledger-service',
      runtime: 'rust',
    });
    await fsExtra.ensureDir(path.join(internalCppProject, '.rapidkit'));
    await fsExtra.writeJson(path.join(internalCppProject, '.rapidkit', 'project.json'), {
      name: 'native-worker',
      runtime: 'cpp',
    });
    await fsExtra.ensureDir(path.join(workspacePath, '.rapidkit'));
    await fsExtra.writeJson(path.join(workspacePath, '.rapidkit', 'imported-projects.json'), {
      version: 1,
      updatedAt: '2026-07-05T00:00:00.000Z',
      projects: [
        {
          name: 'studio-api',
          path: externalPythonProject,
          stack: 'fastapi',
          runtime: 'python',
          confidence: 'high',
          importedAt: '2026-07-05T00:00:00.000Z',
        },
      ],
    });

    await expect(collectWorkspaceProfileRuntimes(workspacePath)).resolves.toEqual([
      'node',
      'python',
      'rust',
      'cpp',
    ]);
  });
});
