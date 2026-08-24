import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyEnvironmentCommandVariant,
  resolveWorkspaceStageCommand,
} from '../framework-registry';
import {
  findRapidkitProjectRoot,
  resolveProjectCommandCapabilities,
} from '../utils/project-command-capabilities';
import { isRuntimeLifecycleCommandAvailable } from '../utils/runtime-lifecycle-probes';
import { isWorkspaceStageSupported } from '../utils/workspace-stage-capabilities';

const tempDirs: string[] = [];

async function createProject(
  name: string,
  rapidkitFiles: Record<string, unknown>,
  files: Record<string, unknown> = {}
): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `rk-enterprise-${name}-`));
  tempDirs.push(projectRoot);
  await fs.ensureDir(path.join(projectRoot, '.rapidkit'));
  for (const [filename, content] of Object.entries(rapidkitFiles)) {
    await fs.writeJson(path.join(projectRoot, '.rapidkit', filename), content, { spaces: 2 });
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(projectRoot, relativePath);
    await fs.ensureDir(path.dirname(target));
    if (typeof content === 'string') {
      await fs.writeFile(target, content);
    } else {
      await fs.writeJson(target, content, { spaces: 2 });
    }
  }
  return projectRoot;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) await fs.remove(target);
  }
});

describe('enterprise lifecycle contract', () => {
  it('recognizes hidden Bun configuration as a supplemental lifecycle surface', async () => {
    const projectRoot = await createProject(
      'bun-runner',
      {
        'project.json': {
          runtime: 'node',
          framework: 'nextjs',
        },
      },
      {
        'package.json': {
          packageManager: 'pnpm@10.33.0',
          scripts: {
            build: 'next build',
            test: 'vitest run',
          },
        },
        '.bunfig.toml': '[install.lockfile]\nsave = false\n',
      }
    );

    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'bun', 'build')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'bun', 'test')).toBe(true);
  });

  it('does not remap resolved stage commands using stage override keys as environment aliases', () => {
    const resolved = applyEnvironmentCommandVariant(
      'npm run test:ci',
      {
        test: 'npm run test:ci',
        dev: 'npm run dev',
      },
      'dev'
    );

    expect(resolved).toBe('npm run test:ci');
  });

  it('applies dedicated environment command variants when provided', () => {
    const resolved = applyEnvironmentCommandVariant(
      'npm run start',
      {
        dev: 'npm run start:dev',
        prod: 'npm run start:prod',
        default: 'npm run start',
      },
      'prod'
    );

    expect(resolved).toBe('npm run start:prod');
  });

  it('detects context.json-only project roots for capabilities', async () => {
    const projectRoot = await createProject(
      'context-only',
      {
        'context.json': {
          runtime: 'node',
          framework: 'nextjs',
          engine: 'npm',
        },
      },
      {
        'package.json': {
          scripts: {
            dev: 'next dev',
            build: 'next build',
          },
        },
      }
    );

    expect(findRapidkitProjectRoot(projectRoot)).toBe(projectRoot);

    const capabilities = resolveProjectCommandCapabilities(projectRoot);
    expect(capabilities.projectRoot).toBe(projectRoot);
    expect(capabilities.supportedCommands).toEqual(
      expect.arrayContaining(['help', 'dev', 'build', 'init'])
    );
  });

  it('resolves node workspace stage commands from package scripts', async () => {
    const projectRoot = await createProject(
      'vite-stage',
      {
        'project.json': {
          runtime: 'node',
          framework: 'vite',
        },
      },
      {
        'package.json': {
          scripts: {
            dev: 'vite',
            preview: 'vite preview',
            build: 'vite build',
            test: 'vitest',
          },
        },
      }
    );

    expect(
      resolveWorkspaceStageCommand({
        projectPath: projectRoot,
        runtime: 'node',
        framework: 'vite',
        stage: 'start',
      })
    ).toBe('npm run preview');
  });

  it('reports go lint as unsupported without lint tooling manifests', async () => {
    const projectRoot = await createProject(
      'go-no-lint',
      {
        'project.json': {
          runtime: 'go',
          framework: 'gofiber',
          module_support: false,
        },
      },
      {
        'go.mod': 'module example.com/app\n\ngo 1.22\n',
      }
    );

    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'go', 'test', 'gofiber')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'go', 'lint', 'gofiber')).toBe(false);

    const capabilities = resolveProjectCommandCapabilities(projectRoot);
    expect(capabilities.supportedCommands).toContain('test');
    expect(capabilities.unsupportedCommands).toContain('lint');
  });

  it('reads multiline Makefile targets and rejects ambiguous Go command roots', async () => {
    const projectRoot = await createProject(
      'go-command-fleet',
      {
        'project.json': {
          runtime: 'go',
          framework: 'go',
          module_support: false,
        },
      },
      {
        'go.mod': 'module example.com/fleet\n\ngo 1.24\n',
        Makefile: '.PHONY: verify\nverify:\n\t@true\n\n.PHONY: lint\nlint:\n\t@true\n',
        'cmd/api/main.go': 'package main\nfunc main() {}\n',
        'cmd/controller/main.go': 'package main\nfunc main() {}\n',
      }
    );

    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'go', 'lint', 'go')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'go', 'format', 'go')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'go', 'dev', 'go')).toBe(false);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'go', 'start', 'go')).toBe(false);
  });

  it('does not advertise cargo run for a virtual Rust workspace without a runnable target', async () => {
    const projectRoot = await createProject(
      'rust-virtual-workspace',
      {
        'project.json': {
          runtime: 'rust',
          framework: 'rust',
          module_support: false,
        },
      },
      {
        'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = ["crates/core"]\n',
        'crates/core/Cargo.toml': '[package]\nname = "core"\nversion = "0.1.0"\n',
        'crates/core/src/lib.rs': 'pub fn ready() -> bool { true }\n',
      }
    );

    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'rust', 'init')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'rust', 'build')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'rust', 'test')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'rust', 'dev')).toBe(false);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'rust', 'start')).toBe(false);

    const capabilities = resolveProjectCommandCapabilities(projectRoot);
    expect(capabilities.commandMap.build.status).toBe('supported');
    expect(capabilities.commandMap.test.status).toBe('supported');
    expect(capabilities.commandMap.dev.status).toBe('unsupported');
    expect(capabilities.commandMap.start.status).toBe('unsupported');
  });

  it('does not advertise Spring Boot execution for a generic Java aggregator', async () => {
    const projectRoot = await createProject(
      'java-aggregator',
      {
        'project.json': {
          runtime: 'java',
          framework: 'java',
          module_support: false,
        },
      },
      {
        'pom.xml': [
          '<project>',
          '  <packaging>pom</packaging>',
          '  <modules><module>core</module><module>server</module></modules>',
          '  <build><plugins><plugin><artifactId>spotless-maven-plugin</artifactId></plugin></plugins></build>',
          '</project>',
        ].join('\n'),
      }
    );

    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'java', 'build', 'java')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'java', 'test', 'java')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'java', 'dev', 'java')).toBe(false);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'java', 'start', 'java')).toBe(false);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'java', 'lint', 'java')).toBe(true);
    expect(isRuntimeLifecycleCommandAvailable(projectRoot, 'java', 'format', 'java')).toBe(true);

    const capabilities = resolveProjectCommandCapabilities(projectRoot);
    expect(capabilities.commandMap.dev.status).toBe('unsupported');
    expect(capabilities.commandMap.start.status).toBe('unsupported');
    expect(capabilities.commandMap.format.status).toBe('supported');
  });

  it('aligns workspace fleet stages with capability gates for observed runtimes', async () => {
    const projectRoot = await createProject(
      'rails-observed',
      {},
      {
        Gemfile: 'gem "rails", "~> 7.1.0"\n',
        'config/application.rb': 'require "rails/all"\n',
      }
    );

    const capabilities = resolveProjectCommandCapabilities(projectRoot);
    expect(capabilities.framework).toBe('rails');
    expect(capabilities.unsupportedCommands).toContain('init');

    const stageSupport = isWorkspaceStageSupported(projectRoot, 'init', capabilities);
    expect(stageSupport.supported).toBe(false);
    expect(stageSupport.reason).toMatch(/init/i);
  });
});
