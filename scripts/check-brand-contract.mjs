#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".j2",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => file !== "scripts/check-brand-contract.mjs")
  .filter((file) => textExtensions.has(path.extname(file).toLowerCase()));

const forbidden = [
  [/github\.com\/rapidkitlabs(?:\/|$)/i, "legacy rapidkitlabs GitHub URL"],
  [
    /api\.github\.com\/repos\/rapidkitlabs(?:\/|$)/i,
    "legacy rapidkitlabs GitHub API URL",
  ],
  [
    /raw\.githubusercontent\.com\/rapidkitlabs(?:\/|$)/i,
    "legacy rapidkitlabs raw-content URL",
  ],
  [/github\.com\/rapidkit(?:\/|$)/i, "legacy rapidkit GitHub organization URL"],
  [
    /youtube\.com\/@rapidkitlabs(?:\/|$)/i,
    "legacy RapidKit Labs YouTube handle",
  ],
  [/"author"\s*:\s*"RapidKit Labs"/i, "legacy package author"],
];

const violations = [];
for (const file of files) {
  const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
  for (const [pattern, message] of forbidden) {
    if (pattern.test(content)) {
      violations.push(`${file}: ${message}`);
    }
  }
}

const manifests = [
  ["package.json", "git+https://github.com/chistiq/workspai.git"],
  ["packages/cli/package.json", "git+https://github.com/chistiq/workspai.git"],
  [
    "packages/wspai/package.json",
    "git+https://github.com/chistiq/workspai.git",
  ],
];

for (const [file, expectedRepository] of manifests) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, file), "utf8"),
  );
  const repository =
    typeof manifest.repository === "string"
      ? manifest.repository
      : manifest.repository?.url;
  for (const [field, actual, expected] of [
    ["author", manifest.author, "Chistiq"],
    ["repository", repository, expectedRepository],
    ["homepage", manifest.homepage, "https://www.workspai.com/"],
    [
      "bugs.url",
      manifest.bugs?.url,
      "https://github.com/chistiq/workspai/issues",
    ],
  ]) {
    if (actual !== expected) {
      violations.push(
        `${file}: ${field} must be "${expected}" (received "${actual ?? ""}")`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Chistiq brand contract failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Chistiq brand contract passed (${files.length} text files checked).`,
);
