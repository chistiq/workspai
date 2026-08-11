import fs from 'fs';
import path from 'path';

import { execa } from 'execa';
import {
  detectRuntimeCandidatesFromProject,
  normalizeBackendFrameworkLabel,
} from './utils/backend-framework-contract.js';
import {
  resolveNodeLifecycleScript,
  type NodeLifecycleCommand,
} from './utils/node-lifecycle-scripts.js';
import { formatNodeInstallCommand, formatNodeScriptCommand } from './utils/node-package-manager.js';

/**
 * Framework Registry for Workspace Run
 * Enterprise-grade registry for polyglot workspace orchestration.
 * Supports command overrides, multi-framework projects, custom stages,
 * error diagnostics, health checks, and preflight validation.
 */

export type RuntimeFamily =
  | 'python'
  | 'node'
  | 'go'
  | 'java'
  | 'php'
  | 'rust'
  | 'dotnet'
  | 'c'
  | 'cpp'
  | 'elixir'
  | 'ruby'
  | 'jvm-generic'
  | 'unknown';

export type WorkspaceRunStage = 'init' | 'test' | 'build' | 'start' | string;

/**
 * Error diagnostic categorization.
 * Helps distinguish between setup errors, test failures, runtime errors.
 */
export type ErrorCategory =
  'setup' | 'test-failure' | 'runtime' | 'dependency' | 'timeout' | 'unknown';

/**
 * Health check result after stage execution.
 */
export interface HealthCheckResult {
  healthy: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface FrameworkStageCommands {
  init?: string;
  test?: string;
  build?: string;
  start?: string;
  [customStage: string]: string | undefined;
}

export interface FrameworkMetadata {
  runtime: RuntimeFamily;
  framework: string;
  commands: FrameworkStageCommands;
  markers: string[];
  notes?: string;
  // Enterprise features
  errorPatterns?: Record<ErrorCategory, string[]>; // Regex patterns to detect error types
  healthCheck?: {
    // Post-stage health verification
    stage: WorkspaceRunStage; // Apply after this stage
    type: 'port' | 'http' | 'log' | 'command';
    value: string | number; // Port number, URL, log pattern, or command
  };
  dependencies?: WorkspaceRunStage[]; // Stages that must complete before this one
  validation?: {
    // Preflight checks
    command: string;
    error?: string;
  };
}

/**
 * Project-level override for framework commands.
 * Stored in .workspai/context.json under 'commands' key.
 */
export interface ProjectCommandOverrides {
  [stage: string]: string | EnvironmentVariant;
}

export interface EnvironmentVariant {
  dev?: string;
  staging?: string;
  prod?: string;
  default?: string;
}

/**
 * Supported frameworks and their stage commands.
 * Commands use runtime-native executables (php, cargo, dotnet, mix, rails, etc.)
 * Includes error patterns, health checks, and validation rules.
 */
export const FRAMEWORK_REGISTRY: Record<string, FrameworkMetadata> = {
  // ─── Python Frameworks ───────────────────────────────────────────
  'python-fastapi': {
    runtime: 'python',
    framework: 'FastAPI',
    markers: ['pyproject.toml', 'fastapi'],
    commands: {
      init: 'python -m pip install -e .',
      test: 'pytest',
      build: 'python -m build',
      start: 'uvicorn main:app --reload',
    },
    errorPatterns: {
      setup: ['ModuleNotFoundError', 'No module named', 'pip: command not found'],
      'test-failure': ['FAILED', 'ERROR', 'test session started'],
      dependency: ['ImportError', 'missing.*dependency'],
      runtime: ['TypeError', 'AttributeError', 'ValueError'],
      timeout: ['timeout', 'Timeout', 'timed out'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'http',
      value: 'http://localhost:8000/docs',
    },
    validation: {
      command: 'python -m pip list | grep fastapi',
      error: 'FastAPI not installed',
    },
  },

  'python-django': {
    runtime: 'python',
    framework: 'Django',
    markers: ['manage.py', 'django'],
    commands: {
      init: 'python manage.py migrate',
      test: 'python manage.py test',
      build: 'python manage.py collectstatic --noinput',
      start: 'python manage.py runserver 0.0.0.0:8000',
    },
    errorPatterns: {
      setup: ['ModuleNotFoundError', 'ProgrammingError.*migrate'],
      'test-failure': ['FAILED', 'ERROR', 'Ran.*test'],
      dependency: ['ImportError', 'missing.*dependency'],
      runtime: ['DatabaseError', 'ImproperlyConfigured'],
      timeout: ['timeout', 'Timeout'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 8000,
    },
    dependencies: ['init'],
  },

  // ─── Node.js Frameworks ──────────────────────────────────────────
  'node-nestjs': {
    runtime: 'node',
    framework: 'NestJS',
    markers: ['package.json', '@nestjs/core'],
    commands: {
      init: 'npm install',
      test: 'npm run test',
      build: 'npm run build',
      start: 'npm run start',
    },
    errorPatterns: {
      setup: ['npm ERR!', 'ENOENT', 'not found'],
      'test-failure': ['Tests.*failed', 'FAIL', 'fail.*test'],
      dependency: ['Cannot find module', 'ERR_MODULE_NOT_FOUND'],
      runtime: ['TypeError', 'Error: ', 'ReferenceError'],
      timeout: ['timeout', 'TIMEOUT'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 3000,
    },
  },

  'node-express': {
    runtime: 'node',
    framework: 'Express',
    markers: ['package.json', 'express'],
    commands: {
      init: 'npm install',
      test: 'npm run test',
      build: 'npm run build',
      start: 'npm start',
    },
    errorPatterns: {
      setup: ['npm ERR!', 'ENOENT'],
      'test-failure': ['failed', 'FAIL'],
      dependency: ['Cannot find module'],
      runtime: ['Error', 'TypeError'],
      timeout: ['timeout'],
      unknown: [],
    },
  },

  // ─── Go Frameworks ───────────────────────────────────────────────
  'go-fiber': {
    runtime: 'go',
    framework: 'Fiber',
    markers: ['go.mod', 'fiber'],
    commands: {
      init: 'go mod download && go mod tidy',
      test: 'go test ./...',
      build: 'go build -o app .',
      start: './app',
    },
    errorPatterns: {
      setup: ['go: .*not found', 'cannot find', 'go mod tidy'],
      'test-failure': ['FAIL', '--- FAIL'],
      dependency: ['missing.*module'],
      runtime: ['panic', 'fatal', 'Error'],
      timeout: ['timeout', 'context deadline'],
      unknown: [],
    },
    dependencies: ['init'],
  },

  'go-gin': {
    runtime: 'go',
    framework: 'Gin',
    markers: ['go.mod', 'gin-gonic'],
    commands: {
      init: 'go mod download && go mod tidy',
      test: 'go test ./...',
      build: 'go build -o app .',
      start: './app',
    },
    errorPatterns: {
      setup: ['go: .*not found'],
      'test-failure': ['FAIL'],
      dependency: ['missing.*module'],
      runtime: ['panic'],
      timeout: ['timeout'],
      unknown: [],
    },
  },

  // ─── Java Frameworks ────────────────────────────────────────────
  'java-springboot': {
    runtime: 'java',
    framework: 'Spring Boot',
    markers: ['pom.xml', 'build.gradle', 'spring-boot'],
    commands: {
      init: 'mvn dependency:go-offline',
      test: 'mvn test',
      build: 'mvn package -DskipTests',
      start: 'mvn spring-boot:run',
    },
    errorPatterns: {
      setup: ['\\[ERROR\\]', 'BUILD FAILURE', 'missing dependencies'],
      'test-failure': ['\\[ERROR\\] Tests run:', 'BUILD FAILURE'],
      dependency: ['missing.*dependency'],
      runtime: ['Exception', 'Error', 'NullPointerException'],
      timeout: ['timeout', 'Timeout'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 8080,
    },
  },

  // ─── PHP Frameworks ─────────────────────────────────────────────
  'php-laravel': {
    runtime: 'php',
    framework: 'Laravel',
    markers: ['composer.json', 'artisan', 'app/Models'],
    commands: {
      init: 'composer install && php artisan migrate:fresh --seed',
      test: 'php artisan test',
      build: 'php artisan config:cache && php artisan route:cache && php artisan view:cache',
      start: 'php artisan serve --host=0.0.0.0 --port=8000',
    },
    errorPatterns: {
      setup: ['Composer.*lock', 'Fatal error', 'Class.*not found'],
      'test-failure': ['FAILED', 'Tests.*failed'],
      dependency: ['Class.*not found', 'require.*failed'],
      runtime: ['Fatal error', 'Exception', 'Error'],
      timeout: ['timeout', 'Timeout'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 8000,
    },
    dependencies: ['init'],
  },

  'php-symfony': {
    runtime: 'php',
    framework: 'Symfony',
    markers: ['composer.json', 'symfony.lock', 'bin/console'],
    commands: {
      init: 'composer install && php bin/console doctrine:database:create',
      test: 'php bin/phpunit',
      build: 'php bin/console cache:clear --env=prod',
      start: 'symfony serve --no-tls',
    },
    errorPatterns: {
      setup: ['Composer.*error', 'Fatal error'],
      'test-failure': ['FAILED', 'failure'],
      dependency: ['Class.*not found'],
      runtime: ['Fatal error', 'Exception'],
      timeout: ['timeout'],
      unknown: [],
    },
    dependencies: ['init'],
  },

  // ─── Rust Frameworks ────────────────────────────────────────────
  'rust-actix': {
    runtime: 'rust',
    framework: 'Actix-web',
    markers: ['Cargo.toml', 'actix'],
    commands: {
      init: 'cargo fetch',
      test: 'cargo test',
      build: 'cargo build --release',
      start: 'cargo run --release',
    },
    errorPatterns: {
      setup: ['error: .*could not find', 'failed.*download'],
      'test-failure': ['test result:', 'FAILED'],
      dependency: ['can.t find.*crate'],
      runtime: ['error\\[E', 'thread.*panicked'],
      timeout: ['timeout'],
      unknown: [],
    },
    validation: {
      command: 'cargo --version',
      error: 'Rust/Cargo not installed',
    },
  },

  'rust-axum': {
    runtime: 'rust',
    framework: 'Axum',
    markers: ['Cargo.toml', 'axum'],
    commands: {
      init: 'cargo fetch',
      test: 'cargo test',
      build: 'cargo build --release',
      start: 'cargo run --release',
    },
    errorPatterns: {
      setup: ['error: .*could not find'],
      'test-failure': ['test result:', 'FAILED'],
      dependency: ['can.t find.*crate'],
      runtime: ['error\\[E'],
      timeout: ['timeout'],
      unknown: [],
    },
  },

  'rust-rocket': {
    runtime: 'rust',
    framework: 'Rocket',
    markers: ['Cargo.toml', 'rocket'],
    commands: {
      init: 'cargo fetch',
      test: 'cargo test',
      build: 'cargo build --release',
      start: 'cargo run --release',
    },
    errorPatterns: {
      setup: ['error: .*could not find'],
      'test-failure': ['FAILED'],
      dependency: ['can.t find'],
      runtime: ['error\\[E'],
      timeout: ['timeout'],
      unknown: [],
    },
  },

  // ─── .NET Frameworks ────────────────────────────────────────────
  'dotnet-aspnetcore': {
    runtime: 'dotnet',
    framework: 'ASP.NET Core',
    markers: ['.csproj', '.sln', 'Program.cs'],
    commands: {
      init: 'dotnet restore',
      test: 'dotnet test',
      build: 'dotnet build -c Release',
      start: 'dotnet run',
    },
    errorPatterns: {
      setup: ['error CS', 'CSPROJ.*not found', 'NuGet.*restore'],
      'test-failure': ['Failed:.*test', 'FAILED'],
      dependency: ['error NU1101'],
      runtime: ['error CS', 'Exception'],
      timeout: ['timeout'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 5000,
    },
  },

  // ─── Elixir Frameworks ──────────────────────────────────────────
  'elixir-phoenix': {
    runtime: 'elixir',
    framework: 'Phoenix',
    markers: ['mix.exs', 'phoenix'],
    commands: {
      init: 'mix setup',
      test: 'mix test',
      build: 'mix compile --all-warnings',
      start: 'mix phx.server',
    },
    errorPatterns: {
      setup: ['\\*\\* \\(.*Error\\)', 'Mix.InstallError'],
      'test-failure': ['\\d+\\sfailed', 'FAILED'],
      dependency: ['dependencies are not available'],
      runtime: ['\\*\\* \\(', 'RuntimeError'],
      timeout: ['timeout'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 4000,
    },
    dependencies: ['init'],
  },

  // ─── Ruby Frameworks ────────────────────────────────────────────
  'ruby-rails': {
    runtime: 'ruby',
    framework: 'Rails',
    markers: ['Gemfile', 'config/application.rb', 'bin/rails'],
    commands: {
      init: 'bundle install && rails db:prepare',
      test: 'rails test',
      build: 'rails assets:precompile',
      start: 'rails server --binding=0.0.0.0 --port=3000',
    },
    errorPatterns: {
      setup: ['Bundler::.*Error', 'Gem::.*Error'],
      'test-failure': ['failures,', 'error,', 'FAILED'],
      dependency: ['Could not find.*gem'],
      runtime: ['Error', 'Exception', 'NoMethodError'],
      timeout: ['timeout'],
      unknown: [],
    },
    healthCheck: {
      stage: 'start',
      type: 'port',
      value: 3000,
    },
    dependencies: ['init'],
  },

  'ruby-sinatra': {
    runtime: 'ruby',
    framework: 'Sinatra',
    markers: ['Gemfile', 'app.rb', 'sinatra'],
    commands: {
      init: 'bundle install',
      test: 'rspec',
      build: 'echo "Sinatra apps don\'t require build"',
      start: 'ruby app.rb',
    },
    errorPatterns: {
      setup: ['Bundler.*Error', 'Gem.*Error'],
      'test-failure': ['failure', 'FAILED'],
      dependency: ['Could not find.*gem'],
      runtime: ['Error', 'NoMethodError'],
      timeout: ['timeout'],
      unknown: [],
    },
  },
};

/**
 * Fallback command patterns when framework is not explicitly mapped.
 * Tries common patterns based on stage and detected runtime.
 */
export const FALLBACK_PATTERNS: Record<WorkspaceRunStage, Record<RuntimeFamily, string[]>> = {
  init: {
    python: ['pip install -e .', 'poetry install', 'pip install -r requirements.txt'],
    node: ['npm install', 'pnpm install', 'yarn install'],
    go: ['go mod download && go mod tidy', 'go get ./...'],
    java: ['mvn dependency:go-offline', 'gradle dependencies'],
    php: ['composer install'],
    rust: ['cargo fetch'],
    dotnet: ['dotnet restore'],
    c: ['cmake -S . -B build'],
    cpp: ['cmake -S . -B build'],
    elixir: ['mix deps.get'],
    ruby: ['bundle install'],
    'jvm-generic': ['mvn dependency:go-offline', 'gradle dependencies'],
    unknown: [],
  },

  test: {
    python: ['pytest', 'python -m unittest', 'python -m pytest'],
    node: ['npm test', 'npm run test'],
    go: ['go test ./...', 'make test'],
    java: ['mvn test', 'gradle test'],
    php: ['php artisan test', 'phpunit', 'pest'],
    rust: ['cargo test'],
    dotnet: ['dotnet test'],
    c: ['ctest --test-dir build --output-on-failure'],
    cpp: ['ctest --test-dir build --output-on-failure'],
    elixir: ['mix test'],
    ruby: ['rspec', 'ruby -m minitest'],
    'jvm-generic': ['mvn test', 'gradle test'],
    unknown: [],
  },

  build: {
    python: ['python -m build', 'python setup.py build'],
    node: ['npm run build'],
    go: ['go build -o app .', 'go build ./...'],
    java: ['mvn package -DskipTests', 'gradle build -x test'],
    php: ['echo "PHP build: typically no build step"'],
    rust: ['cargo build --release'],
    dotnet: ['dotnet build -c Release'],
    c: ['cmake --build build'],
    cpp: ['cmake --build build'],
    elixir: ['mix compile'],
    ruby: ['gem build *.gemspec'],
    'jvm-generic': ['mvn package -DskipTests', 'gradle build'],
    unknown: [],
  },

  start: {
    python: ['python app.py', 'python main.py', 'uvicorn main:app --reload'],
    node: ['npm start', 'node index.js', 'node src/index.js'],
    go: ['./app', 'go run main.go', 'go run ./...'],
    java: ['mvn spring-boot:run', 'gradle bootRun', 'java -jar target/*.jar'],
    php: ['php -S 0.0.0.0:8000', 'php artisan serve'],
    rust: ['cargo run --release', './target/release/app'],
    dotnet: ['dotnet run'],
    c: [],
    cpp: [],
    elixir: ['mix phx.server', 'iex -S mix'],
    ruby: ['rails server', 'ruby app.rb', 'bundle exec puma'],
    'jvm-generic': ['java -jar *.jar', 'gradle run'],
    unknown: [],
  },
};

/**
 * Get stage command for a given runtime and framework.
 * Tries explicit mapping first, then fallback patterns.
 */
export function resolveFrameworkRegistryEntry(
  runtime: RuntimeFamily,
  framework: string | undefined
): FrameworkMetadata | undefined {
  if (framework) {
    const normalizedRaw = framework
      .trim()
      .toLowerCase()
      .replace(/[_.\s]+/g, '-');
    const canonicalFramework = normalizeBackendFrameworkLabel(framework);
    const registryFramework = (() => {
      if (canonicalFramework === 'gofiber') return 'fiber';
      if (canonicalFramework === 'gogin') return 'gin';
      if (canonicalFramework === 'dotnet') return 'aspnetcore';
      if (canonicalFramework !== 'unknown') return canonicalFramework;
      if (normalizedRaw === 'fiber') return 'fiber';
      if (normalizedRaw === 'aspnetcore' || normalizedRaw === 'asp-net-core') {
        return 'aspnetcore';
      }
      return normalizedRaw;
    })();

    const key = `${runtime}-${registryFramework}`;
    return FRAMEWORK_REGISTRY[key];
  }
  return undefined;
}

export function getStageCommand(
  runtime: RuntimeFamily,
  framework: string | undefined,
  stage: string
): string | undefined {
  // Exact match: php-laravel, rust-actix, etc.
  if (framework) {
    const entry = resolveFrameworkRegistryEntry(runtime, framework);
    if (entry && entry.commands[stage]) {
      return entry.commands[stage];
    }
  }

  if (['init', 'test', 'build', 'start'].includes(stage)) {
    const patterns =
      FALLBACK_PATTERNS[stage as 'init' | 'test' | 'build' | 'start']?.[runtime] ?? [];
    return patterns.length > 0 ? patterns[0] : undefined;
  }

  return undefined;
}

const WORKSPACE_STAGE_TO_NODE_LIFECYCLE: Partial<Record<WorkspaceRunStage, NodeLifecycleCommand>> =
  {
    test: 'test',
    build: 'build',
    start: 'start',
  };

/**
 * Resolve a workspace fleet stage command using project-aware lifecycle contracts.
 */
export function resolveWorkspaceStageCommand(input: {
  projectPath: string;
  runtime: RuntimeFamily;
  framework?: string;
  stage: WorkspaceRunStage;
}): string | undefined {
  if (input.stage === 'init') {
    if (input.runtime === 'node') {
      return formatNodeInstallCommand(input.projectPath);
    }
    return getStageCommand(input.runtime, input.framework, input.stage);
  }

  if (input.runtime === 'node') {
    const lifecycle = WORKSPACE_STAGE_TO_NODE_LIFECYCLE[input.stage];
    if (lifecycle) {
      const resolved = resolveNodeLifecycleScript(input.projectPath, lifecycle, {
        framework: input.framework,
      });
      if (resolved) {
        return formatNodeScriptCommand(input.projectPath, resolved.scriptName);
      }
    }
  }

  return getStageCommand(input.runtime, input.framework, input.stage);
}

/**
 * Detect runtime family from common file markers.
 * Returns all detected runtimes (primary and secondary).
 */
export function detectRuntimesFromMarkers(projectPath: string): {
  primary: RuntimeFamily;
  secondary: RuntimeFamily[];
} {
  const detected = detectRuntimeCandidatesFromProject(projectPath)
    .map((runtime): RuntimeFamily | null => {
      if (runtime === 'python') return 'python';
      if (runtime === 'node' || runtime === 'bun') return 'node';
      if (runtime === 'go') return 'go';
      if (runtime === 'java') return 'java';
      if (runtime === 'php') return 'php';
      if (runtime === 'rust') return 'rust';
      if (runtime === 'dotnet') return 'dotnet';
      if (runtime === 'elixir') return 'elixir';
      if (runtime === 'ruby') return 'ruby';
      if (runtime === 'clojure' || runtime === 'scala' || runtime === 'kotlin') {
        return 'jvm-generic';
      }
      return null;
    })
    .filter((runtime): runtime is RuntimeFamily => runtime !== null)
    .filter((runtime, index, all) => all.indexOf(runtime) === index);

  return {
    primary: detected.length > 0 ? detected[0] : 'unknown',
    secondary: detected.slice(1),
  };
}

/**
 * Legacy function for backward compatibility.
 * Use detectRuntimesFromMarkers() for full multi-framework support.
 */
export function detectRuntimeFromMarkers(projectPath: string): RuntimeFamily {
  return detectRuntimesFromMarkers(projectPath).primary;
}

/**
 * Categorize error output into semantic error type.
 * Helps distinguish between setup failures, test failures, and runtime errors.
 */
export function categorizeError(
  output: string,
  errorPatterns?: Record<ErrorCategory, string[]>
): ErrorCategory {
  if (!output) {
    return 'unknown';
  }

  if (!errorPatterns) {
    errorPatterns = {
      setup: ['ModuleNotFoundError', 'No module named', 'npm ERR!', 'error:', 'not found'],
      'test-failure': ['FAILED', 'FAIL', 'failed'],
      dependency: ['cannot find module', 'import.*error'],
      runtime: ['Exception', 'Error:', 'panic', 'TypeError'],
      timeout: ['timeout', 'Timeout', 'deadline exceeded'],
      unknown: [],
    };
  }

  for (const [category, patterns] of Object.entries(errorPatterns)) {
    for (const pattern of patterns) {
      if (new RegExp(pattern, 'i').test(output)) {
        return category as ErrorCategory;
      }
    }
  }

  return 'unknown';
}

/**
 * Validate that a command is available before execution.
 * Checks system executables and shell builtins.
 */
export async function validateCommand(command: string): Promise<{
  valid: boolean;
  reason?: string;
}> {
  // Parse command (handle pipes, &&, ||, etc.)
  const cmd = command
    .split(/[&|;]\s*/)[0]
    .trim()
    .split(/\s+/)[0];

  // Shell builtins that don't need validation
  const builtins = ['echo', 'cd', 'pwd', 'test', 'true', 'false', 'exit'];
  if (builtins.includes(cmd)) {
    return { valid: true };
  }

  try {
    // Try to find command using 'which' (Unix) or 'where' (Windows)
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const result = await execa(whichCmd, [cmd], { reject: false });
    if (result.exitCode === 0) {
      return { valid: true };
    }
  } catch {
    // Fall through
  }

  return {
    valid: false,
    reason: `Command '${cmd}' not found or not executable`,
  };
}

/**
 * Resolve the final command for a stage, applying overrides and environment variants.
 */
export function resolveStageCommand(
  baseCommand: string | undefined,
  overrides?: Record<string, string | EnvironmentVariant>,
  environment?: 'dev' | 'staging' | 'prod'
): string | undefined {
  return applyEnvironmentCommandVariant(baseCommand, overrides, environment);
}

/**
 * Apply environment-specific command variants without re-reading stage override keys.
 * Stage overrides must be resolved before calling this helper.
 */
export function applyEnvironmentCommandVariant(
  baseCommand: string | undefined,
  environmentVariants?: Record<string, string | EnvironmentVariant> | EnvironmentVariant,
  environment?: 'dev' | 'staging' | 'prod'
): string | undefined {
  if (!environmentVariants) {
    return baseCommand;
  }

  const variants: EnvironmentVariant =
    typeof environmentVariants === 'object' &&
    !Array.isArray(environmentVariants) &&
    ('dev' in environmentVariants ||
      'staging' in environmentVariants ||
      'prod' in environmentVariants ||
      'default' in environmentVariants) &&
    !Object.keys(environmentVariants).some((key) =>
      ['init', 'test', 'build', 'start'].includes(key)
    )
      ? (environmentVariants as EnvironmentVariant)
      : {};

  if (environment && typeof variants[environment] === 'string') {
    return variants[environment];
  }

  if (typeof variants.default === 'string') {
    return variants.default;
  }

  return baseCommand;
}

/**
 * Check health of a service after stage execution.
 * Supports port checks, HTTP health endpoints, log patterns, and custom commands.
 */
export async function checkHealth(
  healthConfig: FrameworkMetadata['healthCheck'],
  projectPath?: string
): Promise<HealthCheckResult> {
  if (!healthConfig) {
    return { healthy: true };
  }

  switch (healthConfig.type) {
    case 'port': {
      const port = healthConfig.value as number;
      try {
        const netModule = await import('net');
        return new Promise((resolve) => {
          const socket = new netModule.Socket();
          const timeout = 5000;

          socket.setTimeout(timeout);
          socket.on('connect', () => {
            socket.destroy();
            resolve({ healthy: true, reason: `Port ${port} is listening` });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({
              healthy: false,
              reason: `Port ${port} timeout after ${timeout}ms`,
            });
          });
          socket.on('error', (err: Error) => {
            socket.destroy();
            resolve({ healthy: false, reason: `Port ${port} error: ${String(err)}` });
          });

          socket.connect(port, 'localhost');
        });
      } catch (error) {
        return {
          healthy: false,
          reason: `Port check error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'http': {
      const url = healthConfig.value as string;
      let timeout: NodeJS.Timeout | undefined;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });
        return {
          healthy: response.status === 200,
          reason: `HTTP ${response.status}`,
          metadata: { status: response.status },
        };
      } catch (error) {
        return {
          healthy: false,
          reason: `HTTP check error: ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }

    case 'log': {
      const pattern = healthConfig.value as string;
      if (!projectPath) {
        return { healthy: true };
      }

      try {
        const logFile = [
          path.join(projectPath, '.workspai', 'last-run.log'),
          path.join(projectPath, '.rapidkit', 'last-run.log'),
        ].find((candidate) => fs.existsSync(candidate));
        if (logFile) {
          const content = fs.readFileSync(logFile, 'utf-8');
          const regex = new RegExp(pattern, 'i');
          return {
            healthy: regex.test(content),
            reason: regex.test(content) ? 'Log pattern found' : 'Log pattern not found',
          };
        }
        return { healthy: true, reason: 'No log file to check' };
      } catch (error) {
        return {
          healthy: false,
          reason: `Log check error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    case 'command': {
      const cmd = healthConfig.value as string;
      try {
        const result = await execa(cmd, [], {
          cwd: projectPath,
          reject: false,
          shell: true,
        });
        return {
          healthy: result.exitCode === 0,
          reason: result.exitCode === 0 ? 'Health check passed' : 'Health check failed',
          metadata: { exitCode: result.exitCode },
        };
      } catch (error) {
        return {
          healthy: false,
          reason: `Command check error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    default:
      return { healthy: true };
  }
}

/**
 * List all supported runtimes and frameworks.
 */
export function listSupportedFrameworks(): Array<{
  runtime: RuntimeFamily;
  framework: string;
  status: 'built-in' | 'experimental';
}> {
  const builtInRuntimes = new Set(['python', 'node', 'go', 'java']);

  return Object.entries(FRAMEWORK_REGISTRY).map(([, meta]) => ({
    runtime: meta.runtime,
    framework: meta.framework,
    status: builtInRuntimes.has(meta.runtime) ? 'built-in' : 'experimental',
  }));
}
