#!/usr/bin/env node

import fs from 'node:fs';
import { lstat, open } from 'node:fs/promises';

import { runSharedCli, type SharedCliIo } from '../src/cli/application.js';

const cancellation = { aborted: false };
process.once('SIGINT', () => {
  cancellation.aborted = true;
});

async function readStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > maxBytes) throw new RangeError(`Input exceeds the ${maxBytes}-byte safety limit.`);
    chunks.push(chunk);
    if (cancellation.aborted) break;
  }
  return Buffer.concat(chunks, total);
}

const io: SharedCliIo = {
  async readInput(locator, maxBytes) {
    if (locator === '-') return readStream(process.stdin, maxBytes);
    const pathStats = await lstat(locator);
    if (!pathStats.isFile()) throw new TypeError('Input must be a regular file.');
    if (pathStats.size > maxBytes) {
      throw new RangeError(`Input exceeds the ${maxBytes}-byte safety limit.`);
    }
    const handle = await open(locator, fs.constants.O_RDONLY);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new TypeError('Input must be a regular file.');
      if (stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
        throw new TypeError('Input changed while it was being opened.');
      }
      if (stats.size > maxBytes) {
        throw new RangeError(`Input exceeds the ${maxBytes}-byte safety limit.`);
      }
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  },
  writeOutput(value) {
    process.stdout.write(value);
  },
};

process.exitCode = await runSharedCli(process.argv.slice(2), io, cancellation);
