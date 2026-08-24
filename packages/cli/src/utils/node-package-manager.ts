import fs from 'fs';
import path from 'path';

export type NodePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

function declaredNodePackageManager(projectPath: string): NodePackageManager | null {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    ) as { packageManager?: unknown };
    if (typeof packageJson.packageManager !== 'string') return null;
    const match = packageJson.packageManager.trim().match(/^(npm|pnpm|yarn|bun)(?:@|$)/);
    return (match?.[1] as NodePackageManager | undefined) ?? null;
  } catch {
    return null;
  }
}

export function detectNodePackageManager(projectPath: string): NodePackageManager {
  const declared = declaredNodePackageManager(projectPath);
  if (declared) return declared;
  if (
    fs.existsSync(path.join(projectPath, 'bun.lock')) ||
    fs.existsSync(path.join(projectPath, 'bunfig.toml'))
  ) {
    return 'bun';
  }
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
    return 'yarn';
  }
  if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) {
    return 'npm';
  }
  if (fs.existsSync(path.join(projectPath, 'pnpm-workspace.yaml'))) {
    return 'pnpm';
  }

  return 'npm';
}

export function formatNodeScriptCommand(
  projectPath: string,
  scriptName: string,
  packageManager: NodePackageManager = detectNodePackageManager(projectPath)
): string {
  if (packageManager === 'npm') {
    return `npm run ${scriptName}`;
  }
  return `${packageManager} run ${scriptName}`;
}

export function formatNodeInstallCommand(
  projectPath: string,
  packageManager: NodePackageManager = detectNodePackageManager(projectPath)
): string {
  return `${packageManager} install`;
}
