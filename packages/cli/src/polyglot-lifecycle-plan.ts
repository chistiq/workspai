import fs from 'fs';
import path from 'path';

export const POLYGLOT_LIFECYCLE_PLAN_SCHEMA_VERSION = 'polyglot-lifecycle-plan.v1' as const;

export type PolyglotLifecycleStage = {
  stage: 'init' | 'test' | 'build' | 'start';
  command: string;
  confidence: 'high' | 'medium';
  preflight: 'executable-and-inputs' | 'executable';
};

export type PolyglotRuntimeUnit = {
  id: string;
  runtime:
    | 'node'
    | 'bun'
    | 'deno'
    | 'python'
    | 'go'
    | 'rust'
    | 'java'
    | 'kotlin'
    | 'scala'
    | 'clojure'
    | 'dotnet'
    | 'php'
    | 'ruby'
    | 'elixir'
    | 'c'
    | 'cpp';
  ecosystem:
    | 'npm'
    | 'bun'
    | 'deno'
    | 'python'
    | 'go'
    | 'cargo'
    | 'maven'
    | 'gradle'
    | 'sbt'
    | 'clojure-cli'
    | 'nuget'
    | 'composer'
    | 'bundler'
    | 'mix'
    | 'cmake'
    | 'meson';
  role: 'production' | 'tooling' | 'test' | 'example';
  root: string;
  manifest: string;
  stages: PolyglotLifecycleStage[];
};

export type PolyglotLifecyclePlan = {
  schemaVersion: typeof POLYGLOT_LIFECYCLE_PLAN_SCHEMA_VERSION;
  projectRoot: '.';
  polyglot: boolean;
  runtimes: string[];
  units: PolyglotRuntimeUnit[];
};

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.workspai',
  '.rapidkit',
  '.venv',
  'bin',
  'build',
  'dist',
  'node_modules',
  'obj',
  'target',
  'third_party',
  'vendor',
  'fixture',
  'fixtures',
  '__fixtures__',
  'testdata',
]);

function portableRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

function listManifests(root: string, maxDepth: number): string[] {
  const manifests: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) visit(target, depth + 1);
        continue;
      }
      if (
        entry.isFile() &&
        ([
          'package.json',
          'deno.json',
          'deno.jsonc',
          'pyproject.toml',
          'go.mod',
          'Cargo.toml',
          'pom.xml',
          'build.gradle',
          'build.gradle.kts',
          'build.sbt',
          'deps.edn',
          'composer.json',
          'Gemfile',
          'mix.exs',
          'CMakeLists.txt',
          'meson.build',
        ].includes(entry.name) ||
          /\.(?:cs|fs|vb)proj$/i.test(entry.name))
      ) {
        manifests.push(target);
      }
    }
  };
  visit(root, 0);
  return manifests;
}

/**
 * Test repositories frequently embed package.json fixtures that describe the
 * input under test, not executable lifecycle units. Treating each nested
 * fixture as a real npm project creates unsafe install plans and overwhelms
 * project-level orchestration with false positives.
 */
function isNestedTestFixtureManifest(projectRoot: string, manifest: string): boolean {
  if (path.basename(manifest) !== 'package.json') return false;
  const segments = portableRelative(projectRoot, manifest).toLowerCase().split('/');
  const testIndex = segments.findIndex((segment) =>
    ['test', 'tests', 'spec', 'specs', 'e2e', 'integration', 'integration-tests'].includes(segment)
  );
  if (testIndex < 0) return false;
  // A direct tests/package.json may be the actual test harness. Anything
  // nested below that boundary is overwhelmingly fixture input.
  return segments.length - testIndex > 2;
}

/**
 * A Gradle settings file defines a single multi-project build boundary. Nested
 * build.gradle files inside that boundary are subprojects executed by the root
 * wrapper, not hundreds of independent lifecycle roots. Keeping them as units
 * duplicates work, bypasses the wrapper, and can make fleet plans unsafe.
 */
function isNestedGradleSubproject(projectRoot: string, manifest: string): boolean {
  const name = path.basename(manifest);
  if (name !== 'build.gradle' && name !== 'build.gradle.kts') return false;
  if (path.dirname(manifest) === projectRoot) return false;
  return (
    fs.existsSync(path.join(projectRoot, 'settings.gradle')) ||
    fs.existsSync(path.join(projectRoot, 'settings.gradle.kts'))
  );
}

function stage(
  name: PolyglotLifecycleStage['stage'],
  command: string,
  confidence: PolyglotLifecycleStage['confidence'] = 'high'
): PolyglotLifecycleStage {
  return { stage: name, command, confidence, preflight: 'executable-and-inputs' };
}

function nodeStages(root: string, contents: string): PolyglotLifecycleStage[] {
  let scripts: Record<string, unknown> = {};
  try {
    const payload = JSON.parse(contents) as { scripts?: unknown };
    if (payload.scripts && typeof payload.scripts === 'object' && !Array.isArray(payload.scripts)) {
      scripts = payload.scripts as Record<string, unknown>;
    }
  } catch {
    // The install stage remains usable for a malformed scripts object.
  }
  const runner =
    fs.existsSync(path.join(root, 'bun.lock')) ||
    fs.existsSync(path.join(root, 'bun.lockb')) ||
    fs.existsSync(path.join(root, 'bunfig.toml')) ||
    fs.existsSync(path.join(root, '.bunfig.toml'))
      ? 'bun'
      : fs.existsSync(path.join(root, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : fs.existsSync(path.join(root, 'yarn.lock'))
          ? 'yarn'
          : 'npm';
  const run = (name: string): string => `${runner} run ${name}`;
  return [
    stage('init', runner === 'yarn' ? 'yarn install' : `${runner} install`),
    ...(typeof scripts.test === 'string' ? [stage('test', run('test'))] : []),
    ...(typeof scripts.build === 'string' ? [stage('build', run('build'))] : []),
    ...(typeof scripts.start === 'string' ? [stage('start', run('start'))] : []),
  ];
}

function manifestUnit(projectRoot: string, manifest: string): PolyglotRuntimeUnit | null {
  const name = path.basename(manifest);
  const root = path.dirname(manifest);
  const relativeRoot = portableRelative(projectRoot, root);
  const relativeManifest = portableRelative(projectRoot, manifest);
  const segments = relativeManifest.toLowerCase().split('/');
  const role: PolyglotRuntimeUnit['role'] = segments.some((segment) =>
    ['example', 'examples', 'sample', 'samples', 'worked'].includes(segment)
  )
    ? 'example'
    : segments.some((segment) =>
          ['test', 'tests', 'e2e', 'integration', 'integration-tests'].includes(segment)
        )
      ? 'test'
      : segments.some((segment) =>
            ['script', 'scripts', 'tool', 'tools', 'tooling'].includes(segment)
          )
        ? 'tooling'
        : 'production';
  let contents = '';
  try {
    contents = fs.readFileSync(manifest, 'utf8');
  } catch {
    return null;
  }
  let runtime: PolyglotRuntimeUnit['runtime'];
  let ecosystem: PolyglotRuntimeUnit['ecosystem'];
  let stages: PolyglotLifecycleStage[];
  if (name === 'package.json') {
    const bunOwned =
      fs.existsSync(path.join(root, 'bun.lock')) ||
      fs.existsSync(path.join(root, 'bun.lockb')) ||
      fs.existsSync(path.join(root, 'bunfig.toml')) ||
      fs.existsSync(path.join(root, '.bunfig.toml'));
    runtime = bunOwned ? 'bun' : 'node';
    ecosystem = bunOwned ? 'bun' : 'npm';
    stages = nodeStages(root, contents);
  } else if (name === 'deno.json' || name === 'deno.jsonc') {
    runtime = 'deno';
    ecosystem = 'deno';
    let tasks: Record<string, unknown> = {};
    try {
      const payload = JSON.parse(contents) as { tasks?: unknown };
      if (payload.tasks && typeof payload.tasks === 'object' && !Array.isArray(payload.tasks)) {
        tasks = payload.tasks as Record<string, unknown>;
      }
    } catch {
      // JSONC configuration remains a valid Deno boundary even when comments
      // prevent conservative JSON parsing; only evidence-backed defaults emit.
    }
    stages = [
      ...(typeof tasks.test === 'string'
        ? [stage('test', 'deno task test')]
        : [stage('test', 'deno test', 'medium')]),
      ...(typeof tasks.build === 'string' ? [stage('build', 'deno task build')] : []),
      ...(typeof tasks.start === 'string'
        ? [stage('start', 'deno task start')]
        : typeof tasks.dev === 'string'
          ? [stage('start', 'deno task dev', 'medium')]
          : []),
    ];
  } else if (name === 'pyproject.toml') {
    runtime = 'python';
    ecosystem = 'python';
    stages = [
      stage('init', 'python -m pip install -e .'),
      ...(fs.existsSync(path.join(root, 'tests')) || /\[tool\.pytest/i.test(contents)
        ? [stage('test', 'python -m pytest')]
        : []),
      ...(/\[build-system\]/.test(contents) ? [stage('build', 'python -m build', 'medium')] : []),
    ];
  } else if (name === 'go.mod') {
    runtime = 'go';
    ecosystem = 'go';
    stages = [
      stage('init', 'go mod download'),
      stage('test', 'go test ./...'),
      stage('build', 'go build ./...'),
    ];
  } else if (name === 'Cargo.toml') {
    runtime = 'rust';
    ecosystem = 'cargo';
    stages = [
      stage('init', 'cargo fetch'),
      stage('test', 'cargo test'),
      stage('build', 'cargo build'),
      ...(fs.existsSync(path.join(root, 'src', 'main.rs')) ? [stage('start', 'cargo run')] : []),
    ];
  } else if (name === 'pom.xml') {
    runtime = 'java';
    ecosystem = 'maven';
    const runner = fs.existsSync(path.join(root, 'mvnw')) ? './mvnw' : 'mvn';
    stages = [
      stage('init', `${runner} dependency:go-offline`),
      stage('test', `${runner} test`),
      stage('build', `${runner} package`),
    ];
  } else if (name === 'build.gradle' || name === 'build.gradle.kts') {
    runtime = /(?:kotlin|org\.jetbrains\.kotlin)/i.test(contents) ? 'kotlin' : 'java';
    ecosystem = 'gradle';
    const runner = fs.existsSync(path.join(root, 'gradlew')) ? './gradlew' : 'gradle';
    stages = [
      stage('init', `${runner} dependencies`),
      stage('test', `${runner} test`),
      stage('build', `${runner} build`),
    ];
  } else if (name === 'build.sbt') {
    runtime = 'scala';
    ecosystem = 'sbt';
    stages = [
      stage('init', 'sbt update'),
      stage('test', 'sbt test'),
      stage('build', 'sbt compile'),
    ];
  } else if (name === 'deps.edn') {
    runtime = 'clojure';
    ecosystem = 'clojure-cli';
    stages = [
      stage('init', 'clojure -P'),
      ...(/:test\b/.test(contents) ? [stage('test', 'clojure -X:test', 'medium')] : []),
    ];
  } else if (/\.(?:cs|fs|vb)proj$/i.test(name)) {
    runtime = 'dotnet';
    ecosystem = 'nuget';
    const testProject =
      role === 'test' ||
      /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(contents) ||
      /PackageReference\s+Include=["']Microsoft\.NET\.Test\.Sdk["']/i.test(contents);
    stages = [
      stage('init', `dotnet restore ${name}`),
      ...(testProject ? [stage('test', `dotnet test ${name}`)] : []),
      stage('build', `dotnet build ${name}`),
    ];
  } else if (name === 'composer.json') {
    runtime = 'php';
    ecosystem = 'composer';
    let scripts: Record<string, unknown> = {};
    try {
      const payload = JSON.parse(contents) as { scripts?: unknown };
      if (
        payload.scripts &&
        typeof payload.scripts === 'object' &&
        !Array.isArray(payload.scripts)
      ) {
        scripts = payload.scripts as Record<string, unknown>;
      }
    } catch {
      // Composer install remains an evidence-backed stage for malformed script metadata.
    }
    stages = [
      stage('init', 'composer install'),
      ...(typeof scripts.test !== 'undefined'
        ? [stage('test', 'composer test')]
        : fs.existsSync(path.join(root, 'vendor', 'bin', 'phpunit')) ||
            fs.existsSync(path.join(root, 'phpunit.xml')) ||
            fs.existsSync(path.join(root, 'phpunit.xml.dist'))
          ? [stage('test', 'vendor/bin/phpunit', 'medium')]
          : []),
      ...(typeof scripts.build !== 'undefined' ? [stage('build', 'composer build')] : []),
      ...(typeof scripts.start !== 'undefined' ? [stage('start', 'composer start')] : []),
    ];
  } else if (name === 'Gemfile') {
    runtime = 'ruby';
    ecosystem = 'bundler';
    const railsExecutable = fs.existsSync(path.join(root, 'bin', 'rails'));
    const rails = railsExecutable || /\bgem\s+['\"]rails['\"]/.test(contents);
    const rspec =
      fs.existsSync(path.join(root, 'spec')) || /\bgem\s+['\"]rspec(?:-rails)?['\"]/.test(contents);
    const railsTests = fs.existsSync(path.join(root, 'test'));
    stages = [
      stage('init', 'bundle install'),
      ...(railsTests && rails
        ? [stage('test', 'bundle exec rails test')]
        : rspec
          ? [stage('test', 'bundle exec rspec')]
          : fs.existsSync(path.join(root, 'Rakefile'))
            ? [stage('test', 'bundle exec rake test', 'medium')]
            : []),
      ...(railsExecutable ? [stage('start', 'bundle exec rails server')] : []),
    ];
  } else if (name === 'mix.exs') {
    runtime = 'elixir';
    ecosystem = 'mix';
    stages = [
      stage('init', 'mix deps.get'),
      stage('test', 'mix test'),
      stage('build', 'mix compile'),
      ...(/(?:phoenix|phx\.server)/i.test(contents) ? [stage('start', 'mix phx.server')] : []),
    ];
  } else if (name === 'CMakeLists.txt') {
    runtime = /(?:\bcxx\b|\bcplusplus\b|\bc\+\+\b)/iu.test(contents) ? 'cpp' : 'c';
    ecosystem = 'cmake';
    stages = [
      stage('init', 'cmake -S . -B build'),
      stage('test', 'ctest --test-dir build --output-on-failure', 'medium'),
      stage('build', 'cmake --build build'),
    ];
  } else if (name === 'meson.build') {
    runtime = /(?:cpp|c\+\+)/iu.test(contents) ? 'cpp' : 'c';
    ecosystem = 'meson';
    stages = [
      stage('init', 'meson setup build'),
      stage('test', 'meson test -C build', 'medium'),
      stage('build', 'meson compile -C build'),
    ];
  } else {
    return null;
  }
  return {
    id: `${runtime}:${relativeRoot}:${relativeManifest}`,
    runtime,
    ecosystem,
    role,
    root: relativeRoot,
    manifest: relativeManifest,
    stages,
  };
}

export function buildPolyglotLifecyclePlan(
  projectPath: string,
  options: { maxDepth?: number; includeExamples?: boolean } = {}
): PolyglotLifecyclePlan {
  const projectRoot = path.resolve(projectPath);
  const units = listManifests(projectRoot, Math.max(0, Math.min(options.maxDepth ?? 4, 12)))
    .filter((manifest) => !isNestedTestFixtureManifest(projectRoot, manifest))
    .filter((manifest) => !isNestedGradleSubproject(projectRoot, manifest))
    .map((manifest) => manifestUnit(projectRoot, manifest))
    .filter((unit): unit is PolyglotRuntimeUnit => Boolean(unit))
    .filter((unit) => options.includeExamples === true || unit.role !== 'example')
    .sort(
      (left, right) =>
        left.runtime.localeCompare(right.runtime) ||
        left.root.localeCompare(right.root) ||
        left.manifest.localeCompare(right.manifest)
    );
  const runtimes = [...new Set(units.map((unit) => unit.runtime))].sort();
  return {
    schemaVersion: POLYGLOT_LIFECYCLE_PLAN_SCHEMA_VERSION,
    projectRoot: '.',
    polyglot: runtimes.length > 1,
    runtimes,
    units,
  };
}
