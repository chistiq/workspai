import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  sdkCorePackage,
} from '../src/model-gateways/version-policy.js';
import { MODEL_GATEWAY_RELEASE_AUTHORITY } from '../src/model-gateways/qualification-policy.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const osName = argument('--os') ?? process.platform;
  const outputPath = argument('--out');
  const vitestJsonPath = argument('--vitest-json');
  if (!outputPath || !vitestJsonPath) {
    throw new Error('Usage: --os <os> --vitest-json <file> --out <report.json>');
  }
  const vitest = JSON.parse(await fs.readFile(path.resolve(vitestJsonPath), 'utf8')) as {
    numFailedTests?: number;
    numPassedTests?: number;
    numSkippedTests?: number;
    numPendingTests?: number;
    success?: boolean;
  };
  const failed = Number(vitest.numFailedTests ?? 0);
  const passed = Number(vitest.numPassedTests ?? 0);
  const skipped = Number(vitest.numSkippedTests ?? vitest.numPendingTests ?? 0);
  if (failed > 0 || vitest.success === false) {
    throw new Error('Qualification report refused: required tests failed.');
  }
  if (skipped > 0) {
    throw new Error('Qualification report refused: required tests were skipped.');
  }
  if (passed < 1) {
    throw new Error('Qualification report refused: no passing tests were recorded.');
  }

  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const adapters = BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.map((baseline) => {
    const core = sdkCorePackage(baseline);
    return {
      adapterId: baseline.adapterId,
      sdkVersion: baseline.sdkVersion,
      packageName: core.name,
    };
  });
  const report = {
    schemaVersion: 'workspai.model-gateway-qualification-report.v1',
    commitSha: sha,
    os: osName,
    runtime: process.version,
    workspaiReleaseAuthority: MODEL_GATEWAY_RELEASE_AUTHORITY,
    adapters,
    tests: {
      passed: Number(vitest.numPassedTests ?? 0),
      failed,
      skipped,
    },
    liveKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
    generatedAt: new Date().toISOString(),
  };
  if (report.liveKeyPresent) {
    throw new Error('Qualification report refused: OPENROUTER_API_KEY is set.');
  }
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`WROTE ${outputPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
