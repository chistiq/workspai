import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { compile } from 'json-schema-to-typescript';
import { format } from 'prettier';

import {
  assertAcyclicContractGraph,
  assertUniqueContractFields,
  collectExternalReferences,
  resolveSafePackagePath,
  rewriteExternalReferences,
} from './lib/generation-policy.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maximumContracts = 1024;
const maximumSchemaBytes = 16 * 1024 * 1024;
const maximumPortfolioSchemaBytes = 64 * 1024 * 1024;
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const manifestFlag = args.indexOf('--manifest');
const manifestRelativePath =
  manifestFlag >= 0 ? args[manifestFlag + 1] : 'schemas/generation-manifest.v2.json';

function fail(message) {
  throw new Error(`Shared contract generation: ${message}`);
}

function safePackagePath(relativePath, label) {
  try {
    return resolveSafePackagePath(packageRoot, relativePath);
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function normalizeGeneratedText(value) {
  return `${value.replaceAll('\r\n', '\n').trimEnd()}\n`;
}

async function formatGeneratedText(value, parser) {
  return normalizeGeneratedText(
    await format(value, {
      parser,
      printWidth: 100,
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
}

function decodePointerSegment(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function valueAtPointer(document, pointer, label) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    fail(`${label} must be an absolute JSON Pointer`);
  }
  let value = document;
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(encodedSegment);
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      fail(`${label} does not resolve: ${pointer}`);
    }
    value = value[segment];
  }
  return value;
}

const manifestPath = safePackagePath(manifestRelativePath, 'manifest path');
if (!fs.existsSync(manifestPath)) fail(`manifest does not exist: ${manifestRelativePath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 'workspai-shared-generation-manifest.v2') {
  fail('manifest schemaVersion must be workspai-shared-generation-manifest.v2');
}
if (!Array.isArray(manifest.contracts) || manifest.contracts.length === 0) {
  fail('manifest must declare at least one contract');
}
if (manifest.contracts.length > maximumContracts) {
  fail(`manifest exceeds the ${maximumContracts} contract limit`);
}

try {
  assertUniqueContractFields(manifest.contracts);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

let portfolioSchemaBytes = 0;
const contractEntries = manifest.contracts.map((contract) => {
  if (contract.publicTypeBarrel !== undefined && typeof contract.publicTypeBarrel !== 'boolean') {
    fail(`${contract.key} publicTypeBarrel must be a boolean when declared`);
  }
  const schemaPath = safePackagePath(contract.path, `${contract.key} schema path`);
  if (!fs.existsSync(schemaPath)) fail(`${contract.key} schema does not exist: ${contract.path}`);
  const schemaBytes = fs.statSync(schemaPath).size;
  if (schemaBytes > maximumSchemaBytes) {
    fail(`${contract.key} schema exceeds the ${maximumSchemaBytes} byte limit`);
  }
  portfolioSchemaBytes += schemaBytes;
  if (portfolioSchemaBytes > maximumPortfolioSchemaBytes) {
    fail(`schema portfolio exceeds the ${maximumPortfolioSchemaBytes} byte limit`);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  if (schema.$id !== contract.contractId)
    fail(`${contract.key} contractId does not match schema $id`);
  if (schema.title !== contract.typeExport) fail(`${contract.key} typeExport does not match title`);
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    fail(`${contract.key} must use JSON Schema 2020-12`);
  }
  return { contract, schema, dependencies: [...collectExternalReferences(schema)].sort() };
});
const entriesById = new Map(contractEntries.map((entry) => [entry.contract.contractId, entry]));
for (const entry of contractEntries) {
  for (const dependency of entry.dependencies) {
    if (!entriesById.has(dependency)) {
      fail(`${entry.contract.key} references undeclared contract ${dependency}`);
    }
  }
}
try {
  assertAcyclicContractGraph(entriesById);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const vocabulary = {};
for (const { contract, schema } of contractEntries) {
  for (const [exportName, selector] of Object.entries(contract.vocabulary ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(exportName))
      fail(`invalid vocabulary export ${exportName}`);
    if (Object.hasOwn(vocabulary, exportName)) fail(`duplicate vocabulary export ${exportName}`);
    if (selector.pointer && selector.pointers) fail(`${exportName} cannot declare both selectors`);
    const selected = selector.pointer
      ? valueAtPointer(schema, selector.pointer, `${exportName} pointer`)
      : Array.isArray(selector.pointers)
        ? selector.pointers.map((pointer) =>
            valueAtPointer(schema, pointer, `${exportName} pointer`)
          )
        : fail(`${exportName} must declare pointer or pointers`);
    if (!(
      typeof selected === 'string' ||
      (Array.isArray(selected) &&
        selected.length > 0 &&
        selected.every((value) => typeof value === 'string'))
    )) {
      fail(`${exportName} must resolve to a string or non-empty string array`);
    }
    vocabulary[exportName] = selected;
  }
}

const ajv = new Ajv2020({
  allErrors: false,
  strict: true,
  allowUnionTypes: false,
  ownProperties: true,
  validateFormats: false,
  code: { esm: true, source: true, optimize: true, lines: true },
});
for (const { schema } of contractEntries) ajv.addSchema(schema);

const outputs = new Map();
function addOutput(relativePath, content) {
  if (outputs.has(relativePath)) fail(`generated output collision: ${relativePath}`);
  outputs.set(relativePath, content);
}
const contractRecords = [];
for (const { contract, schema, dependencies } of contractEntries) {
  const typeSchema = rewriteExternalReferences(schema, contract, entriesById);
  const generatedTypes = await compile(typeSchema, schema.title, {
    bannerComment: `/* Generated from ${contract.path}. Do not edit. */`,
    cwd: path.dirname(safePackagePath(contract.path, `${contract.key} schema path`)),
    additionalProperties: false,
    unknownAny: true,
    unreachableDefinitions: true,
    $refOptions: { resolve: { http: false } },
    style: { singleQuote: true, semi: true, trailingComma: 'es5' },
  });
  const generatedValidator = standaloneCode(ajv, {
    [contract.validatorExport]: contract.contractId,
  });
  const validatorPath = `src/generated/${contract.outputStem}.validator.js`;
  const bundled = await build({
    stdin: {
      contents: generatedValidator,
      loader: 'js',
      resolveDir: packageRoot,
      sourcefile: path.basename(validatorPath),
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    legalComments: 'none',
    minify: false,
    sourcemap: false,
    write: false,
    metafile: true,
  });
  const bundledValidator = bundled.outputFiles[0]?.text;
  if (!bundledValidator) fail(`${contract.key} validator bundling produced no output`);
  for (const output of Object.values(bundled.metafile.outputs)) {
    if (output.imports.length > 0) fail(`${contract.key} validator has runtime imports`);
  }
  if (/\b(?:eval|Function)\s*\(/u.test(bundledValidator)) {
    fail(`${contract.key} validator contains dynamic code evaluation`);
  }
  const validatorDeclaration = `/* Generated validator declaration. Do not edit. */
interface GeneratedValidator {
  (value: unknown): boolean;
  errors?: readonly Record<string, unknown>[] | null;
}
declare const ${contract.validatorExport}: GeneratedValidator;
export { ${contract.validatorExport} };
`;
  addOutput(
    `src/generated/${contract.outputStem}.ts`,
    await formatGeneratedText(generatedTypes, 'typescript')
  );
  addOutput(validatorPath, await formatGeneratedText(bundledValidator, 'babel'));
  addOutput(
    `src/generated/${contract.outputStem}.validator.d.ts`,
    await formatGeneratedText(validatorDeclaration, 'typescript')
  );
  contractRecords.push({
    key: contract.key,
    id: contract.contractId,
    title: schema.title,
    version: contract.version,
    dialect: schema.$schema,
    source: contract.path,
    digest: digest(schema),
    typeExport: contract.typeExport,
    validatorExport: contract.validatorExport,
    dependencies,
  });
}

const portfolioDigest = digest(
  contractRecords.map(({ id, digest: schemaDigest }) => ({ id, digest: schemaDigest }))
);
const sharedOutputs = manifest.sharedOutputs ?? {};
for (const requiredKey of [
  'contractsBarrel',
  'validatorsBarrel',
  'vocabulary',
  'registryTypeScript',
  'registryJson',
]) {
  safePackagePath(sharedOutputs[requiredKey], `sharedOutputs.${requiredKey}`);
}
if (
  typeof sharedOutputs.registrySchemaVersion !== 'string' ||
  sharedOutputs.registrySchemaVersion.length === 0
) {
  fail('sharedOutputs.registrySchemaVersion is required');
}
if (
  typeof sharedOutputs.registryContractId !== 'string' ||
  !entriesById.has(sharedOutputs.registryContractId)
) {
  fail('sharedOutputs.registryContractId must identify a declared contract');
}
const registryRecord = {
  schemaVersion: sharedOutputs.registrySchemaVersion,
  status: manifest.status,
  portfolioDigest,
  contracts: contractRecords,
};
const registryValidator = ajv.getSchema(sharedOutputs.registryContractId);
if (!registryValidator) fail('registry contract validator was not compiled');
if (!registryValidator(registryRecord)) {
  fail(`generated registry violates its contract: ${ajv.errorsText(registryValidator.errors)}`);
}
const contractsBarrel = contractEntries
  .filter(({ contract }) => contract.publicTypeBarrel !== false)
  .map(({ contract }) => `export type * from './${contract.outputStem}.js';`)
  .join('\n');
const validatorImports = contractEntries
  .map(
    ({ contract }) =>
      `import { ${contract.validatorExport} } from './${contract.outputStem}.validator.js';`
  )
  .join('\n');
const validatorExports = contractEntries
  .map(({ contract }) => contract.validatorExport)
  .join(',\n  ');
const validatorEntries = contractEntries
  .map(({ contract }) => `  ${JSON.stringify(contract.contractId)}: ${contract.validatorExport},`)
  .join('\n');
const validatorsBarrel = `${validatorImports}

export {
  ${validatorExports},
};

export interface WisGeneratedStructuralValidator {
  (value: unknown): boolean;
  errors?: readonly Record<string, unknown>[] | null;
}

export const WIS_GENERATED_STRUCTURAL_VALIDATORS: Readonly<Record<string, WisGeneratedStructuralValidator>> = Object.freeze({
${validatorEntries}
});
`;
const vocabularySource = `/* Generated from manifest-declared schema pointers. Do not edit. */
${Object.entries(vocabulary)
  .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)} as const;`)
  .join('\n')}
`;
const registrySource = `/* Generated from ${manifestRelativePath}. Do not edit. */
function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const WIS_GENERATED_CONTRACT_REGISTRY = deepFreeze(${JSON.stringify(registryRecord, null, 2)} as const);
`;
addOutput(
  sharedOutputs.contractsBarrel,
  await formatGeneratedText(
    `/* Generated contract barrel. Do not edit. */\n${contractsBarrel}\n`,
    'typescript'
  )
);
addOutput(
  sharedOutputs.validatorsBarrel,
  await formatGeneratedText(
    `/* Generated validator barrel. Do not edit. */\n${validatorsBarrel}\n`,
    'typescript'
  )
);
addOutput(sharedOutputs.vocabulary, await formatGeneratedText(vocabularySource, 'typescript'));
addOutput(
  sharedOutputs.registryTypeScript,
  await formatGeneratedText(registrySource, 'typescript')
);
addOutput(sharedOutputs.registryJson, stableJson(registryRecord));

const outputPaths = [...outputs.keys()];
for (const relativePath of outputPaths) safePackagePath(relativePath, 'generated output');

const drift = [];
for (const [relativePath, content] of outputs) {
  const targetPath = safePackagePath(relativePath, 'generated output');
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
  if (current === content) continue;
  drift.push(relativePath);
  if (!checkOnly) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, targetPath);
  }
}
for (const obsoletePath of manifest.obsoleteOutputs ?? []) {
  const targetPath = safePackagePath(obsoletePath, 'obsolete output');
  if (!fs.existsSync(targetPath)) continue;
  drift.push(obsoletePath);
  if (!checkOnly) fs.rmSync(targetPath);
}

if (checkOnly && drift.length > 0) {
  console.error('Generated contract drift detected:');
  for (const relativePath of drift) console.error(`- ${relativePath}`);
  console.error('Run: npm run generate');
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(
    `Generated contracts are current (${contractRecords.length} contracts; ${portfolioDigest}).`
  );
} else {
  console.log(
    `Generated ${outputs.size} artifacts for ${contractRecords.length} contracts (${portfolioDigest}).`
  );
}
