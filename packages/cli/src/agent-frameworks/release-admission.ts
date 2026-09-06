import { createHash } from 'node:crypto';

import admissionDocument from './release-admissions.v1.json' with { type: 'json' };

import type { AgentFrameworkAdapter } from './adapter.js';

const RELEASE_ADMISSION_SCHEMA_VERSION = 'workspai.agent-framework-release-admissions.v1' as const;
const PLATFORMS = ['linux', 'darwin', 'win32'] as const;

export type AgentFrameworkReleaseAdmission = {
  id: string;
  version: string;
  manifestSha256: string;
  frameworkVersion: string;
  runtime: string;
  platforms: Array<(typeof PLATFORMS)[number]>;
};

export type AgentFrameworkReleaseAdmissionResolution = {
  status: 'admitted' | 'blocked';
  admission: AgentFrameworkReleaseAdmission | null;
  blockers: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateDocument(value: unknown): AgentFrameworkReleaseAdmission[] {
  if (!isRecord(value) || value.schemaVersion !== RELEASE_ADMISSION_SCHEMA_VERSION) {
    throw new Error('Bundled agent framework release admission schema is incompatible.');
  }
  if (!isRecord(value.source)) {
    throw new Error('Bundled agent framework release admission source is missing.');
  }
  if (
    value.source.repository !== 'chistiq/workspai' ||
    !/^[a-f0-9]{40}$/.test(String(value.source.commit ?? '')) ||
    !Number.isSafeInteger(value.source.workflowRunId) ||
    Number(value.source.workflowRunId) <= 0 ||
    value.source.workflowUrl !==
      `https://github.com/chistiq/workspai/actions/runs/${String(value.source.workflowRunId)}` ||
    value.source.conclusion !== 'success'
  ) {
    throw new Error('Bundled agent framework release admission source is invalid.');
  }
  if (!Array.isArray(value.adapters) || value.adapters.length === 0) {
    throw new Error('Bundled agent framework release admission inventory is empty.');
  }
  const seen = new Set<string>();
  return value.adapters.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Bundled agent framework release admission ${index} is invalid.`);
    }
    const id = String(candidate.id ?? '');
    const version = String(candidate.version ?? '');
    const manifestSha256 = String(candidate.manifestSha256 ?? '');
    const frameworkVersion = String(candidate.frameworkVersion ?? '');
    const runtime = String(candidate.runtime ?? '');
    if (
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id) ||
      !version ||
      !/^[a-f0-9]{64}$/.test(manifestSha256) ||
      !frameworkVersion ||
      !runtime
    ) {
      throw new Error(`Bundled agent framework release admission ${id || index} is malformed.`);
    }
    if (seen.has(id)) throw new Error(`Duplicate bundled agent framework admission: ${id}`);
    seen.add(id);
    const platforms = Array.isArray(candidate.platforms) ? candidate.platforms : [];
    if (
      platforms.length !== PLATFORMS.length ||
      PLATFORMS.some((platform) => !platforms.includes(platform))
    ) {
      throw new Error(`Bundled agent framework admission has incomplete platforms: ${id}`);
    }
    return {
      id,
      version,
      manifestSha256,
      frameworkVersion,
      runtime,
      platforms: [...PLATFORMS],
    };
  });
}

const RELEASE_ADMISSIONS = Object.freeze(validateDocument(admissionDocument));

function manifestDigest(adapter: AgentFrameworkAdapter): string {
  return createHash('sha256')
    .update(`${JSON.stringify(adapter.manifest)}\n`)
    .digest('hex');
}

export function assessBundledAgentFrameworkRelease(
  adapter: AgentFrameworkAdapter
): AgentFrameworkReleaseAdmissionResolution {
  const admission = RELEASE_ADMISSIONS.find(
    (candidate) => candidate.id === adapter.manifest.adapter.id
  );
  if (!admission) {
    return {
      status: 'blocked',
      admission: null,
      blockers: [`No reviewed release admission exists for ${adapter.manifest.adapter.id}.`],
    };
  }
  const blockers: string[] = [];
  if (admission.version !== adapter.manifest.adapter.version) {
    blockers.push('adapter version changed after release admission');
  }
  if (admission.manifestSha256 !== manifestDigest(adapter)) {
    blockers.push('adapter manifest changed after release admission');
  }
  if (!adapter.manifest.framework.testedVersions.includes(admission.frameworkVersion)) {
    blockers.push('framework baseline changed after release admission');
  }
  if (!adapter.manifest.implementation.runtimes.includes(admission.runtime)) {
    blockers.push('runtime changed after release admission');
  }
  const advertisedPlatforms = [...adapter.manifest.implementation.platforms].sort();
  const admittedPlatforms = [...admission.platforms].sort();
  if (JSON.stringify(advertisedPlatforms) !== JSON.stringify(admittedPlatforms)) {
    blockers.push('platform matrix changed after release admission');
  }
  return {
    status: blockers.length === 0 ? 'admitted' : 'blocked',
    admission: structuredClone(admission),
    blockers,
  };
}

export function listBundledAgentFrameworkReleaseAdmissions(): AgentFrameworkReleaseAdmission[] {
  return RELEASE_ADMISSIONS.map((admission) => structuredClone(admission));
}
