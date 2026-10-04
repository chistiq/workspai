import { AsyncLocalStorage } from 'node:async_hooks';

import { prompt, type PromptQuestion } from './prompts.js';

const BACK = '__workspai_create_back__';
class CreateSetupBack extends Error {}

type Navigation = {
  history: Array<{ key: string; answers: Record<string, unknown> }>;
  cursor: number;
  active: boolean;
};
const navigation = new AsyncLocalStorage<Navigation>();

/** Only replay read-only setup. Creation and external generators are never replayed. */
export async function withCreateSetupNavigation<T>(run: () => Promise<T>): Promise<T> {
  if (navigation.getStore()) return run();
  const state: Navigation = { history: [], cursor: 0, active: true };
  return navigation.run(state, async () => {
    for (;;) {
      state.cursor = 0;
      try {
        return await run();
      } catch (error) {
        if (!(error instanceof CreateSetupBack) || !state.active) throw error;
      }
    }
  });
}

export function isCreateSetupBack(error: unknown): boolean {
  return error instanceof CreateSetupBack;
}

export function finishCreateSetup(): void {
  const state = navigation.getStore();
  if (state) {
    state.active = false;
    state.history = [];
  }
}

export async function promptCreateSetup<T extends Record<string, unknown>>(
  questions: PromptQuestion[] | readonly PromptQuestion[],
  ask: typeof prompt = prompt
): Promise<T> {
  const state = navigation.getStore();
  if (!state?.active) return ask<T>(questions);
  if (questions.length > 1) {
    const combined: Record<string, unknown> = {};
    for (const question of questions) {
      if (
        question.when === false ||
        (typeof question.when === 'function' && !question.when(combined))
      )
        continue;
      Object.assign(combined, await promptCreateSetup([{ ...question, when: undefined }], ask));
    }
    return combined as T;
  }
  const key = JSON.stringify(
    questions.map(({ name, type, choices }) => [name, type, choices?.map(({ value }) => value)])
  );
  const previous = state.history[state.cursor];
  if (previous?.key === key) {
    state.cursor += 1;
    return previous.answers as T;
  }
  state.history.length = state.cursor;
  const canBack = state.cursor > 0;
  const prepared = questions.map((question): PromptQuestion => {
    if (!canBack) return question;
    if (question.type === 'list' || question.type === 'rawlist') {
      return {
        ...question,
        choices: [
          ...(question.choices ?? []),
          {
            label: '← Back',
            value: BACK,
            hint: 'Return to the previous step',
          },
        ],
      };
    }
    if (question.type === 'confirm') {
      return {
        ...question,
        type: 'rawlist',
        default: question.default === true ? '__create_yes__' : '__create_no__',
        choices: [
          { label: 'Yes', value: '__create_yes__' },
          { label: 'No', value: '__create_no__' },
          { label: '← Back', value: BACK, hint: 'Return to the previous step' },
        ],
      };
    }
    if (question.type === 'input') {
      return {
        ...question,
        message: `${question.message ?? question.name} (type /back to return)`,
        initialValue: '',
        validate: (value) => value.trim() === '/back' || (question.validate?.(value) ?? true),
      };
    }
    return question;
  });
  const answers = await ask<T>(prepared);
  if (
    canBack &&
    prepared.some((question) => {
      const value = answers[question.name];
      return (
        value === BACK ||
        (question.type === 'input' && typeof value === 'string' && value.trim() === '/back')
      );
    })
  ) {
    state.history.length = state.cursor - 1;
    throw new CreateSetupBack();
  }
  for (const question of questions) {
    if (question.type === 'confirm') {
      const value = answers[question.name];
      if (value === '__create_yes__' || value === '__create_no__') {
        (answers as Record<string, unknown>)[question.name] = value === '__create_yes__';
      }
    }
  }
  state.history.push({ key, answers });
  state.cursor += 1;
  return answers;
}
