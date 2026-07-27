import { listFrontendGenerators } from '../frontend-project.js';
import { listOfficialProjectGenerators } from '../official-project.js';
import { listInteractiveKits, type KitDefinition } from '../utils/kit-registry.js';
import type { PromptChoice } from './prompts.js';

function kitPickerLabel(kit: KitDefinition): string {
  const separator = ' — ';
  const index = kit.label.indexOf(separator);
  if (index >= 0) {
    return kit.label.slice(index + separator.length).trim();
  }
  return kit.label.trim();
}

export function buildKitPickerChoices(): PromptChoice<string>[] {
  const backendChoices = listInteractiveKits().map((kit) => ({
    value: kit.id,
    label: `${categoryLabel(kit.category)} · ${kitPickerLabel(kit)}`,
    hint: `${kit.runtime} · tested baseline`,
    name: kit.label,
  }));

  const frontendChoices = listFrontendGenerators().map((generator) => ({
    value: generator.kitId,
    label: `Frontend · ${generator.displayName}`,
    hint: 'official · latest stable',
    name: `${generator.displayName} — ${generator.framework}`,
  }));

  const officialChoices = listOfficialProjectGenerators().map((generator) => ({
    value: generator.kitId,
    label: `${categoryLabel(generator.category)} · ${generator.displayName}`,
    hint: `${generator.runtimeCandidates.join(' + ')} · official latest stable`,
    name: `${generator.displayName} — ${generator.category}`,
  }));

  const choices = [...backendChoices, ...frontendChoices, ...officialChoices].sort(
    (left, right) => {
      const categoryOrder = ['Backend', 'Frontend', 'Desktop', 'Extension'];
      const leftCategory = left.label?.split(' · ')[0] ?? '';
      const rightCategory = right.label?.split(' · ')[0] ?? '';
      const categoryDelta =
        categoryOrder.indexOf(leftCategory) - categoryOrder.indexOf(rightCategory);
      return categoryDelta || (left.label ?? '').localeCompare(right.label ?? '');
    }
  );
  assertUniqueKitPickerLabels(choices);
  return choices;
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
