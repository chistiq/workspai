import { describe, expect, it } from 'vitest';

import { isPythonVirtualEnvironmentDirectory } from '../utils/workspace-scan-policy.js';

describe('workspace scan policy', () => {
  it('excludes active and renamed Python virtual environments without hiding authored projects', () => {
    expect(isPythonVirtualEnvironmentDirectory('.venv')).toBe(true);
    expect(isPythonVirtualEnvironmentDirectory('.venv.broken')).toBe(true);
    expect(isPythonVirtualEnvironmentDirectory('.venv-backup')).toBe(true);
    expect(isPythonVirtualEnvironmentDirectory('.venv_recovery')).toBe(true);
    expect(isPythonVirtualEnvironmentDirectory('venv')).toBe(true);

    expect(isPythonVirtualEnvironmentDirectory('venv-tools')).toBe(false);
    expect(isPythonVirtualEnvironmentDirectory('.venvtools')).toBe(false);
    expect(isPythonVirtualEnvironmentDirectory('environment')).toBe(false);
  });
});
