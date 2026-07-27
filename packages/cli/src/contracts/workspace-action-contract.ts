import type { WorkspaceSubcommand } from '../utils/workspace-command-surface.js';
import {
  WORKSPACE_TRACE_REPORT_PATH,
  WORKSPACE_WHY_REPORT_PATH,
} from './workspace-artifact-paths.js';
import { WORKSPACE_INTELLIGENCE_ARTIFACTS } from './workspace-intelligence-runtime-registry.js';

export type WorkspaceActionContract = {
  usage: string;
  summary: string;
  flags: readonly string[];
  subactions?: readonly string[];
  artifact?: string;
  examples: readonly string[];
};

export const WORKSPACE_ACTION_FLAG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '--workspace': 'Use an explicit workspace root instead of the nearest workspace.',
  '--json': 'Emit machine-readable JSON.',
  '--strict': 'Return a non-zero exit when governed evidence blocks the result.',
  '--for-agent': 'Build output for an agent surface (for example codex, copilot, or cursor).',
  '--include-paths': 'Include absolute filesystem paths.',
  '--include-evidence': 'Read and include referenced evidence metadata.',
  '--scan-depth': 'Set the bounded observable-project discovery depth.',
  '--cache': 'Reuse the model cache when the structural inputs are unchanged.',
  '--incremental': 'Reuse unchanged projects and rebuild affected graph relations.',
  '--write': 'Persist the command artifact under .workspai/reports.',
  '--scope': 'Limit the operation to a bounded scope such as project:<name>.',
  '--dry-run': 'Preview the operation without applying writes.',
  '--preset': 'Select the generated agent customization preset.',
  '--refresh-context': 'Rebuild agent context before synchronization.',
  '--refresh': 'Refresh the underlying registry or context before reading it.',
  '--agent-sync': 'Synchronize agent grounding after writing the context artifact.',
  '--no-agent-sync': 'Do not synchronize agent grounding after writing context.',
  '--target': 'Select one or more agent customization targets.',
  '--experimental-hooks': 'Generate advisory VS Code agent hook design files.',
  '--hydrate-prompts': 'Add workspace-specific verification steps to supported prompts.',
  '--project-grounding': 'Select the project entrypoint policy: managed, local, or off.',
  '--ci': 'Produce a CI-oriented command plan.',
  '--from': 'Read the specified baseline, report, or graph artifact.',
  '--from-impact': 'Read the specified impact report for verification.',
  '--output': 'Write the requested export or report to this path.',
  '--limit': 'Bound graph query results (1–100).',
  '--once': 'Build the initial observed state and exit.',
  '--graph-stream': 'Emit graph snapshot/delta events as NDJSON.',
  '--force': 'Replace an existing generated target where supported.',
  '--no-doctor': 'Exclude Doctor evidence from a share bundle.',
  '--no-blueprint': 'Exclude the reproducibility blueprint from a share bundle.',
  '--include-env': 'Include private environment files in an export archive.',
  '--archive-compression': 'Select the archive compression format.',
  '--max-download-size': 'Bound a remote archive download.',
  '--max-expanded-size': 'Bound the expanded archive size.',
  '--download-timeout-ms': 'Bound remote archive download time.',
  '--allow-private-network': 'Allow private-network archive sources explicitly.',
  '--affected': 'Run only projects affected by the selected Git change.',
  '--blast-radius': 'Include transitive downstream dependents.',
  '--since': 'Select the Git baseline used for affected-project discovery.',
  '--parallel': 'Run selected projects concurrently.',
  '--max-workers': 'Bound concurrent project workers.',
  '--continue-on-error': 'Continue remaining projects after a project failure.',
  '--reuse-passed': 'Reuse successful project-stage results where safe.',
  '--no-gates': 'Skip Doctor and Readiness pre-run gates.',
};

export const WORKSPACE_ACTION_CONTRACTS = {
  list: {
    usage: 'workspai workspace list [--json]',
    summary: 'List registered Workspai workspaces.',
    flags: ['--json'],
    examples: ['workspai workspace list', 'workspai workspace list --json'],
  },
  intelligence: {
    usage: 'workspai workspace intelligence run [--for-agent <agent>] [--strict] [--json]',
    summary: 'Run the canonical Workspace Intelligence chain in contract order.',
    flags: ['--workspace', '--json', '--strict', '--for-agent'],
    subactions: ['run'],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.intelligenceRun,
    examples: [
      'workspai workspace intelligence run --strict',
      'workspai workspace intelligence run --for-agent codex --json',
    ],
  },
  model: {
    usage: 'workspai workspace model [--cache|--incremental] [--write] [--strict] [--json]',
    summary: 'Build the canonical workspace model from registered and observed sources.',
    flags: [
      '--workspace',
      '--json',
      '--include-paths',
      '--include-evidence',
      '--scan-depth',
      '--cache',
      '--incremental',
      '--write',
      '--strict',
    ],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.model,
    examples: [
      'workspai workspace model --write --json',
      'workspai workspace model --incremental --write --json',
    ],
  },
  'agent-sync': {
    usage:
      'workspai workspace agent-sync [--for-agent <agent>] [--target <targets>] [--project-grounding <mode>] [--write]',
    summary: 'Synchronize bounded workspace grounding for supported agent surfaces.',
    flags: [
      '--workspace',
      '--json',
      '--scope',
      '--for-agent',
      '--write',
      '--dry-run',
      '--strict',
      '--preset',
      '--refresh-context',
      '--refresh',
      '--target',
      '--experimental-hooks',
      '--hydrate-prompts',
      '--project-grounding',
    ],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.agentCustomizationPack,
    examples: [
      'workspai workspace agent-sync --target all --write --strict',
      'workspai workspace agent-sync --for-agent copilot --dry-run --json',
    ],
  },
  'remediation-plan': {
    usage: 'workspai workspace remediation-plan [--ci] [--write] [--json]',
    summary: 'Build a governed repair plan from current workspace evidence.',
    flags: ['--workspace', '--json', '--include-paths', '--ci', '--write'],
    artifact: '.workspai/reports/artifact-remediation-plan-last-run.json',
    examples: [
      'workspai workspace remediation-plan --write --json',
      'workspai workspace remediation-plan --ci --json',
    ],
  },
  context: {
    usage: 'workspai workspace context [--for-agent <agent>] [--scope <scope>] [--write] [--json]',
    summary: 'Build a bounded, evidence-backed context pack for people and agents.',
    flags: [
      '--workspace',
      '--json',
      '--for-agent',
      '--scope',
      '--include-evidence',
      '--scan-depth',
      '--write',
      '--agent-sync',
      '--no-agent-sync',
      '--preset',
      '--target',
      '--strict',
      '--project-grounding',
    ],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.agentContext,
    examples: [
      'workspai workspace context --for-agent codex --write --json',
      'workspai workspace context --scope project:api --json',
    ],
  },
  snapshot: {
    usage: 'workspai workspace snapshot [--json]',
    summary: 'Persist the current model as the comparison baseline.',
    flags: ['--workspace', '--json', '--include-paths', '--include-evidence', '--scan-depth'],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.snapshot,
    examples: ['workspai workspace snapshot --json'],
  },
  diff: {
    usage: 'workspai workspace diff [--from <snapshot>] [--strict] [--json]',
    summary: 'Compare the current model with a trusted model baseline.',
    flags: [
      '--workspace',
      '--json',
      '--from',
      '--include-paths',
      '--include-evidence',
      '--scan-depth',
      '--strict',
    ],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.diff,
    examples: [
      'workspai workspace diff --json',
      'workspai workspace diff --from .workspai/reports/workspace-model-snapshot.json --json',
    ],
  },
  impact: {
    usage: 'workspai workspace impact [--from <diff>] [--scope <scope>] [--strict] [--json]',
    summary: 'Calculate the evidence-backed blast radius of the current model change.',
    flags: [
      '--workspace',
      '--json',
      '--from',
      '--scope',
      '--include-paths',
      '--include-evidence',
      '--scan-depth',
      '--strict',
    ],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.impact,
    examples: [
      'workspai workspace impact --json',
      'workspai workspace impact --from .workspai/reports/workspace-model-diff-last-run.json --strict --json',
    ],
  },
  verify: {
    usage:
      'workspai workspace verify [--from-impact <impact-report>] [--scope <scope>] [--strict] [--json]',
    summary: 'Verify the selected change against contracts, gates, and current evidence.',
    flags: [
      '--workspace',
      '--json',
      '--from-impact',
      '--scope',
      '--include-paths',
      '--include-evidence',
      '--scan-depth',
      '--strict',
    ],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.verify,
    examples: [
      'workspai workspace verify --strict --json',
      'workspai workspace verify --from-impact .workspai/reports/workspace-impact-last-run.json --json',
    ],
  },
  graph: {
    usage: 'workspai workspace graph [mode] [query|from] [to] [--json]',
    summary: 'Build, query, prove, compare, or export the workspace graph.',
    flags: [
      '--workspace',
      '--json',
      '--output',
      '--from',
      '--limit',
      '--include-paths',
      '--include-evidence',
      '--scan-depth',
      '--scope',
    ],
    subactions: [
      'emit',
      'explain',
      'entities',
      'search',
      'evidence',
      'path',
      'overlay',
      'benchmark',
      'dot',
      'mermaid',
      'jsonld',
      'graphml',
      'gexf',
    ],
    examples: [
      'workspai workspace graph search "authentication endpoint" --limit 12 --json',
      'workspai workspace graph evidence "GET /users" --json',
      'workspai workspace graph mermaid',
    ],
  },
  watch: {
    usage: 'workspai workspace watch [--once] [--graph-stream] [--json]',
    summary: 'Observe model changes and optionally stream graph deltas.',
    flags: ['--workspace', '--json', '--once', '--graph-stream', '--scan-depth'],
    examples: ['workspai workspace watch --once --json', 'workspai workspace watch --graph-stream'],
  },
  sync: {
    usage: 'workspai workspace sync [--project-grounding <mode>] [--json]',
    summary: 'Synchronize canonical workspace registration and project metadata.',
    flags: ['--workspace', '--json', '--project-grounding'],
    examples: ['workspai workspace sync --json'],
  },
  registry: {
    usage: 'workspai workspace registry [--refresh] [--json]',
    summary: 'Inspect the canonical workspace registry summary.',
    flags: ['--workspace', '--json', '--refresh'],
    examples: ['workspai workspace registry --refresh --json'],
  },
  foundation: {
    usage: 'workspai workspace foundation [--force] [--json]',
    summary: 'Create or repair the standard workspace foundation files.',
    flags: ['--workspace', '--json', '--force'],
    examples: ['workspai workspace foundation --json'],
  },
  policy: {
    usage: 'workspai workspace policy [show|status|get|set] [key] [value] [--json]',
    summary: 'Inspect or update workspace governance policy.',
    flags: ['--workspace', '--json'],
    subactions: ['show', 'status', 'get', 'set'],
    examples: ['workspai workspace policy get --json'],
  },
  contract: {
    usage: 'workspai workspace contract [init|inspect|verify|graph] [--strict] [--json]',
    summary: 'Create, inspect, verify, or project the workspace contract.',
    flags: ['--workspace', '--json', '--output', '--force', '--strict'],
    subactions: ['init', 'inspect', 'verify', 'graph'],
    artifact: '.workspai/workspace.contract.json',
    examples: [
      'workspai workspace contract verify --strict --json',
      'workspai workspace contract graph --json',
    ],
  },
  share: {
    usage: 'workspai workspace share [--output <file>] [--json]',
    summary: 'Create a bounded, shareable workspace evidence bundle.',
    flags: [
      '--workspace',
      '--json',
      '--output',
      '--include-paths',
      '--no-doctor',
      '--no-blueprint',
    ],
    examples: ['workspai workspace share --output workspace-share.json --json'],
  },
  export: {
    usage: 'workspai workspace export [--output <archive>] [--archive-compression <format>]',
    summary: 'Export a portable workspace archive.',
    flags: ['--workspace', '--json', '--output', '--include-env', '--archive-compression'],
    examples: ['workspai workspace export --output workspace.tar.gz'],
  },
  archive: {
    usage: 'workspai workspace archive <inspect|verify|doctor> <source> [safety options] [--json]',
    summary: 'Inspect, verify, or diagnose a portable workspace archive without materializing it.',
    flags: [
      '--json',
      '--strict',
      '--max-download-size',
      '--max-expanded-size',
      '--download-timeout-ms',
      '--allow-private-network',
    ],
    subactions: ['inspect', 'verify', 'doctor'],
    examples: [
      'workspai workspace archive inspect ./workspace.tar.gz --json',
      'workspai workspace archive verify ./workspace.tar.gz --strict --json',
      'workspai workspace archive doctor ./workspace.tar.gz --json',
    ],
  },
  hydrate: {
    usage: 'workspai workspace hydrate <source> [--output <directory>] [--dry-run] [--json]',
    summary: 'Hydrate a portable workspace into a controlled destination.',
    flags: [
      '--json',
      '--output',
      '--force',
      '--dry-run',
      '--strict',
      '--max-download-size',
      '--max-expanded-size',
      '--download-timeout-ms',
      '--allow-private-network',
    ],
    examples: ['workspai workspace hydrate workspace.tar.gz --output ./restored --dry-run --json'],
  },
  import: {
    usage: 'workspai workspace import <source> [--output <directory>] [--dry-run] [--json]',
    summary: 'Import and register a portable workspace safely.',
    flags: [
      '--json',
      '--output',
      '--force',
      '--dry-run',
      '--strict',
      '--max-download-size',
      '--max-expanded-size',
      '--download-timeout-ms',
      '--allow-private-network',
    ],
    examples: ['workspai workspace import workspace.tar.gz --output ./imported --json'],
  },
  run: {
    usage: 'workspai workspace run <stage> [selection and concurrency options] [--json]',
    summary: 'Run a lifecycle stage across selected workspace projects.',
    flags: [
      '--workspace',
      '--json',
      '--scope',
      '--affected',
      '--blast-radius',
      '--since',
      '--parallel',
      '--max-workers',
      '--continue-on-error',
      '--reuse-passed',
      '--strict',
      '--no-gates',
    ],
    subactions: ['init', 'test', 'build', 'start', '<custom-from-context>'],
    artifact: '.workspai/reports/workspace-run-last.json',
    examples: [
      'workspai workspace run test --affected --blast-radius --strict',
      'workspai workspace run build --parallel --max-workers 4 --json',
    ],
  },
  explain: {
    usage: 'workspai workspace explain [target] [--scope <scope>] [--write] [--json]',
    summary: 'Explain current blockers or a selected workspace target from evidence.',
    flags: ['--workspace', '--json', '--scope', '--write'],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.explain,
    examples: ['workspai workspace explain --write --json'],
  },
  why: {
    usage: 'workspai workspace why [target] [--scope <scope>] [--write] [--json]',
    summary: 'Alias the evidence-backed workspace explanation flow.',
    flags: ['--workspace', '--json', '--scope', '--write'],
    artifact: WORKSPACE_WHY_REPORT_PATH,
    examples: ['workspai workspace why readiness --json'],
  },
  trace: {
    usage: 'workspai workspace trace --from <diff-artifact> [--write] [--json]',
    summary: 'Trace a model change through blast radius and decision gates.',
    flags: ['--workspace', '--json', '--from', '--write'],
    artifact: WORKSPACE_TRACE_REPORT_PATH,
    examples: [
      'workspai workspace trace --from .workspai/reports/workspace-model-diff-last-run.json --write --json',
    ],
  },
  feedback: {
    usage: "echo '<event-json>' | workspai workspace feedback record --json",
    summary: 'Record a structured outcome event for the workspace intelligence history.',
    flags: ['--workspace', '--json'],
    subactions: ['record'],
    examples: [
      'echo \'{"actionId":"fix","summary":"ok","outcome":"ok"}\' | workspai workspace feedback record --json',
    ],
  },
  eval: {
    usage: 'workspai workspace eval [init|record|status|report|compare] [arguments] [--json]',
    summary: 'Measure agent/model calls, tool use, tokens, latency, and verified outcome.',
    flags: ['--workspace', '--json', '--from', '--output'],
    subactions: ['init', 'record', 'status', 'report', 'compare'],
    artifact: WORKSPACE_INTELLIGENCE_ARTIFACTS.evaluationLastRun,
    examples: [
      'workspai workspace eval init repair-readiness workspace-intelligence --json',
      'workspai workspace eval report --output ./evaluation.json --json',
    ],
  },
  mcp: {
    usage: 'workspai workspace mcp serve',
    summary: 'Serve bounded, read-mostly workspace evidence over stdio MCP.',
    flags: ['--workspace', '--json'],
    subactions: ['serve'],
    examples: ['workspai workspace mcp serve'],
  },
  init: {
    usage: 'workspai workspace init [selection and concurrency options] [--json]',
    summary: 'Initialize all selected projects through the workspace fleet runner.',
    flags: [
      '--workspace',
      '--json',
      '--scope',
      '--parallel',
      '--max-workers',
      '--continue-on-error',
      '--reuse-passed',
      '--strict',
      '--no-gates',
    ],
    artifact: '.workspai/reports/workspace-run-last.json',
    examples: ['workspai workspace init --parallel --strict'],
  },
} as const satisfies Readonly<Record<WorkspaceSubcommand, WorkspaceActionContract>>;

export type WorkspaceActionName = keyof typeof WORKSPACE_ACTION_CONTRACTS;

export function getWorkspaceActionContract(
  action: string | undefined
): WorkspaceActionContract | undefined {
  if (!action) return undefined;
  return WORKSPACE_ACTION_CONTRACTS[action as WorkspaceActionName];
}

export function isWorkspaceActionHelpRequest(args: readonly string[]): boolean {
  return (
    args[0] === 'workspace' &&
    Boolean(getWorkspaceActionContract(args[1])) &&
    args.slice(2).some((argument) => argument === '--help' || argument === '-h')
  );
}

export function workspaceActionFlagDescription(flag: string): string {
  const description = WORKSPACE_ACTION_FLAG_DESCRIPTIONS[flag];
  if (!description) {
    throw new Error(`Workspace action flag has no description: ${flag}`);
  }
  return description;
}

export function renderWorkspaceActionHelp(action: string): string {
  const contract = getWorkspaceActionContract(action);
  if (!contract) {
    throw new Error(`Unknown workspace action: ${action}`);
  }
  const lines = [
    `Workspai workspace ${action}`,
    '',
    contract.summary,
    '',
    'Usage:',
    `  ${contract.usage}`,
  ];
  if (contract.subactions && contract.subactions.length > 0) {
    lines.push('', 'Modes:', `  ${contract.subactions.join(' | ')}`);
  }
  if (contract.flags.length > 0) {
    lines.push('', 'Options:');
    for (const flag of contract.flags) {
      lines.push(`  ${flag.padEnd(24)} ${workspaceActionFlagDescription(flag)}`.trimEnd());
    }
  }
  if (contract.artifact) {
    lines.push('', 'Evidence:', `  ${contract.artifact}`);
  }
  lines.push('', 'Examples:', ...contract.examples.map((example) => `  ${example}`), '');
  return lines.join('\n');
}
