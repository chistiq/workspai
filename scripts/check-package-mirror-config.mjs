import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "package-mirrors.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const failures = [];

function fail(message) {
  failures.push(message);
}

if (config.schemaVersion !== "workspai-package-mirrors.v1") {
  fail("unsupported package mirror configuration schema");
}
if (config.authority?.mirrorDirection !== "one-way") {
  fail("mirror synchronization must be one-way");
}
if (config.authority?.documentation !== "consumer-facing-only") {
  fail("package mirrors must expose consumer-facing documentation only");
}

const forbidden = new Set(config.forbiddenMirrorPaths ?? []);
const names = new Set();
const repositories = new Set();

for (const mirror of config.packages ?? []) {
  if (names.has(mirror.name))
    fail(`duplicate package mirror name: ${mirror.name}`);
  if (repositories.has(mirror.mirrorRepository)) {
    fail(`duplicate package mirror repository: ${mirror.mirrorRepository}`);
  }
  names.add(mirror.name);
  repositories.add(mirror.mirrorRepository);

  const packageRoot = path.join(root, mirror.sourceDirectory);
  const manifestPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fail(
      `${mirror.name} source package does not exist: ${mirror.sourceDirectory}`,
    );
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.name !== mirror.name) {
    fail(
      `${mirror.sourceDirectory} declares ${manifest.name}, expected ${mirror.name}`,
    );
  }
  if (
    manifest.repository?.url !== "git+https://github.com/chistiq/workspai.git"
  ) {
    fail(`${mirror.name} npm repository must remain the canonical monorepo`);
  }
  if (manifest.repository?.directory !== mirror.sourceDirectory) {
    fail(
      `${mirror.name} npm repository.directory must be ${mirror.sourceDirectory}`,
    );
  }

  for (const entry of mirror.include ?? []) {
    if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes("..")) {
      fail(`${mirror.name} has unsafe allowlist entry: ${entry}`);
    }
    if (
      [...forbidden].some(
        (blocked) => entry === blocked || entry.startsWith(`${blocked}/`),
      )
    ) {
      fail(`${mirror.name} allowlists forbidden mirror path: ${entry}`);
    }
    if (!fs.existsSync(path.join(packageRoot, entry))) {
      fail(`${mirror.name} allowlist entry does not exist: ${entry}`);
    }
  }

  for (const requiredEntry of ["README.md", "CHANGELOG.md", "LICENSE"]) {
    if (!(mirror.include ?? []).includes(requiredEntry)) {
      fail(`${mirror.name} mirror omits consumer surface: ${requiredEntry}`);
    }
  }
  for (const internalEntry of ["docs", "governance"]) {
    if (
      (mirror.include ?? []).some(
        (entry) =>
          entry === internalEntry || entry.startsWith(`${internalEntry}/`),
      )
    ) {
      fail(`${mirror.name} mirror exposes internal surface: ${internalEntry}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Package mirror configuration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Package mirror configuration passed for ${names.size} planned mirrors.`,
  );
}
