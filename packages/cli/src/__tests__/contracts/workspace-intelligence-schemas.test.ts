import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_DEPENDENCY_GRAPH_SCHEMA_VERSION } from '../../contracts/workspace-dependency-graph-contract.js';
import { AGENT_ACTION_OUTCOME_SCHEMA_VERSION } from '../../contracts/agent-action-outcome-contract.js';
import { FACT_FRESHNESS_SCHEMA_VERSION } from '../../contracts/fact-freshness-contract.js';
import { WORKSPACE_EXPLAIN_SCHEMA_VERSION } from '../../contracts/workspace-explain-contract.js';
import { WORKSPACE_OPERATIONAL_SKILL_SCHEMA_VERSION } from '../../contracts/workspace-operational-skill-contract.js';
import { WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION } from '../../contracts/workspace-skills-index-contract.js';
import { WORKSPACE_CONTEXT_SCHEMA_VERSION } from '../../workspace-context.js';
import { WORKSPACE_HISTORY_SCHEMA_VERSION } from '../../workspace-history.js';
import {
  WORKSPACE_IMPACT_SCHEMA_VERSION,
  WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
  WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION,
} from '../../workspace-intelligence.js';
import { WORKSPACE_MODEL_SCHEMA_VERSION } from '../../workspace-model.js';
import { WORKSPACE_VERIFY_SCHEMA_VERSION } from '../../workspace-verify.js';
import {
  AGENT_CUSTOMIZATION_PACK_SCHEMA,
  AGENT_REPORTS_INDEX_SCHEMA,
} from '../../workspace-agent-sync.js';
import {
  GOAL_AGENT_HANDOFF_SCHEMA_VERSION,
  GOAL_INDEX_SCHEMA_VERSION,
  GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
  GOAL_PACK_SCHEMA_VERSION,
  GOAL_PLAN_RESULT_SCHEMA_VERSION,
} from '../../goal-pack.js';

const CONTRACT_DIR = path.resolve(process.cwd(), 'contracts', 'workspace-intelligence');

const WORKSPACE_INTELLIGENCE_CONTRACTS = [
  {
    fileName: 'workspace-model.v1.json',
    schemaVersion: WORKSPACE_MODEL_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-model-snapshot.v1.json',
    schemaVersion: WORKSPACE_MODEL_SNAPSHOT_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-model-diff.v1.json',
    schemaVersion: WORKSPACE_MODEL_DIFF_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-impact.v1.json',
    schemaVersion: WORKSPACE_IMPACT_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-context.v1.json',
    schemaVersion: WORKSPACE_CONTEXT_SCHEMA_VERSION,
  },
  {
    fileName: 'fact-freshness.v1.json',
    schemaVersion: FACT_FRESHNESS_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-verify.v1.json',
    schemaVersion: WORKSPACE_VERIFY_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-dependency-graph.v1.json',
    schemaVersion: WORKSPACE_DEPENDENCY_GRAPH_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-operational-skill.v1.json',
    schemaVersion: WORKSPACE_OPERATIONAL_SKILL_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-skills-index.v1.json',
    schemaVersion: WORKSPACE_SKILLS_INDEX_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-explain.v1.json',
    schemaVersion: WORKSPACE_EXPLAIN_SCHEMA_VERSION,
  },
  {
    fileName: 'agent-action-outcome.v1.json',
    schemaVersion: AGENT_ACTION_OUTCOME_SCHEMA_VERSION,
  },
  {
    fileName: 'workspace-intelligence-history.v1.json',
    schemaVersion: WORKSPACE_HISTORY_SCHEMA_VERSION,
  },
  {
    fileName: 'agent-reports-index.v1.json',
    schemaVersion: AGENT_REPORTS_INDEX_SCHEMA,
  },
  {
    fileName: 'agent-customization-pack-report.v1.json',
    schemaVersion: AGENT_CUSTOMIZATION_PACK_SCHEMA,
  },
  {
    fileName: 'goal-pack.v1.json',
    schemaVersion: GOAL_PACK_SCHEMA_VERSION,
  },
  {
    fileName: 'goal-agent-handoff.v1.json',
    schemaVersion: GOAL_AGENT_HANDOFF_SCHEMA_VERSION,
  },
  {
    fileName: 'goal-plan-result.v1.json',
    schemaVersion: GOAL_PLAN_RESULT_SCHEMA_VERSION,
  },
  {
    fileName: 'goal-index.v1.json',
    schemaVersion: GOAL_INDEX_SCHEMA_VERSION,
  },
  {
    fileName: 'goal-lifecycle-result.v1.json',
    schemaVersion: GOAL_LIFECYCLE_RESULT_SCHEMA_VERSION,
  },
] as const;

function readSchema(fileName: string): Record<string, unknown> {
  const filePath = path.join(CONTRACT_DIR, fileName);
  expect(fs.existsSync(filePath), `${fileName} must exist`).toBe(true);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function schemaConst(schema: Record<string, unknown>): string | undefined {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const schemaVersion = properties?.schemaVersion;
  return typeof schemaVersion?.const === 'string' ? schemaVersion.const : undefined;
}

describe('workspace intelligence schema contracts', () => {
  it('pins all workspace intelligence schema versions', () => {
    for (const contract of WORKSPACE_INTELLIGENCE_CONTRACTS) {
      const schema = readSchema(contract.fileName);
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schemaConst(schema)).toBe(contract.schemaVersion);
    }
  });

  it('requires git summary fields on workspace model diff schema', () => {
    const schema = readSchema('workspace-model-diff.v1.json');
    const summary = (schema.properties as Record<string, Record<string, unknown>>).summary;
    const required = summary.required as string[] | undefined;
    expect(required).toEqual(
      expect.arrayContaining([
        'changed',
        'addedProjects',
        'removedProjects',
        'changedProjects',
        'workspaceChanges',
        'validationChanges',
        'gitChangedFiles',
      ])
    );
  });

  it('declares git-aware diff change types', () => {
    const schema = readSchema('workspace-model-diff.v1.json');
    const changes = (schema.properties as Record<string, Record<string, unknown>>).changes;
    const items = changes.items as Record<string, Record<string, unknown>>;
    const changeTypeEnum = (items.properties as Record<string, Record<string, unknown>>).type
      .enum as string[];
    expect(changeTypeEnum).toEqual(
      expect.arrayContaining(['git.file.changed', 'git.untracked', 'git.deleted'])
    );
  });
});
