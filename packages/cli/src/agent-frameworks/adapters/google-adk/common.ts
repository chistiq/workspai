import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_SCHEMA_VERSION,
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_CAPABILITY_IDS,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkCapabilityId,
} from '../../../contracts/agent-framework-contract.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from '../../../contracts/workspace-intelligence-runtime-registry.js';
import { PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH } from '../../../utils/workspace-paths.js';
import {
  GOOGLE_ADK_PYTHON_BASELINE,
  GOOGLE_ADK_TYPESCRIPT_BASELINE,
  compareRegistryVersions,
  isStableRegistryVersion,
  packageVersion,
} from '../../version-policy.js';

export const GOOGLE_ADK_FRAMEWORK_ID = 'google-adk';
export const GOOGLE_ADK_PROVIDER_GEMINI = 'gemini-api';
export const GOOGLE_ADK_PROVIDER_VERTEX = 'vertex-ai';
export const GOOGLE_ADK_REQUIRED_ENVIRONMENT = ['WORKSPAI_ADK_PROVIDER', 'ADK_MODEL'] as const;
export const GOOGLE_ADK_BROWSER_ENV_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'PUBLIC_'] as const;

const NATIVE_CAPABILITIES = new Set<AgentFrameworkCapabilityId>([
  'single-agent',
  'typed-tools',
  'local-execution',
  'streaming',
  'conversation-state',
]);

const CONDITIONAL_CAPABILITIES = new Set<AgentFrameworkCapabilityId>(['telemetry']);

function languageLimitations(language: 'python' | 'typescript'): string[] {
  if (language === 'python') {
    const version = packageVersion(GOOGLE_ADK_PYTHON_BASELINE, 'google-adk');
    return [
      `Python and TypeScript are independent ADK runtimes. This adapter pins google-adk ${version} and requires Python >=3.10. It does not claim TypeScript graph Workflow Runtime behavior.`,
      'Sessions use InMemorySessionService. That state is lost when the process exits and is not production persistence.',
      `Streaming uses RunConfig(streaming_mode=StreamingMode.SSE). Official Python google-adk ${version} Runner.run_async has no AbortSignal; host timeout uses asyncio.wait_for and cancellation uses asyncio.Task.cancel.`,
      'Create never installs dependencies or calls a model. Live Gemini Developer API and Vertex AI calls are out of CI.',
      'Go, Java, and Kotlin ADK packages are independently gated future candidates and are not part of this starter.',
      'Context containment uses lstat, realpath, O_NOFOLLOW open when available, and a capped fd read. That is not an atomic path walk and does not prove a TOCTOU-free open against a concurrent replacement of a hop.',
    ];
  }
  const version = packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, '@google/adk');
  return [
    `Python and TypeScript are independent ADK runtimes. This adapter pins @google/adk ${version}, requires Node.js >=20.19, and does not treat Python google-adk versions as interchangeable.`,
    `TypeScript graph Workflow Runtime, SequentialAgent, ParallelAgent, and LoopAgent are not part of this starter. SequentialAgent, ParallelAgent, and LoopAgent are deprecated in the pinned @google/adk ${version} line.`,
    'Sessions use InMemorySessionService. That state is lost when the process exits and is not production persistence.',
    'Cancellation uses Runner.runAsync({ abortSignal }). Timeout uses AbortSignal.timeout. Bounded execution uses RunConfig.maxLlmCalls. The pinned TypeScript SDK turns some model and limit failures into events; the starter rethrows errorMessage so those failures are not silent. Local FunctionTool errors are returned as function responses for the next model turn instead of aborting the run.',
    'Do not run unqualified npx adk; that can download an unrelated public package. This starter runs through node and the generated entrypoint.',
    'Create never installs dependencies or calls a model. Live Gemini Developer API and Vertex AI calls are out of CI.',
    'Go, Java, and Kotlin ADK packages are independently gated future candidates and are not part of this starter.',
    'Context containment uses lstat, realpath, O_NOFOLLOW open when available, and a capped fd read. That is not an atomic path walk and does not prove a TOCTOU-free open against a concurrent replacement of a hop.',
  ];
}

export function googleAdkCapabilities(
  language: 'python' | 'typescript'
): AgentFrameworkAdapterManifest['capabilities'] {
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
              : support === 'native'
                ? [
                    `Google ADK ${language} starter implements ${id} with the pinned SDK APIs and credentialless conformance.`,
                  ]
                : [
                    `Google ADK ${language} sets OTEL_SDK_DISABLED=true unless WORKSPAI_AGENT_TRACING=1, before the ADK SDK is imported. Credentialless conformance observes a non-recording span in a process without opt-in and a recording span in a separate opted-in process.`,
                  ],
          prerequisites:
            id === 'telemetry'
              ? ['Opt in with WORKSPAI_AGENT_TRACING=1. Credentialless runs keep tracing unset.']
              : [],
          limitations:
            support === 'unsupported'
              ? []
              : [
                  ...languageLimitations(language),
                  ...(id === 'typed-tools'
                    ? [
                        'The starter ships read-only Workspai context tools. It does not grant shell, filesystem mutation, Google Search, code execution, MCP, or A2A.',
                      ]
                    : []),
                  ...(id === 'conversation-state'
                    ? [
                        'In-memory session state is local to the process. VertexAiSessionService, DatabaseSessionService, and Agent Engine sessions are unsupported.',
                      ]
                    : []),
                  ...(id === 'telemetry'
                    ? [
                        'OTEL_SDK_DISABLED is process-global. The generated starter is an isolated CLI process; do not import it into a host that still needs OpenTelemetry.',
                      ]
                    : []),
                  ...(id === 'streaming'
                    ? [
                        'Partial text events are emitted as display fragments. The SDK-recognized final response is retained as canonical text and is not re-emitted after streamed fragments. Bidirectional live/voice streaming is unsupported.',
                      ]
                    : []),
                ],
        },
      ];
    })
  ) as AgentFrameworkAdapterManifest['capabilities'];
}

export function googleAdkManifest(
  language: 'python' | 'typescript',
  frameworkVersion: string,
  detection: AgentFrameworkAdapterManifest['detection']
): AgentFrameworkAdapterManifest {
  const runtime = language === 'python' ? 'python' : 'node';
  const adapterId = `google-adk-${language}`;
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
      id: GOOGLE_ADK_FRAMEWORK_ID,
      name: 'Google Agent Development Kit',
      homepage: 'https://adk.dev/',
      license: 'Apache-2.0',
      upstreamStatus: 'stable',
      supportedVersionRange: language === 'python' ? '>=2.9 <3' : '>=2.1 <3',
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
        limitations: [
          'Dependency changes require explicit host admission.',
          'Mixed Python and TypeScript Google ADK evidence is rejected.',
          'Authored SDK versions outside the supported range are rejected.',
        ],
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
    capabilities: googleAdkCapabilities(language),
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

export function pinnedManifestVersion(content: string, packageName: string): string | null {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`"${escaped}"\\s*:\\s*"\\^?v?([0-9][^"]*)"`, 'i'),
    new RegExp(`${escaped}==([0-9][^\\s"']*)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const version = match?.[1]?.replace(/^[vV]/, '');
    if (version && isStableRegistryVersion(version)) return version;
  }
  return null;
}

export function isSupportedGoogleAdkVersion(
  version: string,
  minimumInclusive: string,
  exclusiveMajor: number
): boolean {
  if (!isStableRegistryVersion(version)) return false;
  const major = Number(version.split('.')[0]);
  return (
    Number.isFinite(major) &&
    major === exclusiveMajor - 1 &&
    compareRegistryVersions(version, minimumInclusive) >= 0
  );
}

export function googleAdkMixedProjectBlocker(
  existingFiles: ReadonlyMap<string, string> | undefined
): string | null {
  if (!existingFiles) return null;
  let python = false;
  let typescript = false;
  for (const [pathname, content] of existingFiles) {
    const base = pathname.replaceAll('\\', '/');
    if (
      /(^|\/)(pyproject\.toml|requirements(?:-dev)?\.txt)$/i.test(base) &&
      pinnedManifestVersion(content, 'google-adk')
    ) {
      python = true;
    }
    if (/(^|\/)package\.json$/i.test(base) && pinnedManifestVersion(content, '@google/adk')) {
      typescript = true;
    }
  }
  if (python && typescript) {
    return 'Mixed Google ADK Python and TypeScript evidence is ambiguous. Attach one runtime or split the projects.';
  }
  return null;
}

export function googleAdkUnsupportedVersionBlocker(input: {
  existingFiles?: ReadonlyMap<string, string>;
  packageName: string;
  minimumInclusive: string;
  exclusiveMajor: number;
}): string | null {
  if (!input.existingFiles) return null;
  for (const content of input.existingFiles.values()) {
    const version = pinnedManifestVersion(content, input.packageName);
    if (!version) continue;
    if (!isSupportedGoogleAdkVersion(version, input.minimumInclusive, input.exclusiveMajor)) {
      return `Authored ${input.packageName} ${version} is outside the supported range >=${input.minimumInclusive} <${input.exclusiveMajor}.`;
    }
  }
  return null;
}
