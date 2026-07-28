import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectBackendFrameworkFromHints,
  detectBackendFrameworkFromProject,
  detectNestedRuntimeCandidatesFromProject,
  detectRuntimeCandidatesFromProject,
  getBackendFrameworkContract,
  normalizeBackendPlatformKey,
  normalizeBackendFrameworkLabel,
  normalizeBackendRuntimeFamily,
} from '../utils/backend-framework-contract';

const tempDirs: string[] = [];

async function createTempProject(name: string): Promise<string> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), `rk-backend-contract-${name}-`));
  tempDirs.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (target) {
      await fs.remove(target);
    }
  }
});

describe('backend-framework-contract', () => {
  it('normalizes canonical hints from kit, framework, and runtime aliases', () => {
    expect(normalizeBackendFrameworkLabel('gin')).toBe('gogin');
    expect(normalizeBackendFrameworkLabel('Spring Boot')).toBe('springboot');
    expect(normalizeBackendRuntimeFamily('nodejs')).toBe('node');
    expect(normalizeBackendRuntimeFamily('csharp')).toBe('dotnet');
    expect(normalizeBackendRuntimeFamily('c++')).toBe('cpp');
    expect(normalizeBackendRuntimeFamily('clang')).toBe('c');

    expect(detectBackendFrameworkFromHints({ kitName: 'gogin.standard' })).toMatchObject({
      key: 'gogin',
      runtime: 'go',
      importStack: 'go',
      confidence: 'high',
      source: 'kit',
    });

    expect(detectBackendFrameworkFromHints({ framework: 'Spring Boot' })).toMatchObject({
      key: 'springboot',
      runtime: 'java',
      importStack: 'springboot',
      confidence: 'high',
      source: 'framework',
    });

    expect(detectBackendFrameworkFromHints({ runtime: 'csharp' })).toMatchObject({
      key: 'dotnet',
      runtime: 'dotnet',
      importStack: 'dotnet',
      confidence: 'medium',
      source: 'runtime',
    });

    expect(detectBackendFrameworkFromHints({ runtime: 'java' })).toMatchObject({
      key: 'java',
      runtime: 'java',
      importStack: 'unknown',
      confidence: 'medium',
      source: 'runtime',
    });

    expect(detectBackendFrameworkFromHints({ runtime: 'ruby' })).toMatchObject({
      key: 'ruby',
      runtime: 'ruby',
      importStack: 'unknown',
      confidence: 'medium',
      source: 'runtime',
    });

    expect(detectBackendFrameworkFromHints({ runtime: 'rust' })).toMatchObject({
      key: 'rust',
      runtime: 'rust',
      importStack: 'unknown',
      confidence: 'medium',
      source: 'runtime',
    });
  });

  it('detects backend frameworks from project manifests and markers', async () => {
    const gofiberProject = await createTempProject('gofiber');
    await fs.writeFile(
      path.join(gofiberProject, 'go.mod'),
      'module example\n\nrequire github.com/gofiber/fiber/v2 v2.52.4\n'
    );

    const springProject = await createTempProject('springboot');
    await fs.writeFile(
      path.join(springProject, 'pom.xml'),
      '<dependency><groupId>org.springframework.boot</groupId></dependency>'
    );

    const railsProject = await createTempProject('rails');
    await fs.writeFile(path.join(railsProject, 'Gemfile'), 'gem "rails", "~> 7.1.0"\n');

    const dotnetProject = await createTempProject('dotnet');
    await fs.writeFile(
      path.join(dotnetProject, 'Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" /></ItemGroup></Project>'
    );
    const rustProject = await createTempProject('rust');
    await fs.writeFile(path.join(rustProject, 'Cargo.toml'), '[dependencies]\naxum = "0.7"\n');
    const cppProject = await createTempProject('cpp');
    await fs.ensureDir(path.join(cppProject, 'src'));
    await fs.writeFile(path.join(cppProject, 'CMakeLists.txt'), 'project(native_api CXX)\n');
    await fs.writeFile(path.join(cppProject, 'src', 'main.cpp'), 'int main() { return 0; }\n');

    expect(detectBackendFrameworkFromProject(gofiberProject)).toMatchObject({
      key: 'gofiber',
      runtime: 'go',
      importStack: 'go',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(springProject)).toMatchObject({
      key: 'springboot',
      runtime: 'java',
      importStack: 'springboot',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(railsProject)).toMatchObject({
      key: 'rails',
      runtime: 'ruby',
      importStack: 'rails',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(dotnetProject)).toMatchObject({
      key: 'dotnet',
      runtime: 'dotnet',
      importStack: 'dotnet',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(rustProject)).toMatchObject({
      key: 'axum',
      runtime: 'rust',
      importStack: 'unknown',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(cppProject)).toMatchObject({
      key: 'cpp',
      runtime: 'cpp',
      importStack: 'unknown',
      confidence: 'medium',
    });
  });

  it('keeps runtime candidate detection broad for polyglot backends', async () => {
    const polyglotProject = await createTempProject('polyglot');
    await fs.writeFile(
      path.join(polyglotProject, 'package.json'),
      '{"dependencies":{"express":"^4.0.0"}}'
    );
    await fs.writeFile(path.join(polyglotProject, 'go.mod'), 'module example\n');
    await fs.writeFile(path.join(polyglotProject, 'pom.xml'), '<project></project>');
    await fs.writeFile(path.join(polyglotProject, 'Cargo.toml'), '[package]\nname = "core"\n');

    expect(detectRuntimeCandidatesFromProject(polyglotProject)).toEqual([
      'go',
      'rust',
      'java',
      'node',
    ]);
  });

  it('reports both Node and Rust runtime surfaces for a Tauri project', async () => {
    const tauriProject = await createTempProject('tauri-runtimes');
    await fs.writeJson(path.join(tauriProject, 'package.json'), {
      dependencies: { '@tauri-apps/api': 'latest' },
    });
    await fs.ensureDir(path.join(tauriProject, 'src-tauri'));
    await fs.writeFile(
      path.join(tauriProject, 'src-tauri', 'Cargo.toml'),
      '[package]\nname = "desktop"\n'
    );

    expect(detectRuntimeCandidatesFromProject(tauriProject)).toEqual(['rust', 'node']);
  });

  it('discovers bounded nested runtime manifests in an adopted polyglot repository', async () => {
    const monorepo = await createTempProject('nested-polyglot');
    await fs.outputFile(path.join(monorepo, 'services', 'checkout', 'go.mod'), 'module checkout\n');
    await fs.outputJson(path.join(monorepo, 'services', 'frontend', 'package.json'), {
      name: 'frontend',
    });
    await fs.outputFile(
      path.join(monorepo, 'services', 'recommendation', 'requirements.txt'),
      'flask\n'
    );
    await fs.outputFile(
      path.join(monorepo, 'services', 'cart', 'cart.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n'
    );
    await fs.outputFile(
      path.join(monorepo, 'node_modules', 'ignored', 'Cargo.toml'),
      '[package]\nname = "ignored"\n'
    );

    expect(detectNestedRuntimeCandidatesFromProject(monorepo)).toEqual([
      'go',
      'dotnet',
      'node',
      'python',
    ]);
  });

  it('pins unknown normalization and returns immutable public descriptors', () => {
    expect(normalizeBackendPlatformKey(undefined)).toBe('unknown');
    expect(normalizeBackendPlatformKey('  Vue.JS  ')).toBe('vue');
    expect(normalizeBackendRuntimeFamily('not-a-runtime')).toBe('unknown');
    expect(getBackendFrameworkContract('fastapi')).toEqual({
      key: 'fastapi',
      runtime: 'python',
      displayName: 'FastAPI',
      supportTier: 'first-class',
      importStack: 'fastapi',
    });
    expect(getBackendFrameworkContract('invalid' as never).key).toBe('unknown');
    expect(detectBackendFrameworkFromHints({})).toMatchObject({
      key: 'unknown',
      confidence: 'low',
      source: 'unknown',
    });
  });

  it.each([
    ['nestjs', 'package.json', '{"dependencies":{"@nestjs/core":"latest"}}', 'nestjs'],
    ['nestjs-script', 'package.json', '{"scripts":{"dev":"nest start --watch"}}', 'nestjs'],
    ['express', 'package.json', '{"dependencies":{"express":"latest"}}', 'express'],
    ['fastify', 'package.json', '{"dependencies":{"fastify":"latest"}}', 'fastify'],
    ['koa', 'package.json', '{"dependencies":{"koa":"latest"}}', 'koa'],
    [
      'tauri',
      'package.json',
      '{"dependencies":{"@tauri-apps/api":"latest"},"devDependencies":{"@tauri-apps/cli":"latest"}}',
      'tauri',
    ],
    [
      'electron',
      'package.json',
      '{"devDependencies":{"electron":"latest","@electron-forge/cli":"latest"}}',
      'electron',
    ],
    [
      'vscode-extension',
      'package.json',
      '{"engines":{"vscode":"^1.90.0"},"activationEvents":[],"contributes":{"commands":[]}}',
      'vscode-extension',
    ],
    ['node-generic', 'package.json', '{"name":"node-app"}', 'node'],
    ['fastapi', 'requirements.txt', 'fastapi==1.0', 'fastapi'],
    ['django', 'pyproject.toml', 'dependencies = ["django"]', 'django'],
    ['flask', 'requirements.in', 'Flask', 'flask'],
    ['python-generic', 'requirements.txt', 'requests', 'python'],
    ['gogin', 'go.mod', 'require github.com/gin-gonic/gin v1', 'gogin'],
    ['echo', 'go.mod', 'require github.com/labstack/echo/v4 v4', 'echo'],
    ['go-generic', 'go.mod', 'module example', 'go'],
    ['java-generic', 'build.gradle', 'plugins { id "java" }', 'java'],
    ['laravel', 'composer.json', '{"require":{"laravel/framework":"*"}}', 'laravel'],
    ['symfony', 'composer.json', '{"require":{"symfony/console":"*"}}', 'symfony'],
    ['php-generic', 'composer.json', '{"require":{}}', 'php'],
    ['sinatra', 'Gemfile', "gem 'sinatra'", 'sinatra'],
    ['ruby-generic', 'Gemfile', "gem 'rake'", 'ruby'],
    ['actix', 'Cargo.toml', 'actix-web = "4"', 'actix'],
    ['rocket', 'Cargo.toml', 'rocket = "0.5"', 'rocket'],
    ['rust-generic', 'Cargo.toml', '[package]\nname="x"', 'rust'],
    ['phoenix', 'mix.exs', '{:phoenix, "~> 1.7"}', 'phoenix'],
    ['elixir-generic', 'mix.exs', 'defmodule App.MixProject', 'elixir'],
  ])('detects %s from %s content', async (name, fileName, content, expectedKey) => {
    const project = await createTempProject(name);
    await fs.writeFile(path.join(project, fileName), content);
    expect(detectBackendFrameworkFromProject(project).key).toBe(expectedKey);
  });

  it.each([
    ['clojure', 'deps.edn', '{}'],
    ['scala', 'build.sbt', 'scalaVersion := "3"'],
    ['deno', 'deno.json', '{}'],
    ['bun', 'bun.lock', 'lockfileVersion = 1'],
    ['c', 'main.c', 'int main(void) { return 0; }'],
  ])('detects marker-only %s projects', async (expectedKey, fileName, content) => {
    const project = await createTempProject(expectedKey);
    await fs.writeFile(path.join(project, fileName), content);
    expect(detectBackendFrameworkFromProject(project).key).toBe(expectedKey);
  });

  it('detects Kotlin source and generic .NET projects through recursive suffix discovery', async () => {
    const kotlin = await createTempProject('kotlin');
    await fs.ensureDir(path.join(kotlin, 'src', 'main'));
    await fs.writeFile(path.join(kotlin, 'src', 'main', 'App.kt'), 'fun main() {}');
    expect(detectBackendFrameworkFromProject(kotlin).key).toBe('kotlin');

    const dotnet = await createTempProject('dotnet-generic');
    await fs.ensureDir(path.join(dotnet, 'src'));
    await fs.writeFile(
      path.join(dotnet, 'src', 'Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk" />'
    );
    expect(detectBackendFrameworkFromProject(dotnet)).toMatchObject({
      key: 'dotnet',
      confidence: 'medium',
    });
  });

  it('prefers explicit project metadata over conflicting on-disk signals', async () => {
    const project = await createTempProject('hint-priority');
    await fs.writeFile(path.join(project, 'package.json'), '{"dependencies":{"express":"*"}}');
    expect(
      detectBackendFrameworkFromProject(project, { kit_name: 'fastapi.standard' })
    ).toMatchObject({
      key: 'fastapi',
      source: 'kit',
      confidence: 'high',
    });
    expect(detectBackendFrameworkFromProject(project, { framework: 'django' })).toMatchObject({
      key: 'django',
      source: 'framework',
    });
  });

  it('returns unknown for empty and unreadable project roots', async () => {
    const empty = await createTempProject('empty');
    expect(detectRuntimeCandidatesFromProject(path.join(empty, 'missing'))).toEqual([]);
    expect(detectBackendFrameworkFromProject(empty).key).toBe('unknown');
  });
});
