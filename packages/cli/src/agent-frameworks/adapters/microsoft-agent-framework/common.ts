import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_CAPABILITY_IDS,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkCapabilityId,
} from '../../../contracts/agent-framework-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../../../contracts/workspace-intelligence-runtime-registry.js';
import { PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH } from '../../../utils/workspace-paths.js';

const NATIVE_CAPABILITIES = new Set<AgentFrameworkCapabilityId>([
  'single-agent',
  'multi-agent',
  'typed-tools',
  'handoffs',
  'explicit-workflows',
  'streaming',
  'human-in-the-loop',
  'conversation-state',
  'memory',
  'checkpoints',
  'resume',
  'mcp-client',
  'telemetry',
  'provider-neutral-models',
  'local-models',
  'local-execution',
  'self-hosting',
]);

const CONDITIONAL_CAPABILITIES = new Set<AgentFrameworkCapabilityId>([
  'skills',
  'background-execution',
  'durable-execution',
  'schedules',
  'channels',
  'mcp-server',
  'evaluations',
  'managed-hosting',
]);

export function microsoftAgentFrameworkCapabilities(): AgentFrameworkAdapterManifest['capabilities'] {
  return Object.fromEntries(
    AGENT_FRAMEWORK_CAPABILITY_IDS.map((id) => {
      const support = NATIVE_CAPABILITIES.has(id)
        ? 'native'
        : CONDITIONAL_CAPABILITIES.has(id)
          ? 'conditional'
          : 'unsupported';
      return [
        id,
        {
          support,
          evidence:
            support === 'unsupported'
              ? []
              : [`Microsoft Agent Framework 1.x public ${id} API or documented extension package.`],
          prerequisites:
            support === 'conditional'
              ? ['Install and configure the capability-specific Microsoft Agent Framework package.']
              : [],
          limitations:
            support === 'conditional'
              ? [
                  'Availability and hosting semantics depend on the selected extension and provider.',
                ]
              : [],
        },
      ];
    })
  ) as AgentFrameworkAdapterManifest['capabilities'];
}

export function microsoftAgentFrameworkManifest(
  runtime: 'python' | 'dotnet',
  frameworkVersion: string,
  detection: AgentFrameworkAdapterManifest['detection']
): AgentFrameworkAdapterManifest {
  const adapterId = `microsoft-agent-framework-${runtime}`;
  return {
    schemaVersion: AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    adapter: {
      id: adapterId,
      package: '@workspai/cli',
      version: '0.1.0',
      stability: 'preview',
    },
    framework: {
      id: 'microsoft-agent-framework',
      name: 'Microsoft Agent Framework',
      homepage: 'https://learn.microsoft.com/agent-framework/',
      license: 'MIT',
      upstreamStatus: 'stable',
      supportedVersionRange: '>=1 <2',
      testedVersions: [frameworkVersion],
    },
    implementation: {
      languages: [runtime === 'python' ? 'Python' : 'C#'],
      runtimes: [runtime],
      platforms: ['linux', 'darwin', 'win32'],
      executionBoundary: 'none',
      distribution: 'bundled',
    },
    operations: {
      detect: { supported: true, mode: 'read-only', limitations: [] },
      'plan-scaffold': { supported: true, mode: 'plan-only', limitations: [] },
      'plan-attach': {
        supported: true,
        mode: 'plan-only',
        limitations: ['Dependency changes require explicit host admission.'],
      },
      'render-managed-files': {
        supported: true,
        mode: 'render-only',
        limitations: ['Rendering never writes files or installs dependencies.'],
      },
      'project-context': { supported: true, mode: 'resolve-only', limitations: [] },
      validate: {
        supported: true,
        mode: 'read-only',
        limitations: ['Provider-backed integration checks require an explicit network grant.'],
      },
      'resolve-runtime': { supported: true, mode: 'resolve-only', limitations: [] },
    },
    capabilities: microsoftAgentFrameworkCapabilities(),
    detection,
    ownership: {
      canonicalTruth: 'workspai',
      runtimeState: 'framework',
      sessionState: 'framework',
      mutationAdmission: 'workspai-pcc',
      verificationOwner: 'workspai-cli',
      managedWritePolicy: 'owned-files-or-managed-sections',
      conflictPolicy: 'preserve-user-content',
      managedRoots: ['.workspai/agent-frameworks', 'agents'],
    },
    security: {
      secrets: 'references-only',
      network: 'deny-unless-explicitly-granted',
      generatedCodeExecution: 'disabled-unless-explicitly-granted',
      toolMutation: 'approval-required',
      untrustedInput: 'isolated',
      telemetrySensitiveData: 'redacted',
    },
    bindings: {
      contextInputs: [
        PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH,
        WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext,
      ],
      evidenceInputs: [WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun],
      mutationGateway: 'proof-carrying-change',
      verificationGateway: 'workspace-verify',
      projectionPolicy: 'references-and-bounded-projections-only',
    },
  };
}
