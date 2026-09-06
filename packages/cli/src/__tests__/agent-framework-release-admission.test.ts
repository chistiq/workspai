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
    expect(admissions).toHaveLength(BUILTIN_AGENT_FRAMEWORK_ADAPTERS.length);

    for (const adapter of BUILTIN_AGENT_FRAMEWORK_ADAPTERS) {
      const resolution = assessBundledAgentFrameworkRelease(adapter);
      expect(resolution).toMatchObject({ status: 'admitted', blockers: [] });
      expect(resolution.admission?.platforms).toEqual(['linux', 'darwin', 'win32']);
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
});
