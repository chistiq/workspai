export function buildScaleEnvelope(configuration) {
  const locatorPrefix = 'proof/source/';
  const evidence = Array.from({ length: configuration.evidenceCount }, (_, index) => {
    const indexText = String(index).padStart(8, '0');
    const suffixLength = Math.max(
      1,
      configuration.locatorLength - locatorPrefix.length - indexText.length - 1
    );
    return {
      id: `evidence:${configuration.id}:${indexText}`,
      sourceKind: 'source',
      relativeLocator: `${locatorPrefix}${indexText}/${'x'.repeat(suffixLength)}`,
    };
  });

  return {
    specVersion: 'wis-candidate',
    coreVersion: '0.2.0-draft',
    schemaId: 'https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft',
    profile: { id: 'wis.profile.scale-fixture', version: '0.1.0-draft' },
    producer: { id: 'scale-fixture-producer', version: '1.0.0' },
    operation: `validate-${configuration.id}`,
    operationOutcome: 'succeeded',
    scope: { kind: 'workspace', workspaceId: 'workspace:scale-fixture' },
    generation: {
      id: `generation:${configuration.id}:1`,
      generatedAt: '2026-08-14T00:00:00.000Z',
    },
    status: 'pass',
    payload: { workload: configuration.id, deterministic: true },
    evidence,
    freshness: { status: 'current', evaluatedAt: '2026-08-14T00:00:00.000Z' },
    unknowns: [],
    omissions: [],
    diagnostics: [],
    compatibility: { status: 'compatible' },
  };
}

export function toPreviousScaleEnvelope(current) {
  const {
    operationOutcome: _operationOutcome,
    status,
    compatibility: _compatibility,
    ...rest
  } = structuredClone(current);
  return {
    ...rest,
    coreVersion: '0.1.0-draft',
    schemaId: 'https://schemas.workspai.dev/wis/core/result-envelope/0.1.0-draft',
    outcome: status,
  };
}
