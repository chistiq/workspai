import { describe, expect, it } from 'vitest';

import {
  createBuiltinAgentFrameworkRegistry,
  listBundledAgentFrameworkReleaseAdmissions,
  parseAgentFrameworkRuntime,
  resolveAgentFrameworkSelection,
} from '../agent-frameworks/index.js';

const admittedAdapterIds = new Set(
  listBundledAgentFrameworkReleaseAdmissions().map((admission) => admission.id)
);

describe('agent framework selection', () => {
  it('refuses to guess Python when Microsoft and OpenAI are both published', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    expect(() => resolveAgentFrameworkSelection({ registry, runtime: 'python' })).toThrow(
      /Pass --framework explicitly/
    );
    expect(
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'python',
        framework: 'microsoft-agent-framework',
      })
    ).toMatchObject({
      adapterId: 'microsoft-agent-framework-python',
      frameworkId: 'microsoft-agent-framework',
      admitted: admittedAdapterIds.has('microsoft-agent-framework-python'),
    });
  });

  it('rejects invalid framework and runtime combinations without silent fallback', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    expect(() => parseAgentFrameworkRuntime('typescript')).toThrow(/python, dotnet, or node/);
    expect(() =>
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'node',
        framework: 'microsoft-agent-framework',
      })
    ).toThrow(
      /No agent framework adapter matches framework microsoft-agent-framework and runtime node/
    );
    expect(() =>
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'dotnet',
        framework: 'openai-agents',
      })
    ).toThrow(/No agent framework adapter matches framework openai-agents and runtime dotnet/);
  });

  it('does not guess when a runtime has multiple registered frameworks and none are admitted', () => {
    const registry = createBuiltinAgentFrameworkRegistry();
    expect(() => resolveAgentFrameworkSelection({ registry, runtime: 'python' })).toThrow(
      /Pass --framework explicitly/
    );
  });

  it('selects OpenAI when requested by framework id', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    expect(
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'python',
        framework: 'openai-agents',
      })
    ).toMatchObject({
      adapterId: 'openai-agents-python',
      frameworkId: 'openai-agents',
      admitted: admittedAdapterIds.has('openai-agents-python'),
    });
    expect(
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'node',
        framework: 'openai-agents-typescript',
      })
    ).toMatchObject({
      adapterId: 'openai-agents-typescript',
      frameworkId: 'openai-agents',
      admitted: admittedAdapterIds.has('openai-agents-typescript'),
    });
  });

  it('selects admitted Google ADK adapters by framework id without guessing', () => {
    const registry = createBuiltinAgentFrameworkRegistry(
      {},
      { trustReviewedReleaseAdmissions: true }
    );
    expect(
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'python',
        framework: 'google-adk',
      })
    ).toMatchObject({
      adapterId: 'google-adk-python',
      frameworkId: 'google-adk',
      admitted: admittedAdapterIds.has('google-adk-python'),
    });
    expect(
      resolveAgentFrameworkSelection({
        registry,
        runtime: 'node',
        framework: 'google-adk',
      })
    ).toMatchObject({
      adapterId: 'google-adk-typescript',
      frameworkId: 'google-adk',
      admitted: admittedAdapterIds.has('google-adk-typescript'),
    });
  });
});
