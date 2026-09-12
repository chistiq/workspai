import fs from 'node:fs';
import path from 'node:path';

const UNIQUE_CONTRACT_FIELDS = Object.freeze([
  ['key', /^[a-z][a-z0-9-]{0,127}$/u],
  ['contractId', /^https:\/\//u],
  ['typeExport', /^[A-Za-z][A-Za-z0-9]{0,127}$/u],
  ['validatorExport', /^[A-Za-z][A-Za-z0-9]{0,127}$/u],
  ['outputStem', /^[a-z][a-z0-9-]{0,127}$/u],
]);

export function resolveSafePackagePath(packageRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('path is required');
  }
  if (relativePath.includes('\0') || relativePath.includes('\\')) {
    throw new Error('path must be a portable forward-slash path');
  }
  const normalized = path.normalize(relativePath);
  if (
    path.isAbsolute(relativePath) ||
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`path must remain inside the package: ${relativePath}`);
  }

  const canonicalPackageRoot = fs.realpathSync(packageRoot);
  const targetPath = path.join(packageRoot, normalized);
  let existingAncestor = targetPath;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error('path has no safe package ancestor');
    existingAncestor = parent;
  }
  const canonicalAncestor = fs.realpathSync(existingAncestor);
  const relativeToPackage = path.relative(canonicalPackageRoot, canonicalAncestor);
  if (
    relativeToPackage === '..' ||
    relativeToPackage.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToPackage)
  ) {
    throw new Error(`path resolves outside the package: ${relativePath}`);
  }
  return targetPath;
}

export function assertUniqueContractFields(contracts) {
  for (const [field, pattern] of UNIQUE_CONTRACT_FIELDS) {
    const seen = new Set();
    for (const contract of contracts) {
      const value = contract[field];
      if (typeof value !== 'string' || !pattern.test(value)) {
        throw new Error(`invalid contract ${field}`);
      }
      if (seen.has(value)) throw new Error(`duplicate contract ${field}: ${value}`);
      seen.add(value);
    }
  }
}

export function assertAcyclicContractGraph(entriesById) {
  const visiting = new Set();
  const visited = new Set();

  function visit(id, chain) {
    if (visiting.has(id)) {
      throw new Error(`contract dependency cycle: ${[...chain, id].join(' -> ')}`);
    }
    if (visited.has(id)) return;
    const entry = entriesById.get(id);
    if (!entry) throw new Error(`contract graph references undeclared contract ${id}`);
    visiting.add(id);
    for (const dependency of entry.dependencies) visit(dependency, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of entriesById.keys()) visit(id, []);
}

export function collectExternalReferences(value, references = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectExternalReferences(entry, references);
    return references;
  }
  if (!value || typeof value !== 'object') return references;
  for (const keyword of ['$ref', '$dynamicRef']) {
    const reference = value[keyword];
    if (typeof reference === 'string' && !reference.startsWith('#')) {
      references.add(reference.split('#', 1)[0]);
    }
  }
  for (const entry of Object.values(value)) collectExternalReferences(entry, references);
  return references;
}

export function rewriteExternalReferences(schema, contract, entriesById) {
  const rewritten = structuredClone(schema);

  function visit(value) {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const keyword of ['$ref', '$dynamicRef']) {
      const reference = value[keyword];
      if (typeof reference !== 'string' || reference.startsWith('#')) continue;
      const dependencyId = [...entriesById.keys()]
        .sort((left, right) => right.length - left.length)
        .find((candidate) => reference === candidate || reference.startsWith(`${candidate}#`));
      if (!dependencyId) throw new Error(`${contract.key} has unresolved reference ${reference}`);
      const dependency = entriesById.get(dependencyId)?.contract;
      if (!dependency)
        throw new Error(`${contract.key} references undeclared contract ${dependencyId}`);
      let relativePath = path
        .relative(path.dirname(contract.path), dependency.path)
        .split(path.sep)
        .join('/');
      if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
      value[keyword] = `${relativePath}${reference.slice(dependencyId.length)}`;
    }
    for (const entry of Object.values(value)) visit(entry);
  }

  visit(rewritten);
  return rewritten;
}
