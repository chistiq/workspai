import { WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS } from '../../../contracts/workspace-intelligence-runtime-registry.js';
import { PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH } from '../../../utils/workspace-paths.js';

export const WORKSPAI_CONTEXT_LIMIT_BYTES = 131_072;
export const WORKSPAI_CONTEXT_SCHEMA_VERSION =
  WORKSPACE_SUPPLEMENTAL_ARTIFACT_CONTRACTS.projectContextAgent.schemaVersion;

export function openaiAgentsTypeScriptContextSource(): string {
  return `// Generated and managed by Workspai. Do not place secrets in this file.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPAI_CONTEXT_LIMIT = 131_072;
export const WORKSPAI_CONTEXT_PATH = '${PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH}';
export const WORKSPAI_CONTEXT_SCHEMA_VERSION = '${WORKSPAI_CONTEXT_SCHEMA_VERSION}';
export const WORKSPAI_AGENT_LAYOUT_PARENT = 'agents';
export const WORKSPAI_GENERATED_NOTICE = 'Generated and managed by Workspai';

const CONTEXT_SEGMENTS = WORKSPAI_CONTEXT_PATH.split('/').filter(Boolean);
const MAX_PACKAGE_WALK = 5;
const MAX_MANIFEST_BYTES = 16_384;

function fail(message: string): never {
  throw new Error(message);
}

function missingContext(): never {
  fail('Run Workspai agent-sync first; missing ' + WORKSPAI_CONTEXT_PATH);
}

function unsafeContext(): never {
  fail('Workspai agent context path is not a contained regular file');
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function isReparseOrSymlink(st: Stats): boolean {
  return st.isSymbolicLink();
}

function isRegularFile(st: Stats): boolean {
  return (
    st.isFile() &&
    !st.isSymbolicLink() &&
    !st.isDirectory() &&
    !(typeof st.isFIFO === 'function' && st.isFIFO()) &&
    !(typeof st.isSocket === 'function' && st.isSocket()) &&
    !(typeof st.isBlockDevice === 'function' && st.isBlockDevice()) &&
    !(typeof st.isCharacterDevice === 'function' && st.isCharacterDevice())
  );
}

function realpathOrUnsafe(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    unsafeContext();
  }
}

function lstatOrUnsafe(target: string, missing?: () => never): Stats {
  try {
    return lstatSync(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && missing) missing();
    unsafeContext();
  }
}

function canonicalizeDirectory(target: string): string {
  const real = realpathOrUnsafe(target);
  const st = lstatOrUnsafe(real);
  if (isReparseOrSymlink(st) || !st.isDirectory()) unsafeContext();
  return real;
}

function isGeneratedAgentManifest(directory: string): boolean {
  const manifestPath = join(directory, 'package.json');
  let st;
  try {
    st = lstatSync(manifestPath);
  } catch {
    return false;
  }
  if (isReparseOrSymlink(st) || !isRegularFile(st) || st.size > MAX_MANIFEST_BYTES) return false;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { notice?: unknown };
    return parsed.notice === WORKSPAI_GENERATED_NOTICE;
  } catch {
    return false;
  }
}

export function resolveWorkspaiProjectRoot(moduleUrl = import.meta.url): string {
  let cursor = dirname(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < MAX_PACKAGE_WALK; depth += 1) {
    if (isGeneratedAgentManifest(cursor) && basename(dirname(cursor)) === WORKSPAI_AGENT_LAYOUT_PARENT) {
      const agentsDir = dirname(cursor);
      const projectRoot = dirname(agentsDir);
      const realProject = canonicalizeDirectory(projectRoot);
      const realAgent = canonicalizeDirectory(cursor);
      if (!isInside(realProject, realAgent)) unsafeContext();
      return realProject;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  fail('Unable to locate the Workspai agent package at <project>/agents/<instance>/');
}

function openContainedRegularFile(projectRoot: string): number {
  let current = projectRoot;
  for (let index = 0; index < CONTEXT_SEGMENTS.length; index += 1) {
    const segment = CONTEXT_SEGMENTS[index];
    if (!segment || segment === '.' || segment === '..' || segment.includes(sep)) unsafeContext();
    const next = join(current, segment);
    const last = index === CONTEXT_SEGMENTS.length - 1;
    const st = lstatOrUnsafe(next, last ? missingContext : undefined);
    if (isReparseOrSymlink(st)) {
      const target = realpathOrUnsafe(next);
      if (!isInside(projectRoot, target)) unsafeContext();
      const targetStat = lstatOrUnsafe(target);
      if (last) {
        if (!isRegularFile(targetStat)) unsafeContext();
        current = target;
        break;
      }
      if (!targetStat.isDirectory() || isReparseOrSymlink(targetStat)) unsafeContext();
      current = canonicalizeDirectory(target);
      continue;
    }
    if (last) {
      if (!isRegularFile(st)) unsafeContext();
      current = next;
      break;
    }
    if (!st.isDirectory()) unsafeContext();
    current = next;
  }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  try {
    return openSync(current, flags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') missingContext();
    unsafeContext();
  }
}

function decodeOrFail(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('Workspai agent context is not valid UTF-8');
  }
}

function parseObjectOrFail(decoded: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    fail('Workspai agent context is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('Workspai agent context is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function loadWorkspaiContext(): string {
  const projectRoot = resolveWorkspaiProjectRoot();
  const fd = openContainedRegularFile(projectRoot);
  try {
    const st = fstatSync(fd);
    if (!isRegularFile(st)) unsafeContext();
    if (st.size > WORKSPAI_CONTEXT_LIMIT) {
      fail('Workspai agent context exceeds the admitted 128 KiB boundary');
    }
    const buffer = Buffer.alloc(WORKSPAI_CONTEXT_LIMIT + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset > WORKSPAI_CONTEXT_LIMIT) {
      fail('Workspai agent context exceeds the admitted 128 KiB boundary');
    }
    const decoded = decodeOrFail(buffer.subarray(0, offset));
    const parsed = parseObjectOrFail(decoded);
    if (parsed.schemaVersion !== WORKSPAI_CONTEXT_SCHEMA_VERSION) {
      fail('Workspai agent context schemaVersion is not ' + WORKSPAI_CONTEXT_SCHEMA_VERSION);
    }
    return decoded;
  } finally {
    closeSync(fd);
  }
}
`;
}
