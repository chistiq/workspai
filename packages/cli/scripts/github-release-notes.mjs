#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPOSITORY_ROOT = path.resolve(CLI_ROOT, '..', '..');
const REPOSITORY_URL = 'https://github.com/chistiq/workspai';

function parseArguments(argv) {
  const options = {
    aggregate: undefined,
    check: false,
    output: undefined,
    tag: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--aggregate') {
      options.aggregate = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument === '--output') {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--tag') {
      options.tag = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function assertReleaseTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
}

function repositoryRelativePath(absolutePath) {
  const relativePath = path.relative(REPOSITORY_ROOT, absolutePath).replaceAll(path.sep, '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new Error(`Release notes path is outside the repository: ${absolutePath}`);
  }
  return relativePath;
}

export function rewriteReleaseBodyLinks(markdown, { tag, sourcePath }) {
  assertReleaseTag(tag);
  const sourceDirectory = path.dirname(sourcePath);

  return markdown.replace(/(\]\()((?:\.{1,2}\/)[^)\s]+)(\))/g, (_match, open, href, close) => {
    const [pathname, suffix = ''] = href.split(/(?=[?#])/u, 2);
    const targetPath = path.resolve(sourceDirectory, pathname);
    const targetRelativePath = repositoryRelativePath(targetPath);
    return `${open}${REPOSITORY_URL}/blob/${tag}/${targetRelativePath}${suffix}${close}`;
  });
}

export async function renderGitHubReleaseBody(tag) {
  assertReleaseTag(tag);
  const version = tag.slice(1);
  const sourcePath = path.join(CLI_ROOT, 'releases', `RELEASE_NOTES_v${version}.md`);

  let markdown;
  try {
    markdown = await fs.readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`Missing versioned release notes: ${repositoryRelativePath(sourcePath)}`);
    }
    throw error;
  }

  const rendered = rewriteReleaseBodyLinks(markdown.trim(), { tag, sourcePath });
  const sourceRelativePath = repositoryRelativePath(sourcePath);
  const canonicalUrl = `${REPOSITORY_URL}/blob/${tag}/${sourceRelativePath}`;
  const body = `${rendered}\n\n---\n\n[Full Release Notes](${canonicalUrl})\n`;

  if (/(\]\()((?:\.{1,2}\/)[^)\s]+)(\))/u.test(body)) {
    throw new Error(`Rendered release body still contains a relative Markdown link for ${tag}`);
  }

  return {
    body,
    canonicalUrl,
    sourcePath,
    sourceRelativePath,
    tag,
  };
}

export function validateAggregateReleaseLinks(markdown, { currentTag }) {
  assertReleaseTag(currentTag);
  const releaseLinkPattern =
    /\]\(([^)\s]*RELEASE_NOTES_v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md)\)/gu;
  const links = [...markdown.matchAll(releaseLinkPattern)];
  if (links.length === 0) {
    throw new Error('Aggregate release notes do not contain any versioned release-note links');
  }

  for (const [, href, version] of links) {
    if (/^(?:\.{1,2}\/|releases\/)/u.test(href)) {
      throw new Error(`Aggregate release notes contain a relative release-note link: ${href}`);
    }

    const absoluteMatch = href.match(
      /^https:\/\/github\.com\/chistiq\/workspai\/blob\/(main|v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\/packages\/cli\/releases\/RELEASE_NOTES_v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md$/u
    );
    if (!absoluteMatch) {
      throw new Error(`Aggregate release notes contain a non-canonical release-note link: ${href}`);
    }

    const [, ref, targetVersion] = absoluteMatch;
    if (targetVersion !== version) {
      throw new Error(`Release-note link label/path version mismatch: ${href}`);
    }
    if (ref !== 'main' && ref !== `v${targetVersion}`) {
      throw new Error(`Release-note tag does not match its target version: ${href}`);
    }
  }

  const currentVersion = currentTag.slice(1);
  const currentCanonicalUrl = `${REPOSITORY_URL}/blob/${currentTag}/packages/cli/releases/RELEASE_NOTES_v${currentVersion}.md`;
  if (!links.some(([, href]) => href === currentCanonicalUrl)) {
    throw new Error(
      `Aggregate release notes are missing the current tag-bound link: ${currentCanonicalUrl}`
    );
  }

  return links.length;
}

async function resolveDefaultTag() {
  const packageJson = JSON.parse(await fs.readFile(path.join(CLI_ROOT, 'package.json'), 'utf8'));
  return `v${packageJson.version}`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const currentTag = await resolveDefaultTag();
  const tag = options.tag ?? currentTag;
  const rendered = await renderGitHubReleaseBody(tag);
  const aggregatePath = path.resolve(options.aggregate ?? path.join(CLI_ROOT, 'RELEASE_NOTES.md'));
  const aggregateMarkdown = await fs.readFile(aggregatePath, 'utf8');
  const aggregateLinkCount = validateAggregateReleaseLinks(aggregateMarkdown, {
    currentTag,
  });

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, rendered.body, 'utf8');
  }

  if (options.check || !options.output) {
    console.log(`✅ GitHub release body contract passed for ${tag}`);
    console.log(`   Source: ${rendered.sourceRelativePath}`);
    console.log(`   URL: ${rendered.canonicalUrl}`);
    console.log(`   Aggregate links: ${aggregateLinkCount}`);
  }
}

const isEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
