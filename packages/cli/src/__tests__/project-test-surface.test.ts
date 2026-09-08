import os from 'os';
import path from 'path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { detectProjectTestSurface } from '../utils/project-test-surface.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('project test surface', () => {
  it('detects nested polyglot tests without requiring root-level test markers', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-test-surface-'));
    roots.push(root);
    await fsExtra.outputFile(
      path.join(root, 'crates', 'engine', 'tests', 'parser.rs'),
      '#[test]\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'bindings', 'go', 'parser_test.go'),
      'package parser\n'
    );
    await fsExtra.outputFile(
      path.join(root, 'e2e', 'python', 'tests', 'test_parser.py'),
      'def test_parser(): pass\n'
    );

    await expect(detectProjectTestSurface(root)).resolves.toEqual({
      detected: true,
      runtimeFamilies: ['go', 'python', 'rust'],
    });
  });

  it('stays negative for source-only nested packages', async () => {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-test-surface-'));
    roots.push(root);
    await fsExtra.outputFile(
      path.join(root, 'crates', 'engine', 'src', 'parser.rs'),
      'pub fn parse() {}\n'
    );

    await expect(detectProjectTestSurface(root)).resolves.toEqual({
      detected: false,
      runtimeFamilies: [],
    });
  });
});
