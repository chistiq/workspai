import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('npm publish contract', () => {
  const monorepoRoot = path.resolve(process.cwd(), '../..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  ) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
    description?: string;
    files?: string[];
    keywords?: string[];
    repository?: {
      url?: string;
    };
    author?: string;
    homepage?: string;
    bugs?: {
      url?: string;
    };
    scripts?: Record<string, string>;
  };

  function isPublishedByFiles(assetPath: string): boolean {
    const matches = (entry: string): boolean => {
      const normalizedEntry = entry.replace(/\/$/, '');
      if (!normalizedEntry.includes('*')) {
        return assetPath === normalizedEntry || assetPath.startsWith(`${normalizedEntry}/`);
      }
      const expression = normalizedEntry
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('*', '.*')
        .replaceAll('?', '.');
      return new RegExp(`^${expression}$`).test(assetPath);
    };
    const entries = packageJson.files ?? [];
    if (entries.some((entry) => entry.startsWith('!') && matches(entry.slice(1)))) {
      return false;
    }
    return entries.some((entry) => !entry.startsWith('!') && matches(entry));
  }

  const enterpriseSmokeScript = 'scripts/enterprise-package-smoke.mjs';
  const enterprisePrepackScript = 'scripts/prepack-enterprise.mjs';

  it('keeps the short wspai npm alias package aligned with workspai', () => {
    const aliasPackage = JSON.parse(
      fs.readFileSync(path.join(monorepoRoot, 'packages/wspai/package.json'), 'utf8')
    ) as {
      name?: string;
      version?: string;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      private?: boolean;
      author?: string;
      homepage?: string;
      bugs?: {
        url?: string;
      };
    };

    expect(aliasPackage.private).toBeUndefined();
    expect(aliasPackage.name).toBe('wspai');
    expect(aliasPackage.version).toBe(packageJson.version);
    expect(aliasPackage.dependencies?.workspai).toBe(packageJson.version);
    expect(aliasPackage.bin?.wspai).toBe('bin/wspai.js');
    expect(aliasPackage.author).toBe('Chistiq');
    expect(aliasPackage.homepage).toBe('https://www.workspai.com/');
    expect(aliasPackage.bugs?.url).toBe('https://github.com/chistiq/workspai/issues');
  });

  it('publishes Workspai CLI as the unscoped npm package', () => {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(monorepoRoot, 'package.json'), 'utf8')
    ) as {
      private?: boolean;
      workspaces?: string[];
      scripts?: Record<string, string>;
    };

    expect(rootPackage.private).toBe(true);
    expect(rootPackage.workspaces).toEqual(['packages/cli', 'packages/wspai']);
    expect(rootPackage.workspaces).not.toContain('packages/*');
    expect(rootPackage.workspaces).not.toContain('packages/graph');
    expect(rootPackage.workspaces).not.toContain('packages/shared');
    expect(rootPackage.scripts?.postinstall).toBe('node scripts/check-cross-platform-lockfile.mjs');
    expect(rootPackage.scripts?.['prepush:check']).toContain('run check:cross-platform-lockfile');

    const lockfileGuard = fs.readFileSync(
      path.join(monorepoRoot, 'scripts/check-cross-platform-lockfile.mjs'),
      'utf8'
    );
    expect(lockfileGuard).toContain('packageName: "rolldown"');
    expect(lockfileGuard).toContain('packageName: "rollup"');
    expect(lockfileGuard).toContain('packageName: "esbuild"');
    expect(lockfileGuard).toContain('bindingPrefix: "@rolldown/binding-"');
    expect(lockfileGuard).toContain('Restore package-lock.json from Git');
    expect(rootPackage.scripts?.['install:local']).toContain('--workspace workspai link');
    expect(rootPackage.scripts?.['install:local']).toContain('--workspace wspai link');
    expect(rootPackage.scripts?.['uninstall:local']).toContain('unlink -g workspai');
    expect(rootPackage.scripts?.['uninstall:local']).toContain('unlink -g wspai');
    expect(packageJson.name).toBe('workspai');
    expect(packageJson.bin?.workspai).toBe('dist/index.js');
    expect(packageJson.bin?.rapidkit).toBeUndefined();
    expect(packageJson.bin?.['rapidkit-npm']).toBeUndefined();
  });

  it('keeps CLI presentation dynamic for workspai and rapidkit invocations', () => {
    const indexSource = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf8');
    const brandSource = fs.readFileSync(path.join(process.cwd(), 'src/cli-ui/brand.ts'), 'utf8');

    expect(indexSource).toContain('resolveInvokedCliName');
    expect(indexSource).toContain("const primaryCliName = 'workspai'");
    expect(indexSource).toContain('primaryNpxCommand');
    expect(indexSource).toContain(
      'text.replace(/\\bnpx (?:rapidkit|workspai)\\b/g, primaryNpxCommand)'
    );
    expect(brandSource).toContain("rk.white('Workspai')");
    expect(brandSource).not.toContain('RapidKit');
  });

  it('keeps rapidkit compatibility outside the Workspai monorepo package', () => {
    expect(fs.existsSync(path.join(monorepoRoot, 'legacy/rapidkit/package.json'))).toBe(false);
    expect(packageJson.files).not.toContain('scripts/sync-legacy-rapidkit-package.mjs');
    expect(packageJson.scripts?.['sync:legacy-rapidkit']).toBeUndefined();
  });

  it('keeps npm package metadata aligned with Workspace Intelligence positioning', () => {
    expect(packageJson.description).toBe(
      'Open-source workspace intelligence CLI for software systems: create, adopt, govern, verify, and align polyglot workspaces for humans, CI, IDEs, and AI agents.'
    );
    expect(packageJson.description?.length).toBeLessThanOrEqual(160);
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining(['workspace-intelligence', 'governance', 'workspai'])
    );
  });

  it('builds and verifies dist before npm pack or publish', () => {
    expect(packageJson.scripts?.prepack).toBe(`node ${enterprisePrepackScript}`);
    expect(packageJson.scripts?.['smoke:enterprise-package']).toBe(`node ${enterpriseSmokeScript}`);

    const prepack = fs.readFileSync(path.join(process.cwd(), enterprisePrepackScript), 'utf8');
    expect(prepack).toContain("'..', '..', 'node_modules', 'tsup', 'dist', 'cli-default.js'");
    expect(prepack).toContain('scripts/prepare-mock-embeddings.mjs');
    expect(prepack).toContain("['scripts/generate-shared-contracts.mjs', '--check']");
    expect(prepack).not.toContain('sync-legacy-rapidkit-package');
    expect(prepack).toContain('scripts/verify-package-cli.mjs');
    expect(prepack).toContain(enterpriseSmokeScript);

    const smoke = fs.readFileSync(path.join(process.cwd(), enterpriseSmokeScript), 'utf8');
    expect(smoke).toContain('REQUIRED_PACKAGE_FILES');
    expect(smoke).toContain('assertPackageFilesPolicy(missingRequired)');
    expect(smoke).toContain('ignored generated asset');
  });

  it('keeps npm-only contributor enforcement out of consumer install lifecycles', () => {
    expect(packageJson.scripts?.preinstall).toBeUndefined();
    expect(packageJson.scripts?.['check:package-manager']).toBe(
      'node scripts/enforce-package-manager.cjs'
    );
    expect(packageJson.scripts?.validate).toContain('run check:package-manager');
    expect(packageJson.scripts?.quality).toContain('run check:package-manager');

    const policyScript = path.join(process.cwd(), 'scripts/enforce-package-manager.cjs');
    for (const [userAgent, expectedStatus] of [
      ['npm/10.8.2 node/v20.19.0 linux x64 workspaces/false', 0],
      ['yarn/1.22.22 npm/? node/v20.19.0 linux x64', 1],
      ['pnpm/9.15.0 npm/? node/v20.19.0 linux x64', 1],
    ] as const) {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_user_agent')
      );
      const result = spawnSync(process.execPath, [policyScript], {
        env: { ...env, npm_config_user_agent: userAgent },
      });
      expect(result.status, userAgent).toBe(expectedStatus);
    }
  });

  it('locks native test-runner bindings for every supported CI platform', () => {
    const packageLock = JSON.parse(
      fs.readFileSync(path.join(monorepoRoot, 'package-lock.json'), 'utf8')
    ) as {
      packages?: Record<string, { version?: string; optional?: boolean }>;
    };
    const lockedPackages = packageLock.packages ?? {};
    const requiredBindings = [
      '@rolldown/binding-linux-x64-gnu',
      '@rolldown/binding-darwin-arm64',
      '@rolldown/binding-darwin-x64',
      '@rolldown/binding-win32-x64-msvc',
    ];

    for (const binding of requiredBindings) {
      const entry = lockedPackages[`node_modules/${binding}`];
      expect(entry, `${binding} must remain represented in package-lock.json`).toBeDefined();
      expect(entry?.version).toMatch(/^1\./);
      expect(entry?.optional).toBe(true);
    }
  });

  it('builds dist once before Vitest instead of rebuilding in test workers', () => {
    expect(packageJson.scripts?.['test:prebuild']).toBe('tsup');
    expect(packageJson.scripts?.test).toBe('corepack npm run test:prebuild && vitest run');

    const distHelper = fs.readFileSync(
      path.join(process.cwd(), 'src/__tests__/helpers/dist.ts'),
      'utf8'
    );
    expect(distHelper).not.toContain('spawnSync');
    expect(distHelper).not.toContain('sourcePaths');
    expect(distHelper).not.toContain('BUILD_LOCK_PATH');
  });

  it('keeps package security gates runnable in Corepack-only environments', () => {
    expect(packageJson.scripts?.security).toBe('corepack npm audit --audit-level=moderate');
    expect(packageJson.scripts?.['security:fix']).toBe('corepack npm audit fix');
    expect(packageJson.scripts?.quality).toContain('corepack npm run security');
  });

  it('ships and runs a Windows CLI resolution guard on install', () => {
    expect(packageJson.files).toContain('scripts/check-cli-resolution.cjs');
    expect(packageJson.scripts?.postinstall).toBe('node scripts/check-cli-resolution.cjs');
  });

  it('publishes enterprise-critical runtime assets used by create and AI surfaces', () => {
    for (const assetPath of [
      'templates/kits/fastapi-standard/README.md.j2',
      'templates/kits/fastapi-standard/env.example.j2',
      'templates/kits/fastapi-ddd/README.md.j2',
      'templates/kits/fastapi-ddd/env.example.j2',
      'templates/kits/nestjs-standard/package.json.j2',
      'templates/kits/nestjs-standard/env.example.j2',
      'data/modules-embeddings.json',
      'workspai.config.example.cjs',
      'rapidkit.config.example.cjs',
      enterpriseSmokeScript,
      enterprisePrepackScript,
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), assetPath)), assetPath).toBe(true);
      expect(isPublishedByFiles(assetPath), assetPath).toBe(true);
    }
  });

  it('runs enterprise package smoke in CI and release gates', () => {
    const ciWorkflow = fs.readFileSync(path.join(monorepoRoot, '.github/workflows/ci.yml'), 'utf8');
    const releaseWorkflow = fs.readFileSync(
      path.join(monorepoRoot, '.github/workflows/release-npm-manual.yml'),
      'utf8'
    );
    const securityWorkflow = fs.readFileSync(
      path.join(monorepoRoot, '.github/workflows/security.yml'),
      'utf8'
    );

    expect(ciWorkflow).toContain('npm --workspace workspai run smoke:enterprise-package');
    expect(releaseWorkflow).not.toContain('publish_legacy_rapidkit');
    expect(releaseWorkflow).not.toContain('sync:legacy-rapidkit');
    expect(releaseWorkflow).toContain('working-directory: packages/cli');
    expect(releaseWorkflow).toContain('npm publish workspai');
    expect(releaseWorkflow).toContain('npm publish wspai');
    expect(releaseWorkflow).toContain('is available for publish');
    expect(releaseWorkflow).toContain('is already published on npm; skipping publish');
    expect(releaseWorkflow).toContain('package_already_published');
    expect(releaseWorkflow).toContain('alias_already_published');
    expect(releaseWorkflow).toContain('npm --workspace workspai run smoke:enterprise-package');
    expect(releaseWorkflow).toContain('npm --workspace wspai run smoke');
    expect(releaseWorkflow).toContain('npm --workspace workspai run test:prepare-embeddings');
    expect(securityWorkflow).toContain('npm audit --audit-level=high');
  });

  it('keeps the local release script signed and alias-aware', () => {
    const releaseScript = fs.readFileSync(path.join(process.cwd(), 'scripts/release.sh'), 'utf8');

    expect(releaseScript).toContain('git commit -S -m "chore(release): $TAG"');
    expect(releaseScript).toContain('git tag -s "$TAG" -m "Release $TAG"');
    expect(releaseScript).toContain('--workspace workspai version "$VERSION"');
    expect(releaseScript).toContain('--workspace wspai version "$VERSION"');
    expect(releaseScript).toContain('pkg.dependencies.workspai=process.argv[1]');
    expect(releaseScript).toContain('publish --dry-run --access public --workspace workspai');
    expect(releaseScript).toContain('publish --dry-run --access public --workspace wspai');
    expect(releaseScript).toContain('publish --access public --workspace workspai');
    expect(releaseScript).toContain('publish --access public --workspace wspai');

    const bump = releaseScript.indexOf('version "$BUMP" --no-git-tag-version');
    const generate = releaseScript.indexOf('run generate:contracts');
    const validate = releaseScript.indexOf('run validate');
    const dryRun = releaseScript.indexOf('publish --dry-run --access public --workspace workspai');
    const commit = releaseScript.indexOf('git commit -S -m "chore(release): $TAG"');
    expect(bump).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(bump);
    expect(validate).toBeGreaterThan(generate);
    expect(dryRun).toBeGreaterThan(validate);
    expect(commit).toBeGreaterThan(dryRun);
  });

  it('keeps README image assets resolvable from npm-safe raw GitHub URLs', () => {
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
    const rawImageUrls = [
      ...readme.matchAll(/!\[[^\]]+\]\((https:\/\/raw\.githubusercontent\.com\/[^)]+)\)/g),
    ].map((match) => match[1]);

    expect(rawImageUrls).toContain(
      'https://raw.githubusercontent.com/chistiq/workspai/main/packages/cli/docs/From%20Code%20to%20Shared%20Understanding.png'
    );
    expect(packageJson.repository?.url).toBe('git+https://github.com/chistiq/workspai.git');
    expect(packageJson.author).toBe('Chistiq');
    expect(packageJson.homepage).toBe('https://www.workspai.com/');
    expect(packageJson.bugs?.url).toBe('https://github.com/chistiq/workspai/issues');

    for (const imageUrl of rawImageUrls) {
      const pathname = new URL(imageUrl).pathname;
      const match = pathname.match(/^\/chistiq\/workspai\/main\/packages\/cli\/(.+)$/);
      expect(match, imageUrl).not.toBeNull();

      const encodedAssetPath = match?.[1] ?? '';
      const assetPath = decodeURIComponent(encodedAssetPath);

      expect(fs.existsSync(path.join(process.cwd(), assetPath)), assetPath).toBe(true);
      if (assetPath.endsWith('.gif')) {
        expect(isPublishedByFiles(assetPath), assetPath).toBe(false);
      } else {
        expect(isPublishedByFiles(assetPath), assetPath).toBe(true);
      }
    }
  });

  it('keeps generated video masters and README GIFs out of the published package', () => {
    const npmIgnore = fs.readFileSync(path.join(process.cwd(), '.npmignore'), 'utf8');

    expect(npmIgnore).toContain('docs/*.mp4');
    expect(npmIgnore).toContain('docs/*.gif');
    expect(packageJson.files).toContain('!docs/*.mp4');
    expect(packageJson.files).toContain('!docs/*.gif');
    expect(packageJson.files).not.toContain('docs/workspai-grpc-readme-cli.mp4');
    expect(packageJson.files).not.toContain('docs/workspai-grpc-readme-cli.gif');
  });

  it('publishes local documentation linked from the npm README', () => {
    const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
    const localDocLinks = [...readme.matchAll(/\[[^\]]+\]\((docs\/[^)#]+)(?:#[^)]+)?\)/g)].map(
      (match) => match[1]
    );

    expect(localDocLinks.length).toBeGreaterThan(5);

    for (const link of localDocLinks) {
      expect(fs.existsSync(path.join(process.cwd(), link)), link).toBe(true);
      expect(isPublishedByFiles(link), link).toBe(true);
    }
  });

  it('ships config examples with module syntax that matches their extension', () => {
    for (const examplePath of ['workspai.config.example.cjs', 'rapidkit.config.example.cjs']) {
      const source = fs.readFileSync(path.join(process.cwd(), examplePath), 'utf8');
      expect(source).toContain('module.exports = {');
      expect(source).not.toMatch(/^\s*export\s+default\b/m);
    }

    for (const legacyExamplePath of ['workspai.config.example.js', 'rapidkit.config.example.js']) {
      expect(fs.existsSync(path.join(process.cwd(), legacyExamplePath)), legacyExamplePath).toBe(
        false
      );
      expect(packageJson.files).not.toContain(legacyExamplePath);
    }
  });
});
