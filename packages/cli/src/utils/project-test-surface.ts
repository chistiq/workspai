import path from 'path';

import fsExtra from 'fs-extra';

import type { BackendRuntimeFamily } from './backend-framework-contract.js';

export type ProjectTestSurface = {
  detected: boolean;
  runtimeFamilies: BackendRuntimeFamily[];
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.workspai',
  '.rapidkit',
  '.venv',
  'node_modules',
  'target',
  'dist',
  'build',
  'coverage',
  'vendor',
]);

const TEST_DIRECTORY_NAMES = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);

function runtimeFromTestFile(fileName: string): BackendRuntimeFamily | null {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.rs')) return 'rust';
  if (normalized.endsWith('.go')) return 'go';
  if (normalized.endsWith('.py')) return 'python';
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) return 'node';
  if (normalized.endsWith('.java')) return 'java';
  if (normalized.endsWith('.kt') || normalized.endsWith('.kts')) return 'kotlin';
  if (normalized.endsWith('.exs')) return 'elixir';
  if (normalized.endsWith('.php')) return 'php';
  if (normalized.endsWith('.rb')) return 'ruby';
  if (normalized.endsWith('.cs')) return 'dotnet';
  if (normalized.endsWith('.c')) return 'c';
  if (/\.(?:cc|cpp|cxx)$/.test(normalized)) return 'cpp';
  return null;
}

function isTestFile(fileName: string, insideTestDirectory: boolean): boolean {
  if (insideTestDirectory && runtimeFromTestFile(fileName)) return true;
  return /(?:^test[_-].+|[_-]test|\.test|\.spec|tests?)\.(?:rs|go|py|[cm]?[jt]sx?|java|kts?|exs|php|rb|cs|c|cc|cpp|cxx)$/i.test(
    fileName
  );
}

/** Bounded runtime-neutral test discovery shared by Analyze and Doctor. */
export async function detectProjectTestSurface(
  projectPath: string,
  options: { maxDepth?: number; maxEntries?: number } = {}
): Promise<ProjectTestSurface> {
  const maxDepth = options.maxDepth ?? 6;
  const maxEntries = options.maxEntries ?? 5_000;
  const runtimeFamilies = new Set<BackendRuntimeFamily>();
  let detected = false;
  let visitedEntries = 0;

  try {
    const packageJson = await fsExtra.readJson(path.join(projectPath, 'package.json'));
    const testScript = packageJson?.scripts?.test;
    if (typeof testScript === 'string' && testScript.trim()) {
      detected = true;
      runtimeFamilies.add('node');
    }
  } catch {
    // A package manifest is optional for runtime-neutral projects.
  }

  const queue: Array<{ dir: string; depth: number; insideTestDirectory: boolean }> = [
    { dir: projectPath, depth: 0, insideTestDirectory: false },
  ];
  while (queue.length > 0 && visitedEntries < maxEntries) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await fsExtra.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > maxEntries) break;
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        const insideTestDirectory =
          current.insideTestDirectory || TEST_DIRECTORY_NAMES.has(entry.name.toLowerCase());
        if (insideTestDirectory) detected = true;
        if (current.depth < maxDepth && !entry.name.startsWith('.')) {
          queue.push({ dir: fullPath, depth: current.depth + 1, insideTestDirectory });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (isTestFile(entry.name, current.insideTestDirectory)) {
        detected = true;
        const runtime = runtimeFromTestFile(entry.name);
        if (runtime) runtimeFamilies.add(runtime);
      }
      if (
        /^(?:pytest\.ini|tox\.ini|noxfile\.py|phpunit\.xml(?:\.dist)?|\.rspec)$/i.test(entry.name)
      ) {
        detected = true;
      }
      if (/^(?:vitest|jest|playwright|cypress)\.config\.[cm]?[jt]s$/i.test(entry.name)) {
        detected = true;
        runtimeFamilies.add('node');
      }
    }
  }
  return { detected, runtimeFamilies: [...runtimeFamilies].sort() };
}
