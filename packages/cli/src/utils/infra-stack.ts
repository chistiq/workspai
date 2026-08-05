import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS,
  WORKSPACE_SUPPLEMENTAL_ARTIFACTS,
} from '../contracts/workspace-intelligence-runtime-registry.js';

export const INFRA_STACK_SCHEMA_VERSION = 'rapidkit.infra-stack.v1';
export const INFRA_PLAN_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.infraPlan.schemaVersion;
export const INFRA_COMPOSE_RELATIVE_PATH = '.workspai/infra/docker-compose.yml';
export const INFRA_PLAN_RELATIVE_PATH = WORKSPACE_SUPPLEMENTAL_ARTIFACTS.infraPlan;
export const INFRA_ENV_EXAMPLE_RELATIVE_PATH = '.workspai/infra/.env.example';

export interface InfraServicePort {
  name: string;
  host: number;
  container: number;
}

export interface InfraServiceHealthcheck {
  test: string[];
  interval: string;
  timeout: string;
  retries: number;
}

export interface InfraServiceDefinition {
  displayName: string;
  category: string;
  image: string;
  ports: InfraServicePort[];
  env?: Record<string, string>;
  command?: string[];
  volumes?: string[];
  healthcheck?: InfraServiceHealthcheck;
  connectionEnv: Record<string, string>;
}

export interface InfraStackContract {
  schemaVersion: typeof INFRA_STACK_SCHEMA_VERSION;
  description: string;
  futureProfiles?: string[];
  services: Record<string, InfraServiceDefinition>;
  moduleMappings: Record<string, string[]>;
  envVarMappings: Record<string, string[]>;
}

export interface InfraDiscoverySource {
  kind: 'module' | 'env-var' | 'override' | 'contract-env';
  value: string;
  project?: string;
}

export interface InfraPlannedService {
  id: string;
  displayName: string;
  category: string;
  image: string;
  ports: InfraServicePort[];
  sources: InfraDiscoverySource[];
}

export interface InfraPlan {
  schemaVersion: typeof INFRA_PLAN_SCHEMA_VERSION;
  generatedAt: string;
  workspacePath: string;
  workspaceName?: string;
  contractPath?: string;
  strategy: 'sidecar';
  composePath: string;
  envExamplePath: string;
  services: InfraPlannedService[];
  connectionEnv: Record<string, string>;
  sources: {
    modules: string[];
    envVars: string[];
    overrides: string[];
  };
  warnings: string[];
  serviceEnvOverrides?: Record<string, Record<string, string>>;
}

export function resolveInfraStackContractPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, '../../contracts/infra-stack.v1.json'),
    path.join(moduleDir, '../contracts/infra-stack.v1.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Infra stack contract not found. Expected contracts/infra-stack.v1.json beside the rapidkit package root. Checked: ${candidates.join(', ')}`
  );
}

let cachedContract: InfraStackContract | null = null;

export function loadInfraStackContract(customPath?: string): InfraStackContract {
  if (!customPath && cachedContract) {
    return cachedContract;
  }

  const contractPath = customPath || resolveInfraStackContractPath();
  const raw = fs.readFileSync(contractPath, 'utf-8');
  const parsed = JSON.parse(raw) as InfraStackContract;

  if (parsed.schemaVersion !== INFRA_STACK_SCHEMA_VERSION) {
    throw new Error(`Unsupported infra stack schema: ${parsed.schemaVersion}`);
  }

  validateInfraStackContract(parsed);

  if (!customPath) {
    cachedContract = parsed;
  }

  return parsed;
}

function validateInfraStackContract(parsed: InfraStackContract): void {
  const serviceIds = new Set(Object.keys(parsed.services));

  for (const [moduleSlug, mappedServices] of Object.entries(parsed.moduleMappings)) {
    if (!Array.isArray(mappedServices)) {
      throw new Error(`Invalid moduleMappings entry for ${moduleSlug}`);
    }
    for (const serviceId of mappedServices) {
      if (!serviceIds.has(serviceId)) {
        throw new Error(`moduleMappings/${moduleSlug} references unknown service '${serviceId}'`);
      }
    }
  }

  for (const [envVar, mappedServices] of Object.entries(parsed.envVarMappings)) {
    if (!Array.isArray(mappedServices)) {
      throw new Error(`Invalid envVarMappings entry for ${envVar}`);
    }
    for (const serviceId of mappedServices) {
      if (!serviceIds.has(serviceId)) {
        throw new Error(`envVarMappings/${envVar} references unknown service '${serviceId}'`);
      }
    }
  }
}

export function resolveServicesFromModuleSlug(
  contract: InfraStackContract,
  moduleSlug: string
): string[] {
  const normalized = moduleSlug.startsWith('free/') ? moduleSlug : `free/${moduleSlug}`;
  return contract.moduleMappings[normalized] || [];
}

export function resolveServicesFromEnvVar(contract: InfraStackContract, envVar: string): string[] {
  return contract.envVarMappings[envVar.toUpperCase()] || [];
}

export function mergeConnectionEnv(
  contract: InfraStackContract,
  serviceIds: string[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const serviceId of serviceIds) {
    const service = contract.services[serviceId];
    if (!service) continue;
    Object.assign(merged, service.connectionEnv);
  }
  return merged;
}

export function listKnownInfraServiceIds(contract: InfraStackContract): string[] {
  return Object.keys(contract.services).sort();
}
