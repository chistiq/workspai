import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildPolyglotLifecyclePlan } from '../polyglot-lifecycle-plan.js';

describe('polyglot lifecycle plan', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => fs.remove(directory)));
  });

  it('models a root CMake C++ lifecycle and ignores vendored native builds', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-native-lifecycle-'));
    tempDirs.push(root);
    await fs.outputFile(path.join(root, 'CMakeLists.txt'), 'project(native_core C CXX)\n');
    await fs.outputFile(
      path.join(root, 'third_party', 'dependency', 'CMakeLists.txt'),
      'project(vendored CXX)\n'
    );

    expect(buildPolyglotLifecyclePlan(root)).toEqual({
      schemaVersion: 'polyglot-lifecycle-plan.v1',
      projectRoot: '.',
      polyglot: false,
      runtimes: ['cpp'],
      units: [
        {
          id: 'cpp:.:CMakeLists.txt',
          runtime: 'cpp',
          ecosystem: 'cmake',
          role: 'production',
          root: '.',
          manifest: 'CMakeLists.txt',
          stages: [
            {
              stage: 'init',
              command: 'cmake -S . -B build',
              confidence: 'high',
              preflight: 'executable-and-inputs',
            },
            {
              stage: 'test',
              command: 'ctest --test-dir build --output-on-failure',
              confidence: 'medium',
              preflight: 'executable-and-inputs',
            },
            {
              stage: 'build',
              command: 'cmake --build build',
              confidence: 'high',
              preflight: 'executable-and-inputs',
            },
          ],
        },
      ],
    });
  });

  it('models a Gradle multi-project build once at its root while preserving other runtimes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-gradle-lifecycle-'));
    tempDirs.push(root);
    await fs.outputFile(
      path.join(root, 'settings.gradle'),
      "include ':server', ':plugins:alpha'\n"
    );
    await fs.outputFile(path.join(root, 'build.gradle'), 'plugins { id "java" }\n');
    await fs.outputFile(path.join(root, 'server', 'build.gradle'), 'plugins { id "java" }\n');
    await fs.outputFile(
      path.join(root, 'plugins', 'alpha', 'build.gradle'),
      'plugins { id "java" }\n'
    );
    await fs.outputFile(path.join(root, 'native', 'Cargo.toml'), '[package]\nname = "native"\n');
    await fs.outputFile(path.join(root, 'gradlew'), '#!/bin/sh\n');

    const plan = buildPolyglotLifecyclePlan(root);

    expect(plan.polyglot).toBe(true);
    expect(plan.runtimes).toEqual(['java', 'rust']);
    expect(plan.units.map((unit) => `${unit.ecosystem}:${unit.root}`)).toEqual([
      'gradle:.',
      'cargo:native',
    ]);
    expect(plan.units[0]?.stages[0]?.command).toBe('./gradlew dependencies');
  });

  it('keeps nested Gradle builds independent when no root settings boundary exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-gradle-independent-'));
    tempDirs.push(root);
    await fs.outputFile(path.join(root, 'service-a', 'build.gradle'), 'plugins { id "java" }\n');
    await fs.outputFile(path.join(root, 'service-b', 'build.gradle.kts'), 'plugins { java }\n');

    const plan = buildPolyglotLifecyclePlan(root);

    expect(plan.units.map((unit) => unit.root)).toEqual(['service-a', 'service-b']);
  });

  it('models observed runtime manifests instead of dropping them from polyglot execution', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-observed-lifecycle-'));
    tempDirs.push(root);
    await fs.outputFile(path.join(root, 'Gemfile'), "gem 'rails'\ngem 'rspec-rails'\n");
    await fs.outputFile(path.join(root, 'bin', 'rails'), '#!/usr/bin/env ruby\n');
    await fs.outputFile(path.join(root, 'spec', 'models', 'user_spec.rb'), 'RSpec.describe User\n');
    await fs.outputJson(path.join(root, 'tools', 'composer.json'), {
      scripts: { test: 'phpunit' },
    });
    await fs.outputFile(
      path.join(root, 'services', 'events', 'mix.exs'),
      'def project, do: [app: :events]\n'
    );
    await fs.outputFile(
      path.join(root, 'services', 'rules', 'deps.edn'),
      '{:aliases {:test {}}}\n'
    );
    await fs.outputFile(
      path.join(root, 'services', 'analytics', 'build.sbt'),
      'scalaVersion := "3.3.3"\n'
    );
    await fs.outputJson(path.join(root, 'edge', 'deno.json'), { tasks: { test: 'deno test' } });

    const plan = buildPolyglotLifecyclePlan(root);

    expect(plan.runtimes).toEqual(['clojure', 'deno', 'elixir', 'php', 'ruby', 'scala']);
    expect(plan.units.find((unit) => unit.runtime === 'ruby')).toMatchObject({
      ecosystem: 'bundler',
      manifest: 'Gemfile',
      stages: expect.arrayContaining([
        expect.objectContaining({ stage: 'test', command: 'bundle exec rspec' }),
        expect.objectContaining({ stage: 'start', command: 'bundle exec rails server' }),
      ]),
    });
    expect(plan.units.find((unit) => unit.runtime === 'php')?.stages).toContainEqual(
      expect.objectContaining({ stage: 'test', command: 'composer test' })
    );
  });

  it('classifies Bun and Kotlin ownership without duplicating their shared manifests', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-shared-manifest-lifecycle-'));
    tempDirs.push(root);
    await fs.outputJson(path.join(root, 'web', 'package.json'), {
      scripts: { test: 'bun test', build: 'bun build src.ts' },
    });
    await fs.outputFile(path.join(root, 'web', 'bun.lock'), '');
    await fs.outputFile(
      path.join(root, 'mobile', 'build.gradle.kts'),
      'plugins { kotlin("jvm") version "2.0.0" }\n'
    );

    const plan = buildPolyglotLifecyclePlan(root);

    expect(plan.runtimes).toEqual(['bun', 'kotlin']);
    expect(plan.units.find((unit) => unit.runtime === 'bun')).toMatchObject({
      ecosystem: 'bun',
      stages: expect.arrayContaining([
        expect.objectContaining({ stage: 'init', command: 'bun install' }),
        expect.objectContaining({ stage: 'test', command: 'bun run test' }),
      ]),
    });
  });
});
