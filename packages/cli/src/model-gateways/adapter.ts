import type { ModelGatewayRuntime } from './gateway.js';
import {
  MODEL_GATEWAY_LIFECYCLE_STAGES,
  MODEL_GATEWAY_UNSUPPORTED_CAPABILITIES,
} from './generated.js';

export type ModelGatewayGenerateInput = {
  projectPath: string;
  projectName: string;
};

export type ModelGatewayAdapter = {
  id: string;
  gatewayId: string;
  gatewayName: string;
  kitId: string;
  aliases: readonly string[];
  label: string;
  runtime: ModelGatewayRuntime;
  requiredEnvironment: readonly string[];
  versionBaselineId: string;
  capabilities: typeof MODEL_GATEWAY_UNSUPPORTED_CAPABILITIES;
  lifecycle: { readonly stages: readonly (typeof MODEL_GATEWAY_LIFECYCLE_STAGES)[number][] };
  attach: 'unsupported';
  generate: (input: ModelGatewayGenerateInput) => Promise<void>;
};

export function cloneAdapterView(
  adapter: ModelGatewayAdapter
): Omit<ModelGatewayAdapter, 'generate'> {
  return Object.freeze({
    id: adapter.id,
    gatewayId: adapter.gatewayId,
    gatewayName: adapter.gatewayName,
    kitId: adapter.kitId,
    aliases: Object.freeze([...adapter.aliases]),
    label: adapter.label,
    runtime: adapter.runtime,
    requiredEnvironment: Object.freeze([...adapter.requiredEnvironment]),
    versionBaselineId: adapter.versionBaselineId,
    capabilities: MODEL_GATEWAY_UNSUPPORTED_CAPABILITIES,
    lifecycle: Object.freeze({ stages: Object.freeze([...adapter.lifecycle.stages]) }),
    attach: 'unsupported',
  });
}
