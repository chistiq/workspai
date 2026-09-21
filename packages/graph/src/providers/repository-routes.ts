import {
  GRAPH_FACT_BATCH_CONTRACT,
  GRAPH_IDENTITY_SCHEME,
  GRAPH_PROVIDER_DETECTION_CONTRACT,
  GRAPH_PROVIDER_MANIFEST_CONTRACT,
  type GraphFactBatch,
  type GraphDiagnostic,
  type GraphProviderInput,
  type GraphProviderRuntime,
  type GraphWorkspaceFact,
} from '../contracts/index.js';
import { opaqueGraphDeclaredLocator } from '../domain/locator-identity.js';
import {
  GRAPH_JS_HTTP_ROUTER_EXPORTS,
  GRAPH_JS_HTTP_SPECIFIERS,
  goHttpMethodsFor,
  pythonHttpConstructorsFor,
} from './http-runtime-capabilities.js';
import {
  contentAddressedCompute,
  contentAddressedFactKey,
  contentAddressedGet,
} from './content-addressed-facts.js';
import { appendReusedLocatorFacts } from '../application/locator-fact-shards.js';
import { recordGraphPhase } from '../application/phase-metrics.js';
import { ECMASCRIPT_SYNTAX_VERSION, scanEcmascriptCallChains } from './ecmascript-syntax.js';

export const REPOSITORY_ROUTES_PROVIDER_ID = 'workspai.graph.provider.repository-routes';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FACTS = 100_000;
const SUPPORTED_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.py',
  '.go',
  '.java',
  '.cs',
  '.ex',
  '.exs',
  '.kt',
  '.kts',
]);

interface LiteralRoute {
  readonly method: string;
  readonly path: string;
}

function extension(locator: string): string {
  const basename = locator.slice(locator.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
}

function routeInputs(inputs: readonly GraphProviderInput[]): GraphProviderInput[] {
  return inputs
    .filter((input) => SUPPORTED_EXTENSIONS.has(extension(input.locator)))
    .sort((left, right) => left.locator.localeCompare(right.locator));
}

function appendMatches(
  source: string,
  expression: RegExp,
  methodIndex: number,
  pathIndex: number,
  routes: LiteralRoute[]
): void {
  for (const match of source.matchAll(expression)) {
    const method = match[methodIndex]?.toUpperCase();
    const routePath = match[pathIndex];
    if (
      method &&
      routePath &&
      routePath.length <= 2_048 &&
      !routePath.includes('\\') &&
      !routePath.includes('\0') &&
      !routePath.includes('${')
    )
      routes.push({ method, path: routePath });
  }
}

function syntaxView(source: string, sourceExtension: string): string {
  let result = '';
  let quote: string | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  const hashComment = ['.py', '.ex', '.exs'].includes(sourceExtension);
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        result += character;
      } else result += ' ';
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        result += '  ';
        index += 1;
      } else result += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      result += character;
    } else if (hashComment && character === '#') {
      lineComment = true;
      result += ' ';
    } else if (!hashComment && character === '/' && next === '/') {
      lineComment = true;
      result += '  ';
      index += 1;
    } else if (!hashComment && character === '/' && next === '*') {
      blockComment = true;
      result += '  ';
      index += 1;
    } else result += character;
  }
  return result;
}

const NODE_ROUTE_HTTP_METHODS = 'get|post|put|patch|delete|options|head|all';
const NODE_ROUTE_METHOD = new Set(NODE_ROUTE_HTTP_METHODS.split('|'));

function addUniqueName(target: Set<string>, name: string | undefined): void {
  if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) target.add(name);
}

function collectJsTsRouteReceivers(source: string): {
  readonly receivers: ReadonlySet<string>;
  readonly factories: ReadonlySet<string>;
  readonly routers: ReadonlySet<string>;
} {
  const factories = new Set<string>();
  const routers = new Set<string>();
  const receivers = new Set<string>();
  const specifier = String.raw`['"](@?[\w][\w./-]*)['"]`;
  for (const match of source.matchAll(
    new RegExp(
      String.raw`\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})\s+from\s+${specifier}`,
      'gu'
    )
  )) {
    const moduleName = match[5] ?? '';
    if (!GRAPH_JS_HTTP_SPECIFIERS.has(moduleName)) continue;
    addUniqueName(factories, match[1] ?? match[2] ?? match[3]);
    for (const clause of (match[4] ?? '').split(',')) {
      const named =
        /^\s*(?:([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?|default\s+as\s+([A-Za-z_$][\w$]*))\s*$/u.exec(
          clause
        );
      if (!named) continue;
      if (named[3]) {
        addUniqueName(factories, named[3]);
        continue;
      }
      const exported = named[1] ?? '';
      const local = named[2] ?? exported;
      if (GRAPH_JS_HTTP_ROUTER_EXPORTS.has(exported) || exported === 'default') {
        addUniqueName(routers, local);
      } else addUniqueName(factories, local);
    }
  }
  for (const match of source.matchAll(
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*${specifier}\s*\)\s*(?:\(\s*|\.\s*Router\s*\()`,
      'gu'
    )
  )) {
    if (GRAPH_JS_HTTP_SPECIFIERS.has(match[2] ?? '')) addUniqueName(receivers, match[1]);
  }
  for (const match of source.matchAll(
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*${specifier}\s*\)(?!\s*(?:\(|\.Router\s*\())`,
      'gu'
    )
  )) {
    if (GRAPH_JS_HTTP_SPECIFIERS.has(match[2] ?? '')) addUniqueName(factories, match[1]);
  }
  for (const match of source.matchAll(
    new RegExp(
      String.raw`\b(?:const|let|var)\s+\{\s*([^}]*)\}\s*=\s*require\s*\(\s*${specifier}\s*\)`,
      'gu'
    )
  )) {
    if (!GRAPH_JS_HTTP_SPECIFIERS.has(match[2] ?? '')) continue;
    for (const clause of (match[1] ?? '').split(',')) {
      const named = /^\s*([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/u.exec(clause);
      if (!named) continue;
      const exported = named[1] ?? '';
      const local = named[2] ?? exported;
      if (exported === 'Router') addUniqueName(routers, local);
      else addUniqueName(factories, local);
    }
  }
  for (let round = 0; round < 8; round += 1) {
    const before = receivers.size;
    for (const match of source.matchAll(
      /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\(\s*[\s\S]*?\)|\.Router\s*\(\s*[\s\S]*?\)|new\s+[A-Za-z_$][\w$]*\s*\(\s*[\s\S]*?\))/gu
    )) {
      const left = match[1] ?? '';
      const right = match[2] ?? '';
      const text = match[0] ?? '';
      if (text.includes('.Router') && factories.has(right)) addUniqueName(receivers, left);
      else if (/\bnew\s+/u.test(text) && routers.has(right)) addUniqueName(receivers, left);
      else if (factories.has(right) || routers.has(right) || receivers.has(right)) {
        addUniqueName(receivers, left);
      }
    }
    for (const match of source.matchAll(
      /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/gu
    )) {
      if (routers.has(match[2] ?? '') || factories.has(match[2] ?? '')) {
        addUniqueName(receivers, match[1]);
      }
    }
    for (const match of source.matchAll(
      /\b([A-Za-z_$][\w$]*)\s*\.\s*use\s*\(\s*(?:(['"`])[^'"`]*\2\s*,\s*)?([A-Za-z_$][\w$]*)\s*[,)]/gu
    )) {
      if (receivers.has(match[1] ?? '')) addUniqueName(receivers, match[3]);
    }
    for (const match of source.matchAll(
      /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;,\n]/gu
    )) {
      if (receivers.has(match[2] ?? '')) addUniqueName(receivers, match[1]);
    }
    if (receivers.size === before) break;
  }
  return { receivers, factories, routers };
}

function splitTopLevelCallArgs(source: string, openParen: number): readonly string[] | undefined {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  let start = openParen + 1;
  const args: string[] = [];
  for (let index = openParen; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(' || character === '{' || character === '[') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === '}' || character === ']') {
      if (character === ')' && depth === 1) {
        args.push(source.slice(start, index).trim());
        return args.filter((value) => value.length > 0);
      }
      depth -= 1;
      continue;
    }
    if (character === ',' && depth === 1) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  return undefined;
}

function literalRoutePath(argument: string): string | undefined {
  const matched = /^(['"`])([^'"`\r\n]*)\1$/u.exec(argument.trim());
  const routePath = matched?.[2];
  if (
    routePath === undefined ||
    routePath.includes('\\') ||
    routePath.includes('\0') ||
    routePath.includes('${') ||
    routePath.length > 2_048
  ) {
    return undefined;
  }
  return routePath;
}

function isRouteShapedCall(method: string, args: readonly string[]): boolean {
  if (!NODE_ROUTE_METHOD.has(method.toLowerCase())) return false;
  if (args.length >= 2) return true;
  const path = literalRoutePath(args[0] ?? '');
  return path !== undefined && (path.startsWith('/') || path.startsWith('*') || path.length === 0);
}

interface JsTsRouteExtraction {
  readonly routes: readonly LiteralRoute[];
  readonly provenDynamic: number;
  readonly unprovenRouteShaped: number;
}

function collectPythonRouteReceivers(source: string): ReadonlySet<string> {
  const constructors = new Set<string>();
  const modules = new Map<string, Set<string>>();
  const receivers = new Set<string>();
  for (const match of source.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+([^\n#]+)/gmu)) {
    const imported = pythonHttpConstructorsFor(match[1] ?? '');
    if (imported.size === 0) continue;
    for (const clause of (match[2] ?? '').split(',')) {
      const named = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/u.exec(clause);
      if (!named?.[1] || !imported.has(named[1])) continue;
      addUniqueName(constructors, named[2] ?? named[1]);
    }
  }
  for (const match of source.matchAll(
    /^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?/gmu
  )) {
    const specifier = match[1] ?? '';
    const imported = pythonHttpConstructorsFor(specifier);
    if (imported.size === 0) continue;
    const alias = match[2] ?? specifier.split('.').pop() ?? specifier;
    modules.set(alias, new Set(imported));
  }
  for (const match of source.matchAll(
    /\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)(?:\s*\.\s*([A-Za-z_]\w*))?\s*\(/gu
  )) {
    const left = match[1] ?? '';
    const owner = match[2] ?? '';
    const member = match[3];
    if (member && (modules.get(owner)?.has(member) ?? false)) addUniqueName(receivers, left);
    else if (!member && constructors.has(owner)) addUniqueName(receivers, left);
  }
  for (let round = 0; round < 4; round += 1) {
    const before = receivers.size;
    for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*(?:[#\n]|$)/gmu)) {
      if (receivers.has(match[2] ?? '')) addUniqueName(receivers, match[1]);
    }
    if (receivers.size === before) break;
  }
  return receivers;
}

function extractPythonRoutes(source: string): JsTsRouteExtraction {
  const receivers = collectPythonRouteReceivers(source);
  const routes: LiteralRoute[] = [];
  let provenDynamic = 0;
  let unprovenRouteShaped = 0;
  const decorator =
    /@\s*([A-Za-z_]\w*)\s*\.\s*(get|post|put|patch|delete|options|head|route)\s*\(\s*(['"])([^'"\r\n]+)\3([^)]*)\)/giu;
  for (const match of source.matchAll(decorator)) {
    const receiver = match[1] ?? '';
    const methodName = (match[2] ?? '').toLowerCase();
    const routePath = match[4] ?? '';
    const rest = match[5] ?? '';
    const proven = receivers.has(receiver);
    if (
      !routePath ||
      routePath.length > 2_048 ||
      routePath.includes('\\') ||
      routePath.includes('\0') ||
      routePath.includes('${')
    ) {
      if (proven) provenDynamic += 1;
      else unprovenRouteShaped += 1;
      continue;
    }
    if (!proven) {
      unprovenRouteShaped += 1;
      continue;
    }
    if (methodName === 'route') {
      const methods = [...rest.matchAll(/['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]/giu)].map(
        (item) => (item[1] ?? '').toUpperCase()
      );
      if (methods.length === 0) routes.push({ method: 'GET', path: routePath });
      else for (const method of methods) routes.push({ method, path: routePath });
      continue;
    }
    routes.push({ method: methodName.toUpperCase(), path: routePath });
  }
  return { routes, provenDynamic, unprovenRouteShaped };
}

function collectGoImportedHttpPackages(source: string): ReadonlyMap<string, ReadonlySet<string>> {
  const packages = new Map<string, Set<string>>();
  const record = (specifier: string, alias: string | undefined): void => {
    const methods = goHttpMethodsFor(specifier);
    if (methods.size === 0) return;
    const name = alias || specifier.split('/').pop() || specifier;
    const existing = packages.get(name) ?? new Set<string>();
    for (const method of methods) existing.add(method);
    packages.set(name, existing);
  };
  for (const match of source.matchAll(
    /^\s*(?:import\s+)?(?:([A-Za-z_]\w*)\s+)?["']([^"']+)["']/gmu
  )) {
    record(match[2] ?? '', match[1]);
  }
  return packages;
}

function extractGoRoutes(source: string): JsTsRouteExtraction {
  const packages = collectGoImportedHttpPackages(source);
  const receivers = new Map<string, Set<string>>();
  for (const [name, methods] of packages) receivers.set(name, new Set(methods));
  for (const match of source.matchAll(
    /\b([A-Za-z_]\w*)\s*:?=\s*([A-Za-z_]\w*)\s*\.\s*(?:New|Default|NewRouter|DefaultServeMux)\s*\(/gu
  )) {
    const methods = receivers.get(match[2] ?? '');
    if (!methods) continue;
    receivers.set(match[1] ?? '', new Set(methods));
  }
  const routes: LiteralRoute[] = [];
  let provenDynamic = 0;
  let unprovenRouteShaped = 0;
  const call =
    /\b([A-Za-z_]\w*)\s*\.\s*(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|HandleFunc|Handle)\s*\(\s*(['"])([^'"\r\n]*)\3/gmu;
  for (const match of source.matchAll(call)) {
    const receiver = match[1] ?? '';
    const methodName = match[2] ?? '';
    const routePath = match[4] ?? '';
    const admitted = receivers.get(receiver);
    const proven = Boolean(admitted?.has(methodName));
    if (
      !routePath ||
      routePath.length > 2_048 ||
      routePath.includes('\\') ||
      routePath.includes('\0')
    ) {
      if (proven) provenDynamic += 1;
      else unprovenRouteShaped += 1;
      continue;
    }
    if (!proven) {
      unprovenRouteShaped += 1;
      continue;
    }
    const method =
      methodName === 'HandleFunc' || methodName === 'Handle' ? 'GET' : methodName.toUpperCase();
    routes.push({ method: method === 'ANY' ? 'GET' : method, path: routePath });
  }
  return { routes, provenDynamic, unprovenRouteShaped };
}

function recordJsTsRouteCall(
  source: string,
  receiverProven: boolean,
  method: string,
  openParen: number,
  routes: LiteralRoute[],
  counts: { provenDynamic: number; unprovenRouteShaped: number }
): void {
  const args = splitTopLevelCallArgs(source, openParen);
  if (!args) {
    if (receiverProven) counts.provenDynamic += 1;
    else if (NODE_ROUTE_METHOD.has(method.toLowerCase())) counts.unprovenRouteShaped += 1;
    return;
  }
  const shaped = isRouteShapedCall(method, args);
  if (!receiverProven) {
    if (shaped) counts.unprovenRouteShaped += 1;
    return;
  }
  const routePath = literalRoutePath(args[0] ?? '');
  if (routePath !== undefined) {
    routes.push({ method: method.toUpperCase(), path: routePath });
    return;
  }
  counts.provenDynamic += 1;
}

function jsHttpReceiverProvenBefore(
  chain: {
    readonly root: string;
    readonly usedNew: boolean;
    readonly requireSpecifier: string | undefined;
    readonly steps: readonly (
      | { readonly kind: 'member'; readonly name: string }
      | { readonly kind: 'call'; readonly openParen: number }
    )[];
  },
  memberIndex: number,
  receivers: ReadonlySet<string>,
  factories: ReadonlySet<string>,
  routers: ReadonlySet<string>
): boolean {
  let identFactory =
    factories.has(chain.root) ||
    Boolean(chain.requireSpecifier && GRAPH_JS_HTTP_SPECIFIERS.has(chain.requireSpecifier));
  let identRouter = routers.has(chain.root);
  let valueReceiver = receivers.has(chain.root);
  let pendingConstruct = chain.usedNew && (identFactory || identRouter);
  for (let index = 0; index < memberIndex; index += 1) {
    const step = chain.steps[index];
    if (!step) continue;
    if (step.kind === 'member') {
      if (GRAPH_JS_HTTP_ROUTER_EXPORTS.has(step.name) && identFactory) {
        identRouter = true;
        identFactory = false;
        valueReceiver = false;
      }
      continue;
    }
    if (pendingConstruct || identFactory || identRouter || valueReceiver) {
      valueReceiver = true;
      pendingConstruct = false;
      identFactory = false;
      identRouter = false;
    }
  }
  return valueReceiver;
}

function extractJsTsRoutes(source: string): JsTsRouteExtraction {
  const { receivers, factories, routers } = collectJsTsRouteReceivers(source);
  const routes: LiteralRoute[] = [];
  const counts = { provenDynamic: 0, unprovenRouteShaped: 0 };
  for (const chain of scanEcmascriptCallChains(source)) {
    for (const [stepIndex, step] of chain.steps.entries()) {
      const call = chain.steps[stepIndex + 1];
      if (
        step.kind !== 'member' ||
        call?.kind !== 'call' ||
        !NODE_ROUTE_METHOD.has(step.name.toLowerCase())
      ) {
        continue;
      }
      const proven = jsHttpReceiverProvenBefore(chain, stepIndex, receivers, factories, routers);
      recordJsTsRouteCall(source, proven, step.name, call.openParen, routes, counts);
    }
  }
  return {
    routes,
    provenDynamic: counts.provenDynamic,
    unprovenRouteShaped: counts.unprovenRouteShaped,
  };
}

const NODE_ROUTE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

function extractLiteralRoutesFromView(source: string, sourceExtension: string): LiteralRoute[] {
  const routes: LiteralRoute[] = [];
  if (NODE_ROUTE_EXTENSIONS.has(sourceExtension)) {
    routes.push(...extractJsTsRoutes(source).routes);
  } else if (sourceExtension === '.py') {
    routes.push(...extractPythonRoutes(source).routes);
  } else if (sourceExtension === '.go') {
    routes.push(...extractGoRoutes(source).routes);
  } else if (['.java', '.kt', '.kts'].includes(sourceExtension)) {
    appendMatches(
      source,
      /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?(['"])([^'"\r\n]+)\2/gmu,
      1,
      3,
      routes
    );
  } else if (sourceExtension === '.cs') {
    appendMatches(
      source,
      /\[Http(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*(['"])([^'"\r\n]*)\2/gmu,
      1,
      3,
      routes
    );
    appendMatches(
      source,
      /\bMap(Get|Post|Put|Patch|Delete)\s*\(\s*(['"])([^'"\r\n]*)\2/gmu,
      1,
      3,
      routes
    );
    for (const match of source.matchAll(/\bMapHealthChecks\s*\(\s*(['"])([^'"\r\n]*)\2/gmu)) {
      const routePath = match[2];
      if (
        routePath !== undefined &&
        routePath.length <= 2_048 &&
        !routePath.includes('\\') &&
        !routePath.includes('\0') &&
        !routePath.includes('${')
      ) {
        routes.push({ method: 'GET', path: routePath });
      }
    }
  } else if (['.ex', '.exs'].includes(sourceExtension)) {
    appendMatches(
      source,
      /^\s*(get|post|put|patch|delete|options|head)\s+(['"])([^'"\r\n]+)\2/gimu,
      1,
      3,
      routes
    );
  }
  return uniqueSortedRoutes(routes);
}

function uniqueSortedRoutes(routes: readonly LiteralRoute[]): LiteralRoute[] {
  return [
    ...new Map(
      routes
        .map((route) => ({
          method: route.method,
          path: route.path.length === 0 ? '/' : route.path,
        }))
        .map((route) => [`${route.method}\0${route.path}`, route])
    ).values(),
  ].sort(
    (left, right) => left.method.localeCompare(right.method) || left.path.localeCompare(right.path)
  );
}

interface CachedRouteObservation {
  readonly routes: readonly LiteralRoute[];
  readonly provenDynamic: number;
  readonly unprovenRouteShaped: number;
  readonly extraCandidates: number;
}

function observeRoutes(source: string, sourceExtension: string): CachedRouteObservation {
  if (NODE_ROUTE_EXTENSIONS.has(sourceExtension)) {
    const extracted = extractJsTsRoutes(source);
    return {
      routes: uniqueSortedRoutes(extracted.routes),
      provenDynamic: extracted.provenDynamic,
      unprovenRouteShaped: extracted.unprovenRouteShaped,
      extraCandidates: 0,
    };
  }
  if (sourceExtension === '.py') {
    const extracted = extractPythonRoutes(source);
    return {
      routes: uniqueSortedRoutes(extracted.routes),
      provenDynamic: extracted.provenDynamic,
      unprovenRouteShaped: extracted.unprovenRouteShaped,
      extraCandidates: 0,
    };
  }
  if (sourceExtension === '.go') {
    const extracted = extractGoRoutes(source);
    return {
      routes: uniqueSortedRoutes(extracted.routes),
      provenDynamic: extracted.provenDynamic,
      unprovenRouteShaped: extracted.unprovenRouteShaped,
      extraCandidates: 0,
    };
  }
  const routes = extractLiteralRoutesFromView(source, sourceExtension);
  return {
    routes,
    provenDynamic: 0,
    unprovenRouteShaped: 0,
    extraCandidates: Math.max(0, routeCandidateCount(source, sourceExtension) - routes.length),
  };
}

function routeCandidateCount(source: string, sourceExtension: string): number {
  if (NODE_ROUTE_EXTENSIONS.has(sourceExtension)) {
    const extracted = extractJsTsRoutes(source);
    return extracted.routes.length + extracted.provenDynamic + extracted.unprovenRouteShaped;
  }
  if (sourceExtension === '.py') {
    const extracted = extractPythonRoutes(source);
    return extracted.routes.length + extracted.provenDynamic + extracted.unprovenRouteShaped;
  }
  if (sourceExtension === '.go') {
    const extracted = extractGoRoutes(source);
    return extracted.routes.length + extracted.provenDynamic + extracted.unprovenRouteShaped;
  }
  if (['.ex', '.exs'].includes(sourceExtension)) {
    return [...source.matchAll(/^\s*(?:get|post|put|patch|delete|options|head)\s+/gimu)].length;
  }
  if (['.java', '.kt', '.kts'].includes(sourceExtension)) {
    return [...source.matchAll(/@(?:Get|Post|Put|Patch|Delete|Request)Mapping\s*\(/gu)].length;
  }
  if (sourceExtension === '.cs') {
    return [
      ...source.matchAll(
        /(?:\[Http(?:Get|Post|Put|Patch|Delete|Options|Head)\s*\(|\bMap(?:Get|Post|Put|Patch|Delete|Methods|HealthChecks)\s*\()/gu
      ),
    ].length;
  }
  return 0;
}

export function httpRouteDeclaredLocator(method: string, routePath: string): string {
  return opaqueGraphDeclaredLocator(
    'encoded',
    `${method} ${routePath.length === 0 ? '/' : routePath}`
  );
}

export function createRepositoryRoutesProvider(): GraphProviderRuntime {
  const manifest = {
    contract: GRAPH_PROVIDER_MANIFEST_CONTRACT,
    id: REPOSITORY_ROUTES_PROVIDER_ID,
    version: '0.1.0-candidate',
    displayName: 'Repository literal routes',
    determinism: 'deterministic' as const,
    capabilities: {
      entityKinds: ['file', 'endpoint'],
      relationKinds: ['exposes'],
      relationSemantics: ['structural'] as const,
      factFamilies: ['source.literal-route'],
      allowedClaims: ['observed'],
    },
    permissions: {
      filesystem: 'read' as const,
      network: 'deny' as const,
      process: 'deny' as const,
      credentials: 'deny' as const,
    },
    limits: { maxDurationMs: 30_000, maxFacts: MAX_FACTS, maxInputBytes: 128 * 1024 * 1024 },
    contractVersions: [GRAPH_FACT_BATCH_CONTRACT.version],
    supportedInputs: [
      'node-source',
      'python-source',
      'go-source',
      'java-source',
      'dotnet-source',
      'elixir-source',
      'kotlin-source',
    ],
    incremental: 'input' as const,
    identitySchemes: [GRAPH_IDENTITY_SCHEME],
  };

  return {
    manifest,
    detect: (request) => {
      const applicable = request.availableInputs.some((locator) =>
        SUPPORTED_EXTENSIONS.has(extension(locator))
      );
      return {
        contract: GRAPH_PROVIDER_DETECTION_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        status: applicable ? 'applicable' : 'not-applicable',
        matchedInputs: applicable ? [...manifest.supportedInputs] : [],
        missingPermissions: [],
        diagnostics: [],
      };
    },
    collect: async (request) => {
      const inputs = routeInputs(request.inputs);
      const facts: GraphWorkspaceFact[] = [];
      const diagnostics: GraphDiagnostic[] = [];
      const unknownZones: GraphFactBatch['unknownZones'][number][] = [];
      const processing: GraphFactBatch['processing'][number][] = [];
      for (const [inputIndex, input] of inputs.entries()) {
        if (
          appendReusedLocatorFacts(
            {
              providerId: REPOSITORY_ROUTES_PROVIDER_ID,
              locator: input.locator,
              inputDigest: input.digest.value,
              inputIndex,
            },
            '',
            facts,
            processing,
            unknownZones
          )
        ) {
          continue;
        }
        const sourceExtension = extension(input.locator);
        let outcome: GraphFactBatch['processing'][number]['outcome'] = 'processed';
        const inputDiagnostics: GraphDiagnostic[] = [];
        try {
          const cacheKey = contentAddressedFactKey({
            extractorId: REPOSITORY_ROUTES_PROVIDER_ID,
            extractorVersion: `${manifest.version}:${ECMASCRIPT_SYNTAX_VERSION}:observation`,
            contentDigest: input.digest.value,
            configuration: sourceExtension,
          });
          let observation = contentAddressedGet<CachedRouteObservation>(cacheKey);
          if (observation === undefined) {
            const bytes = await request.readInput(input, {
              maxBytes: MAX_SOURCE_BYTES,
              signal: request.signal,
            });
            const view = syntaxView(
              new TextDecoder('utf-8', { fatal: true }).decode(bytes),
              sourceExtension
            );
            observation = contentAddressedCompute(cacheKey, () => {
              const startedAt = performance.now();
              const observed = observeRoutes(view, sourceExtension);
              recordGraphPhase('frameworkBinding', {
                wallMs: performance.now() - startedAt,
                files: 1,
                facts: observed.routes.length,
                cacheMisses: 1,
              });
              return observed;
            });
          } else {
            recordGraphPhase('frameworkBinding', {
              files: 1,
              facts: observation.routes.length,
              cacheHits: 1,
            });
          }
          const routes = observation.routes;
          if (observation.provenDynamic > 0) {
            unknownZones.push({
              code: 'graph.dynamic-route-unsupported',
              scope: input.locator,
              reason: 'A proven route receiver uses a path that is not a supported literal.',
            });
            if (outcome === 'processed') outcome = 'unsupported';
          }
          if (observation.unprovenRouteShaped > 0) {
            unknownZones.push({
              code: 'graph.route-receiver-unproven',
              scope: input.locator,
              reason:
                'A route-shaped HTTP call exists but its receiver is not bound by import, construction, alias, or registration evidence.',
            });
            if (outcome === 'processed') outcome = 'unsupported';
          }
          if (observation.extraCandidates > 0) {
            unknownZones.push({
              code: 'graph.dynamic-route-unsupported',
              scope: input.locator,
              reason: 'A route declaration exists but its path is not a supported literal.',
            });
            if (outcome === 'processed') outcome = 'unsupported';
          }
          if (routes.length > 0) {
            const subject = await request.resolveIdentity({
              namespace: 'workspai',
              kind: 'file',
              relativeLocator: input.locator,
              caseSensitivity: 'sensitive',
              scope: request.scope,
            });
            if (!subject.accepted) throw new Error('Route source identity could not be resolved.');
            for (const [routeIndex, route] of routes.entries()) {
              if (facts.length >= manifest.limits.maxFacts) {
                unknownZones.push({
                  code: 'graph.literal-routes-truncated',
                  scope: input.locator,
                  reason: 'Literal route facts exceeded the provider output budget.',
                });
                outcome = 'omitted';
                break;
              }
              const endpoint = await request.resolveIdentity({
                namespace: 'route',
                kind: 'endpoint',
                relativeLocator: httpRouteDeclaredLocator(route.method, route.path),
                caseSensitivity: 'sensitive',
                scope: request.scope,
              });
              if (!endpoint.accepted) {
                unknownZones.push({
                  code: 'graph.literal-route-identity-unsupported',
                  scope: input.locator,
                  reason:
                    'A literal route could not be represented as a portable endpoint identity.',
                });
                outcome = 'unsupported';
                continue;
              }
              facts.push({
                factId: `fact:literal-route:${String(inputIndex).padStart(8, '0')}:${String(routeIndex).padStart(8, '0')}:${input.digest.value}`,
                factType: 'source.literal-route',
                subject: subject.value.reference,
                predicate: 'exposes',
                object: endpoint.value.reference,
                scope: request.scope,
                evidence: [
                  {
                    id: `evidence:literal-route:${String(inputIndex).padStart(8, '0')}`,
                    sourceKind: 'source-file',
                    relativeLocator: input.locator,
                    digest: input.digest,
                  },
                ],
                provenance: { id: manifest.id, version: manifest.version },
                derivation: 'extracted',
                authority: 'observed',
                confidence: 1,
                freshness: { status: 'current' },
                truthLifecycle: { invalidatedBy: ['input-change', 'deletion'] },
                observedAt: request.observedAt,
                inputDigest: input.digest,
                unknownZones: [],
                extensions: Object.freeze({
                  httpMethod: route.method,
                  httpPath: route.path,
                }),
              });
            }
          }
        } catch {
          const diagnostic = {
            code: 'graph.route-source-invalid',
            severity: 'warning' as const,
            path: input.locator,
            message: 'Route source could not be decoded or analyzed within the admitted boundary.',
          };
          diagnostics.push(diagnostic);
          inputDiagnostics.push(diagnostic);
          unknownZones.push({
            code: 'graph.route-source-unreadable',
            scope: input.locator,
            reason: 'Literal routes are unknown because source input could not be admitted.',
          });
          outcome = 'failed';
        }
        processing.push({
          input: { locator: input.locator, digest: input.digest },
          provider: { id: manifest.id, version: manifest.version },
          stage: { id: 'literal-route-extraction', version: manifest.version },
          outcome,
          ...(outcome === 'processed' ? { outputDigest: input.digest } : {}),
          diagnostics: inputDiagnostics,
        });
      }
      return {
        contract: GRAPH_FACT_BATCH_CONTRACT,
        provider: { id: manifest.id, version: manifest.version },
        batchId: `batch:repository-routes:${inputs.length}`,
        scope: request.scope,
        inputs: inputs.map((input) => ({ locator: input.locator, digest: input.digest })),
        facts,
        diagnostics,
        coverage: [{ dimension: 'literal-routes', observed: facts.length }],
        unknownZones,
        unsupportedZones: [],
        redaction: { policy: 'portable-default', redacted: 0, omitted: 0 },
        status: processing.some((entry) => entry.outcome !== 'processed') ? 'partial' : 'complete',
        processing,
      } satisfies GraphFactBatch;
    },
  };
}
