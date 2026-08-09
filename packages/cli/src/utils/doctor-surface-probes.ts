import type { Dirent } from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';

import {
  buildCommandRepairCapability,
  buildFileAppendRepairCapability,
  buildFileCreateRepairCapability,
  buildFileCopyRepairCapability,
  buildMakefileTargetRepairCapability,
  buildPackageScriptRepairCapability,
  type DoctorRepairCapability,
  type DoctorRepairStrategyStage,
} from './doctor-repair-capabilities.js';
import type { DoctorDependencyAuditEvidence } from './doctor-dependency-audit.js';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

export const DOCTOR_SURFACE_RUNTIME_FAMILIES = [
  'python',
  'node',
  'go',
  'java',
  'rust',
  'elixir',
  'clojure',
  'deno',
  'bun',
  'php',
  'ruby',
  'dotnet',
  'scala',
  'kotlin',
  'c',
  'cpp',
  'unknown',
] as const;

export type DoctorSurfaceRuntimeFamily = (typeof DOCTOR_SURFACE_RUNTIME_FAMILIES)[number];

export type DoctorSurfaceProjectKind =
  'backend' | 'frontend' | 'desktop' | 'extension' | 'fullstack' | 'generic';

export interface DoctorSurfaceProbe {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'info' | 'warn' | 'error';
  scope: 'project-scoped';
  applicability?: 'applicable' | 'not-applicable' | 'unknown';
  reason: string;
  recommendation?: string;
  repairCapability?: DoctorRepairCapability;
}

type SurfaceInput = {
  projectPath: string;
  runtimeFamily?: DoctorSurfaceRuntimeFamily | string;
  projectKind?: DoctorSurfaceProjectKind;
  framework?: string;
  packageJsonData?: Record<string, unknown> | null;
  hasTests?: boolean;
  hasDocker?: boolean;
  vulnerabilities?: number;
  dependencyAudit?: DoctorDependencyAuditEvidence;
};

const DEPENDENCY_LOCKFILES: Record<DoctorSurfaceRuntimeFamily, string[]> = {
  node: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'],
  deno: ['deno.lock'],
  bun: ['bun.lock', 'bun.lockb'],
  python: ['uv.lock', 'poetry.lock', 'requirements.txt', 'requirements.lock'],
  go: ['go.sum'],
  java: ['gradle.lockfile', 'gradle/libs.versions.toml'],
  rust: ['Cargo.lock'],
  elixir: ['mix.lock'],
  clojure: ['deps.edn', 'project.clj'],
  php: ['composer.lock'],
  ruby: ['Gemfile.lock'],
  dotnet: ['packages.lock.json', 'Directory.Packages.props'],
  scala: ['project/build.properties', 'project/plugins.sbt'],
  kotlin: ['gradle.lockfile', 'gradle/libs.versions.toml'],
  c: ['conan.lock', 'vcpkg-lock.json'],
  cpp: ['conan.lock', 'vcpkg-lock.json'],
  unknown: [],
};

const DEPENDENCY_MANIFESTS: Record<DoctorSurfaceRuntimeFamily, string[]> = {
  node: ['package.json'],
  deno: ['deno.json', 'deno.jsonc'],
  bun: ['package.json', 'bunfig.toml'],
  python: ['pyproject.toml', 'requirements.txt', 'setup.py'],
  go: ['go.mod'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  rust: ['Cargo.toml'],
  elixir: ['mix.exs'],
  clojure: ['deps.edn', 'project.clj'],
  php: ['composer.json'],
  ruby: ['Gemfile'],
  dotnet: ['*.csproj', '*.sln'],
  scala: ['build.sbt'],
  kotlin: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
  c: ['CMakeLists.txt', 'meson.build', 'Makefile'],
  cpp: ['CMakeLists.txt', 'meson.build', 'Makefile'],
  unknown: [],
};

const DEFAULT_DOCKERIGNORE = [
  'node_modules',
  '.git',
  '.workspai/reports',
  '.venv',
  'dist',
  'build',
  'coverage',
  '.env',
  '.env.*',
  '!.env.example',
].join('\n');

const DEFAULT_SECRET_GITIGNORE_LINES = ['.env', '.env.*', '!.env.example'];

type DependencyBaselineRepair = {
  command: string;
  title: string;
  files: string[];
  limitations?: string[];
};

type RuntimeCommandContractKind = 'test' | 'quality' | 'security';

type RuntimeCommandContract = {
  command: string;
  title: string;
  targetName: string;
  files: string[];
  limitations?: string[];
};

function normalizeRuntime(runtime: string | undefined): DoctorSurfaceRuntimeFamily {
  if (!runtime) return 'unknown';
  if (DOCTOR_SURFACE_RUNTIME_FAMILIES.includes(runtime as DoctorSurfaceRuntimeFamily)) {
    return runtime as DoctorSurfaceRuntimeFamily;
  }
  return 'unknown';
}

async function anyPathExists(projectPath: string, candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    if (candidate.includes('*')) {
      const suffix = candidate.replace('*', '');
      if (await hasFileWithSuffix(projectPath, suffix, 2)) {
        return true;
      }
      continue;
    }
    if (await fsExtra.pathExists(path.join(projectPath, candidate))) {
      return true;
    }
  }
  return false;
}

async function hasFileWithSuffix(root: string, suffix: string, maxDepth: number): Promise<boolean> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const ignored = new Set([
    'node_modules',
    '.git',
    '.workspai',
    '.rapidkit',
    'dist',
    'build',
    'coverage',
  ]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    let entries: Dirent[] = [];
    try {
      entries = await fsExtra.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        return true;
      }
      if (entry.isDirectory() && current.depth < maxDepth && !entry.name.startsWith('.')) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return false;
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    if (!(await fsExtra.pathExists(filePath))) return '';
    return await fsExtra.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function collectTextFromExisting(projectPath: string, candidates: string[]): Promise<string> {
  const chunks: string[] = [];
  for (const candidate of candidates) {
    const text = await readTextIfExists(path.join(projectPath, candidate));
    if (text) chunks.push(text);
  }
  return chunks.join('\n');
}

const ENV_SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.clj',
  '.cljs',
  '.cpp',
  '.cs',
  '.ex',
  '.exs',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.cjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scala',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

const ENV_REFERENCE_PATTERNS = [
  /\bprocess\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g,
  /\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  /\b(?:Deno\.env\.get|os\.getenv|os\.Getenv|os\.LookupEnv|System\.getenv|std::env::var|env!|option_env!|getenv|Environment\.GetEnvironmentVariable)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /\bos\.environ(?:\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g,
  /\bENV(?:\.fetch\(\s*['"]([A-Z][A-Z0-9_]*)['"]|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g,
  /\$_ENV\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /@Value\(\s*['"]\$\{([A-Z][A-Z0-9_]*)(?::[^}]*)?\}['"]\s*\)/g,
];

async function collectEnvironmentContractKeys(projectPath: string): Promise<string[]> {
  const keys = new Set<string>();
  const ignored = new Set([
    '.git',
    '.next',
    '.nuxt',
    '.output',
    '.rapidkit',
    '.svelte-kit',
    '.venv',
    '.workspai',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'target',
    'vendor',
  ]);
  const queue: Array<{ dir: string; depth: number }> = [{ dir: projectPath, depth: 0 }];
  let inspectedFiles = 0;

  while (queue.length > 0 && inspectedFiles < 300) {
    const current = queue.shift();
    if (!current) break;
    let entries: Dirent[] = [];
    try {
      entries = await fsExtra.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 6 && !entry.name.startsWith('.')) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !ENV_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      inspectedFiles += 1;
      let source = '';
      try {
        const stat = await fsExtra.stat(fullPath);
        if (stat.size > 512 * 1024) continue;
        source = await fsExtra.readFile(fullPath, 'utf8');
      } catch {
        continue;
      }
      for (const pattern of ENV_REFERENCE_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
          const key = match.slice(1).find((value) => typeof value === 'string' && value.length > 0);
          if (key) keys.add(key);
        }
      }
    }
  }

  const envText = await readTextIfExists(path.join(projectPath, '.env'));
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match?.[1]) keys.add(match[1]);
  }

  return [...keys].sort((left, right) => left.localeCompare(right));
}

async function inferDependencyBaselineRepair(input: {
  projectPath: string;
  runtime: DoctorSurfaceRuntimeFamily;
  packageJsonData?: Record<string, unknown> | null;
}): Promise<DependencyBaselineRepair | null> {
  if (input.runtime === 'node') {
    const packageManager =
      typeof input.packageJsonData?.packageManager === 'string'
        ? input.packageJsonData.packageManager.split('@')[0]
        : null;
    const command =
      packageManager === 'pnpm'
        ? 'pnpm install'
        : packageManager === 'yarn'
          ? 'yarn install'
          : packageManager === 'bun'
            ? 'bun install'
            : 'npm install';
    return {
      command,
      title: 'Generate Node dependency lockfile',
      files: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'],
      limitations: ['Review dependency and lockfile changes before committing.'],
    };
  }

  if (
    input.runtime === 'go' &&
    (await fsExtra.pathExists(path.join(input.projectPath, 'go.mod')))
  ) {
    return {
      command: 'go mod tidy',
      title: 'Reconcile Go module graph',
      files: ['go.mod', 'go.sum'],
      limitations: ['Review go.mod/go.sum changes before committing.'],
    };
  }

  if (input.runtime === 'java') {
    const hasPom = await fsExtra.pathExists(path.join(input.projectPath, 'pom.xml'));
    const hasMavenWrapper =
      (await fsExtra.pathExists(path.join(input.projectPath, 'mvnw'))) ||
      (await fsExtra.pathExists(path.join(input.projectPath, 'mvnw.cmd')));
    const hasGradleWrapper =
      (await fsExtra.pathExists(path.join(input.projectPath, 'gradlew'))) ||
      (await fsExtra.pathExists(path.join(input.projectPath, 'gradlew.bat')));
    const command = hasPom
      ? hasMavenWrapper
        ? process.platform === 'win32'
          ? '.\\mvnw.cmd -B -DskipTests -Dmaven.repo.local=.workspai/cache/java/m2 dependency:go-offline'
          : './mvnw -B -DskipTests -Dmaven.repo.local=.workspai/cache/java/m2 dependency:go-offline'
        : 'mvn -B -DskipTests -Dmaven.repo.local=.workspai/cache/java/m2 dependency:go-offline'
      : hasGradleWrapper
        ? process.platform === 'win32'
          ? '.\\gradlew.bat --project-cache-dir .workspai/cache/java/gradle dependencies'
          : './gradlew --project-cache-dir .workspai/cache/java/gradle dependencies'
        : 'gradle --project-cache-dir .workspai/cache/java/gradle dependencies';
    return {
      command,
      title: 'Prepare Java dependency baseline',
      files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile'],
      limitations: ['Review resolved dependency and lockfile changes before committing.'],
    };
  }

  if (input.runtime === 'scala') {
    return {
      command: 'sbt update',
      title: 'Prepare Scala dependency baseline',
      files: ['build.sbt', 'project/build.properties', 'project/plugins.sbt'],
      limitations: ['Review resolved dependency and plugin changes before committing.'],
    };
  }

  if (input.runtime === 'kotlin') {
    return {
      command:
        process.platform === 'win32' ? '.\\gradlew.bat dependencies' : './gradlew dependencies',
      title: 'Prepare Kotlin dependency baseline',
      files: ['build.gradle', 'build.gradle.kts', 'gradle.lockfile'],
      limitations: ['Review resolved dependency and lockfile changes before committing.'],
    };
  }

  if (input.runtime === 'rust') {
    return {
      command: 'cargo fetch',
      title: 'Generate Rust dependency baseline',
      files: ['Cargo.toml', 'Cargo.lock'],
      limitations: ['Review Cargo.lock changes before committing.'],
    };
  }

  if (input.runtime === 'php') {
    return {
      command: 'composer install',
      title: 'Generate Composer lockfile',
      files: ['composer.json', 'composer.lock'],
      limitations: ['Review composer.lock changes before committing.'],
    };
  }

  if (input.runtime === 'ruby') {
    return {
      command: 'bundle install',
      title: 'Generate Bundler lockfile',
      files: ['Gemfile', 'Gemfile.lock'],
      limitations: ['Review Gemfile.lock changes before committing.'],
    };
  }

  if (input.runtime === 'dotnet') {
    return {
      command: 'dotnet restore',
      title: '.NET dependency restore',
      files: ['*.sln', '*.csproj', 'packages.lock.json', 'Directory.Packages.props'],
      limitations: [
        'Enable NuGet lock files in the project when release policy requires deterministic restore.',
      ],
    };
  }

  if (input.runtime === 'elixir') {
    return {
      command: 'mix deps.get',
      title: 'Generate Elixir dependency lockfile',
      files: ['mix.exs', 'mix.lock'],
      limitations: ['Review mix.lock changes before committing.'],
    };
  }

  if (input.runtime === 'clojure') {
    return {
      command: 'clojure -P',
      title: 'Prepare Clojure dependency baseline',
      files: ['deps.edn', 'project.clj'],
      limitations: ['Review dependency cache and CI restore policy before release.'],
    };
  }

  if (input.runtime === 'python') {
    const pyprojectText = await readTextIfExists(path.join(input.projectPath, 'pyproject.toml'));
    if (/\[tool\.poetry\]/.test(pyprojectText)) {
      return {
        command: 'poetry install --no-root',
        title: 'Install Poetry dependency baseline',
        files: ['pyproject.toml', 'poetry.lock'],
        limitations: [
          'Review poetry.lock changes before committing when Poetry resolves or updates the lockfile.',
        ],
      };
    }
    if (/\[tool\.uv\]|\[project\]/.test(pyprojectText)) {
      return {
        command: 'uv lock',
        title: 'Generate uv lockfile',
        files: ['pyproject.toml', 'uv.lock'],
        limitations: ['Review uv.lock changes before committing.'],
      };
    }
  }

  return null;
}

function scriptsFromPackageJson(
  packageJsonData: Record<string, unknown> | null | undefined
): Record<string, string> {
  const scripts = packageJsonData?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function runtimeCommandContract(input: {
  runtime: DoctorSurfaceRuntimeFamily;
  kind: RuntimeCommandContractKind;
  projectPath: string;
  packageJsonData?: Record<string, unknown> | null;
}): RuntimeCommandContract | null {
  if (input.runtime === 'node') {
    const scripts = scriptsFromPackageJson(input.packageJsonData);
    if (!input.packageJsonData) return null;
    if (input.kind === 'test') {
      const fallback = scripts.lint ? 'npm run lint' : scripts.build ? 'npm run build' : null;
      return fallback
        ? {
            command: fallback,
            title: 'Define Node test script',
            targetName: 'test',
            files: ['package.json'],
            limitations: [
              'Replace this fallback with real tests when product coverage is required.',
            ],
          }
        : null;
    }
    if (input.kind === 'security') {
      return {
        command: 'npm audit --audit-level=moderate',
        title: 'Define Node security audit script',
        targetName: 'audit',
        files: ['package.json'],
      };
    }
    return null;
  }

  const makefileByRuntime: Partial<
    Record<DoctorSurfaceRuntimeFamily, Record<RuntimeCommandContractKind, RuntimeCommandContract>>
  > = {
    deno: {
      test: {
        command: 'deno test --allow-none',
        title: 'Define Deno test command',
        targetName: 'test',
        files: ['Makefile', 'deno.json', 'deno.jsonc'],
      },
      quality: {
        command: 'deno fmt --check && deno lint',
        title: 'Define Deno quality command',
        targetName: 'quality',
        files: ['Makefile', 'deno.json', 'deno.jsonc'],
      },
      security: {
        command: 'deno info --json',
        title: 'Define Deno dependency inspection command',
        targetName: 'security',
        files: ['Makefile', 'deno.json', 'deno.jsonc', 'deno.lock'],
        limitations: [
          'Pair dependency inspection with the organization vulnerability service used by CI.',
        ],
      },
    },
    bun: {
      test: {
        command: 'bun test',
        title: 'Define Bun test script',
        targetName: 'test',
        files: ['package.json', 'bun.lock', 'bun.lockb'],
      },
      quality: {
        command: 'bunx eslint .',
        title: 'Define Bun quality script',
        targetName: 'quality',
        files: ['package.json'],
        limitations: ['Ensure ESLint is declared before enforcing this command in CI.'],
      },
      security: {
        command: 'bun audit',
        title: 'Define Bun security audit script',
        targetName: 'audit',
        files: ['package.json', 'bun.lock', 'bun.lockb'],
      },
    },
    python: {
      test: {
        command: 'python -m pytest',
        title: 'Define Python test command',
        targetName: 'test',
        files: ['Makefile', 'pyproject.toml'],
      },
      quality: {
        command: 'python -m ruff check .',
        title: 'Define Python quality command',
        targetName: 'quality',
        files: ['Makefile', 'pyproject.toml'],
        limitations: [
          'Ensure ruff is declared in project dev dependencies before enforcing in CI.',
        ],
      },
      security: {
        command: 'python -m pip_audit',
        title: 'Define Python security audit command',
        targetName: 'security',
        files: ['Makefile', 'pyproject.toml'],
        limitations: [
          'Ensure pip-audit is available in the project toolchain before enforcing in CI.',
        ],
      },
    },
    go: {
      test: {
        command: 'go test ./...',
        title: 'Define Go test command',
        targetName: 'test',
        files: ['Makefile', 'go.mod'],
      },
      quality: {
        command: 'gofmt -w .',
        title: 'Define Go formatting command',
        targetName: 'quality',
        files: ['Makefile', 'go.mod'],
        limitations: [
          'Use CI-specific check mode if formatting should not mutate files in pipelines.',
        ],
      },
      security: {
        command: 'govulncheck ./...',
        title: 'Define Go vulnerability scan command',
        targetName: 'security',
        files: ['Makefile', 'go.mod'],
        limitations: ['Ensure govulncheck is installed or provisioned by CI before enforcing.'],
      },
    },
    rust: {
      test: {
        command: 'cargo test',
        title: 'Define Rust test command',
        targetName: 'test',
        files: ['Makefile', 'Cargo.toml'],
      },
      quality: {
        command: 'cargo fmt -- --check && cargo clippy --all-targets -- -D warnings',
        title: 'Define Rust quality command',
        targetName: 'quality',
        files: ['Makefile', 'Cargo.toml'],
      },
      security: {
        command: 'cargo audit',
        title: 'Define Rust security audit command',
        targetName: 'security',
        files: ['Makefile', 'Cargo.toml'],
        limitations: ['Ensure cargo-audit is installed or provisioned by CI before enforcing.'],
      },
    },
    php: {
      test: {
        command: 'vendor/bin/phpunit',
        title: 'Define PHP test command',
        targetName: 'test',
        files: ['Makefile', 'composer.json'],
      },
      quality: {
        command: 'vendor/bin/phpstan analyse',
        title: 'Define PHP static analysis command',
        targetName: 'quality',
        files: ['Makefile', 'composer.json'],
        limitations: ['Ensure phpstan is declared in require-dev before enforcing in CI.'],
      },
      security: {
        command: 'composer audit',
        title: 'Define Composer security audit command',
        targetName: 'security',
        files: ['Makefile', 'composer.json'],
      },
    },
    ruby: {
      test: {
        command: 'bundle exec rspec',
        title: 'Define Ruby test command',
        targetName: 'test',
        files: ['Makefile', 'Gemfile'],
        limitations: [
          'Use bundle exec ruby -Itest when the project uses minitest instead of RSpec.',
        ],
      },
      quality: {
        command: 'bundle exec rubocop',
        title: 'Define Ruby quality command',
        targetName: 'quality',
        files: ['Makefile', 'Gemfile'],
      },
      security: {
        command: 'bundle exec bundler-audit check',
        title: 'Define Ruby security audit command',
        targetName: 'security',
        files: ['Makefile', 'Gemfile'],
        limitations: ['Ensure bundler-audit is installed or provisioned by CI before enforcing.'],
      },
    },
    dotnet: {
      test: {
        command: 'dotnet test',
        title: 'Define .NET test command',
        targetName: 'test',
        files: ['Makefile', '*.sln', '*.csproj'],
      },
      quality: {
        command: 'dotnet format --verify-no-changes',
        title: 'Define .NET formatting gate',
        targetName: 'quality',
        files: ['Makefile', '*.sln', '*.csproj'],
      },
      security: {
        command: 'dotnet list package --vulnerable',
        title: 'Define .NET package vulnerability check',
        targetName: 'security',
        files: ['Makefile', '*.sln', '*.csproj'],
      },
    },
    java: {
      test: {
        command: 'mvn test',
        title: 'Define Java test command',
        targetName: 'test',
        files: ['Makefile', 'pom.xml', 'build.gradle', 'build.gradle.kts'],
        limitations: ['Use ./gradlew test when the project is Gradle-first.'],
      },
      quality: {
        command: 'mvn verify',
        title: 'Define Java verification command',
        targetName: 'quality',
        files: ['Makefile', 'pom.xml', 'build.gradle', 'build.gradle.kts'],
        limitations: ['Use ./gradlew check when the project is Gradle-first.'],
      },
      security: {
        command: 'mvn org.owasp:dependency-check-maven:check',
        title: 'Define Java dependency vulnerability check',
        targetName: 'security',
        files: ['Makefile', 'pom.xml'],
        limitations: [
          'Review OWASP dependency-check policy and cache behavior before enforcing in CI.',
        ],
      },
    },
    elixir: {
      test: {
        command: 'mix test',
        title: 'Define Elixir test command',
        targetName: 'test',
        files: ['Makefile', 'mix.exs'],
      },
      quality: {
        command: 'mix format --check-formatted && mix credo --strict',
        title: 'Define Elixir quality command',
        targetName: 'quality',
        files: ['Makefile', 'mix.exs', '.formatter.exs', 'credo.exs'],
        limitations: ['Ensure Credo is declared before enforcing the strict quality command.'],
      },
      security: {
        command: 'mix hex.audit',
        title: 'Define Hex dependency audit command',
        targetName: 'security',
        files: ['Makefile', 'mix.exs', 'mix.lock'],
      },
    },
    clojure: {
      test: {
        command: 'clojure -M:test',
        title: 'Define Clojure test command',
        targetName: 'test',
        files: ['Makefile', 'deps.edn', 'project.clj'],
        limitations: ['Align the alias with the test runner declared by the project.'],
      },
      quality: {
        command: 'clj-kondo --lint src test',
        title: 'Define Clojure quality command',
        targetName: 'quality',
        files: ['Makefile', 'deps.edn', 'project.clj'],
        limitations: ['Ensure clj-kondo is provisioned before enforcing this command in CI.'],
      },
      security: {
        command: 'clojure -Stree',
        title: 'Define Clojure dependency inspection command',
        targetName: 'security',
        files: ['Makefile', 'deps.edn', 'project.clj'],
        limitations: [
          'Pair dependency-tree inspection with the vulnerability scanner selected by the organization.',
        ],
      },
    },
    scala: {
      test: {
        command: 'sbt test',
        title: 'Define Scala test command',
        targetName: 'test',
        files: ['Makefile', 'build.sbt'],
      },
      quality: {
        command: 'sbt scalafmtCheckAll scalafixAll',
        title: 'Define Scala quality command',
        targetName: 'quality',
        files: ['Makefile', 'build.sbt', '.scalafmt.conf'],
        limitations: ['Declare Scalafmt and Scalafix plugins before enforcing this command.'],
      },
      security: {
        command: 'sbt dependencyTree',
        title: 'Define Scala dependency inspection command',
        targetName: 'security',
        files: ['Makefile', 'build.sbt'],
        limitations: ['Pair dependency inspection with the organization vulnerability scanner.'],
      },
    },
    kotlin: {
      test: {
        command: './gradlew test',
        title: 'Define Kotlin test command',
        targetName: 'test',
        files: ['Makefile', 'build.gradle', 'build.gradle.kts'],
      },
      quality: {
        command: './gradlew check',
        title: 'Define Kotlin quality command',
        targetName: 'quality',
        files: ['Makefile', 'build.gradle', 'build.gradle.kts'],
      },
      security: {
        command: './gradlew dependencies',
        title: 'Define Kotlin dependency inspection command',
        targetName: 'security',
        files: ['Makefile', 'build.gradle', 'build.gradle.kts'],
        limitations: ['Pair dependency inspection with the organization vulnerability scanner.'],
      },
    },
    c: {
      test: {
        command: 'ctest --test-dir build --output-on-failure',
        title: 'Define C test command',
        targetName: 'test',
        files: ['Makefile', 'CMakeLists.txt'],
      },
      quality: {
        command: 'clang-tidy src/**/*.c --',
        title: 'Define C quality command',
        targetName: 'quality',
        files: ['Makefile', 'CMakeLists.txt', '.clang-tidy'],
        limitations: ['Align source globs and compile database with the project build.'],
      },
      security: {
        command: 'cmake --build build --target sbom',
        title: 'Define C dependency evidence command',
        targetName: 'security',
        files: ['Makefile', 'CMakeLists.txt'],
        limitations: ['Declare the SBOM target or replace it with the organization scanner.'],
      },
    },
    cpp: {
      test: {
        command: 'ctest --test-dir build --output-on-failure',
        title: 'Define C++ test command',
        targetName: 'test',
        files: ['Makefile', 'CMakeLists.txt'],
      },
      quality: {
        command: 'clang-tidy src/**/*.cpp --',
        title: 'Define C++ quality command',
        targetName: 'quality',
        files: ['Makefile', 'CMakeLists.txt', '.clang-tidy'],
        limitations: ['Align source globs and compile database with the project build.'],
      },
      security: {
        command: 'cmake --build build --target sbom',
        title: 'Define C++ dependency evidence command',
        targetName: 'security',
        files: ['Makefile', 'CMakeLists.txt'],
        limitations: ['Declare the SBOM target or replace it with the organization scanner.'],
      },
    },
  };

  return makefileByRuntime[input.runtime]?.[input.kind] ?? null;
}

async function buildMakefileCommandRepairCapability(input: {
  issueId: string;
  projectPath: string;
  contract: RuntimeCommandContract;
  reason: string;
}): Promise<DoctorRepairCapability> {
  return buildMakefileTargetRepairCapability({
    issueId: input.issueId,
    title: input.contract.title,
    projectPath: input.projectPath,
    targetName: input.contract.targetName,
    command: input.contract.command,
    reason: input.reason,
    risk: 'guarded' as const,
    requiresReview: true,
    limitations: input.contract.limitations,
  });
}

async function buildRuntimeCommandRepairCapability(input: {
  issueId: string;
  projectPath: string;
  runtime: DoctorSurfaceRuntimeFamily;
  kind: RuntimeCommandContractKind;
  packageJsonData?: Record<string, unknown> | null;
  reason: string;
}): Promise<DoctorRepairCapability | undefined> {
  const contract = runtimeCommandContract({
    runtime: input.runtime,
    kind: input.kind,
    projectPath: input.projectPath,
    packageJsonData: input.packageJsonData,
  });
  if (!contract) return undefined;

  if ((input.runtime === 'node' || input.runtime === 'bun') && input.packageJsonData) {
    return buildPackageScriptRepairCapability({
      issueId: input.issueId,
      title: contract.title,
      projectPath: input.projectPath,
      scriptName: contract.targetName,
      scriptValue: contract.command,
      reason: input.reason,
      risk: 'guarded',
      limitations: contract.limitations,
    });
  }

  return buildMakefileCommandRepairCapability({
    issueId: input.issueId,
    projectPath: input.projectPath,
    contract,
    reason: input.reason,
  });
}

function buildManualRepair(input: {
  issueId: string;
  title: string;
  projectPath: string;
  files: string[];
  reason: string;
  limitations?: string[];
}): DoctorRepairCapability {
  return {
    id: `${input.issueId}.manual`,
    issueId: input.issueId,
    title: input.title,
    status: 'manual',
    fixKind: 'manual',
    risk: 'guarded',
    canAutoFix: false,
    canEditFiles: false,
    requiresApproval: true,
    requiresReview: true,
    files: input.files.map((file) => path.join(input.projectPath, file)),
    refreshCommands: ['npx workspai doctor project --json', 'npx workspai workspace verify --json'],
    reason: input.reason,
    limitations: input.limitations,
  };
}

function buildDockerignoreRepair(projectPath: string): DoctorRepairCapability {
  return buildFileCreateRepairCapability({
    issueId: 'surface-dockerignore',
    title: 'Create .dockerignore',
    projectPath,
    relativePath: '.dockerignore',
    content: `${DEFAULT_DOCKERIGNORE}\n`,
    reason:
      'Create a Docker build ignore baseline to keep secrets, dependencies, and reports out of container contexts.',
  });
}

async function buildGitignoreRepair(projectPath: string): Promise<DoctorRepairCapability> {
  if (!(await fsExtra.pathExists(path.join(projectPath, '.gitignore')))) {
    return buildFileCreateRepairCapability({
      issueId: 'surface-security-hygiene',
      title: 'Create .gitignore secret baseline',
      projectPath,
      relativePath: '.gitignore',
      content: `${DEFAULT_SECRET_GITIGNORE_LINES.join('\n')}\n`,
      reason: 'Create a minimal ignore baseline so local env files are not committed accidentally.',
    });
  }

  const existing = await readTextIfExists(path.join(projectPath, '.gitignore'));
  const missingLines = DEFAULT_SECRET_GITIGNORE_LINES.filter(
    (line) => !existing.split(/\r?\n/).includes(line)
  );

  return buildFileAppendRepairCapability({
    issueId: 'surface-security-hygiene',
    title: 'Append .gitignore secret baseline',
    projectPath,
    relativePath: '.gitignore',
    lines: missingLines,
    reason: 'Append missing env-file ignore rules so local secrets stay out of source control.',
  });
}

async function buildDependencyContractProbe(input: {
  projectPath: string;
  runtime: DoctorSurfaceRuntimeFamily;
  packageJsonData?: Record<string, unknown> | null;
}): Promise<DoctorSurfaceProbe | null> {
  const manifests = DEPENDENCY_MANIFESTS[input.runtime] ?? [];
  const lockfiles = DEPENDENCY_LOCKFILES[input.runtime] ?? [];
  if (manifests.length === 0 && lockfiles.length === 0) {
    return null;
  }

  const hasManifest = await anyPathExists(input.projectPath, manifests);
  const hasLockfile = await anyPathExists(input.projectPath, lockfiles);
  const dependencyRepair =
    hasManifest && !hasLockfile
      ? await inferDependencyBaselineRepair({
          projectPath: input.projectPath,
          runtime: input.runtime,
          packageJsonData: input.packageJsonData,
        })
      : null;

  return {
    id: 'surface-dependency-contract',
    label: 'Dependency contract',
    status: !hasManifest || hasLockfile ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: !hasManifest
      ? 'No dependency manifest markers detected for this runtime.'
      : hasLockfile
        ? 'Dependency manifest and deterministic lock/baseline markers detected.'
        : `Dependency manifest detected, but no deterministic baseline found (${lockfiles.join(', ')}).`,
    recommendation:
      hasManifest && !hasLockfile
        ? 'Generate and commit the runtime-native lockfile or package baseline before release.'
        : undefined,
    repairCapability:
      hasManifest && !hasLockfile && dependencyRepair
        ? buildCommandRepairCapability({
            issueId: 'surface-dependency-contract',
            title: dependencyRepair.title,
            projectPath: input.projectPath,
            command: dependencyRepair.command,
            files: dependencyRepair.files,
            fixKind: 'dependency-sync',
            reason:
              'Generate the runtime-native dependency baseline so CI, Doctor, and Studio share deterministic dependency evidence.',
            limitations: dependencyRepair.limitations,
          })
        : undefined,
  };
}

async function buildEnvContractProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe> {
  const envExampleExists = await fsExtra.pathExists(path.join(input.projectPath, '.env.example'));
  const envExists = await fsExtra.pathExists(path.join(input.projectPath, '.env'));
  const envDocsExist =
    (await fsExtra.pathExists(path.join(input.projectPath, 'docs', 'env.md'))) ||
    (await fsExtra.pathExists(path.join(input.projectPath, 'ENVIRONMENT.md')));
  const configDirExists = await fsExtra.pathExists(path.join(input.projectPath, 'config'));
  const hasContract = envExampleExists || envDocsExist || configDirExists;
  const frontend = input.projectKind === 'frontend';
  const environmentKeys = hasContract
    ? []
    : await collectEnvironmentContractKeys(input.projectPath);
  const environmentContractRequired = envExists || environmentKeys.length > 0;
  const contractNotApplicable = !hasContract && !environmentContractRequired;
  const generatedExample = environmentKeys.map((key) => `${key}=`).join('\n');

  return {
    id: 'surface-env-contract',
    label: 'Environment/config contract',
    status: hasContract || contractNotApplicable ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    applicability: contractNotApplicable ? 'not-applicable' : 'applicable',
    reason: hasContract
      ? 'Environment/config contract marker detected.'
      : contractNotApplicable
        ? 'No runtime environment-variable usage was detected; an environment contract is not currently applicable.'
        : frontend
          ? 'No frontend environment contract marker detected.'
          : 'No environment/config contract marker detected.',
    recommendation:
      hasContract || contractNotApplicable
        ? undefined
        : 'Add .env.example, config schema, or environment documentation for deterministic setup.',
    repairCapability: hasContract
      ? envExampleExists && !envExists
        ? buildFileCopyRepairCapability({
            issueId: 'surface-env-contract',
            title: 'Create local .env from .env.example',
            projectPath: input.projectPath,
            sourceRelativePath: '.env.example',
            targetRelativePath: '.env',
            reason:
              'Seed the local environment file from the reviewed example without overwriting an existing .env.',
          })
        : undefined
      : contractNotApplicable
        ? undefined
        : environmentKeys.length > 0
          ? buildFileCreateRepairCapability({
              issueId: 'surface-env-contract',
              title: 'Create environment contract skeleton',
              projectPath: input.projectPath,
              relativePath: '.env.example',
              content: `${generatedExample}\n`,
              reason:
                'Create a secret-free .env.example from environment keys observed in source. Values remain empty for project-owner review.',
              limitations: [
                'Only variable names are copied; secrets and local values are never read into the generated contract.',
                'Review required and optional variables before committing the example.',
              ],
            })
          : buildManualRepair({
              issueId: 'surface-env-contract',
              title: 'Define environment contract',
              projectPath: input.projectPath,
              files: ['.env.example'],
              reason:
                'A local .env exists, but no safe variable names could be inferred. Review the required keys before publishing an example.',
            }),
  };
}

async function buildContainerProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe> {
  const dockerfileExists = await fsExtra.pathExists(path.join(input.projectPath, 'Dockerfile'));
  const dockerignoreExists = await fsExtra.pathExists(
    path.join(input.projectPath, '.dockerignore')
  );
  const composeExists =
    (await fsExtra.pathExists(path.join(input.projectPath, 'docker-compose.yml'))) ||
    (await fsExtra.pathExists(path.join(input.projectPath, 'compose.yml')));

  if (dockerfileExists) {
    return {
      id: 'surface-dockerignore',
      label: 'Container build context hygiene',
      status: dockerignoreExists ? 'pass' : 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: dockerignoreExists
        ? 'Dockerfile and .dockerignore detected.'
        : 'Dockerfile detected without .dockerignore.',
      recommendation: dockerignoreExists
        ? undefined
        : 'Add .dockerignore to exclude dependencies, reports, git metadata, and local env files from image builds.',
      repairCapability: dockerignoreExists ? undefined : buildDockerignoreRepair(input.projectPath),
    };
  }

  return {
    id: 'surface-container-contract',
    label: 'Container contract',
    status: 'pass',
    severity: 'warn',
    scope: 'project-scoped',
    applicability: composeExists ? 'applicable' : 'not-applicable',
    reason: composeExists
      ? 'Compose surface detected; project has a local container orchestration baseline.'
      : 'No container intent was detected; a container contract is not currently applicable.',
  };
}

async function buildKubernetesProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe> {
  const manifestCandidates = [
    'k8s',
    'kubernetes',
    'deploy',
    'deployments',
    'charts',
    'helm',
    'kustomization.yaml',
    'kustomization.yml',
  ];
  const hasSurface = await anyPathExists(input.projectPath, manifestCandidates);
  if (!hasSurface) {
    const documentedOrManagedDeployment = [
      'DEPLOYMENT.md',
      'docs/deployment.md',
      'docs/deploy.md',
      'Procfile',
      'fly.toml',
      'render.yaml',
      'railway.json',
      'vercel.json',
      'netlify.toml',
      'serverless.yml',
      'serverless.yaml',
      'sst.config.ts',
      'cdk.json',
      'terraform',
      'infra',
    ];
    const hasAlternativeSurface = await anyPathExists(
      input.projectPath,
      documentedOrManagedDeployment
    );
    return {
      id: 'surface-deploy-contract',
      label: 'Deployment contract',
      status: 'pass',
      severity: 'warn',
      scope: 'project-scoped',
      applicability: hasAlternativeSurface ? 'applicable' : 'not-applicable',
      reason: hasAlternativeSurface
        ? 'A documented or provider-managed non-Kubernetes deployment surface was detected.'
        : 'No deployment intent was detected; a deployment contract is not currently applicable.',
    };
  }

  const manifestText = await collectTextFromExisting(input.projectPath, [
    'k8s/deployment.yaml',
    'k8s/deployment.yml',
    'kubernetes/deployment.yaml',
    'deploy/deployment.yaml',
    'deployment.yaml',
    'deployment.yml',
    'values.yaml',
    'charts/values.yaml',
  ]);
  const hasProbe = /readinessProbe|livenessProbe|startupProbe/.test(manifestText);
  const hasResources = /resources:\s*[\s\S]*(limits:|requests:)/.test(manifestText);
  const healthy = hasProbe && hasResources;

  return {
    id: 'surface-kubernetes-readiness',
    label: 'Deployment readiness controls',
    status: healthy ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: healthy
      ? 'Deployment surface includes probe and resource-control markers.'
      : 'Deployment surface detected, but readiness/liveness probes or resource controls are incomplete.',
    recommendation: healthy
      ? undefined
      : 'Add readiness/liveness/startup probes and resource requests/limits to production deployment manifests.',
    repairCapability: healthy
      ? undefined
      : buildManualRepair({
          issueId: 'surface-kubernetes-readiness',
          title: 'Harden deployment readiness controls',
          projectPath: input.projectPath,
          files: ['k8s/', 'helm/', 'deploy/'],
          reason:
            'Deployment manifests are environment-specific and should be reviewed before mutation.',
        }),
  };
}

async function buildSecurityHygieneProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe> {
  const gitignoreExists = await fsExtra.pathExists(path.join(input.projectPath, '.gitignore'));
  const gitignoreText = await readTextIfExists(path.join(input.projectPath, '.gitignore'));
  const gitignoreLines = gitignoreText.split(/\r?\n/);
  const gitignoreCoversSecrets =
    gitignoreExists &&
    DEFAULT_SECRET_GITIGNORE_LINES.every((line) => gitignoreLines.includes(line));
  const packageScripts = scriptsFromPackageJson(input.packageJsonData);
  const hasAuditScript = Boolean(
    packageScripts.audit ||
    packageScripts['security:audit'] ||
    packageScripts['audit:security'] ||
    packageScripts['npm:audit']
  );
  const dependencyAudit = input.dependencyAudit;
  const vulnerabilityCount = Number(
    dependencyAudit?.blockingFindingCount ??
      dependencyAudit?.findingCount ??
      input.vulnerabilities ??
      0
  );
  const hasVulnerabilities = vulnerabilityCount > 0;
  const auditIsClean = dependencyAudit?.status === 'clean';
  const auditIsUnavailable =
    dependencyAudit?.status === 'tool-unavailable' ||
    dependencyAudit?.status === 'unsupported' ||
    dependencyAudit?.status === 'failed';
  const runtime = normalizeRuntime(input.runtimeFamily);
  const npmShrinkwrapExists = await fsExtra.pathExists(
    path.join(input.projectPath, 'npm-shrinkwrap.json')
  );
  const vulnerabilityFiles = [
    'package.json',
    'package-lock.json',
    ...(npmShrinkwrapExists ? ['npm-shrinkwrap.json'] : []),
  ];
  const auditInvocation = dependencyAudit?.invocation;
  const remediationDisposition = dependencyAudit?.remediation?.disposition;
  const resolutionCandidateCount = dependencyAudit?.remediation?.resolutionCandidates?.length ?? 0;
  const compatibleFixAuthorized =
    remediationDisposition === 'compatible' ||
    remediationDisposition === 'mixed' ||
    (!dependencyAudit && runtime === 'node');
  const safeFixInvocation =
    hasVulnerabilities &&
    compatibleFixAuthorized &&
    (dependencyAudit?.tool === 'npm audit' || (!dependencyAudit && runtime === 'node'))
      ? {
          cwd: input.projectPath,
          executable: 'npm',
          args: ['audit', 'fix', '--audit-level=moderate'],
        }
      : hasVulnerabilities && compatibleFixAuthorized && dependencyAudit?.tool === 'bun audit'
        ? {
            cwd: input.projectPath,
            executable: 'bun',
            args: ['update'],
          }
        : hasVulnerabilities && compatibleFixAuthorized && dependencyAudit?.tool === 'deno audit'
          ? {
              cwd: input.projectPath,
              executable: 'deno',
              args: ['audit', '--fix'],
            }
          : undefined;
  const vulnerabilityStrategy: DoctorRepairStrategyStage[] | undefined = hasVulnerabilities
    ? [
        {
          id: 'audit-live-state',
          kind: 'diagnose' as const,
          description:
            'Read the current advisory graph and classify direct, transitive, fixable, and breaking findings.',
          risk: 'safe' as const,
          invocation: auditInvocation,
          continueWhen: 'always',
        },
        ...(safeFixInvocation
          ? [
              {
                id: 'apply-compatible-fixes',
                kind: 'safe-fix' as const,
                description:
                  'Apply runtime-authored compatible dependency and lockfile updates without forcing breaking upgrades.',
                risk: 'guarded' as const,
                invocation: safeFixInvocation,
                continueWhen: 'previous-passed' as const,
              },
            ]
          : []),
        {
          id: 'upgrade-owning-dependencies',
          kind: 'targeted-upgrade' as const,
          description:
            'Upgrade the smallest set of direct dependencies that own unresolved advisory paths, then run tests and build.',
          risk: 'guarded' as const,
          continueWhen: safeFixInvocation ? 'blocker-remains' : 'always',
        },
        {
          id: 'recheck-advisory-graph',
          kind: 'verify' as const,
          description: 'Re-run the runtime-native audit and retain only unresolved advisory paths.',
          risk: 'safe' as const,
          invocation: auditInvocation,
          continueWhen: 'blocker-remains',
        },
        {
          id: 'review-unfixable-advisories',
          kind: 'exception-review' as const,
          description:
            'For advisories without a compatible fix, require a time-bounded policy exception or an explicit replacement plan.',
          risk: 'invasive' as const,
          continueWhen: 'manual-decision',
        },
      ]
    : undefined;
  const vulnerabilityRepair =
    hasVulnerabilities && safeFixInvocation
      ? buildCommandRepairCapability({
          issueId: 'surface-security-hygiene',
          title: `Apply compatible ${dependencyAudit?.ecosystem ?? runtime} vulnerability fixes`,
          projectPath: input.projectPath,
          command: [safeFixInvocation.executable, ...safeFixInvocation.args].join(' '),
          invocation: {
            executable: safeFixInvocation.executable,
            args: safeFixInvocation.args,
          },
          strategy: vulnerabilityStrategy,
          transaction: {
            schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
            kind: 'dependency-security',
            state: 'planned',
            projectPath: input.projectPath,
            ecosystem: dependencyAudit?.ecosystem ?? safeFixInvocation.executable ?? runtime,
            requiredStages: ['reconcile', 'audit', 'test', 'build'],
            completion: {
              manifestLockConsistent: true,
              auditClean: true,
              declaredTestsPass: true,
              declaredBuildPass: true,
              canonicalVerificationRequired: true,
            },
          },
          files: vulnerabilityFiles,
          reason:
            'Apply runtime-authored compatible vulnerability remediations, then regenerate Doctor and release-readiness evidence.',
          risk: 'guarded',
          requiresReview: true,
          limitations: [
            'Never add --force automatically; unresolved advisories require an evidence-backed dependency upgrade plan.',
            'Review lockfile changes and rerun the complete Workspace Intelligence verification loop.',
          ],
        })
      : undefined;

  const auditUnavailableRepair = auditIsUnavailable
    ? buildManualRepair({
        issueId: 'surface-security-hygiene',
        title: `Establish ${dependencyAudit?.ecosystem ?? runtime} security audit evidence`,
        projectPath: input.projectPath,
        files: Array.from(
          new Set([
            ...(DEPENDENCY_MANIFESTS[runtime] ?? []),
            ...(DEPENDENCY_LOCKFILES[runtime] ?? []),
            ...(runtime === 'node' ? ['package.json'] : []),
            ...(runtime === 'python' ? ['pyproject.toml', 'requirements.txt'] : []),
          ])
        ),
        reason: `${dependencyAudit?.tool ?? 'The runtime-native audit tool'} is unavailable. Add or declare the audit tool in the project's governed dependency/tooling surface, then rerun Doctor.`,
        limitations: [
          'Do not install an unpinned global scanner as an implicit repair.',
          'The selected project environment and CI must resolve the same audit command.',
        ],
      })
    : undefined;

  const pass = gitignoreCoversSecrets && auditIsClean;
  const auditReason = dependencyAudit?.reason;
  return {
    id: 'surface-security-hygiene',
    label: 'Security hygiene surface',
    status: pass ? 'pass' : hasVulnerabilities ? 'fail' : 'warn',
    severity: hasVulnerabilities ? 'error' : 'warn',
    scope: 'project-scoped',
    reason: hasVulnerabilities
      ? `${vulnerabilityCount} moderate/high/critical dependency vulnerability(ies) reported.`
      : auditIsUnavailable
        ? `${auditReason} Doctor did not treat unavailable audit evidence as a clean result.`
        : gitignoreCoversSecrets && auditIsClean
          ? 'Repository ignore baseline covers env-file secrets and the runtime-native dependency audit is clean.'
          : gitignoreCoversSecrets
            ? 'Repository ignore baseline covers env-file secrets, but no current dependency audit evidence is available.'
            : gitignoreExists
              ? 'Repository ignore baseline exists, but env-file secret rules are incomplete.'
              : 'No .gitignore baseline detected for local secrets/build artifacts.',
    recommendation: hasVulnerabilities
      ? resolutionCandidateCount > 0 && !compatibleFixAuthorized
        ? `No direct automatic fix is currently authorized. Evaluate the ${resolutionCandidateCount} structured dependency resolution candidate(s) through a guarded reconcile, audit, test, and build transaction before considering a breaking change.`
        : remediationDisposition === 'breaking-only' || remediationDisposition === 'none'
          ? resolutionCandidateCount > 0
            ? `No direct automatic fix is currently available. Evaluate the ${resolutionCandidateCount} structured dependency resolution candidate(s) through a guarded install, audit, test, and build transaction before considering a breaking change.`
            : 'No compatible automatic fix is currently available. Review an explicit replacement, a time-bounded exception, or wait for an upstream patch.'
          : 'Run the runtime-native audit fix path without force, review lockfile changes, then rerun Doctor.'
      : auditIsUnavailable
        ? 'Install or declare the runtime-native audit tool, rerun Doctor, and keep the command available to CI and Studio.'
        : gitignoreCoversSecrets
          ? hasAuditScript
            ? undefined
            : 'Consider adding a security audit script for CI parity.'
          : 'Add .gitignore entries for env files, build output, dependency directories, and local reports.',
    repairCapability: hasVulnerabilities
      ? (vulnerabilityRepair ?? {
          ...buildManualRepair({
            issueId: 'surface-security-hygiene',
            title: `Resolve ${dependencyAudit?.ecosystem ?? runtime} dependency vulnerabilities`,
            projectPath: input.projectPath,
            files: [
              'package.json',
              'package-lock.json',
              'pnpm-lock.yaml',
              'yarn.lock',
              'pyproject.toml',
              'requirements.txt',
              'go.mod',
              'Cargo.toml',
              'composer.json',
              'Gemfile',
              'Directory.Packages.props',
            ],
            reason:
              remediationDisposition === 'breaking-only'
                ? resolutionCandidateCount > 0
                  ? 'The runtime-native direct fix is breaking or a downgrade. Doctor preserved bounded owner, constraint, or transitive resolution candidates for guarded compatibility verification before requesting an engineering decision.'
                  : 'The runtime-native audit exposes only breaking or downgrade remediation. Doctor requires an explicit engineering decision instead of presenting it as an automatic fix.'
                : remediationDisposition === 'none'
                  ? resolutionCandidateCount > 0
                    ? 'The runtime-native audit reports no direct fix. Evaluate its structured transitive or constraint resolution candidates through the dependency transaction before choosing replacement, exception, or upstream wait.'
                    : 'The runtime-native audit reports no available fix. Use an explicit replacement plan, time-bounded exception, or upstream patch.'
                  : 'Dependency remediation can change direct and transitive graphs; use the audit evidence to upgrade the owning dependencies.',
            limitations: [
              'Never force a breaking dependency upgrade automatically.',
              'Review lock or baseline changes, run project tests/build, then rerun the complete Workspace Intelligence verification loop.',
            ],
          }),
          strategy: vulnerabilityStrategy,
          transaction: {
            schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
            kind: 'dependency-security',
            state: 'planned',
            projectPath: input.projectPath,
            ecosystem: dependencyAudit?.ecosystem ?? safeFixInvocation?.executable ?? runtime,
            requiredStages: ['reconcile', 'audit', 'test', 'build'],
            completion: {
              manifestLockConsistent: true,
              auditClean: true,
              declaredTestsPass: true,
              declaredBuildPass: true,
              canonicalVerificationRequired: true,
            },
          },
        })
      : auditUnavailableRepair
        ? auditUnavailableRepair
        : gitignoreCoversSecrets
          ? undefined
          : await buildGitignoreRepair(input.projectPath),
  };
}

async function buildTestSurfaceProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe> {
  const runtime = normalizeRuntime(input.runtimeFamily);
  const hasTests = input.hasTests === true;
  const repairCapability = hasTests
    ? undefined
    : await buildRuntimeCommandRepairCapability({
        issueId: 'surface-test-contract',
        projectPath: input.projectPath,
        runtime,
        kind: 'test',
        packageJsonData: input.packageJsonData,
        reason:
          'Create a deterministic runtime-native test command contract so Doctor, CI, and Studio can verify changes consistently.',
      });
  return {
    id: 'surface-test-contract',
    label: 'Test contract',
    status: hasTests ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasTests
      ? 'Test surface detected through scripts, config, directories, or test files.'
      : 'No test surface detected by Doctor.',
    recommendation: hasTests
      ? undefined
      : 'Add at least one deterministic test command or test baseline before release.',
    repairCapability:
      repairCapability ??
      (hasTests
        ? undefined
        : buildManualRepair({
            issueId: 'surface-test-contract',
            title: 'Define test contract',
            projectPath: input.projectPath,
            files: ['package.json', 'pyproject.toml', 'go.mod', 'pom.xml'],
            reason:
              'Doctor can identify missing test surfaces, but the correct test runner depends on product intent.',
          })),
  };
}

async function buildTestCoverageEvidenceProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe> {
  const evidencePath = path.join(
    input.projectPath,
    '.workspai',
    'reports',
    'project-test-coverage-last-run.json'
  );
  const evidence = (await fsExtra.readJson(evidencePath).catch(() => null)) as {
    schemaVersion?: string;
    status?: 'passed' | 'below-target' | 'unavailable' | 'failed';
    target?: { metric?: string; percent?: number };
    metrics?: Record<string, { percent?: number | null }>;
    lowCoverageFiles?: Array<{ path?: string; percent?: number | null }>;
  } | null;
  const valid =
    evidence?.schemaVersion ===
    WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectTestCoverage.schemaVersion;
  if (!valid) {
    return {
      id: 'test-coverage-evidence',
      label: 'Test coverage evidence',
      status: 'warn',
      severity: 'warn',
      scope: 'project-scoped',
      reason: 'No normalized project coverage evidence has been generated yet.',
      recommendation:
        'Run project coverage once to establish a measurable baseline before selecting a coverage goal.',
      repairCapability: buildCommandRepairCapability({
        issueId: 'test-coverage-evidence',
        title: 'Generate project coverage baseline',
        projectPath: input.projectPath,
        command: 'npx workspai project coverage --run --json',
        invocation: {
          executable: 'npx',
          args: ['workspai', 'project', 'coverage', '--run', '--json'],
        },
        files: [WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectTestCoverage],
        reason:
          'Run the runtime-native test coverage adapter and publish normalized evidence for Doctor, CI, Studio, and IDE consumers.',
        risk: 'safe',
        requiresReview: false,
      }),
    };
  }

  const metricName = evidence.target?.metric ?? 'lines';
  const target = finiteNumber(evidence.target?.percent);
  const percent = evidence.metrics?.[metricName]?.percent;
  const display = typeof percent === 'number' ? `${percent}%` : 'unavailable';
  const status =
    evidence.status === 'passed'
      ? 'pass'
      : evidence.status === 'below-target' || evidence.status === 'failed'
        ? 'fail'
        : 'warn';
  return {
    id: 'test-coverage-evidence',
    label: 'Test coverage evidence',
    status,
    severity: status === 'fail' ? 'error' : 'warn',
    scope: 'project-scoped',
    reason:
      evidence.status === 'passed'
        ? `${metricName} coverage ${display} satisfies the ${target}% project target.`
        : evidence.status === 'below-target'
          ? `${metricName} coverage ${display} is below the ${target}% project target.`
          : evidence.status === 'failed'
            ? 'The runtime-native coverage command failed; the target cannot be verified.'
            : 'Coverage evidence exists, but no supported metric could be normalized.',
    recommendation:
      evidence.status === 'passed'
        ? undefined
        : evidence.status === 'below-target'
          ? `Add targeted tests for the lowest-coverage source paths, then rerun project coverage with target ${target}%.`
          : 'Repair the runtime-native coverage command or reporter and regenerate evidence.',
    repairCapability:
      evidence.status === 'passed'
        ? undefined
        : buildManualRepair({
            issueId: 'test-coverage-evidence',
            title: 'Reach the project coverage goal',
            projectPath: input.projectPath,
            files: [
              WORKSPACE_SUPPLEMENTAL_ARTIFACTS.projectTestCoverage,
              ...(evidence.lowCoverageFiles ?? [])
                .map((file) => file.path)
                .filter((file): file is string => typeof file === 'string')
                .slice(0, 20),
            ],
            reason:
              'Test creation requires source-aware assertions. Studio should use the normalized low-coverage paths, edit tests, and rerun the same target until verified.',
            limitations: [
              'Do not lower thresholds, exclude difficult source files, remove assertions, or skip failing tests to satisfy the goal.',
            ],
          }),
  };
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function buildFormatSurfaceProbe(input: SurfaceInput): DoctorSurfaceProbe {
  const scripts = scriptsFromPackageJson(input.packageJsonData);
  const hasFormatScript = Boolean(scripts.format || scripts['format:check'] || scripts.prettier);
  return {
    id: 'surface-format-contract',
    label: 'Format contract',
    status: hasFormatScript ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasFormatScript
      ? 'Format script detected in package.json.'
      : 'No explicit format script detected by Doctor.',
    recommendation: hasFormatScript
      ? undefined
      : 'Add a formatter command or document the formatting tool used by CI.',
  };
}

async function buildRuntimeTestDepthProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe | null> {
  const runtime = normalizeRuntime(input.runtimeFamily);
  const markersByRuntime: Record<DoctorSurfaceRuntimeFamily, string[]> = {
    node: [
      'test',
      'tests',
      '__tests__',
      'vitest.config.ts',
      'vitest.config.js',
      'vitest.config.mts',
      'vitest.config.mjs',
      'jest.config.ts',
      'jest.config.js',
      'jest.config.cjs',
      'jest.config.mjs',
      'playwright.config.ts',
      'playwright.config.js',
      'cypress.config.ts',
      'cypress.config.js',
      '*.spec.ts',
      '*.spec.js',
      '*.test.ts',
      '*.test.js',
    ],
    deno: ['deno.json', 'deno.jsonc'],
    bun: ['bunfig.toml', 'test', 'tests', '*.test.ts', '*.spec.ts'],
    python: ['pytest.ini', 'tox.ini', 'noxfile.py', 'tests', 'test', 'conftest.py', '*_test.py'],
    go: ['*_test.go'],
    java: ['src/test', '*Test.java', '*Tests.java', '*IT.java'],
    rust: ['tests', '*_test.rs'],
    elixir: ['test', '*_test.exs'],
    clojure: ['test', '*_test.clj', '*_test.cljc'],
    php: ['phpunit.xml', 'phpunit.xml.dist', 'tests'],
    ruby: ['spec', 'test', '.rspec'],
    dotnet: ['*.Tests.csproj', '*.Test.csproj', '*Tests.cs'],
    scala: ['src/test', '*Spec.scala', '*Suite.scala'],
    kotlin: ['src/test', '*Test.kt', '*Tests.kt'],
    c: ['test', 'tests', '*_test.c', 'test_*.c'],
    cpp: ['test', 'tests', '*_test.cpp', 'test_*.cpp', '*Test.cpp'],
    unknown: [],
  };
  const markers = markersByRuntime[runtime] ?? [];
  if (markers.length === 0) return null;

  const hasRuntimeMarker = await anyPathExists(input.projectPath, markers);
  const scripts = scriptsFromPackageJson(input.packageJsonData);
  const scriptText = Object.values(scripts).join('\n');
  const manifestText = await collectTextFromExisting(input.projectPath, [
    'pyproject.toml',
    'Cargo.toml',
    'mix.exs',
    'deps.edn',
    'project.clj',
    'composer.json',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'deno.json',
    'deno.jsonc',
  ]);
  const commandSignalByRuntime: Partial<Record<DoctorSurfaceRuntimeFamily, RegExp>> = {
    node: /\b(jest|vitest|mocha|ava|tap|playwright|cypress|node\s+--test|bun\s+test)\b/i,
    bun: /\bbun\s+test\b/i,
    deno: /\bdeno\s+test\b/i,
    python: /\b(pytest|unittest|tox|nox)\b/i,
    java: /\b(junit|testng|surefire|failsafe|gradle[^]*\btest\b)\b/i,
    rust: /\b(cargo\s+test|dev-dependencies)\b/i,
    elixir: /\b(ex_unit|mix\s+test)\b/i,
    clojure: /\b(clojure\.test|kaocha|eftest)\b/i,
    php: /\b(phpunit|pestphp|pest)\b/i,
    ruby: /\b(rspec|minitest)\b/i,
    dotnet: /\b(Microsoft\.NET\.Test\.Sdk|xunit|nunit|mstest)\b/i,
    scala: /\b(scalatest|munit|specs2|sbt\s+test)\b/i,
    kotlin: /\b(kotest|junit|gradle[^]*\btest\b)\b/i,
    c: /\b(ctest|cmocka|criterion|unity)\b/i,
    cpp: /\b(ctest|catch2|gtest|googletest|doctest)\b/i,
  };
  const commandSignal =
    commandSignalByRuntime[runtime]?.test(`${scriptText}\n${manifestText}`) ?? false;
  const pass = input.hasTests === true && (hasRuntimeMarker || commandSignal);
  return {
    id: 'runtime-test-depth',
    label: 'Runtime-native test depth',
    status: pass ? 'pass' : input.hasTests ? 'warn' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: pass
      ? 'Runtime-native test markers detected.'
      : input.hasTests
        ? 'Generic test surface detected, but runtime-native test markers are incomplete.'
        : 'No runtime-native test markers detected.',
    recommendation: pass
      ? undefined
      : 'Add runtime-native tests/config so Doctor, CI, and Studio can verify changes deterministically.',
  };
}

async function buildRuntimeQualityProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe | null> {
  const runtime = normalizeRuntime(input.runtimeFamily);
  const markersByRuntime: Record<DoctorSurfaceRuntimeFamily, string[]> = {
    node: [
      'eslint.config.js',
      'eslint.config.cjs',
      'eslint.config.mjs',
      'eslint.config.ts',
      'eslint.config.mts',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
      '.prettierrc',
      '.prettierrc.json',
      'biome.json',
      'biome.jsonc',
    ],
    deno: ['deno.json', 'deno.jsonc'],
    bun: ['eslint.config.js', 'biome.json', 'bunfig.toml'],
    python: ['ruff.toml', 'pyproject.toml', '.flake8', 'mypy.ini', 'Makefile'],
    go: ['.golangci.yml', '.golangci.yaml', 'Makefile'],
    java: ['checkstyle.xml', 'pom.xml', 'build.gradle', 'build.gradle.kts'],
    rust: ['rustfmt.toml', 'clippy.toml', 'Cargo.toml'],
    elixir: ['.formatter.exs', 'credo.exs', 'mix.exs'],
    clojure: ['cljfmt.edn', '.clj-kondo', 'deps.edn'],
    php: ['phpcs.xml', 'phpstan.neon', 'pint.json', 'composer.json'],
    ruby: ['.rubocop.yml', 'Gemfile'],
    dotnet: ['.editorconfig', 'Directory.Build.props', 'global.json'],
    scala: ['.scalafmt.conf', '.scalafix.conf', 'build.sbt'],
    kotlin: ['.editorconfig', 'detekt.yml', 'build.gradle', 'build.gradle.kts'],
    c: ['.clang-format', '.clang-tidy', 'CMakeLists.txt'],
    cpp: ['.clang-format', '.clang-tidy', 'CMakeLists.txt'],
    unknown: [],
  };
  const markers = markersByRuntime[runtime] ?? [];
  if (markers.length === 0) return null;

  const text = await collectTextFromExisting(input.projectPath, [
    ...markers,
    'package.json',
    'pyproject.toml',
    'Makefile',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Cargo.toml',
    'mix.exs',
    'deps.edn',
    'project.clj',
    'composer.json',
    'Gemfile',
    'Directory.Build.props',
  ]);
  const scripts = scriptsFromPackageJson(input.packageJsonData);
  const scriptText = Object.entries(scripts)
    .filter(([name]) => /lint|format|quality|check|typecheck|static/i.test(name))
    .map(([, value]) => value)
    .join('\n');
  const hasConfigMarker = await anyPathExists(input.projectPath, markers);
  const hasToolSignal =
    /eslint|prettier|biome|ruff|black|mypy|golangci|checkstyle|spotless|pmd|clippy|rustfmt|credo|clj-kondo|phpstan|phpcs|pint|rubocop|editorconfig|dotnet format|scalafmt|scalafix|detekt|ktlint|clang-tidy|clang-format/i.test(
      `${text}\n${scriptText}`
    ) || hasConfigMarker;
  const repairCapability = hasToolSignal
    ? undefined
    : await buildRuntimeCommandRepairCapability({
        issueId: 'runtime-quality-tooling',
        projectPath: input.projectPath,
        runtime,
        kind: 'quality',
        packageJsonData: input.packageJsonData,
        reason:
          'Create a deterministic runtime-native quality command contract so CI and Studio can verify formatting/static-analysis consistently.',
      });

  return {
    id: 'runtime-quality-tooling',
    label: 'Runtime-native quality tooling',
    status: hasToolSignal ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasToolSignal
      ? 'Runtime-native lint/format/static-analysis markers detected.'
      : 'No runtime-native lint/format/static-analysis markers detected.',
    recommendation: hasToolSignal
      ? undefined
      : 'Add runtime-native lint/format/static-analysis tooling and expose it to CI.',
    repairCapability,
  };
}

async function buildRuntimeSecurityProbe(input: SurfaceInput): Promise<DoctorSurfaceProbe | null> {
  const runtime = normalizeRuntime(input.runtimeFamily);
  const markersByRuntime: Record<DoctorSurfaceRuntimeFamily, string[]> = {
    node: ['package.json'],
    deno: ['deno.json', 'deno.jsonc'],
    bun: ['package.json', 'bunfig.toml'],
    python: ['pyproject.toml', 'requirements.txt', 'Makefile'],
    go: ['Makefile', 'go.mod'],
    java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    rust: ['Cargo.toml'],
    elixir: ['mix.exs'],
    clojure: ['deps.edn', 'project.clj'],
    php: ['composer.json'],
    ruby: ['Gemfile', '.bundler-audit.yml'],
    dotnet: ['Directory.Build.props', '*.csproj'],
    scala: ['build.sbt', 'project/plugins.sbt'],
    kotlin: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
    c: ['CMakeLists.txt', 'conanfile.py', 'conanfile.txt', 'vcpkg.json'],
    cpp: ['CMakeLists.txt', 'conanfile.py', 'conanfile.txt', 'vcpkg.json'],
    unknown: [],
  };
  const markers = markersByRuntime[runtime] ?? [];
  if (markers.length === 0) return null;

  const text = await collectTextFromExisting(input.projectPath, markers);
  const hasSecurityTool =
    /npm audit|pnpm audit|yarn audit|bun audit|pip[-_]audit|safety|bandit|govulncheck|gosec|dependency-check|owasp|cargo audit|mix hex.audit|composer audit|bundler-audit|brakeman|NuGetAudit|dotnet list package --vulnerable|dependencyCheck|dependency-check|snyk|trivy|osv-scanner|cyclonedx|sbom/i.test(
      text
    );
  const repairCapability = hasSecurityTool
    ? undefined
    : await buildRuntimeCommandRepairCapability({
        issueId: 'runtime-security-tooling',
        projectPath: input.projectPath,
        runtime,
        kind: 'security',
        packageJsonData: input.packageJsonData,
        reason:
          'Create a deterministic runtime-native security audit command contract so CI and Studio can verify dependency risk consistently.',
      });

  return {
    id: 'runtime-security-tooling',
    label: 'Runtime-native security tooling',
    status: hasSecurityTool ? 'pass' : 'warn',
    severity: 'warn',
    scope: 'project-scoped',
    reason: hasSecurityTool
      ? 'Runtime-native security audit tooling marker detected.'
      : 'No runtime-native security audit tooling marker detected.',
    recommendation: hasSecurityTool
      ? undefined
      : 'Expose a runtime-native dependency/security audit command for CI and Studio verification.',
    repairCapability: hasSecurityTool
      ? undefined
      : repairCapability
        ? repairCapability
        : buildManualRepair({
            issueId: 'runtime-security-tooling',
            title: 'Define runtime security audit command',
            projectPath: input.projectPath,
            files: ['package.json', 'pyproject.toml', 'Makefile', 'pom.xml', 'Cargo.toml'],
            reason:
              'Security tooling differs by runtime and organization policy; Doctor records the missing contract for review.',
          }),
  };
}

export async function buildEnterpriseSurfaceProbes(
  input: SurfaceInput
): Promise<DoctorSurfaceProbe[]> {
  const runtime = normalizeRuntime(input.runtimeFamily);
  const probes: DoctorSurfaceProbe[] = [];
  const dependencyProbe = await buildDependencyContractProbe({
    projectPath: input.projectPath,
    runtime,
    packageJsonData: input.packageJsonData,
  });
  if (dependencyProbe) probes.push(dependencyProbe);

  probes.push(await buildEnvContractProbe(input));
  probes.push(await buildContainerProbe(input));
  probes.push(await buildKubernetesProbe(input));
  probes.push(await buildSecurityHygieneProbe(input));
  probes.push(await buildTestSurfaceProbe(input));
  probes.push(await buildTestCoverageEvidenceProbe(input));

  if (runtime === 'node' || runtime === 'bun') {
    probes.push(buildFormatSurfaceProbe(input));
  }

  const runtimeProbes = await Promise.all([
    buildRuntimeTestDepthProbe(input),
    buildRuntimeQualityProbe(input),
    buildRuntimeSecurityProbe(input),
  ]);
  for (const probe of runtimeProbes) {
    if (probe) probes.push(probe);
  }

  return probes;
}
