import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'scripts',
  'github-release-notes.mjs'
);
const RELEASE_SCRIPT_PATH = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'release.sh');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('GitHub release notes contract', () => {
  it('renders a tag-bound canonical full-notes link', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-release-body-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'body.md');

    await execa(process.execPath, [SCRIPT_PATH, '--tag', 'v0.48.0', '--output', outputPath]);

    const body = await fs.readFile(outputPath, 'utf8');
    expect(body).toContain(
      '[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.48.0/packages/cli/releases/RELEASE_NOTES_v0.48.0.md)'
    );
    expect(body).not.toMatch(/\]\((?:\.\.?\/)/);
  });

  it('rewrites links relative to the versioned release-note file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-release-links-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'body.md');

    await execa(process.execPath, [SCRIPT_PATH, '--tag', 'v0.13.1', '--output', outputPath]);

    const body = await fs.readFile(outputPath, 'utf8');
    expect(body).toContain(
      'https://github.com/chistiq/workspai/blob/v0.13.1/packages/cli/releases/RELEASE_NOTES_v0.13.0.md'
    );
    expect(body).not.toMatch(/\]\((?:\.\.?\/)/);
  });

  it('fails closed when a versioned release-note file is missing', async () => {
    await expect(
      execa(process.execPath, [SCRIPT_PATH, '--tag', 'v999.0.0', '--check'])
    ).rejects.toMatchObject({
      exitCode: 1,
    });
  });

  it('fails closed when aggregate notes contain a relative release link', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-release-aggregate-'));
    temporaryDirectories.push(directory);
    const aggregatePath = path.join(directory, 'RELEASE_NOTES.md');
    await fs.writeFile(
      aggregatePath,
      '[Full Release Notes](./releases/RELEASE_NOTES_v0.48.0.md)\n',
      'utf8'
    );

    await expect(
      execa(process.execPath, [
        SCRIPT_PATH,
        '--tag',
        'v0.48.0',
        '--aggregate',
        aggregatePath,
        '--check',
      ])
    ).rejects.toMatchObject({
      exitCode: 1,
    });
  });

  it('fails closed when an aggregate link uses the wrong tag', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-release-tag-drift-'));
    temporaryDirectories.push(directory);
    const aggregatePath = path.join(directory, 'RELEASE_NOTES.md');
    await fs.writeFile(
      aggregatePath,
      '[Full Release Notes](https://github.com/chistiq/workspai/blob/v0.47.0/packages/cli/releases/RELEASE_NOTES_v0.48.0.md)\n',
      'utf8'
    );

    await expect(
      execa(process.execPath, [
        SCRIPT_PATH,
        '--tag',
        'v0.48.0',
        '--aggregate',
        aggregatePath,
        '--check',
      ])
    ).rejects.toMatchObject({
      exitCode: 1,
    });
  });

  it('publishes the rendered versioned body instead of generated notes', async () => {
    const releaseScript = await fs.readFile(RELEASE_SCRIPT_PATH, 'utf8');

    expect(releaseScript).toContain('--notes-file "$RELEASE_BODY_FILE"');
    expect(releaseScript).toContain('github-release-notes.mjs --tag "$TAG" --check');
    expect(releaseScript).not.toContain('--generate-notes');
  });

  it('does not expose machine-readable announcement metadata in the release body', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-release-metadata-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'body.md');

    await execa(process.execPath, [SCRIPT_PATH, '--tag', 'v0.51.0', '--output', outputPath]);

    const body = await fs.readFile(outputPath, 'utf8');
    expect(body).not.toContain('workspai-release-announcement');
    expect(body).not.toContain('"productId": "workspai-cli"');
  });
});
