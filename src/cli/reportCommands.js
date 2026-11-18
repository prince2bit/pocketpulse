// week, month, range and trends.
//
//   pocketpulse week [date] [--previous | --back N]
//   pocketpulse month [2026-10]
//   pocketpulse range 2026-11-01 2026-11-20
//   pocketpulse trends [--weeks N | --months N]
//
// All of them accept --category NAME and --currency CODE.

import { parseArgs } from 'node:util';
import { renderReport, renderTrends } from '../ui/reports.js';
import { formatCategory } from '../ui/text.js';
import {
  daysBetween, isValidDay, monthRange, parseLocalDate, weekRange,
} from '../utils/dateTime.js';
import { normalizeCurrency, supportedCurrencyCodes } from '../utils/money.js';
import { GLOBAL_OPTIONS } from './options.js';

const MAX_BACK = 520; // about ten years of weeks
const MAX_RANGE_DAYS = 366;
const MAX_WEEKS = 52;
const MAX_MONTHS = 24;
const BROWSER_MENU_ROWS = 8;
const DATE_HELP = 'Use a date like 2026-11-09, or "today" / "yesterday".';

const OPTIONS = {
  ...GLOBAL_OPTIONS,
  back: { type: 'string' },
  previous: { type: 'boolean', short: 'p' },
  currency: { type: 'string', short: 'c' },
  category: { type: 'string', short: 'k' },
  from: { type: 'string' },
  to: { type: 'string' },
  weeks: { type: 'string' },
  months: { type: 'string' },
};

/** A whole number within limits, or an error message. */
function readCount(text, { min, max, name }) {
  const number = Number(text);
  if (!Number.isInteger(number) || number < min || number > max) {
    return { error: `${name} should be a whole number from ${min} to ${max}.` };
  }
  return { value: number };
}

/**
 * Read the options every report shares. Returns { values, positionals, currency,
 * category, back } or { error } (a message to show, with exit code 2).
 */
function readCommon(args, app) {
  const { values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: false });

  let currency;
  if (typeof values.currency === 'string') {
    currency = normalizeCurrency(values.currency);
    if (!currency) return { error: `"${values.currency}" isn't a supported currency. Choose one of: ${supportedCurrencyCodes().join(', ')}.` };
  }

  let category = null;
  if (typeof values.category === 'string') {
    const found = app.categories.find(values.category);
    if (!found.ok) return { error: found.error };
    category = found.category;
  }

  let back = values.previous ? 1 : 0;
  if (typeof values.back === 'string') {
    const parsed = readCount(values.back, { min: 0, max: MAX_BACK, name: '--back' });
    if (parsed.error) return parsed;
    if (values.previous && parsed.value !== 1) return { error: '--previous means "one period back", so it can\'t be combined with a different --back.' };
    back = parsed.value;
  }
  return { values, positionals, currency, category, back };
}

function run(build) {
  return async (args, ctx) => {
    const app = await ctx.getApp();
    const common = readCommon(args, app);
    const outcome = common.error ? common : build({ ...common, app, ctx, today: app.analytics.today() });
    if (outcome.error) {
      ctx.error(`${ctx.theme.danger(ctx.theme.symbols.cross)} ${outcome.error}`);
      return 2;
    }
    ctx.write(outcome.text);
    return 0;
  };
}

const showReport = ({ app, ctx, category, currency, from, to, kind }) => ({
  text: renderReport(ctx.theme, app.analytics.report({ from, to, kind, currency, categoryId: category?.id ?? null }), { columns: ctx.columns, category }),
});

export const runWeek = run((c) => {
  const [dateText] = c.positionals;
  let anchor = c.today;
  if (dateText !== undefined) {
    anchor = parseLocalDate(dateText, c.today);
    if (!anchor) return { error: `"${dateText}" isn't a date. ${DATE_HELP}` };
  }
  const { from, to } = weekRange(anchor, c.back);
  return showReport({ ...c, from, to, kind: 'week' });
});

export const runMonth = run((c) => {
  const [dateText] = c.positionals;
  let anchor = c.today;
  if (dateText !== undefined) {
    // "2026-10" is a friendly way to name a month; a full date works too.
    anchor = /^\d{4}-\d{2}$/.test(dateText) && isValidDay(`${dateText}-01`) ? `${dateText}-01` : parseLocalDate(dateText, c.today);
    if (!anchor) return { error: `"${dateText}" isn't a month or date. Use 2026-10, 2026-10-15, or "today".` };
  }
  const { from, to } = monthRange(anchor, c.back);
  return showReport({ ...c, from, to, kind: 'month' });
});

export const runRange = run((c) => {
  const fromText = c.values.from ?? c.positionals[0];
  const toText = c.values.to ?? c.positionals[1];
  if (fromText === undefined || toText === undefined) {
    return { error: 'Give a start and an end: pocketpulse range 2026-11-01 2026-11-20' };
  }
  const from = parseLocalDate(fromText, c.today);
  const to = parseLocalDate(toText, c.today);
  if (!from) return { error: `"${fromText}" isn't a date. ${DATE_HELP}` };
  if (!to) return { error: `"${toText}" isn't a date. ${DATE_HELP}` };
  if (from > to) return { error: `The start (${from}) comes after the end (${to}). Try swapping them.` };
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return { error: `That's more than ${MAX_RANGE_DAYS} days. Pick a range of up to a year.` };
  return showReport({ ...c, from, to, kind: 'range' });
});

export const runTrends = run((c) => {
  if (typeof c.values.weeks === 'string' && typeof c.values.months === 'string') {
    return { error: 'Choose either --weeks or --months, not both.' };
  }
  const byMonth = typeof c.values.months === 'string';
  const parsed = byMonth
    ? readCount(c.values.months, { min: 1, max: MAX_MONTHS, name: '--months' })
    : readCount(c.values.weeks ?? '8', { min: 1, max: MAX_WEEKS, name: '--weeks' });
  if (parsed.error) return parsed;
  const trend = c.app.analytics.trend({ unit: byMonth ? 'month' : 'week', count: parsed.value, currency: c.currency, categoryId: c.category?.id ?? null });
  return { text: renderTrends(c.ctx.theme, trend, { columns: c.ctx.columns, category: c.category }) };
});

// The interactive browser (used by the home menu)

/**
 * Show a week or month and let the person flip through periods with single
 * key presses: p = previous, n = next, c = filter by category, b = back.
 */
export async function browseReport(kind, ctx) {
  const app = await ctx.getApp();
  const prompts = ctx.getPrompts();
  const { theme } = ctx;
  const title = kind === 'week' ? 'Weekly analytics' : 'Monthly analytics';
  let back = 0;
  let category = null;
  let notice = '';

  for (;;) {
    const { from, to } = kind === 'week' ? weekRange(app.analytics.today(), back) : monthRange(app.analytics.today(), back);
    ctx.clear();
    // Leave room below the report for the menu (about 8 lines), so nothing scrolls off the top.
    const maxRows = ctx.rows ? ctx.rows - BROWSER_MENU_ROWS : Infinity;
    ctx.write(renderReport(theme, app.analytics.report({ from, to, kind, categoryId: category?.id ?? null }), { columns: ctx.columns, category, maxRows }));
    if (notice) ctx.write(theme.muted(notice));
    notice = '';
    ctx.write('');

    const choice = await prompts.select(title, [
      { key: 'previous', label: `Previous ${kind}`, shortcut: 'p' },
      { key: 'next', label: `Next ${kind}`, shortcut: 'n' },
      { key: 'category', label: category ? `Category: ${category.name}` : 'Filter by category', shortcut: 'c' },
      { key: 'back', label: 'Back to the menu', shortcut: 'b' },
    ], { defaultIndex: 3 });
    if (!choice || choice.key === 'back') return;

    if (choice.key === 'previous') {
      back = Math.min(back + 1, MAX_BACK);
    } else if (choice.key === 'next') {
      if (back === 0) notice = `You're already looking at the current ${kind}.`;
      else back -= 1;
    } else {
      const all = app.categories.list();
      const items = [{ key: 'all', label: 'All categories' }, ...all.map((c) => ({ key: String(c.id), id: c.id, label: formatCategory(theme, c) }))];
      const current = category ? items.findIndex((item) => item.id === category.id) : 0;
      const picked = await prompts.select('Show which category?', items, { defaultIndex: current });
      if (picked) category = picked.key === 'all' ? null : all.find((c) => c.id === picked.id);
    }
  }
}

