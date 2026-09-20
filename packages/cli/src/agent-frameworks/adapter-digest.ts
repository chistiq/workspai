import { createHash } from 'node:crypto';

import type { AgentFrameworkAdapter } from './adapter.js';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

export function digestAgentFrameworkManifest(adapter: AgentFrameworkAdapter): string {
  return createHash('sha256')
    .update(`${JSON.stringify(adapter.manifest)}\n`)
    .digest('hex');
}

/**
 * Binds release evidence to generated templates and every synchronous adapter
 * operation. The probe is semantic so the digest remains identical in source,
 * bundled CLI, and installed-package execution.
 */
export function digestAgentFrameworkImplementation(adapter: AgentFrameworkAdapter): string {
  const input = {
    projectRoot: '/workspai/qualification/project',
    instanceName: 'qualification-probe',
    target: { project: 'qualification-project', artifactPrefix: '.' },
  } as const;
  const probe = {
    algorithm: 'workspai.agent-framework-implementation.semantic.v1',
    adapterId: adapter.manifest.adapter.id,
    render: adapter.render(input),
    plans: {
      scaffold: adapter.plan('scaffold', input),
      attach: adapter.plan('attach', input),
    },
    context: adapter.context(input),
    validation: adapter.validate(input),
    runtimeResolution: {
      unavailable: adapter.resolveRuntime([]),
      resolved: adapter.resolveRuntime([adapter.manifest.implementation.runtimes[0]]),
      ambiguous: adapter.resolveRuntime(
        adapter.manifest.implementation.runtimes.map((runtime) => `${runtime}@qualification`)
      ),
    },
  };
  return createHash('sha256')
    .update(JSON.stringify(stableValue(probe)))
    .digest('hex');
}
