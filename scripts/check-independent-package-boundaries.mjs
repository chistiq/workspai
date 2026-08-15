import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(candidate);
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)
      ? [candidate]
      : [];
  });
}

function importsOf(source) {
  return [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(
    (match) => match[2],
  );
}

function fail(message) {
  failures.push(message);
}

const rootManifest = readJson("package.json");
const packageRegistry = readJson("independent-packages.json");
const sharedConsumerMigration = readJson(
  "packages/shared/governance/sh4-internal-consumers.v1.json",
);
const sharedDomainAdoption = readJson(
  "packages/shared/governance/sh6-domain-adoption.v1.json",
);
if (packageRegistry.schemaVersion !== "workspai-independent-packages.v1") {
  fail("unsupported independent package registry schema");
}
const expectedWorkspaces = [
  "packages/shared",
  "packages/graph",
  "packages/cli",
  "packages/wspai",
];
if (
  JSON.stringify(rootManifest.workspaces) !== JSON.stringify(expectedWorkspaces)
) {
  fail(
    `root workspaces must be dependency-ordered: ${expectedWorkspaces.join(", ")}`,
  );
}

const shared = readJson("packages/shared/package.json");
const graph = readJson("packages/graph/package.json");
const cli = readJson("packages/cli/package.json");

if (
  packageRegistry.integrationPolicy !== "standalone-stability-before-cli-bridge"
) {
  fail(
    "independent package registry must require standalone stability before CLI bridge",
  );
}

const registeredPackages = [...(packageRegistry.packages ?? [])].sort(
  (left, right) => left.deliveryOrder - right.deliveryOrder,
);
const registeredNames = new Set();
const registeredDirectories = new Set();
const deliveryOrders = new Set();
const registeredManifests = new Map();
if (
  registeredPackages.map((entry) => entry.name).join(",") !==
  "@workspai/shared,@workspai/graph"
) {
  fail("initial independent package delivery order must be Shared then Graph");
}
for (const entry of registeredPackages) {
  if (registeredNames.has(entry.name))
    fail(`duplicate package name: ${entry.name}`);
  if (registeredDirectories.has(entry.directory)) {
    fail(`duplicate package directory: ${entry.directory}`);
  }
  if (
    !Number.isInteger(entry.deliveryOrder) ||
    deliveryOrders.has(entry.deliveryOrder)
  ) {
    fail(`invalid or duplicate delivery order for ${entry.name}`);
  }
  registeredNames.add(entry.name);
  registeredDirectories.add(entry.directory);
  deliveryOrders.add(entry.deliveryOrder);

  const manifest = readJson(`${entry.directory}/package.json`);
  registeredManifests.set(entry.name, manifest);
  if (manifest.name !== entry.name)
    fail(`${entry.directory} must declare ${entry.name}`);
  if (entry.publishable !== false || manifest.private !== true) {
    fail(
      `${entry.name} must remain non-publishable while registered as contract-design`,
    );
  }
  if (entry.standaloneStability !== "not-admitted") {
    fail(
      `${entry.name} cannot activate a CLI bridge before standalone stability admission`,
    );
  }
  if (
    entry.cliRuntimeIntegration !== "prohibited-before-standalone-stability"
  ) {
    fail(
      `${entry.name} must explicitly prohibit premature CLI runtime integration`,
    );
  }
  for (const evidencePath of entry.requiredEvidence ?? []) {
    if (typeof evidencePath !== "string") {
      fail(`${entry.name} has a non-string architecture evidence path`);
      continue;
    }
    const normalized = path.normalize(evidencePath);
    const packagePrefix = `${entry.directory}${path.sep}`;
    if (
      path.isAbsolute(evidencePath) ||
      normalized.includes(`..${path.sep}`) ||
      !normalized.startsWith(packagePrefix)
    ) {
      fail(
        `${entry.name} has unsafe or out-of-package evidence path ${evidencePath}`,
      );
      continue;
    }
    const resolvedEvidence = path.join(root, normalized);
    if (
      !fs.existsSync(resolvedEvidence) ||
      !fs.lstatSync(resolvedEvidence).isFile()
    ) {
      fail(
        `${entry.name} is missing required architecture evidence ${evidencePath}`,
      );
    }
  }
}

const packageEdges = new Map(
  registeredPackages.map((entry) => {
    const manifest = registeredManifests.get(entry.name) ?? {};
    const dependencies = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    }).filter((dependency) => registeredNames.has(dependency));
    return [entry.name, dependencies];
  }),
);
const visiting = new Set();
const visited = new Set();
function visitPackage(packageName, chain = []) {
  if (visiting.has(packageName)) {
    fail(
      `registered package dependency cycle: ${[...chain, packageName].join(" -> ")}`,
    );
    return;
  }
  if (visited.has(packageName)) return;
  visiting.add(packageName);
  for (const dependency of packageEdges.get(packageName) ?? []) {
    visitPackage(dependency, [...chain, packageName]);
  }
  visiting.delete(packageName);
  visited.add(packageName);
}
for (const packageName of registeredNames) visitPackage(packageName);

if (
  sharedConsumerMigration.schemaVersion !==
  "workspai-shared-internal-consumers.v1"
) {
  fail("unsupported Shared internal-consumer migration schema");
}
if (sharedConsumerMigration.sharedPackage !== "@workspai/shared") {
  fail("Shared consumer migration package identity drifted");
}
if (sharedConsumerMigration.sharedVersion !== shared.version) {
  fail("Shared consumer migration version does not match its package manifest");
}
const sharedPublicSubpaths = new Set(
  Object.keys(shared.exports ?? {})
    .filter((subpath) => subpath !== ".")
    .map((subpath) => `@workspai/shared/${subpath.slice(2)}`),
);
const allowedSharedSubpaths = new Set(
  sharedConsumerMigration.policy?.allowedSubpaths ?? [],
);
if (
  [...allowedSharedSubpaths].some(
    (subpath) => !sharedPublicSubpaths.has(subpath),
  )
) {
  fail("Shared migration allowlist contains an undeclared package export");
}

const migratedConsumers = sharedConsumerMigration.migratedConsumers ?? [];
const importedSharedSubpathsByConsumer = new Map();
const expectedConsumers = registeredPackages
  .filter((entry) => entry.name !== "@workspai/shared")
  .filter((entry) => {
    const manifest = registeredManifests.get(entry.name) ?? {};
    return Object.hasOwn(manifest.dependencies ?? {}, "@workspai/shared");
  })
  .map((entry) => entry.name)
  .sort();
const declaredConsumers = migratedConsumers
  .map((consumer) => consumer.package)
  .sort();
if (JSON.stringify(declaredConsumers) !== JSON.stringify(expectedConsumers)) {
  fail(
    `Shared migrated consumers must match the registered dependency graph: ${expectedConsumers.join(", ")}`,
  );
}
for (const consumer of migratedConsumers) {
  const registryEntry = registeredPackages.find(
    (entry) => entry.name === consumer.package,
  );
  const manifest = registeredManifests.get(consumer.package);
  if (!registryEntry || !manifest) {
    fail(`Shared migration names unregistered consumer ${consumer.package}`);
    continue;
  }
  if (consumer.directory !== registryEntry.directory) {
    fail(`Shared migration directory drifted for ${consumer.package}`);
  }
  if (
    manifest.dependencies?.["@workspai/shared"] !== shared.version ||
    consumer.dependency !== shared.version
  ) {
    fail(
      `${consumer.package} must consume the exact development Shared version`,
    );
  }
  const importedSharedSubpaths = new Set();
  for (const relativeSourceRoot of ["src", "test"]) {
    const consumerSourceRoot = path.join(
      root,
      registryEntry.directory,
      relativeSourceRoot,
    );
    if (!fs.existsSync(consumerSourceRoot)) continue;
    for (const file of walk(consumerSourceRoot)) {
      for (const specifier of importsOf(fs.readFileSync(file, "utf8"))) {
        if (specifier === "@workspai/shared") {
          fail(
            `${path.relative(root, file)} imports the ambiguous Shared root; use a declared public subpath`,
          );
        } else if (specifier.startsWith("@workspai/shared/")) {
          importedSharedSubpaths.add(specifier);
          if (!allowedSharedSubpaths.has(specifier)) {
            fail(
              `${path.relative(root, file)} imports undeclared Shared subpath ${specifier}`,
            );
          }
        }
      }
    }
  }
  for (const requiredSubpath of consumer.requiredSubpaths ?? []) {
    if (!importedSharedSubpaths.has(requiredSubpath)) {
      fail(
        `${consumer.package} has no exercised import for ${requiredSubpath}`,
      );
    }
  }
  importedSharedSubpathsByConsumer.set(
    consumer.package,
    [...importedSharedSubpaths].sort(),
  );
}
for (const deferred of sharedConsumerMigration.deferredConsumers ?? []) {
  if (registeredNames.has(deferred.package)) {
    fail(
      `registered package ${deferred.package} cannot remain a deferred Shared consumer`,
    );
  }
}

if (
  sharedDomainAdoption.schemaVersion !== "workspai-shared-domain-adoption.v1"
) {
  fail("unsupported Shared domain-adoption schema");
}
if (
  sharedDomainAdoption.sharedPackage !== "@workspai/shared" ||
  sharedDomainAdoption.sharedVersion !== shared.version
) {
  fail("Shared domain-adoption identity or version drifted");
}
if (
  sharedDomainAdoption.policy?.centralCliBridge !== "prohibited" ||
  sharedDomainAdoption.policy?.maturityImpact !== "none" ||
  sharedDomainAdoption.policy?.publicationImpact !== "none"
) {
  fail("SH6 must not advance maturity, publication or the central CLI bridge");
}
const adoptionRecords = sharedDomainAdoption.adopters ?? [];
const declaredAdopters = adoptionRecords
  .map((adopter) => adopter.package)
  .sort();
if (JSON.stringify(declaredAdopters) !== JSON.stringify(expectedConsumers)) {
  fail(
    `SH6 adopters must match registered Shared dependents: ${expectedConsumers.join(", ")}`,
  );
}
for (const adopter of adoptionRecords) {
  const registryEntry = registeredPackages.find(
    (entry) => entry.name === adopter.package,
  );
  const migration = migratedConsumers.find(
    (consumer) => consumer.package === adopter.package,
  );
  if (!registryEntry || !migration) {
    fail(`SH6 names unregistered adopter ${adopter.package}`);
    continue;
  }
  if (
    adopter.directory !== registryEntry.directory ||
    adopter.packageStage !== registryEntry.currentStage ||
    adopter.maturityBefore !== registryEntry.maturity ||
    adopter.maturityAfter !== registryEntry.maturity
  ) {
    fail(`SH6 stage or maturity drifted for ${adopter.package}`);
  }
  const adoptedSubpaths = [...(adopter.sharedSubpaths ?? [])].sort();
  const requiredSubpaths = [...(migration.requiredSubpaths ?? [])].sort();
  const exercisedSubpaths =
    importedSharedSubpathsByConsumer.get(adopter.package) ?? [];
  if (
    JSON.stringify(adoptedSubpaths) !== JSON.stringify(requiredSubpaths) ||
    JSON.stringify(adoptedSubpaths) !== JSON.stringify(exercisedSubpaths)
  ) {
    fail(`SH6 Shared subpath evidence drifted for ${adopter.package}`);
  }
  for (const evidencePath of adopter.evidence ?? []) {
    if (
      typeof evidencePath !== "string" ||
      path.isAbsolute(evidencePath) ||
      path.normalize(evidencePath).includes(`..${path.sep}`)
    ) {
      fail(`${adopter.package} has unsafe SH6 evidence path ${evidencePath}`);
      continue;
    }
    const evidence = path.join(root, evidencePath);
    if (!fs.existsSync(evidence) || !fs.lstatSync(evidence).isFile()) {
      fail(`${adopter.package} is missing SH6 evidence ${evidencePath}`);
    }
  }
}
for (const deferred of sharedDomainAdoption.deferredPackages ?? []) {
  if (registeredNames.has(deferred.package)) {
    fail(
      `registered package ${deferred.package} cannot remain deferred in SH6`,
    );
  }
}

for (const manifest of [shared, graph]) {
  if (manifest.private !== true)
    fail(`${manifest.name} must remain private during development`);
  if (manifest.scripts?.prepublishOnly !== "node scripts/refuse-publish.mjs") {
    fail(`${manifest.name} must retain the refusing prepublishOnly guard`);
  }
}

const sharedRuntimeDependencies = Object.keys({
  ...(shared.dependencies ?? {}),
  ...(shared.optionalDependencies ?? {}),
  ...(shared.peerDependencies ?? {}),
});
if (sharedRuntimeDependencies.length > 0) {
  fail(
    `@workspai/shared must remain a dependency leaf; found ${sharedRuntimeDependencies.join(", ")}`,
  );
}

const graphDependencies = Object.keys(graph.dependencies ?? {});
if (
  graphDependencies.length !== 1 ||
  graphDependencies[0] !== "@workspai/shared"
) {
  fail(
    "@workspai/graph may depend only on @workspai/shared during standalone development",
  );
}

const cliDependencyNames = Object.keys({
  ...(cli.dependencies ?? {}),
  ...(cli.optionalDependencies ?? {}),
  ...(cli.peerDependencies ?? {}),
});
for (const packageName of ["@workspai/shared", "@workspai/graph"]) {
  if (cliDependencyNames.includes(packageName)) {
    fail(`central CLI must not depend on developing package ${packageName}`);
  }
}

const sourcePolicies = [
  {
    directory: "packages/cli/src",
    forbidden: /^@workspai\/(?:shared|graph)(?:\/|$)/,
    reason: "CLI package consumption is forbidden before standalone stability",
  },
  {
    directory: "packages/shared/src",
    forbidden: /^(?:workspai|wspai|@workspai\/(?:graph|cli))(?:\/|$)/,
    reason: "Shared must remain a dependency leaf",
  },
  {
    directory: "packages/graph/src",
    forbidden: /^(?:workspai|wspai|@workspai\/cli)(?:\/|$)/,
    reason: "Graph must not consume the central CLI",
  },
];

for (const policy of sourcePolicies) {
  const directory = path.join(root, policy.directory);
  for (const file of walk(directory)) {
    for (const specifier of importsOf(fs.readFileSync(file, "utf8"))) {
      if (policy.forbidden.test(specifier)) {
        fail(
          `${path.relative(root, file)} imports ${specifier}: ${policy.reason}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Independent package boundary guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Independent package boundaries passed: ${registeredPackages.length} packages, acyclic Shared consumers, no CLI runtime bridge.`,
  );
}
