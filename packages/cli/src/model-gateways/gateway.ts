import type { ModelGatewayBaselineRuntime } from './version-policy.js';

export const MODEL_GATEWAY_KIND = 'gateway' as const;
export const MODEL_GATEWAY_CATEGORY = 'gateway' as const;

export type ModelGatewayId = 'openrouter';
export type ModelGatewayRuntime = ModelGatewayBaselineRuntime;

export type ModelGatewayKitId = 'gateway.openrouter.typescript' | 'gateway.openrouter.python';

export type ModelGatewayProjectKit = {
  id: ModelGatewayKitId;
  aliases: string[];
  label: string;
  runtime: ModelGatewayRuntime;
  adapterId: string;
  gatewayId: ModelGatewayId;
  gatewayName: string;
  requiredEnvironment: string[];
};

export function npmSafeName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '')
      .slice(0, 64) || 'openrouter-gateway'
  );
}

export function pythonDistributionName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'openrouter-gateway'
  );
}
