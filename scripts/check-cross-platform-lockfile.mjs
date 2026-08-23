#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const lockfilePath = path.join(monorepoRoot, "package-lock.json");
const nativeDependencyFamilies = [
  { packageName: "rolldown", bindingPrefix: "@rolldown/binding-" },
  { packageName: "rollup", bindingPrefix: "@rollup/rollup-" },
  { packageName: "esbuild", bindingPrefix: "@esbuild/" },
];

function fail(message) {
  console.error(`[cross-platform-lockfile] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(lockfilePath)) {
  fail(
    "package-lock.json is missing. Restore it from Git before installing dependencies.",
  );
}

let lockfile;
try {
  lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
} catch (error) {
  fail(
    `package-lock.json is not valid JSON: ${error instanceof Error ? error.message : error}`,
  );
}

if (lockfile.lockfileVersion !== 3 || typeof lockfile.packages !== "object") {
  fail("package-lock.json must use the npm lockfile v3 packages contract.");
}

const missingBindings = [];
for (const { packageName, bindingPrefix } of nativeDependencyFamilies) {
  const packageEntry = lockfile.packages[`node_modules/${packageName}`];
  const optionalDependencies = packageEntry?.optionalDependencies;
  if (!optionalDependencies || typeof optionalDependencies !== "object") {
    fail(
      `${packageName} is missing its optional-dependency metadata in package-lock.json.`,
    );
  }

  for (const [binding, expectedVersion] of Object.entries(
    optionalDependencies,
  )) {
    if (!binding.startsWith(bindingPrefix)) continue;
    const bindingEntry = lockfile.packages[`node_modules/${binding}`];
    if (!bindingEntry || bindingEntry.version !== expectedVersion) {
      missingBindings.push(`${binding}@${expectedVersion}`);
    }
  }
}

if (missingBindings.length > 0) {
  console.error(
    "[cross-platform-lockfile] package-lock.json is incomplete for the supported CI matrix:",
  );
  for (const binding of missingBindings) {
    console.error(`- ${binding}`);
  }
  console.error(
    "[cross-platform-lockfile] This usually happens when package-lock.json is deleted while node_modules still exists.",
  );
  console.error(
    "[cross-platform-lockfile] Restore package-lock.json from Git and run `corepack npm ci`. For an intentional full regeneration, use a clean branch or container with neither package-lock.json nor node_modules present.",
  );
  process.exit(1);
}

console.log(
  "[cross-platform-lockfile] native build and test bindings are complete across supported platforms.",
);
