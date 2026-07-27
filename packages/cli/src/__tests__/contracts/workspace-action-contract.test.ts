import { describe, expect, it } from 'vitest';

import {
  getWorkspaceActionContract,
  isWorkspaceActionHelpRequest,
  renderWorkspaceActionHelp,
  WORKSPACE_ACTION_CONTRACTS,
  WORKSPACE_ACTION_FLAG_DESCRIPTIONS,
} from '../../contracts/workspace-action-contract.js';
import { WORKSPACE_SUBCOMMANDS } from '../../utils/workspace-command-surface.js';

describe('workspace action contract', () => {
  it('keeps every action self-describing with bounded flags and examples', () => {
    expect(Object.keys(WORKSPACE_ACTION_CONTRACTS).sort()).toEqual(
      [...WORKSPACE_SUBCOMMANDS].sort()
    );

    for (const [action, contract] of Object.entries(WORKSPACE_ACTION_CONTRACTS)) {
      expect(contract.usage, action).toContain(`workspace ${action}`);
      expect(contract.summary.trim().length, action).toBeGreaterThan(10);
      expect(contract.examples.length, action).toBeGreaterThan(0);
      expect(new Set(contract.flags).size, action).toBe(contract.flags.length);
      for (const flag of contract.flags) {
        expect(WORKSPACE_ACTION_FLAG_DESCRIPTIONS[flag], `${action} ${flag}`).toBeTruthy();
      }
    }
  });

  it('publishes the actual compatibility artifact for the why alias', () => {
    expect(getWorkspaceActionContract('explain')?.artifact).toBe(
      '.workspai/reports/workspace-explain-last-run.json'
    );
    expect(getWorkspaceActionContract('why')?.artifact).toBe(
      '.workspai/reports/workspace-why-last-run.json'
    );
  });

  it('recognizes action-scoped help without intercepting root or unknown help', () => {
    expect(isWorkspaceActionHelpRequest(['workspace', 'impact', '--help'])).toBe(true);
    expect(isWorkspaceActionHelpRequest(['workspace', 'graph', 'search', '-h'])).toBe(true);
    expect(isWorkspaceActionHelpRequest(['workspace', '--help'])).toBe(false);
    expect(isWorkspaceActionHelpRequest(['workspace', 'unknown', '--help'])).toBe(false);
  });

  it('renders impact help from the same contract that governs accepted flags', () => {
    const contract = getWorkspaceActionContract('impact');
    const output = renderWorkspaceActionHelp('impact');

    expect(output).toContain('Workspai workspace impact');
    expect(output).toContain('Calculate the evidence-backed blast radius');
    expect(output).toContain('--from');
    expect(output).toContain('--scope');
    expect(output).toContain('.workspai/reports/workspace-impact-last-run.json');
    expect(contract?.flags).toContain('--strict');
  });

  it('documents every graph query and export mode in action help', () => {
    const output = renderWorkspaceActionHelp('graph');
    for (const mode of [
      'search',
      'evidence',
      'path',
      'overlay',
      'benchmark',
      'mermaid',
      'jsonld',
      'graphml',
      'gexf',
    ]) {
      expect(output).toContain(mode);
    }
  });
});
