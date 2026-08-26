import { spinner as clackSpinner } from '@clack/prompts';

import { isCliJsonLogFormat } from '../observability/cli-log-format.js';
import { emitCliLogEvent } from '../observability/cli-log-event.js';

export type CliSpinnerHandle = {
  start(message?: string): CliSpinnerHandle;
  succeed(message?: string): void;
  fail(message?: string): void;
  warn(message?: string): void;
  stop(message?: string): void;
  text: string;
};

type ProgressMeta = {
  component: string;
  phase: string;
  metadata?: Record<string, unknown>;
};

function emitProgress(
  meta: ProgressMeta,
  status: 'started' | 'succeeded' | 'failed' | 'warn',
  message: string
): void {
  emitCliLogEvent({
    level: status === 'failed' ? 'error' : status === 'warn' ? 'warn' : 'info',
    event: 'progress',
    component: meta.component,
    message,
    metadata: {
      phase: meta.phase,
      status,
      ...meta.metadata,
    },
  });
}

export function createUiSpinner(initialText: string, meta: ProgressMeta): CliSpinnerHandle {
  let currentText = initialText;
  emitProgress(meta, 'started', initialText);

  if (isCliJsonLogFormat()) {
    return {
      start(message?: string) {
        if (message) currentText = message;
        emitProgress(meta, 'started', currentText);
        return this;
      },
      succeed(message?: string) {
        emitProgress(meta, 'succeeded', message ?? currentText);
      },
      fail(message?: string) {
        emitProgress(meta, 'failed', message ?? currentText);
      },
      warn(message?: string) {
        emitProgress(meta, 'warn', message ?? currentText);
      },
      stop(message?: string) {
        emitProgress(meta, 'succeeded', message ?? currentText);
      },
      get text() {
        return currentText;
      },
      set text(value: string) {
        currentText = value;
        emitProgress(meta, 'started', value);
      },
    };
  }

  const spin = clackSpinner();
  spin.start(initialText);

  return {
    start(message?: string) {
      spin.start(message ?? currentText);
      if (message) currentText = message;
      emitProgress(meta, 'started', currentText);
      return this;
    },
    succeed(message?: string) {
      spin.stop(message ?? currentText);
      emitProgress(meta, 'succeeded', message ?? currentText);
    },
    fail(message?: string) {
      spin.stop(message ?? currentText, 1);
      emitProgress(meta, 'failed', message ?? currentText);
    },
    warn(message?: string) {
      spin.stop(message ?? currentText);
      emitProgress(meta, 'warn', message ?? currentText);
    },
    stop(message?: string) {
      spin.stop(message ?? currentText);
      emitProgress(meta, 'succeeded', message ?? currentText);
    },
    get text() {
      return currentText;
    },
    set text(value: string) {
      currentText = value;
      spin.message(value);
      emitProgress(meta, 'started', value);
    },
  };
}
