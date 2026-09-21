import { describe, expect, it } from 'vitest';

import {
  GRAPH_FACT_CLASS_QUALITY_SCHEMA,
  GRAPH_FACT_CLASSES,
  scoreFactClassQuality,
} from '../../src/testing/index.js';

describe('fact-class quality scoring', () => {
  it('scores true positives, false positives and false negatives per class', () => {
    const report = scoreFactClassQuality({
      expected: {
        files: { keys: ['src/a.ts', 'src/b.ts'] },
        routes: { keys: ['GET /health'] },
      },
      packageFull: {
        files: { keys: ['src/a.ts', 'src/extra.ts'] },
        routes: { keys: ['GET /health'] },
      },
      packageIncremental: {
        files: { keys: ['src/a.ts', 'src/extra.ts'] },
        routes: { keys: ['GET /health'] },
      },
      legacy: {
        files: { keys: ['src/a.ts', 'src/b.ts', 'src/legacy-fp.ts'] },
        routes: { keys: [] },
      },
    });

    expect(report.schema).toBe(GRAPH_FACT_CLASS_QUALITY_SCHEMA);
    expect(report.publicAccuracyClaimPermitted).toBe(false);
    expect(report.classes).toHaveLength(GRAPH_FACT_CLASSES.length);
    const files = report.classes.find((entry) => entry.factClass === 'files');
    expect(files?.truePositives).toBe(1);
    expect(files?.falsePositives).toBe(1);
    expect(files?.falseNegatives).toBe(1);
    expect(files?.differences).toEqual(
      expect.arrayContaining([
        { key: 'src/b.ts', kind: 'package-regression' },
        { key: 'src/legacy-fp.ts', kind: 'legacy-false-positive' },
        { key: 'src/extra.ts', kind: 'package-regression' },
      ])
    );
    const routes = report.classes.find((entry) => entry.factClass === 'routes');
    expect(routes?.differences).toEqual(
      expect.arrayContaining([
        { key: 'GET /health', kind: 'package-improvement' },
        { key: 'GET /health', kind: 'legacy-false-negative' },
      ])
    );
    expect(report.failures).toEqual([]);
  });

  it('rejects blanket approvals and records incremental drift', () => {
    const report = scoreFactClassQuality({
      expected: { files: { keys: ['src/a.ts'] } },
      packageFull: { files: { keys: ['src/a.ts'] } },
      packageIncremental: { files: { keys: ['src/b.ts'] } },
      approvals: [
        {
          factClass: 'files',
          key: '*',
          kind: 'approved-semantic-difference',
          reason: 'hide the class',
        },
        {
          factClass: 'files',
          key: 'src/a.ts',
          kind: 'approved-semantic-difference',
          reason: '',
        },
      ],
    });
    expect(report.failures.some((failure) => failure.includes('blanket'))).toBe(true);
    expect(report.failures.some((failure) => failure.includes('reason is required'))).toBe(true);
    expect(report.failures.some((failure) => failure.includes('incremental keys drifted'))).toBe(
      true
    );
  });

  it('rejects duplicate and unknown-class approvals', () => {
    const report = scoreFactClassQuality({
      expected: { files: { keys: ['src/a.ts'] } },
      packageFull: { files: { keys: ['src/a.ts'] } },
      approvals: [
        {
          factClass: 'files',
          key: 'src/a.ts',
          kind: 'approved-semantic-difference',
          reason: 'documented difference',
        },
        {
          factClass: 'files',
          key: 'src/a.ts',
          kind: 'approved-semantic-difference',
          reason: 'duplicate',
        },
        {
          factClass: 'not-a-class' as never,
          key: 'src/a.ts',
          kind: 'approved-semantic-difference',
          reason: 'invalid class',
        },
      ],
    });
    expect(report.failures.some((failure) => failure.includes('duplicate approval'))).toBe(true);
    expect(report.failures.some((failure) => failure.includes('not admitted'))).toBe(true);
  });

  it('does not let aggregate counts hide an empty weak class', () => {
    const report = scoreFactClassQuality({
      expected: {
        files: { keys: ['a.ts', 'b.ts'] },
        inheritance: { keys: ['Foo extends Bar'] },
      },
      packageFull: {
        files: { keys: ['a.ts', 'b.ts'] },
        inheritance: { keys: [] },
      },
    });
    const files = report.classes.find((entry) => entry.factClass === 'files');
    const inheritance = report.classes.find((entry) => entry.factClass === 'inheritance');
    expect(files?.f1).toBe(1);
    expect(inheritance?.recall).toBe(0);
    expect(inheritance?.falseNegatives).toBe(1);
  });
});
