import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set([
  '.cs',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.ts',
  '.tsx',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.rapidkit',
  '.venv',
  '.workspai',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'htmlcov',
  'node_modules',
  'spec',
  'specs',
  'target',
  'test',
  'tests',
]);

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a source-backed HTTP health surface without executing repository code.
 * The scan is bounded and excludes tests/build output so a test-only reference
 * cannot prove that the production application exposes a health endpoint.
 */
export async function detectProjectHealthSurface(projectPath: string): Promise<boolean> {
  const directMarkers = [
    'health',
    'health.ts',
    'health.js',
    'health.py',
    'health.go',
    'health.kt',
    'health.rb',
    'health.php',
    'healthcheck',
    'health-check',
    'src/health',
    'src/healthcheck',
    'src/main/resources/application.yml',
    'src/main/resources/application.properties',
    'app/health.py',
    'routes/health.ts',
    'routes/health.js',
    'app/controllers/health_controller.rb',
    'app/controllers/health_check_controller.rb',
    'config/initializers/health_check.rb',
  ];
  for (const marker of directMarkers) {
    if (await pathExists(path.join(projectPath, marker))) return true;
  }

  const railsRoutes = await readText(path.join(projectPath, 'config', 'routes.rb'));
  if (/(?:health|readiness|liveness|readiness_check|health_check)/iu.test(railsRoutes)) return true;

  const queue: Array<{ directory: string; depth: number }> = [{ directory: projectPath, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 5_000) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > 5_000) break;
      if (entry.isDirectory()) {
        if (
          current.depth < 6 &&
          !entry.name.startsWith('.') &&
          !IGNORED_DIRECTORIES.has(entry.name)
        ) {
          queue.push({
            directory: path.join(current.directory, entry.name),
            depth: current.depth + 1,
          });
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        continue;
      if (/^(?:health|healthcheck|health-check|liveness|readiness)(?:\.|$)/iu.test(entry.name)) {
        return true;
      }
      const contents = await readText(path.join(current.directory, entry.name));
      if (
        /(?:\bhealth\b|MapHealthChecks|health_check|healthcheck|readiness|liveness)/iu.test(
          contents
        ) &&
        /(?:@Router|@(?:app|router)\.(?:get|post)|\.(?:GET|Get|route|MapGet|MapHealthChecks)\s*\()/u.test(
          contents
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
