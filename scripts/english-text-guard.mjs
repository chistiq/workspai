#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const ALLOWED_LETTERLIKE_SYMBOLS = new Set([0x2139]);

function lineNumberAt(content, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function violationKind(character) {
  const codePoint = character.codePointAt(0);
  if (
    codePoint === undefined ||
    codePoint <= 0x7f ||
    ALLOWED_LETTERLIKE_SYMBOLS.has(codePoint)
  ) {
    return null;
  }
  if (/\p{Letter}/u.test(character)) return "non-ascii-letter";
  if (/\p{Decimal_Number}/u.test(character)) return "non-ascii-digit";
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return "combining-mark";
  return null;
}

export function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  return sample.includes(0);
}

export function findNonEnglishTextViolations(content, file) {
  const violations = [];
  let index = 0;
  for (const character of content) {
    const kind = violationKind(character);
    if (kind) {
      violations.push({
        file,
        line: lineNumberAt(content, index),
        column: index - content.lastIndexOf("\n", index - 1),
        kind,
        codePoint: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
      });
    }
    index += character.length;
  }
  return violations;
}

function gitFileList(repositoryRoot, mode) {
  const args =
    mode === "staged"
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
      : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to index repository files: ${result.stderr || result.error || "git failed"}`,
    );
  }
  return result.stdout.split("\0").filter(Boolean);
}

function readCandidate(repositoryRoot, file, mode) {
  try {
    if (mode !== "staged")
      return fs.readFileSync(path.join(repositoryRoot, file));
    const result = spawnSync("git", ["show", `:${file}`], {
      cwd: repositoryRoot,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return result.status === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

export function scanRepository(options = {}) {
  const mode = options.mode === "staged" ? "staged" : "all";
  const repositoryRoot = path.resolve(
    options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
  );
  const files = gitFileList(repositoryRoot, mode);
  const violations = [];

  for (const file of files) {
    violations.push(...findNonEnglishTextViolations(file, file));
    const buffer = readCandidate(repositoryRoot, file, mode);
    if (!buffer || looksBinary(buffer)) continue;
    violations.push(
      ...findNonEnglishTextViolations(buffer.toString("utf8"), file),
    );
  }

  return { mode, filesScanned: new Set(files).size, violations };
}

function main() {
  const mode = process.argv.includes("--staged") ? "staged" : "all";
  const result = scanRepository({ mode });
  if (result.violations.length === 0) {
    console.log(
      `English text guard passed (${result.mode}; ${result.filesScanned} repository files).`,
    );
    return;
  }

  console.error(
    `\nEnglish text guard blocked ${result.violations.length} finding(s):`,
  );
  for (const violation of result.violations.slice(0, 50)) {
    console.error(
      `- ${violation.file}:${violation.line}:${violation.column} [${violation.kind}; ${violation.codePoint}]`,
    );
  }
  if (result.violations.length > 50) {
    console.error(`- ...and ${result.violations.length - 50} more`);
  }
  console.error(
    "\nUse ASCII English for authored text. Unicode symbols and emoji remain supported when they do not encode language.",
  );
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
