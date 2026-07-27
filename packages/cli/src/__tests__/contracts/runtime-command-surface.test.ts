import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { listFrontendGenerators } from '../../frontend-project';
import { PROJECT_CAPABILITY_COMMANDS } from '../../utils/project-command-capabilities';
import { getRuntimeSupport } from '../../utils/support-matrix';
import { buildRuntimeCommandSurfaceContract } from '../../contracts/runtime-command-surface-contract';
import {
  WORKSPACE_INTELLIGENCE_SUBCOMMANDS,
  WORKSPACE_SUBCOMMANDS,
} from '../../utils/workspace-command-surface';
import {
  WORKSPACE_ACTION_CONTRACTS,
  workspaceActionFlagDescription,
} from '../../contracts/workspace-action-contract';

type RuntimeSurfaceContract = {
  schemaVersion: string;
  lifecycleCommands: string[];
  coreProjectCommands: string[];
  npmOwnedTopLevelCommands: string[];
  npmOwnedScopedCommands: string[][];
  commandDocumentation: Array<{
    invocation: string;
    summary: string;
    canonicalArgv: string[];
    input?: {
      transport: string;
      mediaType: string;
      required: boolean;
      schemaVersion: string;
      contractPath: string;
    };
    output?: {
      defaultFormat: string;
      modes?: Array<{ selector: string; format: string; mediaType: string }>;
    };
    exitSemantics?: { default: string; strict: string; failure: string };
  }>;
  artifactContracts: Array<{
    artifactPath: string;
    schemaVersion: string;
    contractPath: string;
    producerCommands: string[][];
  }>;
  workspaceSubcommands: string[];
  workspaceActions: Array<{
    id: string;
    usage: string;
    summary: string;
    options: Array<{ flag: string; description: string }>;
    subactions: string[];
    artifact: string | null;
    examples: string[];
  }>;
  workspaceIntelligenceSubcommands: string[];
  moduleMutationCommands: string[];
  globalCommands: string[];
  universalCommands: string[];
  moduleSuggestionFrameworks: string[];
  moduleUnsupportedFrameworks: string[];
  scaffoldKits: string[];
  runtimeMatrix: Record<
    string,
    {
      tier: string;
      scaffold: boolean;
      import: boolean;
      moduleCommands: boolean;
      doctor: string;
      lifecycleCommands: string[];
    }
  >;
};

function resolveContractPath(): string {
  const explicitPath = process.env.RAPIDKIT_RUNTIME_COMMAND_SURFACE_CONTRACT;
  if (explicitPath?.trim()) {
    return path.resolve(explicitPath.trim());
  }

  const candidates = [
    path.resolve(process.cwd(), '..', 'contracts', 'runtime-command-surface.v1.json'),
    path.resolve(process.cwd(), 'contracts', 'runtime-command-surface.v1.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function readContract(): RuntimeSurfaceContract {
  const contractPath = resolveContractPath();
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Runtime command surface contract not found: ${contractPath}`);
  }
  return JSON.parse(fs.readFileSync(contractPath, 'utf8')) as RuntimeSurfaceContract;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('shared runtime command surface contract (npm)', () => {
  it('pins schema and project capability command sets', () => {
    const contract = readContract();

    expect(contract.schemaVersion).toBe('rapidkit-runtime-command-surface-v1');
    expect(sorted(PROJECT_CAPABILITY_COMMANDS)).toEqual(
      sorted([
        ...contract.universalCommands,
        ...contract.lifecycleCommands,
        ...(contract.coreProjectCommands ?? []),
        ...contract.moduleMutationCommands,
        ...contract.globalCommands,
      ])
    );
  });

  it('publishes the canonical workspace command surface for IDE/CI capability detection', () => {
    const contract = readContract();

    expect(contract.workspaceSubcommands).toEqual([...WORKSPACE_SUBCOMMANDS]);
    expect(contract.workspaceIntelligenceSubcommands).toEqual([
      ...WORKSPACE_INTELLIGENCE_SUBCOMMANDS,
    ]);

    // Intelligence subcommands must be a subset of the full workspace surface so
    // consumers can gate the intelligence chain without regex-parsing --help.
    for (const subcommand of contract.workspaceIntelligenceSubcommands) {
      expect(contract.workspaceSubcommands).toContain(subcommand);
    }
    expect(contract.workspaceIntelligenceSubcommands).toEqual(
      expect.arrayContaining([
        'contract',
        'graph',
        'watch',
        'explain',
        'why',
        'trace',
        'feedback',
        'mcp',
      ])
    );
  });

  it('publishes command-specific workspace usage, options, modes, and evidence from one registry', () => {
    const contract = readContract();

    expect(contract.workspaceActions).toEqual(
      WORKSPACE_SUBCOMMANDS.map((id) => {
        const descriptor = WORKSPACE_ACTION_CONTRACTS[id];
        return {
          id,
          usage: descriptor.usage,
          summary: descriptor.summary,
          options: descriptor.flags.map((flag) => ({
            flag,
            description: workspaceActionFlagDescription(flag),
          })),
          subactions: 'subactions' in descriptor ? [...descriptor.subactions] : [],
          artifact: 'artifact' in descriptor ? descriptor.artifact : null,
          examples: [...descriptor.examples],
        };
      })
    );
    expect(contract.workspaceActions.map((entry) => entry.id)).toEqual([...WORKSPACE_SUBCOMMANDS]);
  });

  it('publishes the complete npm-owned root and scoped command surface', async () => {
    const contract = readContract();
    const { NPM_ONLY_SCOPED_COMMANDS, NPM_ONLY_TOP_LEVEL_COMMANDS } =
      await import('../../utils/cli-command-surface');

    expect(contract.npmOwnedTopLevelCommands).toEqual([...NPM_ONLY_TOP_LEVEL_COMMANDS]);
    expect(contract.npmOwnedScopedCommands).toEqual(
      NPM_ONLY_SCOPED_COMMANDS.map((command) => [...command])
    );
    expect(contract.npmOwnedTopLevelCommands).toEqual(
      expect.arrayContaining(['pipeline', 'adopt', 'import', 'bootstrap', 'setup'])
    );
  });

  it('publishes artifact-to-command-to-contract relationships', () => {
    const contract = readContract();
    expect(contract.artifactContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactPath: '.workspai/reports/pipeline-last-run.json',
          contractPath: 'contracts/pipeline-last-run.v1.json',
          producerCommands: [['pipeline']],
        }),
        expect.objectContaining({
          artifactPath: '.workspai/reports/workspace-model.json',
          contractPath: 'contracts/workspace-intelligence/workspace-model.v1.json',
          producerCommands: [expect.arrayContaining(['workspace', 'model'])],
        }),
        expect.objectContaining({
          artifactPath: '.workspai/reports/workspace-intelligence-history.json',
          contractPath: 'contracts/workspace-intelligence/workspace-intelligence-history.v1.json',
          producerCommands: expect.arrayContaining([['workspace', 'feedback', 'record', '--json']]),
        }),
      ])
    );
  });

  it('publishes machine-readable operational semantics for non-trivial commands', () => {
    const contract = readContract();
    const documentation = new Map(
      contract.commandDocumentation.map((entry) => [entry.invocation, entry])
    );

    expect(documentation.get('workspace feedback')).toEqual(
      expect.objectContaining({
        canonicalArgv: ['workspace', 'feedback', 'record', '--json'],
        input: expect.objectContaining({
          transport: 'stdin',
          mediaType: 'application/json',
          required: true,
          schemaVersion: 'agent-action-outcome.v1',
          contractPath: 'contracts/workspace-intelligence/agent-action-outcome.v1.json',
        }),
      })
    );
    expect(documentation.get('workspace graph')?.output?.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: 'entities [kind] --json', format: 'json' }),
        expect.objectContaining({
          selector: 'evidence <id-or-unique-label> --json',
          format: 'json',
        }),
        expect.objectContaining({ selector: 'path <from> <to> --json', format: 'json' }),
        expect.objectContaining({
          selector: 'overlay --from <graph> --json',
          format: 'json',
        }),
        expect.objectContaining({ selector: 'dot', format: 'raw-text' }),
        expect.objectContaining({ selector: 'mermaid', format: 'raw-text' }),
        expect.objectContaining({ selector: 'jsonld', mediaType: 'application/ld+json' }),
        expect.objectContaining({ selector: 'graphml', mediaType: 'application/graphml+xml' }),
        expect.objectContaining({ selector: 'gexf', mediaType: 'application/gexf+xml' }),
      ])
    );
    expect(documentation.get('workspace eval')?.output?.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: 'init <task> [strategy] --json' }),
        expect.objectContaining({ selector: 'record --json' }),
        expect.objectContaining({ selector: 'report --json' }),
        expect.objectContaining({ selector: 'compare --from <report> --json' }),
      ])
    );
    expect(documentation.get('pipeline')?.exitSemantics).toEqual(
      expect.objectContaining({
        default: expect.stringContaining('exit code 0'),
        strict: expect.stringContaining('--strict'),
        failure: expect.stringContaining('every mode'),
      })
    );
  });

  it('requires a distinct command-specific operational summary for every command', () => {
    const contract = readContract();
    const genericSummary =
      /^Expose the supported .+ capability through the canonical Workspai CLI boundary\.$/;
    const summaries = new Set<string>();

    for (const descriptor of contract.commandDocumentation) {
      expect(descriptor.summary, descriptor.invocation).not.toMatch(genericSummary);
      expect(descriptor.summary.trim().length, descriptor.invocation).toBeGreaterThanOrEqual(45);
      expect(summaries.has(descriptor.summary), descriptor.invocation).toBe(false);
      summaries.add(descriptor.summary);
    }
  });

  it('matches npm runtime support matrix exactly', () => {
    const contract = readContract();

    for (const [runtime, expected] of Object.entries(contract.runtimeMatrix)) {
      const actual = getRuntimeSupport(runtime);
      expect(actual.tier, runtime).toBe(expected.tier);
      expect(actual.scaffoldSupport, runtime).toBe(expected.scaffold);
      expect(actual.importSupport, runtime).toBe(expected.import);
      expect(actual.moduleCommands, runtime).toBe(expected.moduleCommands);
      expect(actual.doctorSupport, runtime).toBe(expected.doctor);
      expect(actual.lifecycleCommands, runtime).toEqual(expected.lifecycleCommands);
    }
  });

  it('keeps npm and rapidkit-vscode runtime surfaces semantically aligned', () => {
    const npmContractPath = path.resolve(
      process.cwd(),
      'contracts',
      'runtime-command-surface.v1.json'
    );
    const extensionContractPath = path.resolve(
      process.cwd(),
      '..',
      'rapidkit-vscode',
      'contracts',
      'runtime-command-surface.v1.json'
    );

    if (!fs.existsSync(npmContractPath) || !fs.existsSync(extensionContractPath)) {
      return;
    }

    const npmContract = JSON.parse(
      fs.readFileSync(npmContractPath, 'utf8')
    ) as RuntimeSurfaceContract;
    const extensionContract = JSON.parse(
      fs.readFileSync(extensionContractPath, 'utf8')
    ) as RuntimeSurfaceContract;

    expect(npmContract).toEqual(extensionContract);
  });

  it('keeps module marketplace support restricted to first-class Core-backed frameworks', () => {
    const contract = readContract();
    const generated = buildRuntimeCommandSurfaceContract();

    expect(contract.moduleSuggestionFrameworks).toEqual(generated.moduleSuggestionFrameworks);
    expect(contract.moduleUnsupportedFrameworks).toEqual(generated.moduleUnsupportedFrameworks);
  });

  it('keeps official frontend generators in the canonical scaffold surface', () => {
    const contract = readContract();
    const frontendKits = listFrontendGenerators().map((definition) => definition.kitId);

    expect(contract.scaffoldKits).toEqual(expect.arrayContaining(frontendKits));
  });
});
