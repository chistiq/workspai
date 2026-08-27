import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_CORE_COMMANDS_SET } from '../core-bridge/bootstrapCoreCommands.js';
import {
  NPM_ORCHESTRATED_CORE_ADVERTISED_COMMANDS,
  WRAPPER_SHARED_CLI_FLAGS,
  isCoreDelegatedTopLevelCommand,
  isPythonCoreContextEngine,
  shouldBridgeInvocationToCore,
} from '../core-bridge/coreForwarding.js';

describe('coreForwarding', () => {
  it('recognizes Python core context engines', () => {
    expect(isPythonCoreContextEngine('pip')).toBe(true);
    expect(isPythonCoreContextEngine('poetry')).toBe(true);
    expect(isPythonCoreContextEngine('venv')).toBe(true);
    expect(isPythonCoreContextEngine('pipx')).toBe(true);
    expect(isPythonCoreContextEngine('python')).toBe(true);
    expect(isPythonCoreContextEngine('npm')).toBe(false);
    expect(isPythonCoreContextEngine(undefined)).toBe(false);
  });

  it('treats bootstrap core commands as delegated except npm-orchestrated create', () => {
    for (const command of BOOTSTRAP_CORE_COMMANDS_SET) {
      const expected = !NPM_ORCHESTRATED_CORE_ADVERTISED_COMMANDS.has(command);
      expect(isCoreDelegatedTopLevelCommand(command, null)).toBe(expected);
    }
  });

  it('uses cached core command discovery when bootstrap metadata is stale', () => {
    const cached = new Set(['future-core-command']);
    expect(isCoreDelegatedTopLevelCommand('future-core-command', cached)).toBe(true);
    expect(isCoreDelegatedTopLevelCommand('bootstrap', cached)).toBe(false);
  });

  it('documents wrapper-shared flags used by both npm create UX and core commands', () => {
    expect(WRAPPER_SHARED_CLI_FLAGS.has('--dry-run')).toBe(true);
    expect(WRAPPER_SHARED_CLI_FLAGS.has('--yes')).toBe(true);
  });

  it('bridges module lifecycle invocations but not bare workspace dry-run names', () => {
    expect(
      shouldBridgeInvocationToCore(['rollback', 'module', 'free/ai/llm_gateway', '--dry-run'])
    ).toBe(true);
    expect(
      shouldBridgeInvocationToCore(['uninstall', 'module', 'free/ai/llm_gateway', '--dry-run'])
    ).toBe(true);
    expect(shouldBridgeInvocationToCore(['my-workspace', '--dry-run'])).toBe(false);
    expect(shouldBridgeInvocationToCore(['create', 'workspace', 'my-workspace', '--dry-run'])).toBe(
      false
    );
  });
});

describe('shouldForwardToCore module lifecycle dry-run boundary', () => {
  it('keeps positional version requests on the npm wrapper', async () => {
    const index = await import('../index.js');

    await expect(index.shouldForwardToCore(['version'])).resolves.toBe(false);
    await expect(index.shouldForwardToCore(['version', '--json'])).resolves.toBe(false);
  });

  it('forwards core module lifecycle commands even with --dry-run', async () => {
    const index = await import('../index.js');

    await expect(
      index.shouldForwardToCore(['rollback', 'module', 'free/ai/llm_gateway', '--dry-run'])
    ).resolves.toBe(true);
    await expect(
      index.shouldForwardToCore(['uninstall', 'module', 'free/ai/llm_gateway', '--dry-run'])
    ).resolves.toBe(true);
    await expect(
      index.shouldForwardToCore(['upgrade', 'module', 'free/ai/llm_gateway', '--dry-run'])
    ).resolves.toBe(true);
    await expect(
      index.shouldForwardToCore(['diff', 'module', 'free/ai/llm_gateway', '--patch'])
    ).resolves.toBe(true);
    await expect(
      index.shouldForwardToCore(['checkpoint', 'module', 'free/ai/llm_gateway'])
    ).resolves.toBe(true);
  });

  it('keeps workspace create dry-run invocations on the npm wrapper', async () => {
    const index = await import('../index.js');

    await expect(index.shouldForwardToCore(['my-workspace', '--dry-run'])).resolves.toBe(false);
    await expect(
      index.shouldForwardToCore(['create', 'workspace', 'my-workspace', '--dry-run'])
    ).resolves.toBe(false);
    await expect(
      index.shouldForwardToCore(['create', 'project', 'fastapi.standard', 'api', '--dry-run'])
    ).resolves.toBe(false);
  });
});
