import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
  buildAgentFrameworkVersionPromotion,
} from '../src/agent-frameworks/index.js';
import {
  discoverAgentFrameworkVersions,
  formatAgentFrameworkVersionDiscoverySummary,
} from '../src/agent-frameworks/version-discovery.js';
import { AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION } from '../src/agent-frameworks/version-policy.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const baselineArgument = argument('--baseline');
  if (!baselineArgument) {
    throw new Error(
      'Usage: --baseline <version-baselines.v1.json> [--report <report.json>] [--write]'
    );
  }
  const baselinePath = path.resolve(baselineArgument);
  const reportArgument = argument('--report');
  const reportPath = reportArgument ? path.resolve(reportArgument) : undefined;
  const proposalPath = reportPath
    ? path.join(path.dirname(reportPath), 'proposed.json')
    : undefined;
  const writeRequested = process.argv.includes('--write');
  if (
    reportPath === baselinePath ||
    proposalPath === baselinePath ||
    (reportPath && reportPath === proposalPath)
  ) {
    throw new Error('Report, proposal, and baseline must have distinct paths.');
  }
  const discovery = await discoverAgentFrameworkVersions({ githubToken: process.env.GITHUB_TOKEN });
  if (reportPath) await writeJson(reportPath, discovery);
  process.stdout.write(formatAgentFrameworkVersionDiscoverySummary(discovery));
  if (discovery.summary.blocked > 0) {
    process.exitCode = 1;
    return;
  }
  const promotion = buildAgentFrameworkVersionPromotion(
    BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
    discovery
  );
  if (!promotion.changed) {
    process.stdout.write('CURRENT No agent framework version update is available.\n');
    return;
  }
  const currentDocument = JSON.parse(await fs.readFile(baselinePath, 'utf8')) as {
    schemaVersion?: unknown;
    baselines?: unknown;
  };
  if (
    currentDocument.schemaVersion !== AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION ||
    JSON.stringify(currentDocument.baselines) !==
      JSON.stringify(BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES)
  ) {
    throw new Error(
      'Baseline file does not match the validated in-memory policy; refusing to write.'
    );
  }
  if (proposalPath) await writeJson(proposalPath, promotion.document);
  if (writeRequested) await writeJson(baselinePath, promotion.document);
  for (const update of promotion.updatedPackages) {
    process.stdout.write(
      `UPDATE ${update.adapterId}/${update.name}: ${update.from} -> ${update.to}\n`
    );
  }
  process.stdout.write(
    `PROPOSED ${promotion.updatedPackages.length} package update(s) across ${promotion.updatedAdapters.length} adapter(s).\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
