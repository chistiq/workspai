import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = path.join(packageRoot, 'governance/g7-release-inventory.v1.json');
const write = process.argv.includes('--write');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function frozenStringArray(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\] as const\\)`)
  );
  if (!match) throw new Error(`Cannot extract ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function namedValueExports(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /export\s+(?:\{([^}]+)\}|(?:const|function|async function|class)\s+(\w+))/g
  )) {
    if (match[1]) {
      for (const part of match[1].split(',')) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith('type ')) continue;
        const name = trimmed.split(/\s+as\s+/)[0]?.trim();
        if (name) names.add(name);
      }
    }
    if (match[2]) names.add(match[2]);
  }
  return [...names].sort();
}

function packedJobIds(source) {
  const start = source.indexOf('export const GRAPH_STANDALONE_PACKED_JOBS =');
  const end = source.indexOf('export const GRAPH_STANDALONE_SUPPORT_MATRIX =');
  if (start < 0 || end <= start) {
    throw new Error('Cannot extract GRAPH_STANDALONE_PACKED_JOBS');
  }
  return [...source.slice(start, end).matchAll(/id: '([^']+)'/g)].map((item) => item[1]);
}

const failures = [];
const manifest = readJson(path.join(packageRoot, 'package.json'));
const catalog = readJson(path.join(packageRoot, 'conformance/contract-catalog.v1.json'));
const productSource = fs.readFileSync(
  path.join(packageRoot, 'src/contracts/standalone-product.ts'),
  'utf8'
);
const rootSource = fs.readFileSync(path.join(packageRoot, 'src/index.ts'), 'utf8');

const subpaths = frozenStringArray(productSource, 'GRAPH_PUBLIC_EXPORT_SUBPATHS');
const rootValueExports = frozenStringArray(productSource, 'GRAPH_PUBLIC_ROOT_VALUE_EXPORTS');
const rootForbiddenValueExports = frozenStringArray(
  productSource,
  'GRAPH_ROOT_FORBIDDEN_VALUE_EXPORTS'
);
const packedJobs = packedJobIds(productSource);
const exported = namedValueExports(rootSource);

if (
  manifest.name !== '@workspai/graph' ||
  manifest.publishable === true ||
  manifest.private !== true
) {
  failures.push('Release inventory subject must remain the private Graph package');
}
if (JSON.stringify(Object.keys(manifest.exports).sort()) !== JSON.stringify([...subpaths].sort())) {
  failures.push('package.json exports drifted from GRAPH_PUBLIC_EXPORT_SUBPATHS');
}
if (JSON.stringify(exported) !== JSON.stringify([...rootValueExports].sort())) {
  failures.push('src/index.ts value exports drifted from GRAPH_PUBLIC_EXPORT_MAP');
}
for (const forbidden of rootForbiddenValueExports) {
  if (exported.includes(forbidden)) failures.push(`Forbidden root export present: ${forbidden}`);
}
if (!Array.isArray(catalog.contracts) || catalog.contracts.length === 0) {
  failures.push('Contract catalog is missing packed schema identities');
}
for (const contract of catalog.contracts ?? []) {
  const file = path.join(packageRoot, contract.file);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    failures.push(`Catalog schema is missing: ${contract.file}`);
    continue;
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest !== contract.sha256) failures.push(`Catalog digest drifted: ${contract.file}`);
}

const inventory = {
  schemaVersion: 'workspai-graph-g7-release-inventory.v1',
  contract: { id: 'workspai.graph.release-inventory', version: '0.1.0-candidate' },
  package: manifest.name,
  version: manifest.version,
  publishable: false,
  standaloneStable: false,
  provenance: 'unattested',
  signedAttestation: 'not-generated',
  rollbackProcedure: 'not-proven',
  publicInternalDocuments: 0,
  exports: {
    subpaths,
    rootValueExports,
    rootForbiddenValueExports,
  },
  packedJobs,
  schemas: catalog.contracts,
  packedArtifactSecurity: {
    sourceMaps: 'excluded',
    governance: 'excluded',
    machineLocalPaths: 'rejected',
    secrets: 'rejected',
    catalogDigest: 'required',
    signedAttestation: 'not-generated',
    rollbackProcedure: 'not-proven',
  },
};

const serialized = JSON.stringify(inventory);
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(serialized)) {
  failures.push('Release inventory contains a machine-local path');
}
if (/"value":"attested"/u.test(serialized) || /in-toto|slsa-proven/iu.test(serialized)) {
  failures.push('Release inventory must not claim signed provenance');
}

const canonical = `${JSON.stringify(inventory, null, 2)}\n`;
if (write) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, canonical);
}

if (!fs.existsSync(snapshotPath)) {
  failures.push('Committed release inventory is missing; run with --write');
} else if (
  JSON.stringify(JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))) !== JSON.stringify(inventory)
) {
  failures.push(
    'Release inventory snapshot drifted; run node scripts/generate-g7-release-inventory.mjs --write'
  );
}

const report = {
  schemaVersion: 'workspai-graph-g7-release-inventory-audit.v1',
  package: manifest.name,
  version: manifest.version,
  provenance: 'unattested',
  schemaCount: catalog.contracts?.length ?? 0,
  digest: `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
