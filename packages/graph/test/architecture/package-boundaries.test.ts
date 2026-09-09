import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(packageRoot, 'src');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(candidate)
      : entry.isFile() && entry.name.endsWith('.ts')
        ? [candidate]
        : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map((match) => match[2]);
}

describe('Graph architecture boundaries', () => {
  it('keeps independent publication blocked by two manifest guards', () => {
    const packageManifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
    ) as {
      private?: boolean;
      scripts?: Record<string, string>;
    };

    expect(packageManifest.private).toBe(true);
    expect(packageManifest.scripts?.prepublishOnly).toBe('node scripts/refuse-publish.mjs');
  });

  it('never imports the central CLI or consumer frameworks', () => {
    const forbidden = [
      /packages\/cli/,
      /(?:^|\/)workspace-model/,
      /^workspai(?:\/|$)/,
      /^@workspai\/(?:model|doctor|context|skills|agents|mcp|cli)(?:\/|$)/,
      /^commander$/,
      /^vscode$/,
    ];

    for (const file of sourceFiles(sourceRoot)) {
      for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
        expect(
          forbidden.some((pattern) => pattern.test(specifier)),
          `${path.relative(packageRoot, file)} imports forbidden ${specifier}`
        ).toBe(false);
      }
    }
  });

  it('consumes Shared only through declared public subpaths', () => {
    const allowed = new Set([
      '@workspai/shared/contracts',
      '@workspai/shared/compatibility',
      '@workspai/shared/validation',
      '@workspai/shared/registry',
    ]);
    const exercised = new Set<string>();

    for (const root of [sourceRoot, path.join(packageRoot, 'test')]) {
      for (const file of sourceFiles(root)) {
        for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
          if (specifier === '@workspai/shared') {
            throw new Error(`${path.relative(packageRoot, file)} imports ambiguous Shared root`);
          }
          if (specifier.startsWith('@workspai/shared/')) {
            exercised.add(specifier);
            expect(allowed.has(specifier), `${specifier} is not an admitted Shared subpath`).toBe(
              true
            );
          }
        }
      }
    }

    expect(exercised).toEqual(
      new Set([
        '@workspai/shared/contracts',
        '@workspai/shared/compatibility',
        '@workspai/shared/validation',
        '@workspai/shared/registry',
      ])
    );
  });

  it('keeps contracts and the domain kernel free of infrastructure imports', () => {
    const protectedRoots = [path.join(sourceRoot, 'contracts'), path.join(sourceRoot, 'domain')];
    const infrastructure = [/^node:/, /^fs(?:\/|$)/, /^path$/, /^execa$/, /^child_process$/];

    for (const root of protectedRoots) {
      for (const file of sourceFiles(root)) {
        for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
          expect(
            infrastructure.some((pattern) => pattern.test(specifier)),
            `${path.relative(packageRoot, file)} imports infrastructure ${specifier}`
          ).toBe(false);
        }
      }
    }
  });

  it('enforces inward-only package layer dependencies', () => {
    const forbiddenByLayer = new Map<string, RegExp[]>([
      [
        'contracts',
        [
          /(?:^|\/)domain(?:\/|$)/,
          /(?:^|\/)application(?:\/|$)/,
          /(?:^|\/)ports(?:\/|$)/,
          /(?:^|\/)adapters(?:\/|$)/,
          /(?:^|\/)providers(?:\/|$)/,
          /(?:^|\/)projections(?:\/|$)/,
        ],
      ],
      [
        'domain',
        [
          /(?:^|\/)application(?:\/|$)/,
          /(?:^|\/)ports(?:\/|$)/,
          /(?:^|\/)adapters(?:\/|$)/,
          /(?:^|\/)providers(?:\/|$)/,
          /(?:^|\/)projections(?:\/|$)/,
          /(?:^|\/)testing(?:\/|$)/,
        ],
      ],
      [
        'application',
        [
          /(?:^|\/)adapters(?:\/|$)/,
          /(?:^|\/)providers(?:\/|$)/,
          /(?:^|\/)projections(?:\/|$)/,
          /(?:^|\/)testing(?:\/|$)/,
        ],
      ],
      [
        'ports',
        [
          /(?:^|\/)adapters(?:\/|$)/,
          /(?:^|\/)providers(?:\/|$)/,
          /(?:^|\/)projections(?:\/|$)/,
          /(?:^|\/)testing(?:\/|$)/,
        ],
      ],
    ]);

    for (const [layer, forbidden] of forbiddenByLayer) {
      for (const file of sourceFiles(path.join(sourceRoot, layer))) {
        for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
          expect(
            forbidden.some((pattern) => pattern.test(specifier)),
            `${path.relative(packageRoot, file)} violates ${layer} dependency direction via ${specifier}`
          ).toBe(false);
        }
      }
    }
  });

  it('exposes the host-neutral repository build without leaking adapters or later stages', () => {
    const rootApi = fs.readFileSync(path.join(sourceRoot, 'index.ts'), 'utf8');

    expect(rootApi).not.toMatch(/adapters|internal|testing/);
    expect(rootApi).toMatch(/buildRepoGraph/);
    expect(rootApi).not.toMatch(/buildWorkspaceGraph/);
  });
});
