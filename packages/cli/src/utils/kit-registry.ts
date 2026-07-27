import type { BackendPlatformKey, BackendRuntimeFamily } from './backend-framework-contract.js';
import type { WorkspaceProjectCategory } from './project-kind.js';

export type KitOwner = 'core' | 'npm';
export type KitStability = 'stable' | 'preview';

export interface KitDefinition {
  id: string;
  aliases: string[];
  label: string;
  description: string;
  owner: KitOwner;
  runtime: BackendRuntimeFamily;
  framework: BackendPlatformKey;
  category: WorkspaceProjectCategory;
  moduleSupport: boolean;
  stability: KitStability;
  versionPolicy: 'tested-baseline';
  generator?: 'gofiber' | 'gogin' | 'springboot' | 'dotnet-webapi-clean' | 'rust-axum';
  createUsage?: string;
}

export interface NpmKitGenerateOptions {
  projectName: string;
  projectPath: string;
  args: string[];
  skipGit: boolean;
  skipInstall?: boolean;
}

export const KIT_REGISTRY: KitDefinition[] = [
  {
    id: 'fastapi.standard',
    aliases: ['fastapi', 'fastapi.standard'],
    label: 'fastapi  — FastAPI Standard Kit',
    description: 'Core-backed FastAPI service scaffold.',
    owner: 'core',
    runtime: 'python',
    framework: 'fastapi',
    category: 'backend',
    moduleSupport: true,
    stability: 'stable',
    versionPolicy: 'tested-baseline',
  },
  {
    id: 'fastapi.ddd',
    aliases: ['fastapi.ddd', 'fastapi-ddd'],
    label: 'fastapi  — FastAPI DDD Kit',
    description: 'Core-backed FastAPI DDD service scaffold.',
    owner: 'core',
    runtime: 'python',
    framework: 'fastapi',
    category: 'backend',
    moduleSupport: true,
    stability: 'stable',
    versionPolicy: 'tested-baseline',
  },
  {
    id: 'nestjs.standard',
    aliases: ['nestjs', 'nest', 'nestjs.standard'],
    label: 'nestjs   — NestJS Standard Kit',
    description: 'Core-backed NestJS service scaffold.',
    owner: 'core',
    runtime: 'node',
    framework: 'nestjs',
    category: 'backend',
    moduleSupport: true,
    stability: 'stable',
    versionPolicy: 'tested-baseline',
  },
  {
    id: 'springboot.standard',
    aliases: ['spring', 'springboot', 'springboot.standard', 'java'],
    label: 'spring   — Spring Boot Standard Kit',
    description: 'npm-backed Spring Boot service scaffold.',
    owner: 'npm',
    runtime: 'java',
    framework: 'springboot',
    category: 'backend',
    moduleSupport: false,
    stability: 'stable',
    versionPolicy: 'tested-baseline',
    generator: 'springboot',
    createUsage:
      'workspai create project springboot.standard <name> [--java-version <major>] [--spring-boot-version <semver>] [--group-id <com.example>] [--package-name <com.example.app>] [--port <number>]',
  },
  {
    id: 'gofiber.standard',
    aliases: ['go', 'go.standard', 'fiber', 'gofiber', 'gofiber.standard', 'go/fiber'],
    label: 'go/fiber — Go Fiber Standard Kit',
    description: 'npm-backed Go Fiber service scaffold.',
    owner: 'npm',
    runtime: 'go',
    framework: 'gofiber',
    category: 'backend',
    moduleSupport: false,
    stability: 'stable',
    versionPolicy: 'tested-baseline',
    generator: 'gofiber',
    createUsage: 'workspai create project gofiber.standard <name> [--output <dir>]',
  },
  {
    id: 'gogin.standard',
    aliases: ['gin', 'gogin', 'gogin.standard', 'go/gin'],
    label: 'go/gin   — Go Gin Standard Kit',
    description: 'npm-backed Go Gin service scaffold.',
    owner: 'npm',
    runtime: 'go',
    framework: 'gogin',
    category: 'backend',
    moduleSupport: false,
    stability: 'stable',
    versionPolicy: 'tested-baseline',
    generator: 'gogin',
    createUsage: 'workspai create project gogin.standard <name> [--output <dir>]',
  },
  {
    id: 'dotnet.webapi.clean',
    aliases: [
      'dotnet',
      'dotnet.webapi',
      'dotnet.webapi.clean',
      'aspnet',
      'aspnetcore',
      'asp.net',
      'asp.net-core',
      'csharp',
      'c#',
    ],
    label: 'dotnet   — ASP.NET Core Clean Web API',
    description: 'npm-backed ASP.NET Core Web API with clean architecture boundaries.',
    owner: 'npm',
    runtime: 'dotnet',
    framework: 'dotnet',
    category: 'backend',
    moduleSupport: false,
    stability: 'preview',
    versionPolicy: 'tested-baseline',
    generator: 'dotnet-webapi-clean',
    createUsage:
      'workspai create project dotnet.webapi.clean <name> [--target-framework net8.0] [--root-namespace <Company.Product>] [--port <number>]',
  },
  {
    id: 'rust.axum',
    aliases: ['rust.axum', 'axum', 'rust-axum'],
    label: 'rust/axum — Rust Axum API',
    description: 'Workspai-owned Axum service with health, tests, CI, and container baseline.',
    owner: 'npm',
    runtime: 'rust',
    framework: 'axum',
    category: 'backend',
    moduleSupport: false,
    stability: 'preview',
    versionPolicy: 'tested-baseline',
    generator: 'rust-axum',
    createUsage:
      'workspai create project rust.axum <name> [--port <number>] [--output <dir>] [--skip-git]',
  },
];

const KIT_BY_ALIAS = new Map<string, KitDefinition>();
for (const kit of KIT_REGISTRY) {
  KIT_BY_ALIAS.set(kit.id.toLowerCase(), kit);
  for (const alias of kit.aliases) {
    KIT_BY_ALIAS.set(alias.toLowerCase(), kit);
  }
}

export function resolveKitDefinition(value: string | undefined): KitDefinition | null {
  if (!value) return null;
  return KIT_BY_ALIAS.get(value.trim().toLowerCase()) ?? null;
}

export function normalizeKitId(value: string): string {
  return resolveKitDefinition(value)?.id ?? value;
}

export function listInteractiveKits(): KitDefinition[] {
  return KIT_REGISTRY.filter((kit) => kit.owner === 'core' || kit.generator);
}

export function isNpmBackedKit(value: string | undefined): boolean {
  return resolveKitDefinition(value)?.owner === 'npm';
}

export async function runNpmKitGenerator(
  definition: KitDefinition,
  options: NpmKitGenerateOptions
) {
  if (!definition.generator) {
    throw new Error(`Kit is not backed by an npm generator: ${definition.id}`);
  }

  if (definition.generator === 'gofiber') {
    const { generateGoFiberKit } = await import('../generators/gofiber-standard.js');
    await generateGoFiberKit(options.projectPath, {
      project_name: options.projectName,
      module_path: options.projectName,
      skipGit: options.skipGit,
      skipInstall: options.skipInstall,
    });
    return;
  }

  if (definition.generator === 'gogin') {
    const { generateGoGinKit } = await import('../generators/gogin-standard.js');
    await generateGoGinKit(options.projectPath, {
      project_name: options.projectName,
      module_path: options.projectName,
      skipGit: options.skipGit,
      skipInstall: options.skipInstall,
    });
    return;
  }

  if (definition.generator === 'springboot') {
    const { generateSpringBootKit } = await import('../generators/springboot-standard.js');
    await generateSpringBootKit(options.projectPath, {
      project_name: options.projectName,
      artifact_id: options.projectName,
      java_version: readFlagValue(options.args, '--java-version')?.trim(),
      spring_boot_version: readFlagValue(options.args, '--spring-boot-version')?.trim(),
      springdoc_version: readFlagValue(options.args, '--springdoc-version')?.trim(),
      group_id: readFlagValue(options.args, '--group-id')?.trim(),
      package_name: readFlagValue(options.args, '--package-name')?.trim(),
      description: readFlagValue(options.args, '--description')?.trim(),
      port: readFlagValue(options.args, '--port')?.trim(),
      skipGit: options.skipGit,
      skipInstall: options.skipInstall,
    });
    return;
  }

  if (definition.generator === 'dotnet-webapi-clean') {
    const { generateDotnetWebApiCleanKit } = await import('../generators/dotnet-webapi-clean.js');
    await generateDotnetWebApiCleanKit(options.projectPath, {
      project_name: options.projectName,
      target_framework: readFlagValue(options.args, '--target-framework')?.trim(),
      root_namespace: readFlagValue(options.args, '--root-namespace')?.trim(),
      description: readFlagValue(options.args, '--description')?.trim(),
      port: readFlagValue(options.args, '--port')?.trim(),
      skipGit: options.skipGit,
      skipInstall: options.skipInstall,
    });
    return;
  }

  if (definition.generator === 'rust-axum') {
    const { generateRustAxumKit } = await import('../generators/rust-axum.js');
    await generateRustAxumKit(options.projectPath, {
      project_name: options.projectName,
      description: readFlagValue(options.args, '--description')?.trim(),
      port: readFlagValue(options.args, '--port')?.trim(),
      skipGit: options.skipGit,
      skipInstall: options.skipInstall,
    });
    return;
  }

  throw new Error(`Unhandled npm kit generator: ${definition.generator}`);
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}
