import { describe, expect, it } from 'vitest';

import { buildWorkspaceIntelligenceArchitectureContract } from '../../contracts/workspace-intelligence-architecture-contract';

describe('workspace intelligence architecture contract', () => {
  it('defines the canonical inputs, architecture core, consumers, and claim boundaries', () => {
    const contract = buildWorkspaceIntelligenceArchitectureContract();

    expect(contract.schemaVersion).toBe('workspai-workspace-intelligence-architecture-v1');
    expect(contract.canonicalPositioning.tagline).toBe(
      'Open-Source Workspace Intelligence for Software Systems'
    );
    expect(contract.canonicalPositioning.mentalModel).toEqual([
      'Repositories · Projects · Dependencies · Changes',
      'Workspace Intelligence',
      'Evidence-backed outputs',
      'Developers · CI · IDEs · AI agents',
    ]);

    expect(contract.architectureCore.loop.map((stage) => stage.id)).toEqual([
      'model',
      'diff',
      'impact',
      'doctor-evidence',
      'contract-evidence',
      'analyze-evidence',
      'readiness-evidence',
      'verify',
      'context',
      'agent-sync',
      'explain',
    ]);
    expect(contract.architectureCore.modelGraphRelationship).toEqual({
      direction: 'workspace-sources -> workspace-model -> workspace-knowledge-graph',
      canonicalAuthority: {
        artifact: '.workspai/reports/workspace-model.json',
        schemaVersion: 'workspace-model.v1',
      },
      derivedRepresentation: {
        artifact: '.workspai/reports/workspace-knowledge-graph.json',
        schemaVersion: 'workspace-knowledge-graph.v1',
      },
      sourceBinding: {
        kind: 'workspace-model',
        artifact: '.workspai/reports/workspace-model.json',
        hashAlgorithm: 'sha256',
        hashSemantics: 'stable structural model projection',
      },
      inventoryRule: 'reconcile discovered, imported, adopted, and contract-declared projects',
      missingProjectRule: 'preserve a contract-declared missing project as a validation warning',
      topologyRule: 'knowledge graph project topology must match the canonical model topology',
      publication: 'one locked rollback-capable artifact transaction',
      mutationRule: 'knowledge graph enrichment never mutates the authorizing model during a run',
      staleConsumerRule: 'reject a graph whose source binding does not match the current model',
    });

    expect(contract.workspaceLifecycle.ingestionRoutes.map((route) => route.id)).toEqual([
      'create',
      'adopt',
      'import',
    ]);
    expect(contract.observedInputs.map((input) => input.id)).toEqual([
      'projects-repositories',
      'runtime-dependencies',
      'workspace-rules',
      'changes',
      'model-baseline',
      'existing-evidence',
    ]);
    expect(contract.outputFamilies.map((output) => output.id)).toEqual([
      'understanding',
      'governance-evidence',
      'agent-grounding',
      'explanations',
    ]);
    expect(contract.auxiliaryCapabilities.map((capability) => capability.id)).toEqual([
      'graph',
      'evaluation',
      'watch',
      'mcp',
    ]);
    expect(
      contract.auxiliaryCapabilities.find((capability) => capability.id === 'graph')?.commands
    ).toEqual(
      expect.arrayContaining([
        'workspace graph search',
        'workspace graph evidence',
        'workspace graph overlay',
        'workspace graph jsonld',
        'workspace graph graphml',
        'workspace graph gexf',
      ])
    );
    expect(
      contract.auxiliaryCapabilities.find((capability) => capability.id === 'evaluation')?.produces
    ).toEqual([
      '.workspai/reports/workspace-intelligence-evaluation-live.json',
      '.workspai/reports/workspace-intelligence-evaluation-last-run.json',
    ]);

    expect(contract.consumers.map((consumer) => consumer.id)).toEqual([
      'developers',
      'ci',
      'ides-and-extensions',
      'ai-agents',
      'docs-and-marketing',
    ]);

    expect(contract.claimBoundaries.allowed).toEqual(
      expect.arrayContaining([
        'One shared model of structure, context, impact, and verification.',
        'Workspai can create projects only for native kits and available official generator paths listed in the create planner contract.',
        'Any readable project can enter Workspace Intelligence through adopt/import when it can be registered.',
        'Existing projects can enter Workspace Intelligence through adopt/import when they are readable and can be registered, even when native scaffold is unavailable.',
        'Existing runtime signals in the create planner are examples for detection, not a closed allowlist of adopt/import support.',
      ])
    );
    expect(contract.claimBoundaries.forbiddenUnlessImplemented).toEqual(
      expect.arrayContaining([
        'Do not claim native scaffolding for every language or framework.',
        'Do not describe documentation as the source of truth; documentation must be described as generated from evidence.',
      ])
    );
  });

  it('keeps create planner reality sourced from the runtime surface contract', () => {
    const contract = buildWorkspaceIntelligenceArchitectureContract();

    expect(contract.createPlannerReality.nativeCreateKits).toEqual(
      expect.arrayContaining([
        'fastapi.standard',
        'fastapi.ddd',
        'nestjs.standard',
        'springboot.standard',
        'gofiber.standard',
        'gogin.standard',
        'dotnet.webapi.clean',
      ])
    );
    expect(contract.createPlannerReality.officialCreate).toEqual(
      expect.arrayContaining([
        'frontend.nextjs',
        'frontend.vite-react',
        'desktop.tauri',
        'desktop.electron',
        'extension.vscode',
        'php.laravel',
        'wordpress-site',
        'wordpress-block',
        'symfony',
        'rails',
      ])
    );
    expect(contract.createPlannerReality.existingRuntimeSignals).toEqual(
      expect.arrayContaining(['php', 'ruby', 'rust', 'elixir', 'clojure', 'scala', 'kotlin'])
    );
    expect(contract.projectEntryCapability.plainLanguageRule).toContain(
      'Any readable project can enter Workspace Intelligence'
    );
  });

  it('keeps unimplemented atlas, wiki, and package-split surfaces out of the public architecture contract', () => {
    const contract = buildWorkspaceIntelligenceArchitectureContract();
    const futureExtensionIds = contract.futureExtensions.map((extension) => extension.id);
    const forbiddenClaims = contract.claimBoundaries.forbiddenUnlessImplemented.join('\n');

    expect(contract.futureExtensions).toEqual([]);
    expect(futureExtensionIds).not.toContain('workspace-atlas');
    expect(futureExtensionIds).not.toContain('workspace-wiki');
    expect(futureExtensionIds).not.toContain('specialized-packages');
    expect(forbiddenClaims).not.toMatch(/atlas|wiki/i);
  });
});
