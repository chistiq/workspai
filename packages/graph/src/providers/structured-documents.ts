import { parseAllDocuments } from 'yaml';

export function parseStructuredDocuments(source: string, locator: string): readonly unknown[] {
  if (locator.toLowerCase().endsWith('.json')) {
    return [JSON.parse(source) as unknown];
  }
  const documents = parseAllDocuments(source, {
    schema: 'core',
    merge: false,
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (documents.some((document) => document.errors.length > 0)) {
    throw new Error('Structured YAML is not valid under the safe core schema.');
  }
  return documents
    .map((document) => document.toJS({ maxAliasCount: 100 }))
    .filter((value) => value !== null && value !== undefined);
}
