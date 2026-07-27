import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectProjectTestCoverage,
  PROJECT_TEST_COVERAGE_SCHEMA,
} from '../project-test-coverage.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

const roots: string[] = [];

async function fixture(name: string): Promise<{ workspace: string; project: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `workspai-coverage-${name}-`));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  const project = path.join(workspace, name);
  await fs.ensureDir(path.join(workspace, '.workspai'));
  await fs.writeJson(path.join(workspace, '.workspai', 'workspace.json'), {
    name: 'coverage-workspace',
  });
  await fs.ensureDir(project);
  return { workspace, project };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

function assertCoverageContract(value: unknown): void {
  assertJsonSchemaContract(
    value,
    'contracts/project-test-coverage.v1.json',
    'project coverage fixture'
  );
}

describe('project test coverage evidence', () => {
  it('normalizes Istanbul coverage and writes project plus namespaced workspace evidence', async () => {
    const { workspace, project } = await fixture('node-api');
    await fs.writeJson(path.join(project, 'package.json'), {
      scripts: { 'test:cov': 'jest --coverage' },
    });
    await fs.ensureDir(path.join(project, 'coverage'));
    await fs.writeJson(path.join(project, 'coverage', 'coverage-summary.json'), {
      total: {
        lines: { total: 100, covered: 82, skipped: 0, pct: 82 },
        branches: { total: 20, covered: 12, skipped: 0, pct: 60 },
        functions: { total: 30, covered: 21, skipped: 0, pct: 70 },
        statements: { total: 110, covered: 88, skipped: 0, pct: 80 },
      },
      [path.join(project, 'src', 'app.ts')]: {
        lines: { total: 100, covered: 82, skipped: 0, pct: 82 },
        branches: { total: 20, covered: 12, skipped: 0, pct: 60 },
        functions: { total: 30, covered: 21, skipped: 0, pct: 70 },
        statements: { total: 110, covered: 88, skipped: 0, pct: 80 },
      },
    });

    const result = await collectProjectTestCoverage({ projectPath: project, target: 80 });

    expect(result.schemaVersion).toBe(PROJECT_TEST_COVERAGE_SCHEMA);
    expect(result.status).toBe('passed');
    expect(result.runtime).toBe('node');
    expect(result.metrics.lines?.percent).toBe(82);
    expect(result.files[0]?.path).toBe('src/app.ts');
    expect(result.artifactPaths.workspaceProject).toContain(
      `${path.sep}.workspai${path.sep}reports${path.sep}projects${path.sep}`
    );
    expect(await fs.pathExists(result.artifactPaths.project)).toBe(true);
    expect(await fs.pathExists(result.artifactPaths.workspaceLatest as string)).toBe(true);
    expect(await fs.pathExists(result.artifactPaths.workspaceProject as string)).toBe(true);
    expect(result.project.workspacePath).toBe(workspace);
    assertCoverageContract(result);
  });

  it('normalizes coverage.py JSON with line and branch metrics', async () => {
    const { project } = await fixture('python-api');
    await fs.writeFile(path.join(project, 'pyproject.toml'), '[project]\nname="python-api"\n');
    await fs.writeJson(path.join(project, 'coverage.json'), {
      totals: {
        num_statements: 50,
        covered_lines: 35,
        num_branches: 10,
        covered_branches: 4,
      },
      files: {
        'src/api.py': {
          summary: {
            num_statements: 50,
            covered_lines: 35,
            num_branches: 10,
            covered_branches: 4,
          },
        },
      },
    });

    const result = await collectProjectTestCoverage({ projectPath: project, target: 75 });
    expect(result.runtime).toBe('python');
    expect(result.status).toBe('below-target');
    expect(result.metrics.lines?.percent).toBe(70);
    expect(result.metrics.branches?.percent).toBe(40);
    assertCoverageContract(result);
  });

  it('normalizes Go coverprofile statement weights', async () => {
    const { project } = await fixture('go-api');
    await fs.writeFile(path.join(project, 'go.mod'), 'module example.com/api\n\ngo 1.24\n');
    await fs.writeFile(
      path.join(project, 'coverage.out'),
      [
        'mode: set',
        'example.com/api/main.go:10.1,12.2 4 1',
        'example.com/api/main.go:14.1,16.2 2 0',
        '',
      ].join('\n')
    );

    const result = await collectProjectTestCoverage({ projectPath: project, target: 60 });
    expect(result.runtime).toBe('go');
    expect(result.target.metric).toBe('statements');
    expect(result.metrics.statements?.percent).toBe(66.67);
    expect(result.status).toBe('passed');
    assertCoverageContract(result);
  });

  it('normalizes JaCoCo report-level counters', async () => {
    const { project } = await fixture('java-api');
    await fs.writeFile(path.join(project, 'pom.xml'), '<project />');
    const report = path.join(project, 'target', 'site', 'jacoco', 'jacoco.xml');
    await fs.ensureDir(path.dirname(report));
    await fs.writeFile(
      report,
      '<report><counter type="INSTRUCTION" missed="20" covered="80"/><counter type="BRANCH" missed="5" covered="15"/><counter type="LINE" missed="10" covered="40"/><counter type="METHOD" missed="2" covered="8"/></report>'
    );

    const result = await collectProjectTestCoverage({ projectPath: project, target: 75 });
    expect(result.runtime).toBe('java');
    expect(result.metrics.lines?.percent).toBe(80);
    expect(result.metrics.branches?.percent).toBe(75);
    expect(result.status).toBe('passed');
    assertCoverageContract(result);
  });

  it('discovers nested .NET Cobertura output', async () => {
    const { project } = await fixture('dotnet-api');
    await fs.writeFile(path.join(project, 'Api.csproj'), '<Project />');
    const report = path.join(project, 'TestResults', 'run-1', 'coverage.cobertura.xml');
    await fs.ensureDir(path.dirname(report));
    await fs.writeFile(
      report,
      '<coverage branch-rate="0.5" line-rate="0.875"><packages /></coverage>'
    );

    const result = await collectProjectTestCoverage({ projectPath: project, target: 85 });
    expect(result.runtime).toBe('dotnet');
    expect(result.metrics.lines?.percent).toBe(87.5);
    expect(result.status).toBe('passed');
    assertCoverageContract(result);
  });

  it('normalizes SimpleCov line arrays', async () => {
    const { project } = await fixture('ruby-api');
    await fs.writeFile(path.join(project, 'Gemfile'), "source 'https://rubygems.org'\n");
    await fs.writeJson(path.join(project, '.resultset.json'), {
      RSpec: {
        coverage: {
          [path.join(project, 'lib', 'service.rb')]: [1, 1, null, 0],
        },
      },
    });

    const result = await collectProjectTestCoverage({ projectPath: project, target: 70 });
    expect(result.runtime).toBe('ruby');
    expect(result.metrics.lines?.percent).toBe(66.67);
    expect(result.status).toBe('below-target');
    assertCoverageContract(result);
  });

  it('normalizes LCOV for Bun and LLVM JSON for Rust', async () => {
    const bun = await fixture('bun-api');
    await fs.writeJson(path.join(bun.project, 'package.json'), { scripts: { test: 'bun test' } });
    await fs.writeFile(path.join(bun.project, 'bun.lock'), '');
    await fs.ensureDir(path.join(bun.project, 'coverage'));
    await fs.writeFile(
      path.join(bun.project, 'coverage', 'lcov.info'),
      'SF:src/app.ts\nLF:10\nLH:9\nFNF:2\nFNH:1\nBRF:4\nBRH:2\nend_of_record\n'
    );
    const bunResult = await collectProjectTestCoverage({ projectPath: bun.project, target: 90 });
    expect(bunResult.runtime).toBe('bun');
    expect(bunResult.metrics.lines?.percent).toBe(90);
    expect(bunResult.status).toBe('passed');

    const rust = await fixture('rust-api');
    await fs.writeFile(path.join(rust.project, 'Cargo.toml'), '[package]\nname="rust-api"\n');
    await fs.writeJson(path.join(rust.project, 'coverage.json'), {
      data: [
        {
          totals: {
            lines: { count: 100, covered: 91 },
            functions: { count: 10, covered: 8 },
            branches: { count: 20, covered: 14 },
            regions: { count: 120, covered: 100 },
          },
          files: [],
        },
      ],
    });
    const rustResult = await collectProjectTestCoverage({
      projectPath: rust.project,
      target: 90,
    });
    expect(rustResult.runtime).toBe('rust');
    expect(rustResult.metrics.lines?.percent).toBe(91);
    expect(rustResult.source.format).toBe('llvm-cov-json');
    assertCoverageContract(rustResult);
  });

  it.each([
    ['deno-api', 'deno.json', '{}', 'deno'],
    ['elixir-api', 'mix.exs', 'defmodule App.MixProject do end', 'elixir'],
    ['clojure-api', 'deps.edn', '{}', 'clojure'],
    ['php-api', 'composer.json', '{}', 'php'],
    ['scala-api', 'build.sbt', 'scalaVersion := "3.6.0"', 'scala'],
  ] as const)(
    'publishes an explicit unavailable contract and runtime-owned runner plan for %s',
    async (name, marker, contents, runtime) => {
      const { project } = await fixture(name);
      await fs.writeFile(path.join(project, marker), contents);
      const result = await collectProjectTestCoverage({ projectPath: project, target: 80 });
      expect(result.runtime).toBe(runtime);
      expect(result.status).toBe('unavailable');
      expect(result.execution.invocations.length).toBeGreaterThan(0);
      expect(result.diagnostics).toContain(
        'No supported machine-readable coverage artifact was found.'
      );
      assertCoverageContract(result);
    }
  );

  it('detects Kotlin/JVM coverage and native C++ LCOV without losing runtime identity', async () => {
    const kotlin = await fixture('kotlin-api');
    await fs.writeFile(path.join(kotlin.project, 'build.gradle.kts'), 'plugins { kotlin("jvm") }');
    await fs.ensureDir(path.join(kotlin.project, 'src', 'main', 'kotlin'));
    await fs.writeFile(
      path.join(kotlin.project, 'src', 'main', 'kotlin', 'App.kt'),
      'fun main() = Unit\n'
    );
    const jacoco = path.join(
      kotlin.project,
      'build',
      'reports',
      'jacoco',
      'test',
      'jacocoTestReport.xml'
    );
    await fs.ensureDir(path.dirname(jacoco));
    await fs.writeFile(jacoco, '<report><counter type="LINE" missed="10" covered="90"/></report>');
    const kotlinResult = await collectProjectTestCoverage({
      projectPath: kotlin.project,
      target: 90,
    });
    expect(kotlinResult).toMatchObject({
      runtime: 'kotlin',
      status: 'passed',
      metrics: { lines: { percent: 90 } },
    });
    assertCoverageContract(kotlinResult);

    const native = await fixture('native-api');
    await fs.writeFile(
      path.join(native.project, 'CMakeLists.txt'),
      'project(native LANGUAGES CXX)\n'
    );
    await fs.ensureDir(path.join(native.project, 'src'));
    await fs.writeFile(path.join(native.project, 'src', 'main.cpp'), 'int main() { return 0; }\n');
    await fs.ensureDir(path.join(native.project, 'coverage'));
    await fs.writeFile(
      path.join(native.project, 'coverage', 'lcov.info'),
      'SF:src/main.cpp\nLF:10\nLH:8\nend_of_record\n'
    );
    const nativeResult = await collectProjectTestCoverage({
      projectPath: native.project,
      target: 80,
    });
    expect(nativeResult).toMatchObject({
      runtime: 'cpp',
      status: 'passed',
      metrics: { lines: { percent: 80 } },
    });
    assertCoverageContract(nativeResult);
  });

  it('does not mistake a Gradle Kotlin build script for Kotlin application source', async () => {
    const { project } = await fixture('java-gradle-api');
    await fs.writeFile(path.join(project, 'build.gradle.kts'), 'plugins { java }\n');
    await fs.ensureDir(path.join(project, 'src', 'main', 'java'));
    await fs.writeFile(
      path.join(project, 'src', 'main', 'java', 'App.java'),
      'final class App {}\n'
    );

    const result = await collectProjectTestCoverage({ projectPath: project, target: 80 });

    expect(result.runtime).toBe('java');
    expect(result.status).toBe('unavailable');
    assertCoverageContract(result);
  });

  it('normalizes Scala scoverage evidence without requiring a graph or language-specific consumer', async () => {
    const { project } = await fixture('scala-covered-api');
    await fs.writeFile(path.join(project, 'build.sbt'), 'scalaVersion := "3.6.0"\n');
    const report = path.join(project, 'target', 'scala-3.6.0', 'scoverage-report', 'scoverage.xml');
    await fs.ensureDir(path.dirname(report));
    await fs.writeFile(
      report,
      '<scoverage statement-count="100" statements-invoked="84" statement-rate="84.0" branch-count="20" branches-invoked="15" branch-rate="75.0" />'
    );

    const result = await collectProjectTestCoverage({ projectPath: project, target: 80 });

    expect(result).toMatchObject({
      runtime: 'scala',
      status: 'passed',
      source: { format: 'scoverage-xml' },
      metrics: {
        statements: { percent: 84 },
        branches: { percent: 75 },
      },
    });
    assertCoverageContract(result);
  });
});
