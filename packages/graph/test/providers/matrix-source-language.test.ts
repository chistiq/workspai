import { describe, expect, it } from 'vitest';

import { GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE } from '../../src/contracts/index.js';
import {
  MATRIX_SOURCE_EXTENSIONS,
  decodeMatrixSource,
  extractMatrixDeclarations,
  extractMatrixLocalImportLocators,
  matchMatrixCallSites,
  matrixLanguageFor,
  matrixSourceExtractionBudget,
  scanMatrixCallSites,
  selectBalancedMatrixSources,
} from '../../src/providers/matrix-source-language.js';

describe('matrix source language', () => {
  it('covers every official-offline structural extension exactly once', () => {
    const listed = GRAPH_STANDARD_STRUCTURAL_EXTRACTOR_PROFILE.languages.flatMap(
      (profile) => profile.extensions
    );
    expect([...MATRIX_SOURCE_EXTENSIONS].sort()).toEqual([...new Set(listed)].sort());
    expect(listed).toHaveLength(new Set(listed).size);
    for (const extension of listed) {
      expect(matrixLanguageFor(`src/file${extension}`)).not.toBeNull();
    }
    expect(matrixLanguageFor('app.dart')).toBeNull();
  });

  it('extracts one observed declaration per official-offline language family', () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['src/a.ts', 'export function listItems(): void {}\n', 'listItems'],
      ['src/a.py', 'def list_items():\n    return 1\n', 'list_items'],
      ['src/a.go', 'package a\nfunc ListItems() {}\n', 'ListItems'],
      ['src/A.java', 'class ListItems {\n    String health() { return "ok"; }\n}\n', 'ListItems'],
      [
        'src/A.cs',
        'class ListItems {\n    public static string Status() => "ok";\n}\n',
        'ListItems',
      ],
      ['src/a.rs', 'fn list_items() {}\n', 'list_items'],
      ['src/a.cc', 'int list_items() { return 0; }\n', 'list_items'],
      ['src/a.m', '@interface ListItems : NSObject\n- (NSString *)health;\n@end\n', 'ListItems'],
      ['src/a.php', '<?php\nfunction list_items(): string { return "ok"; }\n', 'list_items'],
      ['src/a.rb', "def list_items\n  'ok'\nend\n", 'list_items'],
      ['src/a.swift', 'func listItems() -> String { "ok" }\n', 'listItems'],
      ['src/a.ex', 'defmodule ListItems do\n  def health(), do: :ok\nend\n', 'ListItems'],
      ['src/A.kt', 'class ListItems {\n  fun health() = "ok"\n}\n', 'ListItems'],
    ];
    for (const [locator, source, name] of cases) {
      const names = extractMatrixDeclarations(source, matrixLanguageFor(locator)).map(
        (item) => item.name
      );
      expect(names, locator).toContain(name);
    }
  });

  it('does not invent declarations from control-flow or unsupported languages', () => {
    expect(
      extractMatrixDeclarations(
        'int ready() { return 1; }\nif (ready()) { return; }\n',
        'c-cpp'
      ).map((item) => item.name)
    ).toEqual(['ready']);
    expect(extractMatrixDeclarations("import 'package:billing/core.dart';\n", null)).toEqual([]);
  });

  it('does not treat Node object-property call sites as typed function declarations', () => {
    const source = `import { handleCatalogRequest, handleOrderRequest } from './http.ts';

export function startStorefront(): void {
  return {
    catalog: handleCatalogRequest('storefront'),
    order: handleOrderRequest('storefront', 'order-1'),
  };
}
`;
    expect(
      extractMatrixDeclarations(source, 'node')
        .map((item) => item.name)
        .sort()
    ).toEqual(['startStorefront']);
  });

  it('resolves quoted C includes and PHP requires onto inventoried files', () => {
    const available = new Set(['src/server.cc', 'src/health.h', 'src/bootstrap.php']);
    expect(
      extractMatrixLocalImportLocators(
        'src/server.cc',
        '#include "health.h"\n#include <vector>\n',
        'c-cpp',
        available
      )
    ).toEqual(['src/health.h']);
    expect(
      extractMatrixLocalImportLocators(
        'src/index.php',
        "<?php\nrequire_once 'bootstrap.php';\n",
        'php',
        available
      )
    ).toEqual(['src/bootstrap.php']);
  });

  it('admits non-UTF8 source through a latin1 fallback instead of dropping the file', () => {
    const bytes = Uint8Array.from([0x66, 0x6e, 0x20, 0xa9, 0x28, 0x29, 0x7b, 0x7d, 0x0a]);
    const decoded = decodeMatrixSource(bytes);
    expect(decoded.encodingFallback).toBe(true);
    expect(decoded.text.includes('©') || decoded.text.includes('\u00a9')).toBe(true);
  });

  it('keeps adaptive extraction proportional and language-balanced', () => {
    expect(matrixSourceExtractionBudget(100)).toBe(2000);
    expect(matrixSourceExtractionBudget(9879)).toBe(5000);
    const locators = [
      ...Array.from({ length: 10 }, (_, index) => `src/a${String(index)}.py`),
      ...Array.from({ length: 10 }, (_, index) => `src/b${String(index)}.cc`),
    ];
    const selected = selectBalancedMatrixSources(locators, 6);
    expect(selected).toHaveLength(6);
    expect(selected.filter((locator) => locator.endsWith('.py'))).toHaveLength(3);
    expect(selected.filter((locator) => locator.endsWith('.cc'))).toHaveLength(3);
  });

  it('resolves unique Java type imports and Objective-C message sends', () => {
    expect(
      extractMatrixLocalImportLocators(
        'src/app/App.java',
        'import com.example.Health;\n',
        'java',
        new Set(['src/app/App.java', 'src/health/Health.java'])
      )
    ).toEqual(['src/health/Health.java']);
    expect(
      matchMatrixCallSites('NSString *value = [service health];\n', 'objective-c-matlab', 'health')
    ).not.toHaveLength(0);
    expect(matchMatrixCallSites('health\n', 'ruby', 'health')).not.toHaveLength(0);
    expect(scanMatrixCallSites('run();\nshared();\n', 'node').map((site) => site.name)).toEqual([
      'run',
      'shared',
    ]);
  });
});
