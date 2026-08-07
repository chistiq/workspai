export const WORKSPACE_REPAIR_CAPABILITIES_SCHEMA_VERSION =
  'workspai.workspace-repair-capabilities.v1' as const;

export type WorkspaceRepairAdapterId =
  | 'node'
  | 'python'
  | 'go'
  | 'rust'
  | 'php-composer'
  | 'ruby-bundler'
  | 'elixir-mix'
  | 'deno'
  | 'dotnet'
  | 'jvm-maven'
  | 'jvm-gradle'
  | 'clojure'
  | 'scala-sbt';

export type WorkspaceRepairAdapterCapability = {
  id: WorkspaceRepairAdapterId;
  ecosystem: string;
  manifests: string[];
  lockfiles: string[];
  packageManagers: string[];
  support: 'full' | 'conditional';
  stages: {
    reconcile: 'native' | 'conditional';
    audit: 'native' | 'conditional';
    test: 'native' | 'declared' | 'conditional';
    build: 'native' | 'declared' | 'conditional';
  };
  requiredToolFamilies: string[];
  limitation?: string;
};

/**
 * Canonical adapter inventory for the CLI-owned repair engine.
 *
 * `conditional` is deliberately not presented as full support: it means the
 * runtime needs a declared project command, an installed companion tool, or a
 * Doctor-provided audit invocation. Runtime inspection turns those conditions
 * into passed/failed preconditions before approval is possible.
 */
export const WORKSPACE_REPAIR_ADAPTER_CAPABILITIES: readonly WorkspaceRepairAdapterCapability[] = [
  {
    id: 'node',
    ecosystem: 'JavaScript / TypeScript',
    manifests: ['package.json'],
    lockfiles: [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
    ],
    packageManagers: ['npm', 'pnpm', 'yarn', 'bun'],
    support: 'full',
    stages: { reconcile: 'native', audit: 'native', test: 'declared', build: 'declared' },
    requiredToolFamilies: ['selected package manager'],
  },
  {
    id: 'python',
    ecosystem: 'Python',
    manifests: ['pyproject.toml', 'requirements.txt'],
    lockfiles: ['uv.lock', 'poetry.lock', 'requirements.txt'],
    packageManagers: ['uv', 'poetry', 'pip'],
    support: 'conditional',
    stages: {
      reconcile: 'conditional',
      audit: 'conditional',
      test: 'conditional',
      build: 'declared',
    },
    requiredToolFamilies: [
      'isolated Python',
      'selected environment manager',
      'pip-audit or governed Doctor audit',
    ],
    limitation: 'A bounded isolated environment and an installed audit surface are required.',
  },
  {
    id: 'go',
    ecosystem: 'Go',
    manifests: ['go.mod'],
    lockfiles: ['go.sum'],
    packageManagers: ['go modules'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'native', build: 'native' },
    requiredToolFamilies: ['go', 'govulncheck'],
    limitation: 'govulncheck must be installed; the engine never fetches an unreviewed tool.',
  },
  {
    id: 'rust',
    ecosystem: 'Rust',
    manifests: ['Cargo.toml'],
    lockfiles: ['Cargo.lock'],
    packageManagers: ['cargo'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'native', build: 'native' },
    requiredToolFamilies: ['cargo', 'cargo-audit'],
    limitation: 'The cargo-audit subcommand must already be installed.',
  },
  {
    id: 'php-composer',
    ecosystem: 'PHP',
    manifests: ['composer.json'],
    lockfiles: ['composer.lock'],
    packageManagers: ['composer'],
    support: 'full',
    stages: { reconcile: 'native', audit: 'native', test: 'declared', build: 'declared' },
    requiredToolFamilies: ['composer'],
  },
  {
    id: 'ruby-bundler',
    ecosystem: 'Ruby',
    manifests: ['Gemfile'],
    lockfiles: ['Gemfile.lock'],
    packageManagers: ['bundler'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'declared', build: 'declared' },
    requiredToolFamilies: ['bundle', 'bundle-audit'],
    limitation: 'bundle-audit and the declared Rake tasks must already exist.',
  },
  {
    id: 'elixir-mix',
    ecosystem: 'Elixir',
    manifests: ['mix.exs'],
    lockfiles: ['mix.lock'],
    packageManagers: ['mix'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'native', build: 'native' },
    requiredToolFamilies: ['mix', 'Hex audit task'],
    limitation: 'The project must expose the Hex audit task used by its dependency policy.',
  },
  {
    id: 'deno',
    ecosystem: 'Deno',
    manifests: ['deno.json', 'deno.jsonc'],
    lockfiles: ['deno.lock'],
    packageManagers: ['deno'],
    support: 'full',
    stages: { reconcile: 'native', audit: 'native', test: 'declared', build: 'declared' },
    requiredToolFamilies: ['deno'],
  },
  {
    id: 'dotnet',
    ecosystem: '.NET',
    manifests: ['*.sln', '*.csproj', '*.fsproj', '*.vbproj'],
    lockfiles: ['Directory.Packages.props', 'packages.lock.json'],
    packageManagers: ['NuGet / dotnet'],
    support: 'full',
    stages: { reconcile: 'native', audit: 'native', test: 'native', build: 'native' },
    requiredToolFamilies: ['dotnet'],
  },
  {
    id: 'jvm-maven',
    ecosystem: 'JVM / Maven',
    manifests: ['pom.xml'],
    lockfiles: [],
    packageManagers: ['Maven Wrapper', 'Maven'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'native', build: 'native' },
    requiredToolFamilies: ['mvnw or mvn', 'governed Doctor audit'],
    limitation: 'A project-specific dependency audit command must be declared by Doctor evidence.',
  },
  {
    id: 'jvm-gradle',
    ecosystem: 'JVM / Gradle',
    manifests: ['build.gradle.kts', 'build.gradle'],
    lockfiles: ['gradle.lockfile', 'gradle/libs.versions.toml'],
    packageManagers: ['Gradle Wrapper', 'Gradle'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'native', build: 'native' },
    requiredToolFamilies: ['gradlew or gradle', 'governed Doctor audit'],
    limitation: 'A project-specific dependency audit command must be declared by Doctor evidence.',
  },
  {
    id: 'clojure',
    ecosystem: 'Clojure',
    manifests: ['deps.edn', 'project.clj'],
    lockfiles: [],
    packageManagers: ['Clojure CLI', 'Leiningen'],
    support: 'conditional',
    stages: {
      reconcile: 'native',
      audit: 'conditional',
      test: 'conditional',
      build: 'conditional',
    },
    requiredToolFamilies: ['clojure or lein', 'governed project audit'],
    limitation:
      'Tests and builds run only when the selected Clojure project surface declares a deterministic entrypoint.',
  },
  {
    id: 'scala-sbt',
    ecosystem: 'Scala / sbt',
    manifests: ['build.sbt'],
    lockfiles: [],
    packageManagers: ['sbt'],
    support: 'conditional',
    stages: { reconcile: 'native', audit: 'conditional', test: 'native', build: 'native' },
    requiredToolFamilies: ['sbt', 'governed project audit'],
    limitation: 'A project-specific dependency audit command must be declared by Doctor evidence.',
  },
] as const;

export function buildWorkspaceRepairCapabilitiesContract() {
  return {
    schemaVersion: WORKSPACE_REPAIR_CAPABILITIES_SCHEMA_VERSION,
    owner: 'Workspai CLI',
    workflow: [
      'plan',
      'preconditions',
      'approval',
      'checkpoint',
      'execute',
      'reconcile',
      'audit',
      'test',
      'build',
      'canonical-verify',
      'close-or-rollback-or-decision',
    ],
    invariants: {
      multiAdapterProjects: true,
      missingTools: 'decision-required',
      unsupportedEcosystems: 'decision-required',
      silentFallbackToModelExecution: false,
      approvalBoundToPlanHash: true,
      canonicalVerificationRequired: true,
      rollbackConflictDetection: true,
    },
    adapters: WORKSPACE_REPAIR_ADAPTER_CAPABILITIES,
  };
}
