import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
  buildAgentFrameworkVersionPromotion,
  discoverAgentFrameworkVersions,
} from '../src/agent-frameworks/index.js';

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
    throw new Error('Usage: --baseline <version-baselines.v1.json> [--report <report.json>]');
  }
  const baselinePath = path.resolve(baselineArgument);
  const reportPath = argument('--report');
  const discovery = await discoverAgentFrameworkVersions();
  const promotion = buildAgentFrameworkVersionPromotion(
    BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES,
    discovery
  );
  if (reportPath) await writeJson(path.resolve(reportPath), discovery);
  if (!promotion.changed) {
    process.stdout.write('CURRENT No agent framework version update is available.\n');
    return;
  }
  const currentDocument = JSON.parse(await fs.readFile(baselinePath, 'utf8')) as {
    baselines?: unknown;
  };
  if (
    JSON.stringify(currentDocument.baselines) !==
    JSON.stringify(BUILTIN_AGENT_FRAMEWORK_VERSION_BASELINES)
  ) {
    throw new Error(
      'Baseline file does not match the validated in-memory policy; refusing to write.'
    );
  }
  await writeJson(baselinePath, promotion.document);
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
