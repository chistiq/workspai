import path from 'node:path';

import chalk from 'chalk';
import type { Command } from 'commander';

import { prompt } from '../cli-ui/prompts.js';
import { resolveProjectWorkspaceSync } from '../project-workspace-link.js';
import { readWorkspaceKnowledgeGraphSnapshot } from '../workspace-knowledge-graph-snapshot.js';
import {
  applyAgentFrameworkAttachmentByChange,
  applyPreparedAgentFrameworkAttachment,
  createBuiltinAgentFrameworkRegistry,
  parseAgentFrameworkRuntime,
  prepareAgentFrameworkAttachment,
  type AgentFrameworkUserRuntime,
  type PreparedAgentFrameworkAttachment,
} from '../agent-frameworks/index.js';

type CommonOptions = {
  workspace?: string;
  project?: string;
  runtime?: string;
  json?: boolean;
};

function workspaceFor(options: CommonOptions): string {
  const resolution = resolveProjectWorkspaceSync({
    startPath: process.cwd(),
    explicitWorkspacePath: options.workspace,
    strict: true,
    requireProjectMembership: !options.workspace,
  });
  if (!resolution) throw new Error('No canonical Workspai workspace could be resolved.');
  return path.resolve(resolution.workspacePath);
}

async function resolveProject(
  workspacePath: string,
  requested: string | undefined,
  interactive: boolean
): Promise<string> {
  const snapshot = await readWorkspaceKnowledgeGraphSnapshot(workspacePath);
  if (snapshot.status === 'miss') {
    throw new Error(
      `Canonical Workspace Model and Graph are required (${snapshot.reason}). Run workspai workspace intelligence run --for-agent generic --strict --json.`
    );
  }
  const projects = snapshot.model.projects
    .map((project) => ({ name: project.name, path: project.path, runtime: project.runtime }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (requested) {
    const matches = projects.filter(
      (project) => project.name === requested || project.path === requested
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Project is not present in the canonical Workspace Model: ${requested}`
          : `Project target is ambiguous: ${requested}`
      );
    }
    return matches[0].name;
  }
  if (projects.length === 1) return projects[0].name;
  if (!interactive)
    throw new Error('--project is required when the workspace has multiple projects.');
  const answer = await prompt<{ project: string }>([
    {
      type: 'rawlist',
      name: 'project',
      message: 'Which project should own this agent?',
      choices: projects.map((project) => ({
        value: project.name,
        label: project.name,
        hint: `${project.runtime} · ${project.path}`,
      })),
    },
  ]);
  return answer.project;
}

async function resolveRuntime(
  requested: string | undefined,
  interactive: boolean
): Promise<AgentFrameworkUserRuntime> {
  if (requested) return parseAgentFrameworkRuntime(requested);
  if (!interactive) throw new Error('--runtime is required. Choose python or dotnet.');
  const answer = await prompt<{ runtime: AgentFrameworkUserRuntime }>([
    {
      type: 'rawlist',
      name: 'runtime',
      message: 'Choose the agent runtime:',
      choices: [
        { value: 'python', label: 'Python', hint: 'Python 3.10+ · tested baseline' },
        { value: 'dotnet', label: '.NET', hint: '.NET 8+ · tested baseline' },
      ],
    },
  ]);
  return answer.runtime;
}

async function resolveInstanceName(
  requested: string | undefined,
  interactive: boolean
): Promise<string> {
  if (requested?.trim()) return requested.trim();
  if (!interactive) throw new Error('--name is required.');
  const answer = await prompt<{ instanceName: string }>([
    {
      type: 'input',
      name: 'instanceName',
      message: 'Name this agent:',
      default: 'workspace-agent',
      validate: (value) => value.trim().length > 0 || 'Agent name is required',
    },
  ]);
  return answer.instanceName.trim();
}

function printPlan(plan: PreparedAgentFrameworkAttachment): void {
  const color =
    plan.status === 'planned' ? chalk.cyan : plan.status === 'no-op' ? chalk.green : chalk.red;
  console.log(color(`◆ Microsoft Agent Framework · ${plan.status}`));
  console.log(chalk.bold(`   ${plan.instanceName} · ${plan.runtime} · ${plan.project}`));
  console.log(chalk.gray(`   Framework: ${plan.frameworkVersion}`));
  console.log(chalk.gray(`   Goal: ${plan.goalId}`));
  console.log(chalk.gray(`   Change: ${plan.changeId}`));
  for (const file of plan.files) console.log(chalk.gray(`   ${file.overwrite}: ${file.path}`));
  if (plan.requiredEnvironment.length > 0) {
    console.log(chalk.gray(`   Secret references: ${plan.requiredEnvironment.join(', ')}`));
  }
  console.log(chalk.gray('   Dependency install: not executed'));
  for (const blocker of plan.blockers) console.log(chalk.red(`   Blocked: ${blocker}`));
  for (const next of plan.nextActions) console.log(chalk.gray(`   Next: ${next}`));
}

function printApplied(result: {
  project: string;
  runtime: string;
  changeId: string;
  files: Array<{ path: string }>;
  ownershipReceipt: string;
  nextActions: string[];
}): void {
  console.log(chalk.green('✔ Governed agent attached'));
  console.log(chalk.bold(`   ${result.runtime} · ${result.project}`));
  console.log(chalk.gray(`   Change: ${result.changeId}`));
  console.log(chalk.gray(`   Managed files: ${result.files.length}`));
  console.log(chalk.gray(`   Ownership: ${result.ownershipReceipt}`));
  console.log(chalk.gray('   Dependencies and model calls were not executed.'));
  for (const next of result.nextActions) console.log(chalk.gray(`   Next: ${next}`));
}

function fail(options: { json?: boolean }, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 'workspai.agent-framework-operation-error.v1',
          status: 'error',
          message,
        },
        null,
        2
      )
    );
  } else {
    console.error(chalk.red(`Agent Framework failed: ${message}`));
  }
  process.exitCode = 1;
}

export function registerAgentFrameworkCommands(agentCommand: Command): void {
  const framework = agentCommand
    .command('framework')
    .description('Create and attach release-admitted agent runtimes through Workspai governance');

  framework
    .command('list')
    .description('List tested framework runtimes and their release-admission state')
    .option('--json', 'Emit machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const registry = createBuiltinAgentFrameworkRegistry(
        {},
        { trustReviewedReleaseAdmissions: true }
      );
      const adapters = registry.list().map((entry) => {
        const resolution = registry.resolveAdapter(entry.manifest.adapter.id);
        return {
          id: entry.manifest.adapter.id,
          framework: entry.manifest.framework.name,
          runtime: entry.manifest.implementation.runtimes[0],
          frameworkVersion: entry.manifest.framework.testedVersions[0],
          status: resolution.status,
          blockers: resolution.blockers,
        };
      });
      const payload = {
        schemaVersion: 'workspai.agent-framework-list.v1',
        adapters,
      };
      if (options.json) console.log(JSON.stringify(payload, null, 2));
      else {
        console.log(chalk.bold('Agent Framework runtimes'));
        for (const adapter of adapters) {
          const icon = adapter.status === 'admitted' ? chalk.green('●') : chalk.red('■');
          console.log(
            `${icon} ${adapter.framework} · ${adapter.runtime} · ${adapter.frameworkVersion} · ${adapter.status}`
          );
        }
      }
    });

  const addSharedOptions = (command: Command) =>
    command
      .option('--workspace <path>', 'Explicit canonical workspace path')
      .option('--project <name>', 'Canonical project name or path')
      .option('--runtime <runtime>', 'python or dotnet')
      .option('--name <name>', 'Agent instance name')
      .option('--goal <goal-id>', 'Reuse an existing ready Goal Pack')
      .option('--intent <text>', 'Plain-language Goal intent when creating a dedicated Goal')
      .option('--json', 'Emit machine-readable JSON');

  addSharedOptions(
    framework
      .command('plan')
      .description('Create a hash-bound attachment plan without writing project files')
  ).action(
    async (
      options: CommonOptions & { name?: string; goal?: string; intent?: string; json?: boolean }
    ) => {
      try {
        const interactive = !options.json && process.stdin.isTTY === true;
        const workspacePath = workspaceFor(options);
        const project = await resolveProject(workspacePath, options.project, interactive);
        const runtime = await resolveRuntime(options.runtime, interactive);
        const instanceName = await resolveInstanceName(options.name, interactive);
        const result = await prepareAgentFrameworkAttachment({
          workspacePath,
          project,
          runtime,
          instanceName,
          goalId: options.goal,
          intent: options.intent,
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else printPlan(result);
        if (result.status === 'blocked') process.exitCode = 2;
      } catch (error) {
        fail(options, error);
      }
    }
  );

  addSharedOptions(
    framework
      .command('attach')
      .description('Plan, approve, and write one isolated governed agent instance')
      .option('-y, --yes', 'Approve the displayed filesystem plan without another prompt')
      .option('--granted-by <identity>', 'Identity recorded in the authorization', 'operator')
  ).action(
    async (
      options: CommonOptions & {
        name?: string;
        goal?: string;
        intent?: string;
        yes?: boolean;
        grantedBy: string;
      }
    ) => {
      try {
        const interactive = !options.json && process.stdin.isTTY === true;
        const workspacePath = workspaceFor(options);
        const project = await resolveProject(workspacePath, options.project, interactive);
        const runtime = await resolveRuntime(options.runtime, interactive);
        const instanceName = await resolveInstanceName(options.name, interactive);
        const prepared = await prepareAgentFrameworkAttachment({
          workspacePath,
          project,
          runtime,
          instanceName,
          goalId: options.goal,
          intent: options.intent,
        });
        if (prepared.status !== 'planned') {
          if (options.json) console.log(JSON.stringify(prepared, null, 2));
          else printPlan(prepared);
          process.exitCode = prepared.status === 'blocked' ? 2 : 0;
          return;
        }
        let approved = options.yes === true;
        if (!approved && interactive) {
          printPlan(prepared);
          const answer = await prompt<{ approved: boolean }>([
            {
              type: 'confirm',
              name: 'approved',
              message: `Write these ${prepared.files.length} Workspai-managed files?`,
              default: false,
            },
          ]);
          approved = answer.approved;
        }
        if (!approved) {
          if (options.json) console.log(JSON.stringify(prepared, null, 2));
          else {
            console.log(chalk.yellow('Plan saved; no project files were written.'));
            console.log(chalk.gray(`   Change: ${prepared.changeId}`));
          }
          return;
        }
        const result = await applyPreparedAgentFrameworkAttachment({
          prepared,
          grantedBy: options.grantedBy,
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else printApplied(result);
      } catch (error) {
        fail(options, error);
      }
    }
  );

  framework
    .command('apply')
    .description('Apply an already authorized hash-bound framework plan')
    .requiredOption('--change <change-id>', 'Proof-Carrying Change id')
    .requiredOption('--project <name>', 'Canonical project name or path')
    .requiredOption('--runtime <runtime>', 'python or dotnet')
    .option('--workspace <path>', 'Explicit canonical workspace path')
    .option('--json', 'Emit machine-readable JSON')
    .action(
      async (
        options: CommonOptions & {
          change: string;
          project: string;
          runtime: string;
          json?: boolean;
        }
      ) => {
        try {
          const result = await applyAgentFrameworkAttachmentByChange({
            workspacePath: workspaceFor(options),
            project: options.project,
            runtime: parseAgentFrameworkRuntime(options.runtime),
            changeId: options.change,
          });
          if (options.json) console.log(JSON.stringify(result, null, 2));
          else printApplied(result);
        } catch (error) {
          fail(options, error);
        }
      }
    );
}
