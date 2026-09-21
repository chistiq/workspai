/**
 * HTTP runtime capabilities are language and published-module contracts, not
 * repository detectors. Specifiers are npm/PyPI/Go module ids of HTTP libraries.
 * Matching a specifier proves a receiver candidate; it does not invent routes.
 */
export const GRAPH_HTTP_RUNTIME_CAPABILITIES_VERSION =
  'workspai.graph.http-runtime-capabilities.v1' as const;

export interface GraphJsHttpRuntimeCapability {
  readonly language: 'javascript';
  readonly specifiers: readonly string[];
  readonly routerExports: readonly string[];
}

export interface GraphPythonHttpRuntimeCapability {
  readonly language: 'python';
  readonly specifiers: readonly string[];
  readonly constructors: readonly string[];
}

export interface GraphGoHttpRuntimeCapability {
  readonly language: 'go';
  readonly specifiers: readonly string[];
  readonly methods: readonly string[];
  readonly stdlib: boolean;
}

export const GRAPH_JS_HTTP_RUNTIME_CAPABILITIES: readonly GraphJsHttpRuntimeCapability[] =
  Object.freeze([
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['express', 'express-promise-router']),
      routerExports: Object.freeze(['Router', 'default']),
    }),
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['fastify']),
      routerExports: Object.freeze([]),
    }),
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['hono']),
      routerExports: Object.freeze(['Hono', 'default']),
    }),
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['koa', 'koa-router', '@koa/router']),
      routerExports: Object.freeze(['Router', 'default']),
    }),
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['@hapi/hapi', 'hapi']),
      routerExports: Object.freeze(['Server', 'default']),
    }),
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['@nestjs/common', '@nestjs/core']),
      routerExports: Object.freeze(['Router', 'default']),
    }),
    Object.freeze({
      language: 'javascript' as const,
      specifiers: Object.freeze(['itty-router', 'polka', 'restify']),
      routerExports: Object.freeze(['Router', 'default']),
    }),
  ]);

export const GRAPH_PYTHON_HTTP_RUNTIME_CAPABILITIES: readonly GraphPythonHttpRuntimeCapability[] =
  Object.freeze([
    Object.freeze({
      language: 'python' as const,
      specifiers: Object.freeze(['flask']),
      constructors: Object.freeze(['Flask', 'Blueprint']),
    }),
    Object.freeze({
      language: 'python' as const,
      specifiers: Object.freeze(['fastapi']),
      constructors: Object.freeze(['FastAPI', 'APIRouter']),
    }),
    Object.freeze({
      language: 'python' as const,
      specifiers: Object.freeze(['starlette.applications', 'starlette.routing']),
      constructors: Object.freeze(['Starlette', 'Router']),
    }),
  ]);

const GO_HTTP_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'Any',
  'HandleFunc',
  'Handle',
]);

export const GRAPH_GO_HTTP_RUNTIME_CAPABILITIES: readonly GraphGoHttpRuntimeCapability[] =
  Object.freeze([
    Object.freeze({
      language: 'go' as const,
      specifiers: Object.freeze(['net/http']),
      methods: Object.freeze(['HandleFunc', 'Handle']),
      stdlib: true,
    }),
    Object.freeze({
      language: 'go' as const,
      specifiers: Object.freeze(['github.com/gin-gonic/gin']),
      methods: GO_HTTP_METHODS,
      stdlib: false,
    }),
    Object.freeze({
      language: 'go' as const,
      specifiers: Object.freeze(['github.com/labstack/echo', 'github.com/labstack/echo/v4']),
      methods: GO_HTTP_METHODS,
      stdlib: false,
    }),
    Object.freeze({
      language: 'go' as const,
      specifiers: Object.freeze(['github.com/go-chi/chi', 'github.com/go-chi/chi/v5']),
      methods: GO_HTTP_METHODS,
      stdlib: false,
    }),
    Object.freeze({
      language: 'go' as const,
      specifiers: Object.freeze(['github.com/gorilla/mux']),
      methods: Object.freeze(['HandleFunc', 'Handle', 'Methods']),
      stdlib: false,
    }),
  ]);
