import { getVersion } from '../update-checker.js';
import { writeGeneratorFile } from '../generators/go-kit-common.js';
import { generateOpenRouterTypeScriptGateway } from './adapters/openrouter/typescript.js';
import { generateOpenRouterPythonGateway } from './adapters/openrouter/python.js';
import {
  MODEL_GATEWAY_CATEGORY,
  MODEL_GATEWAY_KIND,
  type ModelGatewayKitId,
  type ModelGatewayProjectKit,
} from './gateway.js';
import path from 'node:path';
import fsExtra from 'fs-extra';

const PROJECT_KITS: ModelGatewayProjectKit[] = [
  {
    id: 'gateway.openrouter.typescript',
    aliases: [
      'gateway.openrouter.typescript',
      'openrouter.typescript',
      'gateway.openrouter.ts',
      'openrouter-typescript',
    ],
    label: 'OpenRouter · TypeScript',
    runtime: 'node',
    adapterId: 'openrouter-typescript',
    gatewayId: 'openrouter',
    gatewayName: 'OpenRouter',
    requiredEnvironment: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'],
  },
  {
    id: 'gateway.openrouter.python',
    aliases: [
      'gateway.openrouter.python',
      'openrouter.python',
      'gateway.openrouter.py',
      'openrouter-python',
    ],
    label: 'OpenRouter · Python',
    runtime: 'python',
    adapterId: 'openrouter-python',
    gatewayId: 'openrouter',
    gatewayName: 'OpenRouter',
    requiredEnvironment: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'],
  },
];

export function describeModelGatewayProjectKits(): ModelGatewayProjectKit[] {
  return PROJECT_KITS.map((kit) => structuredClone(kit));
}

export function listModelGatewayProjectKits(): ModelGatewayProjectKit[] {
  return describeModelGatewayProjectKits();
}

export function lookupModelGatewayProjectKit(
  value: string | undefined
): ModelGatewayProjectKit | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const kit = PROJECT_KITS.find(
    (candidate) =>
      candidate.id === normalized ||
      candidate.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
  return kit ? structuredClone(kit) : null;
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
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const version = getVersion();
  await fsExtra.ensureDir(input.projectPath);

  if (input.kit.id === 'gateway.openrouter.typescript') {
    await generateOpenRouterTypeScriptGateway({
      projectPath: input.projectPath,
      projectName: input.projectName,
    });
  } else if (input.kit.id === 'gateway.openrouter.python') {
    await generateOpenRouterPythonGateway({
      projectPath: input.projectPath,
      projectName: input.projectName,
    });
  } else {
    const unsupported: never = input.kit.id;
    throw new Error(`Unsupported model gateway kit: ${unsupported}`);
  }

  await writeGeneratorFile(
    path.join(input.projectPath, '.workspai', 'context.json'),
    `${JSON.stringify(
      {
        engine: input.kit.runtime === 'python' ? 'pip' : 'npm',
        runtime: input.kit.runtime,
        framework: input.kit.gatewayId,
        kind: MODEL_GATEWAY_KIND,
        category: MODEL_GATEWAY_CATEGORY,
        kit: input.kit.id,
      },
      null,
      2
    )}\n`
  );
  await writeGeneratorFile(
    path.join(input.projectPath, '.workspai', 'project.json'),
    `${JSON.stringify(
      {
        schema_version: '1.0',
        name: input.projectName,
        slug: input.projectName,
        kind: MODEL_GATEWAY_KIND,
        project_type: MODEL_GATEWAY_KIND,
        category: MODEL_GATEWAY_CATEGORY,
        runtime: input.kit.runtime,
        framework: input.kit.gatewayId,
        framework_display_name: input.kit.gatewayName,
        kit_name: input.kit.id,
        kit: input.kit.id,
        engine: input.kit.runtime === 'python' ? 'pip' : 'npm',
        support_tier: 'extended',
        module_support: false,
        modules: [],
        workspai_version: version,
        rapidkit_version: version,
        generated_by: 'workspai',
        generated_at: generatedAt,
        contracts: {
          owns: ['model-gateway'],
          apis: [],
          publishes: [],
          consumes: ['openrouter'],
          dependsOn: [],
          env: [...input.kit.requiredEnvironment],
        },
      },
      null,
      2
    )}\n`
  );
}

export function isModelGatewayKitId(value: string): value is ModelGatewayKitId {
  return value === 'gateway.openrouter.typescript' || value === 'gateway.openrouter.python';
}
