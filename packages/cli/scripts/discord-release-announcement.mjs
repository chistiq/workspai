#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseDocument } from './release-document.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const PRODUCT_CATALOG_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'cli',
  'releases',
  'release-products.v1.json'
);
const DISCORD_EMBED_COLOR = 0x00bfb3;
const MAX_HIGHLIGHTS = 5;

function parseArguments(argv) {
  const options = {
    check: false,
    markdownOutput: undefined,
    output: undefined,
    productId: undefined,
    send: false,
    tag: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument === '--markdown-output') {
      options.markdownOutput = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--output') {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--product') {
      options.productId = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--send') {
      options.send = true;
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

function assertNonEmptyString(value, label, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (maximumLength && value.trim().length > maximumLength) {
    throw new Error(`${label} must not exceed ${maximumLength} characters`);
  }
  return value.trim();
}

function assertReleaseTag(tag) {
  if (
    typeof tag !== 'string' ||
    tag.length === 0 ||
    tag.length > 100 ||
    !/^[0-9A-Za-z@._+/-]+$/u.test(tag)
  ) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
}

function interpolate(template, version) {
  return template.replaceAll('{version}', version);
}

function resolveRepositoryPath(relativePath, label) {
  const value = assertNonEmptyString(relativePath, label, 240);
  const absolutePath = path.resolve(REPOSITORY_ROOT, value);
  const repositoryPrefix = `${REPOSITORY_ROOT}${path.sep}`;
  if (absolutePath !== REPOSITORY_ROOT && !absolutePath.startsWith(repositoryPrefix)) {
    throw new Error(`${label} must remain inside the repository`);
  }
  return absolutePath;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readProductVersion(productId, product) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new Error(`Release product ${productId} must be an object`);
  }
  assertNonEmptyString(product.displayName, `${productId} displayName`, 80);
  assertNonEmptyString(product.repository, `${productId} repository`, 160);
  if (!/^[0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+$/u.test(product.repository)) {
    throw new Error(`${productId} repository must use owner/name format`);
  }
  const tagTemplate = assertNonEmptyString(product.tagTemplate, `${productId} tagTemplate`, 100);
  if (!tagTemplate.includes('{version}')) {
    throw new Error(`${productId} tagTemplate must include {version}`);
  }
  const notesPattern = assertNonEmptyString(
    product.releaseNotesPattern,
    `${productId} releaseNotesPattern`,
    240
  );
  if (!notesPattern.includes('{version}')) {
    throw new Error(`${productId} releaseNotesPattern must include {version}`);
  }
  const upgradeCommand = assertNonEmptyString(
    product.upgradeCommand,
    `${productId} upgradeCommand`,
    240
  );
  if (!upgradeCommand.includes('{version}')) {
    throw new Error(`${productId} upgradeCommand must include {version}`);
  }

  const packagePath = resolveRepositoryPath(product.packagePath, `${productId} packagePath`);
  const packageJson = await readJson(packagePath);
  const version = assertNonEmptyString(packageJson.version, `${productId} package version`, 64);
  return {
    packagePath,
    version,
  };
}

async function resolveProduct(catalog, requestedProductId, requestedTag) {
  if (requestedProductId && requestedProductId !== 'auto') {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(requestedProductId)) {
      throw new Error(`Invalid release product id: ${requestedProductId}`);
    }
    const product = catalog.products[requestedProductId];
    if (!product) {
      throw new Error(`Unknown release product: ${requestedProductId}`);
    }
    return {
      product,
      productId: requestedProductId,
      ...(await readProductVersion(requestedProductId, product)),
    };
  }

  if (!requestedTag) {
    const productId = assertNonEmptyString(
      catalog.defaultProductId,
      'Release product catalog defaultProductId',
      80
    );
    const product = catalog.products[productId];
    if (!product) {
      throw new Error(`Default release product is not defined: ${productId}`);
    }
    return {
      product,
      productId,
      ...(await readProductVersion(productId, product)),
    };
  }

  const candidates = [];
  for (const [productId, product] of Object.entries(catalog.products)) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(productId)) {
      throw new Error(`Invalid release product id in catalog: ${productId}`);
    }
    const versionState = await readProductVersion(productId, product);
    if (interpolate(product.tagTemplate, versionState.version) === requestedTag) {
      candidates.push({
        product,
        productId,
        ...versionState,
      });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? `No release product maps to tag ${requestedTag}`
        : `Release tag ${requestedTag} maps to multiple products; use unique tagTemplate values`
    );
  }
  return candidates[0];
}

async function resolveRelease(options) {
  const catalog = await readJson(PRODUCT_CATALOG_PATH);
  if (catalog.schemaVersion !== 1 || !catalog.products || typeof catalog.products !== 'object') {
    throw new Error('Release product catalog must use schemaVersion 1 and define products');
  }

  const resolvedProduct = await resolveProduct(catalog, options.productId, options.tag);
  const { product, productId, version } = resolvedProduct;
  const tag = options.tag ?? interpolate(product.tagTemplate, version);
  assertReleaseTag(tag);

  const expectedTag = interpolate(product.tagTemplate, version);
  if (expectedTag !== tag) {
    throw new Error(
      `${productId} package version (${version}) requires tag ${expectedTag}, received ${tag}`
    );
  }

  const releaseNotesPath = resolveRepositoryPath(
    interpolate(product.releaseNotesPattern, version),
    `${productId} releaseNotesPattern`
  );
  const releaseDocument = await readReleaseDocument(releaseNotesPath);
  const announcement = releaseDocument.metadata.announcement;
  if (!announcement || typeof announcement !== 'object' || Array.isArray(announcement)) {
    throw new Error(`${product.releaseNotesPattern} must define announcement metadata`);
  }
  if (announcement.productId !== productId) {
    throw new Error(
      `Announcement productId (${announcement.productId ?? 'missing'}) must equal ${productId}`
    );
  }

  const displayName = assertNonEmptyString(product.displayName, 'Product displayName', 80);
  const headline = assertNonEmptyString(announcement.headline, 'Announcement headline', 160);
  const summary = assertNonEmptyString(announcement.summary, 'Announcement summary', 500);
  if (!Array.isArray(announcement.highlights) || announcement.highlights.length < 2) {
    throw new Error('Announcement must define at least two highlights');
  }
  if (announcement.highlights.length > MAX_HIGHLIGHTS) {
    throw new Error(`Announcement must not define more than ${MAX_HIGHLIGHTS} highlights`);
  }

  const highlights = announcement.highlights.map((highlight, index) => {
    if (!highlight || typeof highlight !== 'object' || Array.isArray(highlight)) {
      throw new Error(`Announcement highlight ${index + 1} must be an object`);
    }
    return {
      icon: assertNonEmptyString(highlight.icon, `Highlight ${index + 1} icon`, 16),
      text: assertNonEmptyString(highlight.text, `Highlight ${index + 1} text`, 120),
    };
  });

  return {
    displayName,
    headline,
    highlights,
    productId,
    releaseNotesPath,
    releaseUrl: `https://github.com/${product.repository}/releases/tag/${encodeURIComponent(tag)}`,
    repository: product.repository,
    summary,
    tag,
    upgradeCommand: interpolate(product.upgradeCommand, version),
    version,
  };
}

export function buildDiscordAnnouncement(release) {
  const title = `🚀 ${release.displayName} v${release.version} is here`;
  const highlightLines = release.highlights
    .map((highlight) => `${highlight.icon} ${highlight.text}`)
    .join('\n');
  const markdown = [
    `# ${title}`,
    '',
    `**${release.headline}**`,
    '',
    release.summary,
    '',
    '## What changed',
    '',
    highlightLines,
    '',
    '## Upgrade',
    '',
    `\`${release.upgradeCommand}\``,
    '',
    `[Read the full release notes](${release.releaseUrl})`,
    '',
  ].join('\n');

  const payload = {
    allowed_mentions: {
      parse: [],
    },
    embeds: [
      {
        color: DISCORD_EMBED_COLOR,
        description: `**${release.headline}**\n\n${release.summary}`,
        fields: [
          {
            name: 'What changed',
            value: highlightLines,
          },
          {
            name: 'Upgrade',
            value: `\`${release.upgradeCommand}\``,
          },
        ],
        footer: {
          text: 'Workspai · Workspace Intelligence',
        },
        title,
        url: release.releaseUrl,
      },
    ],
    username: 'Workspai Releases',
  };

  const characterCount = JSON.stringify(payload.embeds).length;
  if (characterCount > 6000) {
    throw new Error(`Discord embed content exceeds its 6000-character limit (${characterCount})`);
  }

  return {
    markdown,
    payload,
    title,
  };
}

export function validateWebhookUrl(value) {
  const webhookUrl = new URL(value);
  const supportedHost =
    webhookUrl.hostname === 'discord.com' || webhookUrl.hostname === 'discordapp.com';
  if (!supportedHost || !/^\/api\/webhooks\/[^/]+\/[^/]+\/?$/u.test(webhookUrl.pathname)) {
    throw new Error('ANNOUNCEMENTS_WEBHOOK_URL is not a supported Discord webhook URL');
  }
  webhookUrl.search = '';
  webhookUrl.hash = '';
  return webhookUrl;
}

export function markerFor(release, messageId) {
  return `<!-- workspai-discord-announcement product=${release.productId} tag=${release.tag} message=${messageId} -->`;
}

export function findMessageId(releaseBody, release) {
  const product = release.productId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const tag = release.tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = releaseBody.match(
    new RegExp(
      `<!-- workspai-discord-announcement product=${product} tag=${tag} message=(\\d+) -->`,
      'u'
    )
  );
  return match?.[1];
}

async function requestJson(url, options, label) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned a non-JSON response`);
  }
}

async function publishAnnouncement(release, payload) {
  const webhookSecret = process.env.ANNOUNCEMENTS_WEBHOOK_URL;
  const githubToken = process.env.GITHUB_TOKEN;
  if (!webhookSecret) {
    throw new Error('ANNOUNCEMENTS_WEBHOOK_URL is required for --send');
  }
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required for --send');
  }
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== release.repository) {
    throw new Error(
      `Workflow repository (${process.env.GITHUB_REPOSITORY}) does not match ${release.repository}`
    );
  }

  const githubHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const releaseApiUrl = `https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`;
  const githubRelease = await requestJson(
    releaseApiUrl,
    { headers: githubHeaders },
    'GitHub release lookup'
  );
  const webhookUrl = validateWebhookUrl(webhookSecret);
  const existingMessageId = findMessageId(githubRelease.body ?? '', release);
  let discordMessage;
  let operation;

  if (existingMessageId) {
    const editUrl = new URL(
      `${webhookUrl.toString().replace(/\/$/u, '')}/messages/${existingMessageId}`
    );
    editUrl.searchParams.set('wait', 'true');
    discordMessage = await requestJson(
      editUrl,
      {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      },
      'Discord announcement update'
    );
    operation = 'updated';
  } else {
    webhookUrl.searchParams.set('wait', 'true');
    discordMessage = await requestJson(
      webhookUrl,
      {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
      'Discord announcement publish'
    );
    const messageId = assertNonEmptyString(discordMessage.id, 'Discord message id', 32);
    const marker = markerFor(release, messageId);
    const releaseBody = `${(githubRelease.body ?? '').trimEnd()}\n\n${marker}\n`;
    await requestJson(
      `https://api.github.com/repos/${release.repository}/releases/${githubRelease.id}`,
      {
        body: JSON.stringify({ body: releaseBody }),
        headers: githubHeaders,
        method: 'PATCH',
      },
      'GitHub release announcement marker update'
    );
    operation = 'published';
  }

  return {
    messageId: discordMessage.id,
    operation,
  };
}

async function writeOutput(filePath, contents) {
  const outputPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, contents, 'utf8');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const release = await resolveRelease(options);
  const announcement = buildDiscordAnnouncement(release);

  if (options.output) {
    await writeOutput(options.output, `${JSON.stringify(announcement.payload, null, 2)}\n`);
  }
  if (options.markdownOutput) {
    await writeOutput(options.markdownOutput, announcement.markdown);
  }
  if (options.send) {
    const result = await publishAnnouncement(release, announcement.payload);
    console.log(
      `✅ Discord announcement ${result.operation}: ${announcement.title} (${result.messageId})`
    );
    return;
  }

  if (options.check || (!options.output && !options.markdownOutput)) {
    console.log(`✅ Discord announcement contract passed for ${release.tag}`);
    console.log(`   Product: ${release.displayName} (${release.productId})`);
    console.log(`   Source: ${path.relative(REPOSITORY_ROOT, release.releaseNotesPath)}`);
    console.log(`   Title: ${announcement.title}`);
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
