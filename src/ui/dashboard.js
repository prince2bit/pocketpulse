// Draws the dashboard and the Today screen. Takes plain data from analyticsService
// and returns text; no database access.

import { describeLocalDate, formatLocalTime, monthName } from '../utils/dateTime.js';
import { formatMoney } from '../utils/money.js';
import { formatPercent, renderBar, sparkline } from './charts.js';
import { renderPanel } from './panel.js';
import { formatCategory, padEndWidth, padStartWidth, stringWidth, wrapText } from './text.js';

const MAX_WIDTH = 76; // widest inner width we use, even on huge terminals
const MIN_PANEL_WIDTH = 44;
const COMPACT_BELOW = 64; // terminals narrower than this get the stacked layout

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
export const truncate = (text, max, ellipsis) => ([...text].length > max ? `${[...text].slice(0, max - 1).join('')}${ellipsis}` : text);

export function layoutFor(columns) {
  return {
    compact: columns < COMPACT_BELOW,
    inner: Math.max(MIN_PANEL_WIDTH, Math.min(columns - 4, MAX_WIDTH)),
  };
}

/** A tile's amount lines: one per currency (max two), never added together. */
export function amountLines(theme, totals, fallbackCurrency) {
  if (totals.length === 0) return [theme.muted(formatMoney(0, fallbackCurrency))];
  const lines = totals.slice(0, 2).map((t) => theme.bold(theme.primary(formatMoney(t.totalMinor, t.currency))));
  if (totals.length > 2) lines.push(theme.muted(`+${totals.length - 2} more`));
  return lines;
}

/** Put equal-width columns of lines side by side. */
export function joinColumns(columns, widths) {
  const height = Math.max(...columns.map((column) => column.length));
  return Array.from({ length: height }, (_, row) =>
    columns.map((column, index) => padEndWidth(column[row] ?? '', widths[index])).join('').trimEnd());
}

function overviewPanel(theme, data, { compact, inner, minimalOverview = false }) {
  const tiles = [['TODAY', data.periods.today], ['THIS WEEK', data.periods.week], ['THIS MONTH', data.periods.month]]
    .map(([label, period]) => [
      theme.muted(label),
      ...amountLines(theme, period.totals, data.primaryCurrency),
      theme.muted(plural(period.count, 'expense')),
    ]);

  let lines;
  if (compact) {
    // Narrow terminal: one line per period.
    lines = tiles.map((tile) => `${padEndWidth(tile[0], 11)}${tile.slice(1, -1).join('  ')}  ${tile.at(-1)}`);
  } else {
    const width = Math.floor(inner / 3);
    lines = joinColumns(tiles, [width, width, width]);
  }

  if (minimalOverview) return renderPanel(theme, { title: 'Your spending', lines, width: inner }); // tiles only

  const label = (text) => theme.muted(text.padEnd(12));
  lines.push('');
  lines.push(`${label('Last 7 days')}${theme.primary(sparkline(theme, data.last7.map((day) => day.totalMinor)))}  ${theme.muted(data.primaryCurrency)}`);
  if (data.largest) {
    const when = describeLocalDate(data.largest.localDate, data.today);
    lines.push(`${label('Biggest')}${data.largest.description} ${theme.bold(formatMoney(data.largest.amountMinor, data.largest.currency))} ${theme.muted(`${theme.symbols.dot} ${when}`)}`);
  }
  if (data.mostUsedCategory) {
    lines.push(`${label('Most used')}${formatCategory(theme, data.mostUsedCategory.category)} ${theme.muted(`(${data.mostUsedCategory.count}${theme.symbols.times})`)}`);
  }
  return renderPanel(theme, { title: 'Your spending', lines, width: inner });
}

/** Category bars: "🍟 Food & Snacks  ████░░░░  ₹980.00  40%". */
export function breakdownRows(theme, rows, currency, { compact, inner, breakdownRows: limit = 5 }) {
  const shown = rows.slice(0, limit);
  const hidden = rows.slice(limit);
  const names = shown.map((row) => formatCategory(theme, row.category));
  const money = shown.map((row) => formatMoney(row.totalMinor, currency));
  const nameW = Math.max(...names.map(stringWidth));
  const moneyW = Math.max(...money.map(stringWidth));
  const barW = Math.max(8, Math.min(24, inner - nameW - moneyW - 12));

  const lines = shown.map((row, index) => {
    const colour = row.category?.color;
    const percent = padStartWidth(formatPercent(row.share), 4);
    const bar = compact ? '' : `${renderBar(theme, row.share, barW, colour)}  `;
    return `${padEndWidth(names[index], nameW)}  ${bar}${padStartWidth(money[index], moneyW)}  ${theme.muted(percent)}`;
  });
  if (hidden.length > 0) {
    const rest = hidden.reduce((sum, row) => sum + row.totalMinor, 0);
    const noun = hidden.length === 1 ? 'category' : 'categories';
    lines.push(theme.muted(`${theme.symbols.ellipsis}and ${hidden.length} more ${noun}  ${formatMoney(rest, currency)}`));
  }
  return lines;
}

/** A short note (wrapped to fit) pointing at spending in currencies other than the one shown. */
export function otherCurrencyNote(theme, others, command, inner) {
  if (others.length === 0) return [];
  const shown = others.slice(0, 3).join(', ') + (others.length > 3 ? ` +${others.length - 3} more` : '');
  const note = `Also spent in ${shown}. See it with: ${command} --currency ${others[0]}`;
  return ['', ...wrapText(note, inner).map((line) => theme.muted(line))];
}

function breakdownPanel(theme, data, layout) {
  const title = `Where it went ${theme.symbols.dot} ${monthName(data.today)} ${theme.symbols.dot} ${data.primaryCurrency}`;
  const lines = data.breakdown.length === 0
    ? [theme.muted(`Nothing spent in ${data.primaryCurrency} this month yet.`)]
    : breakdownRows(theme, data.breakdown, data.primaryCurrency, layout);
  lines.push(...otherCurrencyNote(theme, data.otherCurrencies, 'pocketpulse dashboard', layout.inner));
  return renderPanel(theme, { title, lines, width: layout.inner });
}

/**
 * How wide may the description column be? Whatever is left of the panel once
 * the other columns (and the gaps between them) are accounted for, but never
 * absurdly small, and never wider than `most`.
 */
function descriptionWidth(inner, otherColumnWidths, most) {
  const gaps = otherColumnWidths.length * 2; // two spaces between neighbouring columns
  return Math.max(8, Math.min(most, inner - otherColumnWidths.reduce((a, b) => a + b, 0) - gaps));
}

function recentPanel(theme, data, { compact, inner, recentRows = 5 }) {
  const ellipsis = theme.symbols.ellipsis;
  const items = data.recent.slice(0, recentRows).map((expense) => {
    const day = describeLocalDate(expense.localDate, data.today);
    const withTime = expense.localDate === data.today || day === 'Yesterday';
    return {
      description: expense.description,
      category: formatCategory(theme, expense.category),
      amount: formatMoney(expense.amountMinor, expense.currency),
      when: withTime ? `${day} ${formatLocalTime(expense.spentAtUtc, expense.timeZone)}` : day,
    };
  });
  const widest = (key) => Math.max(...items.map((row) => stringWidth(row[key])));
  const others = compact ? [widest('amount'), widest('when')] : [widest('category'), widest('amount'), widest('when')];
  const descW = Math.min(descriptionWidth(inner, others, 24), Math.max(...items.map((row) => [...row.description].length)));

  const lines = items.map((row) => [
    padEndWidth(truncate(row.description, descW, ellipsis), descW),
    ...(compact ? [] : [padEndWidth(row.category, widest('category'))]),
    theme.bold(padStartWidth(row.amount, widest('amount'))),
    theme.muted(row.when),
  ].join('  '));
  return renderPanel(theme, { title: 'Recent activity', lines, width: inner });
}

function emptyPanel(theme, inner) {
  return renderPanel(theme, {
    title: 'Your spending',
    width: inner,
    lines: [
      ...wrapText('No expenses yet. Your dashboard fills up as you add them.', inner),
      '',
      `Try: ${theme.primary('pocketpulse add chips 20')}`,
      `or:  ${theme.primary('pocketpulse add bought a notebook for 65')}`,
    ],
  });
}

// How much to show, from most to least. The home screen picks the richest
// level that fits the window, so the menu below it never gets pushed off screen.
const DETAIL_LEVELS = [
  { breakdownRows: 5, recentRows: 5, sections: ['overview', 'breakdown', 'recent'] },
  { breakdownRows: 3, recentRows: 3, sections: ['overview', 'breakdown', 'recent'] },
  { breakdownRows: 3, recentRows: 0, sections: ['overview', 'breakdown'] },
  { breakdownRows: 0, recentRows: 0, sections: ['overview'] },
  { breakdownRows: 0, recentRows: 0, sections: ['overview'], minimalOverview: true }, // for very short windows (80x24)
];

/**
 * The dashboard as text. Pass `maxRows` to shrink it to fit a short window;
 * without it you get everything.
 */
export function renderDashboard(theme, data, { columns = 80, maxRows = Infinity } = {}) {
  const base = layoutFor(columns);
  if (!data.hasExpenses) return emptyPanel(theme, base.inner);

  const panels = { overview: overviewPanel, breakdown: breakdownPanel, recent: recentPanel };
  let text = '';
  for (const level of DETAIL_LEVELS) {
    text = level.sections.map((name) => panels[name](theme, data, { ...base, ...level })).join('\n');
    if (text.split('\n').length <= maxRows) break;
  }
  return text; // if even the smallest doesn't fit, show it anyway: a tiny window is the user's choice
}

/** The "Today" screen: totals, category bars, and every expense from today. */
export function renderToday(theme, data, { columns = 80 } = {}) {
  const layout = layoutFor(columns);
  const { compact, inner } = layout;
  const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${data.today}T12:00:00Z`));
  const heading = `Today ${theme.symbols.dot} ${longDate}`;

  if (data.expenses.length === 0) {
    return renderPanel(theme, {
      title: heading,
      width: inner,
      lines: ['Nothing spent today yet.', '', `Add something: ${theme.primary('pocketpulse add chips 20')}`],
    });
  }

  // Line the amounts up so the currencies read as a tidy column.
  const amounts = data.period.totals.map((t) => formatMoney(t.totalMinor, t.currency));
  const amountW = Math.max(...amounts.map(stringWidth));
  const totalLines = data.period.totals.map((t, index) =>
    `${theme.bold(theme.primary(padStartWidth(amounts[index], amountW)))}  ${theme.muted(plural(t.count, 'expense'))}`);
  const summary = renderPanel(theme, { title: heading, lines: totalLines, width: inner });

  const where = renderPanel(theme, {
    title: `By category ${theme.symbols.dot} ${data.primaryCurrency}`,
    width: inner,
    lines: [
      ...(data.breakdown.length === 0 ? [theme.muted(`Nothing in ${data.primaryCurrency} today.`)] : breakdownRows(theme, data.breakdown, data.primaryCurrency, layout)),
      ...otherCurrencyNote(theme, data.otherCurrencies, 'pocketpulse today', inner),
    ],
  });

  const ellipsis = theme.symbols.ellipsis;
  const items = data.expenses.map((expense) => ({
    time: formatLocalTime(expense.spentAtUtc, expense.timeZone),
    description: expense.description,
    category: formatCategory(theme, expense.category),
    amount: formatMoney(expense.amountMinor, expense.currency),
  }));
  const widest = (key) => Math.max(...items.map((row) => stringWidth(row[key])));
  const others = compact ? [widest('time'), widest('amount')] : [widest('time'), widest('category'), widest('amount')];
  const descW = Math.min(descriptionWidth(inner, others, 28), Math.max(...items.map((row) => [...row.description].length)));
  const list = renderPanel(theme, {
    title: 'Expenses',
    width: inner,
    lines: items.map((row) => [
      theme.muted(padEndWidth(row.time, widest('time'))),
      padEndWidth(truncate(row.description, descW, ellipsis), descW),
      ...(compact ? [] : [padEndWidth(row.category, widest('category'))]),
      theme.bold(padStartWidth(row.amount, widest('amount'))),
    ].join('  ')),
  });

  return [summary, where, list].join('\n');
}
