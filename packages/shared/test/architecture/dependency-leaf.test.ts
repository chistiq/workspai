import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WORKSPAI_SHARED_PACKAGE, defineWisContract } from '../../src/index.js';
import { WORKSPAI_SHARED_RUNTIME as browserRuntime } from '../../src/browser.js';
import { WORKSPAI_SHARED_RUNTIME as nodeRuntime } from '../../src/node.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('@workspai/shared protocol foundation', () => {
  it('is explicitly unavailable for publication during contract design', () => {
    expect(WORKSPAI_SHARED_PACKAGE).toEqual({
      name: '@workspai/shared',
      maturity: 'protocol-foundation',
      publishable: false,
    });

    const packageManifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
    ) as {
      private?: boolean;
      scripts?: Record<string, string>;
    };
    expect(packageManifest.private).toBe(true);
    expect(packageManifest.scripts?.prepublishOnly).toBe('node scripts/refuse-publish.mjs');
  });

  it('defines immutable contract references without domain behavior', () => {
    const contract = defineWisContract({ id: 'wis.core.result', version: '0.2.0-draft' });

    expect(contract).toEqual({ id: 'wis.core.result', version: '0.2.0-draft' });
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('keeps the browser surface free of Node and CLI adapter imports', () => {
    const browserSource = fs.readFileSync(path.join(packageRoot, 'src/browser.ts'), 'utf8');
    const nodeSource = fs.readFileSync(path.join(packageRoot, 'src/node.ts'), 'utf8');

    expect(browserSource).not.toMatch(/node:|cli\//u);
    expect(browserSource).toContain('./validation/index.js');
    expect(nodeSource).toContain('./index.js');
    expect(browserRuntime).toBe('browser-neutral');
    expect(nodeRuntime).toBe('node');
  });
});
