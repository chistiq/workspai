import fs from 'fs';
import path from 'path';

import { buildAgentCustomizationPackContract } from '../src/contracts/agent-customization-pack-contract.js';
import { buildImportStackParitySnapshot } from '../src/contracts/import-stack-parity-snapshot.js';
import { buildCreatePlannerCapabilitiesContract } from '../src/contracts/create-planner-capabilities-contract.js';
import { buildExtensionCliCompatibilityContract } from '../src/contracts/extension-cli-compatibility-contract.js';
import { buildInfraStackContract } from '../src/contracts/infra-stack-contract.js';
import { buildModuleLayoutContract } from '../src/contracts/module-layout-contract.js';
import { buildProjectEntryCapabilityContract } from '../src/contracts/project-entry-capability-contract.js';
import { buildRuntimeCommandSurfaceContract } from '../src/contracts/runtime-command-surface-contract.js';
import { buildWorkspaceIntelligenceArchitectureContract } from '../src/contracts/workspace-intelligence-architecture-contract.js';
import { buildWorkspaceIntelligenceChainContract } from '../src/contracts/workspace-intelligence-chain-contract.js';
import {
  buildWorkspaceArchiveCapabilitiesContract,
  buildWorkspaceArchiveManifestSchema,
  buildWorkspaceArchiveOperationResultSchema,
} from '../src/contracts/workspace-archive-contract.js';
import { buildCliOperationResultSchema } from '../src/contracts/cli-operation-result-contract.js';
import {
  buildCommandCapabilitiesSchema,
  buildVersionContractSchema,
} from '../src/contracts/cli-discovery-contract.js';
import { buildPublishedContractCatalog } from '../src/contracts/published-contract-versions.js';
import { buildOperationalJsonSchemas } from '../src/contracts/operational-json-schemas.js';
import {
  buildIngestionPlanSchema,
  buildIngestionResultSchema,
} from '../src/contracts/ingestion-contract.js';
import { buildStudioCardRepairCapabilitiesContract } from '../src/contracts/studio-card-repair-capabilities-contract.js';
import { buildWorkspaceRepairCapabilitiesContract } from '../src/contracts/workspace-repair-capabilities-contract.js';

const contractsDir = path.resolve(process.cwd(), 'contracts');

function writeJson(fileName: string, value: unknown) {
  const targetPath = path.join(contractsDir, fileName);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  console.log(`- wrote ${targetPath}`);
}

writeJson('runtime-command-surface.v1.json', buildRuntimeCommandSurfaceContract());
process.env.VITEST = '1';
const { getGlobalCommandCapabilities } = await import('../src/index.js');
writeJson(
  'cli-runtime-command-inventory.v1.snapshot.json',
  getGlobalCommandCapabilities().runtimeInventory
);
writeJson('cli-operation-result.v1.json', buildCliOperationResultSchema());
writeJson('command-capabilities.v1.json', buildCommandCapabilitiesSchema());
writeJson('version.v1.json', buildVersionContractSchema());
writeJson('published-contract-catalog.v1.json', buildPublishedContractCatalog());
for (const [fileName, schema] of Object.entries(buildOperationalJsonSchemas())) {
  writeJson(fileName, schema);
}
writeJson('workspace-archive-capabilities.v1.json', buildWorkspaceArchiveCapabilitiesContract());
writeJson('workspace-archive-manifest.v1.json', buildWorkspaceArchiveManifestSchema());
writeJson(
  'workspace-archive-operation-result.v1.json',
  buildWorkspaceArchiveOperationResultSchema()
);
writeJson('ingestion-plan.v1.json', buildIngestionPlanSchema());
writeJson('ingestion-result.v1.json', buildIngestionResultSchema());
writeJson('create-planner-capabilities.v1.json', buildCreatePlannerCapabilitiesContract());
writeJson('agent-customization-pack.v1.json', buildAgentCustomizationPackContract());
writeJson('backend-import-stack-parity.snapshot.json', buildImportStackParitySnapshot());
writeJson('module-layout.v1.json', buildModuleLayoutContract());
writeJson('project-entry-capability.v1.json', buildProjectEntryCapabilityContract());
writeJson('infra-stack.v1.json', buildInfraStackContract());
writeJson('extension-cli-compatibility.v1.json', buildExtensionCliCompatibilityContract());
writeJson(
  'workspace-intelligence-architecture.v1.json',
  buildWorkspaceIntelligenceArchitectureContract()
);
writeJson('workspace-intelligence-chain.v1.json', buildWorkspaceIntelligenceChainContract());
writeJson('studio-card-repair-capabilities.v1.json', buildStudioCardRepairCapabilitiesContract());
writeJson('workspace-repair-capabilities.v1.json', buildWorkspaceRepairCapabilitiesContract());
