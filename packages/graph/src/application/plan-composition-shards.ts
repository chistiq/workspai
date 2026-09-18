import type {
  GraphCompositionIdentityFreeze,
  GraphCompositionSource,
  GraphReferenceCompositionTaskOutput,
} from './composition-types.js';
import type { GraphWorkspaceFact } from '../contracts/index.js';
import { measureCanonicalGraphValueBytes } from '../conformance/canonical-value.js';

const ESTIMATE_CEILING = 1_073_741_824;

export function estimateCanonicalJsonBytes(value: unknown, maxBytes = ESTIMATE_CEILING): number {
  const measured = measureCanonicalGraphValueBytes(value, maxBytes);
  if (!measured.accepted) {
    throw new Error(measured.issues[0]?.message ?? 'Canonical size measurement failed.');
  }
  return measured.value;
}

export type GraphCompositionShardPlan =
  | {
      readonly status: 'ready';
      readonly shards: readonly (readonly GraphCompositionSource[])[];
    }
  | {
      readonly status: 'failed';
      readonly code: 'GRAPH_COMPOSITION_FACT_TOO_LARGE';
      readonly message: string;
    };

/**
 * Partitions admitted sources so each worker payload stays inside a fraction of
 * the output budget. Duplicate fact identities stay in the same shard.
 * Does not raise maxWorkerOutputBytes.
 */
export function planGraphCompositionShards(
  sources: readonly GraphCompositionSource[],
  maxWorkerOutputBytes: number
): GraphCompositionShardPlan {
  const shardBudget = Math.max(1, Math.floor(maxWorkerOutputBytes / 4));
  try {
    const totalBytes = sources.reduce(
      (total, source) => total + estimateCanonicalJsonBytes(source, maxWorkerOutputBytes),
      0
    );
    if (totalBytes <= shardBudget) {
      return { status: 'ready', shards: Object.freeze([sources]) };
    }
  } catch {
    // Sources together exceed a single worker payload; pack by fact identity.
  }

  const groups = new Map<
    string,
    {
      readonly bytes: number;
      readonly members: readonly { sourceIndex: number; fact: GraphWorkspaceFact }[];
    }
  >();
  for (const [sourceIndex, source] of sources.entries()) {
    for (const fact of source.batch.facts) {
      const member = { sourceIndex, fact };
      const existing = groups.get(fact.factId);
      let memberBytes: number;
      try {
        memberBytes = estimateCanonicalJsonBytes(fact, shardBudget);
      } catch {
        return {
          status: 'failed',
          code: 'GRAPH_COMPOSITION_FACT_TOO_LARGE',
          message: 'A single fact identity exceeds the sharded worker payload budget.',
        };
      }
      if (!existing) {
        groups.set(fact.factId, { bytes: memberBytes, members: [member] });
      } else {
        const combined = existing.bytes + memberBytes;
        if (combined > shardBudget) {
          return {
            status: 'failed',
            code: 'GRAPH_COMPOSITION_FACT_TOO_LARGE',
            message: 'A single fact identity exceeds the sharded worker payload budget.',
          };
        }
        groups.set(fact.factId, {
          bytes: combined,
          members: [...existing.members, member],
        });
      }
    }
  }

  const ordered = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const packed: { bytes: number; members: { sourceIndex: number; fact: GraphWorkspaceFact }[] }[] =
    [];
  for (const [, group] of ordered) {
    if (group.bytes > shardBudget) {
      return {
        status: 'failed',
        code: 'GRAPH_COMPOSITION_FACT_TOO_LARGE',
        message: 'A single fact identity exceeds the sharded worker payload budget.',
      };
    }
    const last = packed[packed.length - 1];
    if (!last || last.bytes + group.bytes > shardBudget) {
      packed.push({ bytes: group.bytes, members: [...group.members] });
    } else {
      last.bytes += group.bytes;
      last.members.push(...group.members);
    }
  }

  const shards = packed.map((shard) => {
    const factsBySource = new Map<number, GraphWorkspaceFact[]>();
    for (const member of shard.members) {
      const facts = factsBySource.get(member.sourceIndex) ?? [];
      facts.push(member.fact);
      factsBySource.set(member.sourceIndex, facts);
    }
    return Object.freeze(
      [...factsBySource.entries()]
        .sort(([left], [right]) => left - right)
        .map(([sourceIndex, facts]) => {
          const source = sources[sourceIndex];
          if (!source) throw new Error('Composition shard referenced a missing source.');
          return {
            manifest: source.manifest,
            batch: {
              ...source.batch,
              facts: Object.freeze(
                [...facts].sort((left, right) => left.factId.localeCompare(right.factId))
              ),
            },
          };
        })
    );
  });
  return { status: 'ready', shards: Object.freeze(shards) };
}

export function mergeShardedCompositionOutputs(
  freeze: GraphCompositionIdentityFreeze,
  shards: readonly GraphReferenceCompositionTaskOutput[],
  factOrder: ReadonlyMap<string, number>
): GraphReferenceCompositionTaskOutput {
  const candidates = new Map<
    string,
    GraphReferenceCompositionTaskOutput['candidates'][number] & {
      facts: { readonly factId: string }[];
    }
  >();
  const decisions = [];
  const diagnostics = [];
  for (const shard of shards) {
    for (const candidate of shard.candidates) {
      const existing = candidates.get(candidate.key);
      if (!existing) {
        candidates.set(candidate.key, {
          ...candidate,
          facts: [...candidate.facts],
        });
      } else {
        existing.facts.push(...candidate.facts);
      }
    }
    decisions.push(...shard.decisions);
    diagnostics.push(...shard.diagnostics);
  }
  const orderedCandidates = [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candidate]) => ({
      ...candidate,
      facts: Object.freeze(
        [...candidate.facts].sort((left, right) => left.factId.localeCompare(right.factId))
      ),
    }));
  const orderedDecisions = [...decisions].sort((left, right) => {
    const leftOrder = Math.min(...left.factIds.map((factId) => factOrder.get(factId) ?? 0));
    const rightOrder = Math.min(...right.factIds.map((factId) => factOrder.get(factId) ?? 0));
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.edgeKey.localeCompare(right.edgeKey);
  });
  return {
    nodes: freeze.nodes,
    candidates: Object.freeze(orderedCandidates),
    decisions: Object.freeze(orderedDecisions),
    diagnostics: Object.freeze(
      [...diagnostics].sort((left, right) =>
        `${left.code}\0${left.path}`.localeCompare(`${right.code}\0${right.path}`)
      )
    ),
    unresolved: freeze.unresolved,
  };
}
