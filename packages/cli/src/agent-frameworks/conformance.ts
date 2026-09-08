import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
  AGENT_FRAMEWORK_CONFORMANCE_REPORT_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  validateAgentFrameworkConformanceReport,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

export type AgentFrameworkConformanceLane = {
  platform: AgentFrameworkAdapterManifest['implementation']['platforms'][number];
  runtime: string;
  frameworkVersion: string;
};

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
