import { createHash } from 'node:crypto';

import type { AgentFrameworkConformanceReport } from '../contracts/agent-framework-contract.js';
import type { AgentFrameworkAdapter } from './adapter.js';
import {
  microsoftAgentFrameworkDotnetAdapter,
  microsoftAgentFrameworkPythonAdapter,
} from './adapters/microsoft-agent-framework/index.js';
import { AgentFrameworkRegistry } from './registry.js';

export const BUILTIN_AGENT_FRAMEWORK_ADAPTERS: readonly AgentFrameworkAdapter[] = Object.freeze([
  microsoftAgentFrameworkPythonAdapter,
  microsoftAgentFrameworkDotnetAdapter,
]);

export function digestBuiltinAgentFrameworkManifest(adapter: AgentFrameworkAdapter): string {
  return createHash('sha256')
    .update(`${JSON.stringify(adapter.manifest)}\n`)
    .digest('hex');
}

export function createBuiltinAgentFrameworkRegistry(
  conformanceReports: Readonly<Record<string, AgentFrameworkConformanceReport[]>> = {},
  options: { trustReviewedReleaseAdmissions?: boolean } = {}
): AgentFrameworkRegistry {
  const registry = new AgentFrameworkRegistry();
  for (const adapter of BUILTIN_AGENT_FRAMEWORK_ADAPTERS) {
    registry.register({
      manifest: adapter.manifest,
      manifestSha256: digestBuiltinAgentFrameworkManifest(adapter),
      source: 'builtin',
      conformanceReports: structuredClone(conformanceReports[adapter.manifest.adapter.id] ?? []),
      ...(options.trustReviewedReleaseAdmissions ? { releaseAdapter: adapter } : {}),
    });
  }
  return registry;
}
