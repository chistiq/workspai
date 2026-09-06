import { listFrontendGenerators } from '../frontend-project.js';
import { listOfficialProjectGenerators } from '../official-project.js';
import { listInteractiveKits, type KitDefinition } from '../utils/kit-registry.js';
import type { PromptChoice } from './prompts.js';
import { listAgentFrameworkProjectKits } from '../agent-frameworks/project-kits.js';

export const CREATE_KIT_CATEGORY_IDS = [
  'backend',
  'frontend',
  'desktop',
  'agent',
  'extension',
  'gaming',
] as const;

export type CreateKitCategoryId = (typeof CREATE_KIT_CATEGORY_IDS)[number];

export type CategorizedKitChoice = PromptChoice<string> & {
  category: CreateKitCategoryId;
};

const CREATE_KIT_CATEGORIES: ReadonlyArray<{
  id: CreateKitCategoryId;
  label: string;
  hint: string;
}> = [
  { id: 'backend', label: 'Backend', hint: 'APIs and services' },
  { id: 'frontend', label: 'Frontend', hint: 'Web applications' },
  { id: 'desktop', label: 'Desktop', hint: 'Native desktop applications' },
  { id: 'agent', label: 'AI Agent', hint: 'Governed agent runtimes' },
  { id: 'extension', label: 'Extension', hint: 'Editor and platform extensions' },
  { id: 'gaming', label: 'Gaming', hint: 'Game runtimes and tooling' },
];

function kitPickerLabel(kit: KitDefinition): string {
  const separator = ' — ';
  const index = kit.label.indexOf(separator);
  if (index >= 0) {
    return kit.label.slice(index + separator.length).trim();
  }
  return kit.label.trim();
}

function createCategoryForKit(kit: KitDefinition): CreateKitCategoryId | null {
  return CREATE_KIT_CATEGORY_IDS.includes(kit.category as CreateKitCategoryId)
    ? (kit.category as CreateKitCategoryId)
    : null;
}

export function buildKitPickerChoices(category?: CreateKitCategoryId): CategorizedKitChoice[] {
  const registeredChoices = listInteractiveKits().flatMap((kit) => {
    const kitCategory = createCategoryForKit(kit);
    return kitCategory
      ? [
          {
            value: kit.id,
            label: `${categoryLabel(kitCategory)} · ${kitPickerLabel(kit)}`,
            hint: `${kit.runtime} · tested baseline`,
            name: kit.label,
            category: kitCategory,
          },
        ]
      : [];
  });

  const frontendChoices = listFrontendGenerators().map((generator) => ({
    value: generator.kitId,
    label: `Frontend · ${generator.displayName}`,
    hint: 'official · latest stable',
    name: `${generator.displayName} — ${generator.framework}`,
    category: 'frontend' as const,
  }));

  const officialChoices = listOfficialProjectGenerators().map((generator) => ({
    value: generator.kitId,
    label: `${categoryLabel(generator.category)} · ${generator.displayName}`,
    hint: `${generator.runtimeCandidates.join(' + ')} · official latest stable`,
    name: `${generator.displayName} — ${generator.category}`,
    category: generator.category as Extract<
      CreateKitCategoryId,
      'backend' | 'desktop' | 'extension'
    >,
  }));

  const agentChoices = listAgentFrameworkProjectKits().map((kit) => ({
    value: kit.id,
    label: `AI Agent · ${kit.label}`,
    hint: `${kit.runtime} · release-admitted baseline`,
    name: kit.label,
    category: 'agent' as const,
  }));

  const choices = [...registeredChoices, ...frontendChoices, ...officialChoices, ...agentChoices]
    .filter((choice) => !category || choice.category === category)
    .sort((left, right) => {
      const leftCategory = CREATE_KIT_CATEGORY_IDS.indexOf(left.category);
      const rightCategory = CREATE_KIT_CATEGORY_IDS.indexOf(right.category);
      const categoryDelta = leftCategory - rightCategory;
      return categoryDelta || (left.label ?? '').localeCompare(right.label ?? '');
    });
  assertUniqueKitPickerLabels(choices);
  return choices;
}

export function buildKitCategoryChoices(): PromptChoice<CreateKitCategoryId>[] {
  const available = new Set(buildKitPickerChoices().map((choice) => choice.category));
  return CREATE_KIT_CATEGORIES.filter((category) => available.has(category.id)).map((category) => ({
    value: category.id,
    label: category.label,
    hint: category.hint,
  }));
}

function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function assertUniqueKitPickerLabels(choices: PromptChoice<string>[]): void {
  const seenLabels = new Set<string>();
  const seenValues = new Set<string>();
  for (const choice of choices) {
    const label = choice.label ?? choice.name ?? String(choice.value);
    const value = String(choice.value);
    if (seenLabels.has(label)) {
      throw new Error(`Duplicate kit picker label: ${label}`);
    }
    if (seenValues.has(value)) {
      throw new Error(`Duplicate kit picker value: ${value}`);
    }
    seenLabels.add(label);
    seenValues.add(value);
  }
}
