import { describe, expect, it } from 'vitest';

import {
  CONSTRUCTOR_LOOKBEHIND,
  DECLARATION_KEYWORD_LOOKBEHIND,
  isConstructorCall,
  isKeywordDeclarationName,
} from '../../src/providers/source-declarations.js';

function naiveKeywordDeclarationName(source: string, index: number): boolean {
  return /(?:^|[^A-Za-z0-9_$])(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|def|func|fn|fun)\s+$/u.test(
    source.slice(0, index)
  );
}

function naiveConstructorCall(source: string, index: number): boolean {
  return /(?:^|[^A-Za-z0-9_$])new\s+$/u.test(source.slice(0, index));
}

function permutation(seed: number, values: readonly string[]): string[] {
  const output = [...values];
  let state = seed >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [output[index], output[target]] = [output[target] as string, output[index] as string];
  }
  return output;
}

const fixtures = {
  tsDeclarations: [
    'export function alpha() {}',
    'export default function beta() {}',
    'async function gamma() {}',
    'const value = 1; function delta() {}',
  ].join('\n'),
  jsDeclarations: 'module.exports = function epsilon() { return 1; };\n',
  pythonDeclarations: ['def zeta(x):', '    return x', '', 'async def eta():', '    return 1'].join(
    '\n'
  ),
  calls: 'alpha(); beta(1); gamma.delta();\n',
  memberCalls: 'this.alpha(); obj.beta(); foo?.bar();\n',
  constructors: 'const x = new Alpha(); const y = new Beta.Gamma();\n',
  exports: 'export { alpha as beta, gamma };\nexport default delta;\n',
  reexports: 'export { alpha } from "./mod.js";\nexport * from "./all.js";\n',
  aliases: 'export { alpha as alphaAlias };\nconst alias = alpha;\n',
  privateSymbols: [
    'function hidden() {}',
    'const _private = 1;',
    'class Box { #secret() {} }',
  ].join('\n'),
  duplicateNames: 'function twin() {}\nfunction twin() {}\n',
  generated: '/* @generated */\nexport function generatedFn() {}\n',
  truncatedPreamble: `${'x'.repeat(400)}function late() {}\n`,
  commentsAndStrings:
    'const text = "function decoy()";\n// function commented() {}\nfunction real() {}\n',
  malformed: 'function (\nexport function {\nnew (\n',
  longPreamble: `${'// preamble\n'.repeat(80)}export async function afterPreamble() {}\n`,
};

describe('source-declaration lookbehind equivalence', () => {
  it('matches the naive full-prefix reference for synthetic fixtures', () => {
    for (const source of Object.values(fixtures)) {
      for (let index = 0; index <= source.length; index += 1) {
        expect(isKeywordDeclarationName(source, index)).toBe(
          naiveKeywordDeclarationName(source, index)
        );
        expect(isConstructorCall(source, index)).toBe(naiveConstructorCall(source, index));
      }
    }
  });

  it('stays equivalent under permutations of fixture fragments', () => {
    const fragments = Object.values(fixtures);
    for (const seed of [1, 7, 13, 99]) {
      const source = permutation(seed, fragments).join('\n');
      for (
        let index = 0;
        index <= source.length;
        index += Math.max(1, Math.floor(source.length / 40))
      ) {
        expect(isKeywordDeclarationName(source, index)).toBe(
          naiveKeywordDeclarationName(source, index)
        );
        expect(isConstructorCall(source, index)).toBe(naiveConstructorCall(source, index));
      }
    }
  });

  it('keeps bounded windows large enough for real declaration keywords', () => {
    expect(DECLARATION_KEYWORD_LOOKBEHIND).toBeGreaterThanOrEqual(
      'export default async function '.length
    );
    expect(CONSTRUCTOR_LOOKBEHIND).toBeGreaterThanOrEqual('new '.length);
    const source = `${'p'.repeat(200)}export default async function target() {}`;
    const index = source.indexOf('target');
    expect(isKeywordDeclarationName(source, index)).toBe(true);
    expect(naiveKeywordDeclarationName(source, index)).toBe(true);
  });
});
