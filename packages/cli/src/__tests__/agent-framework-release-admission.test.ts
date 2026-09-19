import { describe, expect, it } from 'vitest';

import {
  assessBundledAgentFrameworkRelease,
  BUILTIN_AGENT_FRAMEWORK_ADAPTERS,
  createBuiltinAgentFrameworkRegistry,
  digestBuiltinAgentFrameworkImplementation,
  listBundledAgentFrameworkReleaseAdmissions,
} from '../agent-frameworks/index.js';

describe('agent framework release admission', () => {
  it('fails closed until the v2 implementation-bound matrix is promoted', () => {
    const admissions = listBundledAgentFrameworkReleaseAdmissions();
    expect(admissions).toEqual([]);

    for (const adapter of BUILTIN_AGENT_FRAMEWORK_ADAPTERS) {
      const resolution = assessBundledAgentFrameworkRelease(adapter);
      expect(resolution.status).toBe('blocked');
      expect(resolution.blockers).toEqual(
        expect.arrayContaining([expect.stringContaining('No reviewed release admission exists')])
      );
    }
  });

  it('produces deterministic semantic implementation digests that bind rendered output', () => {
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
  });

  it('keeps raw and release-trusting registries blocked before promotion', () => {
    const adapterId = BUILTIN_AGENT_FRAMEWORK_ADAPTERS[0].manifest.adapter.id;
    expect(createBuiltinAgentFrameworkRegistry().resolveAdapter(adapterId).status).toBe('blocked');
    expect(
      createBuiltinAgentFrameworkRegistry(
        {},
        { trustReviewedReleaseAdmissions: true }
      ).resolveAdapter(adapterId).status
    ).toBe('blocked');
    expect(
      createBuiltinAgentFrameworkRegistry({}, { trustReviewedReleaseAdmissions: true }).get(
        adapterId
      )
    ).not.toHaveProperty('releaseAdapter');
  });

  it('keeps stable-labeled OpenAI adapters visible but blocked before promotion', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    const adapters = registry.list().map((entry) => ({
      id: entry.manifest.adapter.id,
      status: registry.resolveAdapter(entry.manifest.adapter.id).status,
      stability: entry.manifest.adapter.stability,
    }));
    expect(adapters.filter((adapter) => adapter.status === 'admitted')).toEqual([]);
    expect(
      adapters
        .filter((adapter) => adapter.id.startsWith('openai-agents-'))
        .every((adapter) => adapter.status === 'blocked' && adapter.stability === 'stable')
    ).toBe(true);
    expect(
      createBuiltinAgentFrameworkRegistry().resolveAdapter('openai-agents-python').status
    ).toBe('blocked');
  });
});
