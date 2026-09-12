import type { GraphInputChange, GraphProviderRuntime } from '../contracts/index.js';
import { normalizePortableLocator } from '../domain/content-state-merkle.js';

export interface GraphAddedInputRecomputeRequest {
  readonly providers: readonly GraphProviderRuntime[];
  readonly addedLocators: readonly string[];
  readonly scopeKind: 'project' | 'workspace';
  readonly networkAllowed: boolean;
}

function detectionStatus(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'status' in value) {
    const status = (value as { status: unknown }).status;
    if (typeof status === 'string') {
      return status;
    }
  }
  return 'unknown';
}

/** Portable locators that first appear in the target tree and need observation. */
export function addedInputLocators(changes: readonly GraphInputChange[]): readonly string[] {
  const locators = new Set<string>();
  for (const change of changes) {
    if (change.kind === 'added') {
      locators.add(normalizePortableLocator(change.locator));
    }
    if (change.kind === 'rename-candidate') {
      locators.add(normalizePortableLocator(change.renameCandidate?.nextLocator ?? change.locator));
    }
  }
  return Object.freeze([...locators].sort());
}

/**
 * Asks each provider whether the added locators alone make it applicable.
 * `not-applicable` keeps reuse; any other detect outcome recomputes fail-closed
 * so a new file cannot inherit a stale whole-inventory batch.
 */
export async function providersRequiredForAddedInputs(
  request: GraphAddedInputRecomputeRequest
): Promise<readonly string[]> {
  if (request.addedLocators.length === 0) {
    return Object.freeze([]);
  }
  const required: string[] = [];
  for (const provider of request.providers) {
    try {
      const detected = await provider.detect({
        availableInputs: request.addedLocators,
        scopeKind: request.scopeKind,
        networkAllowed: request.networkAllowed,
      });
      if (detectionStatus(detected) !== 'not-applicable') {
        required.push(provider.manifest.id);
      }
    } catch {
      required.push(provider.manifest.id);
    }
  }
  return Object.freeze([...new Set(required)].sort());
}
