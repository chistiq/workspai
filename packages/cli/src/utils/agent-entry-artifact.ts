import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { resolveRepositoryLocalSymlinkFile } from './repository-local-symlink.js';

export type AgentEntryArtifact = {
  path: string;
  scope: 'managed-blocks' | 'file';
  sha256: string;
};

/** Bind owned instructions, without making unrelated authored text immutable. */
export async function readAgentEntryArtifact(
  projectPath: string,
  relativePath: string
): Promise<AgentEntryArtifact | null> {
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.split('/').some((part) => part === '..') ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath)
  )
    return null;
  const candidate = await resolveRepositoryLocalSymlinkFile(
    projectPath,
    path.join(projectPath, relativePath)
  );
  if (!candidate) return null;
  const text = await fsp.readFile(candidate, 'utf8').catch(() => null);
  if (text === null) return null;
  const blocks = text.match(
    /<!-- WORKSPAI:(PROJECT-GROUNDING|AGENT-ENTRY):START -->[\s\S]*?<!-- WORKSPAI:\1:END -->/gu
  );
  return {
    path: relativePath,
    scope: blocks ? 'managed-blocks' : 'file',
    sha256: createHash('sha256')
      .update(blocks ? blocks.join('\n') : text)
      .digest('hex'),
  };
}
