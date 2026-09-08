import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  validateAgentFrameworkConformanceReport,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

export const MAX_AGENT_FRAMEWORK_MANIFEST_BYTES = 512 * 1024;
export const MAX_AGENT_FRAMEWORK_CONFORMANCE_REPORT_BYTES = 2 * 1024 * 1024;

export type LoadedAgentFrameworkManifest = {
  manifest: AgentFrameworkAdapterManifest;
  manifestSha256: string;
  sourcePath: string;
};

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function readContainedJson(
  authorizedRootInput: string,
  relativeFilePath: string,
  maxBytes: number,
  label: string
): Promise<{ bytes: Buffer; payload: unknown; sourcePath: string }> {
  if (!relativeFilePath || path.isAbsolute(relativeFilePath)) {
    throw new Error(`${label} path must be a non-empty relative path.`);
  }
  const authorizedRoot = await fs.realpath(path.resolve(authorizedRootInput));
  const lexicalPath = path.resolve(authorizedRoot, relativeFilePath);
  if (!isContained(authorizedRoot, lexicalPath)) {
    throw new Error(`${label} path escapes its authorized root.`);
  }
  const sourcePath = await fs.realpath(lexicalPath).catch(() => {
    throw new Error(`${label} is unavailable: ${relativeFilePath}`);
  });
  if (!isContained(authorizedRoot, sourcePath)) {
    throw new Error(`${label} resolves outside its authorized root.`);
  }
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  const bytes = await fs.readFile(sourcePath);
  try {
    return { bytes, payload: JSON.parse(bytes.toString('utf8')) as unknown, sourcePath };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function loadAgentFrameworkManifest(
  authorizedRootInput: string,
  relativeManifestPath: string
): Promise<LoadedAgentFrameworkManifest> {
  const { bytes, payload, sourcePath } = await readContainedJson(
    authorizedRootInput,
    relativeManifestPath,
    MAX_AGENT_FRAMEWORK_MANIFEST_BYTES,
    'Agent framework manifest'
  );
  assertJsonSchemaContract(
    payload,
    AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
    'Agent framework manifest'
  );
  const manifest = payload as AgentFrameworkAdapterManifest;
  const semanticViolations = validateAgentFrameworkAdapterManifest(manifest);
  if (semanticViolations.length > 0) {
    throw new Error(`Agent framework manifest is invalid: ${semanticViolations.join('; ')}`);
  }
  return {
    manifest: structuredClone(manifest),
    manifestSha256: createHash('sha256').update(bytes).digest('hex'),
    sourcePath,
  };
}

export async function loadAgentFrameworkConformanceReport(
  authorizedRootInput: string,
  relativeReportPath: string
): Promise<AgentFrameworkConformanceReport> {
  const { payload } = await readContainedJson(
    authorizedRootInput,
    relativeReportPath,
    MAX_AGENT_FRAMEWORK_CONFORMANCE_REPORT_BYTES,
    'Agent framework conformance report'
  );
  assertJsonSchemaContract(
    payload,
    AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
    'Agent framework conformance report'
  );
  const report = payload as AgentFrameworkConformanceReport;
  const semanticViolations = validateAgentFrameworkConformanceReport(report);
  if (semanticViolations.length > 0) {
    throw new Error(
      `Agent framework conformance report is invalid: ${semanticViolations.join('; ')}`
    );
  }
  return structuredClone(report);
}
