import type {
  GraphCanonicalGraph,
  GraphUnknownZone,
  GraphWorkspaceFact,
} from '../contracts/index.js';
import { decodeGraphLocatorState } from '../domain/locator-identity.js';

import {
  GRAPH_FACT_CLASSES,
  type GraphFactClass,
  type GraphFactClassKeySet,
} from './score-fact-class-quality.js';

const FACT_TYPE_CLASSES: Readonly<Record<string, readonly GraphFactClass[]>> = Object.freeze({
  'source.file': ['files'],
  'manifest.package': ['projects', 'configuration'],
  'manifest.python-script': ['projects', 'configuration'],
  'source.declaration': ['declarations'],
  'source.export': ['exports'],
  'source.static-import': ['imports', 'dependencies'],
  'source.declared-import': ['imports', 'dependencies'],
  'source.call': ['calls'],
  'source.literal-route': ['routes'],
  'contract.openapi-endpoint': ['routes'],
  'contract.api-implementation': ['handlers'],
  'manifest.script': ['configuration'],
  'manifest.vscode-extension': ['configuration'],
  'manifest.dependency': ['dependencies'],
  'runtime.kubernetes-resource': ['deployment'],
  'runtime.kubernetes-namespace': ['deployment'],
  'delivery.test': ['tests'],
  'delivery.ci-pipeline': ['deployment'],
  'delivery.ci-job': ['deployment'],
});

function freezeSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

export function decodeGraphEntityLocator(entityId: string): string {
  if (!entityId.startsWith('entity:')) return entityId;
  const encoded = entityId.slice('entity:'.length).split(':').slice(2).join(':');
  if (!encoded) return entityId;
  let locator = encoded;
  try {
    locator = decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
  const decoded = decodeGraphLocatorState(locator, { freezeOpaqueDeclared: true });
  const current = decoded.value;
  if (current.startsWith('encoded/')) {
    try {
      return decodeURIComponent(current.slice('encoded/'.length).replaceAll('%2E', '.'));
    } catch {
      return current.slice('encoded/'.length);
    }
  }
  return current;
}

function objectKey(fact: GraphWorkspaceFact): string {
  const evidenceLocator = fact.evidence[0]?.relativeLocator;
  if (fact.factType === 'source.file' && evidenceLocator) return evidenceLocator;
  if (fact.factType === 'delivery.test' && evidenceLocator) return evidenceLocator;
  const method = fact.extensions?.httpMethod;
  const routePath = fact.extensions?.httpPath;
  if (
    fact.factType === 'source.literal-route' &&
    typeof method === 'string' &&
    typeof routePath === 'string'
  ) {
    return `${method} ${routePath}`;
  }
  const packageName = fact.extensions?.packageName;
  if (fact.factType === 'manifest.package' && typeof packageName === 'string' && packageName) {
    return packageName;
  }
  const symbolName = fact.extensions?.symbolName;
  if (
    (fact.factType === 'source.declaration' || fact.factType === 'source.export') &&
    typeof symbolName === 'string'
  ) {
    return symbolName;
  }
  const calleeName = fact.extensions?.calleeName;
  if (fact.factType === 'source.call' && typeof calleeName === 'string') return calleeName;
  const moduleSpecifier = fact.extensions?.moduleSpecifier;
  if (
    (fact.factType === 'source.static-import' || fact.factType === 'source.declared-import') &&
    typeof moduleSpecifier === 'string'
  ) {
    return moduleSpecifier;
  }
  if ('id' in fact.object && typeof fact.object.id === 'string') {
    return decodeGraphEntityLocator(fact.object.id);
  }
  if ('value' in fact.object) return String(fact.object.value);
  return fact.factId;
}

function factClassesFor(factType: string): readonly GraphFactClass[] {
  return FACT_TYPE_CLASSES[factType] ?? [];
}

export function factClassObservationsFromFacts(
  facts: readonly GraphWorkspaceFact[],
  zones: readonly GraphUnknownZone[] = []
): Readonly<Record<GraphFactClass, GraphFactClassKeySet>> {
  const keys = new Map<GraphFactClass, string[]>();
  const unsupported = new Map<GraphFactClass, string[]>();
  const ambiguous = new Map<GraphFactClass, string[]>();
  const truncated = new Map<GraphFactClass, string[]>();
  const generated = new Map<GraphFactClass, string[]>();
  const evidence = new Map<GraphFactClass, string[]>();
  for (const factClass of GRAPH_FACT_CLASSES) {
    keys.set(factClass, []);
    unsupported.set(factClass, []);
    ambiguous.set(factClass, []);
    truncated.set(factClass, []);
    generated.set(factClass, []);
    evidence.set(factClass, []);
  }
  for (const fact of facts) {
    const classes = factClassesFor(fact.factType);
    if (classes.length === 0) continue;
    const key = objectKey(fact);
    for (const factClass of classes) keys.get(factClass)?.push(key);
    if (fact.unknownZones.some((zone) => zone.code.includes('truncated'))) {
      for (const factClass of classes) truncated.get(factClass)?.push(key);
    }
    if (fact.unknownZones.some((zone) => zone.code.includes('ambiguous'))) {
      for (const factClass of classes) ambiguous.get(factClass)?.push(key);
    }
    if (fact.evidence.length === 0) {
      for (const factClass of classes) evidence.get(factClass)?.push(key);
    }
  }
  for (const zone of zones) {
    const code = zone.code;
    const target: GraphFactClass = code.includes('route')
      ? 'routes'
      : code.includes('call')
        ? 'calls'
        : 'declarations';
    if (code.includes('truncated')) truncated.get(target)?.push(zone.scope);
    else if (code.includes('unproven') || code.includes('unsupported')) {
      unsupported.get(target)?.push(zone.scope);
    } else if (code.includes('ambiguous')) ambiguous.get(target)?.push(zone.scope);
    else if (code.includes('generated')) generated.get(target)?.push(zone.scope);
    else if (code.includes('unreadable') || code.includes('invalid')) {
      evidence.get(target)?.push(zone.scope);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      GRAPH_FACT_CLASSES.map((factClass) => [
        factClass,
        Object.freeze({
          keys: freezeSorted(keys.get(factClass) ?? []),
          unsupportedKeys: freezeSorted(unsupported.get(factClass) ?? []),
          ambiguousKeys: freezeSorted(ambiguous.get(factClass) ?? []),
          truncatedKeys: freezeSorted(truncated.get(factClass) ?? []),
          generatedExcludedKeys: freezeSorted(generated.get(factClass) ?? []),
          evidenceFailureKeys: freezeSorted(evidence.get(factClass) ?? []),
        }),
      ])
    )
  ) as Readonly<Record<GraphFactClass, GraphFactClassKeySet>>;
}

export function factClassObservationsFromGraph(
  graph: GraphCanonicalGraph,
  facts: readonly GraphWorkspaceFact[],
  zones: readonly GraphUnknownZone[] = []
): Readonly<Record<GraphFactClass, GraphFactClassKeySet>> {
  const observed = factClassObservationsFromFacts(facts, [
    ...zones,
    ...graph.unresolved.map((item) => ({
      code: 'graph.unresolved-identity',
      scope: item.id,
      reason: 'Canonical graph retained unresolved identity candidates.',
    })),
  ]);
  const fileKeys = freezeSorted(
    graph.nodes
      .filter((node) => node.kind === 'file')
      .map((node) => decodeGraphEntityLocator(node.id))
  );
  const routeKeys = freezeSorted(
    graph.nodes
      .filter((node) => node.kind === 'endpoint')
      .map((node) => decodeGraphEntityLocator(node.id))
  );
  return Object.freeze({
    ...observed,
    files: Object.freeze({
      ...observed.files,
      keys: uniqueKeys([...observed.files.keys, ...fileKeys]),
    }),
    routes: Object.freeze({
      ...observed.routes,
      keys: uniqueKeys([...observed.routes.keys, ...routeKeys]),
    }),
  });
}

function uniqueKeys(values: readonly string[]): readonly string[] {
  return freezeSorted(
    values.filter(
      (value) => value.length > 0 && !value.startsWith('entity:') && !value.startsWith('sha256:')
    )
  );
}
