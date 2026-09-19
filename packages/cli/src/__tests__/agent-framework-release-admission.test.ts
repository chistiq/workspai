import { describe, expect, it } from 'vitest';

import {
  assessBundledAgentFrameworkRelease,
  BUILTIN_AGENT_FRAMEWORK_ADAPTERS,
  createBuiltinAgentFrameworkRegistry,
  listBundledAgentFrameworkReleaseAdmissions,
} from '../agent-frameworks/index.js';

describe('agent framework release admission', () => {
  it('admits only the exact reviewed built-in manifests and complete platform matrices', () => {
    const admissions = listBundledAgentFrameworkReleaseAdmissions();
    const admittedIds = new Set(admissions.map((admission) => admission.id));
    expect(admissions).toHaveLength(4);

    for (const adapter of BUILTIN_AGENT_FRAMEWORK_ADAPTERS) {
      const resolution = assessBundledAgentFrameworkRelease(adapter);
      const openai = adapter.manifest.adapter.id.startsWith('openai-agents-');
      if (openai) {
        expect(resolution).toMatchObject({
          status: 'blocked',
          blockers: expect.arrayContaining(['adapter manifest changed after release admission']),
        });
        continue;
      }
      if (admittedIds.has(adapter.manifest.adapter.id)) {
        expect(resolution).toMatchObject({ status: 'admitted', blockers: [] });
        expect(resolution.admission?.platforms).toEqual(['linux', 'darwin', 'win32']);
      } else {
        expect(resolution.status).toBe('blocked');
        expect(resolution.blockers).toEqual(
          expect.arrayContaining([expect.stringContaining('No reviewed release admission exists')])
        );
      }
    }
  });

  it('fails closed after any admitted manifest change', () => {
    const adapter = BUILTIN_AGENT_FRAMEWORK_ADAPTERS[0];
    const changed = {
      ...adapter,
      manifest: {
        ...adapter.manifest,
        framework: {
          ...adapter.manifest.framework,
          testedVersions: ['1.17.1'],
        },
      },
    };
    expect(assessBundledAgentFrameworkRelease(changed)).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        'adapter manifest changed after release admission',
        'framework baseline changed after release admission',
      ]),
    });
  });

  it('keeps raw registries blocked and enables release trust only when explicitly requested', () => {
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

  it('admits reviewed OpenAI adapters while keeping default registries blocked', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    const adapters = registry.list().map((entry) => ({
      id: entry.manifest.adapter.id,
      status: registry.resolveAdapter(entry.manifest.adapter.id).status,
      stability: entry.manifest.adapter.stability,
    }));
    expect(
      adapters
        .filter((adapter) => adapter.status === 'admitted')
        .map((adapter) => adapter.id)
        .sort()
    ).toEqual(['microsoft-agent-framework-dotnet', 'microsoft-agent-framework-python']);
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
