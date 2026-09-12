export interface ScaleWorkloadConfiguration {
  readonly id: string;
  readonly evidenceCount: number;
  readonly locatorLength: number;
}

export function buildScaleEnvelope(
  configuration: ScaleWorkloadConfiguration
): Record<string, unknown>;
export function toPreviousScaleEnvelope(current: Record<string, unknown>): Record<string, unknown>;
