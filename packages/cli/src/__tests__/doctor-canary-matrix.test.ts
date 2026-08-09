import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import fsExtra from 'fs-extra';
import os from 'os';
import path from 'path';

vi.mock('execa');
const mockedExeca = vi.mocked(execa as any);

type CanaryFileMap = Record<string, string | object>;

type RemediationStep = {
  id: string;
  phase: string;
  order: number;
  dependsOn: string[];
  kind: string;
  originalCommand: string;
  projectName: string;
  diagnosisFindingId?: string;
  causalKey?: string;
  operation?: {
    type: string;
    path?: string;
    scriptName?: string;
    scriptValue?: string;
    target?: string;
    command?: string;
  };
  diffPreview: {
    available: boolean;
    format: string;
    hunks: string[];
  };
  studioStatus: {
    state: string;
  };
};

type DoctorPlanPayload = {
  project?: {
    diagnosis?: {
      schemaVersion: string;
      project: { runtimeFamily: string };
      coverage: {
        totalObservations: number;
        blockingFindings: number;
        unknownFindings: number;
      };
      findings: Array<{ proofs: unknown[]; causalKey: string }>;
    };
  };
  remediationPlan: {
    schemaVersion: string;
    policyProfile: string;
    totalSteps: number;
    executableSteps: number;
    steps: RemediationStep[];
  };
};

describe('doctor remediation canary matrix', () => {
  const tempDirs: string[] = [];
  let originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    mockedExeca.mockImplementation(async (cmd: string, args?: string[]) => {
      if (cmd === 'python3' || cmd === 'python') {
        if (args?.[0] === '--version') {
          return { stdout: 'Python 3.11.9', stderr: '', exitCode: 0 } as any;
        }
        if (args?.[0] === '-c') {
          return { stdout: '3.11.9', stderr: '', exitCode: 0 } as any;
        }
      }
      if (cmd === 'poetry') {
        return { stdout: 'Poetry version 2.3.2', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'pipx') {
        return { stdout: '1.8.0', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'rapidkit') {
        return { stdout: 'RapidKit Version: 0.41.3', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'go' && args?.[0] === 'version') {
        return { stdout: 'go version go1.22.0 linux/amd64', stderr: '', exitCode: 0 } as any;
      }
      if (cmd === 'npm' && args?.[0] === 'audit') {
        return {
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0 } },
          }),
          stderr: '',
          exitCode: 0,
        } as any;
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await fsExtra.remove(dir);
    }
    tempDirs.length = 0;
    vi.clearAllMocks();
  });

  async function makeWorkspaceProject(input: {
    name: string;
    projectJson: Record<string, unknown>;
    files: CanaryFileMap;
  }): Promise<string> {
    const workspaceRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-canary-'));
    tempDirs.push(workspaceRoot);
    await fsExtra.ensureDir(path.join(workspaceRoot, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspaceRoot, '.rapidkit-workspace'), {
      name: 'canary-workspace',
      version: '1.0',
    });
    return writeCanaryProject(workspaceRoot, input);
  }

  async function writeCanaryProject(
    workspaceRoot: string,
    input: {
      name: string;
      projectJson: Record<string, unknown>;
      files: CanaryFileMap;
    }
  ): Promise<string> {
    const projectPath = path.join(workspaceRoot, input.name);
    await fsExtra.ensureDir(path.join(projectPath, '.rapidkit'));
    await fsExtra.writeJSON(path.join(projectPath, '.rapidkit', 'project.json'), {
      name: input.name,
      ...input.projectJson,
    });

    for (const [relativePath, content] of Object.entries(input.files)) {
      const targetPath = path.join(projectPath, relativePath);
      await fsExtra.ensureDir(path.dirname(targetPath));
      if (typeof content === 'string') {
        await fsExtra.writeFile(targetPath, content, 'utf8');
      } else {
        await fsExtra.writeJSON(targetPath, content, { spaces: 2 });
      }
    }

    return projectPath;
  }

  async function makeWorkspaceWithProjects(
    projects: Array<{
      name: string;
      projectJson: Record<string, unknown>;
      files: CanaryFileMap;
    }>
  ): Promise<string> {
    const workspaceRoot = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'rapidkit-doctor-canary-'));
    tempDirs.push(workspaceRoot);
    await fsExtra.ensureDir(path.join(workspaceRoot, '.rapidkit'));
    await fsExtra.writeJSON(path.join(workspaceRoot, '.rapidkit-workspace'), {
      name: 'canary-workspace',
      version: '1.0',
    });
    for (const project of projects) {
      await writeCanaryProject(workspaceRoot, project);
    }
    return workspaceRoot;
  }

  async function runProjectPlan(projectPath: string): Promise<DoctorPlanPayload> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({
        project: true,
        plan: true,
        json: true,
        profile: 'enterprise-strict',
      });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      return JSON.parse(jsonLine as string) as DoctorPlanPayload;
    } finally {
      logSpy.mockRestore();
    }
  }

  async function runProjectApply(
    projectPath: string,
    env: Record<string, string | undefined> = {}
  ): Promise<
    DoctorPlanPayload & {
      fixResult?: {
        appliedFixes?: Array<{
          action: string;
          command: string;
          outcome: string;
          projectName: string;
        }>;
      };
    }
  > {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previousEnv = new Map<string, string | undefined>();
    try {
      for (const [key, value] of Object.entries(env)) {
        previousEnv.set(key, process.env[key]);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      process.chdir(projectPath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({
        project: true,
        apply: true,
        json: true,
        profile: 'enterprise-strict',
      });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      return JSON.parse(jsonLine as string);
    } finally {
      for (const [key, value] of previousEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      logSpy.mockRestore();
    }
  }

  async function runWorkspacePlan(workspacePath: string): Promise<DoctorPlanPayload> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      process.chdir(workspacePath);
      const { runDoctor } = await import('../doctor.js');
      await runDoctor({
        workspace: true,
        plan: true,
        json: true,
        profile: 'enterprise-strict',
      });
      const jsonLine = logSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.trim().startsWith('{')) as string | undefined;
      expect(jsonLine).toBeDefined();
      return JSON.parse(jsonLine as string) as DoctorPlanPayload;
    } finally {
      logSpy.mockRestore();
    }
  }

  function expectOrderedPlan(payload: DoctorPlanPayload): RemediationStep[] {
    expect(payload.remediationPlan).toEqual(
      expect.objectContaining({
        schemaVersion: 'doctor-remediation-plan-v2',
        policyProfile: 'enterprise-strict',
        totalSteps: expect.any(Number),
        executableSteps: expect.any(Number),
      })
    );

    const steps = payload.remediationPlan.steps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((step) => step.order)).toEqual(steps.map((_, index) => index + 1));
    for (const step of steps) {
      expect(step.id).toEqual(expect.any(String));
      expect(step.dependsOn).toEqual(expect.any(Array));
      expect(step.studioStatus.state).toMatch(/^(ready|review-required|blocked|guidance-only)$/);
    }
    return steps;
  }

  const canaries: Array<{
    name: string;
    projectJson: Record<string, unknown>;
    files: CanaryFileMap;
    expectedDependencyCommand: string;
    expectedCommandOperation: 'package-json-script' | 'makefile-target';
  }> = [
    {
      name: 'next-web',
      projectJson: {
        kit_name: 'frontend.nextjs',
        framework: 'nextjs',
        runtime: 'node',
      },
      files: {
        'package.json': {
          name: 'next-web',
          version: '1.0.0',
          scripts: {
            dev: 'next dev',
            build: 'next build',
            lint: 'next lint',
          },
          dependencies: {
            next: '15.0.0',
            react: '19.0.0',
          },
        },
        'tsconfig.json': { compilerOptions: { strict: true } },
        'next.config.ts': 'export default {};\n',
        'eslint.config.mjs': 'export default [];\n',
        'app/page.tsx': 'export default function Page() { return null; }\n',
      },
      expectedDependencyCommand: 'npm install',
      expectedCommandOperation: 'package-json-script',
    },
    {
      name: 'python-api',
      projectJson: {
        kit_name: 'python.generic',
        framework: 'python',
        runtime: 'python',
      },
      files: {
        'pyproject.toml': '[tool.poetry]\nname = "python-api"\nversion = "0.1.0"\n',
        'src/python_api/__init__.py': '',
      },
      expectedDependencyCommand: 'poetry install --no-root',
      expectedCommandOperation: 'makefile-target',
    },
    {
      name: 'go-api',
      projectJson: {
        kit_name: 'gofiber.standard',
        framework: 'go',
        runtime: 'go',
      },
      files: {
        'go.mod': 'module example.com/go-api\n\ngo 1.22\n',
        'main.go': 'package main\n\nfunc main() {}\n',
      },
      expectedDependencyCommand: 'go mod tidy',
      expectedCommandOperation: 'makefile-target',
    },
    {
      name: 'rust-api',
      projectJson: {
        kit_name: 'rust.generic',
        framework: 'rust',
        runtime: 'rust',
      },
      files: {
        'Cargo.toml': '[package]\nname = "rust-api"\nversion = "0.1.0"\nedition = "2021"\n',
        'src/main.rs': 'fn main() {}\n',
      },
      expectedDependencyCommand: 'cargo fetch',
      expectedCommandOperation: 'makefile-target',
    },
    {
      name: 'php-api',
      projectJson: {
        kit_name: 'php.generic',
        framework: 'php',
        runtime: 'php',
      },
      files: {
        'composer.json': {
          name: 'rapidkit/php-api',
          require: {},
        },
        'src/index.php': '<?php\n',
      },
      expectedDependencyCommand: 'composer install',
      expectedCommandOperation: 'makefile-target',
    },
    {
      name: 'ruby-api',
      projectJson: {
        kit_name: 'ruby.generic',
        framework: 'ruby',
        runtime: 'ruby',
      },
      files: {
        Gemfile: 'source "https://rubygems.org"\n',
        'app.rb': 'puts "ok"\n',
      },
      expectedDependencyCommand: 'bundle install',
      expectedCommandOperation: 'makefile-target',
    },
    {
      name: 'dotnet-api',
      projectJson: {
        kit_name: 'dotnet.webapi.clean',
        framework: 'dotnet',
        runtime: 'dotnet',
      },
      files: {
        'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n',
        'Program.cs': 'Console.WriteLine("ok");\n',
      },
      expectedDependencyCommand: 'dotnet restore',
      expectedCommandOperation: 'makefile-target',
    },
  ];

  for (const canary of canaries) {
    it(`emits ordered enterprise Studio remediation for ${canary.name}`, async () => {
      const projectPath = await makeWorkspaceProject(canary);
      const payload = await runProjectPlan(projectPath);
      const steps = expectOrderedPlan(payload);
      const dependencySteps = steps.filter((step) => step.phase === 'dependency-baseline');
      const dependencyStep = dependencySteps[0];
      const commandStep = steps.find((step) => step.phase === 'command-contract');

      expect(dependencyStep, `${canary.name} dependency-baseline step`).toBeDefined();
      expect(
        dependencySteps,
        `${canary.name} should not duplicate dependency baseline`
      ).toHaveLength(1);
      expect(dependencyStep?.originalCommand).toContain(canary.expectedDependencyCommand);
      expect(dependencyStep?.diagnosisFindingId).toEqual(expect.any(String));
      expect(dependencyStep?.causalKey).toEqual(expect.any(String));
      expect(commandStep, `${canary.name} command-contract step`).toBeDefined();
      expect(commandStep?.operation?.type).toBe(canary.expectedCommandOperation);
      expect(commandStep?.diagnosisFindingId).toEqual(expect.any(String));
      expect(commandStep?.causalKey).toEqual(expect.any(String));
      expect(commandStep?.diffPreview.available).toBe(true);
      expect(commandStep?.diffPreview.hunks.length).toBeGreaterThan(0);
      expect(dependencyStep?.order).toBeLessThan(commandStep?.order ?? Number.MAX_SAFE_INTEGER);
      expect(commandStep?.dependsOn).toContain(dependencyStep?.id);
      expect(payload.project?.diagnosis).toMatchObject({
        schemaVersion: 'workspai.doctor-diagnosis.v1',
        project: { runtimeFamily: canary.projectJson.runtime },
        coverage: {
          totalObservations: expect.any(Number),
          blockingFindings: expect.any(Number),
          unknownFindings: expect.any(Number),
        },
      });
      expect(
        payload.project?.diagnosis?.findings.every((finding) => finding.proofs.length > 0)
      ).toBe(true);
      expect(
        payload.project?.diagnosis?.findings.every((finding) => finding.causalKey.length > 0)
      ).toBe(true);
    });
  }

  it('keeps guarded dependency fixes as guidance by default while applying safe file edits', async () => {
    const nextCanary = canaries.find((canary) => canary.name === 'next-web');
    expect(nextCanary).toBeDefined();
    const projectPath = await makeWorkspaceProject(nextCanary!);
    const payload = await runProjectApply(projectPath);
    const appliedFixes = payload.fixResult?.appliedFixes ?? [];
    const dependencyFixIndex = appliedFixes.findIndex((fix) => fix.action === 'dependency-sync');
    const scriptFixIndex = appliedFixes.findIndex((fix) => fix.action === 'package-json-script');

    expect(dependencyFixIndex).toBeGreaterThanOrEqual(0);
    expect(scriptFixIndex).toBeGreaterThanOrEqual(0);
    expect(dependencyFixIndex).toBeLessThan(scriptFixIndex);
    expect(appliedFixes[dependencyFixIndex]).toEqual(
      expect.objectContaining({
        outcome: 'guidance',
        command: expect.stringContaining('npm install'),
        projectName: 'next-web',
      })
    );
    expect(appliedFixes[scriptFixIndex]).toEqual(
      expect.objectContaining({
        outcome: 'applied',
        action: 'package-json-script',
        projectName: 'next-web',
      })
    );
  });

  it('applies guarded dependency fixes after explicit operator opt-in', async () => {
    const nextCanary = canaries.find((canary) => canary.name === 'next-web');
    expect(nextCanary).toBeDefined();
    const projectPath = await makeWorkspaceProject(nextCanary!);
    const payload = await runProjectApply(projectPath, {
      RAPIDKIT_DOCTOR_FIX_ALLOW_GUARDED_COMMANDS: '1',
    });
    const appliedFixes = payload.fixResult?.appliedFixes ?? [];
    const dependencyFixIndex = appliedFixes.findIndex((fix) => fix.action === 'dependency-sync');
    const scriptFixIndex = appliedFixes.findIndex((fix) => fix.action === 'package-json-script');

    expect(dependencyFixIndex).toBeGreaterThanOrEqual(0);
    expect(scriptFixIndex).toBeGreaterThanOrEqual(0);
    expect(dependencyFixIndex).toBeLessThan(scriptFixIndex);
    expect(appliedFixes[dependencyFixIndex]).toEqual(
      expect.objectContaining({
        outcome: 'applied',
        command: expect.stringContaining('npm install'),
        projectName: 'next-web',
      })
    );

    const packageJson = await fsExtra.readJSON(path.join(projectPath, 'package.json'));
    expect(packageJson.scripts.test).toBe('npm run lint');

    const planArtifact = await fsExtra.readJSON(
      path.join(projectPath, '.workspai', 'reports', 'doctor-remediation-plan-last-run.json')
    );
    const fixArtifact = await fsExtra.readJSON(
      path.join(projectPath, '.workspai', 'reports', 'doctor-fix-result-last-run.json')
    );
    const history = await fsExtra.readJSON(
      path.join(projectPath, '.workspai', 'reports', 'workspace-intelligence-history.json')
    );

    expect(planArtifact.schemaVersion).toBe('doctor-remediation-plan-v2');
    expect(fixArtifact.schemaVersion).toBe('rapidkit-doctor-fix-result-v1');
    expect(Date.parse(fixArtifact.generatedAt)).not.toBeNaN();
    expect(history.entries.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'doctor-fix',
        scope: 'project',
        applied: expect.any(Number),
      })
    );
  });

  it('emits an ordered multi-project workspace remediation plan for dashboard cards', async () => {
    const workspacePath = await makeWorkspaceWithProjects([
      canaries.find((canary) => canary.name === 'next-web')!,
      canaries.find((canary) => canary.name === 'go-api')!,
    ]);
    const payload = await runWorkspacePlan(workspacePath);
    const steps = expectOrderedPlan(payload);
    const projectNames = new Set(steps.map((step) => step.projectName));

    expect(projectNames.has('next-web')).toBe(true);
    expect(projectNames.has('go-api')).toBe(true);

    for (const projectName of ['next-web', 'go-api']) {
      const projectSteps = steps.filter((step) => step.projectName === projectName);
      const dependencyStep = projectSteps.find((step) => step.phase === 'dependency-baseline');
      const commandStep = projectSteps.find((step) => step.phase === 'command-contract');

      expect(dependencyStep, `${projectName} dependency-baseline step`).toBeDefined();
      expect(commandStep, `${projectName} command-contract step`).toBeDefined();
      expect(dependencyStep?.order).toBeLessThan(commandStep?.order ?? Number.MAX_SAFE_INTEGER);
      expect(commandStep?.dependsOn).toContain(dependencyStep?.id);
    }
  });
});
