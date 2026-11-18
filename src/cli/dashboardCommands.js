// `pocketpulse dashboard` and `pocketpulse today`: print a screen and exit.
// (The interactive home screen in interactive.js reuses the same drawing code.)

import { parseArgs } from 'node:util';
import { renderDashboard, renderToday } from '../ui/dashboard.js';
import { normalizeCurrency, supportedCurrencyCodes } from '../utils/money.js';
import { GLOBAL_OPTIONS } from './options.js';

/** Read --currency: returns { currency } (maybe undefined) or { error }. */
function readCurrency(args) {
  const { values } = parseArgs({
    args,
    options: { ...GLOBAL_OPTIONS, currency: { type: 'string', short: 'c' } },
    allowPositionals: true,
    strict: false,
  });
  if (typeof values.currency !== 'string') return { currency: undefined };
  const currency = normalizeCurrency(values.currency);
  if (!currency) return { error: `"${values.currency}" isn't a supported currency. Choose one of: ${supportedCurrencyCodes().join(', ')}.` };
  return { currency };
}

function makeRunner(build) {
  return async (args, ctx) => {
    const { currency, error } = readCurrency(args);
    if (error) {
      ctx.error(`${ctx.theme.danger(ctx.theme.symbols.cross)} ${error}`);
      return 2;
    }
    const app = await ctx.getApp();
    ctx.write(build(app, ctx, currency));
    return 0;
  };
}

export const runDashboard = makeRunner((app, ctx, currency) =>
  renderDashboard(ctx.theme, app.analytics.dashboard({ currency }), { columns: ctx.columns }));

export const runToday = makeRunner((app, ctx, currency) =>
  renderToday(ctx.theme, app.analytics.todayView({ currency }), { columns: ctx.columns }));
