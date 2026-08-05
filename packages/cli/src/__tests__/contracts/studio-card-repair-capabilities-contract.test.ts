import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildStudioCardRepairCapabilitiesContract } from '../../contracts/studio-card-repair-capabilities-contract.js';

const EXPECTED_CARD_IDS = [
  'doctor',
  'projectDoctor',
  'pipeline',
  'analyze',
  'readiness',
  'bootstrap',
  'workspaceSync',
  'foundation',
  'contract',
  'autopilot',
  'workspaceRun',
  'setup',
  'importReadiness',
  'snapshot',
  'workspaceModel',
  'intelligenceSnapshot',
  'workspaceDiff',
  'workspaceImpact',
  'workspaceIntelligenceRun',
  'workspaceVerify',
  'workspaceExplain',
  'workspaceWhy',
  'workspaceTrace',
  'workspaceWatch',
  'workspaceContextAgent',
  'agentGrounding',
  'share',
  'archive',
  'mirror',
  'cache',
  'policy',
  'infra',
].sort();

describe('Studio card repair capabilities contract', () => {
  it('binds every dashboard card to one exact producer and exact verification artifact', () => {
    const contract = buildStudioCardRepairCapabilitiesContract();
    expect(contract.cards.map((entry) => entry.cardId).sort()).toEqual(EXPECTED_CARD_IDS);
    expect(new Set(contract.cards.map((entry) => entry.cardId)).size).toBe(
      EXPECTED_CARD_IDS.length
    );

    for (const card of contract.cards) {
      expect(card.producerCommand).toMatch(/^npx workspai /);
      expect(card.producerArtifact).toMatch(/^\.workspai\//);
      expect(card.verifyCommand).toBe(card.producerCommand);
      expect(card.verifyArtifact).toBe(card.producerArtifact);
      expect(card.aggregateVerifyCommand).toBe('npx workspai workspace verify --json');
    }
  });

  it('never substitutes the Doctor producer for an unrelated card', () => {
    const contract = buildStudioCardRepairCapabilitiesContract();
    const doctorBacked = contract.cards
      .filter((entry) => entry.producerCommand.includes(' doctor '))
      .map((entry) => entry.cardId)
      .sort();
    expect(doctorBacked).toEqual(['doctor', 'importReadiness', 'projectDoctor']);
  });

  it('binds every producer to a published live CLI route', () => {
    const surface = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'contracts/runtime-command-surface.v1.json'), 'utf8')
    ) as {
      npmOwnedTopLevelCommands: string[];
      npmOwnedScopedCommands: string[][];
      workspaceSubcommands: string[];
    };
    const scopedRoots = new Set(surface.npmOwnedScopedCommands.map((entry) => entry[0]));

    for (const card of buildStudioCardRepairCapabilitiesContract().cards) {
      const argv = card.producerCommand.trim().split(/\s+/).slice(2);
      const [root, action] = argv;
      expect(surface.npmOwnedTopLevelCommands, card.cardId).toContain(root);
      if (root === 'workspace') {
        expect(surface.workspaceSubcommands, `${card.cardId}: ${card.producerCommand}`).toContain(
          action
        );
      } else if (scopedRoots.has(root)) {
        expect(
          surface.npmOwnedScopedCommands.some((route) => route[0] === root && route[1] === action),
          `${card.cardId}: ${card.producerCommand}`
        ).toBe(true);
      }
    }
  });
});
