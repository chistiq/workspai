import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WisDigestReference } from '@workspai/shared/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createNodeGraphProductHostPorts } from '../../src/adapters/node/index.js';
import {
  GRAPH_STANDARD_REPO_BUILD_POLICY,
  buildContentStateManifest,
  buildIncrementalRepoGraph,
  buildRepoGraph,
  buildShardDependenciesFromSources,
  collectGraphSemanticDependencies,
  contentStateLeavesFromProviderInputs,
  executeGraphReferenceCompositionTask,
  type GraphRepoBuildResult,
} from '../../src/application/index.js';
import {
  CORE_GRAPH_ONTOLOGY_PROFILE,
  type GraphCanonicalGraph,
  type GraphContentStateManifest,
} from '../../src/contracts/index.js';
import type {
  GraphProductHostPorts,
  GraphWorkerTaskRequest,
  GraphWorkerTaskResult,
} from '../../src/ports/index.js';
import {
  ECMASCRIPT_IMPORTS_PROVIDER_ID,
  LANGUAGE_IMPORTS_PROVIDER_ID,
  PACKAGE_JSON_PROVIDER_ID,
  REPOSITORY_FILES_PROVIDER_ID,
  createStandardRepositoryProviders,
} from '../../src/providers/index.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/g4/repositories'
);
const scanProfileDigest = {
  algorithm: 'sha256' as const,
  value: createHash('sha256').update('g6-official-provider-scan-profile').digest('hex'),
};
const frozenNow = new Date('2026-09-10T12:00:00.000Z');
const languages = ['node', 'python', 'go', 'java', 'dotnet', 'rust', 'unsupported'] as const;
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

function officialPorts(): GraphProductHostPorts {
  const nodePorts = createNodeGraphProductHostPorts();
  return {
    ...nodePorts,
    clock: { now: () => frozenNow },
    workers: {
      async execute<TInput, TOutput>(
        request: GraphWorkerTaskRequest<TInput>
      ): Promise<GraphWorkerTaskResult<TOutput>> {
        return {
          status: 'complete',
          output: executeGraphReferenceCompositionTask(request.input as never) as TOutput,
          diagnostics: [],
          metrics: { durationMs: 0, inputBytes: 0, outputBytes: 0 },
        };
      },
    },
  };
}

async function inventoryInputs(root: string, ports: GraphProductHostPorts) {
  const inventory = await ports.fileSource.inventory({
    root,
    maxFiles: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxFiles,
    maxTotalBytes: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxTotalBytes,
    maxFileBytes: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxFileBytes,
    maxDepth: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxDepth,
    maxDirectoryEntries: GRAPH_STANDARD_REPO_BUILD_POLICY.limits.maxDirectoryEntries,
    excludedDirectories: GRAPH_STANDARD_REPO_BUILD_POLICY.excludedDirectories,
    sensitiveFiles: GRAPH_STANDARD_REPO_BUILD_POLICY.sensitiveFiles,
  });
  if (inventory.status !== 'complete') {
    throw new Error(`inventory ${inventory.status}: ${JSON.stringify(inventory.diagnostics)}`);
  }
  return inventory.inputs;
}

interface OfficialFullBuild {
  readonly result: GraphRepoBuildResult & { readonly graph: GraphCanonicalGraph };
  readonly providers: ReturnType<typeof createStandardRepositoryProviders>;
}

async function officialFullBuild(
  root: string,
  language: string,
  ports: GraphProductHostPorts
): Promise<OfficialFullBuild> {
  const providers = createStandardRepositoryProviders();
  const result = await buildRepoGraph({
    root,
    scope: { kind: 'project', projectIds: [`project:fixture-${language}`] },
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    providers,
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports,
  });
  if (!result.graph) {
    throw new Error(JSON.stringify(result.diagnostics, null, 2));
  }
  return { result: { ...result, graph: result.graph }, providers };
}

async function stampedBaseManifest(
  root: string,
  language: string,
  ports: GraphProductHostPorts,
  full: OfficialFullBuild
) {
  const inputs = await inventoryInputs(root, ports);
  const stamps = await collectGraphSemanticDependencies({
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    compositionPolicy: GRAPH_STANDARD_REPO_BUILD_POLICY.composition,
    redactionProfile: GRAPH_STANDARD_REPO_BUILD_POLICY.redactionProfile,
    providerManifests: full.providers.map((provider) => provider.manifest),
    digest: ports.digest,
  });
  return buildContentStateManifest({
    scope: { kind: 'project', projectIds: [`project:fixture-${language}`] },
    generatedAt: frozenNow.toISOString(),
    scanProfileDigest,
    leaves: contentStateLeavesFromProviderInputs(inputs, scanProfileDigest),
    shardDependencies: buildShardDependenciesFromSources(
      full.result.compositionSources ?? [],
      stamps
    ),
  });
}

async function officialIncremental(
  root: string,
  language: string,
  ports: GraphProductHostPorts,
  full: OfficialFullBuild,
  referenceDigest: WisDigestReference,
  baseManifest: GraphContentStateManifest
) {
  return buildIncrementalRepoGraph({
    root,
    scope: { kind: 'project', projectIds: [`project:fixture-${language}`] },
    ontology: CORE_GRAPH_ONTOLOGY_PROFILE,
    providers: createStandardRepositoryProviders(),
    policy: GRAPH_STANDARD_REPO_BUILD_POLICY,
    ports,
    baseManifest,
    baseGeneration: 'generation:official-base',
    targetGeneration: 'generation:official-target',
    baseSources: full.result.compositionSources ?? [],
    providersToRecompute: [],
    scanProfileDigest,
    referenceGenerationDigest: referenceDigest,
    baseGraph: full.result.graph,
  });
}

describe('official provider incremental/full equivalence', () => {
  for (const language of languages) {
    it(`matches a full rebuild for the ${language} G4 fixture with official providers`, async () => {
      const root = path.join(fixtureRoot, language);
      const ports = officialPorts();
      const full = await officialFullBuild(root, language, ports);
      const baseManifest = await stampedBaseManifest(root, language, ports, full);
      const incremental = await officialIncremental(
        root,
        language,
        ports,
        full,
        full.result.graph.generation.reference.contentDigest,
        baseManifest
      );

      expect(incremental.equivalence).toBe('pass');
      expect(incremental.graph?.generation.reference.contentDigest).toEqual(
        full.result.graph.generation.reference.contentDigest
      );
      expect(incremental.plan.shardReuse.reused.length).toBeGreaterThan(0);
      expect(incremental.providers.some((entry) => entry.collection === 'not-run')).toBe(true);
      expect(
        incremental.targetManifest.nodes
          .filter((node) => node.kind === 'file')
          .every((node) => !node.locator.includes('\\') && !path.isAbsolute(node.locator))
      ).toBe(true);
      expect(JSON.stringify(incremental.graph)).not.toContain(fixtureRoot);
      expect(JSON.stringify(incremental.targetManifest)).not.toContain(fixtureRoot);
    });
  }

  it('matches a full rebuild after a single-file edit of the node fixture', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-official-node-'));
    temporary.push(root);
    await fs.cp(path.join(fixtureRoot, 'node'), root, { recursive: true });
    const ports = officialPorts();
    const base = await officialFullBuild(root, 'node', ports);
    const baseManifest = await stampedBaseManifest(root, 'node', ports, base);
    const unchanged = await officialIncremental(
      root,
      'node',
      ports,
      base,
      base.result.graph.generation.reference.contentDigest,
      baseManifest
    );
    expect(unchanged.equivalence).toBe('pass');

    await fs.writeFile(
      path.join(root, 'src/health.ts'),
      "export const health = (): string => 'edited';\n",
      'utf8'
    );
    const rebuilt = await officialFullBuild(root, 'node', ports);
    const incremental = await officialIncremental(
      root,
      'node',
      ports,
      base,
      rebuilt.result.graph.generation.reference.contentDigest,
      baseManifest
    );

    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.result.graph.generation.reference.contentDigest
    );
    expect(
      incremental.plan.delta.changedInputs.some((change) => change.locator === 'src/health.ts')
    ).toBe(true);
    expect(incremental.plan.shardReuse.rejected.length).toBeGreaterThan(0);
    expect(incremental.plan.shardReuse.reused.length).toBeGreaterThan(0);
    expect(incremental.providers.some((entry) => entry.collection !== 'not-run')).toBe(true);
    expect(JSON.stringify(incremental.graph)).not.toContain(root);
    expect(JSON.stringify(incremental.targetManifest)).not.toContain(root);
  });

  it('matches a full rebuild after adding a TypeScript file to the node fixture', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-official-add-'));
    temporary.push(root);
    await fs.cp(path.join(fixtureRoot, 'node'), root, { recursive: true });
    const ports = officialPorts();
    const base = await officialFullBuild(root, 'node', ports);
    const baseManifest = await stampedBaseManifest(root, 'node', ports, base);

    await fs.writeFile(path.join(root, 'src/extra.ts'), 'export const extra = 2;\n', 'utf8');
    const rebuilt = await officialFullBuild(root, 'node', ports);
    const incremental = await officialIncremental(
      root,
      'node',
      ports,
      base,
      rebuilt.result.graph.generation.reference.contentDigest,
      baseManifest
    );

    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.result.graph.generation.reference.contentDigest
    );
    expect(
      incremental.plan.delta.changedInputs.some(
        (change) => change.kind === 'added' && change.locator === 'src/extra.ts'
      )
    ).toBe(true);
    expect(
      incremental.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)
        ?.collection
    ).toBe('not-run');
    expect(
      incremental.providers.find((entry) => entry.provider.id === REPOSITORY_FILES_PROVIDER_ID)
        ?.collection
    ).not.toBe('not-run');
    expect(
      incremental.providers.find((entry) => entry.provider.id === ECMASCRIPT_IMPORTS_PROVIDER_ID)
        ?.collection
    ).not.toBe('not-run');
    expect(
      incremental.targetManifest.nodes.some(
        (node) => node.kind === 'file' && node.locator === 'src/extra.ts'
      )
    ).toBe(true);
    expect(JSON.stringify(incremental.graph)).not.toContain(root);
  });

  it('matches a full rebuild after deleting a TypeScript file from the node fixture', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-official-delete-'));
    temporary.push(root);
    await fs.cp(path.join(fixtureRoot, 'node'), root, { recursive: true });
    const ports = officialPorts();
    const base = await officialFullBuild(root, 'node', ports);
    const baseManifest = await stampedBaseManifest(root, 'node', ports, base);

    await fs.unlink(path.join(root, 'src/health.ts'));
    const rebuilt = await officialFullBuild(root, 'node', ports);
    const incremental = await officialIncremental(
      root,
      'node',
      ports,
      base,
      rebuilt.result.graph.generation.reference.contentDigest,
      baseManifest
    );

    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.result.graph.generation.reference.contentDigest
    );
    expect(
      incremental.plan.delta.changedInputs.some(
        (change) => change.kind === 'deleted' && change.locator === 'src/health.ts'
      )
    ).toBe(true);
    expect(
      incremental.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)
        ?.collection
    ).toBe('not-run');
    expect(
      incremental.targetManifest.nodes.some(
        (node) => node.kind === 'file' && node.locator === 'src/health.ts'
      )
    ).toBe(false);
    expect(JSON.stringify(incremental.graph)).not.toContain(root);
  });

  it('matches a full rebuild after renaming a TypeScript file in the node fixture', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-graph-official-rename-'));
    temporary.push(root);
    await fs.cp(path.join(fixtureRoot, 'node'), root, { recursive: true });
    const ports = officialPorts();
    const base = await officialFullBuild(root, 'node', ports);
    const baseManifest = await stampedBaseManifest(root, 'node', ports, base);

    await fs.rename(path.join(root, 'src/health.ts'), path.join(root, 'src/well.ts'));
    const rebuilt = await officialFullBuild(root, 'node', ports);
    const incremental = await officialIncremental(
      root,
      'node',
      ports,
      base,
      rebuilt.result.graph.generation.reference.contentDigest,
      baseManifest
    );

    expect(incremental.equivalence).toBe('pass');
    expect(incremental.graph?.generation.reference.contentDigest).toEqual(
      rebuilt.result.graph.generation.reference.contentDigest
    );
    expect(
      incremental.plan.delta.changedInputs.some(
        (change) =>
          (change.kind === 'rename-candidate' && change.locator === 'src/well.ts') ||
          (change.kind === 'added' && change.locator === 'src/well.ts')
      )
    ).toBe(true);
    expect(
      incremental.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)
        ?.collection
    ).toBe('not-run');
    expect(
      incremental.targetManifest.nodes.some(
        (node) => node.kind === 'file' && node.locator === 'src/well.ts'
      )
    ).toBe(true);
    expect(
      incremental.targetManifest.nodes.some(
        (node) => node.kind === 'file' && node.locator === 'src/health.ts'
      )
    ).toBe(false);
    expect(JSON.stringify(incremental.graph)).not.toContain(root);
  });
});

const crossLanguageMutations = [
  {
    language: 'python',
    existing: 'app.py',
    extra: 'extra.py',
    extraBody: 'import json\n',
    editedBody:
      "import os\nimport json\nfrom service.health import status\n\n@app.get('/health')\ndef health():\n    return status(os.name)\n",
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'go',
    existing: 'main.go',
    extra: 'extra.go',
    extraBody: 'package extra\n\nimport "fmt"\n',
    editedBody:
      'package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n\nfunc routes() {\n    router.GET("/health", health)\n}\n\nfunc health(writer http.ResponseWriter, _ *http.Request) {\n    writer.WriteHeader(http.StatusOK)\n    fmt.Fprint(writer, "ok")\n}\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'java',
    existing: 'HealthController.java',
    extra: 'Extra.java',
    extraBody: 'import java.util.List;\n\nclass Extra {}\n',
    editedBody:
      'import java.time.Instant;\nimport java.util.List;\n\nclass HealthController {\n    @GetMapping("/health")\n    String health() {\n        return Instant.now().toString();\n    }\n}\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'dotnet',
    existing: 'Program.cs',
    extra: 'Extra.cs',
    extraBody: 'using System;\n\nclass Extra {}\n',
    editedBody:
      'using System.Text.Json;\nusing System;\n\napp.MapGet("/health", () => JsonSerializer.Serialize(new { status = "edited" }));\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'rust',
    existing: 'main.rs',
    extra: 'extra.rs',
    extraBody: 'use std::fs;\n\nfn extra() {}\n',
    editedBody:
      'use std::collections::HashMap;\nuse std::fs;\n\nfn main() {\n    let values: HashMap<String, String> = HashMap::new();\n    println!("{}", values.len());\n}\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'c-cpp',
    existing: 'main.cc',
    extra: 'extra.cc',
    extraBody: '#include <string>\n',
    editedBody: '#include <vector>\n#include <string>\nint main() { return 0; }\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'objective-c-matlab',
    existing: 'main.m',
    extra: 'extra.m',
    extraBody: '#import <CoreFoundation/CoreFoundation.h>\n',
    editedBody: '#import <Foundation/Foundation.h>\nimport workspai.graph\nimport workspai.extra\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'php',
    existing: 'index.php',
    extra: 'extra.php',
    extraBody: '<?php\nuse Workspai\\Graph\\Extra;\n',
    editedBody:
      "<?php\nuse Workspai\\Graph\\Health;\nuse Workspai\\Graph\\Extra;\nrequire_once 'bootstrap.php';\n",
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'ruby',
    existing: 'app.rb',
    extra: 'extra.rb',
    extraBody: "require 'set'\n",
    editedBody: "require 'json'\nrequire 'set'\nrequire_relative 'health'\n",
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'swift',
    existing: 'main.swift',
    extra: 'extra.swift',
    extraBody: 'import Dispatch\n',
    editedBody: 'import Foundation\nimport Dispatch\n@testable import WorkspaiGraph\n',
    importProvider: LANGUAGE_IMPORTS_PROVIDER_ID,
  },
  {
    language: 'unsupported',
    existing: 'app.dart',
    extra: 'extra.dart',
    extraBody: "import 'package:workspai/extra.dart';\n",
    editedBody: "import 'package:workspai/graph.dart';\nimport 'package:workspai/extra.dart';\n",
    importProvider: undefined,
  },
] as const;

describe('official provider cross-language incremental mutations', () => {
  for (const sample of crossLanguageMutations) {
    it(`matches a full rebuild after adding a file to the ${sample.language} fixture`, async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), `workspai-graph-official-add-${sample.language}-`)
      );
      temporary.push(root);
      await fs.cp(path.join(fixtureRoot, sample.language), root, { recursive: true });
      const ports = officialPorts();
      const base = await officialFullBuild(root, sample.language, ports);
      const baseManifest = await stampedBaseManifest(root, sample.language, ports, base);

      await fs.writeFile(path.join(root, sample.extra), sample.extraBody, 'utf8');
      const rebuilt = await officialFullBuild(root, sample.language, ports);
      const incremental = await officialIncremental(
        root,
        sample.language,
        ports,
        base,
        rebuilt.result.graph.generation.reference.contentDigest,
        baseManifest
      );

      expect(incremental.equivalence).toBe('pass');
      expect(incremental.graph?.generation.reference.contentDigest).toEqual(
        rebuilt.result.graph.generation.reference.contentDigest
      );
      expect(
        incremental.plan.delta.changedInputs.some(
          (change) => change.kind === 'added' && change.locator === sample.extra
        )
      ).toBe(true);
      expect(
        incremental.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)
          ?.collection
      ).toBe('not-run');
      expect(
        incremental.providers.find((entry) => entry.provider.id === REPOSITORY_FILES_PROVIDER_ID)
          ?.collection
      ).not.toBe('not-run');
      if (sample.importProvider) {
        expect(
          incremental.providers.find((entry) => entry.provider.id === sample.importProvider)
            ?.collection
        ).not.toBe('not-run');
      } else {
        expect(
          incremental.providers.find((entry) => entry.provider.id === LANGUAGE_IMPORTS_PROVIDER_ID)
            ?.collection
        ).toBe('not-run');
      }
      expect(
        incremental.targetManifest.nodes.some(
          (node) => node.kind === 'file' && node.locator === sample.extra
        )
      ).toBe(true);
      expect(JSON.stringify(incremental.graph)).not.toContain(root);
    });

    it(`matches a full rebuild after editing a file in the ${sample.language} fixture`, async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), `workspai-graph-official-edit-${sample.language}-`)
      );
      temporary.push(root);
      await fs.cp(path.join(fixtureRoot, sample.language), root, { recursive: true });
      const ports = officialPorts();
      const base = await officialFullBuild(root, sample.language, ports);
      const baseManifest = await stampedBaseManifest(root, sample.language, ports, base);

      await fs.writeFile(path.join(root, sample.existing), sample.editedBody, 'utf8');
      const rebuilt = await officialFullBuild(root, sample.language, ports);
      const incremental = await officialIncremental(
        root,
        sample.language,
        ports,
        base,
        rebuilt.result.graph.generation.reference.contentDigest,
        baseManifest
      );

      expect(incremental.equivalence).toBe('pass');
      expect(incremental.graph?.generation.reference.contentDigest).toEqual(
        rebuilt.result.graph.generation.reference.contentDigest
      );
      expect(
        incremental.plan.delta.changedInputs.some(
          (change) => change.kind === 'edited' && change.locator === sample.existing
        )
      ).toBe(true);
      expect(
        incremental.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)
          ?.collection
      ).toBe('not-run');
      expect(JSON.stringify(incremental.graph)).not.toContain(root);
    });

    it(`matches a full rebuild after deleting a file from the ${sample.language} fixture`, async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), `workspai-graph-official-delete-${sample.language}-`)
      );
      temporary.push(root);
      await fs.cp(path.join(fixtureRoot, sample.language), root, { recursive: true });
      await fs.writeFile(path.join(root, sample.extra), sample.extraBody, 'utf8');
      const ports = officialPorts();
      const base = await officialFullBuild(root, sample.language, ports);
      const baseManifest = await stampedBaseManifest(root, sample.language, ports, base);

      await fs.unlink(path.join(root, sample.existing));
      const rebuilt = await officialFullBuild(root, sample.language, ports);
      const incremental = await officialIncremental(
        root,
        sample.language,
        ports,
        base,
        rebuilt.result.graph.generation.reference.contentDigest,
        baseManifest
      );

      expect(incremental.equivalence).toBe('pass');
      expect(incremental.graph?.generation.reference.contentDigest).toEqual(
        rebuilt.result.graph.generation.reference.contentDigest
      );
      expect(
        incremental.plan.delta.changedInputs.some(
          (change) => change.kind === 'deleted' && change.locator === sample.existing
        )
      ).toBe(true);
      expect(
        incremental.providers.find((entry) => entry.provider.id === PACKAGE_JSON_PROVIDER_ID)
          ?.collection
      ).toBe('not-run');
      expect(
        incremental.targetManifest.nodes.some(
          (node) => node.kind === 'file' && node.locator === sample.existing
        )
      ).toBe(false);
      expect(JSON.stringify(incremental.graph)).not.toContain(root);
    });
  }
});
