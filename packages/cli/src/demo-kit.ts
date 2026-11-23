import { promises as fs } from 'fs';
import path from 'path';
import nunjucks from 'nunjucks';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { getVersion } from './update-checker.js';
import { buildCleanGitEnv, isInsideExistingGitWorktree } from './utils/git-worktree.js';
import crypto from 'crypto';
import { RAPIDKIT_CORE_MINIMUM_PYTHON } from './core-bridge/core-runtime-compatibility.js';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface KitVariables {
  project_name: string;
  author?: string;
  description?: string;
  app_version?: string;
  license?: string;
  template?: string;
  kit_name?: string; // Full kit name (e.g., 'fastapi.standard', 'fastapi.ddd', 'nestjs.standard')
  package_manager?: string;
  skipGit?: boolean;
  skipInstall?: boolean;
  engine?: 'poetry' | 'venv' | 'pipx' | 'pip';
  node_version?: string;
  database_type?: string;
  include_caching?: boolean;
}

/**
 * Generate a cryptographically secure random secret
 */
function generateSecret(length: number = 32): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

export async function generateDemoKit(projectPath: string, variables: KitVariables): Promise<void> {
  const template = variables.template || 'fastapi';
  const isFastAPI = template === 'fastapi';
  const templateName = isFastAPI ? 'FastAPI' : 'NestJS';
  const kitName = variables.kit_name || (isFastAPI ? 'fastapi.standard' : 'nestjs.standard');
  const kitProfile = kitName.replace('.', '/');

  const spinner = ora(`Generating ${templateName} project...`).start();

  try {
    // When running from dist/demo-kit.js, we need to go up to package root
    const packageRoot = path.resolve(__dirname, '..');

    // Map kit_name to template directory
    let templateDir: string;

    if (kitName === 'fastapi.ddd') {
      templateDir = 'fastapi-ddd';
    } else if (kitName.startsWith('fastapi')) {
      templateDir = 'fastapi-standard';
    } else {
      templateDir = 'nestjs-standard';
    }

    const templatesPath = path.join(packageRoot, 'templates', 'kits', templateDir);

    const env = nunjucks.configure(templatesPath, {
      autoescape: false,
      trimBlocks: true,
      lstripBlocks: true,
    });

    // Add custom filter for generating secrets
    env.addFilter('generate_secret', function (_value: unknown, length: number = 32) {
      return generateSecret(length);
    });

    // Default variables
    const context = {
      project_name: variables.project_name,
      author: variables.author || 'Workspai User',
      description:
        variables.description ||
        (isFastAPI
          ? 'FastAPI service generated with Workspai'
          : 'NestJS application generated with Workspai'),
      app_version: variables.app_version || '0.1.0',
      license: variables.license || 'MIT',
      python_version: RAPIDKIT_CORE_MINIMUM_PYTHON,
      package_manager: variables.package_manager || 'npm',
      node_version: variables.node_version || '20.0.0',
      database_type: variables.database_type || 'postgresql',
      include_caching: variables.include_caching || false,
      created_at: new Date().toISOString(),
      workspai_version: getVersion(),
      rapidkit_version: getVersion(),
    };

    // File structure based on template
    let files: string[];

    if (isFastAPI) {
      files = [
        'src/main.py.j2',
        'src/__init__.py.j2',
        'src/cli.py.j2',
        'src/routing/__init__.py.j2',
        'src/routing/health.py.j2',
        'src/routing/examples.py.j2',
        'src/modules/__init__.py.j2',
        'tests/__init__.py.j2',
        'tests/test_health.py.j2',
        'tests/test_examples.py.j2',
        'README.md.j2',
        'pyproject.toml.j2',
        'Makefile.j2',
        'env.example.j2',
        'rapidkit.j2',
        'rapidkit.cmd.j2',
      ];
    } else {
      // NestJS files
      files = [
        'src/main.ts.j2',
        'src/app.module.ts.j2',
        'src/app.controller.ts.j2',
        'src/app.service.ts.j2',
        'src/config/configuration.ts.j2',
        'src/config/validation.ts.j2',
        'src/config/index.ts.j2',
        'src/modules/index.ts.j2',
        'src/examples/examples.module.ts.j2',
        'src/examples/examples.controller.ts.j2',
        'src/examples/examples.service.ts.j2',
        'src/examples/dto/create-note.dto.ts.j2',
        'test/app.controller.spec.ts.j2',
        'test/examples.controller.spec.ts.j2',
        'test/app.e2e-spec.ts.j2',
        'test/jest-e2e.json.j2',
        'package.json.j2',
        'tsconfig.json.j2',
        'tsconfig.build.json.j2',
        'nest-cli.json.j2',
        'jest.config.ts.j2',
        'eslint.config.cjs.j2',
        'env.example.j2',
        'docker-compose.yml.j2',
        'Dockerfile.j2',
        'README.md.j2',
        'rapidkit.j2',
        'rapidkit.cmd.j2',
      ];
    }

    // Generate files
    for (const templateFile of files) {
      const templatePath = path.join(templatesPath, templateFile);

      // Check if template file exists
      try {
        await fs.access(templatePath);
      } catch {
        // Template file doesn't exist, skip it
        continue;
      }

      const templateContent = await fs.readFile(templatePath, 'utf-8');
      let rendered: string;
      try {
        rendered = env.renderString(templateContent, context);
      } catch (e) {
        console.error(`Failed to render template: ${templateFile}`);
        throw e;
      }

      // Output path is the same but without .j2
      const outputFile =
        templateFile === 'env.example.j2' ? '.env.example' : templateFile.replace(/\.j2$/, '');
      const outputPath = path.join(projectPath, outputFile);

      // Create directory if needed
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Write file
      await fs.writeFile(outputPath, rendered);

      // Make executable files executable
      if (
        outputFile.endsWith('.workspai/rapidkit') ||
        outputFile.endsWith('.workspai/cli.py') ||
        outputFile.endsWith('.workspai/activate') ||
        outputFile.endsWith('.rapidkit/rapidkit') ||
        outputFile.endsWith('.rapidkit/cli.py') ||
        outputFile.endsWith('.rapidkit/activate') ||
        outputFile === 'rapidkit'
      ) {
        await fs.chmod(outputPath, 0o755);
      }
    }

    // Copy static context.json file (not a template)
    if (isFastAPI) {
      const contextJsonSource = path.join(templatesPath, '.rapidkit', 'context.json');
      const contextJsonDest = path.join(projectPath, '.workspai', 'context.json');
      try {
        await fs.mkdir(path.join(projectPath, '.workspai'), { recursive: true });
        await fs.copyFile(contextJsonSource, contextJsonDest);
      } catch (_err) {
        // If context.json doesn't exist in templates, create a minimal one
        await fs.mkdir(path.join(projectPath, '.workspai'), { recursive: true });
        const engine = variables.engine || 'pip'; // Default to pip if not specified
        await fs.writeFile(
          contextJsonDest,
          JSON.stringify(
            {
              engine,
              created_by: 'workspai-cli-fallback',
              legacyCreatedBy: 'rapidkit-npm-fallback',
            },
            null,
            2
          )
        );
      }
    }

    // Keep fallback output discoverable through canonical Workspai metadata.
    const workspaiDir = path.join(projectPath, '.workspai');
    await fs.mkdir(workspaiDir, { recursive: true });
    const canonicalProjectJsonPath = path.join(workspaiDir, 'project.json');

    // Always write marker (overwrite if templates rendered one, or create if missing).
    const projectMarker = {
      kit_name: kitName,
      profile: kitProfile,
      created_at: new Date().toISOString(),
      created_by: 'workspai-cli-fallback',
      workspai_version: getVersion(),
      rapidkit_version: getVersion(),
      runtime: isFastAPI ? 'python' : 'node',
    };
    const projectMarkerJson = JSON.stringify(projectMarker, null, 2);
    await fs.writeFile(canonicalProjectJsonPath, projectMarkerJson, 'utf-8');

    const launcherPath = path.join(projectPath, 'rapidkit');
    const launcherExists = await fs
      .access(launcherPath)
      .then(() => true)
      .catch(() => false);
    if (!launcherExists) {
      await fs.writeFile(
        launcherPath,
        `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
RAPIDKIT_LOCAL_LAUNCHER_BYPASS=1 npx workspai "$@"
`
      );
      await fs.chmod(launcherPath, 0o755);
    }

    const windowsLauncherPath = path.join(projectPath, 'rapidkit.cmd');
    const windowsLauncherExists = await fs
      .access(windowsLauncherPath)
      .then(() => true)
      .catch(() => false);
    if (!windowsLauncherExists) {
      await fs.writeFile(
        windowsLauncherPath,
        `@echo off
set RAPIDKIT_LOCAL_LAUNCHER_BYPASS=1
npx workspai %*
`
      );
    }

    // Create .gitignore separately with proper content
    const gitignoreContent = isFastAPI
      ? `# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtual environments
.venv/
venv/
ENV/
env/

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Project specific
.env
.env.local
`
      : `# Node artifacts
node_modules/
dist/
.tmp/
.env
.env.*
!.env.example

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDEs
.idea/
.vscode/

# Coverage
coverage/
`;

    await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreContent);

    spinner.succeed(`${templateName} project generated!`);

    // Git initialization
    if (!variables.skipGit) {
      const gitSpinner = ora('Initializing git repository...').start();
      try {
        if (await isInsideExistingGitWorktree(projectPath)) {
          gitSpinner.warn(
            'Git initialization skipped because target is already inside a git worktree'
          );
        } else {
          await execa('git', ['init'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa('git', ['add', '.'], { cwd: projectPath, env: buildCleanGitEnv() });
          await execa(
            'git',
            ['commit', '-m', `Initial commit: ${templateName} project via Workspai`],
            {
              cwd: projectPath,
              env: buildCleanGitEnv(),
            }
          );
          gitSpinner.succeed('Git repository initialized');
        }
      } catch {
        gitSpinner.warn('Could not initialize git repository');
      }
    }

    // Install dependencies (for NestJS)
    if (!isFastAPI && !variables.skipInstall) {
      const pm = variables.package_manager || 'npm';
      const installSpinner = ora(`Installing dependencies with ${pm}...`).start();
      try {
        const installCmd = pm === 'yarn' ? ['install'] : pm === 'pnpm' ? ['install'] : ['install'];
        await execa(pm, installCmd, { cwd: projectPath });
        installSpinner.succeed('Dependencies installed');
      } catch {
        installSpinner.warn(`Could not install dependencies. Run '${pm} install' manually.`);
      }
    }

    // Success message
    const projectName = path.basename(projectPath);

    // Fallback mode warning
    console.log(`
${chalk.yellow('⚠️  Limited offline mode:')} This project was created using basic templates.
${chalk.gray(`For full kit features, install Python ${RAPIDKIT_CORE_MINIMUM_PYTHON}+ and rapidkit-core:`)}
${chalk.cyan('  sudo apt install python3 python3-pip python3-venv')}
${chalk.cyan('  pip install rapidkit-core')}
`);

    if (isFastAPI) {
      console.log(`
${chalk.green('✨ FastAPI project created successfully!')}

${chalk.bold('📂 Project structure:')}
${projectPath}/
  ├── .workspai/           # Workspai metadata
  ├── src/
  │   ├── main.py          # FastAPI application
  │   ├── cli.py           # CLI commands
  │   ├── routing/         # API routes
  │   └── modules/         # Module system
  ├── tests/               # Test suite
  ├── pyproject.toml       # Poetry configuration
  └── README.md

${chalk.bold('🚀 Get started:')}
  ${chalk.cyan(`cd ${projectName}`)}
  ${chalk.cyan('npx workspai init')}          ${chalk.gray('# Install dependencies')}
  ${chalk.cyan('npx workspai dev')}           ${chalk.gray('# Start dev server')}

${chalk.bold('📚 Available commands:')}
  npx workspai init    # Install dependencies (poetry install)
  npx workspai dev     # Start dev server with hot reload
  npx workspai start   # Start production server
  npx workspai test    # Run tests
  npx workspai lint    # Lint code
  npx workspai format  # Format code

${chalk.gray('Alternative: make dev, npx workspai dev, poetry run dev')}
${chalk.gray('💡 Tip: Install globally (npm i -g workspai) to use without npx')}
`);
    } else {
      console.log(`
${chalk.green('✨ NestJS project created successfully!')}

${chalk.bold('📂 Project structure:')}
${projectPath}/
  ├── .workspai/           # Workspai metadata
  ├── src/
  │   ├── main.ts              # Application entry point
  │   ├── app.module.ts        # Root module
  │   ├── config/              # Configuration
  │   └── examples/            # Example module
  ├── test/                    # Test files
  ├── package.json             # Dependencies
  └── README.md

${chalk.bold('🚀 Get started:')}
  ${chalk.cyan(`cd ${projectName}`)}
  ${chalk.cyan('npx workspai init')}          ${chalk.gray('# Install dependencies')}
  ${chalk.cyan('cp .env.example .env')}
  ${chalk.cyan('npx workspai dev')}           ${chalk.gray('# Start dev server')}

${chalk.bold('📚 Available commands:')}
  npx workspai init    # Install dependencies
  npx workspai dev     # Start dev server with hot reload
  npx workspai start   # Start production server
  npx workspai build   # Build for production
  npx workspai test    # Run tests
  npx workspai lint    # Lint code
  npx workspai format  # Format code

${chalk.bold('🌐 API endpoints:')}
  http://localhost:8000/health          # Health check
  http://localhost:8000/docs            # Swagger docs
  http://localhost:8000/examples/notes  # Example API

${chalk.gray('Alternative: npm run start:dev, npx workspai dev')}
${chalk.gray('💡 Tip: Install globally (npm i -g workspai) to use without npx')}
`);
    }
  } catch (error) {
    spinner.fail(`Failed to generate ${templateName} project`);
    throw error;
  }
}
