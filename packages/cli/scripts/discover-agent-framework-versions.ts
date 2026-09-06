import fs from 'node:fs/promises';
import path from 'node:path';

import { discoverAgentFrameworkVersions } from '../src/agent-frameworks/version-discovery.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const report = await discoverAgentFrameworkVersions();
  const output = argument('--output');
  if (output) {
    const target = path.resolve(output);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`WROTE ${target}\n`);
  }
  for (const adapter of report.adapters) {
    process.stdout.write(
      `${adapter.status === 'current' ? 'PASS' : adapter.status === 'candidate-available' ? 'CANDIDATE' : 'BLOCKED'} ${adapter.adapterId} · ${adapter.releaseChannel} · ${adapter.admittedFrameworkVersion}\n`
    );
    for (const dependency of adapter.packages.filter((item) => item.status !== 'current')) {
      process.stdout.write(
        `  ${dependency.name}: ${dependency.admittedVersion} -> ${dependency.latestRegistryVersion} (${dependency.status})\n`
      );
    }
  }
  process.stdout.write(
    `Discovery only: ${report.summary.candidateAvailable} candidate(s); no baseline was changed.\n`
  );
  if (report.summary.blocked > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
