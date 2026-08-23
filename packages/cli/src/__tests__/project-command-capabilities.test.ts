import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getProjectCommandCapability,
  isProjectCapabilityRequest,
  resolveProjectCommandCapabilities,
} from '../utils/project-command-capabilities';

const tempDirs: string[] = [];

async function createProject(
  metadata: Record<string, unknown>,
  files: Record<string, string> = {}
): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-command-capabilities-'));
  tempDirs.push(projectRoot);
  await fs.ensureDir(path.join(projectRoot, '.rapidkit'));
  await fs.writeJson(path.join(projectRoot, '.rapidkit', 'project.json'), metadata, { spaces: 2 });
  await fs.writeJson(
    path.join(projectRoot, '.rapidkit', 'context.json'),
    { engine: 'npm' },
    { spaces: 2 }
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(projectRoot, relativePath);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content);
  }
  return projectRoot;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) await fs.remove(target);
  }
});

describe('project command capabilities', () => {
  it('keeps Core module/template commands available for Core-backed Python projects', async () => {
    const projectRoot = await createProject({
      kit_name: 'fastapi.standard',
      runtime: 'python',
    });

    const capabilities = resolveProjectCommandCapabilities(projectRoot);

    expect(capabilities.runtime).toBe('python');
    expect(capabilities.framework).toBe('fastapi');
    expect(capabilities.runtimeSupportTier).toBe('first-class');
    expect(capabilities.frameworkSupportTier).toBe('first-class');
    expect(capabilities.runtimeDoctorSupport).toBe('full');
    expect(capabilities.moduleSupport).toBe(true);
    expect(capabilities.commandMap.add).toMatchObject({ status: 'supported', owner: 'core' });
    expect(capabilities.commandMap.modules).toMatchObject({ status: 'supported', owner: 'core' });
  });

  it('blocks Core module/template commands for npm-owned Go and Java projects', async () => {
    const goProject = await createProject(
      {
        kit_name: 'gogin.standard',
        runtime: 'go',
        module_support: false,
      },
      { 'go.mod': 'module example\n\nrequire github.com/gin-gonic/gin v1.10.0\n' }
    );
    const javaProject = await createProject(
      {
        kit_name: 'springboot.standard',
        runtime: 'java',
        module_support: false,
      },
      { 'pom.xml': '<dependency><groupId>org.springframework.boot</groupId></dependency>' }
    );

    const goCapabilities = resolveProjectCommandCapabilities(goProject);
    const javaCapabilities = resolveProjectCommandCapabilities(javaProject);

    expect(goCapabilities.framework).toBe('gogin');
    expect(goCapabilities.runtimeSupportTier).toBe('extended');
    expect(goCapabilities.frameworkSupportTier).toBe('extended');
    expect(goCapabilities.runtimeDoctorSupport).toBe('readiness');
    expect(goCapabilities.commandMap.modules).toMatchObject({
      status: 'unsupported',
      owner: 'none',
    });
    expect(goCapabilities.commandMap.build).toMatchObject({
      status: 'supported',
      owner: 'runtime',
    });

    expect(javaCapabilities.framework).toBe('springboot');
    expect(javaCapabilities.runtimeSupportTier).toBe('extended');
    expect(javaCapabilities.frameworkSupportTier).toBe('extended');
    expect(javaCapabilities.commandMap.rollback).toMatchObject({
      status: 'unsupported',
      owner: 'none',
    });
    expect(javaCapabilities.commandMap.test).toMatchObject({
      status: 'supported',
      owner: 'runtime',
    });
  });

  it('supports runtime commands while blocking Core modules for npm-owned .NET projects', async () => {
    const dotnetProject = await createProject(
      {
        kit_name: 'dotnet.webapi.clean',
        runtime: 'dotnet',
        module_support: false,
      },
      { 'src/orders-api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' }
    );

    const capabilities = resolveProjectCommandCapabilities(dotnetProject);

    expect(capabilities.runtime).toBe('dotnet');
    expect(capabilities.framework).toBe('dotnet');
    expect(capabilities.runtimeSupportTier).toBe('extended');
    expect(capabilities.frameworkSupportTier).toBe('extended');
    expect(capabilities.commandMap.build).toMatchObject({
      status: 'supported',
      owner: 'runtime',
    });
    expect(capabilities.commandMap.modules).toMatchObject({
      status: 'unsupported',
      owner: 'none',
    });
  });

  it('exposes only PHP lifecycle commands proven by project files', async () => {
    const phpProject = await createProject(
      {
        runtime: 'php',
        framework: 'laravel',
        module_support: false,
      },
      { 'composer.json': '{"require":{"laravel/framework":"^11.0"}}' }
    );

    const capabilities = resolveProjectCommandCapabilities(phpProject);

    expect(capabilities.runtime).toBe('php');
    expect(capabilities.framework).toBe('laravel');
    expect(capabilities.runtimeSupportTier).toBe('extended');
    expect(capabilities.frameworkSupportTier).toBe('extended');
    expect(capabilities.commandMap.help).toMatchObject({
      status: 'supported',
      owner: 'npm',
    });
    expect(capabilities.commandMap.init).toMatchObject({
      status: 'supported',
      owner: 'runtime',
    });
    expect(capabilities.commandMap.dev).toMatchObject({
      status: 'unsupported',
      owner: 'runtime',
    });
  });

  it('limits node lifecycle commands to resolvable package.json scripts', async () => {
    const projectRoot = await createProject(
      {
        kit_name: 'frontend.nextjs',
        runtime: 'node',
        framework: 'nextjs',
        module_support: false,
      },
      {
        'package.json': JSON.stringify({
          scripts: {
            dev: 'next dev',
            build: 'next build',
          },
        }),
      }
    );

    const capabilities = resolveProjectCommandCapabilities(projectRoot);

    expect(capabilities.supportedCommands).toEqual(
      expect.arrayContaining(['dev', 'build', 'help', 'init'])
    );
    expect(capabilities.unsupportedCommands).toEqual(
      expect.arrayContaining(['start', 'test', 'lint', 'format'])
    );
  });

  it('detects capability request forms and unsupported command decisions', async () => {
    const projectRoot = await createProject({
      kit_name: 'gofiber.standard',
      runtime: 'go',
      module_support: false,
    });

    expect(isProjectCapabilityRequest(['project', 'commands'])).toBe(true);
    expect(isProjectCapabilityRequest(['commands', '--scope', 'project', '--json'])).toBe(true);
    expect(isProjectCapabilityRequest(['commands', '--scope=project'])).toBe(true);
    expect(isProjectCapabilityRequest(['commands', '--json'])).toBe(false);

    expect(getProjectCommandCapability(['modules'], projectRoot)).toMatchObject({
      command: 'modules',
      status: 'unsupported',
    });
  });

  it('resolves project command capabilities from nested project directories', async () => {
    const projectRoot = await createProject({
      kit_name: 'gofiber.standard',
      runtime: 'go',
      module_support: false,
    });
    const nestedDir = path.join(projectRoot, 'src', 'internal', 'handlers');
    await fs.ensureDir(nestedDir);

    const capabilities = resolveProjectCommandCapabilities(nestedDir);

    expect(capabilities.projectRoot).toBe(projectRoot);
    expect(getProjectCommandCapability(['modules'], nestedDir)).toMatchObject({
      command: 'modules',
      status: 'unsupported',
      owner: 'none',
    });
  });

  it('marks dev as local-only and exposes fleet stages separately from project commands', async () => {
    const projectRoot = await createProject(
      {
        kit_name: 'nestjs.standard',
        runtime: 'node',
        module_support: true,
      },
      {
        'package.json': JSON.stringify({
          scripts: {
            dev: 'nest start --watch',
            test: 'jest',
            build: 'nest build',
            start: 'node dist/main.js',
          },
        }),
      }
    );

    const capabilities = resolveProjectCommandCapabilities(projectRoot);

    expect(capabilities.commandMap.dev).toMatchObject({
      status: 'supported',
      executionScope: 'local-only',
      fleetEligible: false,
    });
    expect(capabilities.commandMap.test).toMatchObject({
      status: 'supported',
      fleetEligible: true,
    });
    expect(capabilities.fleetStages).toEqual(expect.arrayContaining(['test', 'build']));
    expect(capabilities.localOnlyCommands).toEqual(expect.arrayContaining(['dev']));
  });

  it('does not present a primary adapter as complete lifecycle coverage for a polyglot SDK', async () => {
    const projectRoot = await createProject(
      {
        runtime: 'dotnet',
        framework: 'dotnet',
        module_support: false,
      },
      {
        'dotnet/src/Sdk.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
        'go/go.mod': 'module example.test/sdk\n',
        'java/pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>',
        'nodejs/package.json': '{"name":"example-sdk","version":"1.0.0"}',
        'python/pyproject.toml': '[project]\nname="example-sdk"\n',
        'rust/Cargo.toml': '[package]\nname="example-sdk"\nversion="1.0.0"\n',
      }
    );

    const capabilities = resolveProjectCommandCapabilities(projectRoot);

    expect(capabilities.runtimeCandidates).toEqual([
      'dotnet',
      'go',
      'rust',
      'java',
      'node',
      'python',
    ]);
    expect(capabilities.compositeRuntime).toBe(true);
    expect(capabilities.lifecycleCoverage).toBe('primary-runtime-only');
    expect(capabilities.commandMap.build.reason).toContain('primary dotnet adapter');
    expect(capabilities.commandMap.build.reason).toContain('explicit project boundaries');
  });
});
