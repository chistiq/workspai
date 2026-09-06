import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentFrameworkAdapterManifest,
  AgentFrameworkDependencyEcosystem,
  AgentFrameworkDetectionMarker,
} from '../contracts/agent-framework-contract.js';

const MAX_DEPENDENCY_MANIFEST_BYTES = 1024 * 1024;
const MAX_DISCOVERY_ENTRIES = 5000;
const IGNORED_DISCOVERY_DIRECTORIES = new Set([
  '.git',
  '.workspai',
  'node_modules',
  'dist',
  'build',
  'vendor',
]);

export type AgentFrameworkMarkerEvidence = {
  id: string;
  kind: AgentFrameworkDetectionMarker['kind'];
  authored: boolean;
  matched: boolean;
  path?: string;
  summary: string;
  weight: number;
};

export type AgentFrameworkDetectionResult = {
  adapterId: string;
  frameworkId: string;
  detected: boolean;
  confidence: number;
  matchedAuthoredMarkers: number;
  requiredAuthoredMarkers: number;
  evidence: AgentFrameworkMarkerEvidence[];
};

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function resolveContainedExistingPath(
  projectRoot: string,
  relativePath: string
): Promise<string | null> {
  const lexicalPath = path.resolve(projectRoot, relativePath);
  if (!isContained(projectRoot, lexicalPath)) return null;
  try {
    const realPath = await fs.realpath(lexicalPath);
    return isContained(projectRoot, realPath) ? realPath : null;
  } catch {
    return null;
  }
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizedDependencyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_.-]+/g, '-');
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dependencyNameMatches(
  candidate: string,
  dependencyName: string,
  match: 'exact' | 'prefix'
): boolean {
  const normalizedCandidate = normalizedDependencyName(candidate);
  const normalizedExpected = normalizedDependencyName(dependencyName);
  return (
    normalizedCandidate === normalizedExpected ||
    (match === 'prefix' && normalizedCandidate.startsWith(`${normalizedExpected}-`))
  );
}

function npmManifestDeclaresDependency(
  content: string,
  dependencyName: string,
  match: 'exact' | 'prefix'
): boolean {
  try {
    const manifest = JSON.parse(content) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
      (field) => {
        const dependencies = manifest[field];
        return (
          dependencies !== null &&
          typeof dependencies === 'object' &&
          Object.keys(dependencies as Record<string, unknown>).some((name) =>
            dependencyNameMatches(name, dependencyName, match)
          )
        );
      }
    );
  } catch {
    return false;
  }
}

function textManifestDeclaresDependency(
  ecosystem: Exclude<AgentFrameworkDependencyEcosystem, 'npm'>,
  content: string,
  dependencyName: string,
  match: 'exact' | 'prefix'
): boolean {
  const escaped = escapedRegExp(dependencyName);
  const familySuffix = match === 'prefix' ? '(?:[-_.][A-Za-z0-9][A-Za-z0-9_.-]*)?' : '';
  const expression =
    ecosystem === 'nuget'
      ? new RegExp(
          `<PackageReference\\s+[^>]*(?:Include|Update)=["']${escaped}${familySuffix}["']`,
          'i'
        )
      : new RegExp(
          `(?:^|["'\\s])${escaped}${familySuffix}(?:\\[[^\\]]+\\])?(?=[<>=~!;,@\\s"']|$)`,
          'im'
        );
  return expression.test(content);
}

async function dependencyMarkerMatches(
  projectRoot: string,
  marker: Extract<AgentFrameworkDetectionMarker, { kind: 'dependency' }>
): Promise<{ matched: boolean; path?: string }> {
  const manifestPaths = new Set(marker.manifestPaths);
  if (marker.manifestSuffixes.length > 0) {
    const queue: Array<{ relativeDirectory: string; depth: number }> = [
      { relativeDirectory: '.', depth: 0 },
    ];
    let visitedEntries = 0;
    while (queue.length > 0 && visitedEntries < MAX_DISCOVERY_ENTRIES) {
      const current = queue.shift();
      if (!current) break;
      const directory = await resolveContainedExistingPath(projectRoot, current.relativeDirectory);
      if (!directory) continue;
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visitedEntries += 1;
        if (visitedEntries > MAX_DISCOVERY_ENTRIES) break;
        const relativeEntry = path.join(current.relativeDirectory, entry.name);
        if (
          entry.isFile() &&
          marker.manifestSuffixes.some((suffix) =>
            entry.name.toLowerCase().endsWith(suffix.toLowerCase())
          )
        ) {
          manifestPaths.add(relativeEntry);
        } else if (
          entry.isDirectory() &&
          current.depth < marker.searchDepth &&
          !IGNORED_DISCOVERY_DIRECTORIES.has(entry.name)
        ) {
          queue.push({ relativeDirectory: relativeEntry, depth: current.depth + 1 });
        }
      }
    }
  }
  for (const manifestPath of [...manifestPaths].sort()) {
    const resolved = await resolveContainedExistingPath(projectRoot, manifestPath);
    if (!resolved) continue;
    const content = await readBoundedFile(resolved, MAX_DEPENDENCY_MANIFEST_BYTES);
    if (content === null) continue;
    const matched =
      marker.ecosystem === 'npm'
        ? npmManifestDeclaresDependency(content, marker.name, marker.match)
        : textManifestDeclaresDependency(marker.ecosystem, content, marker.name, marker.match);
    if (matched) return { matched: true, path: manifestPath };
  }
  return { matched: false };
}

async function inspectMarker(
  projectRoot: string,
  marker: AgentFrameworkDetectionMarker,
  authored: boolean
): Promise<AgentFrameworkMarkerEvidence> {
  if (marker.kind === 'dependency') {
    const result = await dependencyMarkerMatches(projectRoot, marker);
    return {
      id: marker.id,
      kind: marker.kind,
      authored,
      matched: result.matched,
      ...(result.path ? { path: result.path } : {}),
      summary: result.matched
        ? `${marker.ecosystem} dependency ${marker.name} is declared`
        : `${marker.ecosystem} dependency ${marker.name} was not found`,
      weight: marker.weight,
    };
  }

  const resolved = await resolveContainedExistingPath(projectRoot, marker.path);
  if (!resolved) {
    return {
      id: marker.id,
      kind: marker.kind,
      authored,
      matched: false,
      path: marker.path,
      summary: `${marker.path} is absent or outside the project boundary`,
      weight: marker.weight,
    };
  }
  if (marker.kind === 'path') {
    return {
      id: marker.id,
      kind: marker.kind,
      authored,
      matched: true,
      path: marker.path,
      summary: `${marker.path} exists inside the project boundary`,
      weight: marker.weight,
    };
  }
  const content = await readBoundedFile(resolved, marker.maxBytes);
  const matched = content?.includes(marker.needle) === true;
  return {
    id: marker.id,
    kind: marker.kind,
    authored,
    matched,
    path: marker.path,
    summary: matched
      ? `${marker.path} contains the declared literal marker`
      : `${marker.path} did not contain the declared literal marker within ${marker.maxBytes} bytes`,
    weight: marker.weight,
  };
}

export async function detectAgentFramework(
  projectRootInput: string,
  manifest: AgentFrameworkAdapterManifest
): Promise<AgentFrameworkDetectionResult> {
  const projectRoot = await fs.realpath(path.resolve(projectRootInput));
  const authoredEvidence = await Promise.all(
    manifest.detection.authoredMarkers.map((marker) => inspectMarker(projectRoot, marker, true))
  );
  const generatedEvidence = await Promise.all(
    manifest.detection.generatedMarkers.map((marker) => inspectMarker(projectRoot, marker, false))
  );
  const authoredWeight = authoredEvidence.reduce((sum, evidence) => sum + evidence.weight, 0);
  const matchedWeight = authoredEvidence
    .filter((evidence) => evidence.matched)
    .reduce((sum, evidence) => sum + evidence.weight, 0);
  const matchedAuthoredMarkers = authoredEvidence.filter((evidence) => evidence.matched).length;
  const confidence = authoredWeight > 0 ? matchedWeight / authoredWeight : 0;
  return {
    adapterId: manifest.adapter.id,
    frameworkId: manifest.framework.id,
    detected:
      matchedAuthoredMarkers >= manifest.detection.minimumAuthoredMarkers &&
      confidence >= manifest.detection.minimumConfidence,
    confidence,
    matchedAuthoredMarkers,
    requiredAuthoredMarkers: manifest.detection.minimumAuthoredMarkers,
    evidence: [...authoredEvidence, ...generatedEvidence],
  };
}
