import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILTIN_AGENT_FRAMEWORK_ADAPTERS,
  digestBuiltinAgentFrameworkManifest,
} from '../src/agent-frameworks/index.js';
import {
  AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH,
  type AgentFrameworkAdmissionCandidate,
} from '../src/contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../src/utils/json-schema-contract.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const candidatePath = path.resolve(requiredArgument('--candidate'));
  const outputPath = path.resolve(requiredArgument('--output'));
  const repository = requiredArgument('--repository');
  const workflowRunId = Number(requiredArgument('--workflow-run-id'));
  if (repository !== 'chistiq/workspai') throw new Error('Unexpected admission repository.');
  if (!Number.isSafeInteger(workflowRunId) || workflowRunId <= 0) {
    throw new Error('Workflow run id must be a positive safe integer.');
  }
  const candidate = JSON.parse(
    await fs.readFile(candidatePath, 'utf8')
  ) as AgentFrameworkAdmissionCandidate;
  assertJsonSchemaContract(
    candidate,
    AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH,
    'Agent framework admission candidate'
  );
  if (candidate.verdict !== 'admitted' || candidate.blockers.length > 0) {
    throw new Error('Only an unblocked admitted candidate can be promoted.');
  }
  const adapters = BUILTIN_AGENT_FRAMEWORK_ADAPTERS.map((adapter) => {
    const admitted = candidate.adapters.find((entry) => entry.id === adapter.manifest.adapter.id);
    if (!admitted) throw new Error(`Candidate is missing ${adapter.manifest.adapter.id}.`);
    const manifestSha256 = digestBuiltinAgentFrameworkManifest(adapter);
    if (
      admitted.version !== adapter.manifest.adapter.version ||
      admitted.manifestSha256 !== manifestSha256
    ) {
      throw new Error(`Candidate does not bind the live ${adapter.manifest.adapter.id} manifest.`);
    }
    const expectedPlatforms = [...adapter.manifest.implementation.platforms].sort();
    const platforms = [...new Set(admitted.lanes.map((lane) => lane.platform))].sort();
    const runtime = adapter.manifest.implementation.runtimes[0];
    const frameworkVersion = adapter.manifest.framework.testedVersions[0];
    if (
      JSON.stringify(platforms) !== JSON.stringify(expectedPlatforms) ||
      admitted.lanes.some(
        (lane) => lane.runtime !== runtime || lane.frameworkVersion !== frameworkVersion
      )
    ) {
      throw new Error(`Candidate matrix is incomplete for ${adapter.manifest.adapter.id}.`);
    }
    return {
      id: admitted.id,
      version: admitted.version,
      manifestSha256,
      frameworkVersion,
      runtime,
      platforms,
    };
  });
  if (candidate.adapters.length !== adapters.length) {
    throw new Error('Candidate contains an unexpected adapter admission.');
  }
  const document = {
    schemaVersion: 'workspai.agent-framework-release-admissions.v1',
    reviewedAt: candidate.generatedAt,
    source: {
      repository,
      commit: candidate.sourceCommit,
      workflowRunId,
      workflowUrl: `https://github.com/${repository}/actions/runs/${workflowRunId}`,
      conclusion: 'success',
    },
    adapters,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`WROTE release admission ${outputPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
