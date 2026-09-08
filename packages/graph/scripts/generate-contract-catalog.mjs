import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { compile } from 'json-schema-to-typescript';
import { format } from 'prettier';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaRoot = path.join(packageRoot, 'schemas');
const outputPath = path.join(packageRoot, 'conformance', 'contract-catalog.v1.json');
const generatedRoot = path.join(packageRoot, 'src', 'generated');
const check = process.argv.includes('--check');
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
});

const generated = new Map();
const generatedExports = new Map();
const schemas = await Promise.all(
  fs
    .readdirSync(schemaRoot)
    .filter((name) => name.endsWith('.schema.json'))
    .sort()
    .map(async (name) => {
      const bytes = fs.readFileSync(path.join(schemaRoot, name));
      const parsed = JSON.parse(bytes.toString('utf8'));
      if (
        parsed.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
        typeof parsed.$id !== 'string'
      ) {
        throw new Error(`${name} has no supported draft-2020-12 identity`);
      }
      ajv.compile(parsed);
      const outputName = name.replace('.schema.json', '.ts');
      const source = await compile(parsed, parsed.title, {
        bannerComment: `/* Generated from schemas/${name}. Do not edit. */`,
        cwd: schemaRoot,
        additionalProperties: false,
        unknownAny: true,
        unreachableDefinitions: true,
        $refOptions: { resolve: { http: false } },
        style: { singleQuote: true, semi: true, trailingComma: 'es5' },
      });
      generated.set(
        outputName,
        await format(source, { parser: 'typescript', printWidth: 100, singleQuote: true })
      );
      generatedExports.set(outputName, parsed.title);
      return {
        id: parsed.$id,
        file: `schemas/${name}`,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    })
);
generated.set(
  'index.ts',
  [...generatedExports.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, typeName]) => `export type { ${typeName} } from './${name.replace(/\.ts$/u, '.js')}';`
    )
    .join('\n') + '\n'
);
const catalog = `${JSON.stringify({ schemaVersion: 'workspai-graph-contract-catalog.v1', generatedBy: '@workspai/graph', contracts: schemas }, null, 2)}\n`;
if (check) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== catalog) {
    throw new Error('Graph contract catalog drifted; run npm run generate');
  }
  for (const [name, source] of generated)
    if (
      !fs.existsSync(path.join(generatedRoot, name)) ||
      fs.readFileSync(path.join(generatedRoot, name), 'utf8') !== source
    )
      throw new Error(`Generated Graph type drifted: src/generated/${name}`);
} else {
  fs.mkdirSync(generatedRoot, { recursive: true });
  fs.writeFileSync(outputPath, catalog, 'utf8');
  for (const [name, source] of generated)
    fs.writeFileSync(path.join(generatedRoot, name), source, 'utf8');
}
