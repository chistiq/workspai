import { describe, expect, it } from 'vitest';

import { collectRustUseImports, expandRustUseTree } from '../../src/domain/rust-use.js';

describe('rust use trees', () => {
  it('expands nested use trees into the imported paths', () => {
    expect(expandRustUseTree('foo::Bar')).toEqual(['foo::Bar']);
    expect(expandRustUseTree('foo::Bar as Baz')).toEqual(['foo::Bar']);
    expect(expandRustUseTree('foo::*')).toEqual(['foo::*']);
    expect(expandRustUseTree('foo::{Bar, Baz}')).toEqual(['foo::Bar', 'foo::Baz']);
    expect(expandRustUseTree('foo::{bar::Baz, Qux}')).toEqual(['foo::bar::Baz', 'foo::Qux']);
    expect(expandRustUseTree('foo::{self, Bar}')).toEqual(['foo', 'foo::Bar']);
    expect(expandRustUseTree('a::{b::{C, D}, E}')).toEqual(['a::b::C', 'a::b::D', 'a::E']);
    expect(expandRustUseTree('foo::{*}')).toEqual(['foo::*']);
  });

  it('collects pub and multiline use statements once', () => {
    const source = [
      'use crate::plain;',
      'pub(crate) use axum::{routing::get, Router};',
      'use nested::{',
      '    left::Item,',
      '    // not::Imported',
      '    right::Item,',
      '};',
      'use crate::plain;',
    ].join('\n');
    expect(collectRustUseImports(source).map((item) => item.path)).toEqual([
      'crate::plain',
      'axum::routing::get',
      'axum::Router',
      'nested::left::Item',
      'nested::right::Item',
    ]);
  });
});
