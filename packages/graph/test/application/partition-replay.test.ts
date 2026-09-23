import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readFileSync as readJson } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { GraphWorkspaceFact } from '../../src/contracts/index.js';
import { scoreCallCorpus } from '../../src/application/call-resolution-score.js';
import {
  consumePartitions,
  PartitionWindow,
  pullFactPartitions,
  sliceFactPartitions,
} from '../../src/application/partition-producer.js';
import {
  readReplayJournal,
  replayJournalRecords,
  ReplayJournal,
} from '../../src/application/replay-journal.js';

function fact(id: string): GraphWorkspaceFact {
  return { factId: id } as GraphWorkspaceFact;
}

describe('partition window', () => {
  it('keeps only the admitted window and refuses to exceed it', () => {
    const window = new PartitionWindow({ maxFacts: 2, maxBytes: 1_000, maxInFlight: 1 });
    const first = {
      partitionId: 'a',
      providerId: 'p',
      sourceIdentity: 's',
      sourceDigest: 'd',
      sequence: 0,
      facts: [fact('one'), fact('two')],
      metadata: {
        factCount: 2,
        encodedBytes: 20,
        unknownZones: 0,
        unsupportedZones: 0,
        streaming: 'bounded' as const,
      },
    };
    window.admit(first);
    expect(window.retainedFactCount).toBe(2);
    expect(() => window.admit({ ...first, partitionId: 'b' })).toThrow('partition-window');
    expect(window.release()?.partitionId).toBe('a');
    expect(window.retainedFactCount).toBe(0);
  });

  it('yields bounded slices only when pulled', async () => {
    const facts = [fact('a'), fact('b'), fact('c')];
    const pages = sliceFactPartitions(
      facts,
      {
        partitionId: 'source',
        providerId: 'provider',
        sourceIdentity: 'source',
        sourceDigest: 'digest',
        streaming: 'legacy-array',
      },
      { maxFacts: 2, maxBytes: 1_000 }
    );
    const first = await pages.next();
    expect(first.value?.facts.map((item) => item.factId)).toEqual(['a', 'b']);
    expect(first.value?.metadata.streaming).toBe('legacy-array');
    const second = await pages.next();
    expect(second.value?.facts.map((item) => item.factId)).toEqual(['c']);
  });

  it('admits only one partition while the consumer is still running', async () => {
    let active = 0;
    let peak = 0;
    async function* facts(): AsyncGenerator<GraphWorkspaceFact, void, void> {
      yield fact('a');
      yield fact('b');
    }
    await consumePartitions(
      pullFactPartitions(
        facts(),
        {
          partitionId: 'source',
          providerId: 'provider',
          sourceIdentity: 'source',
          sourceDigest: 'digest',
          streaming: 'bounded',
        },
        { maxFacts: 1, maxBytes: 1_000_000 }
      ),
      { maxFacts: 10, maxBytes: 1_000_000, maxInFlight: 1 },
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      }
    );
    expect(peak).toBe(1);
  });
});

describe('replay journal', () => {
  it('rejects a truncated or reordered record', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workspai-journal-'));
    try {
      const journal = ReplayJournal.create(directory);
      const payload = Buffer.alloc(1024 * 1024, 7);
      const appended = journal.append(2, payload);
      expect(appended).not.toHaveProperty('payload');
      expect(journal.retainedPayloadBytes).toBe(0);
      journal.finish();
      journal.close();
      const file = readFileSync(join(directory, 'journal.rjnl'));
      expect(readReplayJournal(file, journal.sessionId).at(-1)?.kind).toBe(255);
      let live = 0;
      await replayJournalRecords(
        join(directory, 'journal.rjnl'),
        journal.sessionId,
        {},
        async () => {
          live += 1;
          expect(live).toBe(1);
          live -= 1;
        }
      );
      expect(() => readReplayJournal(file.subarray(0, file.byteLength - 1))).toThrow(
        'journal-truncated'
      );
      const corrupted = Buffer.from(file);
      corrupted[corrupted.byteLength - 40] ^= 1;
      expect(() => readReplayJournal(corrupted)).toThrow(/journal-/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('call resolution candidate', () => {
  it('scores an explicit prediction list without claiming review', () => {
    const corpus = JSON.parse(
      readJson(
        fileURLToPath(new URL('../../fixtures/call-resolution-corpus.v1.json', import.meta.url)),
        'utf8'
      )
    ) as {
      reviewStatus: string;
      cases: {
        id: string;
        language: string;
        expectedClass: 'exact' | 'unknown' | 'ambiguous' | 'unsupported';
        expectedTargets: string[];
      }[];
    };
    expect(corpus.reviewStatus).toBe('candidate-unreviewed');
    const score = scoreCallCorpus(
      corpus.cases,
      corpus.cases.map((item) => ({
        id: item.id,
        predictedClass: item.expectedClass,
        predictedTargets: item.expectedTargets,
      }))
    );
    expect(score.reviewStatus).toBe('candidate-unreviewed');
    expect(score.edgeFalsePositives).toBe(0);
    expect(score.edgeFalseNegatives).toBe(0);
    expect(score.edgeF1).toBe(1);
    expect(score.classificationMatches).toBe(corpus.cases.length);
    expect(score.unknownRate).toBeGreaterThan(0);
    expect(score.byLanguage.typescript).toBeDefined();
    expect(score.byLanguage.python?.edgeF1).toBe(1);
    expect(() =>
      scoreCallCorpus(corpus.cases, [
        ...corpus.cases.map((item) => ({
          id: item.id,
          predictedClass: item.expectedClass,
          predictedTargets: item.expectedTargets,
        })),
        ...corpus.cases.map((item) => ({
          id: item.id,
          predictedClass: item.expectedClass,
          predictedTargets: item.expectedTargets,
        })),
      ])
    ).toThrow('duplicate-prediction');
    const wrong = scoreCallCorpus(corpus.cases, [
      {
        id: 'ts-local-function',
        predictedClass: 'exact',
        predictedTargets: ['function other'],
      },
      {
        id: 'ts-unresolved',
        predictedClass: 'exact',
        predictedTargets: ['function missing'],
      },
    ]);
    expect(wrong.edgeFalsePositives).toBeGreaterThan(0);
    expect(wrong.edgeFalseNegatives).toBeGreaterThan(0);
    expect(wrong.edgeTruePositives).toBe(0);
  });
});
