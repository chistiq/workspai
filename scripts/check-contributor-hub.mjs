#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, ".github", "contributor-issues.v1.json");
const hubPath = path.join(root, ".github", "CONTRIBUTING.md");
const live = process.argv.slice(2).includes("--live");

function fail(message) {
  console.error(`[contributor-hub] ${message}`);
  process.exit(1);
}

function readManifest() {
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (value.schemaVersion !== "workspai.contributor-issues.v1") {
    fail("unsupported contributor issue manifest schema");
  }
  if (value.repository !== "chistiq/workspai" || !Array.isArray(value.issues)) {
    fail("manifest repository or issues collection is invalid");
  }
  return value;
}

function validateManifest(manifest) {
  const backlogIds = new Set();
  const numbers = new Set();
  for (const issue of manifest.issues) {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
      fail("every manifest issue must be an object");
    }
    if (!/^B\d{3}$/u.test(issue.backlogId)) {
      fail(`invalid backlog ID: ${String(issue.backlogId)}`);
    }
    if (backlogIds.has(issue.backlogId))
      fail(`duplicate backlog ID: ${issue.backlogId}`);
    if (!Number.isInteger(issue.number) || issue.number < 1) {
      fail(`invalid GitHub issue number for ${issue.backlogId}`);
    }
    if (numbers.has(issue.number))
      fail(`duplicate GitHub issue number: ${issue.number}`);
    if (
      typeof issue.title !== "string" ||
      issue.title !== issue.title.trim() ||
      !issue.title.startsWith("[Feature]: ")
    ) {
      fail(`invalid title for ${issue.backlogId}`);
    }
    if (
      !Array.isArray(issue.labels) ||
      issue.labels.length === 0 ||
      issue.labels.some(
        (label) =>
          typeof label !== "string" || label.trim() !== label || !label,
      )
    ) {
      fail(`missing labels for ${issue.backlogId}`);
    }
    if (new Set(issue.labels).size !== issue.labels.length) {
      fail(`duplicate labels for ${issue.backlogId}`);
    }
    if (typeof issue.contributorRoute !== "boolean") {
      fail(`contributorRoute must be boolean for ${issue.backlogId}`);
    }
    backlogIds.add(issue.backlogId);
    numbers.add(issue.number);
  }

  const routes = manifest.issues.filter((issue) => issue.contributorRoute);
  if (routes.length < 3 || routes.length > 5) {
    fail(
      `the visible maintainer-routed queue must contain 3-5 issues; found ${routes.length}`,
    );
  }
  return { numbers, routes };
}

function validateHubLinks(manifest, numbers, routes) {
  const hub = fs.readFileSync(hubPath, "utf8");
  const directNumbers = [
    ...hub.matchAll(
      /https:\/\/github\.com\/chistiq\/workspai\/issues\/(\d+)/gu,
    ),
  ].map((match) => Number(match[1]));

  for (const number of directNumbers) {
    if (!numbers.has(number))
      fail(`Contribution Hub links to unmapped issue #${number}`);
  }
  const routeSection = hub.match(
    /## Current Maintainer-Routed Starting Points\n(?<body>[\s\S]*?)(?=\n## )/u,
  )?.groups?.body;
  if (!routeSection) {
    fail("Contribution Hub is missing its maintainer-routed section");
  }
  const routeNumbers = [
    ...routeSection.matchAll(
      /https:\/\/github\.com\/chistiq\/workspai\/issues\/(\d+)/gu,
    ),
  ].map((match) => Number(match[1]));
  const expectedRouteNumbers = routes
    .map((issue) => issue.number)
    .sort((a, b) => a - b);
  const visibleRouteNumbers = [...new Set(routeNumbers)].sort((a, b) => a - b);
  if (
    JSON.stringify(visibleRouteNumbers) !== JSON.stringify(expectedRouteNumbers)
  ) {
    fail(
      `Contribution Hub routes [${visibleRouteNumbers.join(", ")}] differ from manifest routes [${expectedRouteNumbers.join(", ")}]`,
    );
  }

  if (!hub.includes("no%3Aassignee+label%3A%22good+first+issue%22")) {
    fail("Contribution Hub good-first query must exclude assigned issues");
  }
}

async function validateLiveIssues(manifest) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "workspai-contributor-hub-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let liveIssues;
  try {
    liveIssues = await Promise.all(
      manifest.issues.map(async (expected) => {
        const response = await fetch(
          `https://api.github.com/repos/${manifest.repository}/issues/${expected.number}`,
          { headers, signal: AbortSignal.timeout(15_000) },
        );
        if (!response.ok) {
          throw new Error(
            `#${expected.number} returned HTTP ${response.status}`,
          );
        }
        return response.json();
      }),
    );
  } catch (error) {
    fail(
      `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const [index, expected] of manifest.issues.entries()) {
    const issue = liveIssues[index];
    if (issue.pull_request)
      fail(`#${expected.number} resolves to a pull request`);
    if (issue.state !== "open")
      fail(`#${expected.number} is ${issue.state}, not open`);
    if (issue.title !== expected.title)
      fail(`#${expected.number} title drifted`);
    const labels = new Set(issue.labels.map((label) => label.name));
    for (const label of expected.labels) {
      if (!labels.has(label))
        fail(`#${expected.number} is missing label ${label}`);
    }
    if (
      expected.contributorRoute &&
      (!Array.isArray(issue.assignees) || issue.assignees.length > 0)
    ) {
      fail(
        `#${expected.number} is routed to contributors but already assigned`,
      );
    }
  }
}

const manifest = readManifest();
const { numbers, routes } = validateManifest(manifest);
validateHubLinks(manifest, numbers, routes);
if (live) await validateLiveIssues(manifest);

console.log(
  `[contributor-hub] ${manifest.issues.length} mapped issues and ${routes.length} maintainer-routed starting points passed${live ? " live GitHub validation" : " offline validation"}.`,
);
