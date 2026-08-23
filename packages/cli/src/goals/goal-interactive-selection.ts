import { prompt } from '../cli-ui/prompts.js';
import type {
  GoalCoverageRuntimeSelectionRequest,
  GoalScopeSelection,
  GoalScopeSelectionRequest,
} from '../goal-pack.js';

function projectHint(project: GoalScopeSelectionRequest['projects'][number]): string {
  const runtimes = project.runtimeCandidates.length
    ? project.runtimeCandidates.join(', ')
    : project.runtime;
  return `${project.framework} · ${runtimes}`;
}

export async function selectGoalScopeInteractively(
  input: GoalScopeSelectionRequest
): Promise<GoalScopeSelection> {
  const mode = await prompt<{ mode: 'project' | 'project-set' | 'workspace' }>([
    {
      type: 'list',
      name: 'mode',
      message: 'Where should this Goal apply?',
      choices: [
        {
          label: 'One project',
          hint: 'Keep the Goal inside one canonical project boundary',
          value: 'project',
        },
        {
          label: 'Multiple projects',
          hint: 'Select a bounded cross-project scope',
          value: 'project-set',
        },
        {
          label: 'Entire workspace',
          hint: `Apply the Goal to every project in ${input.workspaceName}`,
          value: 'workspace',
        },
      ],
    },
  ]);
  if (mode.mode === 'workspace') return { kind: 'workspace' };
  if (mode.mode === 'project') {
    const selected = await prompt<{ project: string }>([
      {
        type: 'list',
        name: 'project',
        message: 'Which project should this Goal target?',
        choices: input.projects.map((project) => ({
          label: project.name,
          hint: projectHint(project),
          value: project.name,
        })),
      },
    ]);
    return { kind: 'projects', projects: [selected.project] };
  }
  const selected = await prompt<{ projects: string[] }>([
    {
      type: 'checkbox',
      name: 'projects',
      message: 'Which projects should this Goal target?',
      choices: input.projects.map((project) => ({
        label: project.name,
        hint: projectHint(project),
        value: project.name,
      })),
    },
  ]);
  if (selected.projects.length < 2) {
    throw new Error('Select at least two projects for a multi-project Goal.');
  }
  return { kind: 'projects', projects: selected.projects };
}

export async function selectGoalCoverageRuntimeInteractively(
  input: GoalCoverageRuntimeSelectionRequest
): Promise<(typeof input.runtimes)[number]> {
  const runtimeProjects = new Map(
    input.runtimes.map((runtime) => [
      runtime,
      input.projects
        .filter((project) => project.runtimeCandidates.includes(runtime))
        .map((project) => project.name)
        .sort(),
    ])
  );
  const selected = await prompt<{ runtime: (typeof input.runtimes)[number] }>([
    {
      type: 'list',
      name: 'runtime',
      message: 'Which canonical runtime should this coverage Goal measure?',
      choices: input.runtimes.map((runtime) => ({
        label: runtime,
        hint: `Detected in ${runtimeProjects.get(runtime)?.join(', ') || input.workspaceName}`,
        value: runtime,
      })),
    },
  ]);
  return selected.runtime;
}
