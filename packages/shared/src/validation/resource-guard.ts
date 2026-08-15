import type {
  WisValidationCancellationSignal,
  WisValidationDiagnostic,
  WisValidationLimits,
} from './types.js';

interface PendingValue {
  readonly value: unknown;
  readonly path: string;
  readonly depth: number;
  readonly leaving?: boolean;
}

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function diagnostic(code: string, path: string, message: string): WisValidationDiagnostic {
  return { code, phase: 'resource', path, message };
}

export function inspectJsonResourceLimits(
  input: unknown,
  limits: WisValidationLimits,
  signal?: WisValidationCancellationSignal
): WisValidationDiagnostic[] {
  const diagnostics: WisValidationDiagnostic[] = [];
  const pending: PendingValue[] = [{ value: input, path: '', depth: 0 }];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let totalStringLength = 0;

  // Retain one hidden diagnostic beyond the public cap so callers can report
  // truncation instead of falsely claiming that the visible list is complete.
  while (pending.length > 0 && diagnostics.length <= limits.maxDiagnostics) {
    if (signal?.aborted) {
      diagnostics.push(
        diagnostic(
          'WIS_RESOURCE_CANCELLED',
          '',
          'Validation was cancelled at a bounded traversal checkpoint.'
        )
      );
      break;
    }
    const current = pending.pop();
    if (!current) break;
    if (current.leaving) {
      if (current.value && typeof current.value === 'object') ancestors.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > limits.maxNodes) {
      diagnostics.push(
        diagnostic('WIS_RESOURCE_NODE_LIMIT', current.path, 'Input exceeds the node limit.')
      );
      break;
    }
    if (current.depth > limits.maxDepth) {
      diagnostics.push(
        diagnostic('WIS_RESOURCE_DEPTH_LIMIT', current.path, 'Input exceeds the depth limit.')
      );
      continue;
    }

    const { value } = current;
    if (typeof value === 'string') {
      totalStringLength += value.length;
      if (value.length > limits.maxStringLength) {
        diagnostics.push(
          diagnostic(
            'WIS_RESOURCE_STRING_LIMIT',
            current.path,
            'A string exceeds the per-value length limit.'
          )
        );
      }
      if (totalStringLength > limits.maxTotalStringLength) {
        diagnostics.push(
          diagnostic(
            'WIS_RESOURCE_TOTAL_STRING_LIMIT',
            current.path,
            'Input exceeds the cumulative string length limit.'
          )
        );
        break;
      }
      continue;
    }
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        diagnostics.push(
          diagnostic('WIS_RESOURCE_NON_JSON_NUMBER', current.path, 'Numbers must be finite.')
        );
      }
      continue;
    }
    if (typeof value !== 'object') {
      diagnostics.push(
        diagnostic(
          'WIS_RESOURCE_NON_JSON_VALUE',
          current.path,
          'Input must contain JSON values only.'
        )
      );
      continue;
    }
    if (ancestors.has(value)) {
      diagnostics.push(
        diagnostic(
          'WIS_RESOURCE_CYCLIC_OBJECT',
          current.path,
          'Cyclic object references are not valid portable JSON input.'
        )
      );
      continue;
    }
    ancestors.add(value);
    pending.push({ ...current, leaving: true });

    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor)) {
          diagnostics.push(
            diagnostic(
              'WIS_RESOURCE_ACCESSOR_PROPERTY',
              `${current.path}/${index}`,
              'Accessor properties are not valid portable JSON input.'
            )
          );
          continue;
        }
        pending.push({
          value: descriptor.value,
          path: `${current.path}/${index}`,
          depth: current.depth + 1,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      diagnostics.push(
        diagnostic(
          'WIS_RESOURCE_NON_PLAIN_OBJECT',
          current.path,
          'Objects must use the ordinary object or null prototype.'
        )
      );
      continue;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      diagnostics.push(
        diagnostic('WIS_RESOURCE_SYMBOL_KEY', current.path, 'Symbol keys are not portable JSON.')
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors).reverse()) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable) continue;
      if (!('value' in descriptor)) {
        diagnostics.push(
          diagnostic(
            'WIS_RESOURCE_ACCESSOR_PROPERTY',
            `${current.path}/${pointerSegment(key)}`,
            'Accessor properties are not valid portable JSON input.'
          )
        );
        continue;
      }
      pending.push({
        value: descriptor.value,
        path: `${current.path}/${pointerSegment(key)}`,
        depth: current.depth + 1,
      });
    }
  }

  return diagnostics;
}
