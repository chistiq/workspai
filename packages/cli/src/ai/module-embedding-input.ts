import { createHash } from 'node:crypto';
import type { ModuleMetadata } from './module-catalog.js';

export function moduleEmbeddingText(module: ModuleMetadata): string {
  return [
    module.name,
    module.description,
    module.longDescription,
    ...module.keywords,
    ...module.useCases,
  ]
    .filter(Boolean)
    .join(' ');
}

export function moduleEmbeddingInputHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
