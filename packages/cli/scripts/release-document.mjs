import fs from 'node:fs/promises';

const ANNOUNCEMENT_METADATA_PATTERN =
  /^<!-- workspai-release-announcement\r?\n([\s\S]*?)\r?\n-->(?:\r?\n|$)/u;

export function parseReleaseDocument(markdown, sourceLabel = 'release notes') {
  const match = markdown.match(ANNOUNCEMENT_METADATA_PATTERN);
  if (!match) {
    return {
      body: markdown,
      metadata: {},
    };
  }

  let announcement;
  try {
    announcement = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(
      `${sourceLabel} contains invalid announcement metadata JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!announcement || typeof announcement !== 'object' || Array.isArray(announcement)) {
    throw new Error(`${sourceLabel} announcement metadata must be a JSON object`);
  }

  return {
    body: markdown.slice(match[0].length),
    metadata: {
      announcement,
    },
  };
}

export async function readReleaseDocument(filePath) {
  const markdown = await fs.readFile(filePath, 'utf8');
  return parseReleaseDocument(markdown, filePath);
}
