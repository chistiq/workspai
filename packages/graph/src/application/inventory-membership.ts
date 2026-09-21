import { assertPortableLocator, normalizePortableLocator } from '../domain/content-state-merkle.js';
import { omittedSubtreesPreventCompleteness } from '../domain/inventory-surface.js';
import type { GraphFileInventoryResult } from '../ports/index.js';

import type {
  GraphInventoryRereadDecision,
  GraphInventoryRereadPlan,
} from './plan-inventory-reread.js';

export const GRAPH_INVENTORY_MEMBERSHIP_SCHEMA = 'workspai.graph.inventory-membership.v1' as const;
export const MAX_INVENTORY_MEMBERSHIP_LOCATORS = 100_000;
export const MAX_INVENTORY_MEMBERSHIP_BYTES = 8 * 1024 * 1024;

export interface GraphInventoryMembershipComparison {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly retained: readonly string[];
}

function portableMembershipLocator(value: string): string | undefined {
  try {
    const locator = normalizePortableLocator(value);
    assertPortableLocator(locator);
    if (locator.endsWith('/')) return undefined;
    return locator;
  } catch {
    return undefined;
  }
}

const utf8 = new TextEncoder();

export function inventoryMembershipLocatorBytes(locator: string): number {
  return utf8.encode(locator).byteLength + 1;
}

export function inventoryMembershipEncodedBytes(locators: readonly string[]): number {
  let total = 0;
  for (const locator of locators) {
    total += inventoryMembershipLocatorBytes(locator);
  }
  return total;
}

export function inventoryMembershipIsBounded(locators: readonly string[]): boolean {
  return (
    locators.length <= MAX_INVENTORY_MEMBERSHIP_LOCATORS &&
    inventoryMembershipEncodedBytes(locators) <= MAX_INVENTORY_MEMBERSHIP_BYTES
  );
}

export interface GraphInventoryMembershipSnapshot {
  readonly schema: typeof GRAPH_INVENTORY_MEMBERSHIP_SCHEMA;
  readonly locators: readonly string[];
  readonly complete: boolean;
}

export function freezeInventoryMembership(
  locators: readonly string[] | undefined,
  options?: { readonly complete?: boolean }
): GraphInventoryMembershipSnapshot | undefined {
  if (!locators) return undefined;
  const portable = [
    ...new Set(
      locators.flatMap((locator) => {
        const portableLocator = portableMembershipLocator(locator);
        return portableLocator ? [portableLocator] : [];
      })
    ),
  ].sort((left, right) => left.localeCompare(right));
  const complete = options?.complete === true && inventoryMembershipIsBounded(portable);
  return Object.freeze({
    schema: GRAPH_INVENTORY_MEMBERSHIP_SCHEMA,
    locators: Object.freeze(portable),
    complete,
  });
}

export function admittedInventoryMembershipSnapshot(
  snapshot: GraphInventoryMembershipSnapshot | undefined
): GraphInventoryMembershipSnapshot | undefined {
  if (!snapshot?.complete) return undefined;
  return snapshot;
}

export function compareInventoryMembership(
  priorLocators: readonly string[],
  currentLocators: readonly string[]
): GraphInventoryMembershipComparison {
  const prior = new Set<string>();
  for (const locator of priorLocators) {
    const portable = portableMembershipLocator(locator);
    if (portable) prior.add(portable);
  }
  const current = new Set<string>();
  for (const locator of currentLocators) {
    const portable = portableMembershipLocator(locator);
    if (portable) current.add(portable);
  }
  const added = [...current].filter((locator) => !prior.has(locator)).sort();
  const removed = [...prior].filter((locator) => !current.has(locator)).sort();
  const retained = [...current].filter((locator) => prior.has(locator)).sort();
  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    retained: Object.freeze(retained),
  });
}

export function inventoryMembershipIsComplete(inventory: GraphFileInventoryResult): boolean {
  if (!inventory.membershipLocators) return false;
  if (inventory.membershipTruncated) return false;
  if (inventory.status === 'failed' || inventory.status === 'cancelled') return false;
  if (!inventoryMembershipIsBounded(inventory.membershipLocators)) return false;
  return !omittedSubtreesPreventCompleteness(inventory.omittedSubtrees ?? []);
}

/**
 * Git is only a change hint. Filesystem membership is the authority for added
 * and removed inventory members, including ignored and Git-invisible files.
 */
export function applyInventoryMembership(
  plan: GraphInventoryRereadPlan,
  membershipLocators: readonly string[]
): GraphInventoryRereadPlan {
  const membership = new Set<string>();
  for (const locator of membershipLocators) {
    const portable = portableMembershipLocator(locator);
    if (!portable) continue;
    membership.add(portable);
  }
  const decisions: Record<string, GraphInventoryRereadDecision> = { ...plan.decisions };
  const observations: Record<
    string,
    { readonly gitStatus?: string; readonly priorLocator?: string }
  > = { ...plan.observations };

  for (const locator of Object.keys(decisions)) {
    const present = membership.has(locator);
    if (
      !present &&
      (decisions[locator] === 'reuse-prior-digest' || decisions[locator] === 'reread')
    ) {
      decisions[locator] = 'deleted';
    }
    if (present && decisions[locator] === 'deleted') {
      decisions[locator] = 'reread';
    }
  }

  for (const locator of [...membership].sort()) {
    const decision = decisions[locator];
    if (!decision || decision === 'skip-absent') {
      decisions[locator] = 'reread';
    }
  }

  const reread: string[] = [];
  const reused: string[] = [];
  const deleted: string[] = [];
  for (const locator of Object.keys(decisions).sort()) {
    const decision = decisions[locator];
    if (decision === 'reread') reread.push(locator);
    else if (decision === 'reuse-prior-digest') reused.push(locator);
    else if (decision === 'deleted') deleted.push(locator);
  }

  return Object.freeze({
    ...plan,
    rereadLocators: Object.freeze(reread),
    reusedLocators: Object.freeze(reused),
    deletedLocators: Object.freeze(deleted),
    decisions: Object.freeze(decisions),
    observations: Object.freeze(observations),
  });
}
