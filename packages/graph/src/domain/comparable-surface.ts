import { CORE_GRAPH_ONTOLOGY_PROFILE } from '../contracts/core-ontology.js';
import {
  GRAPH_COMPARABLE_KIND_ALIASES,
  GRAPH_COMPARABLE_RELATION_ALIASES,
  type GraphComparableMembership,
} from '../contracts/semantic-parity.js';

const ONTOLOGY_KINDS = new Set(CORE_GRAPH_ONTOLOGY_PROFILE.entities.map((entity) => entity.kind));
const ONTOLOGY_RELATIONS = new Set(
  CORE_GRAPH_ONTOLOGY_PROFILE.relations.map((relation) => relation.kind)
);

export function mapComparableKind(
  kind: string,
  overrides?: Readonly<Record<string, string>>
): string {
  return overrides?.[kind] ?? GRAPH_COMPARABLE_KIND_ALIASES[kind] ?? kind;
}

export function mapComparableRelation(
  relation: string,
  overrides?: Readonly<Record<string, string>>
): string {
  return overrides?.[relation] ?? GRAPH_COMPARABLE_RELATION_ALIASES[relation] ?? relation;
}

export function classifyComparableKind(
  kind: string,
  overrides?: Readonly<Record<string, string>>
): { readonly kind: string; readonly membership: GraphComparableMembership } {
  const mapped = mapComparableKind(kind, overrides);
  return {
    kind: mapped,
    membership: ONTOLOGY_KINDS.has(mapped) ? 'in-corpus' : 'outside-corpus',
  };
}

export function classifyComparableRelation(
  relation: string,
  overrides?: Readonly<Record<string, string>>
): { readonly kind: string; readonly membership: GraphComparableMembership } {
  const mapped = mapComparableRelation(relation, overrides);
  return {
    kind: mapped,
    membership: ONTOLOGY_RELATIONS.has(mapped) ? 'in-corpus' : 'outside-corpus',
  };
}
