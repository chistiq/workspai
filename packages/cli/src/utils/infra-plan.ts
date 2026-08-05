import path from 'path';
import { existsSync } from 'fs';
import fsExtra from 'fs-extra';

import { discoverWorkspaceInfraNeeds } from './infra-discovery.js';
import {
  INFRA_COMPOSE_RELATIVE_PATH,
  INFRA_ENV_EXAMPLE_RELATIVE_PATH,
  INFRA_PLAN_RELATIVE_PATH,
  INFRA_PLAN_SCHEMA_VERSION,
  type InfraPlan,
  type InfraPlannedService,
  loadInfraStackContract,
  mergeConnectionEnv,
} from './infra-stack.js';
import { renderInfraComposeYaml } from './infra-compose.js';
import { collectWorkspaceInfraConnectionDefaults, parsePostgresServiceEnv } from './infra-env.js';
import { firstExistingWorkspaceArtifactPath } from './artifact-path-compat.js';
import { workspaceMetadataCandidates } from './workspace-paths.js';
import { assertJsonSchemaContract } from './json-schema-contract.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';

function sourceTargetsService(
  source: { kind: string; value: string },
  serviceId: string,
  contract: ReturnType<typeof loadInfraStackContract>
): boolean {
  if (source.kind === 'override') {
    return source.value === serviceId;
  }
  if (source.kind === 'module') {
    return contract.moduleMappings[source.value]?.includes(serviceId) ?? false;
  }
  return contract.envVarMappings[source.value.toUpperCase()]?.includes(serviceId) ?? false;
}

function detectPortConflicts(services: InfraPlannedService[]): string[] {
  const seen = new Map<number, string>();
  const warnings: string[] = [];

  for (const service of services) {
    for (const port of service.ports) {
      const existing = seen.get(port.host);
      if (existing && existing !== service.id) {
        warnings.push(
          `Port collision on host ${port.host} between services '${existing}' and '${service.id}'`
        );
      } else {
        seen.set(port.host, service.id);
      }
    }
  }

  return warnings;
}

async function readWorkspaceName(workspacePath: string): Promise<string | undefined> {
  const workspaceJsonPath = workspaceMetadataCandidates(workspacePath, 'workspace.json').find(
    (candidate) => existsSync(candidate)
  );
  if (!workspaceJsonPath) {
    return undefined;
  }

  try {
    const payload = (await fsExtra.readJson(workspaceJsonPath)) as {
      workspace_name?: string;
      name?: string;
    };
    return payload.workspace_name || payload.name;
  } catch {
    return undefined;
  }
}

export async function buildInfraPlan(input: {
  workspacePath: string;
  now?: () => Date;
}): Promise<InfraPlan> {
  const workspacePath = path.resolve(input.workspacePath);
  const contract = loadInfraStackContract();
  const discovery = await discoverWorkspaceInfraNeeds({ workspacePath, contract });

  const services: InfraPlannedService[] = discovery.serviceIds
    .map((serviceId) => {
      const definition = contract.services[serviceId];
      if (!definition) {
        return null;
      }

      return {
        id: serviceId,
        displayName: definition.displayName,
        category: definition.category,
        image: definition.image,
        ports: definition.ports,
        sources: discovery.sources.filter((source) =>
          sourceTargetsService(source, serviceId, contract)
        ),
      } satisfies InfraPlannedService;
    })
    .filter((service): service is InfraPlannedService => service !== null);

  const warnings = detectPortConflicts(services);
  if (services.length === 0) {
    warnings.push(
      'No infrastructure services detected. Install modules with infra dependencies or add .workspai/infra/overrides.json'
    );
  }

  for (const overrideId of discovery.overrides) {
    if (!contract.services[overrideId]) {
      warnings.push(`Override references unknown service '${overrideId}'`);
    }
  }

  const contractPath = (await firstExistingWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract
  ))
    ? WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract
    : undefined;

  const contractConnectionEnv = mergeConnectionEnv(contract, discovery.serviceIds);
  const workspaceConnectionEnv = await collectWorkspaceInfraConnectionDefaults({
    workspacePath,
    contract,
  });
  const connectionEnv = { ...contractConnectionEnv, ...workspaceConnectionEnv };
  if (workspaceConnectionEnv.RAPIDKIT_DB_POSTGRES_URL) {
    connectionEnv.DATABASE_URL = workspaceConnectionEnv.RAPIDKIT_DB_POSTGRES_URL;
  }

  const serviceEnvOverrides: Record<string, Record<string, string>> = {};
  const postgresEnv = parsePostgresServiceEnv(connectionEnv);
  if (postgresEnv && discovery.serviceIds.includes('postgres')) {
    serviceEnvOverrides.postgres = postgresEnv;
  }

  return {
    schemaVersion: INFRA_PLAN_SCHEMA_VERSION,
    generatedAt: (input.now || (() => new Date()))().toISOString(),
    workspacePath,
    workspaceName: await readWorkspaceName(workspacePath),
    contractPath,
    strategy: 'sidecar',
    composePath: INFRA_COMPOSE_RELATIVE_PATH,
    envExamplePath: INFRA_ENV_EXAMPLE_RELATIVE_PATH,
    services,
    connectionEnv,
    serviceEnvOverrides:
      Object.keys(serviceEnvOverrides).length > 0 ? serviceEnvOverrides : undefined,
    sources: {
      modules: discovery.modules,
      envVars: discovery.envVars,
      overrides: discovery.overrides,
    },
    warnings,
  };
}

export async function writeInfraArtifacts(input: {
  workspacePath: string;
  plan: InfraPlan;
  dryRun?: boolean;
}): Promise<{ composePath: string; planPath: string; envExamplePath: string }> {
  const workspacePath = path.resolve(input.workspacePath);
  const composePath = path.join(workspacePath, INFRA_COMPOSE_RELATIVE_PATH);
  const planPath = path.join(workspacePath, INFRA_PLAN_RELATIVE_PATH);
  const envExamplePath = path.join(workspacePath, INFRA_ENV_EXAMPLE_RELATIVE_PATH);
  const contract = loadInfraStackContract();
  assertJsonSchemaContract(
    input.plan,
    'contracts/infra-plan.v1.json',
    'Workspai infrastructure plan'
  );

  const composeYaml = renderInfraComposeYaml({
    plan: input.plan,
    contract,
    workspaceName: input.plan.workspaceName || path.basename(workspacePath),
  });

  const envExample = [
    '# Generated by: npx workspai infra plan',
    '# Copy values into project .env files as needed.',
    ...Object.entries(input.plan.connectionEnv).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');

  if (input.dryRun) {
    return {
      composePath,
      planPath,
      envExamplePath,
    };
  }

  await fsExtra.ensureDir(path.dirname(composePath));
  await fsExtra.ensureDir(path.dirname(planPath));
  await fsExtra.writeFile(composePath, composeYaml, 'utf-8');
  await fsExtra.writeFile(planPath, `${JSON.stringify(input.plan, null, 2)}\n`, 'utf-8');
  await fsExtra.writeFile(envExamplePath, envExample, 'utf-8');

  return { composePath, planPath, envExamplePath };
}
