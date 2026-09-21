import { describe, expect, it } from 'vitest';

import {
  scanEcmascriptCallChains,
  tokenizeEcmascript,
} from '../../src/providers/ecmascript-syntax.js';

describe('ecmascript syntax scan', () => {
  it('skips comments and strings while preserving member/call chains', () => {
    const source = [
      "import express from 'express';",
      '// express().get("/comment", handler);',
      "express().get('/health', handler);",
      "express.Router().post('/orders', handler);",
      "new Hono().put('/item', handler);",
      "require('express')().delete('/gone', handler);",
      "other.express().get('/not-root', handler);",
    ].join('\n');
    const chains = scanEcmascriptCallChains(source);
    const roots = chains.map((chain) => chain.root);
    expect(roots).toContain('express');
    expect(roots).toContain('Hono');
    expect(roots).toContain('require');
    expect(roots).toContain('other');
    expect(
      tokenizeEcmascript('const x = /foo\\/bar/g; x.toString();').some(
        (token) => token.value === 'toString'
      )
    ).toBe(true);
  });

  it('records require specifiers and constructor new without treating package names as files', () => {
    const [requireChain] = scanEcmascriptCallChains("require('hono')().get('/ok', h);");
    expect(requireChain?.requireSpecifier).toBe('hono');
    const [constructed] = scanEcmascriptCallChains("new Router().get('/ok', h);");
    expect(constructed?.usedNew).toBe(true);
    expect(constructed?.root).toBe('Router');
  });

  it('tokenizes templates, block comments, regex character classes and incomplete forms without guessing', () => {
    const tokens = tokenizeEcmascript(
      'const x = `a\\`${y + {z: 1}}`; /* open\n still comment */ const y = /[a/b]/g; foo(1, 2); bar.; require(`tmpl`)(); require("a\\nb")(); ident('
    );
    expect(tokens.some((token) => token.kind === 'ident' && token.value === 'y')).toBe(true);
    expect(tokens.some((token) => token.kind === 'ident' && token.value === 'foo')).toBe(true);
    const chains = scanEcmascriptCallChains(
      'foo(1, 2); bar.; ident(unclosed; require(`tmpl`)(); require("ok")();'
    );
    expect(chains.some((chain) => chain.root === 'foo')).toBe(true);
    expect(
      chains.find((chain) => chain.root === 'require' && chain.requireSpecifier === 'ok')
    ).toBeDefined();
    expect(
      scanEcmascriptCallChains('ident(unclosed').every(
        (chain) =>
          chain.root !== 'ident' || chain.steps.length === 0 || chain.steps[0]?.kind === 'call'
      )
    ).toBe(true);
  });
});
