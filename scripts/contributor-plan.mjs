#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

const commands = {
  english: "corepack npm run check:english-text",
  docs: "corepack npm --workspace workspai run validate:docs",
  typecheck: "corepack npm --workspace workspai run typecheck",
  lint: "corepack npm --workspace workspai run lint",
  format: "corepack npm --workspace workspai run format:check",
  test: "corepack npm --workspace workspai test",
  contracts: "corepack npm --workspace workspai run contracts:validate",
  lockfile: "corepack npm run check:cross-platform-lockfile",
  workflow: "corepack npm --workspace workspai run validate",
};

const routeDefinitions = [
  {
    id: "contracts",
    label: "Contracts and public machine output",
    description:
      "Schemas, generated contract mirrors, compatibility, or public JSON behavior.",
    matches: (file) =>
      file.includes("/contracts/") ||
      file.startsWith("contracts/") ||
      /(?:^|\/)src\/contracts\//u.test(file) ||
      /(?:contract|schema).*\.test\.ts$/u.test(file),
    validation: ["english", "typecheck", "lint", "format", "contracts"],
  },
  {
    id: "runtime",
    label: "CLI implementation",
    description:
      "Commands, runtime behavior, providers, lifecycle, or other TypeScript source.",
    matches: (file) =>
      file.startsWith("packages/cli/src/") &&
      !file.includes("/__tests__/") &&
      !file.endsWith(".test.ts"),
    validation: ["english", "typecheck", "lint", "format", "test"],
  },
  {
    id: "tests",
    label: "Tests and fixtures",
    description:
      "Regression coverage, fixtures, qualification, or platform behavior.",
    matches: (file) =>
      file.includes("/__tests__/") ||
      file.endsWith(".test.ts") ||
      file.includes("/fixtures/") ||
      file.includes("/test-fixtures/"),
    validation: ["english", "typecheck", "lint", "format", "test"],
  },
  {
    id: "docs",
    label: "Documentation",
    description:
      "Guides, examples, contribution material, release notes, or repository Markdown.",
    matches: (file) =>
      file.endsWith(".md") || file.startsWith("packages/cli/docs/"),
    validation: ["english", "docs"],
  },
  {
    id: "automation",
    label: "Automation and developer tooling",
    description:
      "GitHub workflows, repository scripts, build configuration, or contributor tooling.",
    matches: (file) =>
      file.startsWith(".github/workflows/") ||
      file.startsWith("scripts/") ||
      file.startsWith("packages/cli/scripts/") ||
      /(?:^|\/)(?:tsconfig|vitest|tsup|eslint)[^/]*\.(?:js|mjs|cjs|json|ts)$/u.test(
        file,
      ),
    validation: ["english", "typecheck", "lint", "format", "workflow"],
  },
  {
    id: "dependencies",
    label: "Dependencies and package metadata",
    description:
      "Package manifests, the lockfile, published files, or npm lifecycle behavior.",
    matches: (file) =>
      file === "package-lock.json" ||
      file.endsWith("/package.json") ||
      file === "package.json",
    validation: ["english", "lockfile", "workflow"],
  },
];

export function normalizeRepositoryPath(file) {
  const normalized = file.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    throw new Error(
      `Contributor plan requires a repository-relative path: ${file}`,
    );
  }
  return normalized;
}

export function buildContributorPlan(files) {
  const normalizedFiles = [
    ...new Set(files.map(normalizeRepositoryPath)),
  ].sort();
  const routes = routeDefinitions
    .filter((route) => normalizedFiles.some((file) => route.matches(file)))
    .map(({ id, label, description, validation }) => ({
      id,
      label,
      description,
      validation,
    }));

  if (routes.length === 0 && normalizedFiles.length > 0) {
    routes.push({
      id: "general",
      label: "General repository change",
      description:
        "A repository change outside the specialized contribution paths.",
      validation: ["english", "workflow"],
    });
  }

  const validationIds = [];
  for (const route of routes) {
    for (const commandId of route.validation) {
      if (!validationIds.includes(commandId)) validationIds.push(commandId);
    }
  }

  return {
    schemaVersion: "workspai.contributor-validation-plan.v1",
    status: normalizedFiles.length === 0 ? "no-changes" : "ready",
    files: normalizedFiles,
    routes: routes.map(({ validation: _validation, ...route }) => route),
    commands: validationIds.map((id) => ({ id, command: commands[id] })),
  };
}

function discoverChangedFiles() {
  const invocations = [
    ["diff", "--name-only", "-z", "--relative", "--diff-filter=ACMR"],
    [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--relative",
      "--diff-filter=ACMR",
    ],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ];
  const files = [];
  for (const args of invocations) {
    const result = spawnSync("git", args, {
      cwd: repositoryRoot,
      encoding: "buffer",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        result.stderr.toString("utf8").trim() ||
          `git ${args.join(" ")} exited with ${result.status}`,
      );
    }
    files.push(...result.stdout.toString("utf8").split("\0").filter(Boolean));
  }
  return files;
}

function parseArguments(argv) {
  const options = { json: false, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--file") {
      const file = argv[index + 1];
      if (!file) throw new Error("--file requires a repository-relative path");
      options.files.push(file);
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      return { ...options, help: true };
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function renderHuman(plan) {
  if (plan.status === "no-changes") {
    return [
      "Contributor validation plan",
      "",
      "No staged, unstaged, or untracked files were found.",
      "Make a focused change, then run this command again.",
    ].join("\n");
  }
  return [
    `Contributor validation plan · ${plan.files.length} changed file(s)`,
    "",
    "Detected paths:",
    ...plan.routes.map((route) => `- ${route.label}: ${route.description}`),
    "",
    "Run before opening the pull request:",
    ...plan.commands.map((entry, index) => `${index + 1}. ${entry.command}`),
    "",
    "List any command you could not run in the pull request Validation section.",
  ].join("\n");
}

function printHelp() {
  console.log(`Usage: corepack npm run contributor:plan -- [options]

Build a deterministic validation plan from staged, unstaged, and untracked files.

Options:
  --file <path>  Plan for an explicit repository-relative path; repeatable
  --json         Emit the machine-readable plan
  -h, --help     Show this help`);
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const plan = buildContributorPlan(
      options.files.length > 0 ? options.files : discoverChangedFiles(),
    );
    console.log(
      options.json ? JSON.stringify(plan, null, 2) : renderHuman(plan),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
