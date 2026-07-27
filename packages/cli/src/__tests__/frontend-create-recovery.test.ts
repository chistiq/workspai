import { describe, expect, it } from 'vitest';

import { resolveFrontendGenerator } from '../frontend-project.js';

describe('frontend scaffold generator hardening', () => {
  it('keeps react-router generator non-interactive and git-safe by default', () => {
    const remix = resolveFrontendGenerator('frontend.remix');
    expect(remix?.commandExec('atlas-app', { skipGit: false, skipInstall: false }).args).toEqual([
      '--yes',
      'create-react-router@latest',
      'atlas-app',
      '--yes',
      '--install',
      '--no-git-init',
    ]);
  });

  it('requests the latest stable Angular CLI and lets its engine contract guard compatibility', () => {
    const angular = resolveFrontendGenerator('frontend.angular');
    expect(angular?.commandExec('trail-app', { skipGit: false, skipInstall: false }).args).toEqual([
      '--yes',
      '@angular/cli@latest',
      'new',
      'trail-app',
      '--defaults',
      '--skip-git',
    ]);
  });
});
