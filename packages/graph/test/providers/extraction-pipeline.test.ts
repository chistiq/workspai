import { describe, expect, it } from 'vitest';

import {
  GRAPH_EXTRACTION_SUPPORT,
  GRAPH_JS_HTTP_SPECIFIERS,
  extractionSupportFor,
  goHttpMethodsFor,
  pythonHttpConstructorsFor,
} from '../../src/providers/index.js';

describe('extraction pipeline and HTTP capabilities', () => {
  it('describes support per language and fact class without treating extensions as semantics', () => {
    expect(extractionSupportFor('javascript', 'files')?.tier).toBe('inventory');
    expect(extractionSupportFor('javascript', 'routes')?.support).toBe('partial');
    expect(extractionSupportFor('python', 'files')?.tier).toBe('inventory');
    expect(extractionSupportFor('go', 'calls')?.support).toBe('partial');
    expect(extractionSupportFor('c-cpp', 'imports')?.tier).toBe('module-resolution');
    expect(extractionSupportFor('javascript', 'inheritance')?.support).toBe('unsupported');
    expect(GRAPH_EXTRACTION_SUPPORT.every((claim) => claim.notes.length > 0)).toBe(true);
  });

  it('exposes reusable HTTP module contracts rather than repository detectors', () => {
    expect(GRAPH_JS_HTTP_SPECIFIERS.has('express')).toBe(true);
    expect(GRAPH_JS_HTTP_SPECIFIERS.has('hono')).toBe(true);
    expect(pythonHttpConstructorsFor('flask').has('Flask')).toBe(true);
    expect(pythonHttpConstructorsFor('fastapi').has('APIRouter')).toBe(true);
    expect(goHttpMethodsFor('net/http').has('HandleFunc')).toBe(true);
    expect(goHttpMethodsFor('github.com/gin-gonic/gin').has('GET')).toBe(true);
    expect(goHttpMethodsFor('not-a-router').size).toBe(0);
  });
});
