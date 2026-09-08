import fs from 'fs';
import path from 'path';

import type {
  BackendConfidence,
  BackendFrameworkDetection,
  BackendImportStack,
  BackendPlatformKey,
  BackendRuntimeFamily,
  BackendSupportTier,
} from './backend-framework-contract.js';

export type FrontendPlatformKey =
  | 'nextjs'
  | 'remix'
  | 'nuxt'
  | 'react'
  | 'vite'
  | 'vue'
  | 'sveltekit'
  | 'svelte'
  | 'angular'
  | 'astro'
  | 'solid'
  | 'unknown';

export interface FrontendFrameworkContract {
  key: FrontendPlatformKey;
  runtime: Extract<BackendRuntimeFamily, 'node' | 'deno' | 'bun' | 'unknown'>;
  displayName: string;
  supportTier: BackendSupportTier;
  importStack: BackendImportStack;
  aliases: string[];
  dependencyHints: string[];
  scriptHints: string[];
  fileHints: string[];
}

const FRONTEND_CONTRACTS: Record<FrontendPlatformKey, FrontendFrameworkContract> = {
  nextjs: {
    key: 'nextjs',
    runtime: 'node',
    displayName: 'Next.js',
    supportTier: 'extended',
    importStack: 'nextjs',
    aliases: ['next', 'nextjs', 'next.js'],
    dependencyHints: ['next'],
    scriptHints: ['next dev', 'next build', 'next start'],
    fileHints: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  },
  remix: {
    key: 'remix',
    runtime: 'node',
    displayName: 'Remix',
    supportTier: 'extended',
    importStack: 'remix',
    aliases: ['remix'],
    dependencyHints: ['@remix-run/react', '@remix-run/node', '@remix-run/dev'],
    scriptHints: ['remix dev', 'remix vite:dev'],
    fileHints: ['remix.config.js', 'remix.config.mjs'],
  },
  nuxt: {
    key: 'nuxt',
    runtime: 'node',
    displayName: 'Nuxt',
    supportTier: 'extended',
    importStack: 'nuxt',
    aliases: ['nuxt', 'nuxtjs', 'nuxt.js'],
    dependencyHints: ['nuxt', 'nuxt3'],
    scriptHints: ['nuxt dev', 'nuxt build', 'nuxi dev', 'nuxi build'],
    fileHints: ['nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs'],
  },
  react: {
    key: 'react',
    runtime: 'node',
    displayName: 'React',
    supportTier: 'extended',
    importStack: 'react',
    aliases: ['react'],
    dependencyHints: ['react', 'react-dom'],
    scriptHints: ['react-scripts start', 'react-scripts build'],
    fileHints: [],
  },
  vite: {
    key: 'vite',
    runtime: 'node',
    displayName: 'Vite',
    supportTier: 'extended',
    importStack: 'vite',
    aliases: ['vite'],
    dependencyHints: ['vite'],
    scriptHints: ['vite', 'vite dev', 'vite build'],
    fileHints: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
  },
  vue: {
    key: 'vue',
    runtime: 'node',
    displayName: 'Vue',
    supportTier: 'extended',
    importStack: 'vue',
    aliases: ['vue', 'vuejs', 'vue.js'],
    dependencyHints: ['vue', '@vue/cli-service'],
    scriptHints: ['vue-cli-service serve', 'vue-cli-service build'],
    fileHints: ['vue.config.js'],
  },
  sveltekit: {
    key: 'sveltekit',
    runtime: 'node',
    displayName: 'SvelteKit',
    supportTier: 'extended',
    importStack: 'sveltekit',
    aliases: ['sveltekit', 'svelte-kit'],
    dependencyHints: ['@sveltejs/kit'],
    scriptHints: ['svelte-kit dev', 'svelte-kit build'],
    fileHints: ['svelte.config.js'],
  },
  svelte: {
    key: 'svelte',
    runtime: 'node',
    displayName: 'Svelte',
    supportTier: 'extended',
    importStack: 'svelte',
    aliases: ['svelte'],
    dependencyHints: ['svelte'],
    scriptHints: ['svelte'],
    fileHints: [],
  },
  angular: {
    key: 'angular',
    runtime: 'node',
    displayName: 'Angular',
    supportTier: 'extended',
    importStack: 'angular',
    aliases: ['angular', '@angular/core'],
    dependencyHints: ['@angular/core', '@angular/cli'],
    scriptHints: ['ng serve', 'ng build'],
    fileHints: ['angular.json'],
  },
  astro: {
    key: 'astro',
    runtime: 'node',
    displayName: 'Astro',
    supportTier: 'extended',
    importStack: 'astro',
    aliases: ['astro'],
    dependencyHints: ['astro'],
    scriptHints: ['astro dev', 'astro build'],
    fileHints: ['astro.config.js', 'astro.config.ts', 'astro.config.mjs'],
  },
  solid: {
    key: 'solid',
    runtime: 'node',
    displayName: 'Solid',
    supportTier: 'extended',
    importStack: 'solid',
    aliases: ['solid', 'solidjs', 'solid-js'],
    dependencyHints: ['solid-js'],
    scriptHints: [],
    fileHints: [],
  },
  unknown: {
    key: 'unknown',
    runtime: 'unknown',
    displayName: 'Unknown frontend',
    supportTier: 'observed',
    importStack: 'unknown',
    aliases: ['unknown'],
    dependencyHints: [],
    scriptHints: [],
    fileHints: [],
  },
};

export type FrontendLifecycleCommand = 'dev' | 'start' | 'build' | 'test' | 'lint' | 'format';

const FRONTEND_LIFECYCLE_SCRIPT_CANDIDATES: Partial<
  Record<FrontendPlatformKey, Partial<Record<FrontendLifecycleCommand, string[]>>>
> = {
  nextjs: {
    dev: ['dev'],
    start: ['start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  remix: {
    dev: ['dev'],
    start: ['start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  nuxt: {
    dev: ['dev'],
    start: ['start', 'preview'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  react: {
    dev: ['dev', 'start'],
    start: ['serve'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  vite: {
    dev: ['dev'],
    start: ['preview', 'start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  vue: {
    dev: ['dev', 'serve'],
    start: ['preview', 'start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  sveltekit: {
    dev: ['dev'],
    start: ['start', 'preview'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  svelte: {
    dev: ['dev'],
    start: ['preview', 'start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  angular: {
    dev: ['start', 'serve'],
    start: ['serve'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  astro: {
    dev: ['dev'],
    start: ['start', 'preview'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
  solid: {
    dev: ['dev'],
    start: ['preview', 'start'],
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    format: ['format'],
  },
};

export function getFrontendLifecycleScriptCandidates(
  framework: FrontendPlatformKey | string,
  command: FrontendLifecycleCommand
): string[] {
  const key =
    typeof framework === 'string' ? normalizeFrontendFrameworkLabel(framework) : framework;
  if (key === 'unknown') {
    return [];
  }
  return FRONTEND_LIFECYCLE_SCRIPT_CANDIDATES[key]?.[command] ?? [];
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function packageSignals(projectPath: string): {
  dependencies: Record<string, unknown>;
  scriptText: string;
} {
  const packageJson = readJsonIfExists(path.join(projectPath, 'package.json'));
  if (!packageJson) {
    return { dependencies: {}, scriptText: '' };
  }

  const declaredDependencies =
    (packageJson.dependencies as Record<string, unknown> | undefined) ?? {};
  const isPrivateWorkspaceRoot =
    packageJson.private === true &&
    (Array.isArray(packageJson.workspaces) ||
      (packageJson.workspaces !== null && typeof packageJson.workspaces === 'object') ||
      fs.existsSync(path.join(projectPath, 'pnpm-workspace.yaml')));
  const dependencies = isPrivateWorkspaceRoot
    ? declaredDependencies
    : {
        ...declaredDependencies,
        ...((packageJson.devDependencies as Record<string, unknown> | undefined) ?? {}),
        ...((packageJson.peerDependencies as Record<string, unknown> | undefined) ?? {}),
      };
  const scripts = ((packageJson.scripts as Record<string, unknown> | undefined) ?? {}) as Record<
    string,
    unknown
  >;
  const scriptText = Object.values(scripts)
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase();

  return { dependencies, scriptText };
}

function hasAnyFile(projectPath: string, candidates: string[]): boolean {
  return candidates.some((candidate) => fs.existsSync(path.join(projectPath, candidate)));
}

function scriptInvokesHint(scriptText: string, hint: string): boolean {
  const pattern = hint
    .trim()
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?:^|[\\s;&|])${pattern}(?=$|[\\s;&|])`, 'u').test(scriptText);
}

function resolveViteSubframework(
  dependencies: Record<string, unknown>
): FrontendPlatformKey | null {
  if (!dependencies.vite) {
    return null;
  }

  if (dependencies.react || dependencies['react-dom'] || dependencies['@vitejs/plugin-react']) {
    return 'react';
  }
  if (dependencies.vue || dependencies['@vitejs/plugin-vue']) {
    return 'vue';
  }
  if (dependencies.svelte || dependencies['@sveltejs/vite-plugin-svelte']) {
    return 'svelte';
  }
  if (dependencies['solid-js'] || dependencies['vite-plugin-solid']) {
    return 'solid';
  }

  return null;
}

function detection(
  key: FrontendPlatformKey,
  confidence: BackendConfidence,
  source: BackendFrameworkDetection['source']
): BackendFrameworkDetection {
  const item = FRONTEND_CONTRACTS[key] ?? FRONTEND_CONTRACTS.unknown;
  return {
    key: item.key as BackendPlatformKey,
    runtime: item.runtime,
    displayName: item.displayName,
    supportTier: item.supportTier,
    importStack: item.importStack,
    confidence,
    source,
  };
}

export function getFrontendFrameworkContract(key: FrontendPlatformKey): FrontendFrameworkContract {
  return FRONTEND_CONTRACTS[key] ?? FRONTEND_CONTRACTS.unknown;
}

export function normalizeFrontendFrameworkLabel(
  raw: string | undefined | null
): FrontendPlatformKey {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (!normalized) {
    return 'unknown';
  }

  for (const item of Object.values(FRONTEND_CONTRACTS)) {
    if (item.aliases.includes(normalized)) {
      return item.key;
    }
  }
  return 'unknown';
}

export function detectFrontendFrameworkFromProject(
  projectPath: string,
  projectJsonData?: Record<string, unknown> | null
): BackendFrameworkDetection {
  const adoption = projectJsonData?.adoption;
  const imported = projectJsonData?.import;
  const managedLinkedMetadata =
    (adoption !== null &&
      typeof adoption === 'object' &&
      !Array.isArray(adoption) &&
      (adoption as Record<string, unknown>).managed_by === 'workspai' &&
      (adoption as Record<string, unknown>).mode === 'linked') ||
    (imported !== null &&
      typeof imported === 'object' &&
      !Array.isArray(imported) &&
      (imported as Record<string, unknown>).managed_by === 'workspai');
  const hinted = normalizeFrontendFrameworkLabel(
    managedLinkedMetadata
      ? undefined
      : typeof projectJsonData?.framework === 'string'
        ? projectJsonData.framework
        : typeof projectJsonData?.kit_name === 'string'
          ? projectJsonData.kit_name
          : typeof projectJsonData?.kit === 'string'
            ? projectJsonData.kit
            : undefined
  );
  if (hinted !== 'unknown') {
    return detection(hinted, 'high', 'framework');
  }

  const { dependencies, scriptText } = packageSignals(projectPath);
  for (const key of [
    'nextjs',
    'remix',
    'nuxt',
    'sveltekit',
    'angular',
    'astro',
    'vue',
    'solid',
    'vite',
    'react',
    'svelte',
  ] satisfies FrontendPlatformKey[]) {
    const item = FRONTEND_CONTRACTS[key];
    if (item.dependencyHints.some((dependency) => dependencies[dependency])) {
      if (key === 'vite') {
        const viteSubframework = resolveViteSubframework(dependencies);
        if (viteSubframework) {
          return detection(viteSubframework, 'high', 'manifest');
        }
      }
      return detection(key, 'high', 'manifest');
    }
    if (item.fileHints.length > 0 && hasAnyFile(projectPath, item.fileHints)) {
      if (key === 'vite') {
        const viteSubframework = resolveViteSubframework(dependencies);
        if (viteSubframework) {
          return detection(viteSubframework, 'high', 'manifest');
        }
      }
      return detection(key, 'high', 'manifest');
    }
    if (item.scriptHints.some((script) => scriptInvokesHint(scriptText, script))) {
      return detection(key, 'medium', 'manifest');
    }
  }

  return detection('unknown', 'low', 'unknown');
}
