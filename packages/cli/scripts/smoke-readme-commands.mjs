import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const cliPath = path.join(root, 'dist', 'index.js');

const commandMatrix = [
  { args: ['--help'], expect: [/Usage:/i, /workspai/i] },
  { args: ['create', 'workspace', '--help'], expect: [/create workspace/i, /--profile/i] },
  { args: ['adopt', '--help'], expect: [/adopt/i, /--workspace/i] },
  { args: ['create', '--help'], expect: [/create/i, /--help/i] },
  {
    args: ['agent', 'context', '--help'],
    expect: [/--project/i, /--task/i, /--for-agent/i],
  },
  { args: ['setup', '--help'], expect: [/Usage: workspai setup/i] },
  {
    args: ['doctor', 'workspace', '--help'],
    expect: [/Usage: workspai doctor/i, /--workspace/i, /--fix/i],
  },
  {
    args: ['doctor', 'project', '--help'],
    expect: [/Usage: workspai doctor/i, /--project/i],
  },
  { args: ['cache', '--help'], expect: [/Usage: workspai cache/i] },
  {
    args: ['mirror', '--help'],
    expect: [/Usage: workspai mirror/i, /status\|sync\|verify\|rotate/i],
  },
  {
    args: ['workspace', '--help'],
    expect: [/Intelligence consumers/i, /graph/i, /eval/i, /mcp/i],
  },
];

const failures = [];

for (const command of commandMatrix) {
  const { args, expect } = command;
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 20000,
  });

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const hasExpectedOutput = expect.every((regex) => regex.test(combinedOutput));
  const hasSuccessExit = result.status === 0;

  if (!hasSuccessExit || !hasExpectedOutput) {
    failures.push({
      command: `node dist/index.js ${args.join(' ')}`,
      code: result.status,
      timeout: result.error?.code === 'ETIMEDOUT',
      missingMarkers: expect.filter((regex) => !regex.test(combinedOutput)).map(String),
      stderr: result.stderr?.trim() ?? '',
      stdout: result.stdout?.trim() ?? '',
    });
  }
}

if (failures.length > 0) {
  console.error('❌ README command smoke failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure.command} (exit: ${failure.code})`);
    if (failure.timeout) {
      console.error('  error: command timed out');
    }
    if (failure.missingMarkers.length > 0) {
      console.error(`  missing help markers: ${failure.missingMarkers.join(', ')}`);
    }
    if (failure.stderr) {
      console.error(`  stderr: ${failure.stderr.split('\n')[0]}`);
    } else if (failure.stdout) {
      console.error(`  stdout: ${failure.stdout.split('\n')[0]}`);
    }
  }
  process.exit(1);
}

console.log('✅ README command smoke passed.');
