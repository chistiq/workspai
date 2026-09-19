import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  validateAgentFrameworkConformanceReport,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

export const AGENT_FRAMEWORK_ADMISSION_PLATFORMS = ['linux', 'darwin', 'win32'] as const;

export type AgentFrameworkAdmissionPlatform = (typeof AGENT_FRAMEWORK_ADMISSION_PLATFORMS)[number];

export type AgentFrameworkConformanceLane = {
  platform: AgentFrameworkAdmissionPlatform;
  runtime: string;
  frameworkVersion: string;
};

function isAdmissionPlatform(value: string): value is AgentFrameworkAdmissionPlatform {
  return (AGENT_FRAMEWORK_ADMISSION_PLATFORMS as readonly string[]).includes(value);
}

export function implementationSha256ByPlatformFromReports(
  reports: readonly AgentFrameworkConformanceReport[]
): Partial<Record<AgentFrameworkAdmissionPlatform, string>> {
  const map: Partial<Record<AgentFrameworkAdmissionPlatform, string>> = {};
  for (const report of reports) {
    const platform = report.environment.platform;
    const digest = report.adapter.implementationSha256;
    if (!isAdmissionPlatform(platform)) {
      throw new Error(`Conformance report platform is not admitted: ${platform}`);
    }
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Conformance ${platform} implementation digest is malformed.`);
    }
    const existing = map[platform];
    if (existing && existing !== digest) {
      throw new Error(`Conflicting implementation digest for ${platform}.`);
    }
    map[platform] = digest;
  }
  return map;
}

export function requireCompleteImplementationDigestMap(
  map: Partial<Record<AgentFrameworkAdmissionPlatform, string>>
): Record<AgentFrameworkAdmissionPlatform, string> {
  for (const platform of AGENT_FRAMEWORK_ADMISSION_PLATFORMS) {
    if (!/^[a-f0-9]{64}$/.test(map[platform] ?? '')) {
      throw new Error(`Missing implementation digest for ${platform}.`);
    }
  }
  return map as Record<AgentFrameworkAdmissionPlatform, string>;
}

export function liveImplementationDigestBlockers(input: {
  liveImplementationSha256: string;
  implementationSha256ByPlatform: Partial<Record<AgentFrameworkAdmissionPlatform, string>>;
  platform?: string;
}): string[] {
  const platform = input.platform ?? process.platform;
  if (!isAdmissionPlatform(platform)) {
    return [`host platform ${platform} is not an admitted qualification platform`];
  }
  if (input.implementationSha256ByPlatform[platform] !== input.liveImplementationSha256) {
    return [`live implementation digest does not match ${platform} evidence`];
  }
  return [];
}

export type AgentFrameworkAdmissionAssessment = {
  status: 'admitted' | 'blocked';
  requiredLanes: AgentFrameworkConformanceLane[];
  admittedLanes: AgentFrameworkConformanceLane[];
  blockers: string[];
};

function laneKey(lane: AgentFrameworkConformanceLane): string {
  return `${lane.platform}\0${lane.runtime}\0${lane.frameworkVersion}`;
}

function laneLabel(lane: AgentFrameworkConformanceLane): string {
  return `${lane.platform}/${lane.runtime}/${lane.frameworkVersion}`;
}

function requiredLanes(manifest: AgentFrameworkAdapterManifest): AgentFrameworkConformanceLane[] {
  return manifest.implementation.platforms.flatMap((platform) =>
    manifest.implementation.runtimes.flatMap((runtime) =>
      manifest.framework.testedVersions.map((frameworkVersion) => ({
        platform,
        runtime,
        frameworkVersion,
      }))
    )
  );
}

export function assessAgentFrameworkAdmission(input: {
  manifest: AgentFrameworkAdapterManifest;
  manifestSha256: string;
  implementationSha256?: string;
  implementationSha256ByPlatform?: Partial<
    Record<AgentFrameworkConformanceLane['platform'], string>
  >;
  reports: AgentFrameworkConformanceReport[];
}): AgentFrameworkAdmissionAssessment {
  const blockers: string[] = [];
  try {
    assertJsonSchemaContract(
      input.manifest,
      AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
      'Agent framework manifest'
    );
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  blockers.push(
    ...validateAgentFrameworkAdapterManifest(input.manifest).map(
      (violation) => `manifest: ${violation}`
    )
  );
  const required = requiredLanes(input.manifest);
  const admittedByLane = new Map<string, AgentFrameworkConformanceLane>();
  const seenReportLanes = new Set<string>();

  for (const report of input.reports) {
    let reportBlocked = false;
    const lane = {
      platform: report.environment.platform,
      runtime: report.environment.runtime,
      frameworkVersion: report.frameworkVersion,
    } as AgentFrameworkConformanceLane;
    const key = laneKey(lane);
    const label = laneLabel(lane);
    if (seenReportLanes.has(key)) {
      blockers.push(`duplicate conformance report for ${label}`);
      continue;
    }
    seenReportLanes.add(key);
    try {
      assertJsonSchemaContract(
        report,
        AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
        `Agent framework conformance ${label}`
      );
    } catch (error) {
      reportBlocked = true;
      blockers.push(error instanceof Error ? error.message : String(error));
    }
    for (const violation of validateAgentFrameworkConformanceReport(report)) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: ${violation}`);
    }
    if (
      report.adapter.id !== input.manifest.adapter.id ||
      report.adapter.version !== input.manifest.adapter.version
    ) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: adapter identity does not match the manifest`);
    }
    if (report.adapter.manifestSha256 !== input.manifestSha256) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: manifest digest does not match`);
    }
    const expectedImplementationDigest =
      input.implementationSha256ByPlatform?.[lane.platform] ?? input.implementationSha256;
    if (
      !expectedImplementationDigest ||
      report.adapter.implementationSha256 !== expectedImplementationDigest
    ) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: implementation digest does not match`);
    }
    if (!input.manifest.implementation.platforms.includes(lane.platform)) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: platform is not advertised by the manifest`);
    }
    if (!input.manifest.implementation.runtimes.includes(lane.runtime)) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: runtime is not advertised by the manifest`);
    }
    if (!input.manifest.framework.testedVersions.includes(lane.frameworkVersion)) {
      reportBlocked = true;
      blockers.push(`conformance ${label}: framework version is not in the tested baseline`);
    }
    if (report.verdict !== 'admitted') {
      reportBlocked = true;
      if (report.blockers.length === 0) {
        blockers.push(`conformance ${label}: report verdict is blocked`);
      } else {
        blockers.push(...report.blockers.map((blocker) => `conformance ${label}: ${blocker}`));
      }
    }
    if (report.verdict === 'admitted' && !reportBlocked) {
      admittedByLane.set(key, lane);
    }
  }

  for (const lane of required) {
    if (!admittedByLane.has(laneKey(lane))) {
      blockers.push(
        `missing admitted lane: ${lane.platform}/${lane.runtime}/${lane.frameworkVersion}`
      );
    }
  }
  if (input.manifest.adapter.stability === 'experimental') {
    blockers.push('experimental adapters are not selectable');
  }
  if (input.manifest.adapter.stability === 'deprecated') {
    blockers.push('deprecated adapters are not selectable');
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  return {
    status: uniqueBlockers.length === 0 ? 'admitted' : 'blocked',
    requiredLanes: required,
    admittedLanes: [...admittedByLane.values()].sort((left, right) =>
      laneKey(left).localeCompare(laneKey(right))
    ),
    blockers: uniqueBlockers,
  };
}
