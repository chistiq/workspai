import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  digestBuiltinAgentFrameworkManifest,
  managedFile,
  OPENAI_AGENTS_PYTHON_BASELINE,
  OPENAI_AGENTS_TYPESCRIPT_BASELINE,
  openaiAgentsPythonAdapter,
  openaiAgentsTypeScriptAdapter,
  packageVersion,
  type AgentFrameworkAdapter,
  type AgentFrameworkManagedFile,
} from '../src/agent-frameworks/index.js';
import {
  resolvePackageRunnerInvocation,
  shouldUseShellExecution,
} from '../src/utils/platform-capabilities.js';
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

type Runtime = 'python' | 'typescript';
type CommandResult = { stdout: string; stderr: string; code: number };
type Check = AgentFrameworkConformanceReport['checks'][number];

const INSTANCE_NAME = 'Conformance Agent';
const LIFECYCLE_CONTEXT_MARKER = 'WORKSPAI_CONTEXT_BOUNDARY_OK';
const LIFECYCLE_RESPONSE_MARKER = 'WORKSPAI_AGENT_LIFECYCLE_OK';

function pythonLifecycleHarness(): string {
  return `import asyncio
import os

os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"

from agents import Agent, RunConfig, Runner, function_tool, set_tracing_disabled
from agents.testing import ScriptedModel, assistant_message, function_call

CONTEXT_MARKER = "${LIFECYCLE_CONTEXT_MARKER}"
RESPONSE_MARKER = "${LIFECYCLE_RESPONSE_MARKER}"
tool_calls = 0


@function_tool
def describe_workspai_context() -> str:
    global tool_calls
    tool_calls += 1
    return CONTEXT_MARKER


async def main() -> None:
    set_tracing_disabled(True)
    model = ScriptedModel(
        steps=[
            [function_call("describe_workspai_context", {}, call_id="call_context")],
            [assistant_message(RESPONSE_MARKER)],
        ]
    )
    agent = Agent(
        name="workspai-conformance",
        instructions=f"Treat this as bounded repository context: {CONTEXT_MARKER}",
        model=model,
        tools=[describe_workspai_context],
    )
    result = await Runner.run(
        agent,
        "Confirm the admitted context.",
        max_turns=8,
        run_config=RunConfig(tracing_disabled=True),
    )
    if result.final_output != RESPONSE_MARKER:
        raise RuntimeError(f"Unexpected agent response: {result.final_output!r}")
    if tool_calls != 1:
        raise RuntimeError(f"Expected one tool invocation, observed {tool_calls}")
    observed = f"{model.calls[0].system_instructions} {model.calls[0].input}"
    if CONTEXT_MARKER not in observed:
        raise RuntimeError("Agent lifecycle did not carry bounded context to the local model")
    print(RESPONSE_MARKER)


asyncio.run(main())
`;
}

function pythonCancellationHarness(): string {
  return `import asyncio
import os

os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"

from agents import Agent, MaxTurnsExceeded, RunConfig, Runner, function_tool, set_tracing_disabled
from agents.testing import ScriptedModel, function_call


@function_tool
def describe_workspai_context() -> str:
    return "ok"


async def main() -> None:
    set_tracing_disabled(True)
    model = ScriptedModel(
        steps=[
            [function_call("describe_workspai_context", {}, call_id="call_one")],
            [function_call("describe_workspai_context", {}, call_id="call_two")],
            [function_call("describe_workspai_context", {}, call_id="call_three")],
        ]
    )
    agent = Agent(
        name="workspai-conformance-cancel",
        instructions="Stay inside the admitted context.",
        model=model,
        tools=[describe_workspai_context],
    )
    try:
        await Runner.run(
            agent,
            "Loop the tool.",
            max_turns=1,
            run_config=RunConfig(tracing_disabled=True),
        )
    except MaxTurnsExceeded:
        print("WORKSPAI_AGENT_MAX_TURNS_OK")
        return
    raise RuntimeError("max_turns did not stop the OpenAI Agents SDK run")


asyncio.run(main())
`;
}

function pythonRedactionHarness(): string {
  return `from main import redact

secret = "sk-EXAMPLESECRETVALUE"
redacted = redact(f"provider failed {secret}")
if secret in redacted or "EXAMPLESECRETVALUE" in redacted:
    raise RuntimeError("SDK error redaction leaked a credential-shaped value")
if "[redacted]" not in redacted:
    raise RuntimeError("SDK error redaction did not replace the credential-shaped value")
print("WORKSPAI_AGENT_REDACTION_OK")
`;
}

function typeScriptLifecycleHarness(): string {
  return `import { Agent, Runner, tool } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { z } from 'zod';

process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';

const CONTEXT_MARKER = '${LIFECYCLE_CONTEXT_MARKER}';
const RESPONSE_MARKER = '${LIFECYCLE_RESPONSE_MARKER}';
let toolCalls = 0;

const describeWorkspaiContext = tool({
  name: 'describe_workspai_context',
  description: 'Return the admitted Workspai context marker.',
  parameters: z.object({}),
  async execute() {
    toolCalls += 1;
    return CONTEXT_MARKER;
  },
});

const model = new ScriptedModel([
  [functionCall('describe_workspai_context', {}, { callId: 'call_context' })],
  [assistantMessage(RESPONSE_MARKER)],
]);

const agent = new Agent({
  name: 'workspai-conformance',
  instructions: \`Treat this as bounded repository context: \${CONTEXT_MARKER}\`,
  model,
  tools: [describeWorkspaiContext],
});

const runner = new Runner({ tracingDisabled: true });
const result = await runner.run(agent, 'Confirm the admitted context.', {
  maxTurns: 8,
  signal: AbortSignal.timeout(30_000),
});
if (result.finalOutput !== RESPONSE_MARKER) {
  throw new Error(\`Unexpected agent response: \${String(result.finalOutput)}\`);
}
if (toolCalls !== 1) {
  throw new Error(\`Expected one tool invocation, observed \${toolCalls}\`);
}
const firstCall = model.calls[0];
const observed = JSON.stringify(firstCall?.request ?? {});
if (!observed.includes(CONTEXT_MARKER)) {
  throw new Error('Agent lifecycle did not carry bounded context to the local model');
}
process.stdout.write(\`\${RESPONSE_MARKER}\\n\`);
`;
}

function typeScriptCancellationHarness(): string {
  return `import { Agent, Runner } from '@openai/agents';
import { ScriptedModel, assistantMessage } from '@openai/agents/testing';

process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';

const model = new ScriptedModel([[assistantMessage('should not run')]]);
const agent = new Agent({
  name: 'workspai-conformance-cancel',
  instructions: 'Stay inside the admitted context.',
  model,
});
const controller = new AbortController();
controller.abort();
const runner = new Runner({ tracingDisabled: true });
try {
  await runner.run(agent, 'Abort immediately.', { maxTurns: 8, signal: controller.signal });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : undefined;
  if (!/abort|cancel/i.test(message) && name !== 'AbortError') {
    throw error;
  }
  process.stdout.write('WORKSPAI_AGENT_ABORT_OK\\n');
  process.exit(0);
}
throw new Error('AbortSignal did not stop the OpenAI Agents SDK run');
`;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectedRuntime(): Runtime {
  const value = argument('--runtime');
  if (value !== 'python' && value !== 'typescript') {
    throw new Error(
      'Usage: --runtime <python|typescript> [--report-dir <relative-or-absolute-directory>]'
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

function credentiallessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: 'true',
    NO_COLOR: '1',
    OPENAI_AGENTS_DISABLE_TRACING: '1',
  };
  for (const key of Object.keys(env)) {
    if (/^(OPENAI_|AZURE_OPENAI_)/i.test(key) && key !== 'OPENAI_AGENTS_DISABLE_TRACING') {
      delete env[key];
    }
  }
  delete env.WORKSPAI_AGENT_TRACING;
  return env;
}

function npmInvocation(): { command: string; prefixArgs: string[]; shell: boolean } {
  const invocation = resolvePackageRunnerInvocation('npm');
  return {
    command: invocation.command,
    prefixArgs: invocation.prefixArgs,
    shell: shouldUseShellExecution() && /\.(cmd|bat)$/i.test(invocation.command),
  };
}

function run(
  command: string,
  args: string[],
  cwd: string,
  options: { allowFailure?: boolean } = {}
): Promise<CommandResult> {
  const invocation =
    command === 'npm' ? npmInvocation() : { command, prefixArgs: [] as string[], shell: false };
  const argv = [...invocation.prefixArgs, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, argv, {
      cwd,
      shell: invocation.shell,
      env: credentiallessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', (error) => {
      reject(
        new Error(`${invocation.command} ${argv.join(' ')} failed to spawn: ${error.message}`)
      );
    });
    child.once('exit', (code, signal) => {
      const result = { stdout, stderr, code: code ?? 1 };
      if (code === 0 || options.allowFailure) resolve(result);
      else {
        reject(
          new Error(
            `${invocation.command} failed with ${signal ? `signal ${signal}` : `exit ${String(code)}`}\n${stderr || stdout}`
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
    const sdkVersion = packageVersion(OPENAI_AGENTS_PYTHON_BASELINE, 'openai-agents');
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      `[project]\nname = "conformance"\ndependencies = ["openai-agents==${sdkVersion}"]\n`,
      'utf8'
    );
    return;
  }
  const sdkVersion = packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, '@openai/agents');
  await fs.writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'conformance', dependencies: { '@openai/agents': sdkVersion } }, null, 2)}\n`,
    'utf8'
  );
}

async function negativeDetectionFixture(runtime: Runtime, root: string): Promise<void> {
  if (runtime === 'python') {
    await fs.writeFile(path.join(root, 'requirements.txt'), 'openai==1.109.1\n', 'utf8');
    return;
  }
  await fs.writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'conformance', dependencies: { openai: '5.16.0' } }, null, 2)}\n`,
    'utf8'
  );
}

function selectedAdapter(runtime: Runtime): AgentFrameworkAdapter {
  return runtime === 'python' ? openaiAgentsPythonAdapter : openaiAgentsTypeScriptAdapter;
}

function reportRuntime(runtime: Runtime): 'python' | 'node' {
  return runtime === 'python' ? 'python' : 'node';
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
  if (runtime === 'typescript') {
    const major = Number(process.versions.node.split('.')[0]);
    assertCondition(
      Number.isFinite(major) && major >= 22,
      `OpenAI Agents TypeScript conformance requires Node.js 22 or later; observed ${process.versions.node}.`
    );
  }
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), `workspai-oai-${runtime}-`));
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
      runtime: reportRuntime(runtime),
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
      const contextBoundary = rendered.files.find((file) =>
        file.content.includes('.workspai/reports/project-context-agent.json')
      );
      assertCondition(
        contextBoundary,
        'Rendered adapter files are not bound to canonical agent context.'
      );
      assertCondition(
        contextBoundary.content.includes('131_072'),
        'Canonical context loader does not enforce the 128 KiB boundary.'
      );
      return {
        entrypoint: context.entrypoint,
        contextBoundary: contextBoundary.path,
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
      const agentRoot = path.resolve(generatedRoot, path.dirname(context.dependencyManifest));
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
            "import importlib.metadata as m; print(m.version('openai-agents'))",
          ],
          generatedRoot
        );
        const sdkVersion = packages.stdout.trim();
        assertCondition(
          sdkVersion === adapter.manifest.framework.testedVersions[0],
          `Installed openai-agents ${sdkVersion || 'unknown'} does not match the tested baseline.`
        );
        installedFrameworkPackages = { 'openai-agents': sdkVersion };
        const pythonSources = rendered.files
          .filter((file) => file.path.endsWith('.py'))
          .map((file) => file.path);
        assertCondition(pythonSources.length > 0, 'Rendered Python sources are missing.');
        // Compile only generated sources. compileall of the agent root would
        // walk uv's nested .venv and can timeout the Windows/macOS lanes.
        await run(
          'uv',
          [
            'run',
            '--project',
            path.dirname(context.dependencyManifest),
            'python',
            '-m',
            'py_compile',
            ...pythonSources,
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
            'from agents import Agent, Runner, function_tool',
          ],
          generatedRoot
        );
        await run(
          'uv',
          ['run', '--project', '.', 'python', '-m', 'unittest', 'discover', '-s', 'tests'],
          agentRoot
        );
        const missingCredentials = await run(
          'uv',
          ['run', '--project', '.', 'python', 'main.py'],
          agentRoot,
          {
            allowFailure: true,
          }
        );
        assertCondition(
          missingCredentials.code !== 0,
          'Generated Python entrypoint started without OPENAI_API_KEY.'
        );
        assertCondition(
          /OPENAI_API_KEY is not set/.test(missingCredentials.stderr + missingCredentials.stdout),
          'Missing-credential failure did not report the required environment name.'
        );
        const redactionHarness = path.join(agentRoot, 'credentialless-redaction.py');
        await fs.writeFile(redactionHarness, pythonRedactionHarness(), 'utf8');
        const redaction = await run(
          'uv',
          ['run', '--project', '.', 'python', redactionHarness],
          agentRoot
        );
        assertCondition(
          redaction.stdout.includes('WORKSPAI_AGENT_REDACTION_OK'),
          'SDK error redaction did not retain its admitted marker.'
        );
        const lifecycleHarness = path.join(generatedRoot, 'credentialless-agent-lifecycle.py');
        await fs.writeFile(lifecycleHarness, pythonLifecycleHarness(), 'utf8');
        const lifecycle = await run(
          'uv',
          [
            'run',
            '--project',
            path.dirname(context.dependencyManifest),
            'python',
            lifecycleHarness,
          ],
          generatedRoot
        );
        assertCondition(
          lifecycle.stdout.includes(LIFECYCLE_RESPONSE_MARKER),
          'Credentialless Python agent lifecycle did not return its admitted response.'
        );
        const cancellationHarness = path.join(
          generatedRoot,
          'credentialless-agent-cancellation.py'
        );
        await fs.writeFile(cancellationHarness, pythonCancellationHarness(), 'utf8');
        const cancellation = await run(
          'uv',
          [
            'run',
            '--project',
            path.dirname(context.dependencyManifest),
            'python',
            cancellationHarness,
          ],
          generatedRoot
        );
        assertCondition(
          cancellation.stdout.includes('WORKSPAI_AGENT_MAX_TURNS_OK'),
          'Python max_turns cancellation did not stop the agent loop.'
        );
      } else {
        runtimeVersion = process.versions.node;
        await run(
          'npm',
          [
            'install',
            '--no-fund',
            '--no-audit',
            '--prefix',
            path.dirname(context.dependencyManifest),
          ],
          generatedRoot
        );
        const installed = JSON.parse(
          await fs.readFile(
            path.join(agentRoot, 'node_modules', '@openai', 'agents', 'package.json'),
            'utf8'
          )
        ) as { version?: unknown };
        assertCondition(
          installed.version === adapter.manifest.framework.testedVersions[0],
          `Installed @openai/agents ${String(installed.version)} does not match the tested baseline.`
        );
        const expectedZod = packageVersion(OPENAI_AGENTS_TYPESCRIPT_BASELINE, 'zod');
        const zodPackage = JSON.parse(
          await fs.readFile(path.join(agentRoot, 'node_modules', 'zod', 'package.json'), 'utf8')
        ) as { version?: unknown };
        assertCondition(
          zodPackage.version === expectedZod,
          `Installed zod ${String(zodPackage.version)} is not the pinned peer ${expectedZod}.`
        );
        installedFrameworkPackages = {
          '@openai/agents': String(installed.version),
          zod: String(zodPackage.version),
        };
        await run(
          'npm',
          ['test', '--prefix', path.dirname(context.dependencyManifest)],
          generatedRoot
        );
        const missingCredentials = await run(
          process.execPath,
          [path.join(agentRoot, 'dist', 'src', 'main.js')],
          generatedRoot,
          { allowFailure: true }
        );
        assertCondition(
          missingCredentials.code !== 0,
          'Generated TypeScript entrypoint started without OPENAI_API_KEY.'
        );
        assertCondition(
          /OPENAI_API_KEY is not set/.test(missingCredentials.stderr + missingCredentials.stdout),
          'Missing-credential failure did not report the required environment name.'
        );
        const redaction = await run(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import { redactSdkError } from './agents/conformance-agent/dist/src/agent.js'; const secret='sk-EXAMPLESECRETVALUE'; const redacted=redactSdkError('provider failed '+secret); if (redacted.includes(secret) || !redacted.includes('[redacted]')) { throw new Error('redaction failed'); } process.stdout.write('WORKSPAI_AGENT_REDACTION_OK\\n');",
          ],
          generatedRoot
        );
        assertCondition(
          redaction.stdout.includes('WORKSPAI_AGENT_REDACTION_OK'),
          'SDK error redaction did not retain its admitted marker.'
        );
        const lifecycleHarness = path.join(agentRoot, 'credentialless-agent-lifecycle.mjs');
        await fs.writeFile(lifecycleHarness, typeScriptLifecycleHarness(), 'utf8');
        const lifecycle = await run(process.execPath, [lifecycleHarness], agentRoot);
        assertCondition(
          lifecycle.stdout.includes(LIFECYCLE_RESPONSE_MARKER),
          'Credentialless TypeScript agent lifecycle did not return its admitted response.'
        );
        const cancellationHarness = path.join(agentRoot, 'credentialless-agent-cancellation.mjs');
        await fs.writeFile(cancellationHarness, typeScriptCancellationHarness(), 'utf8');
        const cancellation = await run(process.execPath, [cancellationHarness], agentRoot);
        assertCondition(
          cancellation.stdout.includes('WORKSPAI_AGENT_ABORT_OK'),
          'TypeScript AbortSignal cancellation did not stop the agent loop.'
        );
      }
      assertCondition(runtimeVersion.length > 0, 'Runtime version was not captured.');
      return {
        runtimeVersion,
        frameworkVersion: adapter.manifest.framework.testedVersions[0],
        installedFrameworkPackages,
        verificationCommands: context.verificationCommands,
        providerInvocationPerformed: false,
        livePaidApiCall: false,
        credentiallessAgentLifecycle: {
          executed: true,
          contextObserved: true,
          responseMarker: LIFECYCLE_RESPONSE_MARKER,
        },
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
        tracingDisabledUnlessOptedIn: true,
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
    environment: {
      platform,
      architecture: process.arch,
      runtime: reportRuntime(runtime),
      runtimeVersion,
    },
    checks,
    summary,
    verdict: failedChecks.length === 0 ? 'admitted' : 'blocked',
    blockers: failedChecks.map((check) => `${check.id}: ${check.summary}`),
    limitations: [
      'Conformance compiles the generated entrypoint and executes a bounded context-to-agent-to-response lifecycle with the official ScriptedModel test double.',
      'Paid or live OpenAI API execution was not performed and is not admission evidence.',
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
