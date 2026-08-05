import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWorkspaceIntelligenceChainContract } from '../../contracts/workspace-intelligence-chain-contract';
import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS,
  WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS,
  WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES,
  WORKSPACE_INTELLIGENCE_RUNTIME_STEPS,
  WORKSPACE_INTELLIGENCE_STEP_IDS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../../contracts/workspace-intelligence-runtime-registry';
import { WORKSPACE_SUBCOMMANDS } from '../../utils/workspace-command-surface';
import { WORKSPACE_MODEL_REPORT_PATH, WORKSPACE_MODEL_SCHEMA_VERSION } from '../../workspace-model';
import {
  WORKSPACE_IMPACT_REPORT_PATH,
  WORKSPACE_IMPACT_SCHEMA_VERSION,
  WORKSPACE_MODEL_DIFF_REPORT_PATH,
  WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
  WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH,
  WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION,
} from '../../workspace-intelligence';
import { DOCTOR_WORKSPACE_REPORT_PATH } from '../../doctor';
import {
  WORKSPACE_CONTRACT_VERIFY_REPORT_PATH,
  WORKSPACE_CONTRACT_VERIFY_SCHEMA_VERSION,
} from '../../utils/workspace-contract';
import { RELEASE_READINESS_REPORT_PATH, RELEASE_READINESS_SCHEMA_VERSION } from '../../readiness';
import {
  WORKSPACE_VERIFY_REPORT_PATH,
  WORKSPACE_VERIFY_SCHEMA_VERSION,
} from '../../workspace-verify';
import { WORKSPACE_HISTORY_PATH, WORKSPACE_HISTORY_SCHEMA_VERSION } from '../../workspace-history';
import {
  WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH,
  WORKSPACE_INTELLIGENCE_RUN_SCHEMA_VERSION,
} from '../../workspace-intelligence-runner';
import {
  WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
  WORKSPACE_CONTEXT_SCHEMA_VERSION,
} from '../../workspace-context';
import {
  AGENT_CUSTOMIZATION_PACK_REPORT_PATH,
  AGENT_CUSTOMIZATION_PACK_SCHEMA,
  AGENT_REPORTS_INDEX_PATH,
  AGENT_REPORTS_INDEX_SCHEMA,
} from '../../workspace-agent-sync';
import {
  WORKSPACE_EXPLAIN_REPORT_PATH,
  WORKSPACE_SKILLS_INDEX_PATH,
} from '../../contracts/workspace-artifact-paths';
import { DOCTOR_WORKSPACE_EVIDENCE_SCHEMA } from '../../utils/doctor-evidence-contract';
import { WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION } from '../../contracts/workspace-skills-index-contract';
import { WORKSPACE_EXPLAIN_SCHEMA_VERSION } from '../../contracts/workspace-explain-contract';
import { WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION } from '../../contracts/workspace-knowledge-graph-contract';
import { WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH } from '../../workspace-knowledge-graph';
import {
  WORKSPACE_EVALUATION_LAST_RUN_PATH,
  WORKSPACE_EVALUATION_LIVE_PATH,
} from '../../workspace-intelligence-evaluation';
import { WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION } from '../../contracts/workspace-intelligence-evaluation-contract';
import {
  VERIFIED_GOAL_LAST_RUN_REPORT_PATH,
  VERIFIED_GOAL_STATUS_SCHEMA_VERSION,
} from '../../verified-goal';
import {
  WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH,
  WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION,
} from '../../contracts/workspace-repair-transaction-contract';

describe('workspace intelligence chain contract', () => {
  it('forbids canonical report path literals outside the runtime registry', () => {
    const sourceRoot = path.resolve(process.cwd(), 'src');
    const registryPath = path.resolve(
      sourceRoot,
      'contracts/workspace-intelligence-runtime-registry.ts'
    );
    const testSegment = `${path.sep}__tests__${path.sep}`;
    const sourceFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          absolutePath !== registryPath &&
          !absolutePath.includes(testSegment)
        ) {
          sourceFiles.push(absolutePath);
        }
      }
    };
    visit(sourceRoot);

    const reportPaths = [
      ...Object.values(WORKSPACE_INTELLIGENCE_ARTIFACTS),
      ...Object.values(WORKSPACE_SUPPLEMENTAL_ARTIFACTS),
    ].filter((artifact) => artifact.startsWith('.workspai/') || artifact.startsWith('.vscode/'));
    const violations: string[] = [];
    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(sourceFile, 'utf8');
      for (const artifact of reportPaths) {
        if (
          source.includes(`'${artifact}'`) ||
          source.includes(`"${artifact}"`) ||
          source.includes(`\`${artifact}\``)
        ) {
          violations.push(`${path.relative(sourceRoot, sourceFile)} -> ${artifact}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('forbids canonical artifact schema literals outside the runtime registry', () => {
    const sourceRoot = path.resolve(process.cwd(), 'src');
    const registryPath = path.resolve(
      sourceRoot,
      'contracts/workspace-intelligence-runtime-registry.ts'
    );
    const testSegment = `${path.sep}__tests__${path.sep}`;
    const schemaVersions = [
      ...Object.values(WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS),
      ...Object.values(WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS).map(
        (descriptor) => descriptor.schemaVersion
      ),
    ].filter((schema): schema is string => typeof schema === 'string');
    const violations: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }
        if (
          !entry.isFile() ||
          !entry.name.endsWith('.ts') ||
          absolutePath === registryPath ||
          absolutePath.includes(testSegment)
        ) {
          continue;
        }
        const source = fs.readFileSync(absolutePath, 'utf8');
        for (const schema of schemaVersions) {
          if (
            source.includes(`'${schema}'`) ||
            source.includes(`"${schema}"`) ||
            source.includes(`\`${schema}\``)
          ) {
            violations.push(`${path.relative(sourceRoot, absolutePath)} -> ${schema}`);
          }
        }
      }
    };
    visit(sourceRoot);

    expect(violations).toEqual([]);
  });

  it('uses one physical registry for runtime commands and produced artifacts', () => {
    const contract = buildWorkspaceIntelligenceChainContract();

    expect(Object.keys(WORKSPACE_INTELLIGENCE_RUNTIME_STEPS)).toEqual([
      ...WORKSPACE_INTELLIGENCE_STEP_IDS,
    ]);
    expect(contract.steps.map((step) => step.id)).toEqual([...WORKSPACE_INTELLIGENCE_STEP_IDS]);

    for (const step of contract.steps) {
      const runtime =
        WORKSPACE_INTELLIGENCE_RUNTIME_STEPS[
          step.id as keyof typeof WORKSPACE_INTELLIGENCE_RUNTIME_STEPS
        ];
      expect(step.command, `${step.id} command drift`).toEqual(runtime.command);
      expect(step.produces, `${step.id} artifact drift`).toEqual(runtime.produces);
      expect(Object.keys(WORKSPACE_INTELLIGENCE_COMMAND_SIGNATURES)).toContain(step.command[0]);
    }

    expect(contract.runtimeRegistry).toEqual({
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
    });
  });

  it('resolves every JSON artifact to an existing matching schema contract', () => {
    for (const id of Object.keys(WORKSPACE_INTELLIGENCE_ARTIFACTS) as Array<
      keyof typeof WORKSPACE_INTELLIGENCE_ARTIFACTS
    >) {
      const schemaVersion = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS[id];
      const schemaContract = WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMA_CONTRACTS[id];
      if (schemaVersion === null) {
        expect(schemaContract, `${id} non-JSON artifact must not claim a JSON schema`).toBeNull();
        continue;
      }

      expect(schemaContract, `${id} must publish a schema contract`).toBeTruthy();
      const absolutePath = path.resolve(process.cwd(), schemaContract as string);
      expect(fs.existsSync(absolutePath), `${id} schema contract must exist`).toBe(true);
      const schema = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as {
        properties?: { schemaVersion?: { const?: string; enum?: string[] } };
      };
      const declared = schema.properties?.schemaVersion;
      expect(
        declared?.const === schemaVersion || declared?.enum?.includes(schemaVersion),
        `${id} schema contract must accept ${schemaVersion}`
      ).toBe(true);
    }
  });

  it('keeps context and distribution commands stage-pure', () => {
    const contract = buildWorkspaceIntelligenceChainContract();
    const context = contract.steps.find((step) => step.id === 'context');
    const agentSync = contract.steps.find((step) => step.id === 'agent-sync');

    expect(context?.command).toContain('--no-agent-sync');
    expect(agentSync?.command).not.toContain('--refresh-context');
    expect(context?.produces).toEqual([WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext]);
    expect(agentSync?.consumes).toEqual([WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext]);
  });

  it('keeps every canonical command flag registered by the CLI parser', () => {
    const cliSource = fs.readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const flags = new Set(
      Object.values(WORKSPACE_INTELLIGENCE_RUNTIME_STEPS)
        .flatMap((step) => [...step.command])
        .filter((token) => token.startsWith('--'))
    );

    for (const flag of flags) {
      const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        new RegExp(`\\.option\\(\\s*['"]${escaped}(?:\\s|<|\\[|['"])`).test(cliSource),
        `${flag} must remain registered in Commander`
      ).toBe(true);
    }
  });

  it('binds every canonical producer export to the artifact registry', () => {
    expect({
      model: WORKSPACE_MODEL_REPORT_PATH,
      knowledgeGraph: WORKSPACE_KNOWLEDGE_GRAPH_REPORT_PATH,
      snapshot: WORKSPACE_MODEL_SNAPSHOT_REPORT_PATH,
      diff: WORKSPACE_MODEL_DIFF_REPORT_PATH,
      impact: WORKSPACE_IMPACT_REPORT_PATH,
      analyze: WORKSPACE_INTELLIGENCE_ARTIFACTS.analyze,
      doctor: DOCTOR_WORKSPACE_REPORT_PATH,
      contractVerify: WORKSPACE_CONTRACT_VERIFY_REPORT_PATH,
      readiness: RELEASE_READINESS_REPORT_PATH,
      verify: WORKSPACE_VERIFY_REPORT_PATH,
      history: WORKSPACE_HISTORY_PATH,
      agentContext: WORKSPACE_CONTEXT_AGENT_REPORT_PATH,
      agentIndex: AGENT_REPORTS_INDEX_PATH,
      agentCustomizationPack: AGENT_CUSTOMIZATION_PACK_REPORT_PATH,
      skillsIndex: WORKSPACE_SKILLS_INDEX_PATH,
      agents: 'AGENTS.md',
      explain: WORKSPACE_EXPLAIN_REPORT_PATH,
      intelligenceRun: WORKSPACE_INTELLIGENCE_RUN_REPORT_PATH,
      evaluationLive: WORKSPACE_EVALUATION_LIVE_PATH,
      evaluationLastRun: WORKSPACE_EVALUATION_LAST_RUN_PATH,
      verifiedGoalStatus: VERIFIED_GOAL_LAST_RUN_REPORT_PATH,
      repairTransaction: WORKSPACE_REPAIR_LAST_RUN_REPORT_PATH,
    }).toEqual(WORKSPACE_INTELLIGENCE_ARTIFACTS);
  });

  it('binds every canonical producer schema to the artifact registry', () => {
    expect({
      model: WORKSPACE_MODEL_SCHEMA_VERSION,
      knowledgeGraph: WORKSPACE_KNOWLEDGE_GRAPH_SCHEMA_VERSION,
      snapshot: WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION,
      diff: WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
      impact: WORKSPACE_IMPACT_SCHEMA_VERSION,
      analyze: WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS.analyze,
      doctor: DOCTOR_WORKSPACE_EVIDENCE_SCHEMA,
      contractVerify: WORKSPACE_CONTRACT_VERIFY_SCHEMA_VERSION,
      readiness: RELEASE_READINESS_SCHEMA_VERSION,
      verify: WORKSPACE_VERIFY_SCHEMA_VERSION,
      history: WORKSPACE_HISTORY_SCHEMA_VERSION,
      agentContext: WORKSPACE_CONTEXT_SCHEMA_VERSION,
      agentIndex: AGENT_REPORTS_INDEX_SCHEMA,
      agentCustomizationPack: AGENT_CUSTOMIZATION_PACK_SCHEMA,
      skillsIndex: WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION,
      agents: null,
      explain: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
      intelligenceRun: WORKSPACE_INTELLIGENCE_RUN_SCHEMA_VERSION,
      evaluationLive: WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION,
      evaluationLastRun: WORKSPACE_INTELLIGENCE_EVALUATION_SCHEMA_VERSION,
      verifiedGoalStatus: VERIFIED_GOAL_STATUS_SCHEMA_VERSION,
      repairTransaction: WORKSPACE_REPAIR_TRANSACTION_SCHEMA_VERSION,
    }).toEqual(WORKSPACE_INTELLIGENCE_ARTIFACT_SCHEMAS);
  });

  it('pins one ordered, dependency-safe execution chain', () => {
    const contract = buildWorkspaceIntelligenceChainContract();
    expect(contract.schemaVersion).toBe('workspai-workspace-intelligence-chain-v1');
    expect(contract.steps.map((step) => step.id)).toEqual([
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

    const seen = new Set<string>();
    for (const [index, step] of contract.steps.entries()) {
      expect(step.ordinal).toBe(index + 1);
      expect(step.dependsOn.every((dependency) => seen.has(dependency))).toBe(true);
      seen.add(step.id);
    }
  });

  it('references real CLI commands and preserves evidence-before-verify semantics', () => {
    const contract = buildWorkspaceIntelligenceChainContract();
    for (const step of contract.steps) {
      if (step.command[0] === 'workspace') {
        expect(WORKSPACE_SUBCOMMANDS as readonly string[]).toContain(step.command[1]);
      }
    }

    const verify = contract.steps.find((step) => step.id === 'verify');
    expect(verify?.dependsOn).toEqual(
      expect.arrayContaining([
        'impact',
        'doctor-evidence',
        'contract-evidence',
        'analyze-evidence',
        'readiness-evidence',
      ])
    );
    expect(verify?.consumes).toEqual(
      expect.arrayContaining([
        '.workspai/reports/doctor-last-run.json',
        '.workspai/reports/workspace-contract-verify-last-run.json',
        '.workspai/reports/release-readiness-last-run.json',
      ])
    );
  });

  it('publishes deterministic diagram edges and agent read order', () => {
    const contract = buildWorkspaceIntelligenceChainContract();
    expect(contract.diagram.nodes).toHaveLength(contract.steps.length);
    expect(contract.diagram.edges).toEqual(
      contract.steps.flatMap((step) =>
        step.dependsOn.map((dependency) => ({
          from: dependency,
          to: step.id,
          meaning: 'required before',
        }))
      )
    );
    expect(contract.consumers.agents.canonicalReadOrder[0]).toBe('.workspai/reports/INDEX.json');
    expect(contract.consumers.agents.entrypoints).toContain('AGENTS.md');
    expect(contract.boundaries.inputs.map((input) => input.id)).toEqual([
      'projects-repositories',
      'runtime-dependencies',
      'workspace-rules',
      'changes',
      'model-baseline',
      'existing-evidence',
    ]);
    expect(contract.boundaries.outputs.flatMap((output) => output.producedBy)).toEqual(
      expect.arrayContaining(contract.steps.map((step) => step.id))
    );
    expect(contract.presentations.simple.layers).toEqual([
      'inputs',
      'intelligence',
      'outputs',
      'consumers',
    ]);
    const simpleNodes = contract.presentations.simple.nodes;
    expect(simpleNodes.map((node) => node.id)).toEqual([
      'input-layer',
      'workspace-intelligence',
      'agent-grounding',
      'evidence-and-decisions',
      'shared-consumers',
    ]);
    expect(
      simpleNodes.filter((node) => node.kind === 'inputs').flatMap((node) => node.contractRefs)
    ).toEqual(expect.arrayContaining(contract.boundaries.inputs.map((input) => input.id)));
    expect(
      simpleNodes.filter((node) => node.kind === 'outputs').flatMap((node) => node.contractRefs)
    ).toEqual(expect.arrayContaining(contract.boundaries.outputs.map((output) => output.id)));
    expect(
      simpleNodes.filter((node) => node.kind === 'consumers').flatMap((node) => node.contractRefs)
    ).toEqual(expect.arrayContaining(contract.boundaries.consumers.map((consumer) => consumer.id)));
    expect(simpleNodes.find((node) => node.kind === 'intelligence')?.contractRefs).toEqual(
      contract.steps.map((step) => step.id)
    );
    expect(contract.presentations.standard.phases).toEqual([
      'understand',
      'change',
      'evidence',
      'gate',
      'ground',
      'distribute',
      'explain',
    ]);
    expect(contract.presentations.standard.nodes.map((node) => node.id)).toEqual(
      contract.presentations.standard.phases
    );
    expect(contract.presentations.standard.nodes.flatMap((node) => node.stepRefs)).toEqual(
      contract.steps.map((step) => step.id)
    );
    expect(contract.presentations.advanced.steps).toEqual(contract.steps.map((step) => step.id));
  });

  it('closes every reference and artifact boundary', () => {
    const contract = buildWorkspaceIntelligenceChainContract();
    const stepIds = new Set(contract.steps.map((step) => step.id));
    const inputIds = new Set(contract.boundaries.inputs.map((input) => input.id));
    const outputIds = new Set(contract.boundaries.outputs.map((output) => output.id));
    const consumerIds = new Set(contract.boundaries.consumers.map((consumer) => consumer.id));

    for (const step of contract.steps) {
      expect(step.dependsOn.every((dependency) => stepIds.has(dependency))).toBe(true);
      expect(step.inputRefs.every((inputRef) => inputIds.has(inputRef))).toBe(true);
    }
    for (const input of contract.boundaries.inputs) {
      expect(stepIds.has(input.entersAt)).toBe(true);
    }
    for (const output of contract.boundaries.outputs) {
      expect(output.producedBy.every((producer) => stepIds.has(producer))).toBe(true);
      if (output.inventory === 'canonical-minimum') {
        expect(output.inventoryContract).toBeTruthy();
      }
    }

    const declaredArtifacts = new Set(
      contract.boundaries.outputs.flatMap((output) => output.artifacts)
    );
    for (const artifact of contract.steps.flatMap((step) => step.produces)) {
      expect(declaredArtifacts.has(artifact), `Undeclared output artifact: ${artifact}`).toBe(true);
    }

    const producerByArtifact = new Map(
      contract.steps.flatMap((step) =>
        step.produces.map((artifact) => [artifact, step.id] as const)
      )
    );
    const boundaryArtifacts = new Set(
      contract.boundaries.inputs.flatMap((input) =>
        input.sources.filter((source) => source.startsWith('.workspai/'))
      )
    );
    const stepById = new Map(contract.steps.map((step) => [step.id, step] as const));
    const ancestorsOf = (stepId: string, seen = new Set<string>()): Set<string> => {
      const step = stepById.get(stepId);
      for (const dependency of step?.dependsOn ?? []) {
        if (!seen.has(dependency)) {
          seen.add(dependency);
          ancestorsOf(dependency, seen);
        }
      }
      return seen;
    };
    for (const step of contract.steps) {
      const ancestors = ancestorsOf(step.id);
      for (const artifact of step.consumesArtifacts) {
        const producer = producerByArtifact.get(artifact);
        if (!producer && boundaryArtifacts.has(artifact)) continue;
        expect(producer, `${step.id} consumes unregistered artifact ${artifact}`).toBeTruthy();
        expect(
          ancestors.has(producer as string),
          `${step.id} consumes ${artifact} before its producer ${producer}`
        ).toBe(true);
      }
    }

    const simpleNodes = contract.presentations.simple.nodes;
    expect(
      simpleNodes
        .filter((node) => node.kind === 'inputs')
        .flatMap((node) => node.contractRefs)
        .every((reference) => inputIds.has(reference))
    ).toBe(true);
    expect(
      simpleNodes
        .filter((node) => node.kind === 'outputs')
        .flatMap((node) => node.contractRefs)
        .every((reference) => outputIds.has(reference))
    ).toBe(true);
    expect(
      simpleNodes
        .filter((node) => node.kind === 'consumers')
        .flatMap((node) => node.contractRefs)
        .every((reference) => consumerIds.has(reference))
    ).toBe(true);
    expect(
      simpleNodes
        .filter((node) => node.kind === 'intelligence')
        .flatMap((node) => node.contractRefs)
        .every((reference) => stepIds.has(reference))
    ).toBe(true);

    expect(contract.feedback.from.every((consumer) => consumerIds.has(consumer))).toBe(true);
    expect(contract.feedback.reentersThrough.every((input) => inputIds.has(input))).toBe(true);
    expect(
      contract.auxiliaryCapabilities.every((capability) => capability.chainStep === false)
    ).toBe(true);
    expect(contract.auxiliaryCapabilities.map((capability) => capability.id)).toEqual([
      'graph',
      'evaluation',
      'watch',
      'mcp',
    ]);
    expect(contract.invariants).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unknown or unavailable'),
        expect.stringContaining('workspace knowledge graph'),
        expect.stringContaining('contractRefs'),
        expect.stringContaining('when produced and when consumed'),
        expect.stringContaining('semantically coherent'),
        expect.stringContaining('Git observation'),
        expect.stringContaining('atomic'),
        expect.stringContaining('Concurrent history'),
      ])
    );
  });
});
