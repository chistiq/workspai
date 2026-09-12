import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'fixtures/core/v0.2.0-draft/valid-pass.json'), 'utf8')
);

const browserBuild = await build({
  stdin: {
    contents: `
      import {
        WORKSPAI_SHARED_RUNTIME,
        WIS_GENERATED_CONTRACT_REGISTRY,
        validateWisCoreResultEnvelope
      } from './dist/browser.js';
      const fixture = ${JSON.stringify(fixture)};
      if (WORKSPAI_SHARED_RUNTIME !== 'browser-neutral') throw new Error('browser marker drifted');
      if (WIS_GENERATED_CONTRACT_REGISTRY.contracts.length !== 3) throw new Error('registry missing');
      if (!validateWisCoreResultEnvelope(fixture).valid) throw new Error('browser validation failed');
      export const browserSmokePassed = true;
    `,
    resolveDir: packageRoot,
    sourcefile: 'workspai-shared-browser-smoke.mjs',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  write: false,
  metafile: true,
});

if (browserBuild.outputFiles.length !== 1) {
  throw new Error(`browser smoke expected one output; found ${browserBuild.outputFiles.length}`);
}
const browserCode = browserBuild.outputFiles[0].text;
if (/\b(?:eval|Function)\s*\(/u.test(browserCode)) {
  throw new Error('browser bundle contains dynamic code evaluation');
}
if (Object.keys(browserBuild.metafile.inputs).some((input) => input.startsWith('node:'))) {
  throw new Error('browser bundle contains a Node builtin');
}
const browserGzipBytes = gzipSync(browserCode, { level: 9 }).byteLength;
const browserGzipBudgetBytes = 64 * 1024;
if (browserGzipBytes > browserGzipBudgetBytes) {
  throw new Error(
    `browser bundle is ${browserGzipBytes} gzip bytes; budget is ${browserGzipBudgetBytes}`
  );
}
const browserModule = await import(
  `data:text/javascript;base64,${Buffer.from(browserCode).toString('base64')}`
);
if (browserModule.browserSmokePassed !== true) {
  throw new Error('browser smoke did not execute to completion');
}

const nodeModule = await import(pathToFileURL(path.join(packageRoot, 'dist/node.js')).href);
if (nodeModule.WORKSPAI_SHARED_RUNTIME !== 'node') {
  throw new Error('Node runtime marker drifted');
}
if (!nodeModule.validateWisCoreResultEnvelope(fixture).valid) {
  throw new Error('Node runtime validation failed');
}

console.log(
  `Runtime surfaces passed: browser ${browserGzipBytes}/${browserGzipBudgetBytes} gzip bytes; Node ESM validation passed.`
);
