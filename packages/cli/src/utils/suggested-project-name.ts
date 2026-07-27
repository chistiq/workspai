import { resolveFrontendGenerator } from '../frontend-project.js';
import { resolveOfficialProjectGenerator } from '../official-project.js';
import { resolveKitDefinition } from './kit-registry.js';

const NAME_THEMES = [
  'catalog',
  'pulse',
  'nova',
  'orbit',
  'atlas',
  'vertex',
  'summit',
  'beacon',
  'ledger',
  'flux',
  'nexus',
  'apex',
  'harbor',
  'forge',
  'spark',
  'portal',
  'studio',
  'canvas',
  'quantum',
  'vault',
  'zenith',
  'compass',
  'vector',
  'catalyst',
  'saas',
  'commerce',
  'radar',
  'stellar',
  'prism',
  'cedar',
  'momentum',
  'signal',
  'cipher',
  'lumen',
  'trail',
  'ridge',
] as const;

const KIT_SUFFIX: Record<string, string> = {
  'fastapi.standard': 'api',
  'fastapi.ddd': 'api',
  'nestjs.standard': 'api',
  'springboot.standard': 'service',
  'gofiber.standard': 'api',
  'gogin.standard': 'api',
  'dotnet.webapi.clean': 'api',
};

const FRONTEND_SUFFIX: Record<string, string> = {
  nextjs: 'web',
  remix: 'app',
  'vite-react': 'web',
  'vite-vue': 'web',
  'vite-svelte': 'web',
  'vite-solid': 'web',
  'vite-vanilla': 'app',
  nuxt: 'app',
  angular: 'app',
  astro: 'site',
  sveltekit: 'app',
};

const OFFICIAL_SUFFIX: Record<string, string> = {
  tauri: 'desktop',
  electron: 'desktop',
  'vscode-extension': 'extension',
  laravel: 'api',
};

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Suggest a stack-aware default project folder name for interactive create flows.
 * Users can accept or edit the value in the prompt.
 */
export function suggestProjectNameForKit(kitId: string): string {
  const theme = pickRandom(NAME_THEMES);
  const frontend = resolveFrontendGenerator(kitId);
  if (frontend) {
    const suffix = FRONTEND_SUFFIX[frontend.id] ?? 'app';
    return `${theme}-${suffix}`;
  }

  const official = resolveOfficialProjectGenerator(kitId);
  if (official) {
    return `${theme}-${OFFICIAL_SUFFIX[official.id] ?? 'app'}`;
  }

  const kit = resolveKitDefinition(kitId);
  const suffix = kit ? (KIT_SUFFIX[kit.id] ?? 'service') : 'app';
  return `${theme}-${suffix}`;
}
