import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GRAPH_IDENTITY_SCHEME,
  type GraphFactBatch,
  type GraphProviderInput,
} from '../../src/contracts/index.js';
import {
  createEcosystemManifestsProvider,
  parseCargoDeclaredManifest,
  parseCMakeDeclaredManifest,
  parseComposerDeclaredManifest,
  parseGoModuleDeclaredManifest,
  parseMavenDeclaredManifest,
  parseNugetDeclaredManifest,
} from '../../src/providers/ecosystem-manifests.js';

const scope = { kind: 'project' as const, projectIds: ['demo'] as [string] };

function digestOf(content: string) {
  return {
    algorithm: 'sha256' as const,
    value: createHash('sha256').update(content).digest('hex'),
  };
}

function inputOf(locator: string, content: string): GraphProviderInput {
  const bytes = new TextEncoder().encode(content);
  return {
    locator,
    mediaType: 'text/plain',
    byteLength: bytes.byteLength,
    digest: digestOf(content),
  };
}

describe('declared Cargo and Go manifests', () => {
  it('reads Cargo dependency keys and workspace-inherited names without guessing targets', () => {
    const parsed = parseCargoDeclaredManifest(`
      [package]
      name = "shipping"
      version.workspace = true

      [dependencies]
      actix-web = "4"
      tokio.workspace = true
      renamed = { package = "real-crate", version = "1" }

      [dev-dependencies]
      pretty_assertions = "1"

      [features]
      default = ["actix-web"]

      [dependencies.uuid]
      version = "1"
    `);
    expect(parsed).toEqual({
      ecosystem: 'cargo',
      name: 'shipping',
      dependencies: ['actix-web', 'pretty_assertions', 'renamed', 'tokio', 'uuid'],
    });
  });

  it('reads declared CMake, Composer, Maven, and NuGet names', () => {
    expect(
      parseCMakeDeclaredManifest(
        'find_package(gRPC CONFIG REQUIRED)\nfind_package(opentelemetry-cpp)\n'
      )
    ).toEqual({
      ecosystem: 'cmake',
      name: 'anonymous',
      dependencies: ['gRPC', 'opentelemetry-cpp'],
    });
    expect(
      parseComposerDeclaredManifest(
        '{"name":"otel/quote","require":{"php":"^8.2","guzzlehttp/guzzle":"^7"}}'
      )
    ).toEqual({
      ecosystem: 'composer',
      name: 'otel/quote',
      dependencies: ['guzzlehttp/guzzle', 'php'],
    });
    expect(
      parseMavenDeclaredManifest(
        '<project><artifactId>ad</artifactId><dependencies><dependency><groupId>io.grpc</groupId><artifactId>grpc-netty</artifactId></dependency></dependencies></project>'
      ).dependencies
    ).toEqual(['io.grpc:grpc-netty']);
    expect(
      parseNugetDeclaredManifest(
        'src/cart/cart.csproj',
        '<Project><PackageReference Include="Grpc.AspNetCore" Version="2.57.0" /></Project>'
      )
    ).toEqual({ ecosystem: 'nuget', name: 'cart', dependencies: ['Grpc.AspNetCore'] });
  });

  it('reads a Go module path and require lines', () => {
    const parsed = parseGoModuleDeclaredManifest(`
      module github.com/example/checkout

      go 1.22

      require (
        github.com/example/shared v1.2.3
        golang.org/x/net v0.24.0 // indirect
      )
    `);
    expect(parsed.name).toBe('github.com/example/checkout');
    expect(parsed.dependencies).toEqual(['github.com/example/shared', 'golang.org/x/net']);
  });

  it('emits contains and depends-on for the declared names only', async () => {
    const cargo = `
      [package]
      name = "shipping"
      [dependencies]
      actix-web = "4"
    `;
    const source = inputOf('src/shipping/Cargo.toml', cargo);
    const identities: string[] = [];
    const batch = (await createEcosystemManifestsProvider().collect({
      scope,
      inputs: [source, inputOf('src/main.go', 'package main\n')],
      observedAt: '2026-09-13T12:00:00.000Z',
      resolveIdentity: async (identity) => {
        identities.push(`${identity.namespace}:${identity.kind}:${identity.relativeLocator}`);
        return {
          accepted: true as const,
          issues: [] as const,
          value: {
            reference: {
              id: `entity:${identity.namespace}:${identity.kind}:${identity.relativeLocator}`,
              identityScheme: GRAPH_IDENTITY_SCHEME,
              kind: identity.kind,
              scope,
            },
            normalizedLocator: identity.relativeLocator,
          },
        };
      },
      readInput: async () => new TextEncoder().encode(cargo),
    })) as GraphFactBatch;

    expect(batch.status).toBe('complete');
    expect(batch.facts.map((fact) => fact.predicate)).toEqual(['contains', 'depends-on']);
    expect(identities).toEqual([
      'workspai:repository:.',
      'cargo-project:package:src/shipping#shipping',
      'cargo-package:package:dependency:actix-web',
    ]);
  });
});
