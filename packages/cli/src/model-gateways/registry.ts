import type { ModelGatewayAdapter } from './adapter.js';
import { cloneAdapterView } from './adapter.js';
import type { ModelGatewayProjectKit } from './gateway.js';

export type ModelGatewayRegistry = {
  listAdapters(): ReadonlyArray<ReturnType<typeof cloneAdapterView>>;
  listKits(): ModelGatewayProjectKit[];
  lookupKit(value: string | undefined): ModelGatewayProjectKit | null;
  resolveAdapter(kit: ModelGatewayProjectKit): ModelGatewayAdapter;
  generate(input: {
    projectPath: string;
    projectName: string;
    kit: ModelGatewayProjectKit;
  }): Promise<void>;
};

function kitFromAdapter(adapter: ModelGatewayAdapter): ModelGatewayProjectKit {
  return {
    id: adapter.kitId,
    aliases: [...adapter.aliases],
    label: adapter.label,
    runtime: adapter.runtime,
    adapterId: adapter.id,
    gatewayId: adapter.gatewayId,
    gatewayName: adapter.gatewayName,
    requiredEnvironment: [...adapter.requiredEnvironment],
  };
}

export function createModelGatewayRegistry(
  adapters: readonly ModelGatewayAdapter[]
): ModelGatewayRegistry {
  if (adapters.length === 0) {
    throw new Error('Model gateway registry requires at least one adapter.');
  }
  const adapterIds = new Set<string>();
  const kitIds = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const adapter of adapters) {
    if (!adapter.id || !adapter.kitId || !adapter.generate) {
      throw new Error('Model gateway adapter is missing id, kitId, or generate.');
    }
    if (adapterIds.has(adapter.id)) {
      throw new Error(`Duplicate model gateway adapter: ${adapter.id}`);
    }
    if (kitIds.has(adapter.kitId)) {
      throw new Error(`Duplicate model gateway kit: ${adapter.kitId}`);
    }
    adapterIds.add(adapter.id);
    kitIds.add(adapter.kitId);
    const names = [adapter.kitId, ...adapter.aliases];
    for (const name of names) {
      const normalized = name.trim().toLowerCase();
      if (!normalized) {
        throw new Error(`Empty model gateway alias on ${adapter.id}.`);
      }
      const owner = aliasOwner.get(normalized);
      if (owner && owner !== adapter.id) {
        throw new Error(`Duplicate model gateway alias: ${name}`);
      }
      aliasOwner.set(normalized, adapter.id);
    }
  }
  const frozen = Object.freeze([...adapters]);

  const lookupKit = (value: string | undefined): ModelGatewayProjectKit | null => {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    const adapter = frozen.find(
      (candidate) =>
        candidate.kitId.toLowerCase() === normalized ||
        candidate.aliases.some((alias) => alias.toLowerCase() === normalized)
    );
    return adapter ? structuredClone(kitFromAdapter(adapter)) : null;
  };

  return {
    listAdapters() {
      return frozen.map((adapter) => cloneAdapterView(adapter));
    },
    listKits() {
      return frozen.map((adapter) => structuredClone(kitFromAdapter(adapter)));
    },
    lookupKit,
    resolveAdapter(kit: ModelGatewayProjectKit): ModelGatewayAdapter {
      const adapter = frozen.find((candidate) => candidate.kitId === kit.id);
      if (!adapter) {
        throw new Error(`Unsupported model gateway kit: ${kit.id}`);
      }
      return adapter;
    },
    async generate(input) {
      const adapter = frozen.find((candidate) => candidate.kitId === input.kit.id);
      if (!adapter) {
        throw new Error(`Unsupported model gateway kit: ${input.kit.id}`);
      }
      await adapter.generate({
        projectPath: input.projectPath,
        projectName: input.projectName,
      });
    },
  };
}
