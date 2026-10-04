import { describe, expect, it, vi } from 'vitest';
import { text } from '@clack/prompts';

vi.mock('@clack/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@clack/prompts')>()),
  text: vi.fn().mockResolvedValue('/back'),
}));

import { adaptInquirerValidate, prompt } from '../cli-ui/prompts.js';

describe('adaptInquirerValidate', () => {
  it('maps inquirer true to clack undefined', () => {
    const adapted = adaptInquirerValidate(
      (value: string) => value.trim().length > 0 || 'Project name is required'
    );
    expect(adapted?.('ridge-api')).toBeUndefined();
    expect(adapted?.('')).toBe('Project name is required');
  });

  it('maps explicit true returns to undefined', () => {
    const adapted = adaptInquirerValidate(() => true);
    expect(adapted?.('anything')).toBeUndefined();
  });
});

describe('setup text input', () => {
  it('keeps the default available without prefilled text blocking /back', async () => {
    await prompt([{ type: 'input', name: 'name', default: 'my-workspace', initialValue: '' }]);
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: '',
        defaultValue: 'my-workspace',
        placeholder: 'my-workspace',
      })
    );
  });
});
