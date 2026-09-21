/**
 * Ownership registry for Graph facts the product already admitted and froze.
 * This is not a semantic cache of caller-owned objects: only snapshots created
 * by composition/admission are marked, and lookups never treat object identity
 * of untrusted input as truth.
 */
const admittedFacts = new WeakSet<object>();
const admittedFactCanonical = new WeakMap<object, string>();

export function markGraphFactAdmitted(fact: object): void {
  admittedFacts.add(fact);
}

/**
 * Marks a frozen product snapshot and its nested objects as admitted. Nested
 * values may then keep canonical strings across compositions. Caller-owned
 * untrusted objects are never marked.
 */
export function markAdmittedGraphSnapshot(value: object): void {
  const pending: object[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    admittedFacts.add(current);
    for (const child of Object.values(current)) {
      if (typeof child === 'object' && child !== null) pending.push(child);
    }
  }
}

export function isGraphFactAdmitted(fact: object): boolean {
  return admittedFacts.has(fact);
}

export function rememberAdmittedFactCanonical(fact: object, canonical: string): void {
  if (!admittedFacts.has(fact) || canonical.length === 0) return;
  admittedFactCanonical.set(fact, canonical);
}

export function admittedFactCanonicalOf(fact: object): string | undefined {
  return admittedFacts.has(fact) ? admittedFactCanonical.get(fact) : undefined;
}
