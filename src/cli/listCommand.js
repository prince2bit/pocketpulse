// `pocketpulse list`: recent expenses, newest first.

import { parseArgs } from 'node:util';
import { formatCategory, padEndWidth, padStartWidth, stringWidth } from '../ui/text.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import { formatMoney } from '../utils/money.js';
import { GLOBAL_OPTIONS } from './options.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 500;
const DESCRIPTION_WIDTH = 28;

export async function runList(args, ctx) {
  const { theme, write, error } = ctx;
  const { values } = parseArgs({
    args,
    options: { ...GLOBAL_OPTIONS, limit: { type: 'string', short: 'n' } },
    allowPositionals: true,
    strict: false,
  });

  let limit = DEFAULT_LIMIT;
  if (typeof values.limit === 'string') {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      error(`${theme.danger(theme.symbols.cross)} --limit should be a whole number from 1 to ${MAX_LIMIT}.`);
      return 2;
    }
  }

  const app = await ctx.getApp();
  const rows = app.expenses.listRecent(limit);
  if (rows.length === 0) {
    write('No expenses yet.');
    write(`Add your first one: ${theme.primary('pocketpulse add chips 20')}`);
    return 0;
  }

  const now = app.expenses.now();
  const ellipsis = theme.unicode ? '…' : '...';
  // Each amount is shown in its own currency; currencies are never summed.
  // Plain and coloured text are kept apart so widths can be measured.
  const cells = rows.map((row) => ({
    id: String(row.id),
    when: formatLocalDateTime(row.spentAtUtc, row.timeZone, { now }),
    description: [...row.description].length > DESCRIPTION_WIDTH
      ? `${[...row.description].slice(0, DESCRIPTION_WIDTH - 1).join('')}${ellipsis}`
      : row.description,
    category: formatCategory(theme, row.category),
    amount: formatMoney(row.amountMinor, row.currency),
  }));

  const width = (key) => Math.max(...cells.map((cell) => stringWidth(cell[key])));
  const [idW, whenW, descW, catW, amountW] = ['id', 'when', 'description', 'category', 'amount'].map(width);
  const header = [
    padStartWidth('#', idW), padEndWidth('When', whenW), padEndWidth('Description', descW),
    padEndWidth('Category', catW), padStartWidth('Amount', amountW),
  ].join('  ');

  write('');
  write(theme.muted(`  ${header}`));
  for (const cell of cells) {
    write(`  ${[
      theme.muted(padStartWidth(cell.id, idW)),
      padEndWidth(cell.when, whenW),
      padEndWidth(cell.description, descW),
      padEndWidth(cell.category, catW),
      theme.bold(padStartWidth(cell.amount, amountW)),
    ].join('  ')}`);
  }
  write('');
  write(theme.muted(`Showing ${rows.length} of ${app.expenses.count()}.`));
  return 0;
}
