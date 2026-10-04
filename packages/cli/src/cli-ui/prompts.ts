import { confirm, isCancel, multiselect, password, select, text } from '@clack/prompts';

import { isCliJsonLogFormat } from '../observability/cli-log-format.js';
import { showCancel } from './brand.js';
import { rk } from './theme.js';

export type PromptChoice<T = string> = {
  name?: string;
  label?: string;
  hint?: string;
  value: T;
  disabled?: boolean | string;
};

export type PromptQuestion = {
  type: string;
  name: string;
  message?: string;
  default?: unknown;
  initialValue?: string;
  choices?: PromptChoice[] | readonly PromptChoice[];
  validate?: (value: string) => boolean | string;
  when?: boolean | ((answers: Record<string, unknown>) => boolean);
};

/** Clack expects `undefined` on success; inquirer used `true`. */
export function adaptInquirerValidate(
  validate?: (value: string) => boolean | string
): ((value: string) => string | Error | undefined) | undefined {
  if (!validate) {
    return undefined;
  }
  return (value: string) => {
    const result = validate(value);
    if (result === true) {
      return undefined;
    }
    if (result === false) {
      return 'Invalid value';
    }
    return result;
  };
}

function stripEmoji(text: string): string {
  return text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '').trim();
}

function parseChoiceLabel(raw: string): { label: string; hint?: string } {
  const cleaned = stripEmoji(raw);
  for (const separator of [' — ', ' – ', ' - ']) {
    const index = cleaned.indexOf(separator);
    if (index > 0) {
      return {
        label: cleaned.slice(0, index).trim(),
        hint: cleaned.slice(index + separator.length).trim(),
      };
    }
  }
  return { label: cleaned };
}

function resolveChoiceOption(choice: PromptChoice): { label: string; hint?: string } {
  if (choice.label) {
    return {
      label: choice.label,
      hint: choice.hint,
    };
  }
  const parsed = parseChoiceLabel(choice.name ?? String(choice.value));
  return {
    label: parsed.label,
    hint: choice.hint ?? parsed.hint,
  };
}

function resolveDefaultIndex(defaultValue: unknown, choices: PromptChoice[]): number | undefined {
  if (typeof defaultValue === 'number') {
    return defaultValue;
  }
  if (defaultValue === undefined) {
    return undefined;
  }
  const index = choices.findIndex((choice) => choice.value === defaultValue);
  return index >= 0 ? index : undefined;
}

function shouldAsk(question: PromptQuestion, answers: Record<string, unknown>): boolean {
  if (question.when === undefined) {
    return true;
  }
  if (typeof question.when === 'function') {
    return question.when(answers);
  }
  return question.when;
}

async function askOne(
  _question: PromptQuestion,
  _answers: Record<string, unknown>
): Promise<unknown> {
  const question = _question;
  const message = stripEmoji(question.message ?? question.name);

  if (question.type === 'confirm') {
    const value = await confirm({
      message,
      initialValue: typeof question.default === 'boolean' ? question.default : false,
      active: rk.success('yes'),
      inactive: rk.dim('no'),
    });
    if (isCancel(value)) {
      showCancel();
      process.exit(130);
    }
    return value;
  }

  if (question.type === 'password') {
    const value = await password({
      message,
      validate: adaptInquirerValidate(question.validate),
    });
    if (isCancel(value)) {
      showCancel();
      process.exit(130);
    }
    return value;
  }

  if (question.type === 'input') {
    const value = await text({
      message,
      defaultValue: typeof question.default === 'string' ? question.default : undefined,
      initialValue:
        question.initialValue ??
        (typeof question.default === 'string' ? question.default : undefined),
      validate: adaptInquirerValidate(question.validate),
      placeholder: typeof question.default === 'string' ? question.default : undefined,
    });
    if (isCancel(value)) {
      showCancel();
      process.exit(130);
    }
    return value;
  }

  if (question.type === 'checkbox') {
    const choices = [...(question.choices ?? [])];
    const value = await multiselect({
      message,
      options: choices.map((choice) => {
        const resolved = resolveChoiceOption(choice);
        return {
          value: choice.value,
          label: resolved.label,
          hint: resolved.hint,
        };
      }),
      required: false,
    });
    if (isCancel(value)) {
      showCancel();
      process.exit(130);
    }
    return value;
  }

  if (question.type === 'rawlist' || question.type === 'list') {
    const choices = [...(question.choices ?? [])].filter((choice) => !choice.disabled);
    const defaultIndex = resolveDefaultIndex(question.default, choices);
    const value = await select({
      message,
      options: choices.map((choice) => {
        const resolved = resolveChoiceOption(choice);
        return {
          value: choice.value,
          label: resolved.label,
          hint: resolved.hint,
        };
      }),
      initialValue: defaultIndex !== undefined ? choices[defaultIndex]?.value : undefined,
    });
    if (isCancel(value)) {
      showCancel();
      process.exit(130);
    }
    return value;
  }

  throw new Error(`Unsupported prompt type: ${question.type}`);
}

export async function prompt<T extends Record<string, unknown>>(
  questions: PromptQuestion[] | readonly PromptQuestion[]
): Promise<T> {
  if (isCliJsonLogFormat()) {
    const result: Record<string, unknown> = {};
    for (const question of questions) {
      if (!shouldAsk(question, result)) {
        continue;
      }
      if (question.default !== undefined) {
        result[question.name] = question.default;
      } else if (question.type === 'confirm') {
        result[question.name] = false;
      } else if (question.type === 'checkbox') {
        result[question.name] = [];
      } else if (question.choices?.length) {
        const defaultIndex = resolveDefaultIndex(question.default, [...question.choices]);
        result[question.name] =
          defaultIndex !== undefined
            ? question.choices[defaultIndex]?.value
            : question.choices[0]?.value;
      } else {
        result[question.name] = '';
      }
    }
    return result as T;
  }

  const result: Record<string, unknown> = {};
  for (const question of questions) {
    if (!shouldAsk(question, result)) {
      continue;
    }
    result[question.name] = await askOne(question, result);
  }
  return result as T;
}

const cliPrompts = { prompt };

export default cliPrompts;

export { confirm, isCancel, multiselect, password, select, text };
