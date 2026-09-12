import { describe, expect, it } from 'vitest';

import {
  parseBazelBuildDocument,
  parseCmakeBuildDocument,
} from '../../src/providers/build-topology.js';
import { parseProtobufDocument } from '../../src/providers/protobuf-topology.js';

describe('bounded declaration parsers', () => {
  it('extracts portable Bazel targets and literal dependencies', () => {
    expect(
      parseBazelBuildDocument(
        'services/checkout/BUILD.bazel',
        [
          '# A comment with an unmatched parenthesis (',
          'cc_library(',
          '  name = "checkout",',
          '  # An in-call comment with unmatched parentheses (((',
          '  deps = [":local", "//shared:api", "@rules//tooling:runtime"],',
          '  doc = """parentheses in a string (()""",',
          ')',
        ].join('\n')
      )
    ).toEqual({
      targets: [
        {
          name: '//services/checkout:checkout',
          dependencies: ['//services/checkout:local', '//shared:api', '@rules//tooling:runtime'],
        },
      ],
      dynamicDependencies: false,
    });
  });

  it('marks computed Bazel dependencies without inventing edges', () => {
    expect(
      parseBazelBuildDocument('BUILD', 'cc_binary(name = "app", deps = select(DEPS))')
    ).toEqual({
      targets: [{ name: '//:app', dependencies: [] }],
      dynamicDependencies: true,
    });
    expect(() => parseBazelBuildDocument('BUILD', 'cc_library(name = "broken"')).toThrow(
      'not balanced'
    );
  });

  it('ignores Bazel calls without target identity and normalizes dependency variants', () => {
    expect(
      parseBazelBuildDocument(
        'pkg/BUILD',
        [
          'load("//tools:defs.bzl", "rule")',
          'custom_rule(',
          '  name = "worker",',
          '  deps = ["library", "library", ":local"],',
          '  note = "escaped quote: \\" and nested (text)",',
          ')',
        ].join('\n')
      )
    ).toEqual({
      targets: [
        {
          name: '//pkg:worker',
          dependencies: ['//pkg:local', 'library'],
        },
      ],
      dynamicDependencies: false,
    });
  });

  it('extracts CMake targets while keeping computed dependencies unknown', () => {
    expect(
      parseCmakeBuildDocument(
        [
          'add_library(core src/core.cc)',
          'add_executable(app src/main.cc)',
          'target_link_libraries(app PRIVATE core ${DYNAMIC_LIB} $<IF:platform,x,y>)',
        ].join('\n')
      )
    ).toEqual({
      targets: [
        { name: 'cmake:app', dependencies: ['cmake:core'] },
        { name: 'cmake:core', dependencies: [] },
      ],
      dynamicDependencies: true,
    });
  });

  it('handles CMake comments, quoted arguments and forward target references', () => {
    expect(
      parseCmakeBuildDocument(
        [
          '# comment with unmatched parenthesis (',
          'target_link_libraries(worker PUBLIC "core lib" debug trace)',
          'add_executable(worker "main file.cc")',
          'add_library(${COMPUTED_TARGET} generated.cc)',
        ].join('\n')
      )
    ).toEqual({
      targets: [
        {
          name: 'cmake:worker',
          dependencies: ['cmake:core lib', 'cmake:trace'],
        },
      ],
      dynamicDependencies: true,
    });
    expect(() => parseCmakeBuildDocument('add_library(core')).toThrow('not balanced');
  });

  it('parses Protobuf comments, imports, declarations and RPCs', () => {
    expect(
      parseProtobufDocument(
        [
          '// A comment may contain /* without opening a block.',
          'syntax = "proto3";',
          'package example.health;',
          'import public "google/protobuf/empty.proto";',
          'message Reply { string value = 1; }',
          'enum State { STATE_UNSPECIFIED = 0; }',
          'service Health {',
          '  rpc Check (google.protobuf.Empty) returns (Reply);',
          '  rpc Watch (stream Reply) returns (stream Reply);',
          '}',
        ].join('\n')
      )
    ).toEqual({
      packageName: 'example.health',
      imports: ['google/protobuf/empty.proto'],
      schemas: ['Reply', 'State'],
      services: [{ name: 'Health', methods: ['Check', 'Watch'] }],
    });
  });

  it('fails closed on malformed Protobuf boundaries', () => {
    expect(() => parseProtobufDocument('message Broken {')).toThrow('not balanced');
    expect(() => parseProtobufDocument('option value = "unterminated;')).toThrow('unterminated');
    expect(() => parseProtobufDocument('/* unterminated')).toThrow('unterminated');
  });

  it('supports package-less and weak Protobuf declarations without duplicate facts', () => {
    expect(
      parseProtobufDocument(
        [
          '/* block comment',
          ' * with braces { and a newline',
          ' */',
          'import weak "optional.proto";',
          'import "optional.proto";',
          'message Item { string text = 1 [default = "escaped \\" value"]; }',
          'service Store { rpc Get (Item) returns (Item); rpc Get (Item) returns (Item); }',
        ].join('\n')
      )
    ).toEqual({
      imports: ['optional.proto'],
      schemas: ['Item'],
      services: [{ name: 'Store', methods: ['Get'] }],
    });
    expect(parseProtobufDocument('syntax = "proto3";')).toEqual({
      imports: [],
      schemas: [],
      services: [],
    });
    expect(() => parseProtobufDocument('}')).toThrow('not balanced');
  });
});
