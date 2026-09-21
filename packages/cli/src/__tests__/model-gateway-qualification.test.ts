import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';

import { NPM_ONLY_SCOPED_COMMANDS } from '../utils/cli-command-surface.js';
import {
  generateModelGatewayProject,
  listModelGatewayProjectKits,
} from '../model-gateways/project-kits.js';
import { MODEL_GATEWAY_REQUIRED_FILES } from '../model-gateways/generated.js';
import {
  MODEL_GATEWAY_ATTACH_POLICY,
  MODEL_GATEWAY_QUALIFICATION,
  MODEL_GATEWAY_RELEASE_AUTHORITY,
  isModelGatewayReleaseQualified,
} from '../model-gateways/qualification-policy.js';
import {
  BUILTIN_MODEL_GATEWAY_VERSION_BASELINES,
  sdkCorePackage,
} from '../model-gateways/version-policy.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsExtra.remove(root)));
});

describe('model gateway qualification and maintenance boundaries', () => {
  it('keeps Attach unsupported and Create-only for this surface', () => {
    expect(MODEL_GATEWAY_ATTACH_POLICY).toBe('unsupported');
    expect(MODEL_GATEWAY_QUALIFICATION.attach).toBe('unsupported');
    expect(
      NPM_ONLY_SCOPED_COMMANDS.some((entry) => entry.join(' ').includes('gateway attach'))
    ).toBe(false);
    const docs = fs.readFileSync(path.join(process.cwd(), 'docs', 'model-gateways.md'), 'utf8');
    expect(docs).toMatch(/Attach is not supported/i);
    expect(docs).not.toMatch(/workspai gateway attach/i);
  });

  it('does not treat source-ready kits as a Workspai-qualified release', () => {
    expect(MODEL_GATEWAY_RELEASE_AUTHORITY).toBe('source-ready');
    expect(isModelGatewayReleaseQualified()).toBe(false);
    expect(
      MODEL_GATEWAY_QUALIFICATION.adapters.every((adapter) => adapter.platforms.length === 0)
    ).toBe(true);
    const changelog = fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.slice(0, changelog.indexOf('\n## ['));
    expect(unreleased.toLowerCase()).not.toMatch(/release-ready|release-admitted/);
  });

  it('emits the declared generated-file inventory without credentials or version ranges', async () => {
    for (const kit of listModelGatewayProjectKits()) {
      const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'workspai-gateway-inventory-'));
      roots.push(root);
      await generateModelGatewayProject({
        projectPath: root,
        projectName: 'inventory-gateway',
        kit,
        generatedAt: '2020-01-01T00:00:00.000Z',
      });
      const required =
        MODEL_GATEWAY_REQUIRED_FILES[kit.id as keyof typeof MODEL_GATEWAY_REQUIRED_FILES];
      expect(required?.length).toBeGreaterThan(0);
      for (const relativePath of required) {
        expect(await fsExtra.pathExists(path.join(root, relativePath)), relativePath).toBe(true);
      }
      const packed = await collectText(root);
      expect(packed).not.toMatch(/sk-or-[A-Za-z0-9]{8,}/);
      if (kit.runtime === 'node') {
        const packageJson = await fsExtra.readJson(path.join(root, 'package.json'));
        expect(JSON.stringify(packageJson.dependencies)).not.toMatch(/\^|~|latest|\*/);
        expect(JSON.stringify(packageJson.devDependencies)).not.toMatch(/\^|~|latest|\*/);
      } else {
        const pyproject = await fsExtra.readFile(path.join(root, 'pyproject.toml'), 'utf8');
        expect(pyproject).not.toMatch(/openrouter\s*>=|openrouter\s*~=/);
      }
      expect(await fsExtra.pathExists(path.join(root, 'gateway.policy.json'))).toBe(true);
      expect(await fsExtra.pathExists(path.join(root, '.env.example'))).toBe(true);
      const projectJson = await fsExtra.readJson(path.join(root, '.workspai', 'project.json'));
      expect(projectJson.contracts.consumes).toEqual([kit.gatewayId]);
    }
  });

  it('fails if adapter source duplicates canonical SDK version literals', () => {
    const adapterRoot = path.join(process.cwd(), 'src', 'model-gateways');
    const forbidden = BUILTIN_MODEL_GATEWAY_VERSION_BASELINES.flatMap((baseline) => {
      const core = sdkCorePackage(baseline);
      return [baseline.sdkVersion, core.version];
    }).filter((value, index, all) => all.indexOf(value) === index);
    const files = listTypeScriptFiles(adapterRoot).filter(
      (file) => !file.endsWith('version-baselines.v1.json')
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const version of forbidden) {
        if (source.includes(`'${version}'`) || source.includes(`"${version}"`)) {
          offenders.push(`${path.relative(adapterRoot, file)}:${version}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(target));
      continue;
    }
    if (entry.name.endsWith('.ts')) files.push(target);
  }
  return files;
}

async function collectText(root: string): Promise<string> {
  const chunks: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fsExtra.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      chunks.push(await fsExtra.readFile(target, 'utf8'));
    }
  };
  await visit(root);
  return chunks.join('\n');
}
