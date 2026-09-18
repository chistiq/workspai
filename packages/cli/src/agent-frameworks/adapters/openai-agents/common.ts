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
  'typed-tools',
  'local-execution',
]);

const CONDITIONAL_CAPABILITIES = new Set<AgentFrameworkCapabilityId>([
  'telemetry',
  'provider-neutral-models',
]);

const LANGUAGE_LIMITATIONS: Record<'python' | 'typescript', string[]> = {
  python: [
    'Generated projects pin openai-agents 0.22.2 and require Python >=3.10.',
    'Tracing defaults off. openai-agents 0.22.2 DefaultTraceProvider treats OPENAI_AGENTS_DISABLE_TRACING=1|true as disabled until set_tracing_disabled is called; the starter therefore never calls set_tracing_disabled(False) when that env is set.',
    'Cancellation uses Runner.max_turns and ModelSettings.timeout from this SDK version. ModelSettings.timeout is per model request, not a host-owned deadline for the whole run.',
    'Context containment uses lstat, realpath, O_NOFOLLOW open when available, and a capped fd read. That is not an atomic path walk and does not prove a TOCTOU-free open against a concurrent replacement of a hop.',
  ],
  typescript: [
    'Generated projects pin @openai/agents 0.18.0, require Node.js >=22, and declare zod 4.6.5 as the SDK peer.',
    'Tracing defaults off. The starter passes Runner({ tracingDisabled }) from WORKSPAI_AGENT_TRACING and OPENAI_AGENTS_DISABLE_TRACING; the disable env wins.',
    'Cancellation uses run maxTurns plus AbortSignal from this SDK version. AbortSignal.timeout(30000) is the SDK run signal for that call, not a separate Workspai timeout service.',
    'Context containment uses lstat, realpath, O_NOFOLLOW open when available, and a capped fd read. That is not an atomic path walk and does not prove a TOCTOU-free open against a concurrent replacement of a hop.',
  ],
};

export function openaiAgentsCapabilities(
  language: 'python' | 'typescript'
): AgentFrameworkAdapterManifest['capabilities'] {
  return Object.fromEntries(
    AGENT_FRAMEWORK_CAPABILITY_IDS.map((id) => {
      const support = NATIVE_CAPABILITIES.has(id)
        ? 'native'
        : CONDITIONAL_CAPABILITIES.has(id)
          ? 'conditional'
          : 'unsupported';
      const languageLimitations = LANGUAGE_LIMITATIONS[language];
      return [
        id,
        {
          support,
          evidence:
            support === 'unsupported'
              ? []
              : support === 'native'
                ? [
                    `OpenAI Agents SDK ${language} starter implements ${id} with the pinned SDK APIs and credentialless conformance.`,
                  ]
                : [
                    `OpenAI Agents SDK ${language} documents ${id}; the Workspai adapter exposes it only when declared environment or package prerequisites are present.`,
                  ],
          prerequisites:
            id === 'telemetry'
              ? language === 'python'
                ? [
                    'Opt in with WORKSPAI_AGENT_TRACING=1. OPENAI_AGENTS_DISABLE_TRACING=1|true keeps tracing off even if that opt-in is set. openai-agents 0.22.2 reads OPENAI_AGENTS_DISABLE_TRACING on first trace unless set_tracing_disabled was already called.',
                  ]
                : [
                    'Opt in with WORKSPAI_AGENT_TRACING=1. OPENAI_AGENTS_DISABLE_TRACING=1|true keeps tracing off even if that opt-in is set. Credentialless runs set the disable env and pass Runner({ tracingDisabled: true }).',
                  ]
              : id === 'provider-neutral-models'
                ? language === 'python'
                  ? [
                      'Install and configure a documented non-OpenAI model integration for openai-agents 0.22.2. The starter only reads OPENAI_MODEL or OPENAI_DEFAULT_MODEL.',
                    ]
                  : [
                      'Supply a documented non-OpenAI model implementation for @openai/agents 0.18.0. The starter only reads OPENAI_MODEL or OPENAI_DEFAULT_MODEL.',
                    ]
                : [],
          limitations:
            support === 'unsupported'
              ? []
              : [
                  ...languageLimitations,
                  ...(id === 'typed-tools'
                    ? [
                        'The starter ships one bounded read-only context tool. It does not grant shell, filesystem mutation, or unrestricted tool execution.',
                      ]
                    : []),
                ],
        },
      ];
    })
  ) as AgentFrameworkAdapterManifest['capabilities'];
}

export function openaiAgentsManifest(
  language: 'python' | 'typescript',
  frameworkVersion: string,
  detection: AgentFrameworkAdapterManifest['detection']
): AgentFrameworkAdapterManifest {
  const runtime = language === 'python' ? 'python' : 'node';
  const adapterId = `openai-agents-${language}`;
  return {
    schemaVersion: AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    adapter: {
      id: adapterId,
      package: '@workspai/cli',
      version: '0.1.0',
      stability: 'stable',
    },
    framework: {
      id: 'openai-agents',
      name: 'OpenAI Agents SDK',
      homepage:
        language === 'python'
          ? 'https://openai.github.io/openai-agents-python/'
          : 'https://openai.github.io/openai-agents-js/',
      license: 'MIT',
      upstreamStatus: 'stable',
      supportedVersionRange: language === 'python' ? '>=0.22 <1' : '>=0.18 <1',
      testedVersions: [frameworkVersion],
    },
    implementation: {
      languages: [language === 'python' ? 'Python' : 'TypeScript'],
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
    capabilities: openaiAgentsCapabilities(language),
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
