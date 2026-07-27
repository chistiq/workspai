import { describe, expect, it } from 'vitest';

import {
  buildRuntimeCommandSupport,
  getFrameworkSupportTier,
  getRuntimeSupport,
  isLifecycleCommandSupportedForRuntime,
} from '../utils/support-matrix';

describe('support matrix', () => {
  it('keeps python runtime first-class and node runtime extended', () => {
    expect(getRuntimeSupport('python').tier).toBe('first-class');
    expect(getRuntimeSupport('python').moduleCommands).toBe(true);
    expect(getRuntimeSupport('node').tier).toBe('extended');
    expect(getRuntimeSupport('node').moduleCommands).toBe(true);
    expect(getFrameworkSupportTier('nextjs')).toBe('extended');
  });

  it('classifies current first-class and extended frameworks explicitly', () => {
    expect(getFrameworkSupportTier('fastapi')).toBe('first-class');
    expect(getFrameworkSupportTier('nestjs')).toBe('first-class');
    expect(getFrameworkSupportTier('gofiber')).toBe('extended');
    expect(getFrameworkSupportTier('gogin')).toBe('extended');
    expect(getFrameworkSupportTier('springboot')).toBe('extended');
    expect(getFrameworkSupportTier('dotnet')).toBe('extended');
    expect(getFrameworkSupportTier('laravel')).toBe('extended');
    expect(getFrameworkSupportTier('unknown')).toBe('observed');
  });

  it('keeps Go, Java, and .NET lifecycle-ready without module mutation support', () => {
    for (const runtime of ['go', 'java', 'dotnet']) {
      const support = getRuntimeSupport(runtime);
      const commands = buildRuntimeCommandSupport({ runtime, moduleSupport: false });

      expect(support.tier).toBe('extended');
      expect(support.importSupport).toBe(true);
      expect(support.scaffoldSupport).toBe(true);
      expect(support.moduleCommands).toBe(false);
      expect(commands.moduleCommands).toBe(false);
      expect(commands.lifecycleCommands).toEqual([
        'init',
        'dev',
        'start',
        'build',
        'test',
        'lint',
        'format',
        'help',
      ]);
      expect(commands.unsupportedLifecycleCommands).toEqual([]);
    }
  });

  it('keeps observed runtimes import-safe but lifecycle-limited', () => {
    for (const runtime of [
      'php',
      'ruby',
      'rust',
      'elixir',
      'clojure',
      'scala',
      'kotlin',
      'deno',
      'bun',
      'c',
      'cpp',
    ]) {
      const support = getRuntimeSupport(runtime);
      const commands = buildRuntimeCommandSupport({ runtime, moduleSupport: false });

      expect(support.tier).toBe('observed');
      expect(support.importSupport).toBe(true);
      expect(isLifecycleCommandSupportedForRuntime(runtime, 'dev')).toBe(false);
      expect(commands.lifecycleCommands).toEqual(['help']);
      expect(commands.unsupportedLifecycleCommands).toContain('dev');
    }
  });
});
