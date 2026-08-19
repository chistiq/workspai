import {
  WORKSPACE_INTELLIGENCE_ARTIFACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from './workspace-intelligence-runtime-registry.js';

export const STUDIO_CARD_REPAIR_CAPABILITIES_SCHEMA_VERSION =
  'workspai.studio-card-repair-capabilities.v1' as const;

export type StudioCardRepairCapability = {
  cardId: string;
  scope: 'workspace' | 'project';
  producerCommand: string;
  producerArtifact: string;
  verifyCommand: string;
  verifyArtifact: string;
  aggregateVerifyCommand: 'npx workspai workspace verify --json';
  targetClosure: 'exact-producer-and-causal-action-set';
  workspacePosture: 'reported-separately';
  repairPolicy: 'diagnose-and-repair' | 'source-repair-then-produce' | 'refresh-producer';
  remediationArtifacts: string[];
};

const AGGREGATE_VERIFY_COMMAND = 'npx workspai workspace verify --json' as const;
const A = WORKSPACE_INTELLIGENCE_ARTIFACTS;
const S = WORKSPACE_SUPPLEMENTAL_ARTIFACTS;

function capability(
  cardId: string,
  producerCommand: string,
  producerArtifact: string,
  options: {
    scope?: StudioCardRepairCapability['scope'];
    repairPolicy?: StudioCardRepairCapability['repairPolicy'];
    remediationArtifacts?: string[];
  } = {}
): StudioCardRepairCapability {
  return {
    cardId,
    scope: options.scope ?? 'workspace',
    producerCommand,
    producerArtifact,
    verifyCommand: producerCommand,
    verifyArtifact: producerArtifact,
    aggregateVerifyCommand: AGGREGATE_VERIFY_COMMAND,
    targetClosure: 'exact-producer-and-causal-action-set',
    workspacePosture: 'reported-separately',
    repairPolicy: options.repairPolicy ?? 'refresh-producer',
    remediationArtifacts: options.remediationArtifacts ?? [],
  };
}

/**
 * Canonical repair and verification ownership for every dashboard evidence card.
 *
 * A blocked card must be re-produced and verified by its own producer before the
 * aggregate Workspace Verify gate is allowed to close the repair. Consumers must
 * not substitute Doctor or Workspace Verify for a missing card producer.
 * `repairPolicy` selects the safest contract-owned first action; it never removes
 * the consumer's governed source-repair capability when that action leaves the
 * exact card blocked.
 */
export const STUDIO_CARD_REPAIR_CAPABILITIES: readonly StudioCardRepairCapability[] = [
  capability('doctor', 'npx workspai doctor workspace --json', A.doctor, {
    repairPolicy: 'diagnose-and-repair',
    remediationArtifacts: [S.doctorRemediationPlan, S.artifactRemediationPlan],
  }),
  capability('projectDoctor', 'npx workspai doctor project --json', S.doctorProject, {
    scope: 'project',
    repairPolicy: 'diagnose-and-repair',
    remediationArtifacts: [S.doctorRemediationPlan, S.artifactRemediationPlan],
  }),
  capability('pipeline', 'npx workspai pipeline --json --strict', S.pipelineLastRun, {
    repairPolicy: 'source-repair-then-produce',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability('analyze', 'npx workspai analyze --json', A.analyze, {
    repairPolicy: 'source-repair-then-produce',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability('readiness', 'npx workspai readiness --json', A.readiness, {
    repairPolicy: 'source-repair-then-produce',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability('bootstrap', 'npx workspai bootstrap --ci --json', S.bootstrapCompliance, {
    repairPolicy: 'source-repair-then-produce',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability('workspaceSync', 'npx workspai workspace sync --json', S.workspaceRegistry),
  capability(
    'foundation',
    'npx workspai workspace foundation ensure --json',
    '.workspai/workspace.json'
  ),
  capability(
    'contract',
    'npx workspai workspace contract verify --strict --json',
    A.contractVerify,
    {
      repairPolicy: 'source-repair-then-produce',
    }
  ),
  capability('autopilot', 'npx workspai autopilot release --json', S.autopilotReleaseLastRun, {
    repairPolicy: 'source-repair-then-produce',
  }),
  capability('workspaceRun', 'npx workspai workspace run test --json', S.workspaceRunLast, {
    repairPolicy: 'source-repair-then-produce',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability('setup', 'npx workspai setup --json', '.workspai/toolchain.lock', {
    repairPolicy: 'source-repair-then-produce',
  }),
  capability('importReadiness', 'npx workspai doctor project --json', S.doctorProject, {
    scope: 'project',
    repairPolicy: 'diagnose-and-repair',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability(
    'snapshot',
    'npx workspai snapshot create --json',
    '.workspai/reports/snapshot-last-run.json'
  ),
  capability('workspaceModel', 'npx workspai workspace model --json --write', A.model),
  capability('intelligenceSnapshot', 'npx workspai workspace snapshot --json', A.snapshot),
  capability('workspaceDiff', `npx workspai workspace diff --from ${A.snapshot} --json`, A.diff),
  capability('workspaceImpact', `npx workspai workspace impact --from ${A.diff} --json`, A.impact),
  capability(
    'workspaceIntelligenceRun',
    'npx workspai workspace intelligence run --for-agent generic --strict --json',
    A.intelligenceRun,
    {
      repairPolicy: 'source-repair-then-produce',
    }
  ),
  capability('workspaceVerify', AGGREGATE_VERIFY_COMMAND, A.verify, {
    repairPolicy: 'source-repair-then-produce',
    remediationArtifacts: [S.artifactRemediationPlan],
  }),
  capability(
    'workspaceExplain',
    'npx workspai workspace explain release-blocked --json --write',
    A.explain
  ),
  capability(
    'workspaceWhy',
    'npx workspai workspace why release-blocked --json --write',
    S.workspaceWhy
  ),
  capability(
    'workspaceTrace',
    `npx workspai workspace trace --from ${A.diff} --json --write`,
    S.workspaceTrace
  ),
  capability('workspaceWatch', 'npx workspai workspace watch --once --json', A.model),
  capability(
    'workspaceContextAgent',
    'npx workspai workspace context --for-agent --json --write',
    A.agentContext
  ),
  capability(
    'agentGrounding',
    'npx workspai workspace agent-sync --write --refresh-context --json --preset enterprise --target vscode',
    A.agentCustomizationPack
  ),
  capability(
    'share',
    `npx workspai workspace share --output ${S.workspaceShareBundle} --json`,
    S.workspaceShareBundle
  ),
  capability(
    'archive',
    'npx workspai workspace export --output team-workspace.workspai-archive.zip --json',
    '.workspai/archive-manifest.json'
  ),
  capability('mirror', 'npx workspai mirror status --json', S.mirrorOps),
  capability('cache', 'npx workspai cache status --json', '.workspai/cache-config.yml'),
  capability('policy', 'npx workspai workspace policy show --json', '.workspai/policies.yml', {
    repairPolicy: 'source-repair-then-produce',
  }),
  capability('infra', 'npx workspai infra plan --json', S.infraPlan, {
    repairPolicy: 'source-repair-then-produce',
  }),
] as const;

export function buildStudioCardRepairCapabilitiesContract() {
  return {
    schemaVersion: STUDIO_CARD_REPAIR_CAPABILITIES_SCHEMA_VERSION,
    invariant:
      'A card repair starts with its declared repairPolicy but every unresolved policy path transfers to governed causal source repair. It closes only after its exact producer refreshes, its selected causal action set is absent, and aggregate Workspace Verify completes without an execution failure. Unrelated workspace blockers are reported separately and do not reopen the selected card.',
    cards: STUDIO_CARD_REPAIR_CAPABILITIES,
  };
}
