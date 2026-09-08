import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH,
  AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION,
  type AgentFrameworkAdmissionCandidate,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';
import { hashCanonicalJson } from '../workspace-model-hash.js';
import type { AgentFrameworkAdapter } from './adapter.js';
import {
  BUILTIN_AGENT_FRAMEWORK_ADAPTERS,
  digestBuiltinAgentFrameworkManifest,
} from './builtins.js';
import { assessAgentFrameworkAdmission } from './conformance.js';

const MAX_CANDIDATE_INPUT_BYTES = 2 * 1024 * 1024;

function laneKey(report: AgentFrameworkConformanceReport): string {
  return `${report.adapter.id}\0${report.environment.platform}\0${report.environment.runtime}\0${report.frameworkVersion}`;
}

function portable(value: string): string {
  return value.split(path.sep).join('/');
}

async function containedFile(rootInput: string, relativePath: string): Promise<string> {
  const root = await fs.realpath(rootInput);
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Admission candidate input escapes its evidence root: ${relativePath}`);
  }
  const realCandidate = await fs.realpath(candidate);
  const realRelative = path.relative(root, realCandidate);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error(
      `Admission candidate input resolves outside its evidence root: ${relativePath}`
    );
  }
  const stat = await fs.stat(realCandidate);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CANDIDATE_INPUT_BYTES) {
    throw new Error(`Admission candidate input is not a bounded regular file: ${relativePath}`);
  }
  return realCandidate;
}

async function digestContainedFile(rootInput: string, relativePath: string): Promise<string> {
  return createHash('sha256')
    .update(await fs.readFile(await containedFile(rootInput, relativePath)))
    .digest('hex');
}

export async function buildAgentFrameworkAdmissionCandidate(input: {
  evidenceRoot: string;
  reportPaths: string[];
  reports: AgentFrameworkConformanceReport[];
  sourceCommit: string;
  cliVersion: string;
  adapters?: readonly AgentFrameworkAdapter[];
  generatedAt?: string;
}): Promise<AgentFrameworkAdmissionCandidate> {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(input.sourceCommit)) {
    throw new Error('sourceCommit must be a lowercase 40- or 64-character commit digest.');
  }
  if (input.reportPaths.length !== input.reports.length) {
    throw new Error('Every conformance report must have exactly one source path.');
  }
  const adapters = input.adapters ?? BUILTIN_AGENT_FRAMEWORK_ADAPTERS;
  const sourcePaths = new Map<string, string>();
  input.reports.forEach((report, index) => {
    const key = laneKey(report);
    if (sourcePaths.has(key)) throw new Error(`Duplicate conformance lane: ${key}`);
    const sourcePath = input.reportPaths[index];
    if (!sourcePath) throw new Error(`Conformance report path is unavailable: ${key}`);
    sourcePaths.set(key, sourcePath);
  });

  const candidateAdapters = await Promise.all(
    adapters.map(async (adapter) => {
      const reports = input.reports
        .filter((report) => report.adapter.id === adapter.manifest.adapter.id)
        .sort((left, right) => laneKey(left).localeCompare(laneKey(right)));
      const manifestSha256 = digestBuiltinAgentFrameworkManifest(adapter);
      const assessment = assessAgentFrameworkAdmission({
        manifest: adapter.manifest,
        manifestSha256,
        reports,
      });
      if (assessment.status !== 'admitted') {
        throw new Error(
          `Cannot build admission candidate for ${adapter.manifest.adapter.id}: ${assessment.blockers.join('; ')}`
        );
      }
      return {
        id: adapter.manifest.adapter.id,
        version: adapter.manifest.adapter.version,
        manifestSha256,
        framework: { id: adapter.manifest.framework.id },
        lanes: await Promise.all(
          reports.map(async (report) => {
            const reportPath = sourcePaths.get(laneKey(report));
            if (!reportPath) throw new Error(`Cannot locate report for ${laneKey(report)}.`);
            const persistedReport = JSON.parse(
              await fs.readFile(await containedFile(input.evidenceRoot, reportPath), 'utf8')
            ) as unknown;
            if (hashCanonicalJson(persistedReport) !== hashCanonicalJson(report)) {
              throw new Error(`Persisted conformance report does not match ${laneKey(report)}.`);
            }
            const evidencePaths = report.checks
              .flatMap((check) => check.evidencePaths)
              .sort((left, right) => left.localeCompare(right));
            return {
              platform: report.environment.platform,
              runtime: report.environment.runtime,
              runtimeVersion: report.environment.runtimeVersion,
              frameworkVersion: report.frameworkVersion,
              report: {
                path: portable(reportPath),
                sha256: await digestContainedFile(input.evidenceRoot, reportPath),
              },
              evidence: await Promise.all(
                evidencePaths.map(async (evidencePath) => ({
                  path: portable(evidencePath),
                  sha256: await digestContainedFile(input.evidenceRoot, evidencePath),
                }))
              ),
            };
          })
        ),
      };
    })
  );
  const candidate: AgentFrameworkAdmissionCandidate = {
    schemaVersion: AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceCommit: input.sourceCommit,
    cliVersion: input.cliVersion,
    reviewStatus: 'pending',
    adapters: candidateAdapters,
    verdict: 'admitted',
    blockers: [],
  };
  assertJsonSchemaContract(
    candidate,
    AGENT_FRAMEWORK_ADMISSION_CANDIDATE_CONTRACT_PATH,
    'Agent framework admission candidate'
  );
  return candidate;
}
