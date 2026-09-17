import type { GraphStructuralLanguage } from '../contracts/index.js';
import type { GraphNativePort } from '../ports/index.js';
import { extractMatrixDeclarations, type MatrixDeclaration } from './matrix-source-language.js';

export type GraphNativeDeclarationRoute =
  | {
      readonly engine: 'typescript';
      readonly reason: 'native-unavailable' | 'native-failed' | 'native-mismatch';
      readonly declarations: readonly MatrixDeclaration[];
    }
  | {
      readonly engine: 'rust-wasm';
      readonly reason: 'parity-qualified';
      readonly declarations: readonly MatrixDeclaration[];
    };

export type GraphPublishedDeclarationRoute =
  | {
      readonly engine: 'typescript';
      readonly reason: 'native-unavailable' | 'native-failed';
      readonly declarations: readonly MatrixDeclaration[];
    }
  | {
      readonly engine: 'rust-wasm';
      readonly reason: 'native-admitted';
      readonly declarations: readonly MatrixDeclaration[];
    };

function sameDeclarations(
  left: readonly MatrixDeclaration[],
  right: readonly MatrixDeclaration[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.name === right[index]?.name &&
        item.detail === right[index]?.detail &&
        item.line === right[index]?.line
    )
  );
}

/**
 * Routes matrix declaration extraction through the bundled engine only when it
 * matches TypeScript. A mismatch or native failure never silently changes the
 * observed symbol set: TypeScript remains the returned authority.
 */
export function routeGraphNativeDeclarations(
  source: string,
  language: GraphStructuralLanguage | null,
  native: GraphNativePort | undefined,
  codeView?: string
): GraphNativeDeclarationRoute {
  const reference = extractMatrixDeclarations(source, language, codeView);
  if (!native?.extractDeclarations) {
    return { engine: 'typescript', reason: 'native-unavailable', declarations: reference };
  }
  const candidate = native.extractDeclarations({ source, language });
  if (candidate.status !== 'complete') {
    return { engine: 'typescript', reason: 'native-failed', declarations: reference };
  }
  if (!sameDeclarations(candidate.declarations, reference)) {
    return { engine: 'typescript', reason: 'native-mismatch', declarations: reference };
  }
  return {
    engine: 'rust-wasm',
    reason: 'parity-qualified',
    declarations: candidate.declarations,
  };
}

/**
 * Publishes native declarations on the inspect/build path when the bundled
 * engine completes. TypeScript remains the fallback and the dual-exec
 * admission probe; production no longer pays TypeScript for every file after
 * native admission.
 */
export function extractPublishedMatrixDeclarations(
  source: string,
  language: GraphStructuralLanguage | null,
  native: GraphNativePort | undefined,
  codeView?: string
): GraphPublishedDeclarationRoute {
  if (!native?.extractDeclarations) {
    return {
      engine: 'typescript',
      reason: 'native-unavailable',
      declarations: extractMatrixDeclarations(source, language, codeView),
    };
  }
  const candidate = native.extractDeclarations({ source, language });
  if (candidate.status !== 'complete') {
    return {
      engine: 'typescript',
      reason: 'native-failed',
      declarations: extractMatrixDeclarations(source, language, codeView),
    };
  }
  return {
    engine: 'rust-wasm',
    reason: 'native-admitted',
    declarations: candidate.declarations,
  };
}
