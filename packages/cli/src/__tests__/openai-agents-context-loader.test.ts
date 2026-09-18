import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  openaiAgentsPythonAdapter,
  openaiAgentsTypeScriptAdapter,
  type AgentFrameworkManagedFile,
} from '../agent-frameworks/index.js';
import { WORKSPAI_CONTEXT_SCHEMA_VERSION } from '../agent-frameworks/adapters/openai-agents/typescript-context-source.js';

const temporaryRoots: string[] = [];
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function temporaryProject(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function materialize(
  root: string,
  files: readonly AgentFrameworkManagedFile[]
): Promise<void> {
  for (const file of files) {
    const destination = path.join(root, ...file.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
}

function admittedContext(extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ schemaVersion: WORKSPAI_CONTEXT_SCHEMA_VERSION, ...extra })}\n`;
}

async function writeContext(projectRoot: string, contents: string | Buffer): Promise<string> {
  const contextPath = path.join(projectRoot, '.workspai', 'reports', 'project-context-agent.json');
  await mkdir(path.dirname(contextPath), { recursive: true });
  await writeFile(contextPath, contents);
  return contextPath;
}

function diagnostic(result: { stdout: string; stderr: string }): string {
  return `${result.stderr}${result.stdout}`;
}

function runTypeScriptProbe(agentRoot: string, expression: string, cwd = agentRoot) {
  const probe = `
import { loadWorkspaiContext, resolveWorkspaiProjectRoot } from './src/workspai-context.ts';
${expression}
`;
  const probePath = path.join(agentRoot, `.probe-${process.pid}-${Date.now()}.mts`);
  writeFileSync(probePath, probe);
  try {
    return spawnSync(process.execPath, ['--import', tsxLoader, probePath], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: '1' },
    });
  } finally {
    unlinkSync(probePath);
  }
}

function runPythonProbe(agentRoot: string, expression: string, cwd = agentRoot) {
  const probe = `
from workspai_context import load_workspai_context, resolve_workspai_project_root
${expression}
`;
  const probePath = path.join(agentRoot, `.probe_${process.pid}.py`);
  writeFileSync(probePath, probe);
  try {
    return spawnSync('python3', [probePath], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: '1' },
    });
  } finally {
    unlinkSync(probePath);
  }
}

async function renderBoth(root: string): Promise<{ tsRoot: string; pyRoot: string }> {
  await materialize(
    root,
    openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    }).files
  );
  await materialize(
    root,
    openaiAgentsPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    }).files
  );
  return {
    tsRoot: path.join(root, 'agents', 'release-reviewer'),
    pyRoot: path.join(root, 'agents', 'release-reviewer'),
  };
}

describe('OpenAI Agents generated context loaders', () => {
  it('TypeScript loader reads the owning project from an agent cwd, including spaced paths', async () => {
    const parent = await temporaryProject('workspai oai ts-');
    const root = path.join(parent, 'project with spaces');
    await mkdir(root);
    const rendered = openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    await materialize(root, rendered.files);
    await writeContext(root, admittedContext({ marker: 'from-project-root' }));
    const agentRoot = path.join(root, 'agents', 'release-reviewer');
    const result = runTypeScriptProbe(
      agentRoot,
      "const loaded = JSON.parse(loadWorkspaiContext()); if (loaded.marker !== 'from-project-root') throw new Error('wrong payload');",
      agentRoot
    );
    expect(result.status, diagnostic(result)).toBe(0);
  });

  it('Python loader uses the same project-root contract from an agent cwd, including spaced paths', async () => {
    const parent = await temporaryProject('workspai oai py-');
    const root = path.join(parent, 'project with spaces');
    await mkdir(root);
    const rendered = openaiAgentsPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    await materialize(root, rendered.files);
    await writeContext(root, admittedContext({ marker: 'from-project-root' }));
    const agentRoot = path.join(root, 'agents', 'release-reviewer');
    const result = runPythonProbe(
      agentRoot,
      "import json\nloaded = json.loads(load_workspai_context())\nassert loaded['marker'] == 'from-project-root'\n"
    );
    expect(result.status, diagnostic(result)).toBe(0);
  });

  it('both loaders reject cwd authority, escaped symlinks, directories, and oversized files', async () => {
    const root = await temporaryProject('workspai-oai-deny-');
    const { tsRoot, pyRoot } = await renderBoth(root);
    const contextPath = await writeContext(root, admittedContext());

    const cwdTrap = await temporaryProject('workspai-oai-cwd-');
    await writeContext(cwdTrap, admittedContext({ marker: 'cwd-trap' }));
    const tsTrap = runTypeScriptProbe(
      tsRoot,
      "const loaded = JSON.parse(loadWorkspaiContext()); if (loaded.marker === 'cwd-trap') throw new Error('used cwd');",
      cwdTrap
    );
    const pyTrap = runPythonProbe(
      pyRoot,
      "import json\nloaded = json.loads(load_workspai_context())\nassert loaded.get('marker') != 'cwd-trap'\n",
      cwdTrap
    );
    expect(tsTrap.status, diagnostic(tsTrap)).toBe(0);
    expect(pyTrap.status, diagnostic(pyTrap)).toBe(0);

    await rm(contextPath, { force: true });
    const secretDir = await temporaryProject('workspai-oai-secret-');
    const secret = path.join(secretDir, 'secret.json');
    await writeFile(
      secret,
      JSON.stringify({ schemaVersion: WORKSPAI_CONTEXT_SCHEMA_VERSION, secret: 'do-not-leak' })
    );
    try {
      await symlink(secret, contextPath);
      for (const probe of [
        runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
        runPythonProbe(pyRoot, 'load_workspai_context()\n'),
      ]) {
        expect(probe.status).not.toBe(0);
        expect(diagnostic(probe)).toMatch(/contained regular file/);
        expect(diagnostic(probe)).not.toContain('do-not-leak');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }

    await rm(contextPath, { force: true });
    await mkdir(contextPath);
    for (const probe of [
      runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
      runPythonProbe(pyRoot, 'load_workspai_context()\n'),
    ]) {
      expect(probe.status).not.toBe(0);
      expect(diagnostic(probe)).toMatch(/contained regular file|missing/);
    }

    await rm(contextPath, { recursive: true, force: true });
    await writeContext(root, Buffer.alloc(131_073, 0x78));
    for (const probe of [
      runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
      runPythonProbe(pyRoot, 'load_workspai_context()\n'),
    ]) {
      expect(probe.status).not.toBe(0);
      expect(diagnostic(probe)).toMatch(/128 KiB/);
    }
  });

  it('both loaders reject dangling, parent-escape, invalid schema, and leaking JSON diagnostics', async () => {
    const root = await temporaryProject('workspai-oai-edges-');
    const { tsRoot, pyRoot } = await renderBoth(root);
    const contextPath = await writeContext(root, admittedContext());

    await rm(contextPath, { force: true });
    try {
      await symlink(path.join(root, '.workspai', 'reports', 'missing-target.json'), contextPath);
      for (const probe of [
        runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
        runPythonProbe(pyRoot, 'load_workspai_context()\n'),
      ]) {
        expect(probe.status).not.toBe(0);
        expect(diagnostic(probe)).toMatch(/contained regular file|missing/);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }

    await rm(contextPath, { force: true });
    const escapedParent = await temporaryProject('workspai-oai-parent-');
    await writeContext(escapedParent, admittedContext({ secret: 'do-not-leak' }));
    const workspaiDir = path.join(root, '.workspai');
    await rm(workspaiDir, { recursive: true, force: true });
    try {
      await symlink(path.join(escapedParent, '.workspai'), workspaiDir);
      for (const probe of [
        runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
        runPythonProbe(pyRoot, 'load_workspai_context()\n'),
      ]) {
        expect(probe.status).not.toBe(0);
        expect(diagnostic(probe)).toMatch(/contained regular file/);
        expect(diagnostic(probe)).not.toContain('do-not-leak');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }

    await rm(workspaiDir, { recursive: true, force: true });
    await writeContext(root, `${JSON.stringify({ schemaVersion: 'not-the-host-schema' })}\n`);
    for (const probe of [
      runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
      runPythonProbe(pyRoot, 'load_workspai_context()\n'),
    ]) {
      expect(probe.status).not.toBe(0);
      expect(diagnostic(probe)).toMatch(/schemaVersion/);
    }

    await writeContext(root, '{ "schemaVersion": "project-context-agent.v1", secret: do-not-leak');
    for (const probe of [
      runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
      runPythonProbe(pyRoot, 'load_workspai_context()\n'),
    ]) {
      expect(probe.status).not.toBe(0);
      expect(diagnostic(probe)).toMatch(/valid JSON/);
      expect(diagnostic(probe)).not.toContain('do-not-leak');
    }
  });

  it('both loaders accept an internal symlink whose resolved hops stay inside the project', async () => {
    const root = await temporaryProject('workspai-oai-internal-');
    const { tsRoot, pyRoot } = await renderBoth(root);
    const reports = path.join(root, '.workspai', 'reports');
    await mkdir(reports, { recursive: true });
    const payload = path.join(reports, 'payload.json');
    await writeFile(payload, admittedContext({ marker: 'internal-symlink' }));
    const contextPath = path.join(reports, 'project-context-agent.json');
    try {
      await symlink(payload, contextPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    const ts = runTypeScriptProbe(
      tsRoot,
      "const loaded = JSON.parse(loadWorkspaiContext()); if (loaded.marker !== 'internal-symlink') throw new Error('missed internal symlink');"
    );
    const py = runPythonProbe(
      pyRoot,
      "import json\nloaded = json.loads(load_workspai_context())\nassert loaded['marker'] == 'internal-symlink'\n"
    );
    expect(ts.status, diagnostic(ts)).toBe(0);
    expect(py.status, diagnostic(py)).toBe(0);
  });

  it('TypeScript compiled layout still resolves the same project root', async () => {
    const root = await temporaryProject('workspai-oai-ts-dist-');
    const rendered = openaiAgentsTypeScriptAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    await materialize(root, rendered.files);
    await writeContext(root, admittedContext({ marker: 'compiled' }));
    const agentRoot = path.join(root, 'agents', 'release-reviewer');
    const compiled = path.join(agentRoot, 'dist', 'src', 'workspai-context.ts');
    await mkdir(path.dirname(compiled), { recursive: true });
    const source = rendered.files.find((file) => file.path.endsWith('workspai-context.ts'));
    expect(source).toBeDefined();
    await writeFile(compiled, source!.content, 'utf8');
    const probe = `
import { loadWorkspaiContext } from './dist/src/workspai-context.ts';
const loaded = JSON.parse(loadWorkspaiContext());
if (loaded.marker !== 'compiled') throw new Error('compiled layout missed project root');
`;
    const probePath = path.join(agentRoot, '.probe-dist.mts');
    writeFileSync(probePath, probe);
    const result = spawnSync(process.execPath, ['--import', tsxLoader, probePath], {
      cwd: agentRoot,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: '1' },
    });
    unlinkSync(probePath);
    expect(result.status, diagnostic(result)).toBe(0);
  });

  it('Python nested package layout still resolves the same project root', async () => {
    const root = await temporaryProject('workspai-oai-py-nested-');
    const rendered = openaiAgentsPythonAdapter.render({
      projectRoot: root,
      instanceName: 'Release Reviewer',
    });
    await materialize(root, rendered.files);
    await writeContext(root, admittedContext({ marker: 'nested' }));
    const agentRoot = path.join(root, 'agents', 'release-reviewer');
    const source = rendered.files.find((file) => file.path.endsWith('workspai_context.py'));
    expect(source).toBeDefined();
    const nested = path.join(agentRoot, 'vendor', 'nested', 'workspai_context.py');
    await mkdir(path.dirname(nested), { recursive: true });
    await writeFile(nested, source!.content, 'utf8');
    const probe = `
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / 'vendor' / 'nested'))
from workspai_context import load_workspai_context
loaded = json.loads(load_workspai_context())
assert loaded['marker'] == 'nested'
`;
    const probePath = path.join(agentRoot, `.probe_nested_${process.pid}.py`);
    writeFileSync(probePath, probe);
    const result = spawnSync('python3', [probePath], {
      cwd: path.join(agentRoot, 'tests'),
      encoding: 'utf8',
      env: { ...process.env, OPENAI_AGENTS_DISABLE_TRACING: '1' },
    });
    unlinkSync(probePath);
    expect(result.status, diagnostic(result)).toBe(0);
  });

  it('rejects a non-regular FIFO context file when the platform can create one', async () => {
    if (process.platform === 'win32') return;
    const root = await temporaryProject('workspai-oai-fifo-');
    const { tsRoot, pyRoot } = await renderBoth(root);
    const contextPath = path.join(root, '.workspai', 'reports', 'project-context-agent.json');
    await mkdir(path.dirname(contextPath), { recursive: true });
    const made = spawnSync('mkfifo', [contextPath], { encoding: 'utf8' });
    if (made.status !== 0) return;
    for (const probe of [
      runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
      runPythonProbe(pyRoot, 'load_workspai_context()\n'),
    ]) {
      expect(probe.status).not.toBe(0);
      expect(diagnostic(probe)).toMatch(/contained regular file/);
    }
  });

  it('treats a Windows junction parent as a reparse hop that must stay contained', async () => {
    if (process.platform !== 'win32') return;
    const root = await temporaryProject('workspai-oai-junction-');
    const { tsRoot, pyRoot } = await renderBoth(root);
    const escapedParent = await temporaryProject('workspai-oai-junction-out-');
    await writeContext(escapedParent, admittedContext({ secret: 'do-not-leak' }));
    const workspaiDir = path.join(root, '.workspai');
    await rm(workspaiDir, { recursive: true, force: true });
    const linked = spawnSync(
      'cmd',
      ['/c', 'mklink', '/J', workspaiDir, path.join(escapedParent, '.workspai')],
      { encoding: 'utf8' }
    );
    if (linked.status !== 0) return;
    for (const probe of [
      runTypeScriptProbe(tsRoot, 'loadWorkspaiContext();'),
      runPythonProbe(pyRoot, 'load_workspai_context()\n'),
    ]) {
      expect(probe.status).not.toBe(0);
      expect(diagnostic(probe)).toMatch(/contained regular file/);
      expect(diagnostic(probe)).not.toContain('do-not-leak');
    }
  });
});
