// Shared test tools. Every test gets its OWN throwaway in-memory database and a
// clock we control, so tests never touch your real data and never depend on
// what time it happens to be.

import { createApp } from '../src/app.js';
import { createTheme } from '../src/ui/theme.js';

/** A fresh app on an in-memory database. Move time with `clock.current = new Date(...)`. */
export async function makeApp({ now = '2026-11-12T10:00:00Z', zone = 'UTC' } = {}) {
  const clock = { current: new Date(now) };
  const app = await createApp({ dbPath: ':memory:', clock: () => clock.current, systemTimeZone: () => zone });
  return { app, clock };
}

/**
 * A fake terminal context. `answers` are what the "person" types, in order,
 * when the command asks questions. Running out of answers acts like Ctrl+C.
 */
export function makeCtx(app, { interactive = false, answers = [], rows, columns = 100 } = {}) {
  const out = [];
  const err = [];
  const asked = [];
  const nextAnswer = (label) => {
    asked.push(label);
    return answers.length ? answers.shift() : null;
  };
  const prompts = {
    async text(label, { defaultValue } = {}) {
      const answer = nextAnswer(label);
      return answer === '' && defaultValue !== undefined ? defaultValue : answer;
    },
    async choice(label, _options, defaultKey) {
      const answer = nextAnswer(label);
      return answer === '' ? defaultKey : answer;
    },
    async select(label, items, { defaultIndex } = {}) {
      const answer = nextAnswer(label);
      if (answer === null) return null;
      if (answer === '' && defaultIndex !== undefined) return items[defaultIndex];
      // An answer can name an item by its `key` ("quick"), or by its menu number ("3").
      return items.find((item) => item.key === answer) ?? items[Number(answer) - 1] ?? null;
    },
    close() {},
  };
  const ctx = {
    theme: createTheme({ env: {}, colorLevel: 0, unicode: true }),
    version: '9.9.9',
    columns,
    rows,
    interactive,
    clear: () => {},
    write: (line = '') => out.push(line),
    error: (line = '') => err.push(line),
    getApp: async () => app,
    getPrompts: () => prompts,
  };
  return { ctx, out, err, asked };
}

/**
 * An app where "now" is controllable, plus `spend(when, description, amount, currency)`
 * to record an expense AT a chosen moment without disturbing the current time.
 */
export async function makeWorld({ now = '2026-11-12T10:00:00Z', zone = 'UTC' } = {}) {
  const { app, clock } = await makeApp({ now, zone });
  const spend = (when, description, amount, currency, categoryId) => {
    const saved = clock.current;
    clock.current = new Date(when);
    app.expenses.save(app.expenses.validate({ description, amount, currency, categoryId }).draft);
    clock.current = saved;
  };
  return { app, clock, spend };
}
