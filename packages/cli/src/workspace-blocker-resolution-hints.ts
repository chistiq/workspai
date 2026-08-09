import {
  BLOCKER_RESOLUTION_SCHEMA_VERSION,
  computeBlockerSignature,
  type BlockerResolution,
  type BlockerResolutionClass,
} from './contracts/blocker-resolution-contract.js';

export function inferResolutionClassFromBlockerReason(reason: string): BlockerResolutionClass {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) {
    return 'unresolvable-without-human';
  }
  if (
    normalized.includes('missing evidence') ||
    normalized.includes(': missing') ||
    normalized.includes('artifact missing') ||
    normalized.includes('not found on disk')
  ) {
    return 'artifact-missing';
  }
  if (normalized.includes('policy.') || normalized.includes('contract')) {
    return 'config-fixable';
  }
  if (
    normalized.includes('impact') ||
    normalized.includes('untracked') ||
    normalized.includes('grounding')
  ) {
    return 'semantic-attention';
  }
  if (
    normalized.includes('failed') ||
    normalized.includes('blocked') ||
    normalized.includes(': fail')
  ) {
    return 'command-failed-repeat';
  }
  return 'config-fixable';
}

export function buildResolutionHintForBlocker(input: {
  reason: string;
  blockerId: string;
  sourceCommand?: string;
  sourceArtifact?: string;
  verifyCommand?: string;
  verifyArtifact?: string;
}): BlockerResolution {
  const resolutionClass = inferResolutionClassFromBlockerReason(input.reason);
  const blockerSignature = computeBlockerSignature({ blockers: [input.reason] });
  const fixHints =
    resolutionClass === 'artifact-missing'
      ? [
          {
            actionKind: 'run-once' as const,
            detail: input.sourceCommand
              ? `Run the source command once: ${input.sourceCommand}`
              : 'Run the mapped workspace intelligence command once to generate the missing artifact.',
            // An exact producer command is authoritative. Do not attach the
            // generic Analyze shortcut to evidence owned by another producer
            // (for example workspace-run, Doctor, or readiness).
            ...(input.sourceCommand ? {} : { studioActionId: 'run-analyze' as const }),
          },
        ]
      : resolutionClass === 'semantic-attention'
        ? [
            {
              actionKind: 'commit-files' as const,
              detail:
                'Review workspace-level grounding files (AGENTS.md, agent-sync outputs) and commit or refresh the impact baseline.',
            },
            {
              actionKind: 'refresh-baseline' as const,
              detail: 'Refresh snapshot + diff + impact before re-running verify.',
            },
          ]
        : [
            {
              actionKind: 'edit-file' as const,
              detail:
                'Apply the smallest safe file or policy fix for this blocker before re-running verification.',
              studioActionId: 'fix-lens' as const,
            },
          ];

  return {
    schemaVersion: BLOCKER_RESOLUTION_SCHEMA_VERSION,
    blockerId: input.blockerId,
    sourceCommand: input.sourceCommand,
    sourceArtifact: input.sourceArtifact,
    resolutionClass,
    blockerSignature,
    commandRetryHint:
      resolutionClass === 'artifact-missing'
        ? input.sourceCommand
          ? `Run the source command once: ${input.sourceCommand}, then verify.`
          : 'Run the source command once, then verify.'
        : 'Do not re-run the same failing command; fix the source issue first, then verify.',
    fixHints,
    verifyCommand: input.verifyCommand,
    verifyArtifact: input.verifyArtifact,
  };
}

export function buildResolutionHintsForBlockingReasons(input: {
  blockingReasons: string[];
  sourceCommand?: string;
  sourceArtifact?: string;
  verifyCommand?: string;
  verifyArtifact?: string;
}): BlockerResolution[] {
  const unique = Array.from(
    new Set(input.blockingReasons.map((reason) => reason.trim()).filter(Boolean))
  ).slice(0, 12);

  return unique.map((reason, index) =>
    buildResolutionHintForBlocker({
      reason,
      blockerId: `blocker-${index + 1}`,
      sourceCommand: input.sourceCommand,
      sourceArtifact: input.sourceArtifact,
      verifyCommand: input.verifyCommand,
      verifyArtifact: input.verifyArtifact,
    })
  );
}
