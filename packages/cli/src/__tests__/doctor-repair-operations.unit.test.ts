import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyEnvKeyAddFix,
  applyFileAppendFix,
  applyFileCopyFix,
  applyFileCreateFix,
  applyJsonEditFix,
  applyMakefileTargetFix,
  applyPackageScriptFix,
  assertOperationPathInsideProject,
  buildRepairOperationIdentity,
  decodeJsonPointerSegment,
  parseInternalRepairCommand,
  parsePackageScriptFix,
} from '../doctor.js';

describe.sequential('doctor typed repair operations', () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-doctor-repair-'));
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('enforces project boundaries and decodes JSON pointer segments', () => {
    expect(assertOperationPathInsideProject(projectRoot, path.join(projectRoot, 'safe.txt'))).toBe(
      path.join(projectRoot, 'safe.txt')
    );
    expect(() =>
      assertOperationPathInsideProject(projectRoot, path.join(projectRoot, '..', 'x'))
    ).toThrow('escapes project boundary');
    expect(decodeJsonPointerSegment('a~1b~0c')).toBe('a/b~c');
  });

  it('parses the three supported npm package-script repair syntaxes', () => {
    expect(parsePackageScriptFix('cd "/tmp/app" && npm pkg set "scripts.test=vitest run"')).toEqual(
      {
        projectPath: '/tmp/app',
        scriptName: 'test',
        scriptValue: 'vitest run',
      }
    );
    expect(parsePackageScriptFix("cd '/tmp/app' ; npm pkg set 'scripts.build=tsc'")).toEqual({
      projectPath: '/tmp/app',
      scriptName: 'build',
      scriptValue: 'tsc',
    });
    expect(parsePackageScriptFix('cd /tmp/app && npm pkg set scripts.dev=node server.js')).toEqual({
      projectPath: '/tmp/app',
      scriptName: 'dev',
      scriptValue: 'node server.js',
    });
    expect(parsePackageScriptFix('npm test')).toBeNull();
  });

  it('round-trips every typed internal repair operation and rejects malformed payloads', () => {
    const operations = [
      { type: 'file-create', path: '/tmp/a', content: 'x', overwrite: false },
      { type: 'file-append', path: '/tmp/a', lines: ['x'], ensureNewline: true },
      { type: 'file-copy', sourcePath: '/tmp/a', path: '/tmp/b', overwrite: false },
      {
        type: 'package-json-script',
        path: '/tmp/package.json',
        scriptName: 'test',
        scriptValue: 'vitest',
      },
      { type: 'json-edit', path: '/tmp/a.json', edits: [{ pointer: '/a', value: 1 }] },
      { type: 'env-key-add', path: '/tmp/.env', keys: [{ name: 'PORT', value: '8080' }] },
      {
        type: 'makefile-target',
        path: '/tmp/Makefile',
        target: 'test',
        command: 'npm test',
        phony: true,
      },
    ] as const;
    for (const operation of operations) {
      const encoded = Buffer.from(JSON.stringify(operation)).toString('base64url');
      expect(parseInternalRepairCommand(`workspai:doctor:repair ${encoded}`)).toEqual(operation);
      // Keep legacy tokens readable so durable remediation plans remain resumable.
      expect(parseInternalRepairCommand(`rapidkit:doctor:repair ${encoded}`)).toEqual(operation);
      expect(buildRepairOperationIdentity(operation)).toContain(operation.type);
    }

    const invalidValues = [
      null,
      [],
      { type: 'file-create', path: 1, content: 'x', overwrite: false },
      { type: 'file-append', path: '/x', lines: [1], ensureNewline: true },
      { type: 'file-copy', sourcePath: '/a', path: '/b', overwrite: true },
      { type: 'package-json-script', path: '/x', scriptName: 1, scriptValue: 'x' },
      { type: 'json-edit', path: '/x', edits: [{ pointer: 'bad', value: {} }] },
      { type: 'env-key-add', path: '/x', keys: [{ name: 'BAD-NAME', value: 1 }] },
      { type: 'makefile-target', path: '/x', target: 'bad target', command: '', phony: 'yes' },
      { type: 'unknown' },
    ];
    expect(parseInternalRepairCommand('not-a-repair')).toBeNull();
    expect(parseInternalRepairCommand('workspai:doctor:repair !!!')).toBeNull();
    expect(parseInternalRepairCommand('rapidkit:doctor:repair !!!')).toBeNull();
    for (const value of invalidValues) {
      const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
      expect(parseInternalRepairCommand(`workspai:doctor:repair ${encoded}`)).toBeNull();
      expect(parseInternalRepairCommand(`rapidkit:doctor:repair ${encoded}`)).toBeNull();
    }
  });

  it('creates, appends, copies, and idempotently preserves files', async () => {
    const created = path.join(projectRoot, 'nested', 'created.txt');
    const createOperation = {
      type: 'file-create',
      path: created,
      content: 'first',
      overwrite: false,
    } as const;
    await applyFileCreateFix({ projectPath: projectRoot, operation: createOperation });
    await fs.writeFile(created, 'preserved');
    await applyFileCreateFix({ projectPath: projectRoot, operation: createOperation });
    expect(await fs.readFile(created, 'utf8')).toBe('preserved');

    const appended = path.join(projectRoot, 'append.txt');
    await fs.writeFile(appended, 'alpha');
    const appendOperation = {
      type: 'file-append',
      path: appended,
      lines: ['alpha', 'beta'],
      ensureNewline: true,
    } as const;
    await applyFileAppendFix({ projectPath: projectRoot, operation: appendOperation });
    await applyFileAppendFix({ projectPath: projectRoot, operation: appendOperation });
    expect(await fs.readFile(appended, 'utf8')).toBe('alpha\nbeta\n');

    const copied = path.join(projectRoot, 'copy', 'target.txt');
    const copyOperation = {
      type: 'file-copy',
      sourcePath: created,
      path: copied,
      overwrite: false,
    } as const;
    await applyFileCopyFix({ projectPath: projectRoot, operation: copyOperation });
    await applyFileCopyFix({ projectPath: projectRoot, operation: copyOperation });
    expect(await fs.readFile(copied, 'utf8')).toBe('preserved');
    await expect(
      applyFileCopyFix({
        projectPath: projectRoot,
        operation: { ...copyOperation, sourcePath: path.join(projectRoot, 'missing') },
      })
    ).rejects.toThrow('Repair source file not found');
  });

  it('resolves portable operation paths against the governed project boundary', async () => {
    const relativeTarget = 'nested/portable.txt';
    await applyFileCreateFix({
      projectPath: projectRoot,
      operation: {
        type: 'file-create',
        path: relativeTarget,
        content: 'portable',
        overwrite: false,
      },
    });

    expect(await fs.readFile(path.join(projectRoot, relativeTarget), 'utf8')).toBe('portable');
  });

  it('repairs package scripts without replacing an existing command', async () => {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    await fs.writeFile(packageJsonPath, '{"name":"fixture","scripts":{"test":"existing"}}\n');
    await applyPackageScriptFix({
      projectPath: projectRoot,
      scriptName: 'test',
      scriptValue: 'new',
    });
    await applyPackageScriptFix({
      projectPath: projectRoot,
      scriptName: 'build',
      scriptValue: 'tsc',
    });
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    expect(packageJson.scripts).toEqual({ test: 'existing', build: 'tsc' });
    await expect(
      applyPackageScriptFix({ projectPath: projectRoot, scriptName: 'bad name', scriptValue: 'x' })
    ).rejects.toThrow('Unsafe package script name');
    await expect(
      applyPackageScriptFix({
        projectPath: path.join(projectRoot, 'missing-project'),
        scriptName: 'test',
        scriptValue: 'x',
      })
    ).rejects.toThrow('package.json not found');
  });

  it('applies nested JSON pointers and rejects malformed or missing targets', async () => {
    const target = path.join(projectRoot, 'config.json');
    await fs.writeFile(target, '{"nested":[],"a/b":{"old":true}}\n');
    await applyJsonEditFix({
      projectPath: projectRoot,
      operation: {
        type: 'json-edit',
        path: target,
        edits: [
          { pointer: '/nested/value', value: 42 },
          { pointer: '/a~1b/new~0key', value: true },
        ],
      },
    });
    const document = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(document).toEqual({ nested: { value: 42 }, 'a/b': { old: true, 'new~key': true } });
    await expect(
      applyJsonEditFix({
        projectPath: projectRoot,
        operation: { type: 'json-edit', path: target, edits: [{ pointer: '/', value: true }] },
      })
    ).rejects.toThrow('Unsupported JSON pointer');
    await expect(
      applyJsonEditFix({
        projectPath: projectRoot,
        operation: {
          type: 'json-edit',
          path: path.join(projectRoot, 'missing.json'),
          edits: [],
        },
      })
    ).rejects.toThrow('JSON repair target not found');
  });

  it('adds missing environment keys and Makefile targets idempotently', async () => {
    const envPath = path.join(projectRoot, '.env.example');
    await fs.writeFile(envPath, 'EXISTING=yes');
    const envOperation = {
      type: 'env-key-add',
      path: envPath,
      keys: [
        { name: 'EXISTING', value: 'no' },
        { name: 'NEW_KEY', value: 'value', comment: 'New setting' },
      ],
    } as const;
    await applyEnvKeyAddFix({ projectPath: projectRoot, operation: envOperation });
    await applyEnvKeyAddFix({ projectPath: projectRoot, operation: envOperation });
    expect(await fs.readFile(envPath, 'utf8')).toBe('EXISTING=yes\n# New setting\nNEW_KEY=value\n');

    const makefilePath = path.join(projectRoot, 'Makefile');
    const makeOperation = {
      type: 'makefile-target',
      path: makefilePath,
      target: 'doctor-check',
      command: 'npm test',
      phony: true,
    } as const;
    await applyMakefileTargetFix({ projectPath: projectRoot, operation: makeOperation });
    await applyMakefileTargetFix({ projectPath: projectRoot, operation: makeOperation });
    expect(await fs.readFile(makefilePath, 'utf8')).toBe(
      '.PHONY: doctor-check\ndoctor-check:\n\tnpm test\n'
    );
  });

  it('covers empty-file, newline, non-phony, and malformed document repair boundaries', async () => {
    const emptyAppend = path.join(projectRoot, 'empty-append.txt');
    await applyFileAppendFix({
      projectPath: projectRoot,
      operation: { type: 'file-append', path: emptyAppend, lines: ['first'], ensureNewline: false },
    });
    expect(await fs.readFile(emptyAppend, 'utf8')).toBe('first\n');

    const newlineAppend = path.join(projectRoot, 'newline-append.txt');
    await fs.writeFile(newlineAppend, 'first\n');
    await applyFileAppendFix({
      projectPath: projectRoot,
      operation: {
        type: 'file-append',
        path: newlineAppend,
        lines: ['second'],
        ensureNewline: true,
      },
    });
    expect(await fs.readFile(newlineAppend, 'utf8')).toBe('first\nsecond\n');

    const noScripts = path.join(projectRoot, 'no-scripts');
    await fs.mkdir(noScripts, { recursive: true });
    await fs.writeFile(path.join(noScripts, 'package.json'), '{"scripts":[]}\n');
    await applyPackageScriptFix({
      projectPath: noScripts,
      scriptName: 'test',
      scriptValue: 'vitest',
    });
    expect(
      JSON.parse(await fs.readFile(path.join(noScripts, 'package.json'), 'utf8')).scripts
    ).toEqual({ test: 'vitest' });

    const primitiveJson = path.join(projectRoot, 'primitive.json');
    await fs.writeFile(primitiveJson, '{"nested":"old"}\n');
    await applyJsonEditFix({
      projectPath: projectRoot,
      operation: {
        type: 'json-edit',
        path: primitiveJson,
        edits: [{ pointer: '/nested/value', value: null }],
      },
    });
    expect(JSON.parse(await fs.readFile(primitiveJson, 'utf8'))).toEqual({
      nested: { value: null },
    });

    const emptyEnv = path.join(projectRoot, 'empty.env');
    await applyEnvKeyAddFix({
      projectPath: projectRoot,
      operation: { type: 'env-key-add', path: emptyEnv, keys: [{ name: 'PORT', value: '3000' }] },
    });
    expect(await fs.readFile(emptyEnv, 'utf8')).toBe('PORT=3000\n');

    const makefile = path.join(projectRoot, 'NonPhonyMakefile');
    await fs.writeFile(makefile, 'existing:\n\ttrue');
    await applyMakefileTargetFix({
      projectPath: projectRoot,
      operation: {
        type: 'makefile-target',
        path: makefile,
        target: 'build.test',
        command: 'npm test',
        phony: false,
      },
    });
    expect(await fs.readFile(makefile, 'utf8')).toBe(
      'existing:\n\ttrue\nbuild.test:\n\tnpm test\n'
    );
  });

  it('builds a stable fallback identity for unknown future repair operations', () => {
    expect(buildRepairOperationIdentity({ type: 'future', path: '/tmp/x' } as never)).toContain(
      'operation:'
    );
  });
});
