import { describe, expect, it } from 'vitest';

import {
  assertUniqueKitPickerLabels,
  buildKitCategoryChoices,
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
        expect.objectContaining({
          value: 'agent.microsoft.python',
          label: 'AI Agent · Microsoft Agent Framework · Python',
        }),
        expect.objectContaining({
          value: 'agent.microsoft.dotnet',
          label: 'AI Agent · Microsoft Agent Framework · .NET',
        }),
      ])
    );
  });

  it('presents only categories that currently have a selectable admitted kit', () => {
    expect(buildKitCategoryChoices()).toEqual([
      expect.objectContaining({ value: 'backend', label: 'Backend' }),
      expect.objectContaining({ value: 'frontend', label: 'Frontend' }),
      expect.objectContaining({ value: 'desktop', label: 'Desktop' }),
      expect.objectContaining({ value: 'agent', label: 'AI Agent' }),
      expect.objectContaining({ value: 'extension', label: 'Extension' }),
    ]);
  });

  it('filters the kit list by the selected category without changing kit identity', () => {
    const backend = buildKitPickerChoices('backend');
    const frontend = buildKitPickerChoices('frontend');

    expect(backend.length).toBeGreaterThan(5);
    expect(backend.every((choice) => choice.category === 'backend')).toBe(true);
    expect(frontend.length).toBeGreaterThan(5);
    expect(frontend.every((choice) => choice.category === 'frontend')).toBe(true);
    expect(buildKitPickerChoices('agent')).toHaveLength(2);
    expect(buildKitPickerChoices('agent').every((choice) => choice.category === 'agent')).toBe(
      true
    );
    expect(buildKitPickerChoices('gaming')).toEqual([]);
  });
});
