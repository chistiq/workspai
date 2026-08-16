import type { CompiledGoalIntent, GoalIntentCategory } from './goal-pack-contract.js';

const MAX_INTENT_LENGTH = 2_000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MACHINE_LOCAL_PATH =
  /(?:^|\s)(?:\/(?:home|Users|private|var\/folders)\/[^\s]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s]+)/;
const SECRET_MATERIAL =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:github_pat_|ghp_|sk-)[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b|\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s]{6,})/i;

const CATEGORY_RULES: ReadonlyArray<{
  category: GoalIntentCategory;
  patterns: RegExp[];
}> = [
  {
    category: 'test-coverage',
    patterns: [/\b(?:test\s+)?coverage\b/i, /\bcoverage\s+(?:to|above|at least)\b/i],
  },
  {
    category: 'dependency-security',
    patterns: [
      /\b(?:dependency|dependencies|package|packages)\b.*\b(?:security|vulnerab|audit)\b/i,
      /\b(?:security|vulnerab|audit)\b.*\b(?:dependency|dependencies|package|packages)\b/i,
    ],
  },
  {
    category: 'release-readiness',
    patterns: [
      /\brelease[ -]readiness\b/i,
      /\bready (?:this |the )?(?:workspace|project) for release\b/i,
    ],
  },
  {
    category: 'defect-repair',
    patterns: [/\b(?:fix|repair|resolve|debug)\b.*\b(?:bug|error|failure|issue|regression)\b/i],
  },
  {
    category: 'performance',
    patterns: [/\b(?:performance|latency|throughput|memory|cpu|optimi[sz]e|faster|slower)\b/i],
  },
  {
    category: 'refactor',
    patterns: [/\b(?:refactor|restructure|decouple|extract|simplify|cleanup|clean up)\b/i],
  },
  {
    category: 'documentation',
    patterns: [/\b(?:document|documentation|readme|guide|tutorial|docs)\b/i],
  },
  {
    category: 'feature-change',
    patterns: [/\b(?:add|build|create|implement|introduce|support)\b/i],
  },
  {
    category: 'system-understanding',
    patterns: [/\b(?:understand|explain|map|find|where|how|architecture|analy[sz]e|search)\b/i],
  },
];

function normalizedIntent(raw: string): string {
  if (typeof raw !== 'string') throw new Error('Goal intent must be text.');
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Goal intent cannot be empty.');
  if (trimmed.length > MAX_INTENT_LENGTH) {
    throw new Error(`Goal intent exceeds the ${MAX_INTENT_LENGTH} character safety limit.`);
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new Error('Goal intent contains unsupported control characters.');
  }
  if (MACHINE_LOCAL_PATH.test(trimmed)) {
    throw new Error(
      'Goal intent contains a machine-local absolute path. Use a workspace-relative path or project scope.'
    );
  }
  if (SECRET_MATERIAL.test(trimmed)) {
    throw new Error('Goal intent appears to contain secret material and was not persisted.');
  }
  return trimmed;
}

function coverageTarget(intent: string): number | null {
  const match = intent.match(/\b(?:coverage\D{0,24})?(100|\d{1,2})(?:\.\d+)?\s*%/i);
  if (!match || !/coverage/i.test(intent)) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function compileGoalIntent(raw: string): CompiledGoalIntent {
  const original = normalizedIntent(raw);
  const matches = CATEGORY_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(original))
  ).map((rule) => rule.category);
  const category = matches[0] ?? 'feature-change';
  const target = coverageTarget(original);
  const ambiguities: string[] = [];

  if (matches.length === 0) {
    ambiguities.push('The requested change type could not be classified with high confidence.');
  }
  if (matches.length > 1 && matches[0] !== 'test-coverage') {
    ambiguities.push(`The intent also contains signals for: ${matches.slice(1).join(', ')}.`);
  }
  if (category === 'test-coverage' && target === null) {
    ambiguities.push('A numeric test coverage target is required for machine verification.');
  }

  return {
    original,
    normalized: original.toLocaleLowerCase('en-US'),
    statement: original.replace(/[.!?]+$/, ''),
    category,
    confidence: matches.length === 1 ? 'high' : matches.length > 1 ? 'medium' : 'low',
    ambiguities,
    ...(target === null
      ? {}
      : {
          requestedTarget: {
            metric: 'test-coverage-percent' as const,
            operator: 'at-least' as const,
            value: target,
          },
        }),
  };
}

/** Stable, local retrieval vocabulary. This is intentionally model-free and portable. */
export function retrievalQueriesForGoal(intent: CompiledGoalIntent): string[] {
  const categoryQueries: Record<GoalIntentCategory, string[]> = {
    'test-coverage': [
      'test suite coverage configuration instrumentation',
      'CI tests LCOV Cobertura JaCoCo LLVM coverage',
    ],
    'dependency-security': ['dependency manifest lockfile security audit vulnerability'],
    'release-readiness': ['release pipeline readiness gates build test deploy'],
    'defect-repair': ['failure error test implementation call path'],
    'feature-change': ['API implementation module dependency tests'],
    refactor: ['module dependency ownership implementation tests'],
    performance: ['performance benchmark latency throughput runtime'],
    documentation: ['documentation README guide architecture decision'],
    'system-understanding': ['architecture service API dependency ownership'],
  };
  return [...new Set([...categoryQueries[intent.category], intent.statement])].slice(0, 3);
}
