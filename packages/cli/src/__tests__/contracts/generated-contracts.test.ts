import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { buildExtensionCliCompatibilityContract } from '../../contracts/extension-cli-compatibility-contract';
import { buildAgentCustomizationPackContract } from '../../contracts/agent-customization-pack-contract';
import { buildCreatePlannerCapabilitiesContract } from '../../contracts/create-planner-capabilities-contract';
import { buildImportStackParitySnapshot } from '../../contracts/import-stack-parity-snapshot';
import { buildInfraStackContract } from '../../contracts/infra-stack-contract';
import { buildModuleLayoutContract } from '../../contracts/module-layout-contract';
import { buildProjectEntryCapabilityContract } from '../../contracts/project-entry-capability-contract';
import { buildRuntimeCommandSurfaceContract } from '../../contracts/runtime-command-surface-contract';
import { buildWorkspaceIntelligenceArchitectureContract } from '../../contracts/workspace-intelligence-architecture-contract';
import { buildWorkspaceIntelligenceChainContract } from '../../contracts/workspace-intelligence-chain-contract';
import {
  buildWorkspaceArchiveCapabilitiesContract,
  buildWorkspaceArchiveManifestSchema,
  buildWorkspaceArchiveOperationResultSchema,
} from '../../contracts/workspace-archive-contract';
import { buildCliOperationResultSchema } from '../../contracts/cli-operation-result-contract';
import {
  buildCommandCapabilitiesSchema,
  buildVersionContractSchema,
} from '../../contracts/cli-discovery-contract';
import { buildPublishedContractCatalog } from '../../contracts/published-contract-versions';
import { buildOperationalJsonSchemas } from '../../contracts/operational-json-schemas';
import {
  buildAdoptEffectsSchema,
  buildIngestionPlanSchema,
  buildIngestionResultSchema,
} from '../../contracts/ingestion-contract';
import { buildStudioCardRepairCapabilitiesContract } from '../../contracts/studio-card-repair-capabilities-contract';
import { buildWorkspaceRepairCapabilitiesContract } from '../../contracts/workspace-repair-capabilities-contract';

function readJsonContract(fileName: string): unknown {
  const contractPath = path.resolve(process.cwd(), 'contracts', fileName);
  return JSON.parse(fs.readFileSync(contractPath, 'utf8')) as unknown;
}

function listPublishedContractFiles(
  directory = path.resolve(process.cwd(), 'contracts')
): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(path.relative(process.cwd(), absolutePath).split(path.sep).join('/'));
      }
    }
  };
  visit(directory);
  return files.sort();
}

function catalogContractPaths(value: unknown, paths = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return paths;
  const record = value as Record<string, unknown>;
  if (typeof record.contractPath === 'string') paths.add(record.contractPath);
  for (const nested of Object.values(record)) catalogContractPaths(nested, paths);
  return paths;
}

describe('generated shared contracts (Wave B + C)', () => {
  it('keeps committed runtime command surface aligned with the generator', () => {
    expect(readJsonContract('runtime-command-surface.v1.json')).toEqual(
      buildRuntimeCommandSurfaceContract()
    );
  });

  it('keeps CLI discovery and operation contracts aligned with their generators', () => {
    expect(readJsonContract('cli-operation-result.v1.json')).toEqual(
      buildCliOperationResultSchema()
    );
    expect(readJsonContract('command-capabilities.v1.json')).toEqual(
      buildCommandCapabilitiesSchema()
    );
    expect(readJsonContract('version.v1.json')).toEqual(buildVersionContractSchema());
    expect(readJsonContract('published-contract-catalog.v1.json')).toEqual(
      buildPublishedContractCatalog()
    );
    for (const [fileName, schema] of Object.entries(buildOperationalJsonSchemas())) {
      expect(readJsonContract(fileName)).toEqual(schema);
    }
  });

  it('publishes a discoverable catalog entry for every packaged JSON contract', () => {
    const catalog = buildPublishedContractCatalog();
    expect([...catalogContractPaths(catalog)].sort()).toEqual(listPublishedContractFiles());
  });

  it('keeps committed workspace archive contracts aligned with their generators', () => {
    expect(readJsonContract('workspace-archive-capabilities.v1.json')).toEqual(
      buildWorkspaceArchiveCapabilitiesContract()
    );
    expect(readJsonContract('workspace-archive-manifest.v1.json')).toEqual(
      buildWorkspaceArchiveManifestSchema()
    );
    expect(readJsonContract('workspace-archive-operation-result.v1.json')).toEqual(
      buildWorkspaceArchiveOperationResultSchema()
    );
  });

  it('keeps the canonical ingestion plan and result schemas aligned with their generators', () => {
    expect(readJsonContract('ingestion-plan.v1.json')).toEqual(buildIngestionPlanSchema());
    expect(readJsonContract('ingestion-result.v1.json')).toEqual(buildIngestionResultSchema());
    expect(readJsonContract('adopt-effects.v1.json')).toEqual(buildAdoptEffectsSchema());
  });

  it('keeps committed create planner capabilities aligned with the generator', () => {
    expect(readJsonContract('create-planner-capabilities.v1.json')).toEqual(
      buildCreatePlannerCapabilitiesContract()
    );
  });

  it('keeps committed agent customization pack aligned with the generator', () => {
    expect(readJsonContract('agent-customization-pack.v1.json')).toEqual(
      buildAgentCustomizationPackContract()
    );
  });

  it('keeps committed import stack parity snapshot aligned with the generator', () => {
    expect(readJsonContract('backend-import-stack-parity.snapshot.json')).toEqual(
      buildImportStackParitySnapshot()
    );
  });

  it('keeps committed module layout contract aligned with the generator', () => {
    expect(readJsonContract('module-layout.v1.json')).toEqual(buildModuleLayoutContract());
  });

  it('keeps committed project entry capability aligned with the generator', () => {
    expect(readJsonContract('project-entry-capability.v1.json')).toEqual(
      buildProjectEntryCapabilityContract()
    );
  });

  it('keeps committed infra stack contract aligned with the generator', () => {
    expect(readJsonContract('infra-stack.v1.json')).toEqual(buildInfraStackContract());
  });

  it('keeps committed extension CLI compatibility aligned with its explicit compatibility floor', () => {
    expect(readJsonContract('extension-cli-compatibility.v1.json')).toEqual(
      buildExtensionCliCompatibilityContract()
    );
  });

  it('keeps committed workspace intelligence architecture aligned with the generator', () => {
    expect(readJsonContract('workspace-intelligence-architecture.v1.json')).toEqual(
      buildWorkspaceIntelligenceArchitectureContract()
    );
  });

  it('keeps committed workspace intelligence chain aligned with the generator', () => {
    expect(readJsonContract('workspace-intelligence-chain.v1.json')).toEqual(
      buildWorkspaceIntelligenceChainContract()
    );
  });

  it('keeps every Studio card bound to its canonical repair producer', () => {
    expect(readJsonContract('studio-card-repair-capabilities.v1.json')).toEqual(
      buildStudioCardRepairCapabilitiesContract()
    );
  });

  it('keeps the repair adapter inventory aligned with the CLI engine contract', () => {
    expect(readJsonContract('workspace-repair-capabilities.v1.json')).toEqual(
      buildWorkspaceRepairCapabilitiesContract()
    );
  });
});
