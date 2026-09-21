import path from 'node:path';

import fsExtra from 'fs-extra';

import { writeGeneratorFile } from '../generators/go-kit-common.js';
import { getVersion } from '../update-checker.js';
import { MODEL_GATEWAY_CATEGORY, MODEL_GATEWAY_KIND } from './gateway.js';
import type { ModelGatewayProjectKit } from './gateway.js';

export const MODEL_GATEWAY_UNSUPPORTED_CAPABILITIES = Object.freeze({
  chat: true,
  stream: true,
  tools: false,
  agents: false,
  embeddings: false,
  images: false,
  audio: false,
  structuredOutput: false,
  attach: false,
});

export const MODEL_GATEWAY_LIFECYCLE_STAGES = ['init', 'test', 'build', 'start'] as const;

export const MODEL_GATEWAY_REQUIRED_FILES = Object.freeze({
  'gateway.openrouter.typescript': Object.freeze([
    'package.json',
    'tsconfig.json',
    'gateway.policy.json',
    '.env.example',
    '.gitignore',
    'README.md',
    'src/redact.ts',
    'src/errors.ts',
    'src/port.ts',
    'src/config.ts',
    'src/openrouter-gateway.ts',
    'src/main.ts',
    'src/index.ts',
    'tests/gateway.test.ts',
    '.workspai/project.json',
    '.workspai/context.json',
  ]),
  'gateway.openrouter.python': Object.freeze([
    'pyproject.toml',
    'gateway.policy.json',
    '.env.example',
    '.gitignore',
    'README.md',
    'main.py',
    'src/model_gateway/__init__.py',
    'src/model_gateway/redact.py',
    'src/model_gateway/errors.py',
    'src/model_gateway/port.py',
    'src/model_gateway/config.py',
    'src/model_gateway/gateway.py',
    'src/model_gateway/main.py',
    'tests/test_gateway.py',
    '.workspai/project.json',
    '.workspai/context.json',
  ]),
});

export function renderGeneratedLines(value: readonly string[]): string {
  return `${value.join('\n')}\n`;
}

export function renderOpenRouterEnvExample(input: {
  attributionComment: readonly string[];
  refererName: string;
  titleName: string;
}): string {
  return renderGeneratedLines([
    '# Required. Server-side only. Never expose this value to browsers, frontend',
    '# environment prefixes, client bundles, or committed files.',
    'OPENROUTER_API_KEY=',
    '',
    '# Required. Choose a model slug at runtime. Workspai does not select a billable',
    '# model for you. List current slugs at https://openrouter.ai/models',
    'OPENROUTER_MODEL=',
    '',
    ...input.attributionComment,
    `${input.refererName}=`,
    `${input.titleName}=`,
    '',
    '# Optional timeout in milliseconds. Defaults to 30000 when omitted.',
    'OPENROUTER_TIMEOUT_MS=',
  ]);
}

export async function writeGatewayWorkspaiMetadata(input: {
  projectPath: string;
  projectName: string;
  kit: ModelGatewayProjectKit;
  generatedAt?: string;
}): Promise<void> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const version = getVersion();
  const engine = input.kit.runtime === 'python' ? 'pip' : 'npm';
  await fsExtra.ensureDir(input.projectPath);
  await writeGeneratorFile(
    path.join(input.projectPath, '.workspai', 'context.json'),
    `${JSON.stringify(
      {
        engine,
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
        engine,
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
          consumes: input.kit.gatewayId ? [input.kit.gatewayId] : [],
          dependsOn: [],
          env: [...input.kit.requiredEnvironment],
        },
      },
      null,
      2
    )}\n`
  );
}
