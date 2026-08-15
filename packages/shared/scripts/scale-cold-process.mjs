import { performance } from 'node:perf_hooks';

import { buildScaleEnvelope } from './lib/scale-workloads.mjs';

const configuration = JSON.parse(process.argv[2]);
const startedAt = performance.now();
const { validateWisCoreResultEnvelope } = await import('../dist/validation/index.js');
const input = buildScaleEnvelope(configuration);
const result = validateWisCoreResultEnvelope(input, { limits: configuration.limits });
const durationMs = performance.now() - startedAt;

if (!result.valid) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ valid: result.valid, durationMs })}\n`);
