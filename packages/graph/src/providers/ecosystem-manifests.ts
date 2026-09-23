import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphDiagnostic,
  type GraphFactBatch,
  type GraphProviderInput,
  type GraphProviderRuntime,
} from '../contracts/index.js';
import { createObservedEdgeFact } from './observed-edge-fact.js';
import { decodeUtf8, warning } from './provider-support.js';

export const ECOSYSTEM_MANIFESTS_PROVIDER_ID = 'workspai.graph.provider.ecosystem-manifests';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPENDENCIES_PER_MANIFEST = 10_000;

const MANIFEST_TOKENS = {
  cargo: 'cargo-toml',
  go: 'go-mod',
  cmake: 'cmake-lists',
  composer: 'composer-json',
  maven: 'maven-pom',
  nuget: 'nuget-proj',
  python: 'python-manifest',
  gradle: 'gradle-build',
  ruby: 'gemfile',
  elixir: 'mix-exs',
  dart: 'pubspec-yaml',
  swift: 'package-swift',
  clojure: 'clojure-manifest',
  scala: 'sbt-build',
} as const;

type Ecosystem = keyof typeof MANIFEST_TOKENS;

type DeclaredManifest = {
  readonly ecosystem: Ecosystem;
  readonly name: string;
  readonly dependencies: readonly string[];
};

function basenameOf(locator: string): string {
  const separator = locator.lastIndexOf('/');
  return separator === -1 ? locator : locator.slice(separator + 1);
}

function packageDirectory(locator: string): string {
  const separator = locator.lastIndexOf('/');
  return separator === -1 ? '.' : locator.slice(0, separator);
}

function ecosystemOf(locator: string): Ecosystem | undefined {
  const name = basenameOf(locator);
  if (name === 'Cargo.toml') return 'cargo';
  if (name === 'go.mod') return 'go';
  if (name === 'CMakeLists.txt') return 'cmake';
  if (name === 'composer.json') return 'composer';
  if (name === 'pom.xml') return 'maven';
  if (/\.(?:cs|fs|vb)proj$/iu.test(name)) return 'nuget';
  if (name === 'requirements.txt' || name === 'pyproject.toml') return 'python';
  if (name === 'build.gradle' || name === 'build.gradle.kts') return 'gradle';
  if (name === 'Gemfile') return 'ruby';
  if (name === 'mix.exs') return 'elixir';
  if (name === 'pubspec.yaml') return 'dart';
  if (name === 'Package.swift') return 'swift';
  if (name === 'project.clj' || name === 'deps.edn') return 'clojure';
  if (name === 'build.sbt') return 'scala';
  return undefined;
}

function manifestInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => ecosystemOf(input.locator) !== undefined)
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function tomlTableSections(contents: string): Array<{ name: string; body: string }> {
  const sections: Array<{ name: string; body: string }> = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of contents.split(/\r?\n/u)) {
    const header =
      /^\s*\[\[([^\]]+)\]\]\s*(?:#.*)?$/u.exec(line)?.[1]?.trim() ??
      /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line)?.[1]?.trim();
    if (header) {
      if (current) sections.push({ name: current.name, body: current.lines.join('\n') });
      current = { name: header, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  if (current) sections.push({ name: current.name, body: current.lines.join('\n') });
  return sections;
}

function cargoDependencyName(dependency: string): string {
  return dependency.replace(
    /\.(?:workspace|version|path|git|optional|features|default-features|package)$/u,
    ''
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right)
  );
}

/** Declared Cargo dependency keys, including dotted crate tables such as `dependencies.uuid`. */
export function parseCargoDeclaredManifest(contents: string): DeclaredManifest {
  const sections = tomlTableSections(contents);
  const packageBody = sections.find(({ name }) => name === 'package')?.body;
  const name = packageBody?.match(/^\s*name\s*=\s*["']([^"']+)["']/mu)?.[1]?.trim() || 'anonymous';
  const keyed = sections
    .filter(({ name: table }) => /(?:^|\.)(?:dev-|build-)?dependencies$/u.test(table))
    .flatMap(({ body }) =>
      [...body.matchAll(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=/gmu)].map((match) =>
        cargoDependencyName(match[1] ?? match[2] ?? match[3] ?? '')
      )
    );
  const dotted = sections.flatMap(({ name: table }) => {
    const crate = /(?:^|\.)(?:dev-|build-)?dependencies\.(.+)$/u.exec(table)?.[1]?.trim();
    return crate ? [cargoDependencyName(crate)] : [];
  });
  return { ecosystem: 'cargo', name, dependencies: uniqueSorted([...keyed, ...dotted]) };
}

/** Declared Go module requirements. Same grammar the released CLI admits, not a guessed edge. */
export function parseGoModuleDeclaredManifest(contents: string): DeclaredManifest {
  const name = /^\s*module\s+(\S+)/mu.exec(contents)?.[1] ?? 'anonymous';
  const dependencies = uniqueSorted(
    [...contents.matchAll(/^\s*([A-Za-z0-9_.~/-]+)\s+v\d+/gmu)].map((match) => match[1] ?? '')
  );
  return { ecosystem: 'go', name, dependencies };
}

export function parseCMakeDeclaredManifest(contents: string): DeclaredManifest {
  return {
    ecosystem: 'cmake',
    name: 'anonymous',
    dependencies: uniqueSorted(
      [...contents.matchAll(/find_package\s*\(\s*([A-Za-z0-9_.+-]+)/giu)].map(
        (match) => match[1] ?? ''
      )
    ),
  };
}

function recordKeys(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value);
}

export function parseComposerDeclaredManifest(contents: string): DeclaredManifest {
  const value: unknown = JSON.parse(contents);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Composer manifest root is not an object.');
  }
  const record = value as Record<string, unknown>;
  const declared = typeof record.name === 'string' ? record.name.trim() : '';
  return {
    ecosystem: 'composer',
    name: declared || 'anonymous',
    dependencies: uniqueSorted([
      ...recordKeys(record.require),
      ...recordKeys(record['require-dev']),
    ]),
  };
}

export function parseMavenDeclaredManifest(contents: string): DeclaredManifest {
  const name = /<artifactId>([^<]+)<\/artifactId>/u.exec(contents)?.[1]?.trim() || 'anonymous';
  return {
    ecosystem: 'maven',
    name,
    dependencies: uniqueSorted(
      [...contents.matchAll(/<dependency>([\s\S]*?)<\/dependency>/gu)].map((match) => {
        const body = match[1] ?? '';
        const group = /<groupId>([^<]+)<\/groupId>/u.exec(body)?.[1]?.trim();
        const artifact = /<artifactId>([^<]+)<\/artifactId>/u.exec(body)?.[1]?.trim();
        return group && artifact ? `${group}:${artifact}` : (artifact ?? '');
      })
    ),
  };
}

export function parseNugetDeclaredManifest(locator: string, contents: string): DeclaredManifest {
  const fileName = basenameOf(locator).replace(/\.[^.]+$/u, '');
  return {
    ecosystem: 'nuget',
    name:
      /<AssemblyName>([^<]+)<\/AssemblyName>/u.exec(contents)?.[1]?.trim() ||
      fileName ||
      'anonymous',
    dependencies: uniqueSorted(
      [...contents.matchAll(/<PackageReference\s+Include=["']([^"']+)["']/gu)].map(
        (match) => match[1] ?? ''
      )
    ),
  };
}

function quotedTomlValues(value: string): string[] {
  return [...value.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1] ?? '');
}

function extractTomlArrayAssignment(body: string, key: string): string[] {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const assignment = new RegExp(`^\\s*${escapedKey}\\s*=\\s*\\[`, 'mu').exec(body);
  if (!assignment) return [];
  const start = assignment.index + assignment[0].lastIndexOf('[');
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = start + 1; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (character === quote && !escaped) quote = null;
      escaped = character === '\\' && !escaped;
      if (character !== '\\') escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ']') return quotedTomlValues(body.slice(start + 1, index));
  }
  return [];
}

function pythonRequirementName(requirement: string): string {
  return requirement.trim().match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)/u)?.[1] ?? '';
}

export function parsePythonDeclaredManifest(locator: string, contents: string): DeclaredManifest {
  if (basenameOf(locator) === 'requirements.txt') {
    return {
      ecosystem: 'python',
      name: 'anonymous',
      dependencies: uniqueSorted(
        contents.split(/\r?\n/u).map((line) => line.trim().match(/^([A-Za-z0-9_.-]+)/u)?.[1] ?? '')
      ),
    };
  }
  const sections = tomlTableSections(contents);
  const project = sections.find((section) => section.name === 'project')?.body ?? '';
  const dependencySections = sections.filter(
    ({ name }) =>
      name === 'project' ||
      name === 'project.optional-dependencies' ||
      name === 'dependency-groups' ||
      name === 'tool.poetry.dependencies' ||
      /^tool\.poetry\.group\.[^.]+\.dependencies$/u.test(name)
  );
  const dependencies = dependencySections.flatMap(({ name, body }) => {
    if (name === 'project') {
      return extractTomlArrayAssignment(body, 'dependencies').map(pythonRequirementName);
    }
    if (name === 'project.optional-dependencies' || name === 'dependency-groups') {
      return [...body.matchAll(/^\s*(?:["']([^"']+)["']|([A-Za-z0-9_.-]+))\s*=\s*\[/gmu)].flatMap(
        (match) =>
          extractTomlArrayAssignment(body, match[1] ?? match[2] ?? '').map(pythonRequirementName)
      );
    }
    return [...body.matchAll(/^\s*(?:["']([^"']+)["']|([A-Za-z0-9_.-]+))\s*=/gmu)]
      .map((match) => match[1] ?? match[2] ?? '')
      .filter((dependency) => dependency !== 'python');
  });
  return {
    ecosystem: 'python',
    name: /^\s*name\s*=\s*["']([^"']+)["']/mu.exec(project)?.[1]?.trim() || 'anonymous',
    dependencies: uniqueSorted(dependencies),
  };
}

function parseLineDeclaredManifest(
  ecosystem: Ecosystem,
  contents: string,
  pattern: RegExp,
  map: (match: RegExpMatchArray) => string
): DeclaredManifest {
  return {
    ecosystem,
    name: 'anonymous',
    dependencies: uniqueSorted([...contents.matchAll(pattern)].map(map)),
  };
}

function parseManifest(locator: string, contents: string): DeclaredManifest | undefined {
  const ecosystem = ecosystemOf(locator);
  if (ecosystem === 'cargo') return parseCargoDeclaredManifest(contents);
  if (ecosystem === 'go') return parseGoModuleDeclaredManifest(contents);
  if (ecosystem === 'cmake') return parseCMakeDeclaredManifest(contents);
  if (ecosystem === 'composer') return parseComposerDeclaredManifest(contents);
  if (ecosystem === 'maven') return parseMavenDeclaredManifest(contents);
  if (ecosystem === 'nuget') return parseNugetDeclaredManifest(locator, contents);
  if (ecosystem === 'python') return parsePythonDeclaredManifest(locator, contents);
  if (ecosystem === 'gradle') {
    return parseLineDeclaredManifest(
      'gradle',
      contents,
      /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?["']([^:"']+):([^:"']+)/gu,
      (match) => `${match[1] ?? ''}:${match[2] ?? ''}`
    );
  }
  if (ecosystem === 'ruby') {
    return parseLineDeclaredManifest(
      'ruby',
      contents,
      /^\s*gem\s+["']([^"']+)["']/gmu,
      (match) => match[1] ?? ''
    );
  }
  if (ecosystem === 'elixir') {
    return parseLineDeclaredManifest(
      'elixir',
      contents,
      /\{:\s*([A-Za-z0-9_]+)\s*,/gu,
      (match) => match[1] ?? ''
    );
  }
  if (ecosystem === 'dart') {
    return parseLineDeclaredManifest(
      'dart',
      contents,
      /^\s{2}([A-Za-z0-9_]+):\s+/gmu,
      (match) => match[1] ?? ''
    );
  }
  if (ecosystem === 'swift') {
    return parseLineDeclaredManifest(
      'swift',
      contents,
      /\.package\s*\(\s*url:\s*["']([^"']+)["']/gu,
      (match) => match[1] ?? ''
    );
  }
  if (ecosystem === 'clojure') {
    return parseLineDeclaredManifest(
      'clojure',
      contents,
      /\[?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s+/gu,
      (match) => match[1] ?? ''
    );
  }
  if (ecosystem === 'scala') {
    return parseLineDeclaredManifest(
      'scala',
      contents,
      /["']([^"']+)["']\s*%%?\s*["']([^"']+)["']/gu,
      (match) => `${match[1] ?? ''}:${match[2] ?? ''}`
    );
  }
  return undefined;
}

export function createEcosystemManifestsProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: ECOSYSTEM_MANIFESTS_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Declared ecosystem manifest dependencies',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['repository', 'package'],
      relationKinds: ['contains', 'depends-on'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['manifest.package', 'manifest.dependency'],
      allowedClaims: ['declared'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: 200_000, maxInputBytes: MAX_BYTES },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: Object.values(MANIFEST_TOKENS),
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const matchedInputs = [
        ...new Set(
          request.availableInputs.flatMap((locator) => {
            const ecosystem = ecosystemOf(locator);
            return ecosystem ? [MANIFEST_TOKENS[ecosystem]] : [];
          })
        ),
      ].sort((left, right) => left.localeCompare(right));
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: matchedInputs.length > 0 ? 'applicable' : 'not-applicable',
        matchedInputs,
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = manifestInputs(request.inputs);
      const facts: GraphFactBatch['facts'][number][] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      const repository = await request.resolveIdentity({
        namespace: 'workspai',
        kind: 'repository',
        relativeLocator: '.',
        caseSensitivity: 'sensitive',
        scope: request.scope,
      });
      if (!repository.accepted) {
        throw new Error('Ecosystem manifest repository identity could not be resolved.');
      }

      for (const [inputIndex, input] of inputs.entries()) {
        if (request.signal?.aborted)
          throw new Error('Ecosystem manifest collection was cancelled.');
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const ecosystem = ecosystemOf(input.locator);
          if (!ecosystem) continue;
          const parsed = parseManifest(
            input.locator,
            decodeUtf8(
              await request.readInput(input, { maxBytes: MAX_BYTES, signal: request.signal })
            )
          );
          if (!parsed) continue;
          const packageIdentity = await request.resolveIdentity({
            namespace: `${ecosystem}-project`,
            kind: 'package',
            relativeLocator: `${packageDirectory(input.locator)}#${parsed.name}`,
            caseSensitivity: 'sensitive',
            scope: request.scope,
          });
          if (!packageIdentity.accepted) {
            throw new Error('Ecosystem package identity could not be resolved.');
          }
          const evidenceId = `evidence:ecosystem-manifest:${String(inputIndex).padStart(8, '0')}`;
          facts.push(
            createObservedEdgeFact({
              factId: `fact:ecosystem-manifest:contains:${String(inputIndex).padStart(8, '0')}:${input.digest.value}`,
              factType: 'manifest.package',
              subject: repository.value.reference,
              predicate: 'contains',
              object: packageIdentity.value.reference,
              request,
              source: input,
              provider: manifest,
              evidenceId,
              sourceKind: 'package-manifest',
              derivation: 'declared',
              authority: 'declared',
              confidence: 1,
              extensions: { packageName: parsed.name, ecosystem },
            })
          );
          const admitted = parsed.dependencies.slice(0, MAX_DEPENDENCIES_PER_MANIFEST);
          if (parsed.dependencies.length > admitted.length) {
            const limit = warning(
              'graph.manifest-dependency-limit-reached',
              input.locator,
              'Declared manifest dependencies exceeded the provider fact budget and were truncated.'
            );
            diagnostics.push(limit);
            inputDiagnostics.push(limit);
            unknownZones.push({
              code: 'graph.manifest-dependencies-truncated',
              scope: input.locator,
              reason: 'Some declared dependencies were omitted by the provider resource policy.',
            });
            outcome = 'omitted';
          }
          for (const [dependencyIndex, dependencyName] of admitted.entries()) {
            if (facts.length >= manifest.limits.maxFacts) {
              outcome = 'omitted';
              unknownZones.push({
                code: 'graph.manifest-dependencies-truncated',
                scope: input.locator,
                reason: 'Some declared dependencies were omitted by the provider resource policy.',
              });
              break;
            }
            const dependency = await request.resolveIdentity({
              namespace: `${ecosystem}-package`,
              kind: 'package',
              relativeLocator: `dependency:${dependencyName}`,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!dependency.accepted) {
              throw new Error('Ecosystem dependency identity could not be resolved.');
            }
            facts.push(
              createObservedEdgeFact({
                factId: `fact:ecosystem-manifest:dependency:${String(inputIndex).padStart(8, '0')}:${String(dependencyIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'manifest.dependency',
                subject: packageIdentity.value.reference,
                predicate: 'depends-on',
                object: dependency.value.reference,
                request,
                source: input,
                provider: manifest,
                evidenceId,
                sourceKind: 'package-manifest',
                derivation: 'declared',
                authority: 'declared',
                confidence: 1,
              })
            );
          }
        } catch {
          const failure = warning(
            'graph.ecosystem-manifest-invalid',
            input.locator,
            'Ecosystem manifest could not be admitted within the declared-dependency boundary.'
          );
          diagnostics.push(failure);
          inputDiagnostics.push(failure);
          unknownZones.push({
            code: 'graph.ecosystem-manifest-unreadable',
            scope: input.locator,
            reason: 'Declared dependencies are unknown because the manifest could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'ecosystem-manifests', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }

      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:ecosystem-manifests:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [
          { dimension: 'ecosystem-manifests', observed: inputs.length, expected: inputs.length },
        ],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status:
          processing.some((entry) => entry.outcome !== 'processed') || unknownZones.length > 0
            ? 'partial'
            : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
