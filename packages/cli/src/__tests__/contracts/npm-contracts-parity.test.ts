import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const NPM_CONTRACTS_DIR = path.resolve(process.cwd(), 'contracts');
const VSCODE_CONTRACTS_DIR = process.env.WORKSPAI_VSCODE_CONTRACTS_DIR
  ? path.resolve(process.env.WORKSPAI_VSCODE_CONTRACTS_DIR)
  : path.resolve(process.cwd(), '..', '..', '..', 'rapidkit-vscode', 'contracts');

const CLI_EXTENSION_CONTRACT_FILES = [
  'extension-cli-compatibility.v1.json',
  'runtime-command-surface.v1.json',
  'cli-operation-result.v1.json',
  'command-capabilities.v1.json',
  'version.v1.json',
  'published-contract-catalog.v1.json',
  'workspace-archive-capabilities.v1.json',
  'workspace-archive-manifest.v1.json',
  'workspace-archive-operation-result.v1.json',
  'create-planner-capabilities.v1.json',
  'agent-customization-pack.v1.json',
  'backend-import-stack-parity.snapshot.json',
  'module-layout.v1.json',
  'pipeline-last-run.v1.json',
  'infra-stack.v1.json',
  'workspace-registry.v1.json',
  'release-readiness.v1.json',
  'workspace-run-last.v1.json',
  'doctor-workspace-evidence.v1.json',
  'doctor-project-evidence.v1.json',
  'doctor-remediation-plan.v1.json',
  'doctor-remediation-plan.v2.json',
  'workspace-intelligence/doctor-dependency-repair-transaction.v1.json',
  'artifact-remediation-plan.v1.json',
  'analyze-last-run.v1.json',
];

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

describe('CLI ↔ extension contract parity', () => {
  it('publishes every contract in the shared CLI/extension inventory', () => {
    for (const fileName of CLI_EXTENSION_CONTRACT_FILES) {
      const cliPath = path.join(NPM_CONTRACTS_DIR, fileName);
      expect(fs.existsSync(cliPath), `${fileName} missing in Workspai CLI contracts`).toBe(true);
    }
  });

  it.skipIf(!fs.existsSync(VSCODE_CONTRACTS_DIR))(
    'keeps Workspai CLI contracts aligned with rapidkit-vscode/contracts',
    () => {
      for (const fileName of CLI_EXTENSION_CONTRACT_FILES) {
        const cliPath = path.join(NPM_CONTRACTS_DIR, fileName);
        const extensionPath = path.join(VSCODE_CONTRACTS_DIR, fileName);

        expect(
          fs.existsSync(extensionPath),
          `${fileName} missing in rapidkit-vscode/contracts`
        ).toBe(true);
        expect(readJson(cliPath)).toEqual(readJson(extensionPath));
      }
    }
  );
});
