import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  EXCLUDED_MODEL_GATEWAY_LANGUAGES,
  MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION,
} from '../src/model-gateways/version-policy.js';
import {
  discoverModelGatewayVersions,
  discoveryExitCode,
  formatModelGatewayDiscoverySummary,
} from '../src/model-gateways/version-discovery.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
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
  const reportPath = argument('--report');
  const writeRequested = hasFlag('--write');
  const discovery = await discoverModelGatewayVersions();
  if (reportPath) {
    const resolvedReportPath = path.resolve(reportPath);
    await writeJson(resolvedReportPath, discovery);
    if (discovery.proposedDocument) {
      await writeJson(
        path.join(path.dirname(resolvedReportPath), 'proposed.json'),
        discovery.proposedDocument
      );
    }
  }
  process.stdout.write(formatModelGatewayDiscoverySummary(discovery));

  if (discovery.outcome !== 'update-available') {
    process.exitCode = discoveryExitCode(discovery.outcome);
    return;
  }

  if (!writeRequested) {
    process.stdout.write(
      'PROPOSAL available. Re-run with --write after review to update the caller-specified baseline file.\n'
    );
    process.exitCode = discoveryExitCode(discovery.outcome);
    return;
  }

  if (!discovery.proposedDocument) {
    throw new Error('Update is available but no proposed baseline was produced.');
  }
  if (
    discovery.summary.disagreement > 0 ||
    discovery.summary.unavailable > 0 ||
    discovery.summary.invalid > 0
  ) {
    throw new Error('Refusing to write a partial or ambiguous baseline upgrade.');
  }

  const currentDocument = JSON.parse(await fs.readFile(baselinePath, 'utf8')) as {
    schemaVersion?: unknown;
    baselines?: unknown;
    excluded?: unknown;
  };
  if (
    currentDocument.schemaVersion !== MODEL_GATEWAY_VERSION_BASELINES_SCHEMA_VERSION ||
    JSON.stringify(currentDocument.baselines) !==
      JSON.stringify(BUILTIN_MODEL_GATEWAY_VERSION_BASELINES) ||
    JSON.stringify(currentDocument.excluded) !== JSON.stringify(EXCLUDED_MODEL_GATEWAY_LANGUAGES)
  ) {
    throw new Error(
      'Baseline file does not match the validated in-memory policy; refusing to write.'
    );
  }

  await writeJson(baselinePath, discovery.proposedDocument);
  process.stdout.write(`WROTE ${baselinePath}\n`);
  process.exitCode = discoveryExitCode(discovery.outcome);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
