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
  native: GraphNativePort | undefined
): GraphNativeDeclarationRoute {
  const reference = extractMatrixDeclarations(source, language);
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
