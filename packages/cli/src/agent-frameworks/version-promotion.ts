import {
  AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION,
  compareRegistryVersions,
  type AgentFrameworkVersionBaseline,
  type AgentFrameworkVersionBaselineDocument,
} from './version-policy.js';
import type { AgentFrameworkVersionDiscovery } from './version-discovery.js';

export type AgentFrameworkVersionPromotion = {
  changed: boolean;
  updatedAdapters: string[];
  updatedPackages: Array<{
    adapterId: string;
    name: string;
    from: string;
    to: string;
  }>;
  document: AgentFrameworkVersionBaselineDocument;
};

export function buildAgentFrameworkVersionPromotion(
  baselines: readonly AgentFrameworkVersionBaseline[],
  discovery: AgentFrameworkVersionDiscovery
): AgentFrameworkVersionPromotion {
  if (discovery.policy !== 'discover-only' || !discovery.admissionRequired) {
    throw new Error('Version promotion requires a discover-only, admission-required report.');
  }
  if (discovery.summary.blocked > 0) {
    throw new Error('Version promotion is blocked by an upstream registry regression.');
  }
  const discoveryByAdapter = new Map(
    discovery.adapters.map((adapter) => [adapter.adapterId, adapter])
  );
  if (
    discoveryByAdapter.size !== discovery.adapters.length ||
    discoveryByAdapter.size !== baselines.length
  ) {
    throw new Error('Discovery and baseline adapter inventories do not match.');
  }

  const updatedAdapters: string[] = [];
  const updatedPackages: AgentFrameworkVersionPromotion['updatedPackages'] = [];
  const promotedBaselines = baselines.map((baseline) => {
    const discovered = discoveryByAdapter.get(baseline.adapterId);
    if (
      !discovered ||
      discovered.runtime !== baseline.runtime ||
      discovered.releaseChannel !== baseline.releaseChannel
    ) {
      throw new Error(`Discovery identity does not match baseline ${baseline.adapterId}.`);
    }
    const packageDiscovery = new Map(discovered.packages.map((item) => [item.name, item]));
    if (
      packageDiscovery.size !== discovered.packages.length ||
      packageDiscovery.size !== baseline.packages.length
    ) {
      throw new Error(`Discovery package inventory does not match ${baseline.adapterId}.`);
    }
    const packages = baseline.packages.map((dependency) => {
      const candidate = packageDiscovery.get(dependency.name);
      if (
        !candidate ||
        candidate.ecosystem !== dependency.ecosystem ||
        candidate.channel !== dependency.channel ||
        candidate.admittedVersion !== dependency.version ||
        candidate.registryUrl !== dependency.registryUrl
      ) {
        throw new Error(
          `Discovery package identity does not match ${baseline.adapterId}/${dependency.name}.`
        );
      }
      if (candidate.status === 'registry-regression') {
        throw new Error(`Registry regression blocks ${baseline.adapterId}/${dependency.name}.`);
      }
      if (compareRegistryVersions(candidate.latestRegistryVersion, dependency.version) < 0) {
        throw new Error(
          `Version promotion cannot downgrade ${baseline.adapterId}/${dependency.name}.`
        );
      }
      if (candidate.status === 'current') return { ...dependency };
      updatedPackages.push({
        adapterId: baseline.adapterId,
        name: dependency.name,
        from: dependency.version,
        to: candidate.latestRegistryVersion,
      });
      return { ...dependency, version: candidate.latestRegistryVersion };
    });
    if (
      packages.some((dependency, index) => dependency.version !== baseline.packages[index]?.version)
    ) {
      updatedAdapters.push(baseline.adapterId);
    }
    const frameworkCore = packages.find((dependency) => dependency.role === 'framework-core');
    if (!frameworkCore) {
      throw new Error(`Framework core package is missing from ${baseline.adapterId}.`);
    }
    return { ...baseline, frameworkVersion: frameworkCore.version, packages };
  });

  for (const adapterId of discoveryByAdapter.keys()) {
    if (!baselines.some((baseline) => baseline.adapterId === adapterId)) {
      throw new Error(`Discovery contains unknown adapter ${adapterId}.`);
    }
  }

  return {
    changed: updatedPackages.length > 0,
    updatedAdapters,
    updatedPackages,
    document: {
      schemaVersion: AGENT_FRAMEWORK_VERSION_BASELINES_SCHEMA_VERSION,
      baselines: promotedBaselines,
    },
  };
}
