import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import {
  assertAgentFrameworkVersionBaselineDocument,
  compareRegistryVersions,
} from '../src/agent-frameworks/version-policy.js';

async function main(): Promise<void> {
  const version: unknown = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
  ).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
    throw new Error('Cannot select an Agent Framework proposal for an invalid CLI version.');
  }

  const proposalPath = new URL(
    `../releases/AGENT_FRAMEWORK_CANDIDATES_v${version}.json`,
    import.meta.url
  );
  const baselinePath = new URL(
    '../src/agent-frameworks/version-baselines.v1.json',
    import.meta.url
  );
  let proposalText: string;
  try {
    proposalText = await fs.readFile(proposalPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    process.stdout.write(`Testing the bundled Agent Framework baseline for CLI ${version}.\n`);
    return;
  }

  const proposal: unknown = JSON.parse(proposalText);
  assertAgentFrameworkVersionBaselineDocument(proposal);
  const baseline: unknown = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  assertAgentFrameworkVersionBaselineDocument(baseline);
  if (isDeepStrictEqual(proposal, baseline)) {
    process.stdout.write(
      `The Agent Framework proposal for CLI ${version} matches the bundled baseline.\n`
    );
    return;
  }

  for (const adapter of proposal.baselines) {
    const active = baseline.baselines.find((entry) => entry.adapterId === adapter.adapterId);
    for (const dependency of adapter.packages) {
      const previous = active?.packages.find((entry) => entry.name === dependency.name);
      if (previous && compareRegistryVersions(dependency.version, previous.version) < 0) {
        throw new Error(
          `The committed proposal would downgrade ${adapter.adapterId}/${dependency.name}.`
        );
      }
    }
  }

  await fs.writeFile(baselinePath, proposalText);
  process.stdout.write(`Testing the committed Agent Framework proposal for CLI ${version}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
