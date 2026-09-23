import { describe, expect, it } from 'vitest';

import {
  assessBundledAgentFrameworkRelease,
  BUILTIN_AGENT_FRAMEWORK_ADAPTERS,
  createBuiltinAgentFrameworkRegistry,
  digestBuiltinAgentFrameworkImplementation,
  listBundledAgentFrameworkReleaseAdmissions,
} from '../agent-frameworks/index.js';

describe('agent framework release admission', () => {
  it('admits exactly the four Microsoft and OpenAI adapters promoted from the reviewed v2 matrix', () => {
    const admissions = listBundledAgentFrameworkReleaseAdmissions();
    expect(admissions.map((admission) => admission.id).sort()).toEqual([
      'microsoft-agent-framework-dotnet',
      'microsoft-agent-framework-python',
      'openai-agents-python',
      'openai-agents-typescript',
    ]);
    expect(
      BUILTIN_AGENT_FRAMEWORK_ADAPTERS.map((adapter) => adapter.manifest.adapter.id).sort()
    ).toEqual([
      'google-adk-python',
      'google-adk-typescript',
      'microsoft-agent-framework-dotnet',
      'microsoft-agent-framework-python',
      'openai-agents-python',
      'openai-agents-typescript',
    ]);

    for (const adapter of BUILTIN_AGENT_FRAMEWORK_ADAPTERS) {
      const resolution = assessBundledAgentFrameworkRelease(adapter);
      if (adapter.manifest.framework.id === 'google-adk') {
        expect(resolution.status).toBe('blocked');
        continue;
      }
      expect(resolution.status).toBe('admitted');
      expect(resolution.blockers).toEqual([]);
    }
  });

  it('records deterministic implementation provenance without making it runtime authority', () => {
    const adapter = BUILTIN_AGENT_FRAMEWORK_ADAPTERS[0];
    const changed = {
      ...adapter,
      render: (input: Parameters<typeof adapter.render>[0]) => ({
        ...adapter.render(input),
        files: adapter
          .render(input)
          .files.map((file, index) =>
            index === 0 ? { ...file, content: `${file.content}\n# changed` } : file
          ),
      }),
    };
    expect(digestBuiltinAgentFrameworkImplementation(adapter)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestBuiltinAgentFrameworkImplementation(adapter)).not.toBe(
      digestBuiltinAgentFrameworkImplementation(changed)
    );
    expect(assessBundledAgentFrameworkRelease(changed)).toMatchObject({
      status: 'admitted',
      blockers: [],
    });

    const changedManifest = {
      ...adapter,
      manifest: {
        ...adapter.manifest,
        adapter: {
          ...adapter.manifest.adapter,
          version: '999.0.0',
        },
      },
    };
    expect(assessBundledAgentFrameworkRelease(changedManifest)).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        'adapter version changed after release admission',
        'adapter manifest changed after release admission',
      ]),
    });
  });

  it('keeps raw registries blocked and admits reviewed adapters only when explicitly trusted', () => {
    const adapterId = BUILTIN_AGENT_FRAMEWORK_ADAPTERS[0].manifest.adapter.id;
    expect(createBuiltinAgentFrameworkRegistry().resolveAdapter(adapterId).status).toBe('blocked');
    expect(
      createBuiltinAgentFrameworkRegistry(
        {},
        { trustReviewedReleaseAdmissions: true }
      ).resolveAdapter(adapterId).status
    ).toBe('admitted');
    expect(
      createBuiltinAgentFrameworkRegistry({}, { trustReviewedReleaseAdmissions: true }).get(
        adapterId
      )
    ).not.toHaveProperty('releaseAdapter');
  });

  it('keeps stable-labeled OpenAI adapters visible and admitted after promotion', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    const adapters = registry.list().map((entry) => ({
      id: entry.manifest.adapter.id,
      status: registry.resolveAdapter(entry.manifest.adapter.id).status,
      stability: entry.manifest.adapter.stability,
    }));
    expect(adapters.filter((adapter) => adapter.status === 'admitted')).toHaveLength(4);
    expect(
      adapters
        .filter((adapter) => adapter.id.startsWith('openai-agents-'))
        .every((adapter) => adapter.status === 'admitted' && adapter.stability === 'stable')
    ).toBe(true);
    expect(
      adapters
        .filter((adapter) => adapter.id.startsWith('google-adk-'))
        .every((adapter) => adapter.status === 'blocked' && adapter.stability === 'preview')
    ).toBe(true);
    expect(
      createBuiltinAgentFrameworkRegistry().resolveAdapter('openai-agents-python').status
    ).toBe('blocked');
  });
});
