import { describe, expect, it } from 'vitest';

import { buildGoalPack } from '../goals/goal-pack-kernel.js';
import { compileGoalIntent } from '../goals/intent-compiler.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';

const hash = (value: string): string => value.repeat(64).slice(0, 64);
const ports = { digestCanonical: hashCanonicalJson };

function input(intent: string) {
  return {
    generatedAt: '2026-08-15T00:00:00.000Z',
    intent: compileGoalIntent(intent),
    workspaceName: 'platform',
    scope: {
      kind: 'project' as const,
      projects: ['api'],
      selectionSource: 'explicit' as const,
    },
    sourceBinding: {
      model: {
        artifact: '.workspai/reports/workspace-model.json' as const,
        schemaVersion: 'workspace-model.v1' as const,
        hashAlgorithm: 'sha256' as const,
        hashSemantics: 'workspace-model-structural-v1' as const,
        hash: hash('a'),
        generatedAt: '2026-08-15T00:00:00.000Z',
      },
      graph: {
        artifact: '.workspai/reports/workspace-knowledge-graph.json' as const,
        schemaVersion: 'workspace-knowledge-graph.v1' as const,
        hashAlgorithm: 'sha256' as const,
        hashSemantics: 'canonical-json-v1' as const,
        hash: hash('b'),
        generatedAt: '2026-08-15T00:00:00.000Z',
        modelHash: hash('a'),
      },
    },
    preflight: {
      workspaceIntelligence: {
        status: 'passed' as const,
        artifact: '.workspai/reports/workspace-intelligence-run-last-run.json' as const,
        blockedStages: [],
      },
      measurement: {
        status: 'available' as const,
        runtime: 'node',
        runner: 'vitest',
        existingEvidence: [
          { project: 'api', path: 'coverage/coverage-summary.json', sha256: hash('d') },
        ],
        prerequisites: [],
      },
      retrieval: {
        status: 'grounded' as const,
        strategy: 'deterministic-category-v1' as const,
        queries: ['test suite coverage configuration instrumentation'],
        anchors: [],
      },
    },
    baseline: {
      projectCount: 1,
      runtimes: ['node'],
      frameworks: ['nestjs'],
      graph: {
        entities: 10,
        relationships: 9,
        proofs: 12,
        unresolved: 0,
        proofCoveragePercent: 100,
      },
    },
    maxAttempts: 5,
    consumer: 'generic' as const,
  };
}

describe('goal pack pure kernel', () => {
  it('compiles a measurable coverage goal into the existing verified-goal primitive', () => {
    const { goalPack, handoff } = buildGoalPack(
      input('Raise test coverage to at least 85%'),
      ports
    );

    expect(goalPack.state).toBe('ready-to-plan');
    expect(goalPack.successCriteria[0]).toMatchObject({
      kind: 'test-coverage',
      machineVerifiable: true,
    });
    expect(goalPack.commands.planVerifiedGoal).toContain(
      'workspace goal plan test-coverage --scope project:api --target 85'
    );
    expect(handoff.guardrails).toContain(
      'Do not edit .workspai evidence, goal, repair, contract, or report artifacts.'
    );
    expect(handoff.evidence[2].binding.semantics).toBe('canonical-json-v1');
    expect(handoff.evidence[2].binding.value).toBe(hashCanonicalJson(goalPack));
  });

  it('is deterministic across timestamps while binding identity to model and graph state', () => {
    const first = buildGoalPack(input('Fix the failing authentication regression'), ports).goalPack;
    const laterInput = {
      ...input('Fix the failing authentication regression'),
      generatedAt: '2030-01-01T00:00:00.000Z',
    };
    const second = buildGoalPack(laterInput, ports).goalPack;
    const changed = input('Fix the failing authentication regression');
    changed.sourceBinding.graph.hash = hash('c');
    const third = buildGoalPack(changed, ports).goalPack;

    expect(first.id).toBe(second.id);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.id).not.toBe(third.id);
  });

  it('requires clarification instead of inventing a metric for ambiguous coverage intent', () => {
    const { goalPack } = buildGoalPack(input('Improve test coverage'), ports);

    expect(goalPack.state).toBe('needs-confirmation');
    expect(goalPack.decision?.required).toBe(true);
    expect(goalPack.commands.planVerifiedGoal).toBeUndefined();
  });

  it('does not claim readiness when a measurable goal still requires evidence setup', () => {
    const pending = input('Raise test coverage to 85%');
    pending.preflight.measurement.status = 'requires-setup';
    pending.preflight.measurement.prerequisites = ['Configure an LCOV producer.'];
    const { goalPack } = buildGoalPack(pending, ports);

    expect(goalPack.state).toBe('needs-evidence');
    expect(goalPack.decision?.reason).toContain('LCOV');
    expect(goalPack.orchestration.find((step) => step.id === 'propose')?.status).toBe('blocked');
  });

  it('blocks agent planning when bounded Graph retrieval has no evidence anchors', () => {
    const pending = input('Map the authentication architecture');
    pending.preflight.retrieval.status = 'empty';
    const { goalPack } = buildGoalPack(pending, ports);

    expect(goalPack.state).toBe('blocked');
    expect(goalPack.decision?.reason).toContain('Graph anchor');
    expect(goalPack.orchestration.find((step) => step.id === 'propose')?.status).toBe('blocked');
  });

  it('keeps valid custom objectives executable even when classification is low-confidence', () => {
    const custom = compileGoalIntent('Better contributor onboarding experience');

    expect(custom).toMatchObject({
      original: 'Better contributor onboarding experience',
      category: 'feature-change',
      confidence: 'low',
      ambiguities: [],
    });
    const { goalPack, handoff } = buildGoalPack(
      { ...input(custom.original), intent: custom },
      ports
    );
    expect(goalPack.state).toBe('ready-to-plan');
    expect(goalPack.commands.planVerifiedGoal).toBeUndefined();
    expect(goalPack.successCriteria).toEqual([
      expect.objectContaining({
        kind: 'workspace-verify',
        machineVerifiable: true,
        expected: expect.stringContaining('without claiming arbitrary semantic outcome'),
      }),
    ]);
    expect(goalPack.orchestration.find((step) => step.id === 'verify')?.summary).toContain(
      'agent must review'
    );
    expect(handoff.guardrails).toContainEqual(
      expect.stringContaining('final outcome acceptance requires evidence review')
    );
    expect(handoff.workflow.at(-1)).toMatchObject({ order: 6, owner: 'agent' });
  });

  it('recognizes a named project in a natural release-readiness objective', () => {
    expect(compileGoalIntent('Prepare gRPC for release')).toMatchObject({
      category: 'release-readiness',
      confidence: 'high',
      ambiguities: [],
    });
  });

  it('rejects empty, oversized, and control-character intents', () => {
    expect(() => compileGoalIntent('   ')).toThrow('cannot be empty');
    expect(() => compileGoalIntent(`fix\u0000bug`)).toThrow('control characters');
    expect(() => compileGoalIntent('a'.repeat(2_001))).toThrow('safety limit');
    expect(() => compileGoalIntent('Fix /home/alice/private/app.ts')).toThrow('machine-local');
    expect(() => compileGoalIntent('Fix /mnt/company/private/app.ts')).toThrow('machine-local');
    expect(() => compileGoalIntent('Read /etc/passwd for configuration')).toThrow('machine-local');
    expect(() => compileGoalIntent(String.raw`Fix C:\work\private\app.ts`)).toThrow(
      'machine-local'
    );
    expect(() => compileGoalIntent('Use token=github_pat_abcdefghijklmnopqrstuvwxyz')).toThrow(
      'secret material'
    );
    expect(() => compileGoalIntent('Use npm_abcdefghijklmnopqrstuvwxyz1234')).toThrow(
      'secret material'
    );
    expect(() => compileGoalIntent('Connect postgres://admin:private-pass@db/app')).toThrow(
      'secret material'
    );
  });

  it('keeps canonical artifacts portable and free of local workspace paths', () => {
    const { goalPack, handoff } = buildGoalPack(
      input('Map the authentication architecture'),
      ports
    );
    const serialized = JSON.stringify({ goalPack, handoff });

    expect(serialized).not.toContain('/home/');
    expect(serialized).not.toContain('C:\\');
    expect(goalPack.artifacts.goalPack).toMatch(/^\.workspai\/goals\//);
  });

  it('quotes non-shell-safe project names in executable guidance', () => {
    const unsafe = input('Prepare this project for release');
    unsafe.scope.projects = ['API service'];
    const { goalPack, handoff } = buildGoalPack(unsafe, ports);

    expect(goalPack.commands.planVerifiedGoal).toContain('--scope "project:API service"');
    expect(goalPack.commands.inspectGraph).toContain('--scope "project:API service"');
    expect(handoff.renewal.command).toContain('--scope "project:API service"');
  });
});
