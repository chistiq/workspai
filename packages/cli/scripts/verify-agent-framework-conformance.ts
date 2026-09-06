import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assessAgentFrameworkAdmission,
  BUILTIN_AGENT_FRAMEWORK_ADAPTERS,
  digestBuiltinAgentFrameworkManifest,
  loadAgentFrameworkConformanceReport,
} from '../src/agent-frameworks/index.js';
import { buildAgentFrameworkAdmissionCandidate } from '../src/agent-frameworks/admission-candidate.js';
import type { AgentFrameworkConformanceReport } from '../src/contracts/agent-framework-contract.js';

const REPORT_NAME = /^microsoft-agent-framework-(python|dotnet)-(linux|darwin|win32)\.json$/;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const CANDIDATE_NAME = 'agent-framework-admission-candidate.json';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function cliVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await fs.readFile(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')
  ) as { version?: unknown };
  if (typeof packageJson.version !== 'string')
    throw new Error('CLI package version is unavailable.');
  return packageJson.version;
}

async function reportFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = ['.'];
  while (queue.length > 0) {
    const relativeDirectory = queue.shift();
    if (!relativeDirectory) break;
    const directory = path.resolve(root, relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory() && entry.name !== 'evidence') queue.push(relativePath);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        if (entry.name === CANDIDATE_NAME) continue;
        if (!REPORT_NAME.test(entry.name)) {
          throw new Error(`Unexpected JSON outside the evidence tree: ${relativePath}`);
        }
        files.push(relativePath);
      }
    }
  }
  return files.sort();
}

async function verifyEvidence(
  root: string,
  report: AgentFrameworkConformanceReport
): Promise<void> {
  const seenEvidence = new Set<string>();
  for (const check of report.checks) {
    for (const evidencePath of check.evidencePaths) {
      const expectedPrefix = `evidence/${report.adapter.id}/${report.environment.platform}/`;
      if (!evidencePath.startsWith(expectedPrefix)) {
        throw new Error(`Evidence is outside its adapter lane: ${evidencePath}`);
      }
      if (seenEvidence.has(evidencePath)) {
        throw new Error(`Evidence path is reused across checks: ${evidencePath}`);
      }
      seenEvidence.add(evidencePath);
      if (path.isAbsolute(evidencePath))
        throw new Error(`Evidence path is absolute: ${evidencePath}`);
      const lexicalPath = path.resolve(root, evidencePath);
      if (!contained(root, lexicalPath))
        throw new Error(`Evidence path escapes root: ${evidencePath}`);
      const realPath = await fs.realpath(lexicalPath).catch(() => {
        throw new Error(`Evidence is unavailable: ${evidencePath}`);
      });
      if (!contained(root, realPath))
        throw new Error(`Evidence resolves outside root: ${evidencePath}`);
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) throw new Error(`Evidence is not a regular file: ${evidencePath}`);
      if (stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
        throw new Error(`Evidence size is outside the admitted boundary: ${evidencePath}`);
      }
      const evidence = JSON.parse(await fs.readFile(realPath, 'utf8')) as {
        checkId?: unknown;
        adapterId?: unknown;
        platform?: unknown;
        runtime?: unknown;
      };
      if (
        evidence.checkId !== check.id ||
        evidence.adapterId !== report.adapter.id ||
        evidence.platform !== report.environment.platform ||
        evidence.runtime !== report.environment.runtime
      ) {
        throw new Error(`Evidence identity does not match its report check: ${evidencePath}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const input = argument('--reports');
  if (!input) throw new Error('Usage: --reports <conformance-artifact-directory>');
  const root = await fs.realpath(path.resolve(input));
  const files = await reportFiles(root);
  if (files.length === 0) throw new Error('No agent framework conformance reports were found.');
  const reports = await Promise.all(
    files.map((file) => loadAgentFrameworkConformanceReport(root, file))
  );
  const expectedCliVersion = await cliVersion();
  const blockers: string[] = [];

  await Promise.all(reports.map((report) => verifyEvidence(root, report)));
  for (const [index, report] of reports.entries()) {
    const expectedName = `${report.adapter.id}-${report.environment.platform}.json`;
    const sourceFile = files[index];
    if (!sourceFile || path.basename(sourceFile) !== expectedName) {
      blockers.push(
        `${report.adapter.id}/${report.environment.platform}: report filename does not match its identity`
      );
    }
    if (report.cliVersion !== expectedCliVersion) {
      blockers.push(
        `${report.adapter.id}/${report.environment.platform}: CLI version ${report.cliVersion} does not match ${expectedCliVersion}`
      );
    }
  }

  for (const adapter of BUILTIN_AGENT_FRAMEWORK_ADAPTERS) {
    const adapterReports = reports.filter(
      (report) => report.adapter.id === adapter.manifest.adapter.id
    );
    const assessment = assessAgentFrameworkAdmission({
      manifest: adapter.manifest,
      manifestSha256: digestBuiltinAgentFrameworkManifest(adapter),
      reports: adapterReports,
    });
    if (assessment.status !== 'admitted') blockers.push(...assessment.blockers);
    process.stdout.write(
      `${assessment.status === 'admitted' ? 'PASS' : 'FAIL'} ${adapter.manifest.adapter.id}: ${assessment.admittedLanes.length}/${assessment.requiredLanes.length} lanes admitted\n`
    );
  }

  const knownAdapterIds = new Set(
    BUILTIN_AGENT_FRAMEWORK_ADAPTERS.map((adapter) => adapter.manifest.adapter.id)
  );
  for (const report of reports) {
    if (!knownAdapterIds.has(report.adapter.id)) {
      blockers.push(`Unknown built-in adapter report: ${report.adapter.id}`);
    }
  }
  if (blockers.length > 0) {
    throw new Error(
      `Agent framework conformance matrix is blocked:\n- ${[...new Set(blockers)].join('\n- ')}`
    );
  }
  const candidatePath = argument('--write-candidate');
  if (candidatePath) {
    const sourceCommit = argument('--source-commit');
    if (!sourceCommit) {
      throw new Error('--source-commit is required when --write-candidate is used.');
    }
    const candidate = await buildAgentFrameworkAdmissionCandidate({
      evidenceRoot: root,
      reportPaths: files,
      reports,
      sourceCommit,
      cliVersion: expectedCliVersion,
    });
    const output = path.resolve(candidatePath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(candidate, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`WROTE admission candidate ${output}\n`);
  }
  process.stdout.write(
    `PASS complete agent framework conformance matrix (${reports.length} reports)\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
