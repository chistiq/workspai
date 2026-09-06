import { assessAgentFrameworkAdmission } from './conformance.js';
import { detectAgentFramework, type AgentFrameworkDetectionResult } from './detection.js';
import {
  AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
  validateAgentFrameworkAdapterManifest,
  type AgentFrameworkAdapterManifest,
  type AgentFrameworkConformanceReport,
} from '../contracts/agent-framework-contract.js';
import { assertJsonSchemaContract } from '../utils/json-schema-contract.js';

export type AgentFrameworkRegistryEntry = {
  manifest: AgentFrameworkAdapterManifest;
  manifestSha256: string;
  source: 'builtin' | 'package' | 'workspace';
  conformanceReports: AgentFrameworkConformanceReport[];
};

export type AgentFrameworkResolution = {
  status: 'matched' | 'unresolved' | 'conflict' | 'blocked';
  entry: AgentFrameworkRegistryEntry | null;
  candidates: AgentFrameworkDetectionResult[];
  blockers: string[];
};

export type AgentFrameworkAdmissionResolution = {
  status: 'admitted' | 'unresolved' | 'blocked';
  entry: AgentFrameworkRegistryEntry | null;
  blockers: string[];
};

function normalizedToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-');
}

function cloneEntry(entry: AgentFrameworkRegistryEntry): AgentFrameworkRegistryEntry {
  return structuredClone(entry);
}

export class AgentFrameworkRegistry {
  readonly #entries = new Map<string, AgentFrameworkRegistryEntry>();

  register(entry: AgentFrameworkRegistryEntry): this {
    assertJsonSchemaContract(
      entry.manifest,
      AGENT_FRAMEWORK_ADAPTER_MANIFEST_CONTRACT_PATH,
      `Agent framework adapter ${entry.manifest.adapter?.id ?? 'unknown'}`
    );
    const violations = validateAgentFrameworkAdapterManifest(entry.manifest);
    if (violations.length > 0) {
      throw new Error(
        `Cannot register agent framework adapter ${entry.manifest.adapter.id}: ${violations.join('; ')}`
      );
    }
    if (!/^[a-f0-9]{64}$/.test(entry.manifestSha256)) {
      throw new Error('Agent framework manifest digest must be a lowercase SHA-256 value.');
    }
    const adapterId = normalizedToken(entry.manifest.adapter.id);
    if (this.#entries.has(adapterId)) {
      throw new Error(`Agent framework adapter id is already registered: ${adapterId}`);
    }
    this.#entries.set(adapterId, cloneEntry(entry));
    return this;
  }

  get(adapterId: string): AgentFrameworkRegistryEntry | null {
    const entry = this.#entries.get(normalizedToken(adapterId));
    return entry ? cloneEntry(entry) : null;
  }

  list(): AgentFrameworkRegistryEntry[] {
    return [...this.#entries.values()]
      .map(cloneEntry)
      .sort((left, right) => left.manifest.adapter.id.localeCompare(right.manifest.adapter.id));
  }

  resolveAdapter(adapterId: string): AgentFrameworkAdmissionResolution {
    const entry = this.#entries.get(normalizedToken(adapterId));
    if (!entry) return { status: 'unresolved', entry: null, blockers: [] };
    const admission = assessAgentFrameworkAdmission({
      manifest: entry.manifest,
      manifestSha256: entry.manifestSha256,
      reports: entry.conformanceReports,
    });
    return admission.status === 'admitted'
      ? { status: 'admitted', entry: cloneEntry(entry), blockers: [] }
      : { status: 'blocked', entry: cloneEntry(entry), blockers: admission.blockers };
  }

  async resolveProject(input: {
    projectRoot: string;
    runtime?: string;
  }): Promise<AgentFrameworkResolution> {
    const runtime = input.runtime ? normalizedToken(input.runtime) : undefined;
    const eligibleEntries = [...this.#entries.values()].filter(
      (entry) =>
        !runtime ||
        entry.manifest.implementation.runtimes.some(
          (candidate) => normalizedToken(candidate) === runtime
        )
    );
    const candidates = await Promise.all(
      eligibleEntries.map((entry) => detectAgentFramework(input.projectRoot, entry.manifest))
    );
    const detected = candidates.filter((candidate) => candidate.detected);
    if (detected.length === 0) {
      return { status: 'unresolved', entry: null, candidates, blockers: [] };
    }
    if (detected.length > 1) {
      return {
        status: 'conflict',
        entry: null,
        candidates,
        blockers: [
          `Multiple agent framework adapters matched authored evidence: ${detected
            .map((candidate) => candidate.adapterId)
            .sort()
            .join(', ')}`,
        ],
      };
    }
    const selected = this.#entries.get(normalizedToken(detected[0].adapterId));
    if (!selected) throw new Error('Agent framework registry index is inconsistent.');
    const admission = assessAgentFrameworkAdmission({
      manifest: selected.manifest,
      manifestSha256: selected.manifestSha256,
      reports: selected.conformanceReports,
    });
    if (admission.status !== 'admitted') {
      return {
        status: 'blocked',
        entry: cloneEntry(selected),
        candidates,
        blockers: admission.blockers,
      };
    }
    return {
      status: 'matched',
      entry: cloneEntry(selected),
      candidates,
      blockers: [],
    };
  }
}
