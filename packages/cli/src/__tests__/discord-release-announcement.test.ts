import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findMessageId,
  markerFor,
  validateWebhookUrl,
} from '../../scripts/discord-release-announcement.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const SCRIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'cli',
  'scripts',
  'discord-release-announcement.mjs'
);
const CLI_PACKAGE_PATH = path.join(REPOSITORY_ROOT, 'packages', 'cli', 'package.json');
const CLI_VERSION = JSON.parse(await fs.readFile(CLI_PACKAGE_PATH, 'utf8')).version as string;
const CLI_TAG = `v${CLI_VERSION}`;
const GITHUB_RELEASE_SCRIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'cli',
  'scripts',
  'github-release-notes.mjs'
);
const WORKFLOW_PATH = path.join(
  REPOSITORY_ROOT,
  '.github',
  'workflows',
  'discord-release-announcement.yml'
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('Discord release announcement contract', () => {
  it('renders the Workspai CLI product title and bounded public payload', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-discord-release-'));
    temporaryDirectories.push(directory);
    const jsonPath = path.join(directory, 'announcement.json');
    const markdownPath = path.join(directory, 'announcement.md');

    await execa(process.execPath, [
      SCRIPT_PATH,
      '--product',
      'workspai-cli',
      '--tag',
      CLI_TAG,
      '--check',
      '--output',
      jsonPath,
      '--markdown-output',
      markdownPath,
    ]);

    const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    const markdown = await fs.readFile(markdownPath, 'utf8');
    const embed = payload.embeds[0];

    expect(embed.title).toBe(`🚀 Workspai CLI v${CLI_VERSION} is here`);
    expect(embed.url).toBe(`https://github.com/chistiq/workspai/releases/tag/${CLI_TAG}`);
    expect(embed.fields[0].value).toContain('🎯 Durable release');
    expect(embed.fields[1].value).toBe(`\`npm install -g workspai@${CLI_VERSION}\``);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(markdown).toContain(`# 🚀 Workspai CLI v${CLI_VERSION} is here`);
    expect(markdown).toContain('[Read the full release notes]');
  });

  it('keeps announcement metadata out of the public GitHub release body', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-github-release-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'release.md');

    await execa(process.execPath, [
      GITHUB_RELEASE_SCRIPT_PATH,
      '--tag',
      CLI_TAG,
      '--output',
      outputPath,
    ]);

    const releaseBody = await fs.readFile(outputPath, 'utf8');
    expect(releaseBody).toContain(`# Workspai CLI v${CLI_VERSION}`);
    expect(releaseBody).not.toContain('workspai-release-announcement');
    expect(releaseBody).not.toContain('"productId": "workspai-cli"');
  });

  it('publishes automatically only for a published release and supports safe manual preview', async () => {
    const workflow = await fs.readFile(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('types: [published]');
    expect(workflow).toMatch(/default: ['"]auto['"]/);
    expect(workflow).toContain('ANNOUNCEMENTS_WEBHOOK_URL');
    expect(workflow).toContain("github.event_name == 'release' || inputs.send == true");
    expect(workflow).toContain('--markdown-output "$RUNNER_TEMP/discord-announcement.md"');
  });

  it('fails closed for unknown products and tag/package version drift', async () => {
    await expect(
      execa(process.execPath, [SCRIPT_PATH, '--product', 'unknown', '--tag', CLI_TAG, '--check'])
    ).rejects.toMatchObject({ exitCode: 1 });

    await expect(
      execa(process.execPath, [
        SCRIPT_PATH,
        '--product',
        'workspai-cli',
        '--tag',
        'v0.0.0',
        '--check',
      ])
    ).rejects.toMatchObject({ exitCode: 1 });
  });

  it('resolves the release product from its product-specific tag', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-release-product-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'announcement.json');

    await execa(process.execPath, [
      SCRIPT_PATH,
      '--product',
      'auto',
      '--tag',
      CLI_TAG,
      '--output',
      outputPath,
    ]);
    const payload = JSON.parse(await fs.readFile(outputPath, 'utf8'));

    expect(payload.embeds[0].title).toBe(`🚀 Workspai CLI v${CLI_VERSION} is here`);
  });

  it('round-trips the hidden idempotency marker and rejects non-Discord webhook hosts', () => {
    const release = {
      productId: 'workspai-cli',
      tag: 'v0.51.0',
    };
    const marker = markerFor(release, '123456789012345678');

    expect(findMessageId(`Release body\n\n${marker}\n`, release)).toBe('123456789012345678');
    expect(validateWebhookUrl('https://discord.com/api/webhooks/123/token').toString()).toContain(
      'discord.com/api/webhooks/123/token'
    );
    expect(() => validateWebhookUrl('https://example.com/api/webhooks/123/token')).toThrow(
      /not a supported Discord webhook URL/u
    );
  });
});
