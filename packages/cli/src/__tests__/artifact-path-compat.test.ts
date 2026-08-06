import path from 'node:path';
import os from 'node:os';
import { open } from 'node:fs/promises';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  firstExistingWorkspaceArtifactPath,
  isWorkspaceArtifactLockContentionError,
  resolveLegacyWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath,
  writeWorkspaceArtifactJson,
  writeWorkspaceArtifactText,
  withWorkspaceArtifactLock,
} from '../utils/artifact-path-compat';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry';
import {
  WORKSPACE_ARTIFACT_CONTRACTS,
  workspaceArtifactContractFor,
} from '../contracts/artifact-contract-registry';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsExtra.remove(root)));
});

async function temporaryWorkspace(): Promise<string> {
  const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-artifact-path-'));
  temporaryRoots.push(root);
  return root;
}

describe('workspace artifact path compatibility', () => {
  it('treats Windows sharing violations as lock contention without masking them elsewhere', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      const error = Object.assign(new Error(code), { code });
      expect(isWorkspaceArtifactLockContentionError(error, 'win32')).toBe(true);
      expect(isWorkspaceArtifactLockContentionError(error, 'linux')).toBe(false);
      expect(isWorkspaceArtifactLockContentionError(error, 'darwin')).toBe(false);
    }
    expect(
      isWorkspaceArtifactLockContentionError(
        Object.assign(new Error('unexpected'), { code: 'EINVAL' }),
        'win32'
      )
    ).toBe(false);
  });

  it('rejects absolute paths and workspace traversal for canonical and legacy resolution', () => {
    const root = path.resolve(os.tmpdir(), 'workspai-artifact-root');
    for (const unsafe of [
      '',
      '   ',
      '../outside.json',
      '../../outside.json',
      path.resolve(root, '..', 'x'),
    ]) {
      expect(() => resolveWorkspaceArtifactPath(root, unsafe)).toThrow(/artifact path/i);
      expect(() => resolveLegacyWorkspaceArtifactPath(root, unsafe)).toThrow(/artifact path/i);
    }
  });

  it('writes JSON and text atomically without leaving temporary files', async () => {
    const root = await temporaryWorkspace();
    const jsonPath = await writeWorkspaceArtifactJson(root, '.workspai/cache/example.json', {
      value: 1,
    });
    const textPath = await writeWorkspaceArtifactText(
      root,
      '.workspai/reports/example.txt',
      'first'
    );
    await writeWorkspaceArtifactJson(root, '.workspai/cache/example.json', { value: 2 });

    expect(await fsExtra.readJson(jsonPath)).toEqual({ value: 2 });
    expect(await fsExtra.readFile(textPath, 'utf8')).toBe('first');
    expect(
      (await fsExtra.readdir(path.dirname(jsonPath))).some((name) => name.endsWith('.tmp'))
    ).toBe(false);
  });

  it('removes abandoned temporary artifacts and honors the bounded test delay', async () => {
    const root = await temporaryWorkspace();
    const reportDirectory = path.join(root, '.workspai', 'reports');
    const staleTemporary = path.join(reportDirectory, 'example.txt.abandoned.tmp');
    await fsExtra.outputFile(staleTemporary, 'partial');
    const oldTime = new Date(Date.now() - 60_000);
    await fsExtra.utimes(staleTemporary, oldTime, oldTime);
    const previousDelay = process.env.WORKSPAI_TEST_ATOMIC_WRITE_DELAY_MS;
    process.env.WORKSPAI_TEST_ATOMIC_WRITE_DELAY_MS = '1';

    try {
      const artifact = await writeWorkspaceArtifactText(
        root,
        '.workspai/reports/example.txt',
        'complete'
      );
      expect(await fsExtra.readFile(artifact, 'utf8')).toBe('complete');
      expect(await fsExtra.pathExists(staleTemporary)).toBe(false);
    } finally {
      if (previousDelay === undefined) delete process.env.WORKSPAI_TEST_ATOMIC_WRITE_DELAY_MS;
      else process.env.WORKSPAI_TEST_ATOMIC_WRITE_DELAY_MS = previousDelay;
    }
  });

  it('tolerates Windows EPERM fsync failures during atomic artifact writes', async () => {
    const root = await temporaryWorkspace();
    const probePath = path.join(root, 'probe.txt');
    await fsExtra.outputFile(probePath, 'probe');
    const probeHandle = await open(probePath, 'r');
    const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as {
      sync: () => Promise<void>;
    };
    await probeHandle.close();
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const syncSpy = vi
      .spyOn(fileHandlePrototype, 'sync')
      .mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    try {
      const jsonPath = await writeWorkspaceArtifactJson(root, '.workspai/cache/example.json', {
        value: 'windows-fsync-tolerated',
      });

      expect(await fsExtra.readJson(jsonPath)).toEqual({ value: 'windows-fsync-tolerated' });
      expect(
        (await fsExtra.readdir(path.dirname(jsonPath))).some((name) => name.endsWith('.tmp'))
      ).toBe(false);
    } finally {
      syncSpy.mockRestore();
      platformSpy.mockRestore();
    }
  });

  it('fails closed on durability errors outside Windows and removes partial output', async () => {
    const root = await temporaryWorkspace();
    const probePath = path.join(root, 'probe.txt');
    await fsExtra.outputFile(probePath, 'probe');
    const probeHandle = await open(probePath, 'r');
    const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as {
      sync: () => Promise<void>;
    };
    await probeHandle.close();
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const syncSpy = vi
      .spyOn(fileHandlePrototype, 'sync')
      .mockRejectedValueOnce(Object.assign(new Error('I/O failure'), { code: 'EIO' }));

    try {
      await expect(
        writeWorkspaceArtifactText(root, '.workspai/reports/failed.txt', 'partial')
      ).rejects.toThrow('I/O failure');
      expect(await fsExtra.pathExists(path.join(root, '.workspai/reports/failed.txt'))).toBe(false);
      expect(
        (await fsExtra.readdir(path.join(root, '.workspai/reports'))).some((name) =>
          name.endsWith('.tmp')
        )
      ).toBe(false);
    } finally {
      syncSpy.mockRestore();
      platformSpy.mockRestore();
    }
  });

  it('rejects a registered artifact before writing when its schema is invalid', async () => {
    const root = await temporaryWorkspace();

    await expect(
      writeWorkspaceArtifactJson(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze, {})
    ).rejects.toThrow(/schemaVersion.*expected rapidkit-analyze-v1/i);
    expect(
      await fsExtra.pathExists(path.join(root, WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze))
    ).toBe(false);
  });

  it('rejects unregistered public JSON reports before writing', async () => {
    const root = await temporaryWorkspace();

    await expect(
      writeWorkspaceArtifactJson(root, '.workspai/reports/uncontracted.json', { value: 1 })
    ).rejects.toThrow(/without a registered artifact contract/i);
    expect(await fsExtra.pathExists(path.join(root, '.workspai/reports/uncontracted.json'))).toBe(
      false
    );
  });

  it('registers supplemental producer artifacts at the write boundary', () => {
    for (const artifactPath of [
      '.workspai/workspace.contract.json',
      '.workspai/cache/workspace-model.v1.json',
      '.workspai/workspace-registry.v1.json',
      '.workspai/compatibility-matrix.json',
      '.workspai/reports/bootstrap-compliance.latest.json',
      '.workspai/reports/mirror-ops.latest.json',
      '.workspai/reports/transparency-evidence.latest.json',
      '.workspai/reports/share-bundle.json',
      '.workspai/reports/doctor-project-last-run.json',
      '.workspai/reports/autopilot-release-last-run.json',
      '.workspai/reports/autopilot-release.json',
      '.workspai/reports/workspai-mcp-design.json',
      '.workspai/reports/rapidkit-mcp-design.json',
      '.workspai/reports/workspace-why-last-run.json',
      '.workspai/reports/workspace-trace-last-run.json',
    ]) {
      expect(workspaceArtifactContractFor(artifactPath), artifactPath).not.toBeNull();
    }
  });

  it('maps timestamped operational reports to their canonical public contracts', () => {
    expect(
      workspaceArtifactContractFor(
        '.workspai/reports/bootstrap-compliance-2026-07-21T00-00-00-000Z.json'
      )?.contractPath
    ).toBe('contracts/bootstrap-compliance.v1.json');
    expect(
      workspaceArtifactContractFor('.workspai/reports/mirror-ops-1721510000000.json')?.contractPath
    ).toBe('contracts/mirror-ops.v1.json');
    expect(
      workspaceArtifactContractFor(
        '.workspai/reports/transparency-evidence-2026-07-21T00-00-00-000Z.json'
      )?.contractPath
    ).toBe('contracts/transparency-evidence.v1.json');
  });

  it('requires at least one declared producer for every registered artifact contract', () => {
    for (const [artifactPath, descriptor] of Object.entries(WORKSPACE_ARTIFACT_CONTRACTS)) {
      expect(descriptor.producerCommands, artifactPath).not.toHaveLength(0);
    }
  });

  it('rejects writes through a report-directory symlink outside the workspace', async () => {
    const root = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await fsExtra.ensureDir(path.join(root, '.workspai'));
    await fsExtra.symlink(outside, path.join(root, '.workspai', 'reports'));

    await expect(
      writeWorkspaceArtifactText(root, '.workspai/reports/escape.txt', 'unsafe')
    ).rejects.toThrow(/outside workspace root/i);
    expect(await fsExtra.pathExists(path.join(outside, 'escape.txt'))).toBe(false);
  });

  it('prefers canonical artifacts and falls back to legacy artifacts', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/example.json';
    const canonicalPath = resolveWorkspaceArtifactPath(root, relativePath);
    const legacyPath = resolveLegacyWorkspaceArtifactPath(root, relativePath);
    await fsExtra.outputJson(legacyPath, { source: 'legacy' });

    expect(await firstExistingWorkspaceArtifactPath(root, relativePath)).toBe(legacyPath);

    await fsExtra.outputJson(canonicalPath, { source: 'canonical' });
    expect(await firstExistingWorkspaceArtifactPath(root, relativePath)).toBe(canonicalPath);
  });

  it('returns null when neither canonical nor legacy artifact exists', async () => {
    const root = await temporaryWorkspace();
    await expect(
      firstExistingWorkspaceArtifactPath(root, '.workspai/reports/missing.json')
    ).resolves.toBeNull();
  });

  it('rejects reads through an artifact symlink outside the workspace', async () => {
    const root = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    const outsideArtifact = path.join(outside, 'escape.json');
    const canonicalPath = resolveWorkspaceArtifactPath(root, '.workspai/reports/escape.json');
    await fsExtra.outputJson(outsideArtifact, { unsafe: true });
    await fsExtra.ensureDir(path.dirname(canonicalPath));
    await fsExtra.symlink(outsideArtifact, canonicalPath);

    await expect(
      firstExistingWorkspaceArtifactPath(root, '.workspai/reports/escape.json')
    ).rejects.toThrow(/outside workspace root/i);
  });

  it('does not steal an old lock from a process that is still alive', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/example.json';
    const lockPath = `${resolveWorkspaceArtifactPath(root, relativePath)}.lock`;
    await fsExtra.outputJson(lockPath, { pid: process.pid, createdAt: 'old' });
    const oldTime = new Date(Date.now() - 60_000);
    await fsExtra.utimes(lockPath, oldTime, oldTime);

    await expect(
      withWorkspaceArtifactLock(root, relativePath, async () => undefined, {
        timeoutMs: 50,
        staleAfterMs: 1,
      })
    ).rejects.toThrow(/timed out/i);
    expect(await fsExtra.pathExists(lockPath)).toBe(true);
  });

  it('recovers a lock immediately when its recorded owner process is gone', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/example.json';
    const lockPath = `${resolveWorkspaceArtifactPath(root, relativePath)}.lock`;
    await fsExtra.outputJson(lockPath, { pid: 2_147_483_647, createdAt: new Date().toISOString() });

    await expect(
      withWorkspaceArtifactLock(root, relativePath, async () => 'recovered', {
        timeoutMs: 100,
        staleAfterMs: 60_000,
      })
    ).resolves.toBe('recovered');
    expect(await fsExtra.pathExists(lockPath)).toBe(false);
  });

  it('recovers a stale lock owned by a dead process and cleans it after success', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/recovered.json';
    const lockPath = `${resolveWorkspaceArtifactPath(root, relativePath)}.lock`;
    await fsExtra.outputJson(lockPath, { pid: 999_999_999, createdAt: 'old' });
    const oldTime = new Date(Date.now() - 60_000);
    await fsExtra.utimes(lockPath, oldTime, oldTime);

    await expect(
      withWorkspaceArtifactLock(root, relativePath, async () => 'recovered', {
        timeoutMs: 500,
        staleAfterMs: 1,
      })
    ).resolves.toBe('recovered');
    expect(await fsExtra.pathExists(lockPath)).toBe(false);
  });

  it('recovers stale malformed locks without probing an invalid process id', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/malformed-lock.json';
    const lockPath = `${resolveWorkspaceArtifactPath(root, relativePath)}.lock`;
    await fsExtra.outputFile(lockPath, 'not-json');
    const oldTime = new Date(Date.now() - 60_000);
    await fsExtra.utimes(lockPath, oldTime, oldTime);
    const killSpy = vi.spyOn(process, 'kill');

    try {
      await expect(
        withWorkspaceArtifactLock(root, relativePath, async () => 'recovered', {
          timeoutMs: 500,
          staleAfterMs: 1,
        })
      ).resolves.toBe('recovered');
      expect(killSpy).not.toHaveBeenCalled();
      expect(await fsExtra.pathExists(lockPath)).toBe(false);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('treats EPERM while probing a stale lock owner as evidence that it is alive', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/protected-lock.json';
    const lockPath = `${resolveWorkspaceArtifactPath(root, relativePath)}.lock`;
    await fsExtra.outputJson(lockPath, { pid: 424_242, createdAt: 'old' });
    const oldTime = new Date(Date.now() - 60_000);
    await fsExtra.utimes(lockPath, oldTime, oldTime);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('protected'), { code: 'EPERM' });
    });

    try {
      await expect(
        withWorkspaceArtifactLock(root, relativePath, async () => undefined, {
          timeoutMs: 30,
          staleAfterMs: 1,
        })
      ).rejects.toThrow(/timed out/i);
      expect(await fsExtra.pathExists(lockPath)).toBe(true);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('cleans the lock when the protected operation throws', async () => {
    const root = await temporaryWorkspace();
    const relativePath = '.workspai/reports/throwing.json';
    const lockPath = `${resolveWorkspaceArtifactPath(root, relativePath)}.lock`;
    await expect(
      withWorkspaceArtifactLock(root, relativePath, async () => {
        throw new Error('operation failed');
      })
    ).rejects.toThrow('operation failed');
    expect(await fsExtra.pathExists(lockPath)).toBe(false);
  });
});
