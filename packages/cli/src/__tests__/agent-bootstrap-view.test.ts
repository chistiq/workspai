import { describe, expect, it } from 'vitest';
import {
  agentBootstrapByteBudget,
  agentBootstrapViewBytes,
  buildAgentBootstrapView,
  type AgentBootstrapView,
} from '../agent-bootstrap-view.js';
import type { AgentBootstrapReceipt } from '../project-agent-entry.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';

function seal(source: AgentBootstrapReceipt): AgentBootstrapReceipt {
  const { integrity, ...payload } = source;
  return { ...source, integrity: { ...integrity, payloadHash: hashCanonicalJson(payload) } };
}

function receipt(): AgentBootstrapReceipt {
  return seal({
    schemaVersion: 'workspai.agent-bootstrap-receipt.v1',
    generatedAt: '2026-11-07T00:00:00.000Z',
    receiptId: 'a'.repeat(64),
    status: 'ready',
    statusScope: 'agent-grounding',
    readiness: {
      agentGrounding: 'ready',
      architectureEvidence: 'ready',
      projectEnvironment: 'ready',
      release: 'not-verified',
    },
    requestedAgent: 'codex',
    resolvedHost: 'codex',
    project: { name: 'library', relativePath: 'packages/library', runtime: 'rust' },
    workspace: {
      name: 'lab',
      relationship: 'adopted',
      resolved: true,
      identityIsFilesystemPath: false,
      resolverCommand: 'workspai project workspace status --json',
      portableUriScheme: 'workspace:',
      resolvedPathPolicy: 'runtime-private-never-persist',
    },
    entry: {
      artifact: '.workspai/agent-entry.v1.json',
      schemaVersion: 'workspai.agent-entry.v1',
      hostStatus: 'ready',
      entryFiles: ['AGENTS.md'],
    },
    canonicalEvidence: {
      projectContext: '.workspai/reports/project-context-agent.json',
      projectKnowledgeGraph: '.workspai/reports/project-knowledge-graph-reference.json',
      workspaceIndex: 'workspace:.workspai/reports/INDEX.json',
      workspaceContext: 'workspace:.workspai/reports/workspace-context-agent.json',
      workspaceModel: 'workspace:.workspai/reports/workspace-model.json',
      knowledgeGraph: 'workspace:.workspai/reports/workspace-knowledge-graph.json',
      workspaceSkillsIndex: 'workspace:.workspai/reports/workspace-skills-index.json',
      boundedGraphSearch:
        'command:workspai workspace graph search <task-query> --scope project:<project> --limit 12 --json',
      modelFreshness: 'fresh',
      graphFreshness: 'fresh',
      graphMatchesModel: true,
      liveInputsValidated: true,
      blockerCount: 0,
    },
    activeGoal: { present: false, appliesToProject: false, status: 'none' },
    requiredReadOrder: [
      '.workspai/agent-entry.v1.json',
      'command:workspai agent bootstrap --for-agent codex --strict --json',
      'command:workspai project workspace status --json',
      '.workspai/reports/project-context-agent.json',
      'workspace:.workspai/goals/index.json',
      'workspace:.workspai/reports/workspace-skills-index.json',
      'command:workspai workspace graph search <task-query> --scope project:<project> --limit 12 --json',
      'source:targeted-live-files',
    ],
    claims: {
      architecture: 'allowed-with-citations',
      sourceInspection: 'bounded-and-targeted',
      sourceMutation: 'risk-and-project-policy-based',
      verification: 'cli-evidence-only',
    },
    checks: Array.from({ length: 24 }, (_, i) => ({
      id: `check-${i}`,
      status: 'passed' as const,
      message: `Validated canonical evidence binding ${i}; a detailed successful check description.`,
    })),
    nextActions: [
      'workspai workspace graph search <task-query> --scope project:library --limit 12 --json',
    ],
    integrity: {
      algorithm: 'sha256',
      manifestHash: 'b'.repeat(64),
      projectContextHash: 'c'.repeat(64),
      payloadHash: 'd'.repeat(64),
      portable: true,
      absolutePathsEmitted: false,
    },
  });
}

function complete(source = receipt(), maxBytes?: number): AgentBootstrapView {
  const view = buildAgentBootstrapView(seal(source), { maxBytes });
  if (view.status === 'insufficient-budget') throw new Error('Expected a complete test view');
  return view;
}

describe('bounded CLI agent bootstrap projection', () => {
  it('keeps the restrictive policy of an integrity-bound legacy bootstrap receipt', () => {
    const source = receipt();
    source.claims.sourceMutation = 'governed-cli-transaction-only';
    const view = complete(source);
    expect(view.claims.sourceMutation).toBe('governed-cli-transaction-only');
  });

  it('preserves authority, exact source receipt identity, status and all readiness dimensions', () => {
    const source = receipt();
    const view = complete(source);
    for (const key of [
      'project',
      'workspace',
      'entry',
      'readiness',
      'claims',
      'canonicalEvidence',
      'activeGoal',
    ] as const) {
      expect(view[key]).toEqual(source[key]);
    }
    expect(view.sourceReceipt).toEqual({
      schemaVersion: source.schemaVersion,
      receiptId: source.receiptId,
      integrity: source.integrity,
    });
    expect(view.checks).toEqual({ total: 24, passed: 24, omittedPassedDetails: 24, findings: [] });
    expect(agentBootstrapViewBytes(view)).toBeLessThan(
      Buffer.byteLength(JSON.stringify(source) + '\n')
    );
  });

  it.each(['degraded', 'blocked'] as const)(
    'never promotes %s evidence or hides findings',
    (status) => {
      const source = receipt();
      source.status = status;
      source.readiness.agentGrounding = status;
      source.readiness.architectureEvidence = status;
      source.claims.architecture = 'prohibited';
      source.canonicalEvidence.graphFreshness = 'stale';
      source.canonicalEvidence.liveInputsValidated = false;
      source.checks.push({
        id: 'coverage',
        status: 'warning',
        message: 'Unsupported surface; scope is partial.',
      });
      source.checks.push({
        id: 'binding',
        status: 'failed',
        message: 'Refresh the current generation.',
      });
      source.nextActions = [
        'workspai workspace intelligence run --for-agent generic --strict --json',
      ];
      const view = complete(source);
      expect(view.status).toBe(status);
      expect(view.readiness).toEqual(source.readiness);
      expect(view.claims).toEqual(source.claims);
      expect(view.canonicalEvidence).toEqual(source.canonicalEvidence);
      expect(view.checks.findings).toEqual(source.checks.slice(-2));
      expect(view.nextActions).toEqual(source.nextActions);
    }
  );

  it('does not reissue completed bootstrap, membership resolution or Goal selection', () => {
    const view = complete();
    expect(
      view.requiredReadOrder.some((step) => step.startsWith('command:workspai agent bootstrap '))
    ).toBe(false);
    expect(view.requiredReadOrder).not.toContain(
      'command:workspai project workspace status --json'
    );
    expect(view.requiredReadOrder).not.toContain('workspace:.workspai/goals/index.json');
    expect(view.requiredReadOrder).toContain('.workspai/agent-entry.v1.json');
    expect(view.requiredReadOrder).toContain('.workspai/reports/project-context-agent.json');
    expect(view.requiredReadOrder).toContain('source:targeted-live-files');
    expect(view.requiredReadOrder.some((step) => step.includes('graph search <task-query>'))).toBe(
      true
    );
    expect(
      view.requiredReadOrder.find((step) => step.includes('graph search <task-query>'))
    ).toContain('--view agent');
    expect(
      receipt().requiredReadOrder.find((step) => step.includes('graph search <task-query>'))
    ).not.toContain('--view agent');
  });

  it('reads the exact applicable Goal pack and handoff before Skills and graph retrieval', () => {
    const source = receipt();
    source.activeGoal = {
      present: true,
      appliesToProject: true,
      status: 'ready',
      id: 'goal-1',
      goalPack: 'workspace:.workspai/goals/goal-1/pack.json',
      agentHandoff: 'workspace:.workspai/goals/goal-1/handoff.json',
    };
    const reads = complete(source).requiredReadOrder;
    const goalAt = reads.indexOf(source.activeGoal.goalPack!);
    expect(goalAt).toBeGreaterThanOrEqual(0);
    expect(reads[goalAt + 1]).toBe(source.activeGoal.agentHandoff);
    expect(goalAt).toBeLessThan(reads.indexOf(source.canonicalEvidence.workspaceSkillsIndex));
    source.activeGoal.appliesToProject = false;
    expect(complete(source).requiredReadOrder).not.toContain(source.activeGoal.goalPack);
  });

  it('accounts for the exact UTF-8 representation and authenticates the selected view', () => {
    const source = receipt();
    source.project.name = '\u06a9\u062a\u0627\u0628\u062e\u0627\u0646\u0647';
    const view = complete(source);
    expect(view.budget.usedBytes).toBe(agentBootstrapViewBytes(view));
    expect(view.budget.usedBytes).toBeGreaterThan(JSON.stringify(view).length);
    const { integrity, ...unsigned } = view;
    expect(integrity.payloadHash).toBe(hashCanonicalJson(unsigned));
    expect(complete(source)).toEqual(view);
  });

  it('accepts an exact-fit budget and refuses one byte less without dropping mandatory data', () => {
    const source = receipt();
    const required = complete(source, 8192).budget.usedBytes;
    expect(complete(source, required).budget.usedBytes).toBe(required);
    const failed = buildAgentBootstrapView(seal(source), { maxBytes: required - 1 });
    expect(failed.status).toBe('insufficient-budget');
    expect(failed.budget).toMatchObject({ requiredBytes: required, maxBytes: required - 1 });
    expect(failed).not.toHaveProperty('claims');
    expect(agentBootstrapViewBytes(failed)).toBeLessThanOrEqual(required - 1);
  });

  it('refuses oversized findings rather than truncating a limitation or upgrading readiness', () => {
    const source = receipt();
    source.status = 'blocked';
    source.checks.push({
      id: 'large-finding',
      status: 'failed',
      message: 'limitation '.repeat(20_000),
    });
    const view = buildAgentBootstrapView(seal(source), { maxBytes: 1024 });
    expect(view).toMatchObject({ status: 'insufficient-budget', groundingStatus: 'blocked' });
    expect(agentBootstrapViewBytes(view)).toBeLessThanOrEqual(1024);
    expect(view.nextActions).toEqual([
      'Use --view full; the required view exceeds the maximum agent output budget.',
    ]);
  });

  it('recommends a sufficient budget when changing it increases its serialized decimal width', () => {
    const source = receipt();
    source.checks.push({ id: 'finding', status: 'warning', message: 'x'.repeat(7000) });
    const failed = buildAgentBootstrapView(seal(source), { maxBytes: 9999 });
    expect(failed.status).toBe('insufficient-budget');
    if (failed.status !== 'insufficient-budget') throw new Error('Expected an oversized fixture');
    expect(failed.budget.requiredBytes).toBeGreaterThan(9999);
    const retry = complete(source, failed.budget.requiredBytes);
    expect(retry.budget.usedBytes).toBeLessThanOrEqual(failed.budget.requiredBytes);
  });

  it('does not mutate or share mutable state with the source receipt', () => {
    const source = receipt();
    const before = JSON.stringify(source);
    const view = complete(source);
    view.claims.architecture = 'prohibited';
    view.sourceReceipt.integrity.payloadHash = 'e'.repeat(64);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects a source receipt changed after its integrity digest was issued', () => {
    const source = receipt();
    source.claims.architecture = 'prohibited';
    expect(() => buildAgentBootstrapView(source)).toThrow('receipt integrity mismatch');
  });

  it.each(['1.5', '1e4', '-1', '', '999', '131073', Number.NaN, Infinity])(
    'rejects an invalid budget %s',
    (value) => {
      expect(() => agentBootstrapByteBudget(value)).toThrow('--max-bytes');
    }
  );
});
