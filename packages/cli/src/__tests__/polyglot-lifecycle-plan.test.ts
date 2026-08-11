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
});
