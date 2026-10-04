import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  finishCreateSetup,
  promptCreateSetup,
  withCreateSetupNavigation,
} from '../cli-ui/create-navigation.js';
import { prompt, type PromptQuestion } from '../cli-ui/prompts.js';
vi.mock('../cli-ui/prompts.js', () => ({ prompt: vi.fn() }));
const mockedPrompt = vi.mocked(prompt);
const target: PromptQuestion = {
  type: 'rawlist',
  name: 'target',
  choices: [{ value: 'project' }, { value: 'workspace' }],
};
const category: PromptQuestion = {
  type: 'rawlist',
  name: 'category',
  choices: [{ value: 'backend' }, { value: 'frontend' }],
};
const name: PromptQuestion = {
  type: 'input',
  name: 'name',
  message: 'Project name:',
  validate: (value) => value.length > 0 || 'Required',
};
beforeEach(() => vi.resetAllMocks());
describe('create setup navigation', () => {
  it('returns from kit to category, keeps the target, and executes only once', async () => {
    mockedPrompt
      .mockResolvedValueOnce({ target: 'project' })
      .mockResolvedValueOnce({ category: 'backend' })
      .mockResolvedValueOnce({ kit: '__workspai_create_back__' })
      .mockResolvedValueOnce({ category: 'frontend' })
      .mockResolvedValueOnce({ kit: 'nextjs' });
    const effect = vi.fn();
    const result = await withCreateSetupNavigation(async () => {
      await promptCreateSetup([target]);
      const selected = await promptCreateSetup([category]);
      const kit = await promptCreateSetup([
        {
          type: 'rawlist',
          name: 'kit',
          choices: [{ value: selected.category === 'frontend' ? 'nextjs' : 'axum' }],
        },
      ]);
      finishCreateSetup();
      effect();
      return kit;
    });
    expect(result.kit).toBe('nextjs');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(
      mockedPrompt.mock.calls.filter(([questions]) => questions[0]?.name === 'target')
    ).toHaveLength(1);
    expect(mockedPrompt.mock.calls[2][0][0].choices).toContainEqual(
      expect.objectContaining({ label: '← Back' })
    );
    expect(mockedPrompt.mock.calls[4][0][0].choices).not.toContainEqual(
      expect.objectContaining({ value: 'axum' })
    );
  });
  it('accepts /back before validation and switches workspace to project', async () => {
    mockedPrompt
      .mockResolvedValueOnce({ target: 'workspace' })
      .mockImplementationOnce(async (questions) => {
        expect(questions[0].validate?.('/back')).toBe(true);
        expect(questions[0].message).toContain('/back');
        return { name: ' /back ' } as never;
      })
      .mockResolvedValueOnce({ target: 'project' })
      .mockResolvedValueOnce({ name: 'app' });
    const result = await withCreateSetupNavigation(async () => {
      const selected = await promptCreateSetup([target]);
      const answer = await promptCreateSetup([name]);
      return { ...selected, ...answer };
    });
    expect(result).toEqual({ target: 'project', name: 'app' });
    expect(mockedPrompt.mock.calls[0][0][0].choices).toHaveLength(2);
  });
  it('does not add navigation outside setup or after execution starts', async () => {
    mockedPrompt.mockResolvedValue({ name: 'app' });
    await promptCreateSetup([name]);
    await withCreateSetupNavigation(async () => {
      await promptCreateSetup([target]);
      finishCreateSetup();
      await promptCreateSetup([name]);
    });
    expect(mockedPrompt.mock.calls[0][0]).toEqual([name]);
    expect(mockedPrompt.mock.calls[2][0]).toEqual([name]);
  });
  it('propagates execution failure without replay', async () => {
    mockedPrompt.mockResolvedValue({ target: 'project' });
    const effect = vi.fn(() => {
      throw new Error('generator failed');
    });
    await expect(
      withCreateSetupNavigation(async () => {
        await promptCreateSetup([target]);
        finishCreateSetup();
        effect();
      })
    ).rejects.toThrow('generator failed');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(mockedPrompt).toHaveBeenCalledTimes(1);
  });
  it('isolates concurrent histories', async () => {
    mockedPrompt.mockImplementation(async (questions) => ({ name: questions[0].default }) as never);
    const run = (value: string) =>
      withCreateSetupNavigation(async () => {
        await promptCreateSetup([{ ...name, default: value }]);
        return promptCreateSetup([{ ...name, default: `${value}-next` }]);
      });
    expect(await Promise.all([run('one'), run('two')])).toEqual([
      { name: 'one-next' },
      { name: 'two-next' },
    ]);
  });
  it('backs one field at a time inside grouped setup questions', async () => {
    mockedPrompt
      .mockResolvedValueOnce({ target: 'workspace' })
      .mockResolvedValueOnce({ version: '3.12' })
      .mockResolvedValueOnce({ method: '__workspai_create_back__' })
      .mockResolvedValueOnce({ version: '3.13' })
      .mockResolvedValueOnce({ method: 'venv' });
    const result = await withCreateSetupNavigation(async () => {
      await promptCreateSetup([target]);
      return promptCreateSetup([
        { type: 'rawlist', name: 'version', choices: [{ value: '3.12' }, { value: '3.13' }] },
        { type: 'rawlist', name: 'method', choices: [{ value: 'venv' }] },
      ]);
    });
    expect(result).toEqual({ version: '3.13', method: 'venv' });
  });

  it('lets a confirmation return to setup and preserves boolean answers', async () => {
    mockedPrompt
      .mockResolvedValueOnce({ target: 'workspace' })
      .mockResolvedValueOnce({ install: '__workspai_create_back__' })
      .mockResolvedValueOnce({ target: 'workspace' })
      .mockResolvedValueOnce({ install: '__create_yes__' });
    const result = await withCreateSetupNavigation(async () => {
      await promptCreateSetup([target]);
      return promptCreateSetup([{ type: 'confirm', name: 'install', default: true }]);
    });
    expect(result.install).toBe(true);
    expect(mockedPrompt.mock.calls[1][0][0].choices).toContainEqual(
      expect.objectContaining({ label: '← Back' })
    );
  });
});
