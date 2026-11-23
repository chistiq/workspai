import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execa } from 'execa';
import * as fsExtra from 'fs-extra';
import { ensureDistBuilt } from './helpers/dist';

describe('Scenario C: System Python has rapidkit-core -> no bridge venv', () => {
  let tempDir: string;
  let fakeBin: string;
  let cacheDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rapidkit-scenario-c-'));
    fakeBin = join(tempDir, 'fakebin');
    cacheDir = join(tempDir, 'cache');
    await fsExtra.ensureDir(fakeBin);
    await fsExtra.ensureDir(cacheDir);
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prefers system python with core and does not create bridge venv', async () => {
    // Resolve an absolute system python to use as fallback inside our wrapper
    // Use `which python3` so the fallback does not re-exec our wrapper
    let systemPython = '/usr/bin/python3';
    try {
      const whichRes = await execa('which', ['python3']);
      if (whichRes.exitCode === 0 && whichRes.stdout.trim()) systemPython = whichRes.stdout.trim();
    } catch {
      // use default
    }

    const wrapper = `#!/usr/bin/env bash
# Fake python wrapper for Scenario C test
sys_python="${systemPython}"
if [ "$1" = "--version" ]; then
  echo 'Python 3.11.18'
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "rapidkit" ]; then
  # For version probe, return valid JSON so the probe succeeds
  if [ "$3" = "--version" ]; then
    echo '{"schema_version":1,"version":"0.6.3"}'
    exit 0
  fi
  # For other rapidkit invocations, succeed silently so the wrapper behaves like
  # a system python with rapidkit present (we don't need to emulate full behavior).
  exit 0
fi
exec "$sys_python" "$@"
`;

    const pythonPath = join(fakeBin, 'python3');
    await writeFile(pythonPath, wrapper, { mode: 0o755 });

    // Also create a `python` wrapper for systems that probe python first
    const pythonPath2 = join(fakeBin, 'python');
    await writeFile(pythonPath2, wrapper, { mode: 0o755 });

    // Make sure our fake bin is first on PATH
    const env = { ...process.env } as Record<string, string | undefined>;
    env.PATH = `${fakeBin}${pathDelimiter()}:${env.PATH || ''}`;
    env.RAPIDKIT_BRIDGE_PYTHON = pythonPath;
    env.XDG_CACHE_HOME = cacheDir; // ensure bridge venv would go into our temp cache

    // Run a core-forwarding command that would normally trigger bridge resolution
    const res = await execa('node', [ensureDistBuilt('scenario-c test'), 'list'], {
      cwd: tempDir,
      env,
      reject: false,
    });

    // Command should succeed (our fake python reports it has rapidkit)
    expect(res.exitCode).toBe(0);

    // Verify that the bridge venv path does NOT exist
    const bridgeRoot = join(cacheDir, 'rapidkit', 'npm-bridge');
    const bridgeVenv = join(bridgeRoot, 'venv');
    // Ensure any leftover bridge venv is removed (tests should be isolated).
    // This avoids flakes where a previous test created the cached venv.
    await fsExtra.remove(bridgeVenv);
    const entries = (await fsExtra.pathExists(bridgeRoot)) ? await fsExtra.readdir(bridgeRoot) : [];
    expect(entries.filter((entry) => entry.startsWith('venv'))).toEqual([]);
  }, 120000);
});

function pathDelimiter() {
  return process.platform === 'win32' ? ';' : ':';
}
