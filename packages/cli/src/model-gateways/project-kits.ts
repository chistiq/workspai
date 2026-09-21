import { openRouterPythonAdapter } from './adapters/openrouter/python.js';
import { openRouterTypeScriptAdapter } from './adapters/openrouter/typescript.js';
import { writeGatewayWorkspaiMetadata } from './generated.js';
import { type ModelGatewayKitId, type ModelGatewayProjectKit } from './gateway.js';
import { createModelGatewayRegistry } from './registry.js';

const builtinRegistry = createModelGatewayRegistry([
  openRouterTypeScriptAdapter,
  openRouterPythonAdapter,
]);

export const BUILTIN_MODEL_GATEWAY_REGISTRY = builtinRegistry;

export function describeModelGatewayProjectKits(): ModelGatewayProjectKit[] {
  return builtinRegistry.listKits();
}

export function listModelGatewayProjectKits(): ModelGatewayProjectKit[] {
  return describeModelGatewayProjectKits();
}

export function lookupModelGatewayProjectKit(
  value: string | undefined
): ModelGatewayProjectKit | null {
  return builtinRegistry.lookupKit(value);
}

export function resolveModelGatewayProjectKit(
  value: string | undefined
): ModelGatewayProjectKit | null {
  return lookupModelGatewayProjectKit(value);
}

export function isModelGatewayProjectKit(value: string | undefined): boolean {
  return lookupModelGatewayProjectKit(value) !== null;
}

export async function generateModelGatewayProject(input: {
  projectPath: string;
  projectName: string;
  kit: ModelGatewayProjectKit;
  generatedAt?: string;
}): Promise<void> {
  await builtinRegistry.generate({
    projectPath: input.projectPath,
    projectName: input.projectName,
    kit: input.kit,
  });
  await writeGatewayWorkspaiMetadata(input);
}

export function isModelGatewayKitId(value: string): value is ModelGatewayKitId {
  return value === 'gateway.openrouter.typescript' || value === 'gateway.openrouter.python';
}
