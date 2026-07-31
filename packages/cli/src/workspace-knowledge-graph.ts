import path from 'path';
import { createHash } from 'crypto';
import fsExtra from 'fs-extra';
import { isPythonVirtualEnvironmentDirectory } from './utils/workspace-scan-policy.js';
import { parseAllDocuments } from 'yaml';

import type { WorkspaceContract } from './utils/workspace-contract.js';
import type { WorkspaceDependencyGraph } from './contracts/workspace-dependency-graph-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './contracts/workspace-intelligence-runtime-registry.js';
import {
  WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
  type WorkspaceKnowledgeAttribute,
  type WorkspaceKnowledgeConfidence,
  type WorkspaceKnowledgeDerivation,
  type WorkspaceKnowledgeDiagnostic,
  type WorkspaceKnowledgeEntity,
  type WorkspaceKnowledgeEntityKind,
  type WorkspaceKnowledgeGraph,
  type WorkspaceKnowledgeProof,
  type WorkspaceKnowledgeProviderRun,
  type WorkspaceKnowledgeRelation,
  type WorkspaceKnowledgeRelationKind,
  type WorkspaceKnowledgeTrust,
} from './contracts/workspace-knowledge-graph-contract.js';
import { hashCanonicalJson, hashWorkspaceModel } from './workspace-model-hash.js';
import { workspaceModelProjectTopology, type WorkspaceModel } from './workspace-model.js';

export const WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH =
  WORKSPACE_INTELLIGENCE_ARTIFACTS.knowledgeGraph;

export type WorkspaceKnowledgeProjectInput = {
  id: string;
  path: string;
  absolutePath?: string;
  runtime?: string;
  runtimeCandidates?: string[];
  framework?: string;
  kit?: string;
  kind?: string;
  category?: string;
};

export type BuildWorkspaceKnowledgeGraphOptions = {
  workspacePath: string;
  workspace: { name: string; profile?: string };
  projects: WorkspaceKnowledgeProjectInput[];
  projectTopology: WorkspaceDependencyGraph;
  contract?: WorkspaceContract | null;
  now?: Date;
  maxFilesPerProject?: number;
  source: WorkspaceKnowledgeGraph['source'];
};

export function assertWorkspaceKnowledgeGraphSourceBinding(
  graph: WorkspaceKnowledgeGraph,
  model: WorkspaceModel
): void {
  if (graph.source.kind !== 'workspace-model') {
    throw new Error(
      `Workspace knowledge graph is not bound to the canonical workspace model (source: ${graph.source.kind}).`
    );
  }
  if (graph.source.artifact !== WORKSPACE_INTELLIGENCE_ARTIFACTS.model) {
    throw new Error(
      `Workspace knowledge graph source artifact is ${graph.source.artifact}; expected ${WORKSPACE_INTELLIGENCE_ARTIFACTS.model}.`
    );
  }
  if (graph.source.hashAlgorithm !== 'sha256') {
    throw new Error(
      `Workspace knowledge graph source hash algorithm is ${graph.source.hashAlgorithm}; expected sha256.`
    );
  }
  const expectedHash = hashWorkspaceModel(model);
  if (graph.source.hash !== expectedHash) {
    throw new Error(
      'Workspace knowledge graph is stale: its source hash does not match the canonical workspace model.'
    );
  }
  if (
    graph.workspace.name !== model.workspace.name ||
    (graph.workspace.profile ?? undefined) !== (model.workspace.profile ?? undefined)
  ) {
    throw new Error(
      'Workspace knowledge graph identity does not match the canonical workspace model.'
    );
  }
  const modelProjectTopology = workspaceModelProjectTopology(model);
  if (!modelProjectTopology) {
    throw new Error(
      'Canonical workspace model has no project topology for the workspace knowledge graph.'
    );
  }
  const normalizeTopology = (topology: WorkspaceDependencyGraph) => ({
    ...topology,
    generatedAt: '<ignored>',
  });
  if (
    hashCanonicalJson(normalizeTopology(graph.projectTopology)) !==
    hashCanonicalJson(normalizeTopology(modelProjectTopology))
  ) {
    throw new Error(
      'Workspace knowledge graph project topology does not match the canonical workspace model.'
    );
  }
}

type JsonRecord = Record<string, unknown>;
type ProviderContext = {
  workspacePath: string;
  projects: ResolvedProject[];
  filesByProject: ReadonlyMap<string, readonly string[]>;
  workspaceFiles: readonly string[];
  now: Date;
  maxFilesPerProject: number;
  contract: WorkspaceContract | null;
  state: KnowledgeGraphState;
};
type ResolvedProject = WorkspaceKnowledgeProjectInput & { root: string; artifactPrefix: string };
type Provider = {
  id: string;
  version: string;
  /**
   * Applicability is deliberately separate from execution success. A provider
   * that has no matching source surface is skipped; a provider that has a
   * matching source but emits nothing is partial and contributes an explicit
   * unknown.
   */
  applicable?(context: ProviderContext): boolean | Promise<boolean>;
  run(context: ProviderContext): Promise<void>;
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.workspai',
  '.rapidkit',
  '.venv',
  'venv',
  'vendor',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

const MANIFEST_NAMES = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'mix.exs',
  'pubspec.yaml',
  'Package.swift',
  'CMakeLists.txt',
  'deno.json',
  'deno.jsonc',
  'project.clj',
  'deps.edn',
  'build.sbt',
  'BUILD',
  'BUILD.bazel',
  'WORKSPACE.bazel',
]);

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.dart',
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
  '.php',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.scala',
  '.svelte',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
  '.clj',
  '.cljs',
  '.fs',
  '.fsx',
  '.lua',
  '.vb',
]);

type SourceFinding = { name: string; line: number; detail: string };

function sourceLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const languages: Record<string, string> = {
    '.c': 'c',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.dart': 'dart',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.go': 'go',
    '.h': 'c',
    '.hpp': 'cpp',
    '.java': 'java',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.mjs': 'javascript',
    '.php': 'php',
    '.py': 'python',
    '.r': 'r',
    '.rb': 'ruby',
    '.rs': 'rust',
    '.scala': 'scala',
    '.svelte': 'svelte',
    '.swift': 'swift',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.vue': 'vue',
    '.clj': 'clojure',
    '.cljs': 'clojure',
    '.fs': 'fsharp',
    '.fsx': 'fsharp',
    '.lua': 'lua',
    '.vb': 'visual-basic',
  };
  return languages[extension] ?? extension.slice(1);
}

function captureSourceFindings(
  contents: string,
  patterns: readonly { pattern: RegExp; detail: string }[],
  limit: number
): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length && findings.length < limit; index += 1) {
    for (const candidate of patterns) {
      const match = lines[index].match(candidate.pattern);
      const name = match?.[1]?.trim();
      if (!name) continue;
      findings.push({ name, line: index + 1, detail: candidate.detail });
      break;
    }
  }
  return findings;
}

const SYMBOL_PATTERNS = [
  {
    pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    detail: 'function',
  },
  {
    pattern: /^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/,
    detail: 'type',
  },
  { pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, detail: 'function' },
  { pattern: /^\s*class\s+([A-Za-z_]\w*)/, detail: 'type' },
  { pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, detail: 'function' },
  {
    pattern:
      /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|abstract\s+|final\s+)*(?:class|interface|record|enum)\s+([A-Za-z_]\w*)/,
    detail: 'type',
  },
  { pattern: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, detail: 'function' },
  {
    pattern: /^\s*(?:pub\s+)?(?:struct|trait|enum)\s+([A-Za-z_]\w*)/,
    detail: 'type',
  },
  {
    pattern: /^\s*(?:public\s+|private\s+|protected\s+)?function\s+([A-Za-z_]\w*)/,
    detail: 'function',
  },
  { pattern: /^\s*(?:class|module|struct|protocol|mixin)\s+([A-Za-z_]\w*)/, detail: 'type' },
] as const;

const IMPORT_PATTERNS = [
  { pattern: /^\s*import(?:.+?from\s*)?["']([^"']+)["']/, detail: 'import' },
  { pattern: /require\(["']([^"']+)["']\)/, detail: 'require' },
  { pattern: /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/, detail: 'import' },
  { pattern: /^\s*import\s+([A-Za-z0-9_.]+)(?:\s|$)/, detail: 'import' },
  { pattern: /^\s*(?:import|using|use)\s+([A-Za-z0-9_:.*\\/.-]+)/, detail: 'import' },
  { pattern: /^\s*require(?:_relative)?\s+["']([^"']+)["']/, detail: 'require' },
] as const;

function resolveLocalImportTarget(
  importerPath: string,
  specifier: string,
  candidateFiles: ReadonlySet<string>
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importerPath), specifier);
  const extension = path.extname(base).toLowerCase();
  const hasSourceExtension = SOURCE_EXTENSIONS.has(extension);
  const candidates = new Set<string>([base]);
  if (hasSourceExtension) {
    const withoutExtension = base.slice(0, -extension.length);
    if (['.js', '.jsx', '.mjs'].includes(extension)) {
      for (const replacement of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
        candidates.add(`${withoutExtension}${replacement}`);
      }
    }
  } else {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      candidates.add(`${base}${sourceExtension}`);
      candidates.add(path.join(base, `index${sourceExtension}`));
    }
  }
  return [...candidates].find((candidate) => candidateFiles.has(path.resolve(candidate))) ?? null;
}

const ROUTE_PATTERNS = [
  {
    pattern: /@(?:Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']([^"']*)["']/i,
    detail: 'decorated route',
  },
  {
    pattern:
      /\b(?:app|router|server|api|route|fastify|fiber)\.(?:get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/i,
    detail: 'router route',
  },
  {
    pattern:
      /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\([^"']*["']([^"']*)["']/,
    detail: 'mapped route',
  },
  {
    pattern: /\[Http(?:Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']*)["']/i,
    detail: 'HTTP route',
  },
  {
    pattern: /^\s*(?:get|post|put|delete|patch)\s+["']([^"']+)["']/i,
    detail: 'HTTP route',
  },
] as const;

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(kind: string, key: string): string {
  return `wkg:${kind}:${hash(`${kind}\0${key}`).slice(0, 20)}`;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function safeArtifact(value: string): string {
  const normalized = toPosix(value).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return 'unknown';
  }
  return normalized;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').sort();
  }
  const record = asRecord(value);
  return record ? Object.keys(record).sort() : [];
}

function environmentKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.split('=', 1)[0]?.trim() : ''))
      .filter((item): item is string => Boolean(item))
      .sort();
  }
  const record = asRecord(value);
  return record ? Object.keys(record).sort() : [];
}

function portableAttributes(
  attributes: Record<string, WorkspaceKnowledgeAttribute | undefined>
): Record<string, WorkspaceKnowledgeAttribute> {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter((entry): entry is [string, WorkspaceKnowledgeAttribute] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

async function listFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  let head = 0;
  while (head < queue.length && files.length < maxFiles) {
    const current = queue[head++];
    let entries: fsExtra.Dirent[];
    try {
      entries = await fsExtra.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          !IGNORED_DIRECTORIES.has(entry.name) &&
          !isPythonVirtualEnvironmentDirectory(entry.name)
        ) {
          queue.push(candidate);
        }
      } else if (entry.isFile()) {
        files.push(candidate);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function readStructuredDocuments(filePath: string): Promise<JsonRecord[]> {
  const contents = await fsExtra.readFile(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(contents) as unknown;
    const record = asRecord(parsed);
    return record ? [record] : [];
  }
  return parseAllDocuments(contents, { logLevel: 'silent' })
    .map((document) => asRecord(document.toJSON()))
    .filter((document): document is JsonRecord => document !== null);
}

function uniqueInventoryFiles(context: ProviderContext): string[] {
  return [
    ...new Set([
      ...context.workspaceFiles,
      ...context.projects.flatMap((project) => context.filesByProject.get(project.id) ?? []),
    ]),
  ].sort((a, b) => a.localeCompare(b));
}

function isOpenApiCandidate(file: string): boolean {
  return /^(?:openapi|swagger)(?:\.[^.]+)?\.(?:json|ya?ml)$/i.test(path.basename(file));
}

function isInterfaceContractCandidate(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return (
    /\.(?:graphql|gql|proto)$/.test(base) || /^asyncapi(?:\.[^.]+)?\.(?:json|ya?ml)$/.test(base)
  );
}

function isInfrastructureCandidate(file: string): boolean {
  const base = path.basename(file);
  return /^Dockerfile(?:\..+)?$/i.test(base) || /\.tf$/i.test(base) || base === 'Chart.yaml';
}

function isDocumentationCandidate(file: string): boolean {
  return /(?:^|[\\/])(?:README|ARCHITECTURE|CONTRIBUTING|SECURITY)\.md$/i.test(file);
}

function isCiWorkflowCandidate(root: string, file: string): boolean {
  const relative = toPosix(path.relative(root, file));
  return (
    /^\.github\/workflows\/.+\.ya?ml$/i.test(relative) ||
    /^(?:\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|Jenkinsfile|bitbucket-pipelines\.ya?ml|\.woodpecker\.ya?ml)$/i.test(
      relative
    ) ||
    /^\.circleci\/config\.ya?ml$/i.test(relative)
  );
}

function isDecisionCandidate(root: string, file: string): boolean {
  const relative = toPosix(path.relative(root, file));
  return (
    /(?:^|\/)(?:adr|adrs|decisions)(?:\/).+\.md$/i.test(relative) ||
    /(?:^|\/)ADR[-_0-9].+\.md$/i.test(relative)
  );
}

async function composeCandidateFiles(context: ProviderContext): Promise<string[]> {
  const candidates = new Set<string>();
  for (const root of [context.workspacePath, ...context.projects.map((project) => project.root)]) {
    for (const name of [
      'compose.yml',
      'compose.yaml',
      'docker-compose.yml',
      'docker-compose.yaml',
    ]) {
      const candidate = path.join(root, name);
      if (await fsExtra.pathExists(candidate)) candidates.add(candidate);
    }
  }
  return [...candidates].sort((a, b) => a.localeCompare(b));
}

async function ownershipCandidateFiles(context: ProviderContext): Promise<string[]> {
  const roots = [context.workspacePath, ...context.projects.map((project) => project.root)];
  const candidates = roots.flatMap((root) => [
    path.join(root, 'CODEOWNERS'),
    path.join(root, '.github', 'CODEOWNERS'),
    path.join(root, 'docs', 'CODEOWNERS'),
  ]);
  const existing = await Promise.all(
    candidates.map(async (candidate) => ((await fsExtra.pathExists(candidate)) ? candidate : null))
  );
  return [...new Set(existing.filter((candidate): candidate is string => Boolean(candidate)))].sort(
    (a, b) => a.localeCompare(b)
  );
}

function ciCandidateFiles(context: ProviderContext): string[] {
  const inventories = [
    { root: context.workspacePath, files: context.workspaceFiles },
    ...context.projects.map((project) => ({
      root: project.root,
      files: context.filesByProject.get(project.id) ?? [],
    })),
  ];
  return [
    ...new Set(
      inventories.flatMap((inventory) =>
        inventory.files.filter((file) => isCiWorkflowCandidate(inventory.root, file))
      )
    ),
  ].sort((a, b) => a.localeCompare(b));
}

async function kubernetesCandidateFiles(context: ProviderContext): Promise<string[]> {
  const candidates: string[] = [];
  for (const file of uniqueInventoryFiles(context)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    try {
      const documents = await readStructuredDocuments(file);
      if (
        documents.some((document) => {
          const metadata = asRecord(document.metadata);
          return Boolean(
            stringValue(document.apiVersion) &&
            stringValue(document.kind) &&
            stringValue(metadata?.name)
          );
        })
      ) {
        candidates.push(file);
      }
    } catch {
      // Parse failures are handled by the provider when a path-based manifest
      // candidate reaches execution.
    }
  }
  return candidates.sort((a, b) => a.localeCompare(b));
}

function projectForFile(projects: ResolvedProject[], filePath: string): ResolvedProject | null {
  const absolute = path.resolve(filePath);
  return (
    projects
      .filter(
        (project) => absolute === project.root || absolute.startsWith(`${project.root}${path.sep}`)
      )
      .sort((a, b) => b.root.length - a.root.length)[0] ?? null
  );
}

class KnowledgeGraphState {
  readonly entities = new Map<string, WorkspaceKnowledgeEntity>();
  readonly relations = new Map<string, WorkspaceKnowledgeRelation>();
  readonly proofs = new Map<string, WorkspaceKnowledgeProof>();
  readonly providers: WorkspaceKnowledgeProviderRun[] = [];
  readonly diagnostics: WorkspaceKnowledgeDiagnostic[] = [];
  private readonly contentHashes = new Map<string, string | null>();
  private readonly attributeConflicts = new Set<string>();

  constructor(
    readonly workspacePath: string,
    readonly now: Date,
    readonly workspaceName: string
  ) {}

  artifactPath(filePath: string, project?: ResolvedProject | null): string {
    if (project) {
      const relative = toPosix(path.relative(project.root, filePath));
      return safeArtifact(path.posix.join(project.artifactPrefix, relative));
    }
    return safeArtifact(path.relative(this.workspacePath, filePath));
  }

  async addProof(input: {
    provider: string;
    artifact: string;
    absolutePath?: string;
    pointer?: string;
    line?: number;
    column?: number;
    derivation?: WorkspaceKnowledgeDerivation;
    trust?: WorkspaceKnowledgeTrust;
    confidence?: WorkspaceKnowledgeConfidence;
    detail?: string;
  }): Promise<string> {
    let contentHash: string | undefined;
    if (input.absolutePath) {
      if (!this.contentHashes.has(input.absolutePath)) {
        try {
          this.contentHashes.set(
            input.absolutePath,
            hash(await fsExtra.readFile(input.absolutePath))
          );
        } catch {
          this.contentHashes.set(input.absolutePath, null);
        }
      }
      contentHash = this.contentHashes.get(input.absolutePath) ?? undefined;
    }
    const artifact = safeArtifact(input.artifact);
    const id = stableId(
      'proof',
      [input.provider, artifact, input.pointer ?? '', input.line ?? '', input.detail ?? ''].join(
        '\0'
      )
    );
    if (!this.proofs.has(id)) {
      this.proofs.set(id, {
        id,
        provider: input.provider,
        artifact,
        ...(input.pointer ? { pointer: input.pointer } : {}),
        ...(input.line ? { line: input.line } : {}),
        ...(input.column ? { column: input.column } : {}),
        ...(contentHash ? { contentHash } : {}),
        observedAt: this.now.toISOString(),
        derivation: input.derivation ?? 'extracted',
        trust: input.trust ?? 'observed',
        confidence: input.confidence ?? 'high',
        freshness: 'fresh',
        ...(input.detail ? { detail: input.detail } : {}),
      });
    }
    return id;
  }

  addEntity(input: {
    kind: WorkspaceKnowledgeEntityKind;
    key: string;
    label: string;
    projectId?: string;
    aliases?: string[];
    attributes?: Record<string, WorkspaceKnowledgeAttribute | undefined>;
    proofIds?: string[];
  }): string {
    const id = stableId(input.kind, input.key);
    const attributes = portableAttributes(input.attributes ?? {});
    const existing = this.entities.get(id);
    const mergedAttributes = { ...(existing?.attributes ?? {}) };
    for (const [attribute, value] of Object.entries(attributes)) {
      if (
        attribute in mergedAttributes &&
        JSON.stringify(mergedAttributes[attribute]) !== JSON.stringify(value)
      ) {
        const conflictKey = `${id}\0${attribute}`;
        if (!this.attributeConflicts.has(conflictKey)) {
          this.attributeConflicts.add(conflictKey);
          this.diagnostics.push({
            code: 'graph.knowledge.attribute_conflict',
            severity: 'warning',
            message: `Conflicting ${attribute} values were observed for ${input.kind} ${input.label}.`,
            entityIds: [id],
            recommendation:
              'Inspect the entity proof paths and make the authoritative source explicit.',
          });
        }
        continue;
      }
      mergedAttributes[attribute] = value;
    }
    const aliases = [
      ...new Set([...(existing?.identity.aliases ?? []), ...(input.aliases ?? [])]),
    ].sort();
    const proofIds = [
      ...new Set([...(existing?.proofIds ?? []), ...(input.proofIds ?? [])]),
    ].sort();
    this.entities.set(id, {
      id,
      kind: input.kind,
      label: input.label,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      identity: {
        key: input.key,
        scope: input.projectId ? 'project' : 'workspace',
        aliases,
        fingerprint: hash(
          JSON.stringify({ kind: input.kind, key: input.key, attributes: mergedAttributes })
        ),
      },
      attributes: mergedAttributes,
      proofIds,
    });
    return id;
  }

  addRelation(input: {
    from: string;
    to: string;
    kind: WorkspaceKnowledgeRelationKind;
    derivation?: WorkspaceKnowledgeDerivation;
    trust?: WorkspaceKnowledgeTrust;
    confidence?: WorkspaceKnowledgeConfidence;
    proofIds: string[];
  }): string {
    const id = stableId('relation', `${input.from}\0${input.kind}\0${input.to}`);
    const existing = this.relations.get(id);
    const proofIds = [...new Set([...(existing?.proofIds ?? []), ...input.proofIds])].sort();
    const providerCount = new Set(
      proofIds.map((proofId) => this.proofs.get(proofId)?.provider).filter(Boolean)
    ).size;
    const requestedTrust = input.trust ?? existing?.trust ?? 'observed';
    const trust =
      providerCount >= 2 && requestedTrust !== 'ambiguous' ? 'corroborated' : requestedTrust;
    this.relations.set(id, {
      id,
      from: input.from,
      to: input.to,
      kind: input.kind,
      derivation: input.derivation ?? existing?.derivation ?? 'extracted',
      trust,
      confidence:
        trust === 'corroborated' ? 'high' : (input.confidence ?? existing?.confidence ?? 'high'),
      proofIds,
    });
    return id;
  }
}

function parseManifestMetadata(
  filePath: string,
  contents: string
): {
  ecosystem: string;
  name?: string;
  version?: string;
  dependencies: string[];
} {
  const name = path.basename(filePath);
  try {
    if (name === 'package.json' || name === 'composer.json') {
      const payload = JSON.parse(contents) as JsonRecord;
      return {
        ecosystem: name === 'package.json' ? 'npm' : 'composer',
        name: stringValue(payload.name),
        version: stringValue(payload.version),
        dependencies: [
          ...stringArray(payload.dependencies),
          ...stringArray(payload.devDependencies),
          ...stringArray(payload['require']),
          ...stringArray(payload['require-dev']),
        ]
          .filter((value, index, values) => values.indexOf(value) === index)
          .sort(),
      };
    }
    if (name === 'deno.json' || name === 'deno.jsonc') {
      const payload = JSON.parse(
        contents.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
      ) as JsonRecord;
      return {
        ecosystem: 'deno',
        name: stringValue(payload.name),
        version: stringValue(payload.version),
        dependencies: stringArray(payload.imports),
      };
    }
  } catch {
    // Continue with portable text extraction.
  }
  const first = (pattern: RegExp): string | undefined => contents.match(pattern)?.[1]?.trim();
  if (name === 'pyproject.toml') {
    const pep621Dependencies = contents.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? '';
    return {
      ecosystem: 'python',
      name: first(/^(?:name)\s*=\s*["']([^"']+)["']/m),
      version: first(/^(?:version)\s*=\s*["']([^"']+)["']/m),
      dependencies: [
        ...[...pep621Dependencies.matchAll(/["']([A-Za-z0-9_.-]+)/g)].map((match) => match[1]),
        ...[...contents.matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*(?:["'{[])/gm)]
          .map((match) => match[1])
          .filter(
            (dependency) =>
              !['name', 'version', 'description', 'python', 'dependencies'].includes(dependency)
          ),
      ]
        .filter((dependency, index, values) => values.indexOf(dependency) === index)
        .sort(),
    };
  }
  if (name === 'go.mod') {
    return {
      ecosystem: 'go',
      name: first(/^module\s+(\S+)/m),
      dependencies: [...contents.matchAll(/^\s*([A-Za-z0-9_.~/-]+)\s+v\d+/gm)]
        .map((match) => match[1])
        .sort(),
    };
  }
  if (name === 'Cargo.toml') {
    const dependencyBlock =
      contents.match(/^\[dependencies\]\s*$([\s\S]*?)(?=^\[|\s*$)/m)?.[1] ?? '';
    return {
      ecosystem: 'cargo',
      name: first(/^name\s*=\s*["']([^"']+)["']/m),
      version: first(/^version\s*=\s*["']([^"']+)["']/m),
      dependencies: [...dependencyBlock.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)]
        .map((match) => match[1])
        .sort(),
    };
  }
  if (name === 'pom.xml') {
    return {
      ecosystem: 'maven',
      name: first(/<artifactId>([^<]+)<\/artifactId>/),
      version: first(/<version>([^<]+)<\/version>/),
      dependencies: [...contents.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)]
        .slice(1)
        .map((match) => match[1])
        .sort(),
    };
  }
  if (/\.(?:cs|fs|vb)proj$/i.test(name)) {
    return {
      ecosystem: 'nuget',
      name: first(/<AssemblyName>([^<]+)<\/AssemblyName>/) ?? name.replace(/\.[^.]+$/, ''),
      version: first(/<Version>([^<]+)<\/Version>/),
      dependencies: [...contents.matchAll(/<PackageReference\s+Include=["']([^"']+)["']/g)]
        .map((match) => match[1])
        .sort(),
    };
  }
  const ecosystems: Record<string, string> = {
    'requirements.txt': 'python',
    Pipfile: 'python',
    'build.gradle': 'gradle',
    'build.gradle.kts': 'gradle',
    Gemfile: 'ruby',
    'mix.exs': 'elixir',
    'pubspec.yaml': 'dart',
    'Package.swift': 'swift',
    'CMakeLists.txt': 'cmake',
    'deno.json': 'deno',
    'deno.jsonc': 'deno',
    'project.clj': 'clojure',
    'deps.edn': 'clojure',
    'build.sbt': 'scala',
    BUILD: 'bazel',
    'BUILD.bazel': 'bazel',
    'WORKSPACE.bazel': 'bazel',
  };
  const lineDependencies =
    name === 'requirements.txt'
      ? contents.split(/\r?\n/).map((line) => line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1])
      : name.startsWith('build.gradle')
        ? [
            ...contents.matchAll(
              /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?["']([^:"']+):([^:"']+)/g
            ),
          ].map((match) => `${match[1]}:${match[2]}`)
        : name === 'Gemfile'
          ? [...contents.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((match) => match[1])
          : name === 'mix.exs'
            ? [...contents.matchAll(/\{:\s*([A-Za-z0-9_]+)\s*,/g)].map((match) => match[1])
            : name === 'pubspec.yaml'
              ? [...contents.matchAll(/^\s{2}([A-Za-z0-9_]+):\s+/gm)].map((match) => match[1])
              : name === 'Package.swift'
                ? [...contents.matchAll(/\.package\s*\(\s*url:\s*["']([^"']+)["']/g)].map(
                    (match) => match[1]
                  )
                : name === 'CMakeLists.txt'
                  ? [...contents.matchAll(/find_package\s*\(\s*([A-Za-z0-9_.+-]+)/gi)].map(
                      (match) => match[1]
                    )
                  : name === 'project.clj' || name === 'deps.edn'
                    ? [...contents.matchAll(/\[?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s+/g)].map(
                        (match) => match[1]
                      )
                    : name === 'build.sbt'
                      ? [...contents.matchAll(/["']([^"']+)["']\s*%%?\s*["']([^"']+)["']/g)].map(
                          (match) => `${match[1]}:${match[2]}`
                        )
                      : [];
  return {
    ecosystem: ecosystems[name] ?? 'unknown',
    dependencies: lineDependencies
      .filter((dependency): dependency is string => Boolean(dependency))
      .filter((dependency, index, values) => values.indexOf(dependency) === index)
      .sort(),
  };
}

const foundationProvider: Provider = {
  id: 'workspace-foundation',
  version: '1.0.0',
  async run(context) {
    const { state } = context;
    const workspaceProof = await state.addProof({
      provider: this.id,
      artifact: '.workspai/workspace.contract.json',
      absolutePath: path.join(context.workspacePath, '.workspai', 'workspace.contract.json'),
      trust: 'authoritative',
      derivation: 'authored',
      detail: 'Workspace identity and project registry boundary',
    });
    const workspaceEntity = state.addEntity({
      kind: 'workspace',
      key: `workspace:${state.workspaceName}`,
      label: state.workspaceName,
      aliases: [state.workspaceName],
      proofIds: [workspaceProof],
    });

    for (const project of context.projects) {
      const files = context.filesByProject.get(project.id) ?? [];
      const metadata = files.find((file) =>
        /[\\/]\.(?:workspai|rapidkit)[\\/](?:project|context)\.json$/.test(file)
      );
      const fallback = files.find((file) => MANIFEST_NAMES.has(path.basename(file)));
      const proofPath = metadata ?? fallback;
      const projectProof = await state.addProof({
        provider: this.id,
        artifact: proofPath
          ? state.artifactPath(proofPath, project)
          : safeArtifact(path.posix.join(project.artifactPrefix, '.workspai/project.json')),
        ...(proofPath ? { absolutePath: proofPath } : {}),
        trust: metadata ? 'authoritative' : 'observed',
        derivation: metadata ? 'authored' : 'inferred',
        detail: `Project ${project.id}`,
      });
      const projectEntity = state.addEntity({
        kind: 'project',
        key: `project:${project.id}`,
        label: project.id,
        projectId: project.id,
        aliases: [project.id, project.path],
        attributes: {
          path: project.path,
          runtime: project.runtime,
          runtimeCandidates: project.runtimeCandidates,
          framework: project.framework,
          kit: project.kit,
          kind: project.kind,
          category: project.category,
        },
        proofIds: [projectProof],
      });
      state.addRelation({
        from: workspaceEntity,
        to: projectEntity,
        kind: 'contains',
        trust: 'authoritative',
        derivation: 'authored',
        proofIds: [projectProof],
      });

      const envKeys = new Set<string>();
      const testFiles: string[] = [];
      for (const file of files) {
        const base = path.basename(file);
        if (/^(?:\.env\.example|\.env\.sample|\.env\.template)$/i.test(base)) {
          try {
            const contents = await fsExtra.readFile(file, 'utf8');
            for (const line of contents.split(/\r?\n/)) {
              const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
              if (key) envKeys.add(key);
            }
          } catch {
            // Unreadable templates do not stop other providers.
          }
        }
        if (
          /(?:^|[\\/])(?:test|tests|spec|specs|__tests__)(?:[\\/]|$)/i.test(file) ||
          /(?:\.test|\.spec|_test)\.[A-Za-z0-9]+$/i.test(base)
        ) {
          testFiles.push(file);
        }
        if (!MANIFEST_NAMES.has(base) && !/\.(?:cs|fs|vb)proj$/i.test(base)) continue;
        try {
          const contents = await fsExtra.readFile(file, 'utf8');
          const manifest = parseManifestMetadata(file, contents);
          const proof = await state.addProof({
            provider: this.id,
            artifact: state.artifactPath(file, project),
            absolutePath: file,
            pointer: '/',
            confidence: manifest.name ? 'high' : 'medium',
            detail: `${manifest.ecosystem} manifest`,
          });
          const packageEntity = state.addEntity({
            kind: 'package',
            key: `package:${project.id}:${manifest.ecosystem}:${manifest.name ?? base}`,
            label: manifest.name ?? `${project.id}/${base}`,
            projectId: project.id,
            aliases: [base, ...(manifest.name ? [manifest.name] : [])],
            attributes: {
              ecosystem: manifest.ecosystem,
              version: manifest.version,
              manifest: state.artifactPath(file, project),
              dependencies: manifest.dependencies,
            },
            proofIds: [proof],
          });
          state.addRelation({
            from: projectEntity,
            to: packageEntity,
            kind: 'contains',
            proofIds: [proof],
          });
          for (const dependency of manifest.dependencies.slice(0, 500)) {
            const dependencyEntity = state.addEntity({
              kind: 'module',
              key: `dependency:${manifest.ecosystem}:${dependency}`,
              label: dependency,
              aliases: [dependency],
              attributes: { ecosystem: manifest.ecosystem, external: true },
              proofIds: [proof],
            });
            state.addRelation({
              from: packageEntity,
              to: dependencyEntity,
              kind: 'depends-on',
              trust: 'authoritative',
              derivation: 'authored',
              proofIds: [proof],
            });
          }
        } catch {
          // Malformed manifests are reported by the dependency provider diagnostics.
        }
      }
      if (envKeys.size > 0) {
        const envFile = files.find((file) =>
          /^\.env\.(?:example|sample|template)$/i.test(path.basename(file))
        );
        if (envFile) {
          const proof = await state.addProof({
            provider: this.id,
            artifact: state.artifactPath(envFile, project),
            absolutePath: envFile,
            detail: 'Public environment template keys only; values are intentionally excluded',
          });
          const environment = state.addEntity({
            kind: 'environment',
            key: `environment:${project.id}:template`,
            label: `${project.id} environment contract`,
            projectId: project.id,
            attributes: { keys: [...envKeys].sort(), valuesEmitted: false },
            proofIds: [proof],
          });
          state.addRelation({
            from: projectEntity,
            to: environment,
            kind: 'configured-by',
            proofIds: [proof],
          });
        }
      }
      if (testFiles.length > 0) {
        const proof = await state.addProof({
          provider: this.id,
          artifact: state.artifactPath(testFiles[0], project),
          absolutePath: testFiles[0],
          detail: `${testFiles.length} test file(s) discovered`,
        });
        const tests = state.addEntity({
          kind: 'test-suite',
          key: `tests:${project.id}`,
          label: `${project.id} tests`,
          projectId: project.id,
          attributes: { fileCount: testFiles.length },
          proofIds: [proof],
        });
        state.addRelation({ from: tests, to: projectEntity, kind: 'tests', proofIds: [proof] });
      }
    }
  },
};

const sourceStructureProvider: Provider = {
  id: 'source-structure',
  version: '1.0.0',
  applicable(context) {
    return context.projects.some((project) =>
      (context.filesByProject.get(project.id) ?? []).some((file) =>
        SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())
      )
    );
  },
  async run(context) {
    for (const project of context.projects) {
      const files = (context.filesByProject.get(project.id) ?? [])
        .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))
        .slice(0, 1_000);
      const usableFiles = new Set<string>();
      await Promise.all(
        files.map(async (file) => {
          try {
            const stats = await fsExtra.stat(file);
            if (stats.isFile() && stats.size <= 2 * 1024 * 1024) {
              usableFiles.add(path.resolve(file));
            }
          } catch {
            // Unreadable files are excluded from local import resolution.
          }
        })
      );
      let symbolCount = 0;
      let unresolvedLocalImports = 0;
      for (const file of files) {
        let contents: string;
        try {
          const stats = await fsExtra.stat(file);
          if (stats.size > 2 * 1024 * 1024) continue;
          contents = await fsExtra.readFile(file, 'utf8');
        } catch {
          continue;
        }
        const artifact = context.state.artifactPath(file, project);
        const fileProof = await context.state.addProof({
          provider: this.id,
          artifact,
          absolutePath: file,
          derivation: 'extracted',
          trust: 'observed',
          confidence: 'high',
          detail: `${sourceLanguage(file)} source file`,
        });
        const fileEntity = context.state.addEntity({
          kind: 'file',
          key: `file:${project.id}:${artifact}`,
          label: artifact,
          projectId: project.id,
          aliases: [path.basename(file)],
          attributes: {
            artifact,
            language: sourceLanguage(file),
            bytes: Buffer.byteLength(contents),
          },
          proofIds: [fileProof],
        });
        context.state.addRelation({
          from: stableId('project', `project:${project.id}`),
          to: fileEntity,
          kind: 'contains',
          proofIds: [fileProof],
        });

        const imports = captureSourceFindings(contents, IMPORT_PATTERNS, 250);
        for (const imported of imports) {
          const proof = await context.state.addProof({
            provider: this.id,
            artifact,
            absolutePath: file,
            line: imported.line,
            derivation: 'extracted',
            trust: 'observed',
            confidence: 'medium',
            detail: `${imported.detail}: ${imported.name}`,
          });
          const localTarget = resolveLocalImportTarget(file, imported.name, usableFiles);
          if (localTarget) {
            const targetArtifact = context.state.artifactPath(localTarget, project);
            context.state.addRelation({
              from: fileEntity,
              to: stableId('file', `file:${project.id}:${targetArtifact}`),
              kind: 'imports',
              confidence: 'high',
              proofIds: [proof],
            });
          } else {
            const unresolvedLocal = imported.name.startsWith('.');
            if (unresolvedLocal) unresolvedLocalImports += 1;
            const module = context.state.addEntity({
              kind: 'module',
              key: `module:${project.id}:${imported.name}`,
              label: imported.name,
              projectId: project.id,
              aliases: [imported.name],
              attributes: {
                specifier: imported.name,
                resolution: unresolvedLocal ? 'unresolved-local' : 'external',
              },
              proofIds: [proof],
            });
            context.state.addRelation({
              from: fileEntity,
              to: module,
              kind: 'imports',
              confidence: unresolvedLocal ? 'low' : 'medium',
              proofIds: [proof],
            });
          }
        }

        if (symbolCount < 500) {
          const symbols = captureSourceFindings(
            contents,
            SYMBOL_PATTERNS,
            Math.min(100, 500 - symbolCount)
          );
          symbolCount += symbols.length;
          for (const symbol of symbols) {
            const proof = await context.state.addProof({
              provider: this.id,
              artifact,
              absolutePath: file,
              line: symbol.line,
              derivation: 'extracted',
              trust: 'observed',
              confidence: 'medium',
              detail: `${symbol.detail}: ${symbol.name}`,
            });
            const entity = context.state.addEntity({
              kind: 'symbol',
              key: `symbol:${project.id}:${artifact}:${symbol.detail}:${symbol.name}`,
              label: symbol.name,
              projectId: project.id,
              attributes: { symbolKind: symbol.detail, language: sourceLanguage(file) },
              proofIds: [proof],
            });
            context.state.addRelation({
              from: fileEntity,
              to: entity,
              kind: 'defines',
              confidence: 'medium',
              proofIds: [proof],
            });
          }
        }

        for (const route of captureSourceFindings(contents, ROUTE_PATTERNS, 100)) {
          const routeLine = contents.split(/\r?\n/)[route.line - 1] ?? '';
          const method =
            routeLine
              .match(/(?:@|\.|\[|^\s*)(get|post|put|delete|patch|options|head)/i)?.[1]
              ?.toUpperCase() ?? 'HTTP';
          const proof = await context.state.addProof({
            provider: this.id,
            artifact,
            absolutePath: file,
            line: route.line,
            derivation: 'extracted',
            trust: 'observed',
            confidence: 'medium',
            detail: `${method} ${route.name}`,
          });
          const endpoint = context.state.addEntity({
            kind: 'endpoint',
            key: `source-endpoint:${project.id}:${artifact}:${method}:${route.name}`,
            label: `${method} ${route.name || '/'}`,
            projectId: project.id,
            attributes: { method, path: route.name || '/', source: artifact },
            proofIds: [proof],
          });
          context.state.addRelation({
            from: fileEntity,
            to: endpoint,
            kind: 'defines',
            confidence: 'medium',
            proofIds: [proof],
          });
        }
      }
      if (files.length >= 1_000 || symbolCount >= 500) {
        context.state.diagnostics.push({
          code: 'graph.provider.source_structure.limit_reached',
          severity: 'info',
          message: `Source extraction for ${project.id} reached its bounded inventory limit.`,
          recommendation:
            'Use the standalone graph package provider configuration for deeper symbol indexing.',
        });
      }
      if (unresolvedLocalImports > 0) {
        context.state.diagnostics.push({
          code: 'graph.provider.source_structure.unresolved_local_imports',
          severity: 'warning',
          message: `${unresolvedLocalImports} local import(s) in ${project.id} could not be resolved to an indexed source file.`,
          recommendation:
            'Check path aliases, generated sources, extension mapping, or provider limits before treating the import graph as complete.',
        });
      }
    }
  },
};

const serviceContractProvider: Provider = {
  id: 'workspace-service-contract',
  version: '1.0.0',
  applicable(context) {
    return Boolean(context.contract?.projects.length);
  },
  async run(context) {
    if (!context.contract) return;
    const events = new Map<string, string>();
    for (const project of [...context.contract.projects].sort((a, b) =>
      a.slug.localeCompare(b.slug)
    )) {
      const contract = project.contracts;
      const proof = await context.state.addProof({
        provider: this.id,
        artifact: '.workspai/workspace.contract.json',
        absolutePath: path.join(context.workspacePath, '.workspai', 'workspace.contract.json'),
        pointer: `/projects/${project.slug}/contracts`,
        trust: 'authoritative',
        derivation: 'authored',
        detail: `Service contract for ${project.slug}`,
      });
      const projectEntity = stableId('project', `project:${project.slug}`);
      const service = context.state.addEntity({
        kind: 'service',
        key: `contract-service:${project.slug}`,
        label: project.slug,
        projectId: project.slug,
        attributes: {
          ports: project.ports.map((port) => `${port.protocol}:${port.port}`),
          owns: [...contract.owns].sort(),
          environmentKeys: [...contract.env].sort(),
        },
        proofIds: [proof],
      });
      context.state.addRelation({
        from: projectEntity,
        to: service,
        kind: 'implements',
        trust: 'authoritative',
        derivation: 'authored',
        proofIds: [proof],
      });
      for (const api of [...contract.apis].sort((a, b) => a.name.localeCompare(b.name))) {
        const apiEntity = context.state.addEntity({
          kind: 'api',
          key: `contract-api:${project.slug}:${api.name}:${api.basePath}`,
          label: api.name,
          projectId: project.slug,
          attributes: { basePath: api.basePath },
          proofIds: [proof],
        });
        context.state.addRelation({
          from: service,
          to: apiEntity,
          kind: 'exposes',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
      }
      for (const event of [...contract.publishes, ...contract.consumes].sort()) {
        if (!events.has(event)) {
          events.set(
            event,
            context.state.addEntity({
              kind: 'queue',
              key: `event:${event}`,
              label: event,
              attributes: { protocol: 'workspace-event' },
              proofIds: [proof],
            })
          );
        }
      }
      for (const event of [...contract.publishes].sort()) {
        const eventEntity = events.get(event);
        if (!eventEntity) continue;
        context.state.addRelation({
          from: service,
          to: eventEntity,
          kind: 'publishes',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
      }
      for (const event of [...contract.consumes].sort()) {
        const eventEntity = events.get(event);
        if (!eventEntity) continue;
        context.state.addRelation({
          from: service,
          to: eventEntity,
          kind: 'consumes',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
      }
    }
  },
};

const openApiProvider: Provider = {
  id: 'openapi',
  version: '1.0.0',
  applicable(context) {
    return context.projects.some((project) =>
      (context.filesByProject.get(project.id) ?? []).some(isOpenApiCandidate)
    );
  },
  async run(context) {
    for (const project of context.projects) {
      const files = (context.filesByProject.get(project.id) ?? []).filter(isOpenApiCandidate);
      for (const file of files) {
        let documents: JsonRecord[];
        try {
          documents = await readStructuredDocuments(file);
        } catch (error) {
          context.state.diagnostics.push({
            code: 'graph.provider.openapi.parse_failed',
            severity: 'warning',
            message: `Could not parse ${context.state.artifactPath(file, project)}: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
        for (const document of documents) {
          if (!('openapi' in document) && !('swagger' in document)) continue;
          const info = asRecord(document.info);
          const title = stringValue(info?.title) ?? `${project.id} API`;
          const apiProof = await context.state.addProof({
            provider: this.id,
            artifact: context.state.artifactPath(file, project),
            absolutePath: file,
            pointer: '/info',
            trust: 'authoritative',
            detail: 'Authored OpenAPI contract',
          });
          const projectEntity = stableId('project', `project:${project.id}`);
          const apiEntity = context.state.addEntity({
            kind: 'api',
            key: `api:${project.id}:${title}`,
            label: title,
            projectId: project.id,
            attributes: {
              version: stringValue(info?.version),
              specification: stringValue(document.openapi) ?? stringValue(document.swagger),
            },
            proofIds: [apiProof],
          });
          context.state.addRelation({
            from: projectEntity,
            to: apiEntity,
            kind: 'exposes',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [apiProof],
          });
          const schemas =
            asRecord(asRecord(document.components)?.schemas) ?? asRecord(document.definitions);
          const schemaIds = new Map<string, string>();
          for (const schemaName of Object.keys(schemas ?? {}).sort()) {
            const proof = await context.state.addProof({
              provider: this.id,
              artifact: context.state.artifactPath(file, project),
              absolutePath: file,
              pointer: `/components/schemas/${schemaName}`,
              trust: 'authoritative',
              detail: `OpenAPI schema ${schemaName}`,
            });
            const entity = context.state.addEntity({
              kind: 'schema',
              key: `schema:${project.id}:${title}:${schemaName}`,
              label: schemaName,
              projectId: project.id,
              proofIds: [proof],
            });
            schemaIds.set(schemaName, entity);
            context.state.addRelation({
              from: apiEntity,
              to: entity,
              kind: 'contains',
              trust: 'authoritative',
              derivation: 'authored',
              proofIds: [proof],
            });
          }
          const paths = asRecord(document.paths);
          for (const route of Object.keys(paths ?? {}).sort()) {
            const operations = asRecord(paths?.[route]);
            for (const method of Object.keys(operations ?? {})
              .filter((key) => HTTP_METHODS.has(key.toLowerCase()))
              .sort()) {
              const operation = asRecord(operations?.[method]);
              const pointer = `/paths/${route.replace(/~/g, '~0').replace(/\//g, '~1')}/${method}`;
              const proof = await context.state.addProof({
                provider: this.id,
                artifact: context.state.artifactPath(file, project),
                absolutePath: file,
                pointer,
                trust: 'authoritative',
                detail: `${method.toUpperCase()} ${route}`,
              });
              const endpoint = context.state.addEntity({
                kind: 'endpoint',
                key: `endpoint:${project.id}:${title}:${method.toUpperCase()}:${route}`,
                label: `${method.toUpperCase()} ${route}`,
                projectId: project.id,
                aliases: stringArray(operation?.tags),
                attributes: {
                  method: method.toUpperCase(),
                  path: route,
                  operationId: stringValue(operation?.operationId),
                  deprecated:
                    typeof operation?.deprecated === 'boolean' ? operation.deprecated : undefined,
                  tags: stringArray(operation?.tags),
                },
                proofIds: [proof],
              });
              context.state.addRelation({
                from: apiEntity,
                to: endpoint,
                kind: 'contains',
                trust: 'authoritative',
                derivation: 'authored',
                proofIds: [proof],
              });
              const serialized = JSON.stringify(operation ?? {});
              for (const [schemaName, schemaId] of schemaIds) {
                if (!serialized.includes(`/${schemaName}`)) continue;
                context.state.addRelation({
                  from: endpoint,
                  to: schemaId,
                  kind: 'references',
                  trust: 'authoritative',
                  derivation: 'authored',
                  proofIds: [proof],
                });
              }
            }
          }
        }
      }
    }
  },
};

const interfaceContractProvider: Provider = {
  id: 'interface-contracts',
  version: '1.0.0',
  applicable(context) {
    return context.projects.some((project) =>
      (context.filesByProject.get(project.id) ?? []).some(isInterfaceContractCandidate)
    );
  },
  async run(context) {
    for (const project of context.projects) {
      const files = (context.filesByProject.get(project.id) ?? []).filter(
        isInterfaceContractCandidate
      );
      for (const file of files) {
        const artifact = context.state.artifactPath(file, project);
        const extension = path.extname(file).toLowerCase();
        if (extension === '.graphql' || extension === '.gql') {
          const contents = await fsExtra.readFile(file, 'utf8');
          const proof = await context.state.addProof({
            provider: this.id,
            artifact,
            absolutePath: file,
            trust: 'authoritative',
            derivation: 'authored',
            detail: 'GraphQL schema',
          });
          const api = context.state.addEntity({
            kind: 'api',
            key: `graphql:${project.id}:${artifact}`,
            label: `${project.id} GraphQL API`,
            projectId: project.id,
            attributes: { specification: 'graphql', artifact },
            proofIds: [proof],
          });
          context.state.addRelation({
            from: stableId('project', `project:${project.id}`),
            to: api,
            kind: 'exposes',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [proof],
          });
          for (const match of contents.matchAll(
            /^\s*(?:type|input|interface|enum|scalar|union)\s+([A-Za-z_]\w*)/gm
          )) {
            const schema = context.state.addEntity({
              kind: 'schema',
              key: `graphql-schema:${project.id}:${artifact}:${match[1]}`,
              label: match[1],
              projectId: project.id,
              proofIds: [proof],
            });
            context.state.addRelation({
              from: api,
              to: schema,
              kind: 'contains',
              trust: 'authoritative',
              derivation: 'authored',
              proofIds: [proof],
            });
          }
          continue;
        }
        if (extension === '.proto') {
          const contents = await fsExtra.readFile(file, 'utf8');
          const contractFingerprint = hash(contents.replace(/\r\n/g, '\n').trim());
          const packageName = contents.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)?.[1];
          const identityNamespace = packageName || `unscoped:${contractFingerprint.slice(0, 16)}`;
          const proof = await context.state.addProof({
            provider: this.id,
            artifact,
            absolutePath: file,
            trust: 'authoritative',
            derivation: 'authored',
            detail: 'Protocol Buffers contract',
          });
          for (const serviceMatch of contents.matchAll(/^\s*service\s+([A-Za-z_]\w*)/gm)) {
            const api = context.state.addEntity({
              kind: 'api',
              key: `protobuf-service:${identityNamespace}:${serviceMatch[1]}`,
              label: serviceMatch[1],
              aliases: [
                ...(packageName ? [`${packageName}.${serviceMatch[1]}`] : []),
                serviceMatch[1],
              ],
              attributes: {
                specification: 'protobuf',
                package: packageName,
                definitionHash: contractFingerprint,
              },
              proofIds: [proof],
            });
            context.state.addRelation({
              from: stableId('project', `project:${project.id}`),
              to: api,
              kind: 'exposes',
              trust: 'authoritative',
              derivation: 'authored',
              proofIds: [proof],
            });
          }
          for (const messageMatch of contents.matchAll(/^\s*message\s+([A-Za-z_]\w*)/gm)) {
            context.state.addEntity({
              kind: 'schema',
              key: `protobuf-message:${identityNamespace}:${messageMatch[1]}`,
              label: messageMatch[1],
              aliases: [
                ...(packageName ? [`${packageName}.${messageMatch[1]}`] : []),
                messageMatch[1],
              ],
              attributes: {
                specification: 'protobuf',
                package: packageName,
                definitionHash: contractFingerprint,
              },
              proofIds: [proof],
            });
          }
          continue;
        }
        try {
          const document = (await readStructuredDocuments(file))[0];
          if (!document || !('asyncapi' in document)) continue;
          const proof = await context.state.addProof({
            provider: this.id,
            artifact,
            absolutePath: file,
            trust: 'authoritative',
            derivation: 'authored',
            detail: 'AsyncAPI contract',
          });
          const api = context.state.addEntity({
            kind: 'api',
            key: `asyncapi:${project.id}:${artifact}`,
            label: stringValue(asRecord(document.info)?.title) ?? `${project.id} AsyncAPI`,
            projectId: project.id,
            attributes: { specification: `asyncapi ${String(document.asyncapi)}`, artifact },
            proofIds: [proof],
          });
          context.state.addRelation({
            from: stableId('project', `project:${project.id}`),
            to: api,
            kind: 'exposes',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [proof],
          });
          for (const channel of Object.keys(asRecord(document.channels) ?? {}).sort()) {
            const queue = context.state.addEntity({
              kind: 'queue',
              key: `asyncapi-channel:${project.id}:${channel}`,
              label: channel,
              projectId: project.id,
              attributes: { protocol: 'asyncapi' },
              proofIds: [proof],
            });
            context.state.addRelation({
              from: api,
              to: queue,
              kind: 'publishes',
              trust: 'authoritative',
              derivation: 'authored',
              proofIds: [proof],
            });
          }
        } catch {
          // A malformed contract remains isolated to this provider.
        }
      }
    }
  },
};

const infrastructureProvider: Provider = {
  id: 'infrastructure-as-code',
  version: '1.0.0',
  applicable(context) {
    return uniqueInventoryFiles(context).some(isInfrastructureCandidate);
  },
  async run(context) {
    const files = uniqueInventoryFiles(context).filter(isInfrastructureCandidate);
    for (const file of files) {
      const project = projectForFile(context.projects, file);
      const scopeId = project?.id ?? context.state.workspaceName;
      const subject = project
        ? stableId('project', `project:${project.id}`)
        : stableId('workspace', `workspace:${context.state.workspaceName}`);
      const artifact = context.state.artifactPath(file, project);
      const contents = await fsExtra.readFile(file, 'utf8');
      const proof = await context.state.addProof({
        provider: this.id,
        artifact,
        absolutePath: file,
        trust: 'authoritative',
        derivation: 'authored',
        detail: 'Infrastructure definition',
      });
      if (/^Dockerfile/i.test(path.basename(file))) {
        const images = [...contents.matchAll(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/gim)];
        const container = context.state.addEntity({
          kind: 'container',
          key: `dockerfile:${scopeId}:${artifact}`,
          label: `${scopeId} container image`,
          ...(project ? { projectId: project.id } : {}),
          attributes: { artifact, baseImages: images.map((match) => match[1]) },
          proofIds: [proof],
        });
        context.state.addRelation({
          from: subject,
          to: container,
          kind: 'deploys',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
        continue;
      }
      if (/\.tf$/i.test(file)) {
        for (const resource of contents.matchAll(
          /^\s*resource\s+["']([^"']+)["']\s+["']([^"']+)["']/gm
        )) {
          const resourceType = resource[1];
          const kind: WorkspaceKnowledgeEntityKind = /(?:db|sql|rds|database)/i.test(resourceType)
            ? 'database'
            : /(?:queue|kafka|sqs|pubsub|servicebus)/i.test(resourceType)
              ? 'queue'
              : 'deployment';
          const entity = context.state.addEntity({
            kind,
            key: `terraform:${scopeId}:${resourceType}:${resource[2]}`,
            label: `${resourceType}.${resource[2]}`,
            ...(project ? { projectId: project.id } : {}),
            attributes: { resourceType, artifact },
            proofIds: [proof],
          });
          context.state.addRelation({
            from: subject,
            to: entity,
            kind: 'deploys',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [proof],
          });
        }
        continue;
      }
      const chart = context.state.addEntity({
        kind: 'deployment',
        key: `helm:${scopeId}:${artifact}`,
        label: `${scopeId} Helm chart`,
        ...(project ? { projectId: project.id } : {}),
        attributes: { artifact, format: 'helm' },
        proofIds: [proof],
      });
      context.state.addRelation({
        from: subject,
        to: chart,
        kind: 'deploys',
        trust: 'authoritative',
        derivation: 'authored',
        proofIds: [proof],
      });
    }
  },
};

function classifyImage(image: string): WorkspaceKnowledgeEntityKind {
  const normalized = image.toLowerCase();
  if (/(?:postgres|mysql|mariadb|mongo|cassandra|cockroach|mssql|oracle)/.test(normalized))
    return 'database';
  if (/(?:rabbitmq|kafka|nats|pulsar|activemq|redis)/.test(normalized)) return 'queue';
  return 'container';
}

const composeProvider: Provider = {
  id: 'compose',
  version: '1.0.0',
  async applicable(context) {
    return (await composeCandidateFiles(context)).length > 0;
  },
  async run(context) {
    for (const file of await composeCandidateFiles(context)) {
      let document: JsonRecord | undefined;
      try {
        document = (await readStructuredDocuments(file))[0];
      } catch (error) {
        context.state.diagnostics.push({
          code: 'graph.provider.compose.parse_failed',
          severity: 'warning',
          message: `Could not parse ${context.state.artifactPath(file)}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      const services = asRecord(document?.services);
      if (!services) continue;
      const ownerProject = projectForFile(context.projects, file);
      const serviceIds = new Map<string, string>();
      for (const serviceName of Object.keys(services).sort()) {
        const service = asRecord(services[serviceName]);
        const build = service?.build;
        const buildContext = stringValue(build) ?? stringValue(asRecord(build)?.context);
        const serviceProject = buildContext
          ? projectForFile(context.projects, path.resolve(path.dirname(file), buildContext))
          : (context.projects.find(
              (project) =>
                project.id.toLowerCase() === serviceName.toLowerCase() ||
                path.basename(project.path).toLowerCase() === serviceName.toLowerCase()
            ) ?? ownerProject);
        const proof = await context.state.addProof({
          provider: this.id,
          artifact: context.state.artifactPath(file, ownerProject),
          absolutePath: file,
          pointer: `/services/${serviceName}`,
          trust: 'authoritative',
          derivation: 'authored',
          detail: `Compose service ${serviceName}`,
        });
        const image = stringValue(service?.image);
        const serviceEntity = context.state.addEntity({
          kind: 'service',
          key: `compose-service:${context.state.artifactPath(file, ownerProject)}:${serviceName}`,
          label: serviceName,
          ...(serviceProject ? { projectId: serviceProject.id } : {}),
          attributes: {
            image,
            ports: stringArray(service?.ports).map(String),
            networks: stringArray(service?.networks),
            environmentKeys: environmentKeys(service?.environment),
          },
          proofIds: [proof],
        });
        serviceIds.set(serviceName, serviceEntity);
        if (serviceProject) {
          context.state.addRelation({
            from: stableId('project', `project:${serviceProject.id}`),
            to: serviceEntity,
            kind: 'contains',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [proof],
          });
        }
        if (image) {
          const runtimeEntity = context.state.addEntity({
            kind: classifyImage(image),
            key: `image:${image}`,
            label: image,
            ...(serviceProject ? { projectId: serviceProject.id } : {}),
            attributes: { image },
            proofIds: [proof],
          });
          context.state.addRelation({
            from: serviceEntity,
            to: runtimeEntity,
            kind: classifyImage(image) === 'container' ? 'runs-on' : 'depends-on',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [proof],
          });
        }
      }
      for (const serviceName of Object.keys(services).sort()) {
        const service = asRecord(services[serviceName]);
        const from = serviceIds.get(serviceName);
        if (!from) continue;
        for (const dependency of stringArray(service?.depends_on)) {
          const to = serviceIds.get(dependency);
          if (!to) continue;
          const proof = await context.state.addProof({
            provider: this.id,
            artifact: context.state.artifactPath(file, ownerProject),
            absolutePath: file,
            pointer: `/services/${serviceName}/depends_on/${dependency}`,
            trust: 'authoritative',
            derivation: 'authored',
            detail: `${serviceName} depends on ${dependency}`,
          });
          context.state.addRelation({
            from,
            to,
            kind: 'depends-on',
            trust: 'authoritative',
            derivation: 'authored',
            proofIds: [proof],
          });
        }
      }
    }
  },
};

const documentationProvider: Provider = {
  id: 'documentation',
  version: '1.0.0',
  applicable(context) {
    return uniqueInventoryFiles(context).some(isDocumentationCandidate);
  },
  async run(context) {
    const seen = new Set<string>();
    const inventories = [
      context.workspaceFiles,
      ...context.projects.map((project) => context.filesByProject.get(project.id) ?? []),
    ];
    for (const inventory of inventories) {
      const files = inventory.filter(isDocumentationCandidate);
      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        const project = projectForFile(context.projects, file);
        const contents = await fsExtra.readFile(file, 'utf8');
        const title = contents.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file);
        const proof = await context.state.addProof({
          provider: this.id,
          artifact: context.state.artifactPath(file, project),
          absolutePath: file,
          line: 1,
          trust: 'authoritative',
          derivation: 'authored',
          detail: `Documentation: ${title}`,
        });
        const document = context.state.addEntity({
          kind: 'document',
          key: `document:${context.state.artifactPath(file, project)}`,
          label: title,
          ...(project ? { projectId: project.id } : {}),
          attributes: { artifact: context.state.artifactPath(file, project) },
          proofIds: [proof],
        });
        const subject = project
          ? stableId('project', `project:${project.id}`)
          : stableId('workspace', `workspace:${context.state.workspaceName}`);
        context.state.addRelation({
          from: document,
          to: subject,
          kind: 'documents',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
      }
    }
  },
};

const kubernetesProvider: Provider = {
  id: 'kubernetes',
  version: '1.0.0',
  async applicable(context) {
    return (await kubernetesCandidateFiles(context)).length > 0;
  },
  async run(context) {
    for (const file of await kubernetesCandidateFiles(context)) {
      const project = projectForFile(context.projects, file);
      const subject = project
        ? stableId('project', `project:${project.id}`)
        : stableId('workspace', `workspace:${context.state.workspaceName}`);
      const documents = await readStructuredDocuments(file);
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index];
        const kind = stringValue(document.kind);
        const metadata = asRecord(document.metadata);
        const name = stringValue(metadata?.name);
        if (!kind || !name) continue;
        const namespace = stringValue(metadata?.namespace) ?? 'default';
        const entityKind: WorkspaceKnowledgeEntityKind = /Deployment|StatefulSet|DaemonSet/i.test(
          kind
        )
          ? 'deployment'
          : /Service|Ingress/i.test(kind)
            ? 'service'
            : /ConfigMap|Secret/i.test(kind)
              ? 'environment'
              : 'deployment';
        const proof = await context.state.addProof({
          provider: this.id,
          artifact: context.state.artifactPath(file, project),
          absolutePath: file,
          pointer: `/documents/${index}`,
          trust: 'authoritative',
          derivation: 'authored',
          detail: `${kind} ${namespace}/${name}`,
        });
        const entity = context.state.addEntity({
          kind: entityKind,
          key: `kubernetes:${kind}:${namespace}:${name}`,
          label: `${kind}/${name}`,
          ...(project ? { projectId: project.id } : {}),
          attributes: {
            resourceKind: kind,
            namespace,
            secret: kind === 'Secret',
            keys:
              kind === 'Secret' || kind === 'ConfigMap'
                ? Object.keys(asRecord(document.data) ?? {}).sort()
                : undefined,
          },
          proofIds: [proof],
        });
        context.state.addRelation({
          from: subject,
          to: entity,
          kind: entityKind === 'deployment' ? 'deploys' : 'contains',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
        const environment = context.state.addEntity({
          kind: 'environment',
          key: `kubernetes-namespace:${namespace}`,
          label: `Kubernetes namespace ${namespace}`,
          attributes: { namespace },
          proofIds: [proof],
        });
        context.state.addRelation({
          from: entity,
          to: environment,
          kind: 'runs-on',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
      }
    }
  },
};

const ciProvider: Provider = {
  id: 'ci-workflow',
  version: '1.0.0',
  applicable(context) {
    return ciCandidateFiles(context).length > 0;
  },
  async run(context) {
    const files = ciCandidateFiles(context);
    for (const file of files) {
      const project = projectForFile(context.projects, file);
      const artifact = context.state.artifactPath(file, project);
      const isJenkins = path.basename(file) === 'Jenkinsfile';
      let label = path.basename(file);
      let jobs: string[] = [];
      let triggers: string[] = [];
      if (isJenkins) {
        const contents = await fsExtra.readFile(file, 'utf8');
        jobs = [...contents.matchAll(/\bstage\s*\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
      } else {
        let document: JsonRecord | undefined;
        try {
          document = (await readStructuredDocuments(file))[0];
        } catch {
          continue;
        }
        if (!document) continue;
        label = stringValue(document.name) ?? label;
        const relative = toPosix(path.relative(project?.root ?? context.workspacePath, file));
        if (/^\.gitlab-ci\./i.test(relative)) {
          const reserved = new Set([
            'stages',
            'variables',
            'workflow',
            'include',
            'default',
            'image',
            'services',
            'cache',
            'before_script',
            'after_script',
          ]);
          jobs = Object.keys(document)
            .filter((key) => !key.startsWith('.') && !reserved.has(key))
            .sort();
        } else {
          jobs = [
            ...new Set([
              ...Object.keys(asRecord(document.jobs) ?? {}),
              ...Object.keys(asRecord(asRecord(document.workflows)?.jobs) ?? {}),
              ...stringArray(document.stages),
            ]),
          ].sort();
        }
        triggers = stringArray(document.on);
      }
      if (jobs.length === 0) jobs = ['pipeline'];
      const proof = await context.state.addProof({
        provider: this.id,
        artifact,
        absolutePath: file,
        ...(!isJenkins ? { pointer: '/jobs' } : {}),
        trust: 'authoritative',
        derivation: 'authored',
        detail: 'CI/CD workflow',
      });
      const pipeline = context.state.addEntity({
        kind: 'pipeline',
        key: `pipeline:${artifact}`,
        label,
        attributes: { jobs, triggers, artifact },
        proofIds: [proof],
      });
      context.state.addRelation({
        from: project
          ? stableId('project', `project:${project.id}`)
          : stableId('workspace', `workspace:${context.state.workspaceName}`),
        to: pipeline,
        kind: 'contains',
        trust: 'authoritative',
        derivation: 'authored',
        proofIds: [proof],
      });
    }
  },
};

const ownershipProvider: Provider = {
  id: 'codeowners',
  version: '1.0.0',
  async applicable(context) {
    return (await ownershipCandidateFiles(context)).length > 0;
  },
  async run(context) {
    for (const file of await ownershipCandidateFiles(context)) {
      const owningProject = projectForFile(context.projects, file);
      const contents = await fsExtra.readFile(file, 'utf8');
      const lines = contents.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line || line.startsWith('#')) continue;
        const [pattern, ...owners] = line.split(/\s+/);
        for (const owner of owners.filter((value) => value.startsWith('@'))) {
          const proof = await context.state.addProof({
            provider: this.id,
            artifact: context.state.artifactPath(file, owningProject),
            absolutePath: file,
            line: index + 1,
            trust: 'authoritative',
            derivation: 'authored',
            detail: `${pattern} ${owner}`,
          });
          const ownerEntity = context.state.addEntity({
            kind: 'owner',
            key: `owner:${owner.toLowerCase()}`,
            label: owner,
            aliases: [owner],
            proofIds: [proof],
          });
          const matchedProjects = context.projects.filter((project) => {
            const normalizedPattern = pattern.replace(/^\//, '').replace(/\*.*$/, '');
            const codeownersDirectory = path.dirname(file);
            const codeownersRoot = ['.github', 'docs'].includes(path.basename(codeownersDirectory))
              ? path.dirname(codeownersDirectory)
              : codeownersDirectory;
            const relativeProjectPath = toPosix(path.relative(codeownersRoot, project.root));
            return (
              normalizedPattern &&
              (relativeProjectPath === '.' ||
                relativeProjectPath.startsWith(normalizedPattern.replace(/\/$/, '')) ||
                project.path.startsWith(normalizedPattern.replace(/\/$/, '')))
            );
          });
          const targets =
            matchedProjects.length > 0
              ? matchedProjects.map((project) => stableId('project', `project:${project.id}`))
              : owningProject
                ? [stableId('project', `project:${owningProject.id}`)]
                : [stableId('workspace', `workspace:${context.state.workspaceName}`)];
          for (const target of targets) {
            context.state.addRelation({
              from: ownerEntity,
              to: target,
              kind: 'owns',
              trust: 'authoritative',
              derivation: 'authored',
              proofIds: [proof],
            });
          }
        }
      }
    }
  },
};

const decisionProvider: Provider = {
  id: 'architecture-decisions',
  version: '1.0.0',
  applicable(context) {
    return [
      { root: context.workspacePath, files: context.workspaceFiles },
      ...context.projects.map((project) => ({
        root: project.root,
        files: context.filesByProject.get(project.id) ?? [],
      })),
    ].some((inventory) =>
      inventory.files.some((file) => isDecisionCandidate(inventory.root, file))
    );
  },
  async run(context) {
    const seen = new Set<string>();
    const inventories = [
      { root: context.workspacePath, files: context.workspaceFiles },
      ...context.projects.map((project) => ({
        root: project.root,
        files: context.filesByProject.get(project.id) ?? [],
      })),
    ];
    for (const inventory of inventories) {
      const files = inventory.files.filter((file) => isDecisionCandidate(inventory.root, file));
      for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        const project = projectForFile(context.projects, file);
        const contents = await fsExtra.readFile(file, 'utf8');
        const title = contents.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file, '.md');
        const status = contents.match(/^status\s*:\s*(.+)$/im)?.[1]?.trim();
        const proof = await context.state.addProof({
          provider: this.id,
          artifact: context.state.artifactPath(file, project),
          absolutePath: file,
          line: 1,
          trust: 'authoritative',
          derivation: 'authored',
          detail: `Architecture decision: ${title}`,
        });
        const decision = context.state.addEntity({
          kind: 'decision',
          key: `decision:${context.state.artifactPath(file, project)}`,
          label: title,
          ...(project ? { projectId: project.id } : {}),
          attributes: { status, artifact: context.state.artifactPath(file, project) },
          proofIds: [proof],
        });
        const target = project
          ? stableId('project', `project:${project.id}`)
          : stableId('workspace', `workspace:${context.state.workspaceName}`);
        context.state.addRelation({
          from: target,
          to: decision,
          kind: 'decided-by',
          trust: 'authoritative',
          derivation: 'authored',
          proofIds: [proof],
        });
      }
    }
  },
};

const PROVIDERS: Provider[] = [
  foundationProvider,
  sourceStructureProvider,
  serviceContractProvider,
  openApiProvider,
  interfaceContractProvider,
  composeProvider,
  infrastructureProvider,
  kubernetesProvider,
  ciProvider,
  ownershipProvider,
  documentationProvider,
  decisionProvider,
];

async function addProjectTopology(
  state: KnowledgeGraphState,
  topology: WorkspaceDependencyGraph
): Promise<void> {
  for (const edge of topology.edges) {
    const proofIds: string[] = [];
    for (const evidence of edge.evidence) {
      const artifact = safeArtifact(evidence.file);
      proofIds.push(
        await state.addProof({
          provider: 'project-topology',
          artifact,
          absolutePath: path.resolve(state.workspacePath, artifact),
          derivation: edge.source === 'inferred' ? 'inferred' : 'authored',
          trust: edge.source === 'inferred' ? 'observed' : 'authoritative',
          confidence: edge.confidence,
          detail: evidence.detail ?? `${edge.kind} relationship`,
        })
      );
    }
    if (proofIds.length === 0) {
      proofIds.push(
        await state.addProof({
          provider: 'project-topology',
          artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
          derivation: 'inferred',
          trust: 'ambiguous',
          confidence: edge.confidence,
          detail: `${edge.kind} relationship without source locator`,
        })
      );
    }
    state.addRelation({
      from: stableId('project', `project:${edge.from}`),
      to: stableId('project', `project:${edge.to}`),
      kind: edge.kind === 'event-pub-sub' ? 'consumes' : 'depends-on',
      derivation: edge.source === 'inferred' ? 'inferred' : 'authored',
      trust: edge.source === 'inferred' ? 'observed' : 'authoritative',
      confidence: edge.confidence,
      proofIds,
    });
  }
}

function reconcileCrossProviderEvidence(state: KnowledgeGraphState): void {
  const endpoints = [...state.entities.values()].filter((entity) => entity.kind === 'endpoint');
  const groups = new Map<string, WorkspaceKnowledgeEntity[]>();
  for (const endpoint of endpoints) {
    const method = String(endpoint.attributes.method ?? '').toUpperCase();
    const route = String(endpoint.attributes.path ?? '');
    if (!endpoint.projectId || !method || !route) continue;
    const key = `${endpoint.projectId}\0${method}\0${route}`;
    const group = groups.get(key) ?? [];
    group.push(endpoint);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const authored = group.find((entity) =>
      entity.proofIds.some((proofId) => state.proofs.get(proofId)?.trust === 'authoritative')
    );
    if (!authored) continue;
    for (const observed of group.filter((entity) => entity.id !== authored.id)) {
      state.addRelation({
        from: observed.id,
        to: authored.id,
        kind: 'implements',
        derivation: 'extracted',
        trust: 'corroborated',
        confidence: 'high',
        proofIds: [...observed.proofIds, ...authored.proofIds],
      });
    }
  }
}

function bindingCoverage(eligibleIds: readonly string[], boundIds: ReadonlySet<string>) {
  const eligible = [...new Set(eligibleIds)];
  const boundCount = eligible.filter((id) => boundIds.has(id)).length;
  return {
    eligibleCount: eligible.length,
    boundCount,
    unknownCount: eligible.length - boundCount,
    coverageRatio: eligible.length === 0 ? null : boundCount / eligible.length,
  };
}

function calculateBindingCoverage(
  entities: readonly WorkspaceKnowledgeEntity[],
  relations: readonly WorkspaceKnowledgeRelation[]
): NonNullable<WorkspaceKnowledgeGraph['quality']['bindingCoverage']> {
  const projectIds = entities
    .filter((entity) => entity.kind === 'project')
    .map((entity) => entity.id);
  const endpointIds = entities
    .filter((entity) => entity.kind === 'endpoint')
    .map((entity) => entity.id);
  const implementedEndpoints = new Set(
    relations
      .filter((relation) => relation.kind === 'implements')
      .flatMap((relation) => [relation.from, relation.to])
  );
  const testedProjects = new Set(
    relations
      .filter((relation) => relation.kind === 'tests')
      .flatMap((relation) => [relation.from, relation.to])
      .filter((id) => projectIds.includes(id))
  );
  const deployedProjects = new Set(
    relations
      .filter((relation) => relation.kind === 'deploys')
      .flatMap((relation) => [relation.from, relation.to])
      .filter((id) => projectIds.includes(id))
  );
  const ownedProjects = new Set(
    relations
      .filter((relation) => relation.kind === 'owns')
      .flatMap((relation) => [relation.from, relation.to])
      .filter((id) => projectIds.includes(id))
  );
  return {
    apiImplementation: bindingCoverage(endpointIds, implementedEndpoints),
    projectTests: bindingCoverage(projectIds, testedProjects),
    projectDeployment: bindingCoverage(projectIds, deployedProjects),
    projectOwnership: bindingCoverage(projectIds, ownedProjects),
  };
}

export async function buildWorkspaceKnowledgeGraph(
  options: BuildWorkspaceKnowledgeGraphOptions
): Promise<WorkspaceKnowledgeGraph> {
  const workspacePath = path.resolve(options.workspacePath);
  const now = options.now ?? new Date();
  const projects: ResolvedProject[] = options.projects
    .map((project) => ({
      ...project,
      root: project.absolutePath
        ? path.resolve(project.absolutePath)
        : path.resolve(workspacePath, project.path),
      artifactPrefix: project.absolutePath ? `external/${project.id}` : toPosix(project.path),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const state = new KnowledgeGraphState(workspacePath, now, options.workspace.name);
  const maxFilesPerProject = Math.max(100, Math.min(options.maxFilesPerProject ?? 2_000, 10_000));
  const filesByProject = new Map(
    await Promise.all(
      projects.map(
        async (project) => [project.id, await listFiles(project.root, maxFilesPerProject)] as const
      )
    )
  );
  const workspaceFiles = await listFiles(
    workspacePath,
    Math.min(maxFilesPerProject * Math.max(projects.length, 1), 20_000)
  );
  const context: ProviderContext = {
    workspacePath,
    projects,
    filesByProject,
    workspaceFiles,
    now,
    maxFilesPerProject,
    contract: options.contract ?? null,
    state,
  };

  for (const provider of PROVIDERS) {
    const before = {
      entities: state.entities.size,
      relations: state.relations.size,
      proofs: state.proofs.size,
      diagnostics: state.diagnostics.length,
    };
    let status: WorkspaceKnowledgeProviderRun['status'] = 'passed';
    let executionError: string | null = null;
    try {
      const applicable = provider.applicable ? await provider.applicable(context) : true;
      if (!applicable) {
        status = 'skipped';
      } else {
        await provider.run(context);
        const discoveredEntities = state.entities.size - before.entities;
        const discoveredRelations = state.relations.size - before.relations;
        const discoveredProofs = state.proofs.size - before.proofs;
        if (discoveredEntities === 0 && discoveredRelations === 0 && discoveredProofs === 0) {
          status = 'partial';
          state.diagnostics.push({
            code: `graph.provider.${provider.id}.empty_result`,
            severity: 'warning',
            message: `${provider.id} found an applicable source surface but produced no graph evidence.`,
            recommendation:
              'Inspect the matching source format or extend the provider before treating this graph dimension as complete.',
          });
        } else if (state.diagnostics.length > before.diagnostics) {
          status = 'partial';
        }
      }
    } catch (error) {
      status = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      executionError = message;
      state.diagnostics.push({
        code: `graph.provider.${provider.id}.failed`,
        severity: 'warning',
        message: `${provider.id} provider failed: ${message}`,
        recommendation: 'Repair the referenced source artifact and rerun workspace graph emit.',
      });
    }
    const providerDiagnostics = state.diagnostics
      .slice(before.diagnostics)
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
    if (executionError && providerDiagnostics.length === 0) {
      providerDiagnostics.push(executionError);
    }
    state.providers.push({
      id: provider.id,
      version: provider.version,
      status,
      permission: 'filesystem-read',
      discoveredEntities: state.entities.size - before.entities,
      discoveredRelations: state.relations.size - before.relations,
      proofCount: state.proofs.size - before.proofs,
      diagnostics: providerDiagnostics,
    });
  }
  reconcileCrossProviderEvidence(state);
  await addProjectTopology(state, options.projectTopology);

  const entities = [...state.entities.values()].sort((a, b) => a.id.localeCompare(b.id));
  const relations = [...state.relations.values()].sort((a, b) => a.id.localeCompare(b.id));
  const proofs = [...state.proofs.values()].sort((a, b) => a.id.localeCompare(b.id));
  const entityProofed = entities.filter((entity) => entity.proofIds.length > 0).length;
  const relationProofed = relations.filter((relation) => relation.proofIds.length > 0).length;
  // This is deliberately an execution-success ratio, not a completeness
  // score. Skipped means not applicable; partial and explicit unknowns are
  // represented separately in provider status and quality.unknownCount.
  const successfulProviders = state.providers.filter(
    (provider) => provider.status !== 'failed'
  ).length;
  const orphanIds =
    options.projectTopology.diagnostics
      ?.filter((diagnostic) => diagnostic.code === 'graph.edges.missing')
      .flatMap((diagnostic) => diagnostic.nodeIds ?? []) ?? [];
  if (orphanIds.length > 0) {
    state.diagnostics.push({
      code: 'graph.knowledge.project_relationships_unknown',
      severity: 'warning',
      message: `${orphanIds.length} project(s) have no proven inter-project relationship. This is unknown topology, not proof of independence.`,
      entityIds: orphanIds.map((id) => stableId('project', `project:${id}`)),
      recommendation:
        'Author service contracts or add OpenAPI, Compose, Kubernetes, package or import evidence.',
    });
  }
  const explicitUnknownCount = state.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code.includes('unknown') ||
        diagnostic.code.includes('unresolved') ||
        diagnostic.code.includes('limit_reached') ||
        diagnostic.code.endsWith('.empty_result')
    )
    .reduce(
      (count, diagnostic) =>
        count + Math.max(diagnostic.entityIds?.length ?? 0, diagnostic.relationIds?.length ?? 0, 1),
      0
    );
  const bindingCoverage = calculateBindingCoverage(entities, relations);
  const bindingUnknownCount = Object.values(bindingCoverage).reduce(
    (count, dimension) => count + dimension.unknownCount,
    0
  );

  return {
    schemaVersion: WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    source: options.source,
    workspace: options.workspace,
    projectTopology: options.projectTopology,
    entities,
    relations,
    proofs,
    providers: [...state.providers].sort((a, b) => a.id.localeCompare(b.id)),
    quality: {
      entityCount: entities.length,
      relationCount: relations.length,
      proofCount: proofs.length,
      entityProofCoverageRatio: entities.length === 0 ? 1 : entityProofed / entities.length,
      relationProofCoverageRatio: relations.length === 0 ? 1 : relationProofed / relations.length,
      providerSuccessRatio:
        state.providers.length === 0 ? 1 : successfulProviders / state.providers.length,
      conflictCount: state.diagnostics.filter((diagnostic) => diagnostic.code.includes('conflict'))
        .length,
      unknownCount: explicitUnknownCount + bindingUnknownCount,
      bindingCoverage,
      portable: true,
      secretValuesEmitted: false,
    },
    diagnostics: [...state.diagnostics].sort(
      (a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
    ),
  };
}

export function knowledgeEntityId(kind: WorkspaceKnowledgeEntityKind, key: string): string {
  return stableId(kind, key);
}
