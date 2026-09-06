import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  digestBuiltinAgentFrameworkManifest,
  managedFile,
  microsoftAgentFrameworkDotnetAdapter,
  microsoftAgentFrameworkPythonAdapter,
  type AgentFrameworkAdapter,
  type AgentFrameworkManagedFile,
} from '../src/agent-frameworks/index.js';
import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH,
  AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
  validateAgentFrameworkAdapterManifest,
  validateAgentFrameworkConformanceReport,
  type AgentFrameworkConformanceCheckId,
  type AgentFrameworkConformanceReport,
} from '../src/contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../src/utils/json-schema-contract.js';

type Runtime = 'python' | 'dotnet';
type CommandResult = { stdout: string; stderr: string };
type Check = AgentFrameworkConformanceReport['checks'][number];

const INSTANCE_NAME = 'Conformance Agent';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectedRuntime(): Runtime {
  const value = argument('--runtime');
  if (value !== 'python' && value !== 'dotnet') {
    throw new Error(
      'Usage: --runtime <python|dotnet> [--report-dir <relative-or-absolute-directory>]'
    );
  }
  return value;
}

function selectedReportDirectory(): string {
  return path.resolve(argument('--report-dir') ?? 'test-results/agent-framework-conformance');
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function portablePath(value: string): string {
  return value.split(path.sep).join('/');
}

function sanitized(value: string, isolatedRoot: string, reportRoot: string): string {
  const replacements = [
    [isolatedRoot, '<isolated-project>'],
    [reportRoot, '<conformance-artifact>'],
    [process.cwd(), '<cli-root>'],
    [os.homedir(), '<home>'],
    [os.tmpdir(), '<temporary-root>'],
  ] as const;
  return replacements
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [source, replacement]) => result.split(source).join(replacement), value);
}

function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            `${command} failed with ${signal ? `signal ${signal}` : `exit ${String(code)}`}\n${stderr || stdout}`
          )
        );
      }
    });
  });
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function materialize(files: AgentFrameworkManagedFile[], root: string): Promise<void> {
  for (const file of files) {
    const destination = path.resolve(root, file.path);
    if (!contained(root, destination)) throw new Error(`Rendered path escaped root: ${file.path}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, { encoding: 'utf8', flag: 'wx' });
  }
  const contextPath = path.join(root, '.workspai', 'reports', 'project-context-agent.json');
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  await fs.writeFile(
    contextPath,
    `${JSON.stringify({ schemaVersion: 'workspai.project-context-agent.v1', scope: 'conformance' })}\n`,
    'utf8'
  );
}

async function cliVersion(): Promise<string> {
  const packageJsonPath = path.resolve(import.meta.dirname, '..', 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    version?: unknown;
  };
  assertCondition(typeof packageJson.version === 'string', 'CLI package version is unavailable.');
  return packageJson.version;
}

async function authoredDetectionFixture(runtime: Runtime, root: string): Promise<void> {
  if (runtime === 'python') {
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      '[project]\nname = "conformance"\ndependencies = ["agent-framework-core==1.17.0"]\n',
      'utf8'
    );
    return;
  }
  const projectPath = path.join(root, 'src', 'Agent', 'Agent.csproj');
  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(
    projectPath,
    '<Project><ItemGroup><PackageReference Include="Microsoft.Agents.AI.Foundry" Version="1.20.0-preview.260831.1" /></ItemGroup></Project>\n',
    'utf8'
  );
}

async function negativeDetectionFixture(runtime: Runtime, root: string): Promise<void> {
  if (runtime === 'python') {
    await fs.writeFile(path.join(root, 'requirements.txt'), 'autogen-agentchat==0.7.5\n', 'utf8');
    return;
  }
  await fs.writeFile(
    path.join(root, 'Unrelated.csproj'),
    '<Project><ItemGroup><PackageReference Include="Microsoft.Extensions.AI" Version="9.0.0" /></ItemGroup></Project>\n',
    'utf8'
  );
}

function selectedAdapter(runtime: Runtime): AgentFrameworkAdapter {
  return runtime === 'python'
    ? microsoftAgentFrameworkPythonAdapter
    : microsoftAgentFrameworkDotnetAdapter;
}

async function main(): Promise<void> {
  const runtime = selectedRuntime();
  const reportRoot = selectedReportDirectory();
  const adapter = selectedAdapter(runtime);
  const platform = process.platform;
  assertCondition(
    platform === 'linux' || platform === 'darwin' || platform === 'win32',
    `Unsupported conformance platform: ${platform}`
  );
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), `workspai-maf-${runtime}-`));
  const evidenceDirectory = portablePath(
    path.join('evidence', adapter.manifest.adapter.id, platform)
  );
  const reportPath = path.join(reportRoot, `${adapter.manifest.adapter.id}-${platform}.json`);
  const checks: Check[] = [];
  let runtimeVersion = 'unavailable';
  let installedFrameworkPackages: Record<string, string> = {};

  const record = async (
    id: AgentFrameworkConformanceCheckId,
    execute: () => Promise<unknown> | unknown
  ): Promise<void> => {
    const started = performance.now();
    let status: Check['status'] = 'passed';
    let summary = `${id} passed.`;
    let details: unknown = { outcome: 'passed' };
    try {
      details = await execute();
    } catch (error) {
      status = 'failed';
      summary = sanitized(
        error instanceof Error ? error.message : String(error),
        isolatedRoot,
        reportRoot
      )
        .split('\n')[0]
        .slice(0, 500);
      details = {
        outcome: 'failed',
        error: sanitized(
          error instanceof Error ? (error.stack ?? error.message) : String(error),
          isolatedRoot,
          reportRoot
        ),
      };
    }
    const evidencePath = portablePath(path.join(evidenceDirectory, `${id}.json`));
    await writeJson(path.join(reportRoot, evidencePath), {
      checkId: id,
      adapterId: adapter.manifest.adapter.id,
      platform,
      runtime,
      details,
    });
    checks.push({
      id,
      status,
      required: true,
      summary,
      evidencePaths: [evidencePath],
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
  };

  try {
    const renderInput = { projectRoot: isolatedRoot, instanceName: INSTANCE_NAME };
    const rendered = adapter.render(renderInput);
    const context = adapter.context(renderInput);
    const authoredRoot = path.join(isolatedRoot, 'authored-detection');
    const negativeRoot = path.join(isolatedRoot, 'negative-detection');
    const mutationRoot = path.join(isolatedRoot, 'pure-operation');
    const generatedRoot = path.join(isolatedRoot, 'generated-project');
    await Promise.all(
      [authoredRoot, negativeRoot, mutationRoot, generatedRoot].map((directory) =>
        fs.mkdir(directory, { recursive: true })
      )
    );
    await authoredDetectionFixture(runtime, authoredRoot);
    await negativeDetectionFixture(runtime, negativeRoot);

    await record('manifest-schema', () => {
      assertJsonSchemaContract(
        adapter.manifest,
        AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
        'Adapter manifest'
      );
      const violations = validateAgentFrameworkAdapterManifest(adapter.manifest);
      assertCondition(violations.length === 0, violations.join('; '));
      return { schemaVersion: adapter.manifest.schemaVersion, semanticViolations: violations };
    });

    await record('protocol-version', () => {
      assertCondition(
        adapter.manifest.protocolVersion === AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
        'Adapter protocol does not match the CLI protocol.'
      );
      return { protocolVersion: adapter.manifest.protocolVersion };
    });

    await record('capability-truth', () => {
      const unsupportedWithEvidence = Object.entries(adapter.manifest.capabilities)
        .filter(
          ([, capability]) => capability.support === 'unsupported' && capability.evidence.length > 0
        )
        .map(([id]) => id);
      const supportedWithoutEvidence = Object.entries(adapter.manifest.capabilities)
        .filter(
          ([, capability]) =>
            capability.support !== 'unsupported' && capability.evidence.length === 0
        )
        .map(([id]) => id);
      const conditionalWithoutPrerequisites = Object.entries(adapter.manifest.capabilities)
        .filter(
          ([, capability]) =>
            capability.support === 'conditional' && capability.prerequisites.length === 0
        )
        .map(([id]) => id);
      assertCondition(
        unsupportedWithEvidence.length === 0,
        'Unsupported capabilities claim evidence.'
      );
      assertCondition(
        supportedWithoutEvidence.length === 0,
        'Supported capabilities lack evidence.'
      );
      assertCondition(
        conditionalWithoutPrerequisites.length === 0,
        'Conditional capabilities lack prerequisites.'
      );
      return {
        declarations: Object.fromEntries(
          Object.entries(adapter.manifest.capabilities).map(([id, value]) => [id, value.support])
        ),
        supportedWithoutEvidence,
        conditionalWithoutPrerequisites,
      };
    });

    await record('detection-positive', async () => {
      const result = await adapter.detect(authoredRoot);
      assertCondition(result.detected, 'Authored framework dependency was not detected.');
      assertCondition(
        result.matchedAuthoredMarkers >= 1,
        'Detection did not retain authored proof.'
      );
      return result;
    });

    await record('detection-negative', async () => {
      const result = await adapter.detect(negativeRoot);
      assertCondition(!result.detected, 'An unrelated dependency produced a false positive.');
      return result;
    });

    await record('scaffold-plan-safety', () => {
      const plan = adapter.plan('scaffold', renderInput);
      assertJsonSchemaContract(plan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'Scaffold plan');
      assertCondition(plan.status === 'planned', `Unexpected scaffold status: ${plan.status}`);
      assertCondition(plan.blockers.length === 0, 'Scaffold plan contains blockers.');
      assertCondition(
        plan.changes.length === rendered.files.length,
        'Scaffold plan lost managed files.'
      );
      assertCondition(
        plan.files.length === rendered.files.length &&
          plan.files.every((file) =>
            rendered.files.some(
              (renderedFile) =>
                renderedFile.path === file.path &&
                renderedFile.sha256 === file.sha256 &&
                renderedFile.overwrite === file.overwrite
            )
          ),
        'Scaffold plan is not bound to exact rendered content digests.'
      );
      return plan;
    });

    await record('attach-plan-safety', () => {
      const plan = adapter.plan('attach', renderInput);
      assertJsonSchemaContract(plan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'Attach plan');
      assertCondition(plan.status === 'planned', `Unexpected attach status: ${plan.status}`);
      assertCondition(
        plan.changes.some((change) => change.kind === 'dependency-recommendation'),
        'Attach plan did not isolate dependency advice.'
      );
      return plan;
    });

    await record('managed-file-ownership', () => {
      const file = rendered.files[0];
      assertCondition(file !== undefined, 'Adapter rendered no managed files.');
      const existingFiles = new Map([[file.path, file.content]]);
      const withoutReceipt = adapter.render({ ...renderInput, existingFiles });
      assertCondition(
        withoutReceipt.conflicts.some((conflict) => conflict.reason === 'ownership-unproven'),
        'Managed marker alone was incorrectly accepted as ownership proof.'
      );
      const withReceipt = adapter.render({
        ...renderInput,
        existingFiles,
        ownershipLedger: new Map([[file.path, file.sha256]]),
      });
      assertCondition(
        withReceipt.conflicts.length === 0,
        'A valid ownership receipt was rejected.'
      );
      assertCondition(
        !withReceipt.files.some((candidate) => candidate.path === file.path),
        'An unchanged owned file was needlessly replaced.'
      );
      return { path: file.path, digest: file.sha256, markerRequired: true, receiptRequired: true };
    });

    await record('user-file-preservation', () => {
      const file = rendered.files[0];
      assertCondition(file !== undefined, 'Adapter rendered no managed files.');
      const result = adapter.render({
        ...renderInput,
        existingFiles: new Map([[file.path, '// user-authored content\n']]),
      });
      assertCondition(
        result.conflicts.some((conflict) => conflict.reason === 'user-authored-file-exists'),
        'User-authored content was not protected.'
      );
      assertCondition(
        !result.files.some((candidate) => candidate.path === file.path),
        'User file would be overwritten.'
      );
      return result;
    });

    await record('path-containment', () => {
      assertCondition(
        rendered.files.every((file) => {
          const destination = path.resolve(generatedRoot, file.path);
          return contained(generatedRoot, destination) && !path.isAbsolute(file.path);
        }),
        'A rendered path escapes the project root.'
      );
      let rejected = false;
      try {
        managedFile('../escape.txt', '# Generated and managed by Workspai\n');
      } catch {
        rejected = true;
      }
      assertCondition(rejected, 'The managed-file boundary accepted traversal.');
      return { paths: rendered.files.map((file) => file.path), traversalRejected: rejected };
    });

    await record('secret-non-persistence', () => {
      const literalSecret = /(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"'$][^"']+/i;
      assertCondition(
        rendered.files.every((file) => !literalSecret.test(file.content)),
        'Rendered output contains a literal credential.'
      );
      assertCondition(
        adapter.manifest.security.secrets === 'references-only',
        'Manifest does not enforce secret references.'
      );
      return {
        filesInspected: rendered.files.map((file) => file.path),
        requiredEnvironment: context.requiredEnvironment,
      };
    });

    await record('context-generation-binding', () => {
      const entrypoint = rendered.files.find((file) => file.path === context.entrypoint);
      assertCondition(entrypoint, 'Declared entrypoint was not rendered.');
      assertCondition(
        entrypoint.content.includes('.workspai/reports/project-context-agent.json'),
        'Entrypoint is not bound to canonical agent context.'
      );
      assertCondition(
        entrypoint.content.includes('131_072'),
        'Entrypoint does not enforce the 128 KiB context boundary.'
      );
      return {
        entrypoint: context.entrypoint,
        contextInputs: adapter.manifest.bindings.contextInputs,
        byteLimit: 131072,
      };
    });

    await record('mutation-gateway', async () => {
      adapter.render({ projectRoot: mutationRoot, instanceName: INSTANCE_NAME });
      adapter.plan('attach', { projectRoot: mutationRoot, instanceName: INSTANCE_NAME });
      assertCondition(
        (await fs.readdir(mutationRoot)).length === 0,
        'Plan or render operation performed an undeclared filesystem mutation.'
      );
      assertCondition(
        adapter.manifest.ownership.mutationAdmission === 'workspai-pcc',
        'PCC is not the declared mutation gateway.'
      );
      return { mutationAdmission: adapter.manifest.ownership.mutationAdmission, directWrites: 0 };
    });

    await record('verification-binding', async () => {
      assertCondition(
        rendered.conflicts.length === 0,
        'Render conflicts block runtime verification.'
      );
      await materialize(rendered.files, generatedRoot);
      const validation = adapter.validate(renderInput);
      assertCondition(validation.status === 'passed', 'Structural adapter validation failed.');
      if (runtime === 'python') {
        await run(
          'uv',
          ['sync', '--python', '3.10.21', '--project', path.dirname(context.dependencyManifest)],
          generatedRoot
        );
        const version = await run(
          'uv',
          ['run', '--project', path.dirname(context.dependencyManifest), 'python', '--version'],
          generatedRoot
        );
        runtimeVersion = (version.stdout || version.stderr).trim().replace(/^Python\s+/i, '');
        const packages = await run(
          'uv',
          [
            'run',
            '--project',
            path.dirname(context.dependencyManifest),
            'python',
            '-c',
            "import importlib.metadata as m; print(m.version('agent-framework-core')); print(m.version('agent-framework-foundry'))",
          ],
          generatedRoot
        );
        const [coreVersion, foundryVersion] = packages.stdout.trim().split(/\r?\n/);
        assertCondition(
          coreVersion === adapter.manifest.framework.testedVersions[0],
          `Installed agent-framework-core ${coreVersion ?? 'unknown'} does not match the tested baseline.`
        );
        assertCondition(foundryVersion === '1.12.0', 'Installed Foundry package is not 1.12.0.');
        installedFrameworkPackages = {
          'agent-framework-core': coreVersion,
          'agent-framework-foundry': foundryVersion,
        };
        await run(
          'uv',
          [
            'run',
            '--project',
            path.dirname(context.dependencyManifest),
            'python',
            '-m',
            'py_compile',
            context.entrypoint,
          ],
          generatedRoot
        );
        await run(
          'uv',
          [
            'run',
            '--project',
            path.dirname(context.dependencyManifest),
            'python',
            '-c',
            'from agent_framework import Agent; from agent_framework.foundry import FoundryChatClient',
          ],
          generatedRoot
        );
      } else {
        const version = await run('dotnet', ['--version'], generatedRoot);
        runtimeVersion = version.stdout.trim();
        await run(
          'dotnet',
          ['restore', context.dependencyManifest, '--use-lock-file'],
          generatedRoot
        );
        const lockPath = path.resolve(
          generatedRoot,
          path.dirname(context.dependencyManifest),
          'packages.lock.json'
        );
        const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
          dependencies?: Record<string, Record<string, { resolved?: unknown }>>;
        };
        const targetFramework = lock.dependencies?.['net8.0'];
        assertCondition(targetFramework, 'NuGet lock file does not contain the net8.0 target.');
        const frameworkVersion = targetFramework['Microsoft.Agents.AI']?.resolved;
        const foundryVersion = targetFramework['Microsoft.Agents.AI.Foundry']?.resolved;
        assertCondition(
          frameworkVersion === adapter.manifest.framework.testedVersions[0],
          `Installed Microsoft.Agents.AI ${String(frameworkVersion)} does not match the tested baseline.`
        );
        assertCondition(
          foundryVersion === '1.20.0-preview.260831.1',
          `Installed Microsoft.Agents.AI.Foundry ${String(foundryVersion)} does not match the tested integration baseline.`
        );
        installedFrameworkPackages = {
          'Microsoft.Agents.AI': frameworkVersion,
          'Microsoft.Agents.AI.Foundry': foundryVersion,
        };
        await run('dotnet', ['build', context.dependencyManifest, '--no-restore'], generatedRoot);
      }
      assertCondition(runtimeVersion.length > 0, 'Runtime version was not captured.');
      return {
        runtimeVersion,
        frameworkVersion: adapter.manifest.framework.testedVersions[0],
        installedFrameworkPackages,
        verificationCommands: context.verificationCommands,
        providerInvocationPerformed: false,
      };
    });

    await record('failure-isolation', () => {
      const file = rendered.files[0];
      assertCondition(file !== undefined, 'Adapter rendered no managed files.');
      const result = adapter.render({
        ...renderInput,
        existingFiles: new Map([[file.path, '// user-authored content\n']]),
      });
      assertCondition(result.conflicts.length === 1, 'One conflict was not isolated precisely.');
      assertCondition(
        result.files.length === rendered.files.length - 1,
        'One conflict suppressed unrelated safe render output.'
      );
      return {
        isolatedConflict: result.conflicts[0],
        unaffectedFiles: result.files.map((item) => item.path),
      };
    });

    await record('idempotency', () => {
      const second = adapter.render(renderInput);
      assertCondition(
        JSON.stringify(rendered) === JSON.stringify(second),
        'Repeated rendering changed output.'
      );
      const plan = adapter.plan('scaffold', {
        ...renderInput,
        existingFiles: new Map(rendered.files.map((file) => [file.path, file.content])),
        ownershipLedger: new Map(rendered.files.map((file) => [file.path, file.sha256])),
      });
      assertJsonSchemaContract(plan, AGENT_FRAMEWORK_CHANGE_PLAN_CONTRACT_PATH, 'Idempotent plan');
      assertCondition(
        plan.status === 'no-op',
        'An identical admitted render did not produce no-op.'
      );
      return { deterministic: true, repeatStatus: plan.status, fileCount: rendered.files.length };
    });

    await record('offline-posture', () => {
      assertCondition(
        adapter.manifest.security.network === 'deny-unless-explicitly-granted',
        'Network defaults are not deny-first.'
      );
      assertCondition(
        adapter.manifest.security.generatedCodeExecution === 'disabled-unless-explicitly-granted',
        'Generated code execution is not deny-first.'
      );
      return {
        networkDefault: adapter.manifest.security.network,
        generatedCodeExecutionDefault: adapter.manifest.security.generatedCodeExecution,
        planningAndRenderingRequireRuntimeExecution: false,
        runtimeVerificationNetworkWasExplicitlyGrantedByCiLane: true,
      };
    });

    await record('cross-platform-paths', () => {
      const paths = [
        ...rendered.files.map((file) => file.path),
        context.entrypoint,
        context.dependencyManifest,
      ];
      assertCondition(
        paths.every((value) => !value.includes('\\')),
        'Portable output contains backslashes.'
      );
      assertCondition(
        paths.every((value) => !path.isAbsolute(value)),
        'Portable output contains absolute paths.'
      );
      assertCondition(
        paths.every((value) => !/(^|\/)\.\.(\/|$)/.test(value)),
        'Portable output contains parent traversal.'
      );
      return { paths };
    });
  } finally {
    await fs.rm(isolatedRoot, { recursive: true, force: true });
  }

  assertCondition(
    checks.map((check) => check.id).join('\0') === AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.join('\0'),
    'Conformance runner did not execute the canonical check inventory in order.'
  );
  const failedChecks = checks.filter((check) => check.status === 'failed');
  const summary = {
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: failedChecks.length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
    required: checks.filter((check) => check.required).length,
  };
  const report: AgentFrameworkConformanceReport = {
    schemaVersion: AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    generatedAt: new Date().toISOString(),
    adapter: {
      id: adapter.manifest.adapter.id,
      version: adapter.manifest.adapter.version,
      manifestSha256: digestBuiltinAgentFrameworkManifest(adapter),
    },
    frameworkVersion: adapter.manifest.framework.testedVersions[0],
    cliVersion: await cliVersion(),
    environment: { platform, architecture: process.arch, runtime, runtimeVersion },
    checks,
    summary,
    verdict: failedChecks.length === 0 ? 'admitted' : 'blocked',
    blockers: failedChecks.map((check) => `${check.id}: ${check.summary}`),
    limitations: [
      'Conformance compiles and imports the pinned adapter baseline without invoking a model provider.',
      'Credential-backed Foundry execution requires a separate explicit integration environment and is not admission evidence.',
    ],
  };
  assertJsonSchemaContract(
    report,
    AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
    'Agent framework conformance report'
  );
  const reportViolations = validateAgentFrameworkConformanceReport(report);
  assertCondition(reportViolations.length === 0, reportViolations.join('; '));
  await writeJson(reportPath, report);

  const status = report.verdict === 'admitted' ? 'PASS' : 'FAIL';
  process.stdout.write(
    `${status} ${adapter.manifest.adapter.id} ${report.frameworkVersion} on ${platform}; report: ${reportPath}\n`
  );
  if (report.verdict !== 'admitted') process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
