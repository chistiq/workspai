import type {
  BackendPlatformKey,
  BackendRuntimeFamily,
  BackendSupportTier,
} from './backend-framework-contract.js';
import type { RuntimeCommand } from './runtime-adapters.js';

export type RapidKitSupportTier = BackendSupportTier;

export interface RuntimeSupportMatrixEntry {
  runtime: BackendRuntimeFamily;
  displayName: string;
  tier: RapidKitSupportTier;
  scaffoldSupport: boolean;
  importSupport: boolean;
  lifecycleCommands: RuntimeCommand[];
  moduleCommands: boolean;
  doctorSupport: 'full' | 'readiness' | 'observed';
  notes: string[];
}

export interface FrameworkSupportMatrixEntry {
  framework: BackendPlatformKey;
  displayName: string;
  runtime: BackendRuntimeFamily;
  tier: RapidKitSupportTier;
  scaffoldSupport: boolean;
  importSupport: boolean;
  moduleCommands: boolean;
  notes: string[];
}

const LIFECYCLE_COMMANDS: RuntimeCommand[] = [
  'init',
  'dev',
  'start',
  'build',
  'test',
  'lint',
  'format',
  'help',
];

export const RUNTIME_SUPPORT_MATRIX: Record<string, RuntimeSupportMatrixEntry> = {
  python: {
    runtime: 'python',
    displayName: 'Python',
    tier: 'first-class',
    scaffoldSupport: true,
    importSupport: true,
    lifecycleCommands: LIFECYCLE_COMMANDS,
    moduleCommands: true,
    doctorSupport: 'full',
    notes: ['Core-backed Python projects support RapidKit Core modules and lifecycle commands.'],
  },
  node: {
    runtime: 'node',
    displayName: 'Node.js',
    tier: 'extended',
    scaffoldSupport: true,
    importSupport: true,
    lifecycleCommands: LIFECYCLE_COMMANDS,
    moduleCommands: true,
    doctorSupport: 'full',
    notes: [
      'Node projects support npm-owned lifecycle commands; NestJS is the first-class Node framework.',
    ],
  },
  go: {
    runtime: 'go',
    displayName: 'Go',
    tier: 'extended',
    scaffoldSupport: true,
    importSupport: true,
    lifecycleCommands: LIFECYCLE_COMMANDS,
    moduleCommands: false,
    doctorSupport: 'readiness',
    notes: ['Go projects support workspace governance and lifecycle commands via Go tooling.'],
  },
  java: {
    runtime: 'java',
    displayName: 'Java / Spring Boot',
    tier: 'extended',
    scaffoldSupport: true,
    importSupport: true,
    lifecycleCommands: LIFECYCLE_COMMANDS,
    moduleCommands: false,
    doctorSupport: 'readiness',
    notes: ['Java projects support Maven/Gradle lifecycle commands and workspace governance.'],
  },
  dotnet: {
    runtime: 'dotnet',
    displayName: '.NET / ASP.NET Core',
    tier: 'extended',
    scaffoldSupport: true,
    importSupport: true,
    lifecycleCommands: LIFECYCLE_COMMANDS,
    moduleCommands: false,
    doctorSupport: 'readiness',
    notes: ['.NET projects support dotnet CLI lifecycle commands and workspace governance.'],
  },
  php: {
    runtime: 'php',
    displayName: 'PHP',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['PHP projects are importable and governed as observed projects until a kit exists.'],
  },
  ruby: {
    runtime: 'ruby',
    displayName: 'Ruby',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Ruby projects are importable and governed as observed projects until a kit exists.'],
  },
  rust: {
    runtime: 'rust',
    displayName: 'Rust',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Rust projects are importable and governed as observed projects until a kit exists.'],
  },
  elixir: {
    runtime: 'elixir',
    displayName: 'Elixir',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Elixir projects are importable and governed as observed projects until a kit exists.'],
  },
  clojure: {
    runtime: 'clojure',
    displayName: 'Clojure',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: [
      'Clojure projects are importable and governed as observed projects until a kit exists.',
    ],
  },
  scala: {
    runtime: 'scala',
    displayName: 'Scala',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Scala projects are importable and governed as observed projects until a kit exists.'],
  },
  kotlin: {
    runtime: 'kotlin',
    displayName: 'Kotlin',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Kotlin projects are importable and governed as observed projects until a kit exists.'],
  },
  deno: {
    runtime: 'deno',
    displayName: 'Deno',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Deno projects are importable and governed as observed projects until a kit exists.'],
  },
  bun: {
    runtime: 'bun',
    displayName: 'Bun',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Bun projects are importable and governed as observed projects until a kit exists.'],
  },
  c: {
    runtime: 'c',
    displayName: 'C',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: [
      'C projects are importable and receive manifest, test, quality, security, and coverage evidence without assuming a package manager.',
    ],
  },
  cpp: {
    runtime: 'cpp',
    displayName: 'C++',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: [
      'C++ projects are importable and receive manifest, test, quality, security, and coverage evidence without assuming a package manager.',
    ],
  },
  unknown: {
    runtime: 'unknown',
    displayName: 'Unknown',
    tier: 'observed',
    scaffoldSupport: false,
    importSupport: true,
    lifecycleCommands: ['help'],
    moduleCommands: false,
    doctorSupport: 'observed',
    notes: ['Unknown projects are tracked safely but require manual command configuration.'],
  },
};

const FIRST_CLASS_FRAMEWORKS: BackendPlatformKey[] = ['fastapi', 'nestjs'];

const EXTENDED_FRAMEWORKS: BackendPlatformKey[] = [
  'django',
  'flask',
  'nextjs',
  'remix',
  'nuxt',
  'react',
  'vite',
  'vue',
  'sveltekit',
  'svelte',
  'angular',
  'astro',
  'solid',
  'express',
  'fastify',
  'koa',
  'echo',
  'gofiber',
  'gogin',
  'springboot',
  'dotnet',
  'laravel',
  'symfony',
  'rails',
  'sinatra',
  'actix',
  'axum',
  'rocket',
  'phoenix',
  'clojure',
  'scala',
  'kotlin',
  'deno',
  'bun',
  'c',
  'cpp',
];

export function getRuntimeSupport(runtime: string | undefined): RuntimeSupportMatrixEntry {
  return RUNTIME_SUPPORT_MATRIX[runtime || 'unknown'] ?? RUNTIME_SUPPORT_MATRIX.unknown;
}

export function getFrameworkSupportTier(framework: BackendPlatformKey): RapidKitSupportTier {
  if (FIRST_CLASS_FRAMEWORKS.includes(framework)) return 'first-class';
  if (EXTENDED_FRAMEWORKS.includes(framework)) return 'extended';
  return 'observed';
}

export function isLifecycleCommandSupportedForRuntime(
  runtime: string | undefined,
  command: RuntimeCommand
): boolean {
  return getRuntimeSupport(runtime).lifecycleCommands.includes(command);
}

export function buildRuntimeCommandSupport(input: { runtime: string; moduleSupport: boolean }): {
  lifecycleCommands: RuntimeCommand[];
  moduleCommands: boolean;
  unsupportedLifecycleCommands: RuntimeCommand[];
} {
  const runtimeSupport = getRuntimeSupport(input.runtime);
  return {
    lifecycleCommands: runtimeSupport.lifecycleCommands,
    moduleCommands: input.moduleSupport && runtimeSupport.moduleCommands,
    unsupportedLifecycleCommands: LIFECYCLE_COMMANDS.filter(
      (command) => !runtimeSupport.lifecycleCommands.includes(command)
    ),
  };
}
