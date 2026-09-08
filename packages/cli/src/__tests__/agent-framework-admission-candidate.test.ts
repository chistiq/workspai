import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildAgentFrameworkAdmissionCandidate } from '../agent-frameworks/admission-candidate.js';
import {
  digestBuiltinAgentFrameworkManifest,
  microsoftAgentFrameworkPythonAdapter,
} from '../agent-frameworks/index.js';
import {
  AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
  AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION,
  AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';

const temporaryRoots: string[] = [];

function report(platform: 'linux' | 'darwin' | 'win32'): AgentFrameworkConformanceReport {
  const adapter = microsoftAgentFrameworkPythonAdapter;
  const checks = AGENT_FRAMEWORK_CONFORMANCE_CHECK_IDS.map((id) => ({
    id,
    status: 'passed' as const,
    required: true,
    summary: `${id} passed`,
    evidencePaths: [`evidence/${adapter.manifest.adapter.id}/${platform}/${id}.json`],
    durationMs: 1,
  }));
  return {
    schemaVersion: AGENT_FRAMEWORK_CONFORMANCE_REPORT_SCHEMA_VERSION,
    protocolVersion: AGENT_FRAMEWORK_ADAPTER_PROTOCOL_VERSION,
    generatedAt: '2026-09-06T00:00:00.000Z',
    adapter: {
      id: adapter.manifest.adapter.id,
      version: adapter.manifest.adapter.version,
      manifestSha256: digestBuiltinAgentFrameworkManifest(adapter),
    },
    frameworkVersion: adapter.manifest.framework.testedVersions[0],
    cliVersion: '0.74.0',
    environment: { platform, architecture: 'x64', runtime: 'python', runtimeVersion: '3.10.21' },
    checks,
    summary: { passed: checks.length, failed: 0, skipped: 0, required: checks.length },
    verdict: 'admitted',
    blockers: [],
    limitations: [],
  };
}

async function fixture(): Promise<{
  root: string;
  reports: AgentFrameworkConformanceReport[];
  reportPaths: string[];
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspai-agent-admission-'));
  temporaryRoots.push(root);
  const reports = (['linux', 'darwin', 'win32'] as const).map(report);
  const reportPaths: string[] = [];
  for (const lane of reports) {
    for (const check of lane.checks) {
      const evidencePath = path.join(root, check.evidencePaths[0]);
      await fs.mkdir(path.dirname(evidencePath), { recursive: true });
      await fs.writeFile(
        evidencePath,
        `${JSON.stringify({ checkId: check.id, platform: lane.environment.platform })}\n`
      );
    }
    const reportPath = `${lane.adapter.id}-${lane.environment.platform}.json`;
    await fs.writeFile(path.join(root, reportPath), `${JSON.stringify(lane, null, 2)}\n`);
    reportPaths.push(reportPath);
  }
  return { root, reports, reportPaths };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })));
});

describe('agent framework admission candidate', () => {
  it('binds an admitted platform matrix to its commit, reports, and evidence', async () => {
    const input = await fixture();
    const candidate = await buildAgentFrameworkAdmissionCandidate({
      evidenceRoot: input.root,
      reportPaths: input.reportPaths,
      reports: input.reports,
      sourceCommit: 'a'.repeat(40),
      cliVersion: '0.74.0',
      adapters: [microsoftAgentFrameworkPythonAdapter],
      generatedAt: '2026-09-06T00:00:00.000Z',
    });

    expect(candidate.schemaVersion).toBe(AGENT_FRAMEWORK_ADMISSION_CANDIDATE_SCHEMA_VERSION);
    expect(candidate.reviewStatus).toBe('pending');
    expect(candidate.adapters[0].lanes).toHaveLength(3);
    expect(candidate.adapters[0].lanes.every((lane) => lane.evidence.length === 18)).toBe(true);
    expect(candidate.adapters[0].lanes[0].report.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a report changed after conformance validation', async () => {
    const input = await fixture();
    await fs.writeFile(
      path.join(input.root, input.reportPaths[0]),
      `${JSON.stringify({ ...input.reports[0], cliVersion: 'tampered' })}\n`
    );

    await expect(
      buildAgentFrameworkAdmissionCandidate({
        evidenceRoot: input.root,
        reportPaths: input.reportPaths,
        reports: input.reports,
        sourceCommit: 'a'.repeat(40),
        cliVersion: '0.74.0',
        adapters: [microsoftAgentFrameworkPythonAdapter],
      })
    ).rejects.toThrow('Persisted conformance report does not match');
  });
});
