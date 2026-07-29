import chalk from 'chalk';

import { formatWorkspaceCdCommand } from '../utils/workspace-create-location.js';

export interface WorkspaceCreationReceiptInput {
  workspaceName: string;
  workspacePath: string;
  profile: string;
  projectCount?: number;
  pythonEngine?: 'installed' | 'skipped';
  pythonVersion?: string;
  installMethod?: string;
  note?: string;
}

export function workspaceCreationReceiptLines(input: WorkspaceCreationReceiptInput): string[] {
  const projectCount = input.projectCount ?? 0;
  const projects = projectCount === 1 ? 'project' : 'projects';
  const foundation =
    input.pythonEngine === 'installed'
      ? `Python ${input.pythonVersion || '3.10+'} · ${input.installMethod || 'local environment'}`
      : input.pythonEngine === 'skipped'
        ? 'Python engine not installed'
        : 'Runtime-neutral foundation';

  return [
    '',
    '✓ Workspace ready',
    `${input.workspaceName} · ${input.profile} · ${projectCount} registered ${projects}`,
    `Location  ${input.workspacePath}`,
    `Runtime   ${foundation}`,
    ...(input.note ? [`Note      ${input.note}`] : []),
    '',
    'Workspace Intelligence',
    '  ✓ Contract and project registry',
    '  ✓ Canonical model and proof-backed graph',
    '  ✓ Agent context, grounding, and evidence index',
    '',
    'Next',
    `  ${formatWorkspaceCdCommand(input.workspacePath)}`,
    '  npx workspai create',
    '  npx workspai workspace intelligence run --for-agent generic --strict --json',
    '',
    'Evidence  .workspai/reports/INDEX.json',
    'Guide     README.md',
    '',
  ];
}

export function printWorkspaceCreationReceipt(input: WorkspaceCreationReceiptInput): void {
  const lines = workspaceCreationReceiptLines(input);
  for (const line of lines) {
    if (line === '✓ Workspace ready') {
      console.log(chalk.green.bold(line));
    } else if (line === 'Workspace Intelligence' || line === 'Next') {
      console.log(chalk.cyan.bold(line));
    } else if (line.startsWith('  ✓')) {
      console.log(chalk.green(line));
    } else if (line.startsWith('Location') || line.startsWith('Runtime')) {
      console.log(chalk.gray(line));
    } else {
      console.log(line);
    }
  }
}
