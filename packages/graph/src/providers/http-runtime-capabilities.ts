/**
 * HTTP runtime capabilities are language and published-module contracts, not
 * repository detectors. Specifiers are npm/PyPI/Go module ids of HTTP libraries.
 * Matching a specifier proves a receiver candidate; it does not invent routes.
 */
export {
  GRAPH_GO_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_HTTP_RUNTIME_CAPABILITIES_VERSION,
  GRAPH_JS_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES,
  type GraphGoHttpRuntimeCapability,
  type GraphJsHttpRuntimeCapability,
  type GraphPythonHttpRuntimeCapability,
} from '../contracts/http-runtime-capabilities.js';

import {
  GRAPH_GO_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_JS_HTTP_RUNTIME_CAPABILITIES,
  GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES,
} from '../contracts/http-runtime-capabilities.js';

export const GRAPH_JS_HTTP_SPECIFIERS: ReadonlySet<string> = new Set(
  GRAPH_JS_HTTP_RUNTIME_CAPABILITIES.flatMap((capability) => capability.specifiers)
);

export const GRAPH_JS_HTTP_ROUTER_EXPORTS: ReadonlySet<string> = new Set(
  GRAPH_JS_HTTP_RUNTIME_CAPABILITIES.flatMap((capability) => capability.routerExports)
);

export function pythonHttpConstructorsFor(specifier: string): ReadonlySet<string> {
  const constructors = new Set<string>();
  for (const capability of GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES) {
    if (capability.specifiers.includes(specifier)) {
      for (const name of capability.constructors) constructors.add(name);
    }
  }
  return constructors;
}

export function goHttpMethodsFor(specifier: string): ReadonlySet<string> {
  const methods = new Set<string>();
  for (const capability of GRAPH_GO_HTTP_RUNTIME_CAPABILITIES) {
    if (capability.specifiers.includes(specifier)) {
      for (const method of capability.methods) methods.add(method);
    }
  }
  return methods;
}
