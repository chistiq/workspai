import type { AgentFrameworkConformanceReport } from '../contracts/agent-framework-contract.js';
import type { AgentFrameworkAdapter } from './adapter.js';
import {
  microsoftAgentFrameworkDotnetAdapter,
  microsoftAgentFrameworkPythonAdapter,
} from './adapters/microsoft-agent-framework/index.js';
import {
  openaiAgentsPythonAdapter,
  openaiAgentsTypeScriptAdapter,
} from './adapters/openai-agents/index.js';
import { AgentFrameworkRegistry } from './registry.js';
import {
  digestAgentFrameworkImplementation,
  digestAgentFrameworkManifest,
} from './adapter-digest.js';

export const BUILTIN_AGENT_FRAMEWORK_ADAPTERS: readonly AgentFrameworkAdapter[] = Object.freeze([
  microsoftAgentFrameworkPythonAdapter,
  microsoftAgentFrameworkDotnetAdapter,
  openaiAgentsPythonAdapter,
  openaiAgentsTypeScriptAdapter,
]);

export function digestBuiltinAgentFrameworkManifest(adapter: AgentFrameworkAdapter): string {
  return digestAgentFrameworkManifest(adapter);
}

/**
 * Binds release evidence to generated templates and every synchronous adapter
 * operation. The probe is semantic so the digest remains identical in source,
 * bundled CLI, and installed-package execution.
 */
export function digestBuiltinAgentFrameworkImplementation(adapter: AgentFrameworkAdapter): string {
  return digestAgentFrameworkImplementation(adapter);
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
      implementationSha256: digestBuiltinAgentFrameworkImplementation(adapter),
      source: 'builtin',
      conformanceReports: structuredClone(conformanceReports[adapter.manifest.adapter.id] ?? []),
      ...(options.trustReviewedReleaseAdmissions ? { releaseAdapter: adapter } : {}),
    });
  }
  return registry;
}
