import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "package-mirrors.json"), "utf8"),
);
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const packageName = valueAfter("--package");
const outputArgument = valueAfter("--output");
const sourceCommit = valueAfter("--source-commit");
if (!packageName || !outputArgument || !sourceCommit) {
  console.error(
    "Usage: npm run package-mirror:export -- --package <name> --output <empty-directory> --source-commit <full-sha>",
  );
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
  console.error("--source-commit must be a lowercase full Git SHA.");
  process.exit(2);
}

const definition = config.packages.find((entry) => entry.name === packageName);
if (!definition) {
  console.error(`Unknown package mirror: ${packageName}`);
  process.exit(2);
}

const packageRoot = path.resolve(root, definition.sourceDirectory);
const output = path.resolve(outputArgument);
if (
  output === root ||
  output === packageRoot ||
  output.startsWith(`${packageRoot}${path.sep}`)
) {
  console.error("Mirror output must be outside the canonical package source.");
  process.exit(2);
}

if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
  console.error(`Mirror output must be absent or empty: ${output}`);
  process.exit(2);
}
fs.mkdirSync(output, { recursive: true });

for (const entry of definition.include) {
  const source = path.join(packageRoot, entry);
  const destination = path.join(output, entry);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
  });
}

const exportedAt = new Date().toISOString();
const metadata = {
  schemaVersion: "workspai-package-mirror-export.v1",
  package: packageName,
  canonicalRepository: config.canonicalRepository,
  canonicalDirectory: definition.sourceDirectory,
  canonicalCommit: sourceCommit,
  mirrorRepository: definition.mirrorRepository,
  authority: "discovery-only",
  documentation: "consumer-facing-only",
  direction: "one-way",
  exportedAt,
};

fs.writeFileSync(
  path.join(output, ".workspai-mirror.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  { flag: "wx" },
);
fs.writeFileSync(
  path.join(output, "MIRROR_NOTICE.md"),
  `# Official Workspai package mirror\n\n` +
    `This repository is a read-only discovery mirror for \`${packageName}\`.\n\n` +
    `Canonical source: ${config.canonicalRepository}/tree/${sourceCommit}/${definition.sourceDirectory}\n\n` +
    `Development, pull requests, issues, versions, tags, releases and npm publication are managed in the canonical Workspai monorepo. Direct changes to this mirror are not accepted.\n\n` +
    `Only README, changelog and license documentation is projected here. The complete documentation portfolio is maintained outside the public package repositories.\n`,
  { flag: "wx" },
);

console.log(
  `Exported ${packageName} mirror projection from ${sourceCommit} to ${output}`,
);
