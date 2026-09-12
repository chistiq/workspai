import { parentPort, workerData } from 'node:worker_threads';

import { validateWisCoreResultEnvelope } from '../dist/validation/index.js';
import { buildScaleEnvelope } from './lib/scale-workloads.mjs';

if (!parentPort) throw new Error('scale worker requires a parent port');

const input = buildScaleEnvelope(workerData.workload);
const outcomes = [];
for (let index = 0; index < workerData.iterations; index += 1) {
  const result = validateWisCoreResultEnvelope(input, { limits: workerData.workload.limits });
  outcomes.push(result.valid);
}
parentPort.postMessage({ passed: outcomes.every(Boolean), count: outcomes.length });
