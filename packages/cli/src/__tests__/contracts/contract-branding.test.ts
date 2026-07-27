import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CONTRACTS_ROOT = path.resolve(process.cwd(), 'contracts');

function jsonContracts(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return jsonContracts(absolutePath);
      return entry.isFile() && entry.name.endsWith('.json') ? [absolutePath] : [];
    })
    .sort();
}

describe('canonical contract branding', () => {
  it('publishes every JSON Schema with an explicit Workspai title', () => {
    const violations = jsonContracts(CONTRACTS_ROOT).flatMap((contractPath) => {
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as {
        $schema?: unknown;
        title?: unknown;
      };
      if (typeof contract.$schema !== 'string') return [];
      return typeof contract.title !== 'string' || !/^Workspai\b/.test(contract.title.trim())
        ? [
            `${path.relative(CONTRACTS_ROOT, contractPath)}: ${
              typeof contract.title === 'string' ? contract.title : '<missing>'
            }`,
          ]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
