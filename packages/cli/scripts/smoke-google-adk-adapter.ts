import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  digestBuiltinAgentFrameworkImplementation,
  digestBuiltinAgentFrameworkManifest,
  managedFile,
  GOOGLE_ADK_PYTHON_BASELINE,
  GOOGLE_ADK_TYPESCRIPT_BASELINE,
  googleAdkPythonAdapter,
  googleAdkTypeScriptAdapter,
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

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from agent import build_agent
from main import run_admitted_agent
from workspai_context import load_workspai_context

CONTEXT_MARKER = "${LIFECYCLE_CONTEXT_MARKER}"
RESPONSE_MARKER = "${LIFECYCLE_RESPONSE_MARKER}"


class ScriptedLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")
        object.__setattr__(self, "calls", [])
        object.__setattr__(
            self,
            "_steps",
            [
                LlmResponse(
                    content=types.Content(
                        role="model",
                        parts=[
                            types.Part(
                                function_call=types.FunctionCall(
                                    name="describe_workspai_context",
                                    args={},
                                )
                            )
                        ],
                    )
                ),
                LlmResponse(
                    content=types.Content(
                        role="model",
                        parts=[types.Part(text=RESPONSE_MARKER)],
                    )
                ),
            ],
        )

    async def generate_content_async(self, llm_request, stream=False):
        self.calls.append(llm_request)
        yield self._steps[len(self.calls) - 1]


async def main() -> None:
    os.environ["WORKSPAI_AGENT_TRACING"] = "1"
    context = load_workspai_context()
    if CONTEXT_MARKER not in context:
        raise RuntimeError("Generated loader did not return the admitted context")
    agent = build_agent(model="workspai-scripted")
    if not str(agent.name).isidentifier():
        raise RuntimeError(f"Agent name is not a Python identifier: {agent.name!r}")
    model = ScriptedLlm()
    result = await run_admitted_agent("Confirm the admitted context.", model=model)
    if result != RESPONSE_MARKER:
        raise RuntimeError(f"Unexpected agent response: {result!r}")
    if len(model.calls) < 2:
        raise RuntimeError("Scripted model did not receive a second turn after the tool")
    print(RESPONSE_MARKER)


asyncio.run(main())
`;
}

function pythonCancellationHarness(): string {
  return `import asyncio

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from main import run_admitted_agent


class ScriptedLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")
        object.__setattr__(self, "calls", [])

    async def generate_content_async(self, llm_request, stream=False):
        self.calls.append(llm_request)
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[
                    types.Part(
                        function_call=types.FunctionCall(
                            name="describe_workspai_context",
                            args={},
                        )
                    )
                ],
            )
        )


async def main() -> None:
    model = ScriptedLlm()
    try:
        await run_admitted_agent("Loop the tool.", model=model, max_llm_calls=1)
    except Exception as error:
        text = str(error)
        if "max_llm" in text.lower() or "limit" in text.lower() or "llm call" in text.lower():
            print("WORKSPAI_AGENT_MAX_TURNS_OK")
            return
        raise RuntimeError(f"max_llm_calls did not stop the Google ADK run: {text}") from error
    raise RuntimeError("max_llm_calls did not stop the Google ADK run")


asyncio.run(main())
`;
}

function pythonModelErrorHarness(): string {
  return `import asyncio

from google.adk.models.base_llm import BaseLlm

from main import run_admitted_agent


class ScriptedLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")

    async def generate_content_async(self, llm_request, stream=False):
        raise RuntimeError("scripted-model-failure")
        yield


async def main() -> None:
    model = ScriptedLlm()
    try:
        await run_admitted_agent("Fail the model boundary.", model=model)
    except Exception as error:
        text = str(error)
        if "scripted-model-failure" not in text:
            raise RuntimeError(f"Model error was not surfaced: {text}") from error
        print("WORKSPAI_AGENT_MODEL_ERROR_OK")
        return
    raise RuntimeError("scripted model error did not fail the run")


asyncio.run(main())
`;
}

function pythonToolErrorHarness(): string {
  return `import asyncio
from pathlib import Path

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from main import run_admitted_agent
from workspai_context import CONTEXT_PATH, resolve_workspai_project_root


class ScriptedLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")
        object.__setattr__(self, "calls", [])

    async def generate_content_async(self, llm_request, stream=False):
        self.calls.append(llm_request)
        yield LlmResponse(
            content=types.Content(
                role="model",
                parts=[
                    types.Part(
                        function_call=types.FunctionCall(
                            name="describe_workspai_context",
                            args={},
                        )
                    )
                ],
            )
        )


async def main() -> None:
    context = resolve_workspai_project_root() / CONTEXT_PATH
    if context.exists() or context.is_symlink():
        context.unlink()
    model = ScriptedLlm()
    try:
        result = await run_admitted_agent("Call the context tool.", model=model)
    except Exception as error:
        text = str(error)
        if "do-not-leak" in text:
            raise RuntimeError("Tool error diagnostic leaked unrelated content") from error
        if "missing" not in text.lower() and "contained regular file" not in text:
            raise RuntimeError(f"Tool error was not a context-boundary failure: {text}") from error
        print("WORKSPAI_AGENT_TOOL_ERROR_OK")
        return
    raise RuntimeError(f"Tool error was swallowed: {result!r}")


asyncio.run(main())
`;
}

function pythonAsyncCancelHarness(): string {
  return `import asyncio

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from main import run_admitted_agent


class ScriptedLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")

    async def generate_content_async(self, llm_request, stream=False):
        await asyncio.sleep(3600)
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text="too-late")])
        )


async def main() -> None:
    model = ScriptedLlm()
    task = asyncio.create_task(run_admitted_agent("Hang until cancelled.", model=model))
    await asyncio.sleep(0.05)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("WORKSPAI_AGENT_ASYNCIO_CANCEL_OK")
        return
    except asyncio.TimeoutError:
        print("WORKSPAI_AGENT_ASYNCIO_CANCEL_OK")
        return
    raise RuntimeError("asyncio cancellation did not stop the in-flight Python run")


asyncio.run(main())
`;
}

function pythonTimeoutHarness(): string {
  return `import asyncio

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from main import run_admitted_agent


class ScriptedLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")

    async def generate_content_async(self, llm_request, stream=False):
        await asyncio.sleep(3600)
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text="too-late")])
        )


async def main() -> None:
    try:
        await run_admitted_agent("Hang until timeout.", model=ScriptedLlm(), timeout_seconds=0.2)
    except asyncio.TimeoutError:
        print("WORKSPAI_AGENT_TIMEOUT_OK")
        return
    except Exception as error:
        text = str(error)
        if "timeout" in text.lower() or "timed out" in text.lower():
            print("WORKSPAI_AGENT_TIMEOUT_OK")
            return
        raise
    raise RuntimeError("host timeout did not stop the Python Google ADK run")


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
azure = "AccountKey=SECRETKEYVALUE"
azure_redacted = redact(f"provider failed {azure}")
if "SECRETKEYVALUE" in azure_redacted:
    raise RuntimeError("SDK error redaction leaked an Azure secret-shaped value")
print("WORKSPAI_AGENT_REDACTION_OK")
`;
}

function typeScriptScriptedLlmSource(): string {
  return `import { BaseLlm } from '@google/adk';

function abortable(work, abortSignal) {
  if (!abortSignal) return work;
  if (abortSignal.aborted) {
    return Promise.reject(abortSignal.reason ?? new Error('aborted'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortSignal.reason ?? new Error('aborted'));
    abortSignal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        abortSignal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

class ScriptedLlm extends BaseLlm {
  constructor(steps) {
    super({ model: 'workspai-scripted' });
    this.calls = [];
    this.steps = steps;
  }
  async *generateContentAsync(llmRequest, _stream, abortSignal) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('aborted');
    this.calls.push(llmRequest);
    const next = this.steps[this.calls.length - 1];
    if (!next) throw new Error('ScriptedLlm has no remaining responses');
    if (typeof next === 'function') {
      yield await abortable(next(), abortSignal);
      return;
    }
    yield next;
  }
  connect() {
    return Promise.reject(new Error('Live connections are unsupported in this Workspai starter.'));
  }
}
`;
}

function typeScriptLifecycleHarness(): string {
  return `${typeScriptScriptedLlmSource()}
import { runAdmittedAgent } from './dist/src/agent.js';
import { loadWorkspaiContext } from './dist/src/workspai-context.js';

const CONTEXT_MARKER = '${LIFECYCLE_CONTEXT_MARKER}';
const RESPONSE_MARKER = '${LIFECYCLE_RESPONSE_MARKER}';

const context = loadWorkspaiContext();
if (!context.includes(CONTEXT_MARKER)) {
  throw new Error('Generated loader did not return the admitted context');
}

const model = new ScriptedLlm([
  { content: { role: 'model', parts: [{ functionCall: { name: 'describe_workspai_context', args: {} } }] } },
  { content: { role: 'model', parts: [{ text: RESPONSE_MARKER }] } },
]);

const output = await runAdmittedAgent('Confirm the admitted context.', { model });
if (output !== RESPONSE_MARKER) {
  throw new Error(\`Unexpected agent response: \${JSON.stringify(output)}\`);
}
if (model.calls.length < 2) {
  throw new Error('Scripted model did not receive a second turn after the tool');
}
process.stdout.write(RESPONSE_MARKER + '\\n');
`;
}

function typeScriptCancellationHarness(): string {
  return `${typeScriptScriptedLlmSource()}
import { runAdmittedAgent } from './dist/src/agent.js';

const model = new ScriptedLlm([
  { content: { role: 'model', parts: [{ functionCall: { name: 'describe_workspai_context', args: {} } }] } },
  { content: { role: 'model', parts: [{ functionCall: { name: 'describe_workspai_context', args: {} } }] } },
]);

try {
  await runAdmittedAgent('Loop the tool.', { model, maxLlmCalls: 1 });
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  if (/max.?llm|limit|llm call/i.test(text)) {
    process.stdout.write('WORKSPAI_AGENT_MAX_TURNS_OK\\n');
    process.exit(0);
  }
  throw error;
}
throw new Error('maxLlmCalls did not stop the Google ADK run');
`;
}

function typeScriptModelErrorHarness(): string {
  return `${typeScriptScriptedLlmSource()}
import { runAdmittedAgent } from './dist/src/agent.js';

const model = new ScriptedLlm([
  async () => {
    throw new Error('scripted-model-failure');
  },
]);

try {
  await runAdmittedAgent('Fail the model boundary.', { model });
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  if (!text.includes('scripted-model-failure')) {
    throw new Error(\`Model error was not surfaced: \${text}\`);
  }
  process.stdout.write('WORKSPAI_AGENT_MODEL_ERROR_OK\\n');
  process.exit(0);
}
throw new Error('scripted model error did not fail the run');
`;
}

function typeScriptToolErrorHarness(): string {
  return `${typeScriptScriptedLlmSource()}
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runAdmittedAgent } from './dist/src/agent.js';
import { resolveWorkspaiProjectRoot, WORKSPAI_CONTEXT_PATH } from './dist/src/workspai-context.js';

const contextPath = join(resolveWorkspaiProjectRoot(), WORKSPAI_CONTEXT_PATH);
await rm(contextPath, { force: true });

const model = new ScriptedLlm([
  { content: { role: 'model', parts: [{ functionCall: { name: 'describe_workspai_context', args: {} } }] } },
]);

const observedFailure = (text) =>
  /missing|contained regular file/i.test(text) && !text.includes('do-not-leak');

try {
  const result = await runAdmittedAgent('Call the context tool.', { model });
  const observed = JSON.stringify(model.calls);
  if (observed.includes('do-not-leak')) {
    throw new Error('Tool error diagnostic leaked unrelated content');
  }
  if (observedFailure(observed)) {
    process.stdout.write('WORKSPAI_AGENT_TOOL_ERROR_OK\\n');
    process.exit(0);
  }
  throw new Error(\`Tool error was swallowed: \${result}\`);
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  const observed = JSON.stringify(model.calls);
  if (text.includes('do-not-leak') || observed.includes('do-not-leak')) {
    throw new Error('Tool error diagnostic leaked unrelated content');
  }
  if (observedFailure(text) || observedFailure(observed)) {
    process.stdout.write('WORKSPAI_AGENT_TOOL_ERROR_OK\\n');
    process.exit(0);
  }
  if (text.includes('Tool error was swallowed')) throw error;
  throw new Error(\`Tool error was not a context-boundary failure: \${text}\`);
}
`;
}

function typeScriptInFlightAbortHarness(): string {
  return `${typeScriptScriptedLlmSource()}
import { runAdmittedAgent } from './dist/src/agent.js';

const model = new ScriptedLlm([
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 3600_000));
    return { content: { role: 'model', parts: [{ text: 'too-late' }] } };
  },
]);

const controller = new AbortController();
const pending = runAdmittedAgent('Hang until aborted.', { model, signal: controller.signal });
setTimeout(() => controller.abort(), 50);
try {
  await pending;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined;
  if (!/abort|cancel/i.test(message) && name !== 'AbortError') {
    throw error;
  }
  process.stdout.write('WORKSPAI_AGENT_ABORT_OK\\n');
  process.exit(0);
}
throw new Error('In-flight AbortSignal did not stop the Google ADK run');
`;
}

function typeScriptTimeoutHarness(): string {
  return `${typeScriptScriptedLlmSource()}
import { runAdmittedAgent } from './dist/src/agent.js';

const model = new ScriptedLlm([
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 3600_000));
    return { content: { role: 'model', parts: [{ text: 'too-late' }] } };
  },
]);

try {
  await runAdmittedAgent('Hang until timeout.', { model, signal: AbortSignal.timeout(200) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined;
  if (/timeout|abort|cancel/i.test(message) || name === 'AbortError' || name === 'TimeoutError') {
    process.stdout.write('WORKSPAI_AGENT_TIMEOUT_OK\\n');
    process.exit(0);
  }
  throw error;
}
throw new Error('AbortSignal.timeout did not stop the Google ADK run');
`;
}

function pythonStreamingHarness(): string {
  return `import asyncio
from types import SimpleNamespace

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from main import _StreamState, _observe_stream_event, run_admitted_agent


class HandshakeLlm(BaseLlm):
    def __init__(self):
        super().__init__(model="workspai-scripted")

    async def generate_content_async(self, llm_request, stream=False):
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text="STREAM_A")]),
            partial=True,
        )
        await asyncio.wait_for(released.wait(), timeout=2.0)
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text="STREAM_B")]),
            partial=True,
        )
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text="STREAM_ASTREAM_B")]),
            partial=False,
            turn_complete=True,
        )


class ScriptedStreamLlm(BaseLlm):
    def __init__(self, steps):
        super().__init__(model="workspai-scripted")
        object.__setattr__(self, "steps", steps)

    async def generate_content_async(self, llm_request, stream=False):
        for step in self.steps:
            yield step


class ScriptedTurnLlm(BaseLlm):
    def __init__(self, turns):
        super().__init__(model="workspai-scripted")
        object.__setattr__(self, "turns", turns)
        object.__setattr__(self, "calls", [])

    async def generate_content_async(self, llm_request, stream=False):
        self.calls.append(llm_request)
        for step in self.turns[len(self.calls) - 1]:
            yield step


def part(text, partial, turn_complete=False):
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        partial=partial,
        turn_complete=turn_complete,
    )


released = asyncio.Event()
seen = []


def on_text(delta):
    seen.append(delta)
    if "STREAM_A" in "".join(seen):
        released.set()


async def main():
    output = await run_admitted_agent(
        "stream",
        model=HandshakeLlm(),
        streaming=True,
        on_text=on_text,
    )
    if seen != ["STREAM_A", "STREAM_B"]:
        raise SystemExit("partial fragments were not delivered in order: " + repr(seen))
    if output != "STREAM_ASTREAM_B":
        raise SystemExit("canonical stream text was not the non-partial aggregate")
    if not released.is_set():
        raise SystemExit("streaming handshake never released the model")

    repeated_seen = []
    repeated = await run_admitted_agent(
        "repeated",
        model=ScriptedStreamLlm(
            [part("ha", True), part("ha", True), part("haha", False, True)]
        ),
        streaming=True,
        on_text=repeated_seen.append,
    )
    if repeated_seen != ["ha", "ha"] or repeated != "haha":
        raise SystemExit("repeated delta streaming was incorrect")

    collision_seen = []
    collision = await run_admitted_agent(
        "collision",
        model=ScriptedStreamLlm(
            [part("a", True), part("abc", True), part("aabc", False, True)]
        ),
        streaming=True,
        on_text=collision_seen.append,
    )
    if collision_seen != ["a", "abc"] or collision != "aabc":
        raise SystemExit("prefix-collision streaming was incorrect")
    print("WORKSPAI_AGENT_STREAMING_PARTIAL_OK")

    interleaved_seen = []
    interleaved = await run_admitted_agent(
        "interleave",
        model=ScriptedStreamLlm(
            [
                part("a", True),
                LlmResponse(content=types.Content(role="model", parts=[]), partial=False),
                part("b", True),
                part("ab", False, True),
            ]
        ),
        streaming=True,
        on_text=interleaved_seen.append,
    )
    if interleaved_seen != ["a", "b"] or interleaved != "ab":
        raise SystemExit("metadata-interleaved streaming was incorrect: " + repr(interleaved_seen))

    state = _StreamState()
    observed = []

    def fragment(text):
        return SimpleNamespace(
            partial=True,
            content=SimpleNamespace(
                parts=[SimpleNamespace(text=text, function_call=None, function_response=None)]
            ),
            is_final_response=lambda: False,
        )

    def metadata():
        return SimpleNamespace(
            partial=False,
            content=SimpleNamespace(parts=[]),
            is_final_response=lambda: True,
        )

    def final(text):
        return SimpleNamespace(
            partial=False,
            content=SimpleNamespace(
                parts=[SimpleNamespace(text=text, function_call=None, function_response=None)]
            ),
            is_final_response=lambda: True,
        )

    def tool_event(text=""):
        return SimpleNamespace(
            partial=False,
            turn_complete=True,
            content=SimpleNamespace(
                parts=[
                    SimpleNamespace(
                        text=text or None,
                        function_call=SimpleNamespace(name="describe_workspai_context"),
                        function_response=None,
                    )
                ]
            ),
            is_final_response=lambda: False,
        )

    for event in [fragment("a"), metadata(), fragment("b"), final("ab")]:
        _observe_stream_event(state, event, observed.append)
    if observed != ["a", "b"] or state.result() != "ab":
        raise SystemExit("observer metadata-interleaving was incorrect: " + repr(observed))
    print("WORKSPAI_AGENT_STREAMING_METADATA_OK")

    tool_state = _StreamState()
    tool_observed = []
    for event in [fragment("looking"), tool_event("should-not-display"), final("done")]:
        _observe_stream_event(tool_state, event, tool_observed.append)
    if tool_observed != ["looking", "done"] or tool_state.result() != "done":
        raise SystemExit("observer tool-boundary streaming was incorrect: " + repr(tool_observed))

    tool_seen = []
    tool_output = await run_admitted_agent(
        "tools",
        model=ScriptedTurnLlm(
            [
                [
                    part("looking", True),
                    LlmResponse(
                        content=types.Content(
                            role="model",
                            parts=[
                                types.Part(
                                    function_call=types.FunctionCall(
                                        name="describe_workspai_context", args={}
                                    )
                                )
                            ],
                        ),
                        partial=False,
                        turn_complete=True,
                    ),
                ],
                [part("done", False, True)],
            ]
        ),
        streaming=True,
        on_text=tool_seen.append,
    )
    if tool_seen != ["looking", "done"] or tool_output != "done":
        raise SystemExit("tool-boundary streaming was incorrect: " + repr(tool_seen))
    print("WORKSPAI_AGENT_STREAMING_TOOL_BOUNDARY_OK")
    print("WORKSPAI_AGENT_STREAMING_OK")


asyncio.run(main())
`;
}

function pythonTelemetryHarness(): string {
  return `import os
import subprocess
import sys

DISABLED = """
import os
os.environ.pop("WORKSPAI_AGENT_TRACING", None)
os.environ.pop("OTEL_SDK_DISABLED", None)
from agent import tracing_enabled
from opentelemetry import trace
if tracing_enabled():
    raise SystemExit("tracing was opted in by default")
if os.environ.get("OTEL_SDK_DISABLED") != "true":
    raise SystemExit("OTEL_SDK_DISABLED was not set unless tracing is opted in")
span = trace.get_tracer("workspai-conformance").start_span("probe")
recording = span.is_recording()
span.end()
if recording:
    raise SystemExit("OpenTelemetry created a recording span while tracing is disabled")
print("WORKSPAI_AGENT_TELEMETRY_DISABLED_OK")
"""

OPT_IN = """
import os
os.environ["WORKSPAI_AGENT_TRACING"] = "1"
os.environ.pop("OTEL_SDK_DISABLED", None)
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
trace.set_tracer_provider(TracerProvider())
from agent import tracing_enabled
if not tracing_enabled():
    raise SystemExit("WORKSPAI_AGENT_TRACING=1 did not enable tracing")
if os.environ.get("OTEL_SDK_DISABLED") == "true":
    raise SystemExit("OTEL_SDK_DISABLED was set despite opt-in")
span = trace.get_tracer("workspai-conformance").start_span("probe")
recording = span.is_recording()
span.end()
if not recording:
    raise SystemExit("opt-in process did not create a recording span")
print("WORKSPAI_AGENT_TELEMETRY_OPT_IN_OK")
"""


def child_env(*, opt_in: bool):
    env = os.environ.copy()
    env.pop("WORKSPAI_AGENT_TRACING", None)
    env.pop("OTEL_SDK_DISABLED", None)
    if opt_in:
        env["WORKSPAI_AGENT_TRACING"] = "1"
    return env


disabled = subprocess.run(
    [sys.executable, "-c", DISABLED],
    cwd=os.getcwd(),
    env=child_env(opt_in=False),
    capture_output=True,
    text=True,
    check=False,
)
if disabled.returncode != 0:
    raise SystemExit(disabled.stderr + disabled.stdout)
if "WORKSPAI_AGENT_TELEMETRY_DISABLED_OK" not in disabled.stdout:
    raise SystemExit("disabled telemetry process did not report success")
sys.stdout.write(disabled.stdout)

opted = subprocess.run(
    [sys.executable, "-c", OPT_IN],
    cwd=os.getcwd(),
    env=child_env(opt_in=True),
    capture_output=True,
    text=True,
    check=False,
)
if opted.returncode != 0:
    raise SystemExit(opted.stderr + opted.stdout)
if "WORKSPAI_AGENT_TELEMETRY_OPT_IN_OK" not in opted.stdout:
    raise SystemExit("opt-in telemetry process did not report success")
sys.stdout.write(opted.stdout)
print("WORKSPAI_AGENT_TELEMETRY_OK")
`;
}

function typeScriptStreamingHarness(): string {
  return `import { BaseLlm } from '@google/adk';
import {
  createAdmittedStreamState,
  observeAdmittedStreamEvent,
  runAdmittedAgent,
} from './dist/src/agent.js';

let release = () => {};
const released = new Promise((resolve) => {
  release = resolve;
});

class HandshakeLlm extends BaseLlm {
  constructor() {
    super({ model: 'workspai-scripted' });
  }
  async *generateContentAsync(_llmRequest, _stream, abortSignal) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('aborted');
    yield { content: { role: 'model', parts: [{ text: 'STREAM_A' }] }, partial: true };
    await Promise.race([
      released,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('first stream chunk was not delivered before the model finished')),
          2000
        )
      ),
    ]);
    yield { content: { role: 'model', parts: [{ text: 'STREAM_B' }] }, partial: true };
    yield {
      content: { role: 'model', parts: [{ text: 'STREAM_ASTREAM_B' }] },
      partial: false,
      turnComplete: true,
    };
  }
  connect() {
    return Promise.reject(new Error('Live connections are unsupported in this Workspai starter.'));
  }
}

class ScriptedStreamLlm extends BaseLlm {
  constructor(steps) {
    super({ model: 'workspai-scripted' });
    this.steps = steps;
  }
  async *generateContentAsync(_llmRequest, _stream, abortSignal) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('aborted');
    for (const step of this.steps) yield step;
  }
  connect() {
    return Promise.reject(new Error('Live connections are unsupported in this Workspai starter.'));
  }
}

class ScriptedTurnLlm extends BaseLlm {
  constructor(turns) {
    super({ model: 'workspai-scripted' });
    this.turns = turns;
    this.calls = [];
  }
  async *generateContentAsync(llmRequest, _stream, abortSignal) {
    if (abortSignal?.aborted) throw abortSignal.reason ?? new Error('aborted');
    this.calls.push(llmRequest);
    for (const step of this.turns[this.calls.length - 1] ?? []) yield step;
  }
  connect() {
    return Promise.reject(new Error('Live connections are unsupported in this Workspai starter.'));
  }
}

const part = (text, partial, turnComplete = false) => ({
  content: { role: 'model', parts: [{ text }] },
  partial,
  turnComplete,
});

const seen = [];
const output = await runAdmittedAgent('stream', {
  model: new HandshakeLlm(),
  streaming: true,
  onText: (delta) => {
    seen.push(delta);
    if (seen.join('').includes('STREAM_A')) release();
  },
});
if (JSON.stringify(seen) !== JSON.stringify(['STREAM_A', 'STREAM_B'])) {
  throw new Error('partial fragments were not delivered in order: ' + JSON.stringify(seen));
}
if (output !== 'STREAM_ASTREAM_B') {
  throw new Error('canonical stream text was not the non-partial aggregate');
}

const repeatedSeen = [];
const repeated = await runAdmittedAgent('repeated', {
  model: new ScriptedStreamLlm([part('ha', true), part('ha', true), part('haha', false, true)]),
  streaming: true,
  onText: (delta) => repeatedSeen.push(delta),
});
if (JSON.stringify(repeatedSeen) !== JSON.stringify(['ha', 'ha']) || repeated !== 'haha') {
  throw new Error('repeated delta streaming was incorrect');
}

const collisionSeen = [];
const collision = await runAdmittedAgent('collision', {
  model: new ScriptedStreamLlm([part('a', true), part('abc', true), part('aabc', false, true)]),
  streaming: true,
  onText: (delta) => collisionSeen.push(delta),
});
if (JSON.stringify(collisionSeen) !== JSON.stringify(['a', 'abc']) || collision !== 'aabc') {
  throw new Error('prefix-collision streaming was incorrect');
}
process.stdout.write('WORKSPAI_AGENT_STREAMING_PARTIAL_OK\\n');

const interleavedSeen = [];
const interleaved = await runAdmittedAgent('interleave', {
  model: new ScriptedStreamLlm([
    part('a', true),
    { content: { role: 'model', parts: [] }, partial: false },
    part('b', true),
    part('ab', false, true),
  ]),
  streaming: true,
  onText: (delta) => interleavedSeen.push(delta),
});
if (JSON.stringify(interleavedSeen) !== JSON.stringify(['a', 'b']) || interleaved !== 'ab') {
  throw new Error('metadata-interleaved streaming was incorrect: ' + JSON.stringify(interleavedSeen));
}

const state = createAdmittedStreamState();
const observed = [];
for (const event of [
  { content: { role: 'model', parts: [{ text: 'a' }] }, partial: true, actions: {} },
  { content: { role: 'model', parts: [] }, partial: false, actions: {} },
  { content: { role: 'model', parts: [{ text: 'b' }] }, partial: true, actions: {} },
  { content: { role: 'model', parts: [{ text: 'ab' }] }, partial: false, actions: {} },
]) {
  observeAdmittedStreamEvent(state, event, (delta) => observed.push(delta));
}
if (JSON.stringify(observed) !== JSON.stringify(['a', 'b']) || (state.finalText || state.displayed.join('')) !== 'ab') {
  throw new Error('observer metadata-interleaving was incorrect: ' + JSON.stringify(observed));
}
process.stdout.write('WORKSPAI_AGENT_STREAMING_METADATA_OK\\n');

const toolState = createAdmittedStreamState();
const toolObserved = [];
for (const event of [
  { content: { role: 'model', parts: [{ text: 'looking' }] }, partial: true, actions: {} },
  {
    content: {
      role: 'model',
      parts: [{ text: 'should-not-display', functionCall: { name: 'describe_workspai_context', args: {} } }],
    },
    partial: false,
    turnComplete: true,
    actions: {},
  },
  { content: { role: 'model', parts: [{ text: 'done' }] }, partial: false, actions: {} },
]) {
  observeAdmittedStreamEvent(toolState, event, (delta) => toolObserved.push(delta));
}
if (JSON.stringify(toolObserved) !== JSON.stringify(['looking', 'done']) || toolState.finalText !== 'done') {
  throw new Error('observer tool-boundary streaming was incorrect: ' + JSON.stringify(toolObserved));
}

const toolSeen = [];
const toolOutput = await runAdmittedAgent('tools', {
  model: new ScriptedTurnLlm([
    [
      part('looking', true),
      {
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'describe_workspai_context', args: {} } }],
        },
        partial: false,
        turnComplete: true,
      },
    ],
    [part('done', false, true)],
  ]),
  streaming: true,
  onText: (delta) => toolSeen.push(delta),
});
if (JSON.stringify(toolSeen) !== JSON.stringify(['looking', 'done']) || toolOutput !== 'done') {
  throw new Error('tool-boundary streaming was incorrect: ' + JSON.stringify(toolSeen));
}
process.stdout.write('WORKSPAI_AGENT_STREAMING_TOOL_BOUNDARY_OK\\n');
process.stdout.write('WORKSPAI_AGENT_STREAMING_OK\\n');
`;
}

function typeScriptTelemetryHarness(): string {
  return `import { spawnSync } from 'node:child_process';

const baseEnv = Object.assign({}, process.env);
delete baseEnv.WORKSPAI_AGENT_TRACING;
delete baseEnv.OTEL_SDK_DISABLED;

const disabled = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    [
      "delete process.env.WORKSPAI_AGENT_TRACING;",
      "delete process.env.OTEL_SDK_DISABLED;",
      "const { tracingEnabled } = await import('./dist/src/tracing.js');",
      "const { trace } = await import('@opentelemetry/api');",
      "if (tracingEnabled()) throw new Error('tracing was opted in by default');",
      "if (process.env.OTEL_SDK_DISABLED !== 'true') throw new Error('OTEL_SDK_DISABLED was not set unless tracing is opted in');",
      "const span = trace.getTracer('workspai-conformance').startSpan('probe');",
      "const recording = span.isRecording();",
      "span.end();",
      "if (recording) throw new Error('OpenTelemetry created a recording span while tracing is disabled');",
      "process.stdout.write('WORKSPAI_AGENT_TELEMETRY_DISABLED_OK\\\\n');",
    ].join(''),
  ],
  { cwd: process.cwd(), env: baseEnv, encoding: 'utf8' }
);
if (disabled.status !== 0) {
  throw new Error(String(disabled.stderr || '') + String(disabled.stdout || ''));
}
if (!String(disabled.stdout).includes('WORKSPAI_AGENT_TELEMETRY_DISABLED_OK')) {
  throw new Error('disabled telemetry process did not report success');
}
process.stdout.write(String(disabled.stdout));

const optInEnv = Object.assign({}, baseEnv, { WORKSPAI_AGENT_TRACING: '1' });
const opted = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    [
      "process.env.WORKSPAI_AGENT_TRACING = '1';",
      "delete process.env.OTEL_SDK_DISABLED;",
      "const { BasicTracerProvider } = await import('@opentelemetry/sdk-trace-base');",
      "const { trace } = await import('@opentelemetry/api');",
      "trace.setGlobalTracerProvider(new BasicTracerProvider());",
      "const { tracingEnabled } = await import('./dist/src/tracing.js');",
      "if (!tracingEnabled()) throw new Error('WORKSPAI_AGENT_TRACING=1 did not enable tracing');",
      "if (process.env.OTEL_SDK_DISABLED === 'true') throw new Error('OTEL_SDK_DISABLED was set despite opt-in');",
      "const span = trace.getTracer('workspai-conformance').startSpan('probe');",
      "const recording = span.isRecording();",
      "span.end();",
      "if (!recording) throw new Error('opt-in process did not create a recording span');",
      "process.stdout.write('WORKSPAI_AGENT_TELEMETRY_OPT_IN_OK\\\\n');",
    ].join(''),
  ],
  { cwd: process.cwd(), env: optInEnv, encoding: 'utf8' }
);
if (opted.status !== 0) {
  throw new Error(String(opted.stderr || '') + String(opted.stdout || ''));
}
if (!String(opted.stdout).includes('WORKSPAI_AGENT_TELEMETRY_OPT_IN_OK')) {
  throw new Error('opt-in telemetry process did not report success');
}
process.stdout.write(String(opted.stdout));
process.stdout.write('WORKSPAI_AGENT_TELEMETRY_OK\\n');
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

type StreamingTelemetryEvidence = {
  streamingPartialSemantics: boolean;
  streamingMetadataInterleaving: boolean;
  streamingToolBoundary: boolean;
  telemetryDefaultNonRecording: boolean;
  telemetryOptInRecording: boolean;
};

function readMarker(stdout: string, marker: string): boolean {
  return stdout.includes(marker);
}

function requireStreamingEvidence(
  stdout: string,
  runtimeLabel: string
): {
  streamingPartialSemantics: boolean;
  streamingMetadataInterleaving: boolean;
  streamingToolBoundary: boolean;
} {
  const streamingPartialSemantics = readMarker(stdout, 'WORKSPAI_AGENT_STREAMING_PARTIAL_OK');
  const streamingMetadataInterleaving = readMarker(stdout, 'WORKSPAI_AGENT_STREAMING_METADATA_OK');
  const streamingToolBoundary = readMarker(stdout, 'WORKSPAI_AGENT_STREAMING_TOOL_BOUNDARY_OK');
  assertCondition(
    streamingPartialSemantics,
    `${runtimeLabel} streaming partial semantics were not recorded.`
  );
  assertCondition(
    streamingMetadataInterleaving,
    `${runtimeLabel} metadata-interleaved streaming was not recorded.`
  );
  assertCondition(
    streamingToolBoundary,
    `${runtimeLabel} tool-boundary streaming was not recorded.`
  );
  assertCondition(
    readMarker(stdout, 'WORKSPAI_AGENT_STREAMING_OK'),
    `${runtimeLabel} streaming did not deliver the first chunk before the model finished.`
  );
  return {
    streamingPartialSemantics,
    streamingMetadataInterleaving,
    streamingToolBoundary,
  };
}

function requireTelemetryEvidence(
  stdout: string,
  runtimeLabel: string
): {
  telemetryDefaultNonRecording: boolean;
  telemetryOptInRecording: boolean;
} {
  const telemetryDefaultNonRecording = readMarker(stdout, 'WORKSPAI_AGENT_TELEMETRY_DISABLED_OK');
  const telemetryOptInRecording = readMarker(stdout, 'WORKSPAI_AGENT_TELEMETRY_OPT_IN_OK');
  assertCondition(
    telemetryDefaultNonRecording,
    `${runtimeLabel} telemetry default-disabled non-recording span was not recorded.`
  );
  assertCondition(
    telemetryOptInRecording,
    `${runtimeLabel} telemetry opt-in recording span was not recorded.`
  );
  assertCondition(
    readMarker(stdout, 'WORKSPAI_AGENT_TELEMETRY_OK'),
    `${runtimeLabel} isolated-process telemetry evidence was incomplete.`
  );
  return { telemetryDefaultNonRecording, telemetryOptInRecording };
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
  const replacements: Array<[string, string]> = [
    [isolatedRoot, '<isolated-project>'],
    [reportRoot, '<conformance-artifact>'],
    [process.cwd(), '<cli-root>'],
    [os.homedir(), '<home>'],
    [os.tmpdir(), '<temporary-root>'],
  ];
  return replacements
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [source, replacement]) => result.split(source).join(replacement), value);
}

let isolatedCaches: { npm: string; pip: string; uv: string } | null = null;

function credentiallessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: 'true',
    NO_COLOR: '1',
  };
  for (const key of Object.keys(env)) {
    if (
      /^(GOOGLE_|GEMINI_|GCLOUD_|CLOUDSDK_|OPENAI_|AZURE_OPENAI_)/i.test(key) ||
      key === 'WORKSPAI_ADK_PROVIDER' ||
      key === 'ADK_MODEL'
    ) {
      delete env[key];
    }
  }
  delete env.WORKSPAI_AGENT_TRACING;
  if (isolatedCaches) {
    env.NPM_CONFIG_CACHE = isolatedCaches.npm;
    env.npm_config_cache = isolatedCaches.npm;
    env.PIP_CACHE_DIR = isolatedCaches.pip;
    env.UV_CACHE_DIR = isolatedCaches.uv;
    env.XDG_CACHE_HOME = isolatedCaches.uv;
  }
  return env;
}

function npmEnv(): NodeJS.ProcessEnv {
  const env = credentiallessEnv();
  // setup-node and Windows npm treat PREFIX as the project root. That would
  // make `npm install --prefix agents/...` look for package.json in cwd.
  delete env.npm_config_prefix;
  delete env.PREFIX;
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
      env: command === 'npm' ? npmEnv() : credentiallessEnv(),
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

async function writeAdmittedContext(root: string): Promise<void> {
  const contextPath = path.join(root, '.workspai', 'reports', 'project-context-agent.json');
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  await fs.rm(contextPath, { force: true });
  await fs.writeFile(
    contextPath,
    `${JSON.stringify({
      schemaVersion: 'project-context-agent.v1',
      boundary: LIFECYCLE_CONTEXT_MARKER,
      secret: 'do-not-leak',
    })}\n`,
    'utf8'
  );
}

async function materialize(files: AgentFrameworkManagedFile[], root: string): Promise<void> {
  for (const file of files) {
    const destination = path.resolve(root, file.path);
    if (!contained(root, destination)) throw new Error(`Rendered path escaped root: ${file.path}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, { encoding: 'utf8', flag: 'wx' });
  }
  await writeAdmittedContext(root);
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
    const sdkVersion = packageVersion(GOOGLE_ADK_PYTHON_BASELINE, 'google-adk');
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      `[project]\nname = "conformance"\ndependencies = ["google-adk==${sdkVersion}"]\n`,
      'utf8'
    );
    return;
  }
  const sdkVersion = packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, '@google/adk');
  await fs.writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'conformance', dependencies: { '@google/adk': sdkVersion } }, null, 2)}\n`,
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
  return runtime === 'python' ? googleAdkPythonAdapter : googleAdkTypeScriptAdapter;
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
    const [majorText, minorText] = process.versions.node.split('.');
    const major = Number(majorText);
    const minor = Number(minorText);
    assertCondition(
      Number.isFinite(major) &&
        Number.isFinite(minor) &&
        (major > 20 || (major === 20 && minor >= 19)),
      `Google ADK TypeScript conformance requires Node.js 20.19 or later; observed ${process.versions.node}.`
    );
  }
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), `workspai-adk-${runtime}-`));
  isolatedCaches = {
    npm: path.join(isolatedRoot, '.npm-cache'),
    pip: path.join(isolatedRoot, '.pip-cache'),
    uv: path.join(isolatedRoot, '.uv-cache'),
  };
  const evidenceDirectory = portablePath(
    path.join('evidence', adapter.manifest.adapter.id, platform)
  );
  const reportPath = path.join(reportRoot, `${adapter.manifest.adapter.id}-${platform}.json`);
  const checks: Check[] = [];
  let runtimeVersion = 'unavailable';
  let installedFrameworkPackages: Record<string, string> = {};
  let streamingEvidence: StreamingTelemetryEvidence = {
    streamingPartialSemantics: false,
    streamingMetadataInterleaving: false,
    streamingToolBoundary: false,
    telemetryDefaultNonRecording: false,
    telemetryOptInRecording: false,
  };

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
      const generatedSources = rendered.files
        .filter(
          (file) =>
            file.path.endsWith('.py') ||
            file.path.endsWith('.ts') ||
            file.path.endsWith('.mjs') ||
            file.path.endsWith('.js')
        )
        .map((file) => file.content)
        .join('\n');
      assertCondition(
        !generatedSources.includes('openai-agents') &&
          !generatedSources.includes('openaiAgentsTypeScriptContextSource') &&
          !generatedSources.includes('openaiAgentsPythonContextSource'),
        'Google generated sources still depend on the OpenAI adapter path.'
      );
      assertCondition(
        adapter.manifest.capabilities.streaming.support !== 'native' ||
          generatedSources.includes('on_text') ||
          generatedSources.includes('onText'),
        'Native streaming does not expose an incremental text callback.'
      );
      assertCondition(
        adapter.manifest.capabilities.telemetry.support !== 'conditional' ||
          ((generatedSources.includes('tracing_enabled') ||
            generatedSources.includes('tracingEnabled')) &&
            generatedSources.includes('OTEL_SDK_DISABLED')),
        'Conditional telemetry is not wired to WORKSPAI_AGENT_TRACING/OTEL_SDK_DISABLED.'
      );
      return {
        declarations: Object.fromEntries(
          Object.entries(adapter.manifest.capabilities).map(([id, value]) => [id, value.support])
        ),
        supportedWithoutEvidence,
        conditionalWithoutPrerequisites,
        streamingCallbackWired:
          generatedSources.includes('on_text') || generatedSources.includes('onText'),
        telemetryEnvWired: generatedSources.includes('OTEL_SDK_DISABLED'),
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
      const contextLoader = rendered.files.find(
        (file) =>
          file.path.endsWith('workspai-context.ts') || file.path.endsWith('workspai_context.py')
      );
      assertCondition(contextLoader, 'Canonical context loader was not rendered.');
      assertCondition(
        contextLoader.content.includes('.workspai/reports/project-context-agent.json'),
        'Rendered adapter files are not bound to canonical agent context.'
      );
      assertCondition(
        (contextLoader.content.includes('131_072') || contextLoader.content.includes('131072')) &&
          contextLoader.content.includes('project-context-agent.v1') &&
          contextLoader.content.includes('O_NOFOLLOW') &&
          (contextLoader.content.includes('realpathSync') ||
            contextLoader.content.includes('os.path.realpath')),
        'Canonical context loader does not enforce the 128 KiB boundary and host schemaVersion.'
      );
      assertCondition(
        contextLoader.content.includes('agents') &&
          (contextLoader.content.includes('resolveWorkspaiProjectRoot') ||
            contextLoader.content.includes('resolve_workspai_project_root')),
        'Canonical context loader does not bind to the agents/<instance> project-root contract.'
      );
      assertCondition(
        !contextLoader.content.includes('process.cwd()') &&
          !contextLoader.content.includes('Path.cwd'),
        'Canonical context loader still treats process cwd as project-root authority.'
      );
      const generatedTests = rendered.files.find((file) => file.path.includes('/tests/'));
      assertCondition(generatedTests, 'Credentialless context tests were not rendered.');
      assertCondition(
        generatedTests.content.includes('setUpClass') ||
          generatedTests.content.includes('restoreLiveContext') ||
          generatedTests.content.includes('bind_workspai_project_root_for_tests') ||
          generatedTests.content.includes('bindWorkspaiProjectRootForTests'),
        'Generated context tests neither isolate their fixture root nor restore operational context.'
      );
      const agentSource = rendered.files.find(
        (file) => file.path.endsWith('/agent.py') || file.path.endsWith('/agent.ts')
      );
      assertCondition(agentSource, 'Generated agent source was not rendered.');
      assertCondition(
        agentSource.content.includes('describe_workspai_context') &&
          agentSource.content.includes('read_workspai_project_summary') &&
          agentSource.content.includes('list_workspai_supported_commands') &&
          !agentSource.content.includes('<workspai-context>'),
        'Generated agent does not keep admitted context behind allowlisted read-only tools.'
      );
      return {
        entrypoint: context.entrypoint,
        contextBoundary: contextLoader.path,
        contextInputs: adapter.manifest.bindings.contextInputs,
        byteLimit: 131072,
        schemaVersion: 'project-context-agent.v1',
        projectRootContract: 'agents/<instance>',
        hostOwned: ['generation', 'freshness', 'integrity'],
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
          ['sync', '--python', '3.10', '--project', path.dirname(context.dependencyManifest)],
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
            "import importlib.metadata as m; print(m.version('google-adk'))",
          ],
          generatedRoot
        );
        const sdkVersion = packages.stdout.trim();
        assertCondition(
          sdkVersion === adapter.manifest.framework.testedVersions[0],
          `Installed google-adk ${sdkVersion || 'unknown'} does not match the tested baseline.`
        );
        installedFrameworkPackages = { 'google-adk': sdkVersion };
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
            'from google.adk.agents import LlmAgent; from google.adk.runners import Runner; from google.adk.sessions import InMemorySessionService',
          ],
          generatedRoot
        );
        await run(
          'uv',
          ['run', '--project', '.', 'python', '-m', 'unittest', 'discover', '-s', 'tests'],
          agentRoot
        );
        await writeAdmittedContext(generatedRoot);
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
          'Generated Python entrypoint started without a provider profile or credentials.'
        );
        assertCondition(
          /WORKSPAI_ADK_PROVIDER|GOOGLE_API_KEY|GOOGLE_GENAI_API_KEY|ADK_MODEL/.test(
            missingCredentials.stderr + missingCredentials.stdout
          ),
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
        const lifecycleHarness = path.join(agentRoot, 'credentialless-agent-lifecycle.py');
        await fs.writeFile(lifecycleHarness, pythonLifecycleHarness(), 'utf8');
        const lifecycle = await run(
          'uv',
          ['run', '--project', '.', 'python', lifecycleHarness],
          agentRoot
        );
        assertCondition(
          lifecycle.stdout.includes(LIFECYCLE_RESPONSE_MARKER),
          'Credentialless Python agent lifecycle did not return its admitted response.'
        );
        const cancellationHarness = path.join(agentRoot, 'credentialless-agent-cancellation.py');
        await fs.writeFile(cancellationHarness, pythonCancellationHarness(), 'utf8');
        const cancellation = await run(
          'uv',
          ['run', '--project', '.', 'python', cancellationHarness],
          agentRoot
        );
        assertCondition(
          cancellation.stdout.includes('WORKSPAI_AGENT_MAX_TURNS_OK'),
          'Python max_llm_calls cancellation did not stop the agent loop.'
        );
        const modelErrorHarness = path.join(agentRoot, 'credentialless-agent-model-error.py');
        await fs.writeFile(modelErrorHarness, pythonModelErrorHarness(), 'utf8');
        const modelError = await run(
          'uv',
          ['run', '--project', '.', 'python', modelErrorHarness],
          agentRoot
        );
        assertCondition(
          modelError.stdout.includes('WORKSPAI_AGENT_MODEL_ERROR_OK'),
          'Scripted model error did not fail the Python run.'
        );
        const cancelHarness = path.join(agentRoot, 'credentialless-agent-asyncio-cancel.py');
        await fs.writeFile(cancelHarness, pythonAsyncCancelHarness(), 'utf8');
        const asyncCancel = await run(
          'uv',
          ['run', '--project', '.', 'python', cancelHarness],
          agentRoot
        );
        assertCondition(
          asyncCancel.stdout.includes('WORKSPAI_AGENT_ASYNCIO_CANCEL_OK'),
          'In-flight asyncio cancellation did not stop the Python run.'
        );
        const timeoutHarness = path.join(agentRoot, 'credentialless-agent-timeout.py');
        await fs.writeFile(timeoutHarness, pythonTimeoutHarness(), 'utf8');
        const timedOut = await run(
          'uv',
          ['run', '--project', '.', 'python', timeoutHarness],
          agentRoot
        );
        assertCondition(
          timedOut.stdout.includes('WORKSPAI_AGENT_TIMEOUT_OK'),
          'Python asyncio.wait_for timeout did not stop the Google ADK run.'
        );
        const streamingHarness = path.join(agentRoot, 'credentialless-agent-streaming.py');
        await fs.writeFile(streamingHarness, pythonStreamingHarness(), 'utf8');
        const streamed = await run(
          'uv',
          ['run', '--project', '.', 'python', streamingHarness],
          agentRoot
        );
        const streamedEvidence = requireStreamingEvidence(streamed.stdout, 'Python');
        streamingEvidence = { ...streamingEvidence, ...streamedEvidence };
        const telemetryHarness = path.join(agentRoot, 'credentialless-agent-telemetry.py');
        await fs.writeFile(telemetryHarness, pythonTelemetryHarness(), 'utf8');
        const telemetry = await run(
          'uv',
          ['run', '--project', '.', 'python', telemetryHarness],
          agentRoot
        );
        const telemetryFlags = requireTelemetryEvidence(telemetry.stdout, 'Python');
        streamingEvidence = { ...streamingEvidence, ...telemetryFlags };
        const venvRoot = path.join(isolatedRoot, 'pip-venv');
        const bootstrapPython = process.platform === 'win32' ? 'python' : 'python3';
        await run(bootstrapPython, ['-m', 'venv', venvRoot], generatedRoot);
        const venvPython =
          process.platform === 'win32'
            ? path.join(venvRoot, 'Scripts', 'python.exe')
            : path.join(venvRoot, 'bin', 'python');
        await run(venvPython, ['-m', 'pip', 'install', '-U', 'pip', 'setuptools'], generatedRoot);
        await run(
          venvPython,
          ['-m', 'pip', 'install', '-e', path.dirname(context.dependencyManifest)],
          generatedRoot
        );
        const pipImport = await run(
          venvPython,
          [
            '-c',
            "import workspai_context; print('WORKSPAI_PIP_EDITABLE_OK ' + workspai_context.CONTEXT_SCHEMA_VERSION)",
          ],
          agentRoot
        );
        assertCondition(
          pipImport.stdout.includes('WORKSPAI_PIP_EDITABLE_OK'),
          'pip install -e did not import the generated Workspai context module.'
        );
        await writeAdmittedContext(generatedRoot);
        await run(venvPython, ['-m', 'unittest', 'discover', '-s', 'tests'], agentRoot);
        const toolErrorHarness = path.join(agentRoot, 'credentialless-agent-tool-error.py');
        await fs.writeFile(toolErrorHarness, pythonToolErrorHarness(), 'utf8');
        const toolError = await run(
          'uv',
          ['run', '--project', '.', 'python', toolErrorHarness],
          agentRoot
        );
        assertCondition(
          toolError.stdout.includes('WORKSPAI_AGENT_TOOL_ERROR_OK'),
          'Python tool error was not isolated to the context boundary.'
        );
      } else {
        runtimeVersion = process.versions.node;
        // Windows npm ignores `install --prefix <relative>` and reads
        // package.json from cwd. Run inside the generated agent package.
        assertCondition(
          rendered.files.some((file) => file.path === context.dependencyManifest),
          `Rendered TypeScript files do not include ${context.dependencyManifest}.`
        );
        await run('npm', ['install', '--no-fund', '--no-audit'], agentRoot);
        const installed = JSON.parse(
          await fs.readFile(
            path.join(agentRoot, 'node_modules', '@google', 'adk', 'package.json'),
            'utf8'
          )
        ) as { version?: unknown };
        assertCondition(
          installed.version === adapter.manifest.framework.testedVersions[0],
          `Installed @google/adk ${String(installed.version)} does not match the tested baseline.`
        );
        const expectedZod = packageVersion(GOOGLE_ADK_TYPESCRIPT_BASELINE, 'zod');
        const zodPackage = JSON.parse(
          await fs.readFile(path.join(agentRoot, 'node_modules', 'zod', 'package.json'), 'utf8')
        ) as { version?: unknown };
        assertCondition(
          zodPackage.version === expectedZod,
          `Installed zod ${String(zodPackage.version)} is not the pinned peer ${expectedZod}.`
        );
        installedFrameworkPackages = {
          '@google/adk': String(installed.version),
          zod: String(zodPackage.version),
        };
        await run('npm', ['test'], agentRoot);
        await writeAdmittedContext(generatedRoot);
        const missingCredentials = await run(
          process.execPath,
          [path.join(agentRoot, 'dist', 'src', 'main.js')],
          generatedRoot,
          { allowFailure: true }
        );
        assertCondition(
          missingCredentials.code !== 0,
          'Generated TypeScript entrypoint started without a provider profile or credentials.'
        );
        assertCondition(
          /WORKSPAI_ADK_PROVIDER|GOOGLE_API_KEY|GOOGLE_GENAI_API_KEY|ADK_MODEL/.test(
            missingCredentials.stderr + missingCredentials.stdout
          ),
          'Missing-credential failure did not report the required environment name.'
        );
        const redaction = await run(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import { redactSdkError } from './agents/conformance-agent/dist/src/agent.js'; const secret='sk-EXAMPLESECRETVALUE'; const redacted=redactSdkError('provider failed '+secret+' AccountKey=SECRETKEYVALUE'); if (redacted.includes(secret) || redacted.includes('SECRETKEYVALUE') || !redacted.includes('[redacted]')) { throw new Error('redaction failed'); } process.stdout.write('WORKSPAI_AGENT_REDACTION_OK\\n');",
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
          cancellation.stdout.includes('WORKSPAI_AGENT_MAX_TURNS_OK'),
          'TypeScript maxLlmCalls cancellation did not stop the agent loop.'
        );
        const abortHarness = path.join(agentRoot, 'credentialless-agent-abort.mjs');
        await fs.writeFile(abortHarness, typeScriptInFlightAbortHarness(), 'utf8');
        const aborted = await run(process.execPath, [abortHarness], agentRoot);
        assertCondition(
          aborted.stdout.includes('WORKSPAI_AGENT_ABORT_OK'),
          'In-flight AbortSignal cancellation did not stop the agent loop.'
        );
        const timeoutHarness = path.join(agentRoot, 'credentialless-agent-timeout.mjs');
        await fs.writeFile(timeoutHarness, typeScriptTimeoutHarness(), 'utf8');
        const timedOut = await run(process.execPath, [timeoutHarness], agentRoot);
        assertCondition(
          timedOut.stdout.includes('WORKSPAI_AGENT_TIMEOUT_OK'),
          'TypeScript AbortSignal.timeout did not stop the Google ADK run.'
        );
        const streamingHarness = path.join(agentRoot, 'credentialless-agent-streaming.mjs');
        await fs.writeFile(streamingHarness, typeScriptStreamingHarness(), 'utf8');
        const streamed = await run(process.execPath, [streamingHarness], agentRoot);
        const streamedEvidence = requireStreamingEvidence(streamed.stdout, 'TypeScript');
        streamingEvidence = { ...streamingEvidence, ...streamedEvidence };
        const telemetryHarness = path.join(agentRoot, 'credentialless-agent-telemetry.mjs');
        await fs.writeFile(telemetryHarness, typeScriptTelemetryHarness(), 'utf8');
        const telemetry = await run(process.execPath, [telemetryHarness], agentRoot);
        const telemetryFlags = requireTelemetryEvidence(telemetry.stdout, 'TypeScript');
        streamingEvidence = { ...streamingEvidence, ...telemetryFlags };
        const modelErrorHarness = path.join(agentRoot, 'credentialless-agent-model-error.mjs');
        await fs.writeFile(modelErrorHarness, typeScriptModelErrorHarness(), 'utf8');
        const modelError = await run(process.execPath, [modelErrorHarness], agentRoot);
        assertCondition(
          modelError.stdout.includes('WORKSPAI_AGENT_MODEL_ERROR_OK'),
          'Scripted model error did not fail the TypeScript run.'
        );
        if (process.platform !== 'win32') {
          const prefix = path.dirname(context.dependencyManifest).split(path.sep).join('/');
          await run('npm', ['--prefix', prefix, 'test'], generatedRoot);
          const prefixedStart = await run('npm', ['--prefix', prefix, 'start'], generatedRoot, {
            allowFailure: true,
          });
          assertCondition(
            prefixedStart.code !== 0,
            'Documented npm --prefix start started without a provider profile or credentials.'
          );
          assertCondition(
            /WORKSPAI_ADK_PROVIDER|GOOGLE_GENAI_API_KEY|ADK_MODEL/.test(
              prefixedStart.stderr + prefixedStart.stdout
            ),
            'Documented npm --prefix start did not report the missing credential.'
          );
        }
        const toolErrorHarness = path.join(agentRoot, 'credentialless-agent-tool-error.mjs');
        await fs.writeFile(toolErrorHarness, typeScriptToolErrorHarness(), 'utf8');
        const toolError = await run(process.execPath, [toolErrorHarness], agentRoot);
        assertCondition(
          toolError.stdout.includes('WORKSPAI_AGENT_TOOL_ERROR_OK'),
          'TypeScript tool error was not isolated to the context boundary.'
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
        streamingPartialSemantics: streamingEvidence.streamingPartialSemantics,
        streamingMetadataInterleaving: streamingEvidence.streamingMetadataInterleaving,
        streamingToolBoundary: streamingEvidence.streamingToolBoundary,
        telemetryDefaultNonRecording: streamingEvidence.telemetryDefaultNonRecording,
        telemetryOptInRecording: streamingEvidence.telemetryOptInRecording,
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
      assertCondition(
        streamingEvidence.streamingPartialSemantics &&
          streamingEvidence.streamingMetadataInterleaving &&
          streamingEvidence.streamingToolBoundary,
        'Streaming handshake was not observed.'
      );
      assertCondition(
        streamingEvidence.telemetryDefaultNonRecording && streamingEvidence.telemetryOptInRecording,
        'Disabled-by-default telemetry was not observed.'
      );
      return {
        networkDefault: adapter.manifest.security.network,
        generatedCodeExecutionDefault: adapter.manifest.security.generatedCodeExecution,
        planningAndRenderingRequireRuntimeExecution: false,
        runtimeVerificationNetworkWasExplicitlyGrantedByCiLane: true,
        tracingDisabledUnlessOptedIn: streamingEvidence.telemetryDefaultNonRecording,
        firstStreamChunkBeforeRunCompleted: streamingEvidence.streamingPartialSemantics,
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
      implementationSha256: digestBuiltinAgentFrameworkImplementation(adapter),
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
      'Conformance compiles the generated entrypoint and executes a bounded context-to-agent-to-response lifecycle with a local BaseLlm subclass. It does not monkey-patch private SDK internals.',
      'Paid or live Gemini Developer API and Vertex AI execution was not performed and is not admission evidence.',
      'Python and TypeScript are independent ADK runtimes. This report does not claim the other language runtime.',
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
  if (report.verdict !== 'admitted') {
    for (const blocker of report.blockers) {
      process.stdout.write(`blocker: ${blocker}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
