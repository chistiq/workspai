import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type JsonSchema = {
  $id?: string;
  $schema?: string;
  [key: string]: unknown;
};

const CONTRACTS_ROOT = path.resolve(process.cwd(), 'contracts');
const WORKSPAI_SCHEMA_BASES = [
  'https://workspai.dev/schemas/',
  'https://workspai.dev/contracts/',
] as const;

function contractFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return contractFiles(absolutePath);
      return entry.isFile() && entry.name.endsWith('.json') ? [absolutePath] : [];
    })
    .sort();
}

function externalRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) externalRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof item === 'string' && !item.startsWith('#')) {
      refs.add(item.split('#', 1)[0] ?? item);
    } else {
      externalRefs(item, refs);
    }
  }
  return refs;
}

describe('contract reference integrity', () => {
  it('assigns unique canonical ids and resolves every local or Workspai schema reference', () => {
    const schemas = contractFiles(CONTRACTS_ROOT)
      .map((filePath) => ({
        filePath,
        schema: JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonSchema,
      }))
      .filter(({ schema }) => typeof schema.$schema === 'string');
    const pathById = new Map<string, string>();
    const violations: string[] = [];

    for (const { filePath, schema } of schemas) {
      if (!schema.$id) {
        violations.push(`${path.relative(CONTRACTS_ROOT, filePath)} has no $id`);
        continue;
      }
      const existing = pathById.get(schema.$id);
      if (existing && existing !== filePath) {
        violations.push(
          `duplicate $id ${schema.$id}: ${path.relative(CONTRACTS_ROOT, existing)} and ${path.relative(CONTRACTS_ROOT, filePath)}`
        );
      }
      pathById.set(schema.$id, filePath);
    }

    for (const { filePath, schema } of schemas) {
      for (const reference of externalRefs(schema)) {
        const workspaiReference = WORKSPAI_SCHEMA_BASES.some((base) => reference.startsWith(base));
        if (/^https?:\/\//i.test(reference)) {
          if (workspaiReference && !pathById.has(reference)) {
            violations.push(
              `${path.relative(CONTRACTS_ROOT, filePath)} references missing canonical schema ${reference}`
            );
          }
          continue;
        }
        const referencedPath = path.resolve(path.dirname(filePath), reference);
        if (!fs.existsSync(referencedPath)) {
          violations.push(
            `${path.relative(CONTRACTS_ROOT, filePath)} references missing file ${reference}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
