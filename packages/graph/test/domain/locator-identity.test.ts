import { describe, expect, it } from 'vitest';

import {
  GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES,
  admitDeclaredGraphLocator,
  classifyGraphRelativeLocator,
  decodeGraphLocatorState,
  opaqueGraphDeclaredLocator,
} from '../../src/domain/locator-identity.js';
import { normalizeGraphEntityIdentity } from '../../src/conformance/identity.js';

const scope = { kind: 'project' as const, projectIds: ['project:fixture'] as [string] };

describe('Graph locator identity', () => {
  it('keeps portable file paths distinct from opaque declared module locators', () => {
    expect(classifyGraphRelativeLocator('src/health.h', 'file')).toEqual({
      class: 'portable',
      locator: 'src/health.h',
    });
    expect(classifyGraphRelativeLocator('targets/instructions.td', 'file')).toEqual({
      class: 'portable',
      locator: 'targets/instructions.td',
    });
    const opaque = opaqueGraphDeclaredLocator('encoded', '../secret.h');
    expect(classifyGraphRelativeLocator(opaque, 'module')).toEqual({
      class: 'opaque',
      locator: opaque,
    });
    expect(GRAPH_OPAQUE_DECLARED_LOCATOR_PREFIXES).toEqual(['encoded', 'targets']);
  });

  it('does not reconstitute opaque declared locators into filesystem traversal', () => {
    const opaque = opaqueGraphDeclaredLocator('encoded', '../secret.h');
    const rendered = encodeURIComponent(opaque);
    expect(decodeGraphLocatorState(rendered, { freezeOpaqueDeclared: true })).toEqual({
      status: 'stable',
      value: opaque,
    });
    expect(classifyGraphRelativeLocator(rendered, 'module').class).toBe('opaque');
    expect(classifyGraphRelativeLocator(opaque, 'file').class).toBe('unsafe');
  });

  it('freezes opaque declared payloads instead of decoding percent sequences inside them', () => {
    const opaque = opaqueGraphDeclaredLocator('encoded', 'pkg%util');
    expect(opaque).toContain('%25');
    expect(
      decodeGraphLocatorState(encodeURIComponent(opaque), { freezeOpaqueDeclared: true })
    ).toEqual({ status: 'stable', value: opaque });
    expect(classifyGraphRelativeLocator(encodeURIComponent(opaque), 'module')).toEqual({
      class: 'opaque',
      locator: opaque,
    });
  });

  it('fails closed on percent-encoded traversal that is not an opaque declared locator', () => {
    expect(classifyGraphRelativeLocator('%2e%2e%2fsecret.ts', 'file').class).toBe('unsafe');
    expect(classifyGraphRelativeLocator('%252e%252e%252fsecret.ts', 'file').class).toBe('unsafe');
    expect(classifyGraphRelativeLocator('src/%2e%2e/%2e%2e/etc/passwd', 'file').class).toBe(
      'unsafe'
    );
    expect(
      normalizeGraphEntityIdentity({
        namespace: 'workspai',
        kind: 'file',
        relativeLocator: '%2e%2e%2fsecret.ts',
        caseSensitivity: 'sensitive',
        scope,
      }).accepted
    ).toBe(false);
  });

  it('fails closed when nested encodings would still change after the decode cap', () => {
    let encoded = '../secret.ts';
    for (let layer = 0; layer < 25; layer += 1) encoded = encodeURIComponent(encoded);
    expect(classifyGraphRelativeLocator(encoded, 'file').class).toBe('unsafe');
    expect(
      normalizeGraphEntityIdentity({
        namespace: 'workspai',
        kind: 'file',
        relativeLocator: encoded,
        caseSensitivity: 'sensitive',
        scope,
      }).accepted
    ).toBe(false);
  });

  it('admits opaque module locators and rejects raw traversal as a module path', () => {
    const opaque = opaqueGraphDeclaredLocator('targets', '//foo/bar:baz');
    expect(
      normalizeGraphEntityIdentity({
        namespace: 'bazel-target',
        kind: 'module',
        relativeLocator: opaque,
        caseSensitivity: 'sensitive',
        scope,
      })
    ).toMatchObject({
      accepted: true,
      value: { normalizedLocator: opaque },
    });
    expect(
      normalizeGraphEntityIdentity({
        namespace: 'c-cpp-module',
        kind: 'module',
        relativeLocator: '../secret.h',
        caseSensitivity: 'sensitive',
        scope,
      }).accepted
    ).toBe(false);
  });

  it('wraps unsafe declared imports without changing portable specifiers', () => {
    expect(admitDeclaredGraphLocator('vector', 'encoded')).toBe('vector');
    expect(admitDeclaredGraphLocator('service/health.h', 'encoded')).toBe('service/health.h');
    expect(admitDeclaredGraphLocator('../secret.h', 'encoded')).toBe(
      opaqueGraphDeclaredLocator('encoded', '../secret.h')
    );
    expect(admitDeclaredGraphLocator('/usr/include/stdio.h', 'encoded')).toBe(
      opaqueGraphDeclaredLocator('encoded', '/usr/include/stdio.h')
    );
  });

  it('does not case-fold opaque declared payloads', () => {
    const opaque = opaqueGraphDeclaredLocator('encoded', '../Secret.H');
    const first = normalizeGraphEntityIdentity({
      namespace: 'c-cpp-module',
      kind: 'module',
      relativeLocator: opaque,
      caseSensitivity: 'insensitive',
      scope,
    });
    expect(first).toMatchObject({ accepted: true, value: { normalizedLocator: opaque } });
  });
});
