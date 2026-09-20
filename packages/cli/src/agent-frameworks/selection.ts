import type { AgentFrameworkAdapterManifest } from '../contracts/agent-framework-contract.js';
import type { AgentFrameworkRegistry } from './registry.js';
import { describeAgentFrameworkProjectKits } from './project-kits.js';

export const AGENT_FRAMEWORK_USER_RUNTIMES = ['python', 'dotnet', 'node'] as const;
export type AgentFrameworkUserRuntime = (typeof AGENT_FRAMEWORK_USER_RUNTIMES)[number];

export type ResolvedAgentFrameworkSelection = {
  adapterId: string;
  frameworkId: string;
  frameworkName: string;
  runtime: AgentFrameworkUserRuntime;
  admitted: boolean;
  blockers: string[];
};

function normalizedToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-');
}

function runtimeMatches(manifest: AgentFrameworkAdapterManifest, runtime: string): boolean {
  const requested = normalizedToken(runtime);
  return manifest.implementation.runtimes.some(
    (candidate) => normalizedToken(candidate) === requested
  );
}

function frameworkMatches(manifest: AgentFrameworkAdapterManifest, framework: string): boolean {
  const requested = normalizedToken(framework);
  return (
    requested === normalizedToken(manifest.framework.id) ||
    requested === normalizedToken(manifest.adapter.id)
  );
}

export function parseAgentFrameworkRuntime(value: string): AgentFrameworkUserRuntime {
  const normalized = value.trim().toLowerCase();
  if (!AGENT_FRAMEWORK_USER_RUNTIMES.includes(normalized as AgentFrameworkUserRuntime)) {
    throw new Error(
      `Unsupported agent framework runtime: ${value}. Choose python, dotnet, or node.`
    );
  }
  return normalized as AgentFrameworkUserRuntime;
}

export function listRegisteredAgentFrameworkCombinations(registry: AgentFrameworkRegistry): Array<{
  adapterId: string;
  frameworkId: string;
  frameworkName: string;
  runtime: string;
  status: 'admitted' | 'blocked' | 'unresolved';
}> {
  return registry.list().flatMap((entry) => {
    const status = registry.resolveAdapter(entry.manifest.adapter.id).status;
    return entry.manifest.implementation.runtimes.map((runtime) => ({
      adapterId: entry.manifest.adapter.id,
      frameworkId: entry.manifest.framework.id,
      frameworkName: entry.manifest.framework.name,
      runtime,
      status,
    }));
  });
}

function describeCombinations(registry: AgentFrameworkRegistry): string {
  return listRegisteredAgentFrameworkCombinations(registry)
    .map(
      (combination) =>
        `${combination.frameworkId} + ${combination.runtime} (${combination.adapterId}, ${combination.status})`
    )
    .join('; ');
}

export function resolveAgentFrameworkSelection(input: {
  registry: AgentFrameworkRegistry;
  runtime: AgentFrameworkUserRuntime;
  framework?: string;
}): ResolvedAgentFrameworkSelection {
  const requestedFramework = input.framework?.trim();
  const registered = input.registry
    .list()
    .filter((entry) => runtimeMatches(entry.manifest, input.runtime))
    .filter((entry) => !requestedFramework || frameworkMatches(entry.manifest, requestedFramework));

  if (registered.length === 0) {
    throw new Error(
      requestedFramework
        ? `No agent framework adapter matches framework ${requestedFramework} and runtime ${input.runtime}. Available combinations: ${describeCombinations(input.registry) || 'none'}.`
        : `No agent framework adapter matches runtime ${input.runtime}. Available combinations: ${describeCombinations(input.registry) || 'none'}.`
    );
  }

  const publishedIds = new Set(describeAgentFrameworkProjectKits().map((kit) => kit.adapterId));
  const published = registered.filter((entry) => publishedIds.has(entry.manifest.adapter.id));
  const admitted = registered.filter(
    (entry) => input.registry.resolveAdapter(entry.manifest.adapter.id).status === 'admitted'
  );

  if (!requestedFramework && published.length > 1) {
    throw new Error(
      `Runtime ${input.runtime} matches multiple published frameworks (${published
        .map((entry) => entry.manifest.framework.id)
        .join(', ')}). Pass --framework explicitly; Workspai does not guess.`
    );
  }

  const selected = published[0] ?? admitted[0] ?? registered[0];
  if (!selected) {
    throw new Error(
      `No agent framework adapter matches runtime ${input.runtime}. Available combinations: ${describeCombinations(input.registry) || 'none'}.`
    );
  }
  if (!requestedFramework && published.length === 0 && registered.length > 1) {
    throw new Error(
      `Runtime ${input.runtime} matches multiple registered frameworks and none are published create kits. Pass --framework explicitly. Available combinations: ${describeCombinations(input.registry)}.`
    );
  }

  const admission = input.registry.resolveAdapter(selected.manifest.adapter.id);
  return {
    adapterId: selected.manifest.adapter.id,
    frameworkId: selected.manifest.framework.id,
    frameworkName: selected.manifest.framework.name,
    runtime: input.runtime,
    admitted: admission.status === 'admitted',
    blockers: admission.blockers,
  };
}
