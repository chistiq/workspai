import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_ACTION_OUTCOME_SCHEMA_VERSION,
  isAgentActionOutcomeRecord,
  normalizeAgentActionOutcome,
  parseAgentActionOutcomeInput,
} from '../contracts/agent-action-outcome-contract.js';
import {
  isWorkspaceExplainReport,
  parseWorkspaceExplainTarget,
  resolveWorkspaceTraceTarget,
  WORKSPACE_EXPLAIN_SCHEMA_VERSION,
} from '../contracts/workspace-explain-contract.js';
import {
  getBridgeTimeoutMs,
  getNetworkTimeoutMs,
  getProbeTimeoutMs,
} from '../utils/command-timeouts.js';
import { isWorkspaiEnvEnabled, readWorkspaiEnv } from '../utils/env-compat.js';
import {
  buildOperationalSkillRecordShell,
  isWorkspaceOperationalSkillRecord,
  normalizeOperationalSkillId,
} from '../contracts/workspace-operational-skill-contract.js';
import {
  buildWorkspaceSkillsIndex,
  isWorkspaceSkillsIndex,
} from '../contracts/workspace-skills-index-contract.js';

describe('small published contract boundaries', () => {
  const envSnapshot = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
  });

  it('normalizes and validates agent action outcomes', () => {
    expect(normalizeAgentActionOutcome(' ok ')).toBe('ok');
    expect(normalizeAgentActionOutcome('failed')).toBe('failed');
    expect(normalizeAgentActionOutcome('other')).toBeNull();
    expect(normalizeAgentActionOutcome(1)).toBeNull();
    expect(isAgentActionOutcomeRecord(null)).toBe(false);
    expect(isAgentActionOutcomeRecord([])).toBe(false);
    const record = {
      schemaVersion: AGENT_ACTION_OUTCOME_SCHEMA_VERSION,
      generatedAt: 'now',
      actionId: 'a',
      scope: 'workspace',
      summary: 'done',
      outcome: 'ok',
    };
    expect(isAgentActionOutcomeRecord(record)).toBe(true);
    for (const key of ['schemaVersion', 'actionId', 'scope', 'summary', 'outcome']) {
      expect(isAgentActionOutcomeRecord({ ...record, [key]: null })).toBe(false);
    }
  });

  it('parses optional agent evidence fields while filtering invalid array entries', () => {
    expect(parseAgentActionOutcomeInput(null)).toBeNull();
    expect(parseAgentActionOutcomeInput([])).toBeNull();
    expect(parseAgentActionOutcomeInput({ actionId: 1, summary: 'x', outcome: 'ok' })).toBeNull();
    const parsed = parseAgentActionOutcomeInput({
      actionId: ' action ',
      summary: ' summary ',
      outcome: ' failed ',
      scope: ' project ',
      generatedAt: ' now ',
      affectedFiles: ['a.ts', '', 1],
      commandsRun: ['npm test', null],
      verifyBefore: 'before',
      verifyAfter: 'after',
      evidenceSha256: 'hash',
      evidencePath: 'report.json',
    });
    expect(parsed).toMatchObject({
      actionId: 'action',
      scope: 'project',
      summary: 'summary',
      outcome: 'failed',
      affectedFiles: ['a.ts'],
      commandsRun: ['npm test'],
    });
    expect(
      parseAgentActionOutcomeInput({ actionId: 'a', summary: 's', outcome: 'ok' })?.scope
    ).toBe('workspace');
  });

  it('parses every explain and trace target representation', () => {
    expect(parseWorkspaceExplainTarget('')).toBeNull();
    expect(parseWorkspaceExplainTarget('release-blocked')).toEqual({ kind: 'release-blocked' });
    expect(parseWorkspaceExplainTarget('project: api')).toEqual({
      kind: 'project',
      project: 'api',
    });
    expect(parseWorkspaceExplainTarget('project:')).toBeNull();
    expect(parseWorkspaceExplainTarget('blocker: B1')).toEqual({
      kind: 'blocker',
      blockerId: 'B1',
    });
    expect(parseWorkspaceExplainTarget('blocker:')).toBeNull();
    expect(parseWorkspaceExplainTarget('trace: diff')).toEqual({ kind: 'trace', diffRef: 'diff' });
    expect(parseWorkspaceExplainTarget('trace:')).toBeNull();
    expect(parseWorkspaceExplainTarget('api')).toEqual({ kind: 'project', project: 'api' });
    expect(resolveWorkspaceTraceTarget('')).toBeNull();
    expect(resolveWorkspaceTraceTarget('trace: abc')).toEqual({ kind: 'trace', diffRef: 'abc' });
    expect(resolveWorkspaceTraceTarget('.rapidkit/reports/diff.json')?.kind).toBe('trace');
    expect(resolveWorkspaceTraceTarget('workspace-model-diff.latest')?.kind).toBe('trace');
    expect(resolveWorkspaceTraceTarget('api')).toBeNull();
  });

  it('validates explain report envelopes', () => {
    const report = {
      schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
      generatedAt: 'now',
      summary: 'summary',
      sections: [],
      target: { kind: 'project' },
    };
    expect(isWorkspaceExplainReport(report)).toBe(true);
    for (const value of [null, [], {}, { ...report, sections: null }, { ...report, target: [] }]) {
      expect(isWorkspaceExplainReport(value)).toBe(false);
    }
  });

  it('honors current and legacy environment names plus timeout fallbacks', () => {
    delete process.env.WORKSPAI_FEATURE;
    process.env.RAPIDKIT_FEATURE = ' true ';
    expect(readWorkspaiEnv('FEATURE')).toBe('true');
    expect(isWorkspaiEnvEnabled('WORKSPAI_FEATURE')).toBe(true);
    process.env.WORKSPAI_FEATURE = '1';
    expect(readWorkspaiEnv('RAPIDKIT_FEATURE')).toBe('1');
    process.env.WORKSPAI_FEATURE = 'no';
    expect(isWorkspaiEnvEnabled('FEATURE')).toBe(false);

    process.env.RAPIDKIT_TIMEOUT_PROBE_MS = '12.9';
    process.env.RAPIDKIT_TIMEOUT_NETWORK_MS = 'invalid';
    process.env.RAPIDKIT_TIMEOUT_BRIDGE_MS = '-1';
    expect(getProbeTimeoutMs()).toBe(12);
    expect(getNetworkTimeoutMs()).toBe(3000);
    expect(getBridgeTimeoutMs()).toBe(8000);
  });

  it('fully validates operational skill records and deterministic indexes', () => {
    for (const value of [null, 1, '', 'a/b', '../a', '  '])
      expect(normalizeOperationalSkillId(value)).toBeNull();
    expect(normalizeOperationalSkillId(' doctor-check ')).toBe('doctor-check');
    expect(() =>
      buildOperationalSkillRecordShell({
        skillId: '../bad',
        title: 'x',
        triggers: [],
        requiredReports: [],
        verificationCommands: [],
        markdown: '',
      })
    ).toThrow('Invalid skill id');
    const skill = buildOperationalSkillRecordShell({
      skillId: 'doctor-check',
      title: 'Doctor',
      triggers: ['z', 'a'],
      requiredReports: ['z.json', 'a.json'],
      scopedProjects: ['web', 'api'],
      verificationCommands: ['workspai doctor'],
      promptStem: 'Check',
      markdown: '# Doctor',
    });
    expect(skill.triggers).toEqual(['a', 'z']);
    expect(skill.scopedProjects).toEqual(['api', 'web']);
    expect(isWorkspaceOperationalSkillRecord(skill)).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { ...skill, schemaVersion: 'bad' },
      { ...skill, triggers: null },
      { ...skill, requiredReports: null },
      { ...skill, verificationCommands: null },
    ])
      expect(isWorkspaceOperationalSkillRecord(value)).toBe(false);
    const minimal = buildOperationalSkillRecordShell({
      skillId: 'minimal',
      title: 'Minimal',
      triggers: [],
      requiredReports: [],
      verificationCommands: [],
      markdown: '',
    });
    expect(minimal).not.toHaveProperty('promptStem');
    const index = buildWorkspaceSkillsIndex({ generatedAt: 'now', skills: [skill, minimal] });
    expect(index.skills.map((entry) => entry.skillId)).toEqual(['doctor-check', 'minimal']);
    expect(
      buildWorkspaceSkillsIndex({ generatedAt: 'now', skills: [], inputsHash: 'fixed' }).inputsHash
    ).toBe('fixed');
    expect(isWorkspaceSkillsIndex(index)).toBe(true);
    for (const value of [
      null,
      [],
      {},
      { ...index, schemaVersion: 'bad' },
      { ...index, generatedAt: null },
      { ...index, skills: null },
      { ...index, selection: {} },
    ])
      expect(isWorkspaceSkillsIndex(value)).toBe(false);
  });
});
