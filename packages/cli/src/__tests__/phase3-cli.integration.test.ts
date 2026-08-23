import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureDistBuilt } from './helpers/dist';

const PROCESS_INTEGRATION_TIMEOUT_MS = process.platform === 'win32' ? 120_000 : 20_000;

function cliEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST')) {
      delete env[key];
    }
  }
  const merged = {
    ...env,
    ...overrides,
  };
  if (merged.HOME && process.platform === 'win32') {
    merged.APPDATA = merged.APPDATA ?? merged.HOME;
    merged.USERPROFILE = merged.USERPROFILE ?? merged.HOME;
  }
  return merged;
}

describe('Phase 3 commands - CLI process integration', () => {
  it('keeps create workspace arguments intact under npx execution', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-npx-create-'));
    const workspaceName = 'sidebar-enterprise-test';

    try {
      const result = spawnSync(
        process.execPath,
        [
          dist,
          'create',
          'workspace',
          workspaceName,
          '--yes',
          '--output',
          tempDir,
          '--profile',
          'enterprise',
          '--skip-python-engine',
          '--skip-git',
          '--dry-run',
        ],
        {
          cwd: tempDir,
          encoding: 'utf8',
          env: cliEnv({
            npm_command: 'exec',
            npm_config_user_agent: 'npm/12.0.1 node/v20.20.0 linux x64 workspaces/false',
          }),
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(path.join(tempDir, workspaceName));
      expect(result.stdout).not.toContain(path.join(tempDir, 'create'));
      expect(result.stdout).toContain('Python engine: Skipped');
      expect(result.stdout).toContain('Git init: No');
      expect(result.stdout).toContain('Python engine setup skipped');
      expect(result.stdout).not.toContain('Poetry virtual environment created');
      expect(fs.existsSync(path.join(tempDir, workspaceName))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);

  it('keeps adopt --dry-run read-only when the global wrapper option consumes the flag', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-adopt-dry-run-'));
    const isolatedHome = path.join(tempDir, 'home');
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'api');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(isolatedHome, { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai-workspace'),
        JSON.stringify({ signature: 'RAPIDKIT_WORKSPACE', name: 'workspace' }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ name: 'api', scripts: { test: 'node --test' } }, null, 2)
      );

      const result = spawnSync(
        process.execPath,
        [dist, 'adopt', projectDir, '--workspace', workspaceDir, '--dry-run', '--json'],
        {
          cwd: workspaceDir,
          encoding: 'utf8',
          env: cliEnv({ HOME: isolatedHome, USERPROFILE: isolatedHome }),
        }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        dryRun: true,
        adoptedProject: { wroteFiles: false },
      });
      expect(fs.existsSync(path.join(projectDir, '.workspai'))).toBe(false);
      expect(fs.existsSync(path.join(isolatedHome, '.workspai', 'workspaces.json'))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);

  it('resolves Doctor workspace scope from an adopted project link', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspai-doctor-adopt-link-'));
    const isolatedHome = path.join(tempDir, 'home');
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(tempDir, 'api');

    try {
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(isolatedHome, { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), 'workspace\n');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'workspace.json'),
        JSON.stringify({ workspace_name: 'workspace', profile: 'minimal' })
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ name: 'api', scripts: { test: 'node --test' } })
      );

      const adopt = spawnSync(
        process.execPath,
        [dist, 'adopt', projectDir, '--workspace', workspaceDir, '--json'],
        {
          cwd: projectDir,
          encoding: 'utf8',
          env: cliEnv({ HOME: isolatedHome, USERPROFILE: isolatedHome }),
        }
      );
      expect(adopt.status).toBe(0);

      const doctor = spawnSync(
        process.execPath,
        [dist, 'doctor', 'workspace', '--json', 'summary'],
        {
          cwd: projectDir,
          encoding: 'utf8',
          env: cliEnv({ HOME: isolatedHome, USERPROFILE: isolatedHome }),
        }
      );

      expect(doctor.stdout).not.toContain('No Workspai workspace found');
      expect(() => JSON.parse(doctor.stdout)).not.toThrow();
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        scope: 'workspace',
        workspace: { name: 'workspace', path: workspaceDir },
      });

      const preview = spawnSync(
        process.execPath,
        [dist, 'adopt', projectDir, '--workspace', workspaceDir, '--dry-run', '--json'],
        {
          cwd: projectDir,
          encoding: 'utf8',
          env: cliEnv({ HOME: isolatedHome, USERPROFILE: isolatedHome }),
        }
      );
      expect(preview.status).toBe(0);
      expect(JSON.parse(preview.stdout)).toMatchObject({
        dryRun: true,
        commandsResolveWorkspaceFromProject: true,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);

  it.each([
    { label: 'without a source argument', sourceArgs: [] },
    { label: 'with the current-directory source', sourceArgs: ['.'] },
  ])(
    'does not provision the managed default workspace during adopt --dry-run $label',
    ({ sourceArgs }) => {
      const dist = ensureDistBuilt();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-adopt-default-dry-run-'));
      const isolatedHome = path.join(tempDir, 'home');
      const projectDir = path.join(tempDir, 'api');

      try {
        fs.mkdirSync(isolatedHome, { recursive: true });
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'api' }));

        const result = spawnSync(
          process.execPath,
          [dist, 'adopt', ...sourceArgs, '--dry-run', '--json'],
          {
            cwd: projectDir,
            encoding: 'utf8',
            env: cliEnv({ HOME: isolatedHome, USERPROFILE: isolatedHome }),
          }
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          workspaceResolution: 'default-auto',
          defaultWorkspaceCreated: false,
          wouldCreateDefaultWorkspace: true,
          dryRun: true,
          adoptedProject: { wroteFiles: false },
        });
        expect(fs.existsSync(path.join(isolatedHome, '.workspai'))).toBe(false);
        expect(fs.existsSync(path.join(projectDir, '.workspai'))).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
    60_000
  );

  it.each([
    { label: 'without a source argument', sourceArgs: [] },
    { label: 'with the current-directory source', sourceArgs: ['.'] },
  ])(
    'adopts the current project into an auto-created managed workspace $label',
    ({ sourceArgs }) => {
      const dist = ensureDistBuilt();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-adopt-current-default-'));
      const isolatedHome = path.join(tempDir, 'home');
      const projectDir = path.join(tempDir, 'api');
      const managedWorkspace = path.join(isolatedHome, '.workspai', 'workspaces', 'workspai');

      try {
        fs.mkdirSync(isolatedHome, { recursive: true });
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'api' }));

        const result = spawnSync(process.execPath, [dist, 'adopt', ...sourceArgs, '--json'], {
          cwd: projectDir,
          encoding: 'utf8',
          env: cliEnv({ HOME: isolatedHome, USERPROFILE: isolatedHome }),
        });

        expect(
          result.status,
          `adopt failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
        ).toBe(0);
        const canonicalProjectDir = fs.realpathSync(projectDir);
        expect(JSON.parse(result.stdout)).toMatchObject({
          workspacePath: managedWorkspace,
          workspaceResolution: 'default-auto',
          defaultWorkspaceCreated: true,
          projectWorkspaceCommand: 'npx workspai project workspace status --json',
          commandsResolveWorkspaceFromProject: true,
          dryRun: false,
          adoptedProject: {
            path: canonicalProjectDir,
            relationship: 'adopted',
            wroteFiles: true,
          },
        });
        expect(fs.existsSync(path.join(projectDir, '.workspai', 'adopt.json'))).toBe(true);
        expect(fs.existsSync(path.join(managedWorkspace, '.workspai-workspace'))).toBe(true);
        expect(
          JSON.parse(
            fs.readFileSync(path.join(managedWorkspace, '.workspai', 'workspace.json'), 'utf8')
          )
        ).toMatchObject({ profile: 'minimal' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
    60_000
  );

  it('lists registered workspaces via workspace list', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-ws-list-'));
    const isolatedHome = path.join(tempDir, 'home');
    const workspaceName = 'ws-list-check';
    const workspaceDir = path.join(isolatedHome, '.workspai', 'workspaces', workspaceName);

    try {
      fs.mkdirSync(isolatedHome, { recursive: true });

      const env = cliEnv({
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
      });

      const createWorkspace = spawnSync(
        process.execPath,
        [dist, 'create', 'workspace', workspaceName, '--yes', '--profile', 'minimal'],
        {
          cwd: tempDir,
          encoding: 'utf8',
          env,
        }
      );
      expect(createWorkspace.status).toBe(0);
      expect(
        fs.existsSync(workspaceDir),
        `workspace was not created at ${workspaceDir}\nstdout:\n${createWorkspace.stdout}\nstderr:\n${createWorkspace.stderr}`
      ).toBe(true);

      const list = spawnSync(process.execPath, [dist, 'workspace', 'list'], {
        cwd: tempDir,
        encoding: 'utf8',
        env,
      });

      expect(list.status).toBe(0);
      const output = `${list.stdout || ''}\n${list.stderr || ''}`;
      expect(output).toContain('Registered Workspai Workspaces');
      expect(output).toContain(workspaceName);
      expect(output).toContain('Total: 1 workspace(s)');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60000);

  it(
    'supports workspace policy set/show for mode, dependency mode, and rules',
    () => {
      const dist = ensureDistBuilt();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-ws-policy-'));
      const workspaceDir = path.join(tempDir, 'my-workspace');

      try {
        fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
        fs.writeFileSync(
          path.join(workspaceDir, '.workspai-workspace'),
          JSON.stringify({ signature: 'RAPIDKIT_WORKSPACE' }, null, 2)
        );
        fs.writeFileSync(
          path.join(workspaceDir, '.workspai', 'policies.yml'),
          [
            'version: "1.0"',
            'mode: warn # "warn" or "strict"',
            'dependency_sharing_mode: isolated # "isolated" or "shared-runtime-caches" or "shared-node-deps"',
            'rules:',
            '  enforce_workspace_marker: true',
            '  enforce_toolchain_lock: false',
            '  disallow_untrusted_tool_sources: false',
            '',
          ].join('\n')
        );

        const setMode = spawnSync(
          process.execPath,
          [dist, 'workspace', 'policy', 'set', 'mode', 'strict'],
          {
            cwd: workspaceDir,
            encoding: 'utf8',
          }
        );
        expect(setMode.status).toBe(0);

        const setDep = spawnSync(
          process.execPath,
          [dist, 'workspace', 'policy', 'set', 'dependency_sharing_mode', 'shared-runtime-caches'],
          {
            cwd: workspaceDir,
            encoding: 'utf8',
          }
        );
        expect(setDep.status).toBe(0);

        const setRule = spawnSync(
          process.execPath,
          [dist, 'workspace', 'policy', 'set', 'rules.enforce_toolchain_lock', 'true'],
          {
            cwd: workspaceDir,
            encoding: 'utf8',
          }
        );
        expect(setRule.status).toBe(0);

        const show = spawnSync(process.execPath, [dist, 'workspace', 'policy', 'show'], {
          cwd: workspaceDir,
          encoding: 'utf8',
        });
        expect(show.status).toBe(0);
        const output = `${show.stdout || ''}\n${show.stderr || ''}`;
        expect(output).toContain('mode: strict');
        expect(output).toContain('dependency_sharing_mode: shared-runtime-caches');
        expect(output).toContain('enforce_toolchain_lock: true');

        const policyContent = fs.readFileSync(
          path.join(workspaceDir, '.workspai', 'policies.yml'),
          'utf-8'
        );
        expect(policyContent).toContain('mode: strict # "warn" or "strict"');
        expect(policyContent).toContain(
          'dependency_sharing_mode: shared-runtime-caches # "isolated" or "shared-runtime-caches" or "shared-node-deps"'
        );
        expect(policyContent).toContain('  enforce_toolchain_lock: true');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
    PROCESS_INTEGRATION_TIMEOUT_MS
  );

  it('rejects workspace policy operations outside a workspace', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-ws-policy-outside-'));

    try {
      const run = spawnSync(process.execPath, [dist, 'workspace', 'policy', 'show'], {
        cwd: tempDir,
        encoding: 'utf8',
      });

      expect(run.status).toBe(1);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).toContain(
        'No Workspai project or workspace could be resolved from the current directory.'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it(
    'syncs nested projects inside a workspace registry entry',
    () => {
      const dist = ensureDistBuilt();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-ws-sync-nested-'));
      const isolatedHome = path.join(tempDir, 'home');
      const workspaceName = 'ws-sync-nested';
      const workspaceDir = path.join(isolatedHome, '.workspai', 'workspaces', workspaceName);
      const nestedProjectDir = path.join(workspaceDir, 'apps', 'orders-api');

      try {
        fs.mkdirSync(isolatedHome, { recursive: true });

        const env = cliEnv({
          HOME: isolatedHome,
          USERPROFILE: isolatedHome,
        });

        const createWorkspace = spawnSync(
          process.execPath,
          [dist, 'create', 'workspace', workspaceName, '--yes', '--profile', 'minimal'],
          {
            cwd: tempDir,
            encoding: 'utf8',
            env,
          }
        );
        expect(createWorkspace.status).toBe(0);

        fs.mkdirSync(path.join(nestedProjectDir, '.workspai'), { recursive: true });
        fs.writeFileSync(
          path.join(nestedProjectDir, '.workspai', 'project.json'),
          JSON.stringify({ runtime: 'java', kit_name: 'springboot.standard' }, null, 2)
        );
        fs.writeFileSync(path.join(nestedProjectDir, 'pom.xml'), '<project />');

        const sync = spawnSync(process.execPath, [dist, 'workspace', 'sync'], {
          cwd: workspaceDir,
          encoding: 'utf8',
          env,
        });
        expect(
          sync.status,
          `workspace sync failed\nstdout:\n${sync.stdout}\nstderr:\n${sync.stderr}`
        ).toBe(0);

        const list = spawnSync(process.execPath, [dist, 'workspace', 'list'], {
          cwd: tempDir,
          encoding: 'utf8',
          env,
        });

        expect(list.status).toBe(0);
        const output = `${list.stdout || ''}\n${list.stderr || ''}`;
        expect(output).toContain(workspaceName);
        expect(output).toContain('Projects: 1');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
    PROCESS_INTEGRATION_TIMEOUT_MS
  );

  it('rejects unknown policy rules and invalid boolean values', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-ws-policy-invalid-'));
    const workspaceDir = path.join(tempDir, 'my-workspace');

    try {
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai-workspace'),
        JSON.stringify({ signature: 'RAPIDKIT_WORKSPACE' }, null, 2)
      );

      const unknownRule = spawnSync(
        process.execPath,
        [dist, 'workspace', 'policy', 'set', 'rules.unknown_rule', 'true'],
        {
          cwd: workspaceDir,
          encoding: 'utf8',
        }
      );
      expect(unknownRule.status).toBe(1);
      expect(`${unknownRule.stdout || ''}\n${unknownRule.stderr || ''}`).toContain(
        'Unknown policy rule'
      );

      const invalidBool = spawnSync(
        process.execPath,
        [dist, 'workspace', 'policy', 'set', 'rules.enforce_toolchain_lock', 'maybe'],
        {
          cwd: workspaceDir,
          encoding: 'utf8',
        }
      );
      expect(invalidBool.status).toBe(1);
      expect(`${invalidBool.stdout || ''}\n${invalidBool.stderr || ''}`).toContain(
        'Rule values must be boolean'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('keeps init at workspace root on wrapper path (no local script delegation)', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-ws-init-'));
    const workspaceDir = path.join(tempDir, 'my-workspace');
    const childProjectDir = path.join(workspaceDir, 'node-app');

    try {
      fs.mkdirSync(path.join(childProjectDir, '.workspai'), { recursive: true });

      fs.writeFileSync(
        path.join(workspaceDir, '.workspai-workspace'),
        JSON.stringify({
          signature: 'RAPIDKIT_WORKSPACE',
          createdBy: 'rapidkit-npm',
          version: '0.0.0-test',
          createdAt: new Date().toISOString(),
          name: 'my-workspace',
          metadata: {
            npm: {
              packageVersion: '0.0.0-test',
              installMethod: 'pip',
            },
          },
        })
      );

      fs.writeFileSync(
        path.join(workspaceDir, 'rapidkit'),
        '#!/usr/bin/env sh\necho delegated-local-script\nexit 99\n'
      );
      fs.chmodSync(path.join(workspaceDir, 'rapidkit'), 0o755);

      fs.writeFileSync(
        path.join(childProjectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2)
      );
      fs.writeFileSync(
        path.join(childProjectDir, 'package.json'),
        JSON.stringify({ name: 'node-app', version: '1.0.0', private: true }, null, 2)
      );

      const run = spawnSync(process.execPath, [dist, 'init'], {
        cwd: workspaceDir,
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
        }),
      });

      expect(run.status).not.toBe(99);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).not.toContain('delegated-local-script');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 20000);

  it('executes setup node successfully when runtime adapters are enabled', () => {
    const dist = ensureDistBuilt();

    const run = spawnSync(process.execPath, [dist, 'setup', 'node'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cliEnv({
        RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
      }),
    });

    expect(run.status).toBe(0);
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    expect(output).toContain('prerequisites look good');
  });

  it('executes setup node successfully when runtime adapters are disabled', () => {
    const dist = ensureDistBuilt();

    const run = spawnSync(process.execPath, [dist, 'setup', 'node'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cliEnv({
        RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '0',
      }),
    });

    expect(run.status).toBe(0);
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    expect(output).toContain('prerequisites look good');
  });

  it('reports the actual dependency warm-up result in setup JSON mode', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-setup-json-warm-'));

    try {
      const run = spawnSync(process.execPath, [dist, 'setup', 'node', '--json', '--warm-deps'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: cliEnv({ RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1' }),
      });

      expect(run.status).toBe(0);
      expect(run.stderr).toBe('');
      expect(JSON.parse(run.stdout)).toMatchObject({
        command: 'setup',
        runtime: 'node',
        result: 'ok',
        warmDeps: true,
        warmDependencies: {
          requested: true,
          status: 'skipped',
          exitCode: 0,
          targets: 1,
          messages: ['Node warm-up skipped: package.json not found in current directory.'],
        },
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('handles cache status command at npm wrapper level', () => {
    const dist = ensureDistBuilt();

    const run = spawnSync(process.execPath, [dist, 'cache', 'status'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cliEnv({
        RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
      }),
    });

    expect(run.status).toBe(0);
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    expect(output).toContain('Workspai cache is enabled');
  });

  it('clears disk cache entries via cache clear command', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-cache-clear-'));
    const cacheDir = path.join(tempDir, 'cache');
    const markerKey = `phase3-cli-marker-${Date.now()}-${Math.random()}`;
    const markerFile = `${createHash('md5').update(markerKey).digest('hex')}.json`;
    const markerPath = path.join(cacheDir, markerFile);

    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        markerPath,
        JSON.stringify({
          data: { ok: true },
          timestamp: Date.now(),
          version: '1.0',
        })
      );
      expect(fs.existsSync(markerPath)).toBe(true);

      const run = spawnSync(process.execPath, [dist, 'cache', 'clear'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
          RAPIDKIT_CACHE_DIR: cacheDir,
        }),
      });

      expect(run.status).toBe(0);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).toContain('Cache clear completed');
      expect(fs.existsSync(markerPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('executes bootstrap for a node project path via init rewrite when adapters are enabled', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-bootstrap-node-'));
    const projectDir = path.join(tempDir, 'node-app');

    try {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'node-app',
            version: '1.0.0',
            private: true,
          },
          null,
          2
        )
      );

      const run = spawnSync(process.execPath, [dist, 'bootstrap', projectDir], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
        }),
      });

      expect(run.status).toBe(0);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).not.toContain('Unknown command: bootstrap');
      expect(output).not.toContain('Runtime adapters are disabled');
      expect(
        ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].some((lockfile) =>
          fs.existsSync(path.join(projectDir, lockfile))
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 40000);

  it('applies dependency policy context across dev/test/build/start lifecycle commands', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-lifecycle-policy-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'node-app');

    try {
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), '{}');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'policies.yml'),
        [
          'version: "1.0"',
          'mode: warn',
          'dependency_sharing_mode: shared-runtime-caches',
          'rules:',
          '  enforce_workspace_marker: true',
          '',
        ].join('\n')
      );

      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'node-app',
            version: '1.0.0',
            private: true,
            scripts: {
              dev: "node -e \"console.log('MODE:' + (process.env.RAPIDKIT_DEP_SHARING_MODE || ''))\"",
              test: "node -e \"console.log('MODE:' + (process.env.RAPIDKIT_DEP_SHARING_MODE || ''))\"",
              build:
                "node -e \"console.log('MODE:' + (process.env.RAPIDKIT_DEP_SHARING_MODE || ''))\"",
              start:
                "node -e \"console.log('MODE:' + (process.env.RAPIDKIT_DEP_SHARING_MODE || ''))\"",
            },
          },
          null,
          2
        )
      );

      for (const command of ['dev', 'test', 'build', 'start']) {
        const run = spawnSync(process.execPath, [dist, command], {
          cwd: projectDir,
          encoding: 'utf8',
          env: cliEnv({
            RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
          }),
        });

        expect(run.status).toBe(0);
        const output = `${run.stdout || ''}\n${run.stderr || ''}`;
        expect(output).toContain('MODE:shared-runtime-caches');
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 40000);

  it('fails fast on invalid dependency_sharing_mode for lifecycle commands', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-lifecycle-policy-invalid-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'node-app');

    try {
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), '{}');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'policies.yml'),
        [
          'version: "1.0"',
          'mode: warn',
          'dependency_sharing_mode: invalid-mode',
          'rules:',
          '  enforce_workspace_marker: true',
          '',
        ].join('\n')
      );

      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'node-app',
            version: '1.0.0',
            private: true,
            scripts: {
              dev: 'node -e "console.log(\'SHOULD_NOT_RUN\')"',
            },
          },
          null,
          2
        )
      );

      const run = spawnSync(process.execPath, [dist, 'dev'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
        }),
      });

      expect(run.status).toBe(1);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).toContain('Invalid dependency_sharing_mode');
      expect(output).not.toContain('SHOULD_NOT_RUN');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 20000);

  it('enforces strict policy preflight for lint/format/docs project commands', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-project-commands-strict-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'node-app');

    try {
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), '{}');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'dependency_sharing_mode: shared-runtime-caches',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: true',
          '',
        ].join('\n')
      );

      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify(
          {
            name: 'node-app',
            version: '1.0.0',
            private: true,
            scripts: {
              lint: 'eslint .',
              format: 'prettier --write .',
              build: 'nest build',
            },
          },
          null,
          2
        )
      );

      for (const command of ['lint', 'format', 'docs']) {
        const run = spawnSync(process.execPath, [dist, command], {
          cwd: projectDir,
          encoding: 'utf8',
          env: cliEnv({
            RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
          }),
        });

        expect(run.status).toBe(1);
        const output = `${run.stdout || ''}\n${run.stderr || ''}`;
        expect(output).toContain('Strict policy violations prevent running this command');
        expect(output).toContain('toolchain.lock is missing');
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 20000);

  it('blocks Java lifecycle commands in strict mode when workspace profile is incompatible', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-java-strict-profile-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'java-app');

    try {
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), '{}');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'dependency_sharing_mode: shared-runtime-caches',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: true',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'workspace.json'),
        JSON.stringify({ profile: 'python-only' }, null, 2)
      );
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'toolchain.lock'),
        JSON.stringify({ runtime: { java: { version: '21.0.7' } } }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'java', kit_name: 'springboot.standard' }, null, 2)
      );
      fs.writeFileSync(path.join(projectDir, 'pom.xml'), '<project />');

      const run = spawnSync(process.execPath, [dist, 'dev'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
        }),
      });

      expect(run.status).toBe(1);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).toContain('Strict policy violations prevent running this command');
      expect(output).toContain(
        'Project "java-app" is Java, but workspace profile is "python-only"'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 20000);

  it('blocks lifecycle commands in strict mode when toolchain.lock is malformed', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-lifecycle-invalid-lock-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'java-app');

    try {
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), '{}');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'dependency_sharing_mode: shared-runtime-caches',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: true',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'workspace.json'),
        JSON.stringify({ profile: 'polyglot' }, null, 2)
      );
      fs.writeFileSync(path.join(workspaceDir, '.workspai', 'toolchain.lock'), '{ invalid json');
      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'java', kit_name: 'springboot.standard' }, null, 2)
      );
      fs.writeFileSync(path.join(projectDir, 'pom.xml'), '<project />');

      const run = spawnSync(process.execPath, [dist, 'dev'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
        }),
      });

      expect(run.status).toBe(1);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).toContain('Strict policy violations prevent running this command');
      expect(output).toContain('toolchain.lock is invalid JSON');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 20000);

  it('blocks delegated project commands in strict mode when toolchain.lock is malformed', () => {
    const dist = ensureDistBuilt();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapidkit-delegation-invalid-lock-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'node-app');

    try {
      fs.mkdirSync(path.join(projectDir, '.workspai'), { recursive: true });
      fs.mkdirSync(path.join(workspaceDir, '.workspai'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, '.workspai-workspace'), '{}');
      fs.writeFileSync(
        path.join(workspaceDir, '.workspai', 'policies.yml'),
        [
          'version: "1.0"',
          'mode: strict',
          'dependency_sharing_mode: shared-runtime-caches',
          'rules:',
          '  enforce_workspace_marker: true',
          '  enforce_toolchain_lock: true',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(projectDir, '.workspai', 'project.json'),
        JSON.stringify({ runtime: 'node', kit_name: 'nestjs.standard' }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'node-app',
          scripts: {
            lint: 'eslint .',
            format: 'prettier --write .',
            build: 'nest build',
          },
        })
      );
      fs.writeFileSync(path.join(workspaceDir, '.workspai', 'toolchain.lock'), '{ invalid json');

      const run = spawnSync(process.execPath, [dist, 'lint'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: cliEnv({
          RAPIDKIT_ENABLE_RUNTIME_ADAPTERS: '1',
        }),
      });

      expect(run.status).toBe(1);
      const output = `${run.stdout || ''}\n${run.stderr || ''}`;
      expect(output).toContain('Strict policy violations prevent running this command');
      expect(output).toContain('toolchain.lock is invalid JSON');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 20000);
});
