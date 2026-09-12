export interface GenerationContract {
  readonly key: string;
  readonly path: string;
  readonly contractId: string;
  readonly version: string;
  readonly typeExport: string;
  readonly validatorExport: string;
  readonly outputStem: string;
  readonly [key: string]: unknown;
}

export interface GenerationGraphEntry {
  readonly contract?: Pick<GenerationContract, 'path'>;
  readonly dependencies: readonly string[];
}

export function resolveSafePackagePath(packageRoot: string, relativePath: string): string;

export function assertUniqueContractFields(contracts: readonly Record<string, unknown>[]): void;

export function assertAcyclicContractGraph(
  entriesById: ReadonlyMap<string, GenerationGraphEntry>
): void;

export function collectExternalReferences(value: unknown, references?: Set<string>): Set<string>;

export function rewriteExternalReferences<Schema>(
  schema: Schema,
  contract: Pick<GenerationContract, 'key' | 'path'>,
  entriesById: ReadonlyMap<string, GenerationGraphEntry>
): Schema;
