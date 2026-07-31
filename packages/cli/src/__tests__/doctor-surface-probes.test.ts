import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import fsExtra from 'fs-extra';

import { buildEnterpriseSurfaceProbes } from '../utils/doctor-surface-probes.js';

describe('doctor enterprise surface probes', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await fsExtra.remove(dir);
    }
    tempDirs.length = 0;
  });

  async function makeProject(files: Record<string, string | object>): Promise<string> {
    const root = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-surface-'));
    tempDirs.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      await fsExtra.ensureDir(path.dirname(target));
      if (typeof content === 'string') {
        await fsExtra.writeFile(target, content, 'utf8');
      } else {
        await fsExtra.writeJSON(target, content, { spaces: 2 });
      }
    }
    return root;
  }

  it('reports cross-cutting enterprise surfaces for a Node project', async () => {
    const projectPath = await makeProject({
      'package.json': {
        name: 'web',
        version: '1.0.0',
        scripts: {
          lint: 'next lint',
        },
      },
      Dockerfile: 'FROM node:20-alpine\nCOPY . .\n',
      'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nspec: {}\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'frontend',
      packageJsonData: (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
        string,
        unknown
      >,
      hasTests: false,
      hasDocker: true,
      vulnerabilities: 2,
    });

    expect(probes.map((probe) => probe.id)).toEqual(
      expect.arrayContaining([
        'surface-dependency-contract',
        'surface-env-contract',
        'surface-dockerignore',
        'surface-kubernetes-readiness',
        'surface-security-hygiene',
        'surface-test-contract',
        'surface-format-contract',
        'runtime-test-depth',
        'runtime-quality-tooling',
        'runtime-security-tooling',
      ])
    );
    expect(probes.find((probe) => probe.id === 'surface-dockerignore')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'surface-dockerignore',
        fixKind: 'file-create',
        status: 'available',
        command: expect.stringMatching(/^workspai:doctor:repair\s/),
        operation: {
          type: 'file-create',
        },
        canEditFiles: true,
        requiresApproval: true,
      },
    });
    expect(probes.find((probe) => probe.id === 'surface-dependency-contract')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'surface-dependency-contract',
        fixKind: 'dependency-sync',
        status: 'available',
        command: expect.stringContaining('npm install'),
      },
    });
    expect(probes.find((probe) => probe.id === 'surface-security-hygiene')).toMatchObject({
      status: 'fail',
      severity: 'error',
      repairCapability: {
        issueId: 'surface-security-hygiene',
        status: 'available',
        fixKind: 'command',
        canAutoFix: true,
      },
    });
    expect(probes.find((probe) => probe.id === 'surface-test-contract')?.status).toBe('warn');
    expect(probes.find((probe) => probe.id === 'surface-kubernetes-readiness')?.status).toBe(
      'warn'
    );
    expect(probes.find((probe) => probe.id === 'runtime-security-tooling')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'runtime-security-tooling',
        status: 'available',
        fixKind: 'package-json-script',
        operation: {
          type: 'package-json-script',
          scriptName: 'audit',
          scriptValue: 'npm audit --audit-level=moderate',
        },
      },
    });
  });

  it('uses packageManager to choose the Node dependency baseline repair command', async () => {
    const projectPath = await makeProject({
      'package.json': {
        name: 'web',
        version: '1.0.0',
        packageManager: 'pnpm@10.0.0',
      },
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'frontend',
      packageJsonData: (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
        string,
        unknown
      >,
      hasTests: false,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'surface-dependency-contract')).toMatchObject({
      status: 'warn',
      repairCapability: {
        fixKind: 'dependency-sync',
        command: expect.stringContaining('pnpm install'),
      },
    });
  });

  it('emits runtime-native dependency baseline repairs across enterprise runtimes', async () => {
    const cases: Array<{
      runtimeFamily: 'go' | 'java' | 'rust' | 'php' | 'ruby' | 'dotnet' | 'python';
      files: Record<string, string | object>;
      expectedCommand: string;
      expectedFiles: string[];
    }> = [
      {
        runtimeFamily: 'go',
        files: { 'go.mod': 'module example.com/api\n' },
        expectedCommand: 'go mod tidy',
        expectedFiles: ['go.mod', 'go.sum'],
      },
      {
        runtimeFamily: 'java',
        files: { 'pom.xml': '<project></project>\n', mvnw: '#!/bin/sh\n' },
        expectedCommand:
          process.platform === 'win32'
            ? '.\\mvnw.cmd -B -DskipTests dependency:go-offline'
            : './mvnw -B -DskipTests dependency:go-offline',
        expectedFiles: ['pom.xml', 'gradle.lockfile'],
      },
      {
        runtimeFamily: 'rust',
        files: { 'Cargo.toml': '[package]\nname = "api"\nversion = "0.1.0"\n' },
        expectedCommand: 'cargo fetch',
        expectedFiles: ['Cargo.toml', 'Cargo.lock'],
      },
      {
        runtimeFamily: 'php',
        files: { 'composer.json': { name: 'rapidkit/api', require: {} } },
        expectedCommand: 'composer install',
        expectedFiles: ['composer.json', 'composer.lock'],
      },
      {
        runtimeFamily: 'ruby',
        files: { Gemfile: 'source "https://rubygems.org"\n' },
        expectedCommand: 'bundle install',
        expectedFiles: ['Gemfile', 'Gemfile.lock'],
      },
      {
        runtimeFamily: 'dotnet',
        files: { 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n' },
        expectedCommand: 'dotnet restore',
        expectedFiles: ['*.csproj', 'packages.lock.json'],
      },
      {
        runtimeFamily: 'python',
        files: { 'pyproject.toml': '[tool.poetry]\nname = "api"\nversion = "0.1.0"\n' },
        expectedCommand: 'poetry install --no-root',
        expectedFiles: ['pyproject.toml', 'poetry.lock'],
      },
    ];

    for (const testCase of cases) {
      const projectPath = await makeProject(testCase.files);
      const probes = await buildEnterpriseSurfaceProbes({
        projectPath,
        runtimeFamily: testCase.runtimeFamily,
        projectKind: 'backend',
        hasTests: false,
        vulnerabilities: 0,
      });

      expect(
        probes.find((probe) => probe.id === 'surface-dependency-contract'),
        testCase.runtimeFamily
      ).toMatchObject({
        status: 'warn',
        repairCapability: {
          fixKind: 'dependency-sync',
          status: 'available',
          command: expect.stringContaining(testCase.expectedCommand),
          files: expect.arrayContaining(
            testCase.expectedFiles.map((file) => path.join(projectPath, file))
          ),
        },
      });
    }
  });

  it('emits runtime-native test, quality, and security command contracts without Makefile conflicts', async () => {
    const projectPath = await makeProject({
      'go.mod': 'module example.com/api\n',
      'go.sum': '',
      '.gitignore': '.env\n.env.*\n!.env.example\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'go',
      projectKind: 'backend',
      hasTests: false,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'surface-test-contract')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'surface-test-contract',
        fixKind: 'file-append',
        files: [path.join(projectPath, 'Makefile')],
        operation: {
          type: 'makefile-target',
          target: 'test',
          command: 'go test ./...',
        },
      },
    });
    expect(probes.find((probe) => probe.id === 'runtime-quality-tooling')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'runtime-quality-tooling',
        fixKind: 'file-append',
        files: [path.join(projectPath, 'Makefile')],
        operation: {
          type: 'makefile-target',
          target: 'quality',
          command: 'gofmt -w .',
        },
      },
    });
    expect(probes.find((probe) => probe.id === 'runtime-security-tooling')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'runtime-security-tooling',
        fixKind: 'file-append',
        files: [path.join(projectPath, 'Makefile')],
        operation: {
          type: 'makefile-target',
          target: 'security',
          command: 'govulncheck ./...',
        },
      },
    });
  });

  it('accepts Python Makefile quality and security targets as runtime tooling evidence', async () => {
    const projectPath = await makeProject({
      'pyproject.toml': '[project]\nname = "api"\nversion = "0.1.0"\n',
      Makefile:
        '.PHONY: quality\nquality:\n\tpython -m ruff check .\n.PHONY: security\nsecurity:\n\tpython -m pip_audit\n',
      '.gitignore': '.env\n.env.*\n!.env.example\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'python',
      projectKind: 'backend',
      hasTests: true,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'runtime-quality-tooling')).toMatchObject({
      status: 'pass',
      repairCapability: undefined,
    });
    expect(probes.find((probe) => probe.id === 'runtime-security-tooling')).toMatchObject({
      status: 'pass',
      repairCapability: undefined,
    });
  });

  it('offers a typed env file copy repair when .env.example exists and .env is missing', async () => {
    const projectPath = await makeProject({
      '.env.example': 'APP_URL=http://localhost:3000\n',
      'package.json': {
        name: 'web',
        version: '1.0.0',
        scripts: {
          test: 'vitest run',
        },
      },
      'package-lock.json': '{}',
      '.gitignore': '.env\n.env.*\n!.env.example\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'frontend',
      packageJsonData: (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
        string,
        unknown
      >,
      hasTests: true,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'surface-env-contract')).toMatchObject({
      status: 'pass',
      repairCapability: {
        issueId: 'surface-env-contract',
        fixKind: 'file-copy',
        canAutoFix: true,
        canEditFiles: true,
        operation: {
          type: 'file-copy',
          sourcePath: path.join(projectPath, '.env.example'),
          path: path.join(projectPath, '.env'),
          overwrite: false,
        },
      },
    });
  });

  it('keeps repairable surface probes ready for Doctor taxonomy normalization', async () => {
    const projectPath = await makeProject({
      'package.json': {
        name: 'web',
        version: '1.0.0',
        scripts: {
          lint: 'next lint',
        },
      },
      Dockerfile: 'FROM node:20-alpine\nCOPY . .\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'frontend',
      packageJsonData: (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
        string,
        unknown
      >,
      hasTests: false,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'surface-dockerignore')).toMatchObject({
      repairCapability: {
        fixKind: 'file-create',
        canAutoFix: true,
        canEditFiles: true,
      },
    });
  });

  it('offers an executable gitignore secret-baseline repair when security hygiene is incomplete', async () => {
    const projectPath = await makeProject({
      'package.json': {
        name: 'web',
        version: '1.0.0',
        scripts: {
          audit: 'npm audit',
        },
      },
      'package-lock.json': '{}',
      '.gitignore': 'node_modules\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'frontend',
      packageJsonData: (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
        string,
        unknown
      >,
      hasTests: true,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'surface-security-hygiene')).toMatchObject({
      status: 'warn',
      repairCapability: {
        issueId: 'surface-security-hygiene',
        fixKind: 'file-append',
        status: 'available',
        operation: {
          type: 'file-append',
          lines: ['.env', '.env.*', '!.env.example'],
        },
      },
    });
  });

  it('offers a guarded non-force npm vulnerability repair for Node projects', async () => {
    const projectPath = await makeProject({
      'package.json': { name: 'web', version: '1.0.0' },
      'package-lock.json': '{}',
      '.gitignore': '.env\n.env.*\n!.env.example\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'frontend',
      packageJsonData: (await fsExtra.readJSON(path.join(projectPath, 'package.json'))) as Record<
        string,
        unknown
      >,
      hasTests: true,
      vulnerabilities: 2,
    });

    expect(probes.find((probe) => probe.id === 'surface-security-hygiene')).toMatchObject({
      status: 'fail',
      repairCapability: {
        status: 'available',
        fixKind: 'command',
        risk: 'guarded',
        canAutoFix: true,
        command: `cd "${projectPath}" && npm audit fix --audit-level=moderate`,
        transaction: {
          schemaVersion: 'workspai.doctor-dependency-repair-transaction.v1',
          kind: 'dependency-security',
          state: 'planned',
          projectPath,
          ecosystem: 'npm',
          requiredStages: ['reconcile', 'audit', 'test', 'build'],
          completion: {
            manifestLockConsistent: true,
            auditClean: true,
            declaredTestsPass: true,
            declaredBuildPass: true,
            canonicalVerificationRequired: true,
          },
        },
      },
    });
    expect(
      probes.find((probe) => probe.id === 'surface-security-hygiene')?.repairCapability?.command
    ).not.toContain('--force');
  });

  it('passes deterministic dependency and container hygiene when baselines exist', async () => {
    const projectPath = await makeProject({
      'go.mod': 'module example.com/api\n',
      'go.sum': '',
      Dockerfile: 'FROM golang:1.23-alpine\n',
      '.dockerignore': '.git\n.env\n',
      '.env.example': 'PORT=8080\n',
      '.gitignore': '.env\nbin/\n',
      'k8s/deployment.yaml':
        'readinessProbe: {}\nlivenessProbe: {}\nresources:\n  limits:\n    cpu: 500m\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'go',
      projectKind: 'backend',
      hasTests: true,
      hasDocker: true,
      vulnerabilities: 0,
    });

    expect(probes.find((probe) => probe.id === 'surface-dependency-contract')?.status).toBe('pass');
    expect(probes.find((probe) => probe.id === 'surface-dockerignore')?.status).toBe('pass');
    expect(probes.find((probe) => probe.id === 'surface-env-contract')?.status).toBe('pass');
    expect(probes.find((probe) => probe.id === 'surface-kubernetes-readiness')?.status).toBe(
      'pass'
    );
    expect(probes.find((probe) => probe.id === 'surface-test-contract')?.status).toBe('pass');
    expect(probes.find((probe) => probe.id === 'runtime-test-depth')?.status).toBe('warn');
  });

  it('recognizes real NestJS Jest and ESLint flat-config surfaces', async () => {
    const packageJsonData = {
      name: 'polyglot-api',
      scripts: {
        test: 'jest',
        'test:cov': 'jest --coverage',
        lint: 'eslint "{src,apps,libs,test}/**/*.ts"',
        format: 'prettier --write "src/**/*.ts"',
      },
      devDependencies: {
        '@nestjs/testing': '^11.0.0',
        eslint: '^9.0.0',
        jest: '^30.0.0',
      },
    };
    const projectPath = await makeProject({
      'package.json': packageJsonData,
      'package-lock.json': '{}',
      'jest.config.ts': 'export default { collectCoverage: true };\n',
      'eslint.config.cjs': 'module.exports = [];\n',
      'test/app.e2e-spec.ts': 'describe("app", () => undefined);\n',
      '.gitignore': '.env\n.env.*\n!.env.example\n',
    });

    const probes = await buildEnterpriseSurfaceProbes({
      projectPath,
      runtimeFamily: 'node',
      projectKind: 'backend',
      framework: 'NestJS',
      packageJsonData,
      hasTests: true,
      dependencyAudit: {
        schemaVersion: 'doctor-dependency-audit-v1',
        runtime: 'node',
        ecosystem: 'npm',
        tool: 'npm audit',
        status: 'clean',
        generatedAt: new Date().toISOString(),
        findingCount: 0,
        blockingFindingCount: 0,
        severityCounts: { low: 0, moderate: 0, high: 0, critical: 0, unknown: 0 },
        subjects: [],
        reason: 'npm audit completed without known findings.',
        limitations: [],
      },
    });

    expect(probes.find((probe) => probe.id === 'runtime-test-depth')?.status).toBe('pass');
    expect(probes.find((probe) => probe.id === 'runtime-quality-tooling')?.status).toBe('pass');
    expect(probes.find((probe) => probe.id === 'surface-security-hygiene')?.status).toBe('pass');
  });

  it.each([
    ['python', 'pip-audit'],
    ['go', 'govulncheck'],
    ['java', 'OWASP Dependency-Check'],
    ['rust', 'cargo-audit'],
    ['elixir', 'mix hex.audit'],
    ['clojure', 'organization-selected Clojure audit'],
    ['deno', 'deno audit'],
    ['bun', 'bun audit'],
    ['php', 'Composer audit'],
    ['ruby', 'bundler-audit'],
    ['dotnet', '.NET package audit'],
  ] as const)(
    'does not claim a clean %s security surface when %s evidence is unavailable',
    async (runtime, tool) => {
      const projectPath = await makeProject({
        '.gitignore': '.env\n.env.*\n!.env.example\n',
      });
      const probes = await buildEnterpriseSurfaceProbes({
        projectPath,
        runtimeFamily: runtime,
        projectKind: 'backend',
        hasTests: true,
        dependencyAudit: {
          schemaVersion: 'doctor-dependency-audit-v1',
          runtime,
          ecosystem: runtime,
          tool,
          status: runtime === 'java' || runtime === 'clojure' ? 'unsupported' : 'tool-unavailable',
          generatedAt: new Date().toISOString(),
          findingCount: null,
          blockingFindingCount: null,
          severityCounts: { low: 0, moderate: 0, high: 0, critical: 0, unknown: 0 },
          subjects: [],
          reason: `${tool} is unavailable.`,
          limitations: [],
        },
      });

      expect(probes.find((probe) => probe.id === 'surface-security-hygiene')).toMatchObject({
        status: 'warn',
        severity: 'warn',
        reason: expect.stringContaining('did not treat unavailable audit evidence as a clean'),
      });
    }
  );
});
