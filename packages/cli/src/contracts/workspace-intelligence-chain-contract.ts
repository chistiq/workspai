import {
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './workspace-intelligence-runtime-registry.js';

export const WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION =
  'workspai-workspace-intelligence-chain-v1' as const;
export const WORKSPACE_INTELLIGENCE_CHAIN_CONTRACT_PATH =
  'contracts/workspace-intelligence-chain.v1.json' as const;

export type WorkspaceIntelligenceChainStep = {
  id: string;
  ordinal: number;
  phase: 'understand' | 'change' | 'evidence' | 'gate' | 'ground' | 'distribute' | 'explain';
  label: string;
  command: string[];
  consumerArgs?: Record<string, string[]>;
  consumes: string[];
  inputRefs: string[];
  consumesArtifacts: string[];
  produces: string[];
  dependsOn: string[];
  exitPolicy: 'stop-on-error' | 'continue-on-structured-verdict';
  purpose: string;
};

export type WorkspaceIntelligenceChainContract = {
  schemaVersion: typeof WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION;
  name: 'Workspace Intelligence Chain';
  contractPath: typeof WORKSPACE_INTELLIGENCE_CHAIN_CONTRACT_PATH;
  invariant: string;
  invariants: string[];
  semantics: {
    workspace: string;
    repository: string;
    project: string;
    evidence: string;
    artifact: string;
    gate: string;
  };
  workspaceLifecycle: {
    ingestionRoutes: Array<{
      id: 'create' | 'adopt' | 'import';
      label: string;
      commands: string[];
      result: string;
    }>;
    durableState: Array<{
      id: string;
      paths: string[];
      purpose: string;
    }>;
    rule: string;
  };
  runtimeRegistry: {
    authority: 'contracts/workspace-intelligence-runtime-registry.ts';
    artifacts: Array<{
      id: string;
      path: string;
      schemaVersion: string | null;
      schemaContract: string | null;
    }>;
  };
  executionEnvelope: {
    rule: string;
    operations: Array<{
      id: 'sync' | 'baseline';
      executionPoint: 'before:model' | 'after:model-before:diff';
      artifacts: string[];
      failurePolicy: 'stop-and-report';
      purpose: string;
    }>;
    report: {
      artifact: string;
      schemaVersion: string;
      invariant: string;
    };
  };
  boundaries: {
    inputs: Array<{
      id: string;
      label: string;
      sources: string[];
      entersAt: string;
    }>;
    outputs: Array<{
      id: string;
      label: string;
      artifacts: string[];
      producedBy: string[];
      inventory: 'complete-for-chain' | 'canonical-minimum';
      inventoryContract?: string;
    }>;
    consumers: Array<{
      id: string;
      label: string;
      channels: string[];
    }>;
  };
  deliveryChannels: Array<{
    id: 'artifacts' | 'json-stdout' | 'human-cli' | 'exit-codes' | 'watch-events' | 'mcp';
    carries: string[];
    authority: 'canonical' | 'projection';
  }>;
  feedback: {
    from: string[];
    signals: string[];
    reentersThrough: string[];
    rule: string;
  };
  auxiliaryCapabilities: Array<{
    id: 'graph' | 'evaluation' | 'watch' | 'mcp';
    commands: string[];
    reads: string[];
    produces?: string[];
    role: string;
    chainStep: false;
  }>;
  presentations: {
    simple: {
      layers: Array<'inputs' | 'intelligence' | 'outputs' | 'consumers'>;
      nodes: Array<{
        id: string;
        kind: 'inputs' | 'intelligence' | 'outputs' | 'consumers';
        label: string;
        summary: string;
        contractRefs: string[];
      }>;
      rule: string;
    };
    standard: {
      phases: WorkspaceIntelligenceChainStep['phase'][];
      nodes: Array<{
        id: WorkspaceIntelligenceChainStep['phase'];
        label: string;
        question: string;
        stepRefs: string[];
      }>;
      rule: string;
    };
    advanced: {
      steps: string[];
      requiredFields: Array<
        | 'command'
        | 'inputRefs'
        | 'consumesArtifacts'
        | 'produces'
        | 'dependsOn'
        | 'exitPolicy'
        | 'purpose'
      >;
      rule: string;
    };
  };
  steps: WorkspaceIntelligenceChainStep[];
  diagram: {
    direction: 'TB';
    nodes: Array<{ id: string; label: string; phase: WorkspaceIntelligenceChainStep['phase'] }>;
    edges: Array<{ from: string; to: string; meaning: 'required before' }>;
  };
  consumers: {
    agents: {
      canonicalReadOrder: string[];
      entrypoints: string[];
      rule: string;
    };
    ideAndCi: {
      requiredArtifacts: string[];
      rule: string;
    };
    docsAndDiagrams: {
      rule: string;
    };
  };
};

export function buildWorkspaceIntelligenceChainContract(): WorkspaceIntelligenceChainContract {
  const artifacts = WORKSPACE_INTELLIGENCE_ARTIFACTS;
  const runtime = WORKSPACE_INTELLIGENCE_RUNTIME_STEPS;
  const steps: WorkspaceIntelligenceChainStep[] = [
    {
      id: 'model',
      ordinal: 1,
      phase: 'understand',
      label: 'Model',
      command: [...runtime.model.command],
      consumes: ['workspace markers', 'project metadata', 'registry', 'contract', 'policies'],
      inputRefs: [
        'projects-repositories',
        'runtime-dependencies',
        'workspace-rules',
        'existing-evidence',
      ],
      consumesArtifacts: [],
      produces: [...runtime.model.produces],
      dependsOn: [],
      exitPolicy: 'stop-on-error',
      purpose:
        'Build the canonical current model and its structurally bound, derived Knowledge Graph.',
    },
    {
      id: 'diff',
      ordinal: 2,
      phase: 'change',
      label: 'Diff',
      command: [...runtime.diff.command],
      consumes: [artifacts.model, artifacts.snapshot],
      inputRefs: ['changes', 'model-baseline'],
      consumesArtifacts: [artifacts.model, artifacts.snapshot],
      produces: [...runtime.diff.produces],
      dependsOn: ['model'],
      exitPolicy: 'stop-on-error',
      purpose: 'Describe structural change against the selected baseline.',
    },
    {
      id: 'impact',
      ordinal: 3,
      phase: 'change',
      label: 'Impact',
      command: [...runtime.impact.command],
      consumes: [artifacts.model, artifacts.diff],
      inputRefs: [],
      consumesArtifacts: [artifacts.model, artifacts.diff],
      produces: [...runtime.impact.produces],
      dependsOn: ['diff'],
      exitPolicy: 'stop-on-error',
      purpose: 'Calculate transitive blast radius over the workspace graph.',
    },
    {
      id: 'doctor-evidence',
      ordinal: 4,
      phase: 'evidence',
      label: 'Doctor Evidence',
      command: [...runtime['doctor-evidence'].command],
      consumes: ['workspace runtime and project health signals'],
      inputRefs: ['projects-repositories', 'runtime-dependencies', 'existing-evidence'],
      consumesArtifacts: [],
      produces: [...runtime['doctor-evidence'].produces],
      dependsOn: ['impact'],
      exitPolicy: 'continue-on-structured-verdict',
      purpose: 'Refresh health evidence after the impact artifact exists.',
    },
    {
      id: 'contract-evidence',
      ordinal: 5,
      phase: 'evidence',
      label: 'Contract Evidence',
      command: [...runtime['contract-evidence'].command],
      consumes: [WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract],
      inputRefs: ['workspace-rules'],
      consumesArtifacts: [],
      produces: [...runtime['contract-evidence'].produces],
      dependsOn: ['impact'],
      exitPolicy: 'continue-on-structured-verdict',
      purpose: 'Refresh structural contract evidence without hiding failed verdicts.',
    },
    {
      id: 'analyze-evidence',
      ordinal: 6,
      phase: 'evidence',
      label: 'Analyze Evidence',
      command: [...runtime['analyze-evidence'].command],
      consumes: [artifacts.model, 'workspace runtime and dependency signals'],
      inputRefs: ['projects-repositories', 'runtime-dependencies', 'workspace-rules'],
      consumesArtifacts: [artifacts.model],
      produces: [...runtime['analyze-evidence'].produces],
      dependsOn: ['impact'],
      exitPolicy: 'continue-on-structured-verdict',
      purpose: 'Refresh analysis evidence required by the release-readiness gate.',
    },
    {
      id: 'readiness-evidence',
      ordinal: 7,
      phase: 'evidence',
      label: 'Readiness Evidence',
      command: [...runtime['readiness-evidence'].command],
      consumes: ['doctor, analysis, runtime, and release signals'],
      inputRefs: ['runtime-dependencies', 'existing-evidence'],
      consumesArtifacts: [artifacts.doctor, artifacts.contractVerify, artifacts.analyze],
      produces: [...runtime['readiness-evidence'].produces],
      dependsOn: ['doctor-evidence', 'contract-evidence', 'analyze-evidence'],
      exitPolicy: 'continue-on-structured-verdict',
      purpose: 'Refresh release-readiness evidence before the definitive gate.',
    },
    {
      id: 'verify',
      ordinal: 8,
      phase: 'gate',
      label: 'Verify',
      command: [...runtime.verify.command],
      consumes: [artifacts.impact, artifacts.doctor, artifacts.contractVerify, artifacts.readiness],
      inputRefs: [],
      consumesArtifacts: [
        artifacts.impact,
        artifacts.doctor,
        artifacts.contractVerify,
        artifacts.readiness,
      ],
      produces: [...runtime.verify.produces],
      dependsOn: [
        'impact',
        'doctor-evidence',
        'contract-evidence',
        'analyze-evidence',
        'readiness-evidence',
      ],
      exitPolicy: 'continue-on-structured-verdict',
      purpose: 'Emit the definitive evidence-backed workspace gate.',
    },
    {
      id: 'context',
      ordinal: 9,
      phase: 'ground',
      label: 'Agent Context',
      command: [...runtime.context.command],
      consumes: [artifacts.model, artifacts.impact, artifacts.verify],
      inputRefs: [],
      consumesArtifacts: [artifacts.model, artifacts.impact, artifacts.verify],
      produces: [...runtime.context.produces],
      dependsOn: ['verify'],
      exitPolicy: 'stop-on-error',
      purpose: 'Build compact agent context from the same verified evidence.',
    },
    {
      id: 'agent-sync',
      ordinal: 10,
      phase: 'distribute',
      label: 'Agent Grounding',
      command: [...runtime['agent-sync'].command],
      consumerArgs: { vscode: ['--target', 'vscode'] },
      consumes: [artifacts.agentContext],
      inputRefs: [],
      consumesArtifacts: [artifacts.agentContext],
      produces: [...runtime['agent-sync'].produces],
      dependsOn: ['context'],
      exitPolicy: 'stop-on-error',
      purpose: 'Distribute one context into portable agent and IDE surfaces.',
    },
    {
      id: 'explain',
      ordinal: 11,
      phase: 'explain',
      label: 'Explain',
      command: [...runtime.explain.command],
      consumes: [artifacts.verify, artifacts.impact],
      inputRefs: [],
      consumesArtifacts: [artifacts.verify, artifacts.impact],
      produces: [...runtime.explain.produces],
      dependsOn: ['verify'],
      exitPolicy: 'continue-on-structured-verdict',
      purpose: 'Translate evidence and blockers into a human and agent-readable narrative.',
    },
  ];

  return {
    schemaVersion: WORKSPACE_INTELLIGENCE_CHAIN_SCHEMA_VERSION,
    name: 'Workspace Intelligence Chain',
    contractPath: WORKSPACE_INTELLIGENCE_CHAIN_CONTRACT_PATH,
    invariant:
      'Every consumer must preserve step identity, dependencies, artifact flow, and verdict semantics; presentation may change, chain meaning may not.',
    invariants: [
      'Missing or unreadable input is unknown or unavailable; it must not be presented as verified absence.',
      'Freshness and provenance travel with evidence and must not be discarded by projections.',
      'The current graph is an evidence-backed workspace knowledge graph with bounded source intelligence, not a complete cross-language symbol or call graph.',
      'Simple and standard presentations summarize the contract; their contractRefs must preserve complete traceability.',
      'Conditional provider outputs must be resolved through their dedicated inventory contract.',
      'Auxiliary capabilities expose or refresh intelligence but are not mandatory execution-chain steps.',
      'Canonical step commands are stage-pure: they must not implicitly execute a downstream chain step or regenerate an upstream artifact.',
      'Canonical JSON artifacts must satisfy their registered schema both when produced and when consumed across CLI, MCP, IDE, and CI trust boundaries.',
      'Schema validity is necessary but not sufficient: hashes, embedded models, summaries, counts, graph statistics, and artifact references must remain semantically coherent.',
      'Persisted impact evidence must be rejected as stale when the current workspace model or Git observation no longer matches its embedded diff.',
      'Canonical artifact replacement must be atomic and workspace-contained; an interrupted or denied write must preserve the last valid artifact.',
      'Concurrent history updates must be serialized without silently dropping entries, and invalid history must never be overwritten as if it were absent.',
      'The canonical global registry is ~/.workspai/workspaces.json; ~/.rapidkit/workspaces.json is a non-authoritative compatibility mirror for legacy consumers and must not diverge after a CLI registry mutation.',
    ],
    semantics: {
      workspace:
        'The governed operating boundary that relates one or more projects and repositories to shared metadata, policies, contracts, evidence, and consumers.',
      repository:
        'A source-control boundary that may contain one or more projects and may live inside or outside the workspace root.',
      project:
        'A discoverable build or runtime unit with its own path, metadata or observable manifests, command capabilities, and evidence.',
      evidence:
        'A sourced observation or generated verification result with provenance and freshness; evidence may be consumed by a later run.',
      artifact:
        'A durable generated file that another command or consumer can read without parsing terminal prose.',
      gate: 'A structured verdict with reasons and exit semantics derived from current evidence.',
    },
    workspaceLifecycle: {
      ingestionRoutes: [
        {
          id: 'create',
          label: 'Create',
          commands: ['create workspace', 'create project'],
          result: 'Create a workspace or supported project and write canonical Workspai metadata.',
        },
        {
          id: 'adopt',
          label: 'Adopt',
          commands: ['adopt'],
          result: 'Register an existing project in place without requiring source relocation.',
        },
        {
          id: 'import',
          label: 'Import',
          commands: ['import', 'workspace import'],
          result: 'Attach an existing project or repository path to the workspace inventory.',
        },
      ],
      durableState: [
        {
          id: 'workspace-identity',
          paths: ['.workspai-workspace', '.workspai/workspace.json'],
          purpose: 'Identify the workspace boundary, profile, and canonical root.',
        },
        {
          id: 'project-inventory',
          paths: [
            '.workspai/project.json',
            '.workspai/context.json',
            '.workspai/adopt.json',
            '~/.workspai/workspaces.json',
            '~/.rapidkit/workspaces.json (legacy compatibility mirror)',
          ],
          purpose:
            'Record native, adopted, imported, and globally registered project locations while preserving a non-authoritative mirror for legacy extension discovery.',
        },
        {
          id: 'governance',
          paths: ['.workspai/policies.yml', WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract],
          purpose: 'Define workspace policy and explicit structural relationships.',
        },
        {
          id: 'graph-overrides',
          paths: ['.workspai/workspace-graph.overrides.json'],
          purpose: 'Provide explicit dependency edges that override inferred relationships.',
        },
      ],
      rule: 'Create, adopt, and import are ingestion routes, not intelligence facts. Their durable state becomes observable input to Model.',
    },
    runtimeRegistry: {
      authority: 'contracts/workspace-intelligence-runtime-registry.ts',
      artifacts: Object.entries(WORKSPACE_INTELLIGENCE_ARTIFACTS).map(([id, artifactPath]) => ({
        id,
        path: artifactPath,
        schemaVersion:
          WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS[
            id as keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS
          ],
        schemaContract:
          WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS[
            id as keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS
          ],
      })),
    },
    executionEnvelope: {
      rule: 'Sync and baseline resolution are deterministic execution prerequisites, not canonical intelligence stages; every run reports them separately and preserves the exact canonical stage sequence.',
      operations: [
        {
          id: 'sync',
          executionPoint: 'before:model',
          artifacts: [
            WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract,
            WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceRegistry,
          ],
          failurePolicy: 'stop-and-report',
          purpose: 'Reconcile portable workspace inventory and contract inputs before modeling.',
        },
        {
          id: 'baseline',
          executionPoint: 'after:model-before:diff',
          artifacts: [artifacts.snapshot],
          failurePolicy: 'stop-and-report',
          purpose:
            'Create an initial structural baseline when absent or reuse the existing baseline before Diff.',
        },
      ],
      report: {
        artifact: artifacts.intelligenceRun,
        schemaVersion: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.intelligenceRun,
        invariant:
          'The report must preserve exact preflight and stage order, registry-owned artifacts, failure propagation, and aggregate status/exit semantics.',
      },
    },
    boundaries: {
      inputs: [
        {
          id: 'projects-repositories',
          label: 'Projects and repositories',
          sources: ['projects', 'repositories', 'services', 'modules', 'imported paths'],
          entersAt: 'model',
        },
        {
          id: 'runtime-dependencies',
          label: 'Runtime and dependencies',
          sources: [
            'runtime manifests',
            'lockfiles',
            'scripts',
            'framework markers',
            'package dependencies',
            'bounded multi-language source observations for supported file extensions',
          ],
          entersAt: 'model',
        },
        {
          id: 'workspace-rules',
          label: 'Workspace rules',
          sources: [
            'workspace markers',
            'registry',
            'project metadata',
            'contracts',
            'policies',
            'ownership',
            'graph overrides',
          ],
          entersAt: 'model',
        },
        {
          id: 'changes',
          label: 'Changes',
          sources: ['repository state', 'git state', 'model baseline', 'workspace diff'],
          entersAt: 'diff',
        },
        {
          id: 'model-baseline',
          label: 'Explicit model baseline',
          sources: [artifacts.snapshot],
          entersAt: 'diff',
        },
        {
          id: 'existing-evidence',
          label: 'Existing evidence',
          sources: [
            'doctor reports',
            'analysis reports',
            'contract verification',
            'release readiness',
            'pipeline results',
            'tests and runtime evidence',
            'previous intelligence artifacts',
          ],
          entersAt: 'doctor-evidence',
        },
      ],
      outputs: [
        {
          id: 'understanding',
          label: 'System understanding',
          artifacts: [artifacts.model, artifacts.knowledgeGraph, artifacts.diff, artifacts.impact],
          producedBy: ['model', 'diff', 'impact'],
          inventory: 'complete-for-chain',
        },
        {
          id: 'governance-evidence',
          label: 'Governance evidence',
          artifacts: [
            artifacts.doctor,
            artifacts.contractVerify,
            artifacts.analyze,
            artifacts.readiness,
            artifacts.verify,
            artifacts.history,
          ],
          producedBy: [
            'doctor-evidence',
            'contract-evidence',
            'analyze-evidence',
            'readiness-evidence',
            'verify',
          ],
          inventory: 'complete-for-chain',
        },
        {
          id: 'agent-grounding',
          label: 'Agent grounding',
          artifacts: [
            artifacts.agentContext,
            artifacts.agentIndex,
            artifacts.agentCustomizationPack,
            artifacts.skillsIndex,
            artifacts.agents,
          ],
          producedBy: ['context', 'agent-sync'],
          inventory: 'canonical-minimum',
          inventoryContract: 'contracts/agent-customization-pack.v1.json',
        },
        {
          id: 'explanations',
          label: 'Explainable decisions',
          artifacts: [artifacts.explain],
          producedBy: ['explain'],
          inventory: 'complete-for-chain',
        },
      ],
      consumers: [
        { id: 'developers', label: 'Developers', channels: ['CLI', 'reports', 'AGENTS.md'] },
        { id: 'ci', label: 'CI', channels: ['JSON artifacts', 'exit codes', 'release gates'] },
        { id: 'ides', label: 'IDEs', channels: ['synced contracts', 'extension', 'agent context'] },
        {
          id: 'ai-agents',
          label: 'AI agents',
          channels: ['INDEX.json', 'context', 'skills', 'MCP'],
        },
      ],
    },
    deliveryChannels: [
      {
        id: 'artifacts',
        carries: ['reports', 'models', 'context', 'grounding', 'skills'],
        authority: 'canonical',
      },
      {
        id: 'json-stdout',
        carries: ['structured command results'],
        authority: 'projection',
      },
      {
        id: 'human-cli',
        carries: ['summaries', 'diagnostics', 'next actions'],
        authority: 'projection',
      },
      {
        id: 'exit-codes',
        carries: ['gate and command status'],
        authority: 'projection',
      },
      {
        id: 'watch-events',
        carries: ['incremental workspace change events'],
        authority: 'projection',
      },
      {
        id: 'mcp',
        carries: ['read-mostly access to current workspace artifacts'],
        authority: 'projection',
      },
    ],
    feedback: {
      from: ['developers', 'ci', 'ides', 'ai-agents'],
      signals: [
        'source commits',
        'dependency updates',
        'policy and contract edits',
        'repairs',
        'test and runtime results',
        'agent action outcomes',
      ],
      reentersThrough: [
        'projects-repositories',
        'runtime-dependencies',
        'workspace-rules',
        'changes',
        'existing-evidence',
      ],
      rule: 'Consumer actions are not silently treated as truth. They re-enter as observable changes or evidence and must be modeled and verified again.',
    },
    auxiliaryCapabilities: [
      {
        id: 'graph',
        commands: [
          'workspace graph emit',
          'workspace graph explain',
          'workspace graph entities',
          'workspace graph evidence',
          'workspace graph path',
          'workspace graph search',
          'workspace graph benchmark',
          'workspace graph overlay',
          'workspace graph dot',
          'workspace graph mermaid',
          'workspace graph jsonld',
          'workspace graph graphml',
          'workspace graph gexf',
        ],
        reads: [artifacts.model, artifacts.knowledgeGraph],
        role: 'Query the proof-backed graph derived from the canonical workspace model.',
        chainStep: false,
      },
      {
        id: 'evaluation',
        commands: [
          'workspace eval init',
          'workspace eval record',
          'workspace eval status',
          'workspace eval report',
          'workspace eval compare',
        ],
        reads: [artifacts.evaluationLive, artifacts.evaluationLastRun],
        produces: [artifacts.evaluationLive, artifacts.evaluationLastRun],
        role: 'Measure model usage, activity, cost provenance, and verified outcomes without storing prompt or response bodies.',
        chainStep: false,
      },
      {
        id: 'watch',
        commands: ['workspace watch'],
        reads: ['workspace inputs', artifacts.model],
        role: 'Refresh the model incrementally and emit deterministic change events.',
        chainStep: false,
      },
      {
        id: 'mcp',
        commands: ['workspace mcp serve'],
        reads: ['workspace evidence artifacts'],
        role: 'Expose read-mostly workspace evidence to compatible clients.',
        chainStep: false,
      },
    ],
    presentations: {
      simple: {
        layers: ['inputs', 'intelligence', 'outputs', 'consumers'],
        nodes: [
          {
            id: 'input-layer',
            kind: 'inputs',
            label: 'Input Layer',
            summary: 'Projects · Repositories · Dependencies · Changes',
            contractRefs: [
              'projects-repositories',
              'runtime-dependencies',
              'workspace-rules',
              'changes',
              'model-baseline',
              'existing-evidence',
            ],
          },
          {
            id: 'workspace-intelligence',
            kind: 'intelligence',
            label: 'Workspace Intelligence',
            summary: 'Model · Graph · Impact · Verify',
            contractRefs: steps.map((step) => step.id),
          },
          {
            id: 'agent-grounding',
            kind: 'outputs',
            label: 'Agent Grounding',
            summary: 'AGENTS.md · Skills · Context',
            contractRefs: ['agent-grounding'],
          },
          {
            id: 'evidence-and-decisions',
            kind: 'outputs',
            label: 'Evidence Contracts',
            summary: 'Reports · Artifacts · Gates',
            contractRefs: ['understanding', 'governance-evidence', 'explanations'],
          },
          {
            id: 'shared-consumers',
            kind: 'consumers',
            label: 'Shared Consumers',
            summary: 'Developers · CI · IDEs · AI agents',
            contractRefs: ['developers', 'ci', 'ides', 'ai-agents'],
          },
        ],
        rule: 'Use concrete user-facing language for first-contact explanations. Every input, output, consumer, and chain step must remain traceable through contractRefs even when details are summarized.',
      },
      standard: {
        phases: ['understand', 'change', 'evidence', 'gate', 'ground', 'distribute', 'explain'],
        nodes: [
          {
            id: 'understand',
            label: 'Understand',
            question: 'What exists in the current workspace?',
            stepRefs: ['model'],
          },
          {
            id: 'change',
            label: 'Change',
            question: 'What changed, and what can it affect?',
            stepRefs: ['diff', 'impact'],
          },
          {
            id: 'evidence',
            label: 'Evidence',
            question: 'What health, contract, and readiness facts were observed?',
            stepRefs: [
              'doctor-evidence',
              'contract-evidence',
              'analyze-evidence',
              'readiness-evidence',
            ],
          },
          {
            id: 'gate',
            label: 'Gate',
            question: 'Is the current state acceptable and trustworthy?',
            stepRefs: ['verify'],
          },
          {
            id: 'ground',
            label: 'Ground',
            question: 'What should an agent know before acting?',
            stepRefs: ['context'],
          },
          {
            id: 'distribute',
            label: 'Distribute',
            question: 'Which durable agent and IDE surfaces receive that context?',
            stepRefs: ['agent-sync'],
          },
          {
            id: 'explain',
            label: 'Explain',
            question: 'Why did the system reach this result or verdict?',
            stepRefs: ['explain'],
          },
        ],
        rule: 'Use for architecture education and product surfaces. Every phase must appear once and in order.',
      },
      advanced: {
        steps: steps.map((step) => step.id),
        requiredFields: [
          'command',
          'inputRefs',
          'consumesArtifacts',
          'produces',
          'dependsOn',
          'exitPolicy',
          'purpose',
        ],
        rule: 'Use for implementers, adapters, IDEs, and CI. Preserve every step and its artifact and verdict semantics.',
      },
    },
    steps,
    diagram: {
      direction: 'TB',
      nodes: steps.map(({ id, label, phase }) => ({ id, label, phase })),
      edges: steps.flatMap((step) =>
        step.dependsOn.map((dependency) => ({
          from: dependency,
          to: step.id,
          meaning: 'required before' as const,
        }))
      ),
    },
    consumers: {
      agents: {
        canonicalReadOrder: [
          artifacts.agentIndex,
          artifacts.agentContext,
          artifacts.verify,
          artifacts.impact,
          artifacts.explain,
          artifacts.model,
          artifacts.knowledgeGraph,
          artifacts.agentCustomizationPack,
          artifacts.skillsIndex,
        ],
        entrypoints: [artifacts.agents, '.workspai/AGENT-GROUNDING.md'],
        rule: 'Agents must cite current artifacts, preserve verified versus inferred status, and re-run the producing step when evidence is missing or stale.',
      },
      ideAndCi: {
        requiredArtifacts: [
          artifacts.model,
          artifacts.knowledgeGraph,
          artifacts.impact,
          artifacts.verify,
        ],
        rule: 'IDEs and CI must consume structured artifacts and verdict exit semantics rather than parse human help or terminal prose.',
      },
      docsAndDiagrams: {
        rule: 'Documentation and diagrams must derive labels, ordering, and edges from this contract and must not invent implemented steps.',
      },
    },
  };
}
