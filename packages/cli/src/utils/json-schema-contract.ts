import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';

const validatorCache = new Map<string, ValidateFunction>();
const WORKSPAI_CONTRACT_BASE_URLS = [
  'https://workspai.dev/schemas/',
  'https://workspai.dev/contracts/',
] as const;

function localContractReference(
  reference: string,
  relativeContractPath: string
): string | undefined {
  const workspaiBaseUrl = WORKSPAI_CONTRACT_BASE_URLS.find((baseUrl) =>
    reference.startsWith(baseUrl)
  );
  if (workspaiBaseUrl) {
    const contractPath = decodeURIComponent(reference.slice(workspaiBaseUrl.length));
    const pathSegments = contractPath.split('/');
    if (
      !contractPath ||
      path.isAbsolute(contractPath) ||
      contractPath.includes('\\') ||
      contractPath.includes('\0') ||
      contractPath.includes('?') ||
      pathSegments.some((segment) => segment === '..' || segment === '.')
    ) {
      throw new Error(`Unsafe Workspai JSON Schema reference: ${reference}`);
    }
    return `contracts/${contractPath}`;
  }
  if (/^https?:\/\//i.test(reference)) return undefined;
  return path.join(path.dirname(relativeContractPath), reference).split(path.sep).join('/');
}

function externalSchemaRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) externalSchemaRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof item === 'string' && !item.startsWith('#')) {
      refs.add(item.split('#', 1)[0] ?? item);
    } else {
      externalSchemaRefs(item, refs);
    }
  }
  return refs;
}

function registerReferencedSchemas(
  ajv: InstanceType<typeof Ajv> | InstanceType<typeof Ajv2020>,
  schema: AnySchema,
  relativeContractPath: string,
  visited = new Set<string>()
): void {
  for (const reference of externalSchemaRefs(schema)) {
    if (!reference) continue;
    const referencedRelativePath = localContractReference(reference, relativeContractPath);
    if (!referencedRelativePath) continue;
    const referencedPath = resolveContractPath(referencedRelativePath);
    if (visited.has(referencedPath)) continue;
    visited.add(referencedPath);
    const referencedSchema = JSON.parse(fs.readFileSync(referencedPath, 'utf8')) as AnySchema;
    registerReferencedSchemas(ajv, referencedSchema, referencedRelativePath, visited);
    ajv.addSchema(referencedSchema);
  }
}

function resolveContractPath(relativeContractPath: string): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, '..', relativeContractPath),
    path.resolve(moduleDirectory, '../..', relativeContractPath),
    path.resolve(process.cwd(), relativeContractPath),
  ];
  const contractPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!contractPath) {
    throw new Error(`JSON Schema contract is unavailable: ${relativeContractPath}`);
  }
  return contractPath;
}

function validatorFor(relativeContractPath: string): ValidateFunction {
  const contractPath = resolveContractPath(relativeContractPath);
  const cached = validatorCache.get(contractPath);
  if (cached) return cached;

  const schema = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as AnySchema & {
    $schema?: string;
    $ref?: string;
  };
  if (typeof schema.$ref === 'string' && !schema.$ref.startsWith('#')) {
    const referencedRelativePath = localContractReference(
      schema.$ref.split('#', 1)[0] ?? schema.$ref,
      relativeContractPath
    );
    if (referencedRelativePath) {
      const validator = validatorFor(referencedRelativePath);
      validatorCache.set(contractPath, validator);
      return validator;
    }
  }
  const AjvConstructor = schema.$schema?.includes('2020-12') ? Ajv2020 : Ajv;
  const ajv = new AjvConstructor({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  registerReferencedSchemas(ajv, schema, relativeContractPath);
  const validator = ajv.compile(schema);
  validatorCache.set(contractPath, validator);
  return validator;
}

function summarizeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 8)
    .map((error) => {
      const location = error.instancePath || '/';
      const detail =
        error.keyword === 'additionalProperties'
          ? ` (${String(error.params.additionalProperty)})`
          : '';
      return `${location} ${error.message ?? error.keyword}${detail}`;
    })
    .join('; ');
}

export function assertJsonSchemaContract(
  payload: unknown,
  relativeContractPath: string,
  artifactLabel: string
): void {
  const validator = validatorFor(relativeContractPath);
  if (!validator(payload)) {
    throw new Error(
      `${artifactLabel} violates ${relativeContractPath}: ${summarizeErrors(validator.errors)}`
    );
  }
}
