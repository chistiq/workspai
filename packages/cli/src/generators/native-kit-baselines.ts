/**
 * Tested baselines for npm-owned Workspai project kits.
 *
 * Keep framework, toolchain, container, and CI versions here so a baseline
 * review is atomic and generator templates cannot silently drift apart.
 */
export const NATIVE_KIT_BASELINES = {
  reviewedAt: '2026-08-31',
  actions: {
    checkout: 'v7',
    setupGo: 'v7',
    setupJava: 'v6',
    setupDotnet: 'v6',
    uploadArtifact: 'v4',
    golangciLint: 'v9',
    rustCache: 'v2',
  },
  go: {
    version: '1.26',
    alpine: '3.24',
    air: 'v1.67.4',
    swag: 'v1.16.6',
    golangciLint: 'v2.12.2',
    fiber: 'v2.52.15',
    fiberSwagger: 'v1.3.0',
    gin: 'v1.12.0',
    ginSwagger: 'v1.6.1',
    swagFiles: 'v1.0.1',
  },
  springBoot: {
    java: '21',
    compatibilityJava: '25',
    version: '3.5.16',
    springdoc: '2.9.0',
    maven: '3.9.9',
  },
  dotnet: {
    targetFramework: 'net10.0',
    sdkChannel: '10.0.x',
    aspnetPatch: '10.0.11',
    swashbuckle: '10.2.3',
    testSdk: '18.9.0',
    xunit: '2.9.3',
    xunitRunner: '3.1.5',
    coverlet: '6.0.4',
  },
  rust: {
    toolchain: '1.98.0',
    edition: '2024',
    axum: '0.8.9',
  },
} as const;

export type NativeDependencyEcosystem = 'cargo' | 'gomod' | 'maven' | 'nuget';

export function buildNativeKitDependabotYml(packageEcosystem: NativeDependencyEcosystem): string {
  return `version: 2
updates:
  - package-ecosystem: "${packageEcosystem}"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      production-dependencies:
        dependency-type: "production"
      development-dependencies:
        dependency-type: "development"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 3
`;
}
