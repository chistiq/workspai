import { describe, expect, it } from 'vitest';

import {
  assertUniqueKitPickerLabels,
  buildKitPickerChoices,
} from '../cli-ui/kit-picker-choices.js';

describe('kit picker choices', () => {
  it('uses unique categorized labels with hints for every project kit', () => {
    const choices = buildKitPickerChoices();

    expect(choices.length).toBeGreaterThan(10);
    expect(() => assertUniqueKitPickerLabels(choices)).not.toThrow();
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);
    expect(Math.max(...choices.map((choice) => String(choice.hint ?? '').length))).toBeLessThan(48);

    const frontendChoices = choices.filter((choice) =>
      String(choice.value).startsWith('frontend.')
    );
    expect(frontendChoices.length).toBeGreaterThan(5);
    for (const choice of frontendChoices) {
      expect(choice.label).toBeTruthy();
      expect(choice.label).not.toBe('frontend');
      expect(choice.hint).toBeTruthy();
    }

    const fastapiChoices = choices.filter((choice) => String(choice.value).startsWith('fastapi.'));
    expect(fastapiChoices).toHaveLength(2);
    expect(fastapiChoices.map((choice) => choice.label)).toEqual([
      'Backend · FastAPI DDD Kit',
      'Backend · FastAPI Standard Kit',
    ]);
    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'rust.axum', label: expect.stringMatching(/^Backend ·/) }),
        expect.objectContaining({
          value: 'php.laravel',
          label: expect.stringMatching(/^Backend ·/),
        }),
        expect.objectContaining({
          value: 'desktop.tauri',
          label: expect.stringMatching(/^Desktop ·/),
        }),
        expect.objectContaining({
          value: 'desktop.electron',
          label: expect.stringMatching(/^Desktop ·/),
        }),
        expect.objectContaining({
          value: 'extension.vscode',
          label: expect.stringMatching(/^Extension ·/),
        }),
      ])
    );
  });
});
