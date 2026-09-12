import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nativeEngineSourceEvidence } from './native-engine-evidence.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const graphManifestPath = path.join(packageRoot, 'package.json');
const sharedManifestPath = path.join(repositoryRoot, 'packages/shared/package.json');
const lockPath = path.join(repositoryRoot, 'package-lock.json');
const snapshotPath = path.join(packageRoot, 'governance/g7-sbom.cdx.json');
const rustManifestPath = path.join(repositoryRoot, 'crates/graph-engine/Cargo.toml');
const rustArtifactPath = path.join(packageRoot, 'dist/native/graph-engine.wasm');
const write = process.argv.includes('--write');
const graphSbomUuidNamespace = Buffer.from('35db8b7f6f6d5acb9f79d327534ce2ce', 'hex');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function npmPurl(name, version) {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.slice(1).split('/');
    return `pkg:npm/%40${scope}/${pkg}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function lockPackage(lock, name) {
  const keys = [
    `node_modules/${name}`,
    `packages/graph/node_modules/${name}`,
    `packages/shared/node_modules/${name}`,
  ];
  for (const key of keys) {
    const entry = lock.packages?.[key];
    if (entry?.version) return { key, entry };
  }
  return undefined;
}

function component(name, version, options) {
  const purl = npmPurl(name, version);
  const licenses = options.license
    ? [{ license: { id: options.license } }]
    : [{ license: { name: 'NOASSERTION' } }];
  return {
    type: 'library',
    'bom-ref': purl,
    name,
    version,
    purl,
    scope: options.scope,
    licenses,
    properties: [
      { name: 'workspai:dependencyKind', value: options.kind },
      ...(options.workspace ? [{ name: 'workspai:workspace', value: 'true' }] : []),
      ...(options.integrity ? [{ name: 'npm:integrity', value: options.integrity }] : []),
    ],
  };
}

function manifestString(source, key) {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!match?.[1]) throw new Error(`Missing ${key} in Rust Graph manifest`);
  return match[1];
}

function deterministicUuidV8(name) {
  const bytes = crypto
    .createHash('sha256')
    .update(graphSbomUuidNamespace)
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const graphManifest = readJson(graphManifestPath);
const sharedManifest = readJson(sharedManifestPath);
const lock = readJson(lockPath);
const rustManifest = fs.readFileSync(rustManifestPath, 'utf8');
const failures = [];

if (graphManifest.name !== '@workspai/graph' || graphManifest.publishable === true) {
  failures.push('SBOM subject must remain the private Graph package');
}

const runtimeNames = Object.keys(graphManifest.dependencies ?? {});
const developmentNames = Object.keys(graphManifest.devDependencies ?? {});
const rustName = manifestString(rustManifest, 'name');
const rustVersion = manifestString(rustManifest, 'version');
const rustRef = `pkg:cargo/${rustName}@${rustVersion}`;
const rustArtifact = fs.existsSync(rustArtifactPath)
  ? fs.readFileSync(rustArtifactPath)
  : undefined;
if (!rustArtifact) failures.push('Bundled Rust Graph WASM artifact is missing');
const rustSource = nativeEngineSourceEvidence();
const components = [
  component(graphManifest.name, graphManifest.version, {
    scope: 'required',
    kind: 'self',
    workspace: true,
    license: graphManifest.license,
  }),
  {
    type: 'library',
    'bom-ref': rustRef,
    name: rustName,
    version: rustVersion,
    purl: rustRef,
    scope: 'required',
    licenses: [{ license: { id: 'MIT' } }],
    hashes: [{ alg: 'SHA-256', content: rustSource.digest }],
    properties: [
      { name: 'workspai:dependencyKind', value: 'bundled-native-acceleration' },
      { name: 'workspai:workspace', value: 'true' },
      { name: 'workspai:abiVersion', value: '1' },
      { name: 'workspai:maxNodes', value: '1000000' },
      { name: 'workspai:maxEdges', value: '5000000' },
      { name: 'workspai:maxMemoryBytes', value: '268435456' },
      { name: 'workspai:semanticAuthority', value: 'typescript' },
      { name: 'workspai:userToolchain', value: 'not-required' },
      { name: 'workspai:dynamicDownload', value: 'prohibited' },
      { name: 'workspai:hashSubject', value: rustSource.scope },
      { name: 'workspai:artifactDigestPolicy', value: 'bound-in-build-evidence' },
    ],
  },
];

for (const name of runtimeNames) {
  if (name === '@workspai/shared') {
    components.push(
      component(name, sharedManifest.version, {
        scope: 'required',
        kind: 'runtime',
        workspace: true,
        license: sharedManifest.license,
      })
    );
    continue;
  }
  const resolved = lockPackage(lock, name);
  if (!resolved) {
    failures.push(`Missing lockfile entry for runtime dependency ${name}`);
    continue;
  }
  if (
    typeof resolved.entry.resolved === 'string' &&
    (resolved.entry.resolved.startsWith('file:') ||
      /(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(resolved.entry.resolved))
  ) {
    failures.push(`${name} resolves to a machine-local artifact`);
  }
  components.push(
    component(name, resolved.entry.version, {
      scope: 'required',
      kind: 'runtime',
      license: resolved.entry.license ?? graphManifest.license,
      integrity: resolved.entry.integrity,
    })
  );
}

for (const name of developmentNames) {
  const resolved = lockPackage(lock, name);
  if (!resolved) {
    failures.push(`Missing lockfile entry for development dependency ${name}`);
    continue;
  }
  if (
    typeof resolved.entry.resolved === 'string' &&
    (resolved.entry.resolved.startsWith('file:') ||
      /(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(resolved.entry.resolved))
  ) {
    failures.push(`${name} resolves to a machine-local artifact`);
  }
  components.push(
    component(name, resolved.entry.version, {
      scope: 'excluded',
      kind: 'development',
      license: resolved.entry.license,
      integrity: resolved.entry.integrity,
    })
  );
}

components.sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
const graphRef = npmPurl(graphManifest.name, graphManifest.version);
const sharedRef = npmPurl(sharedManifest.name, sharedManifest.version);
const runtimeRefs = runtimeNames.map((name) =>
  name === '@workspai/shared'
    ? sharedRef
    : npmPurl(name, lockPackage(lock, name)?.entry.version ?? graphManifest.dependencies[name])
);
runtimeRefs.push(rustRef);
const dependencies = [
  { ref: graphRef, dependsOn: [...runtimeRefs].sort((left, right) => left.localeCompare(right)) },
  ...runtimeRefs
    .map((ref) => ({ ref, dependsOn: [] }))
    .sort((left, right) => left.ref.localeCompare(right.ref)),
];
const serialNumber = deterministicUuidV8(
  JSON.stringify({
    subject: graphRef,
    components,
    dependencies,
  })
);
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber,
  version: 1,
  metadata: {
    component: components.find((entry) => entry['bom-ref'] === graphRef),
    properties: [
      { name: 'workspai:provenance', value: 'unattested' },
      { name: 'workspai:slsa', value: 'not-generated' },
      { name: 'workspai:npmProvenance', value: 'not-generated' },
    ],
  },
  components,
  dependencies,
};

if (
  !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    serialNumber
  )
) {
  failures.push('CycloneDX serialNumber must be a deterministic RFC 9562 UUIDv8 URN');
}

const serialized = JSON.stringify(bom);
if (/(?:[A-Za-z]:\\|\/home\/|\/Users\/)/u.test(serialized)) {
  failures.push('SBOM contains a machine-local path');
}
if (/"value":"attested"/u.test(serialized) || /in-toto|slsa-proven/iu.test(serialized)) {
  failures.push('SBOM must not claim signed provenance');
}

const canonical = `${JSON.stringify(bom, null, 2)}\n`;
if (write) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, canonical);
}

if (!fs.existsSync(snapshotPath)) {
  failures.push('Committed CycloneDX snapshot is missing; run with --write');
} else if (
  JSON.stringify(JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))) !== JSON.stringify(bom)
) {
  failures.push('CycloneDX snapshot drifted; run node scripts/generate-graph-sbom.mjs --write');
}

const snapshot = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath, 'utf8') : '';
if (/"value": "attested"/u.test(snapshot) || /in-toto/iu.test(snapshot)) {
  failures.push('Committed SBOM cannot claim attestation');
}

const report = {
  schemaVersion: 'workspai-graph-g7-sbom-audit.v1',
  package: graphManifest.name,
  version: graphManifest.version,
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  provenance: 'unattested',
  componentCount: components.length,
  digest: `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
