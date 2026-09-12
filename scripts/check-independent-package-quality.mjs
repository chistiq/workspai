import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedToolRequire = createRequire(
  path.join(root, "packages/shared/package.json"),
);
const Ajv2020 = sharedToolRequire("ajv/dist/2020").default;
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch (error) {
    fail(
      `${relativePath} is not readable JSON: ${error instanceof Error ? error.message : error}`,
    );
    return {};
  }
}

function normalizeSafePortablePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    return undefined;
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

function isPortablePathOwnedBy(relativePath, ownerDirectory) {
  const normalized = normalizeSafePortablePath(relativePath);
  if (!normalized) return false;
  if (!ownerDirectory) return true;
  const normalizedOwner = normalizeSafePortablePath(ownerDirectory);
  if (!normalizedOwner) return false;
  return (
    normalized === normalizedOwner ||
    normalized.startsWith(`${normalizedOwner}/`)
  );
}

function isSafeFile(relativePath, ownerDirectory) {
  if (!isPortablePathOwnedBy(relativePath, ownerDirectory)) return false;
  const normalized = normalizeSafePortablePath(relativePath);
  if (!normalized) return false;
  const absolute = path.resolve(root, ...normalized.split("/"));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`))
    return false;
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile())
    return false;
  return true;
}

const portablePathControls = [
  ["packages/shared/README.md", "packages/shared", true],
  ["./packages/shared/README.md", "packages/shared", true],
  ["packages/graph/README.md", "packages/shared", false],
  ["packages/sharedness/README.md", "packages/shared", false],
  ["../packages/shared/README.md", "packages/shared", false],
  ["packages\\shared\\README.md", "packages/shared", false],
  ["C:/packages/shared/README.md", "packages/shared", false],
];
for (const [candidate, owner, expected] of portablePathControls) {
  if (isPortablePathOwnedBy(candidate, owner) !== expected) {
    fail(`portable package path control failed for ${candidate}`);
  }
}

function normalizePackagePath(value) {
  return value.replace(/^\.\//u, "").replaceAll("\\", "/").replace(/\/$/u, "");
}

function allowlistIncludes(relativePath, entries) {
  const candidate = normalizePackagePath(relativePath);
  let included = false;
  for (const rawEntry of entries ?? []) {
    if (typeof rawEntry !== "string" || rawEntry.length === 0) continue;
    const excluded = rawEntry.startsWith("!");
    const entry = normalizePackagePath(excluded ? rawEntry.slice(1) : rawEntry);
    const matches =
      candidate === entry ||
      candidate.startsWith(`${entry}/`) ||
      (entry.includes("*") &&
        new RegExp(
          `^${entry
            .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
            .replaceAll("**", ".*")
            .replaceAll("*", "[^/]*")}$`,
          "u",
        ).test(candidate));
    if (matches) included = !excluded;
  }
  return included;
}

function collectPackageMarkdown(packageDirectory) {
  const markdown = [];
  const pending = [packageDirectory];
  const ignoredDirectories = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".git",
  ]);
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) {
        if (!ignoredDirectories.has(item.name)) pending.push(absolute);
        continue;
      }
      if (item.isFile() && item.name.endsWith(".md")) {
        markdown.push(
          path.relative(packageDirectory, absolute).split(path.sep).join("/"),
        );
      }
    }
  }
  return markdown.sort();
}

const policy = readJson("independent-package-quality-policy.v1.json");
const registry = readJson("independent-packages.json");
const closureSchema = readJson(
  "contracts/independent-package-stage-closure.v1.json",
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
});
let validateClosure;
try {
  validateClosure = ajv.compile(closureSchema);
  const negativeContractCases = [
    {},
    {
      schemaVersion: "workspai-independent-package-stage-closure.v1",
      unexpected: true,
    },
  ];
  if (negativeContractCases.some((candidate) => validateClosure(candidate))) {
    fail("stage closure contract accepted a built-in invalid control case");
  }
} catch (error) {
  fail(
    `stage closure contract does not compile strictly: ${error instanceof Error ? error.message : error}`,
  );
}

if (policy.schemaVersion !== "workspai-independent-package-quality-policy.v1") {
  fail("unsupported independent package quality policy schema");
}
if (policy.version !== "1.0.0-candidate")
  fail("unexpected quality policy version");
if (policy.documentationLayout?.nestedMarkdown !== "forbidden") {
  fail("package documentation policy must forbid nested Markdown");
}
if (
  closureSchema.$id !== "https://schemas.workspai.dev/packages/stage-closure/v1"
) {
  fail("stage closure contract identity drifted");
}
if (registry.qualityPolicy !== "independent-package-quality-policy.v1.json") {
  fail("independent package registry must bind the quality policy");
}
if (registry.stageClosureContract !== policy.stageClosureContract) {
  fail(
    "independent package registry and quality policy disagree on the closure contract",
  );
}

const dimensions = policy.qualityDimensions ?? [];
const dimensionIds = dimensions.map((dimension) => dimension.id);
if (dimensions.length !== 12 || new Set(dimensionIds).size !== 12) {
  fail("quality policy must define exactly 12 unique dimensions");
}
for (const dimension of dimensions) {
  if (
    !dimension.intent ||
    !Array.isArray(dimension.requiredEvidence) ||
    dimension.requiredEvidence.length === 0
  ) {
    fail(`quality dimension ${dimension.id ?? "<unknown>"} is incomplete`);
  }
}

for (const entry of registry.packages ?? []) {
  const manifest = readJson(`${entry.directory}/package.json`);
  for (const document of policy.requiredDocuments ?? []) {
    const relativePath = `${entry.directory}/${document.path}`;
    if (!isSafeFile(relativePath, entry.directory))
      fail(`${entry.name} is missing ${document.path}`);
    const published = allowlistIncludes(document.path, manifest.files);
    if (document.publish && !published)
      fail(
        `${entry.name} package allowlist omits public document ${document.path}`,
      );
    if (!document.publish && published)
      fail(
        `${entry.name} package allowlist leaks internal document ${document.path}`,
      );
  }
  const packageDirectory = path.join(root, entry.directory);
  const packageMarkdown = collectPackageMarkdown(packageDirectory);
  const allowedRootFiles = new Set(
    policy.documentationLayout?.rootAllowed ?? [],
  );
  for (const document of packageMarkdown) {
    if (document.includes("/")) {
      fail(`${entry.name} has forbidden nested documentation: ${document}`);
    } else if (!allowedRootFiles.has(document)) {
      fail(`${entry.name} has misplaced root documentation: ${document}`);
    }
  }
  for (const forbiddenPath of policy.documentationLayout
    ?.forbiddenRepositoryPaths ?? []) {
    if (fs.existsSync(path.join(packageDirectory, forbiddenPath))) {
      fail(
        `${entry.name} public repository contains forbidden documentation path ${forbiddenPath}`,
      );
    }
  }
  for (const prefix of policy.documentationLayout?.forbiddenPublishedPrefixes ??
    []) {
    if (allowlistIncludes(`${prefix}sentinel`, manifest.files))
      fail(
        `${entry.name} package allowlist exposes forbidden prefix ${prefix}`,
      );
  }
  for (const script of policy.requiredScripts ?? []) {
    if (
      typeof manifest.scripts?.[script] !== "string" ||
      manifest.scripts[script].length === 0
    ) {
      fail(`${entry.name} is missing required script ${script}`);
    }
  }
  if (
    !/^workspai-docs:Packages\/[a-z0-9-]+\/QUALITY_AND_STAGE_GATES\.md$/u.test(
      entry.qualityPlanRef ?? "",
    )
  ) {
    fail(`${entry.name} has no canonical maintainer quality-plan reference`);
  }
  if (
    ![
      "in-progress",
      "local-source-complete",
      "closed-awaiting-approval",
      "approved",
      "blocked",
    ].includes(entry.stageStatus)
  ) {
    fail(`${entry.name} has invalid stageStatus`);
  }
  if (entry.stageStatus === "in-progress") {
    if (entry.latestClosure !== null) {
      if (!isSafeFile(entry.latestClosure, entry.directory)) {
        fail(`${entry.name} has an unsafe prior-stage closure`);
      } else {
        const priorClosure = readJson(entry.latestClosure);
        if (validateClosure && !validateClosure(priorClosure)) {
          fail(
            `${entry.name} prior closure violates its JSON Schema: ${ajv.errorsText(validateClosure.errors)}`,
          );
        }
        if (
          priorClosure.approval?.status !== "approved" ||
          priorClosure.nextStageAuthorized !== true ||
          priorClosure.nextStage !== entry.currentStage
        ) {
          fail(
            `${entry.name} active stage is not authorized by its prior closure`,
          );
        }
      }
    }
    continue;
  }
  if (!isSafeFile(entry.latestClosure, entry.directory)) {
    fail(`${entry.name} closed stage requires a safe package-owned closure`);
    continue;
  }

  const closure = readJson(entry.latestClosure);
  if (validateClosure && !validateClosure(closure)) {
    fail(
      `${entry.name} latest closure violates its JSON Schema: ${ajv.errorsText(validateClosure.errors)}`,
    );
  }
  if (
    closure.schemaVersion !== "workspai-independent-package-stage-closure.v1"
  ) {
    fail(
      `${entry.name} latest closure does not implement the shared closure contract`,
    );
  }
  if (closure.policyVersion !== policy.version)
    fail(`${entry.name} closure policy version drifted`);
  if (closure.package !== entry.name)
    fail(`${entry.name} closure package identity drifted`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(closure.asOf ?? ""))
    fail(`${entry.name} closure date is invalid`);
  const closureDimensions = closure.dimensions ?? [];
  const closureIds = closureDimensions.map((dimension) => dimension.id);
  if (
    closureIds.length !== dimensionIds.length ||
    new Set(closureIds).size !== dimensionIds.length ||
    dimensionIds.some((id) => !closureIds.includes(id))
  ) {
    fail(
      `${entry.name} closure must report every quality dimension exactly once`,
    );
  }
  for (const dimension of closureDimensions) {
    if (
      !policy.closureRules.allowedDimensionStatuses.includes(dimension.status)
    ) {
      fail(`${entry.name} closure has invalid status for ${dimension.id}`);
    }
    if (
      !dimension.summary ||
      !Array.isArray(dimension.evidence) ||
      dimension.evidence.length === 0
    ) {
      fail(`${entry.name} closure has incomplete evidence for ${dimension.id}`);
    }
    for (const evidencePath of dimension.evidence ?? []) {
      if (!isSafeFile(evidencePath))
        fail(
          `${entry.name} closure evidence is missing or unsafe: ${evidencePath}`,
        );
    }
    if (dimension.status === "not-applicable" && !dimension.justification) {
      fail(`${entry.name} closure must justify not-applicable ${dimension.id}`);
    }
  }
  if (!Array.isArray(closure.checks) || closure.checks.length === 0)
    fail(`${entry.name} closure has no checks`);
  if (
    !Array.isArray(closure.environment?.local) ||
    closure.environment.local.length === 0
  ) {
    fail(`${entry.name} closure has no local environment evidence`);
  }
  const hasBlockingDimension = closureDimensions.some(
    (dimension) => dimension.status === "blocked",
  );
  const hasRemotePending = closureDimensions.some(
    (dimension) => dimension.status === "pending-remote",
  );
  if (hasBlockingDimension && closure.nextStageAuthorized !== false) {
    fail(`${entry.name} blocked closure cannot authorize the next stage`);
  }
  if (hasRemotePending && closure.advancesAdmissionGate !== false) {
    fail(`${entry.name} remote-pending closure cannot advance admission`);
  }
  if (closure.nextStageAuthorized && closure.approval?.status !== "approved") {
    fail(
      `${entry.name} next stage requires explicit approved closure evidence`,
    );
  }
  if (
    entry.stageStatus === "local-source-complete" &&
    (closure.stage !== entry.currentStage ||
      closure.status !==
      "local-passed-remote-pending-awaiting-approval" ||
      !hasRemotePending ||
      closure.environment?.remoteMatrix !== "pending" ||
      closure.advancesAdmissionGate !== false ||
      closure.nextStageAuthorized !== false ||
      closure.approval?.status !== "awaiting")
  ) {
    fail(
      `${entry.name} local-source-complete stage requires a remote-pending, non-admitting closure awaiting approval`,
    );
  }
  if (
    entry.stageStatus === "closed-awaiting-approval" &&
    (closure.status !== "passed-awaiting-approval" ||
      hasRemotePending ||
      closure.approval?.status !== "awaiting")
  ) {
    fail(`${entry.name} stage registry and closure approval state disagree`);
  }
  if (entry.stageStatus === "blocked" && closure.status !== "blocked") {
    fail(`${entry.name} blocked stage must reference a blocked closure`);
  }
  if (closure.status === "blocked" && entry.stageStatus !== "blocked") {
    fail(
      `${entry.name} blocked closure must be reflected by the stage registry`,
    );
  }
}

if (failures.length > 0) {
  console.error("Independent package quality guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Independent package quality passed: ${registry.packages.length} packages, ${dimensionIds.length} permanent dimensions.`,
  );
}
