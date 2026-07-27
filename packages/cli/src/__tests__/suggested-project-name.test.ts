import { describe, expect, it } from 'vitest';

import { resolveFrontendGenerator } from '../frontend-project.js';
import { suggestProjectNameForKit } from '../utils/suggested-project-name.js';

describe('suggested-project-name', () => {
  it('suggests stack-aware names with a theme suffix', () => {
    expect(suggestProjectNameForKit('fastapi.standard')).toMatch(/^[a-z]+-api$/);
    expect(suggestProjectNameForKit('frontend.nextjs')).toMatch(/^[a-z]+-web$/);
    expect(suggestProjectNameForKit('springboot.standard')).toMatch(/^[a-z]+-service$/);
    expect(suggestProjectNameForKit('frontend.astro')).toMatch(/^[a-z]+-site$/);
  });
});

describe('frontend generator commands', () => {
  it('uses current official non-interactive create commands', () => {
    const remix = resolveFrontendGenerator('frontend.remix');
    expect(remix?.displayName).toBe('React Router');
    expect(remix?.commandExec('demo-app', { skipGit: false, skipInstall: true })).toEqual({
      command: 'npx',
      args: [
        '--yes',
        'create-react-router@latest',
        'demo-app',
        '--yes',
        '--no-install',
        '--no-git-init',
      ],
    });
    expect(remix?.commandExec('demo-app', { skipGit: true, skipInstall: true }).args).toContain(
      '--no-git-init'
    );

    const angular = resolveFrontendGenerator('frontend.angular');
    expect(angular?.commandExec('demo-app', { skipGit: false, skipInstall: true })).toEqual({
      command: 'npx',
      args: [
        '--yes',
        '@angular/cli@latest',
        'new',
        'demo-app',
        '--defaults',
        '--skip-git',
        '--skip-install',
      ],
    });

    const viteReact = resolveFrontendGenerator('frontend.vite-react');
    expect(viteReact?.commandExec('demo-app', { skipGit: true, skipInstall: true })).toEqual({
      command: 'npm',
      args: [
        'create',
        'vite@latest',
        'demo-app',
        '--',
        '--template',
        'react-ts',
        '--no-interactive',
      ],
    });

    const sveltekit = resolveFrontendGenerator('frontend.sveltekit');
    expect(sveltekit?.commandExec('demo-app', { skipGit: true, skipInstall: true })).toEqual({
      command: 'npx',
      args: [
        '--yes',
        'sv@latest',
        'create',
        'demo-app',
        '--template',
        'minimal',
        '--types',
        'ts',
        '--no-add-ons',
        '--no-install',
      ],
    });

    const nuxt = resolveFrontendGenerator('frontend.nuxt');
    expect(nuxt?.commandExec('demo-app', { skipGit: true, skipInstall: true })).toEqual({
      command: 'npx',
      args: [
        '--yes',
        'create-nuxt@latest',
        'demo-app',
        '--template',
        'minimal',
        '--packageManager',
        'npm',
        '--gitInit',
        'false',
        '--no-install',
      ],
    });

    const astro = resolveFrontendGenerator('frontend.astro');
    expect(astro?.commandExec('demo-app', { skipGit: true, skipInstall: true })).toEqual({
      command: 'npm',
      args: ['create', 'astro@latest', 'demo-app', '--', '--yes', '--no-install', '--no-git'],
    });
  });
});
