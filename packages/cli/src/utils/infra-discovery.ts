import path from 'path';
import { existsSync } from 'fs';
import fsExtra from 'fs-extra';

import { discoverProjectJsonFiles } from './workspace-contract.js';
import type { RegistryInstalledModule } from './module-layout.js';
import type { InfraDiscoverySource, InfraStackContract } from './infra-stack.js';
import {
  loadInfraStackContract,
  resolveServicesFromEnvVar,
  resolveServicesFromModuleSlug,
} from './infra-stack.js';
import { firstExistingWorkspaceArtifactPath } from './artifact-path-compat.js';
import { workspaceMetadataCandidates } from './workspace-paths.js';
import { WORKSPACE_SUPPLEMENTAL_ARTIFACTS } from '../contracts/workspace-intelligence-runtime-registry.js';

export interface InfraDiscoveryResult {
  modules: string[];
  envVars: string[];
  overrides: string[];
  sources: InfraDiscoverySource[];
  serviceIds: string[];
}

async function readRegistryModules(projectRoot: string): Promise<string[]> {
  const registryPath = path.join(projectRoot, 'registry.json');
  if (!(await fsExtra.pathExists(registryPath))) {
    return [];
  }

  try {
    const registry = (await fsExtra.readJson(registryPath)) as {
      installed_modules?: RegistryInstalledModule[];
    };
    const modules = registry.installed_modules || [];
    return [
      ...new Set(
        modules
          .map((item) => (typeof item.slug === 'string' ? item.slug.trim() : ''))
          .filter(Boolean)
      ),
    ];
  } catch {
    return [];
  }
}

async function readEnvExampleVars(projectRoot: string): Promise<string[]> {
  const envExamplePath = path.join(projectRoot, '.env.example');
  if (!(await fsExtra.pathExists(envExamplePath))) {
    return [];
  }

  try {
    const content = await fsExtra.readFile(envExamplePath, 'utf-8');
    const vars: string[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Z0-9_]+)=/);
      if (match?.[1]) {
        vars.push(match[1]);
      }
    }
    return vars;
  } catch {
    return [];
  }
}

async function readInfraOverrides(workspacePath: string): Promise<string[]> {
  const overridePath = workspaceMetadataCandidates(workspacePath, 'infra', 'overrides.json').find(
    (candidate) => existsSync(candidate)
  );
  if (!overridePath) {
    return [];
  }

  try {
    const payload = (await fsExtra.readJson(overridePath)) as { services?: unknown };
    if (!Array.isArray(payload.services)) {
      return [];
    }
    return [
      ...new Set(
        payload.services.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      ),
    ];
  } catch {
    return [];
  }
}

async function readContractEnvVars(
  workspacePath: string
): Promise<Array<{ project: string; env: string }>> {
  const contractPath = await firstExistingWorkspaceArtifactPath(
    workspacePath,
    WORKSPACE_SUPPLEMENTAL_ARTIFACTS.workspaceContract
  );
  if (!contractPath) {
    return [];
  }

  try {
    const contract = (await fsExtra.readJson(contractPath)) as {
      projects?: Array<{ slug?: string; contracts?: { env?: string[] } }>;
    };
    const rows: Array<{ project: string; env: string }> = [];
    for (const project of contract.projects || []) {
      const slug = typeof project.slug === 'string' ? project.slug : 'unknown';
      for (const envVar of project.contracts?.env || []) {
        if (typeof envVar === 'string' && envVar.trim()) {
          rows.push({ project: slug, env: envVar.trim().toUpperCase() });
        }
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function addService(
  serviceIds: Set<string>,
  sources: InfraDiscoverySource[],
  serviceId: string,
  source: InfraDiscoverySource
): void {
  serviceIds.add(serviceId);
  sources.push(source);
}

export async function discoverWorkspaceInfraNeeds(input: {
  workspacePath: string;
  contract?: InfraStackContract;
}): Promise<InfraDiscoveryResult> {
  const workspacePath = path.resolve(input.workspacePath);
  const stackContract = input.contract || loadInfraStackContract();
  const serviceIds = new Set<string>();
  const sources: InfraDiscoverySource[] = [];
  const modules = new Set<string>();
  const envVars = new Set<string>();
  const overrides = new Set<string>();

  const projectJsonFiles = await discoverProjectJsonFiles(workspacePath);
  for (const projectJsonPath of projectJsonFiles) {
    const projectRoot = path.dirname(path.dirname(projectJsonPath));
    const projectSlug = path.basename(projectRoot);

    for (const moduleSlug of await readRegistryModules(projectRoot)) {
      modules.add(moduleSlug);
      for (const serviceId of resolveServicesFromModuleSlug(stackContract, moduleSlug)) {
        addService(serviceIds, sources, serviceId, {
          kind: 'module',
          value: moduleSlug,
          project: projectSlug,
        });
      }
    }

    for (const envVar of await readEnvExampleVars(projectRoot)) {
      envVars.add(envVar);
      for (const serviceId of resolveServicesFromEnvVar(stackContract, envVar)) {
        addService(serviceIds, sources, serviceId, {
          kind: 'env-var',
          value: envVar,
          project: projectSlug,
        });
      }
    }
  }

  for (const row of await readContractEnvVars(workspacePath)) {
    envVars.add(row.env);
    for (const serviceId of resolveServicesFromEnvVar(stackContract, row.env)) {
      addService(serviceIds, sources, serviceId, {
        kind: 'contract-env',
        value: row.env,
        project: row.project,
      });
    }
  }

  for (const serviceId of await readInfraOverrides(workspacePath)) {
    overrides.add(serviceId);
    addService(serviceIds, sources, serviceId, {
      kind: 'override',
      value: serviceId,
    });
  }

  return {
    modules: [...modules].sort(),
    envVars: [...envVars].sort(),
    overrides: [...overrides].sort(),
    sources,
    serviceIds: [...serviceIds].sort(),
  };
}
