// Draws week/month/range reports and trends from analyticsService data.
// Comparisons are worded neutrally: arrows and percentages, no judgement.

import {
  addDays, describeRange, formatDaySpan, formatDayShort, formatLocalDay, monthName, startOfMonth, startOfWeek,
} from '../utils/dateTime.js';
import { formatMoney } from '../utils/money.js';
import { formatPercent, renderBar, sparkline } from './charts.js';
import {
  amountLines, breakdownRows, joinColumns, layoutFor, otherCurrencyNote, plural,
} from './dashboard.js';
import { renderPanel } from './panel.js';
import { formatCategory, padEndWidth, padStartWidth, stringWidth, wrapText } from './text.js';

const MAX_SPARKLINE_DAYS = 62;

// Wording

/** "This week", "Last week", "This month"... and the dates in words. */
function heading(report) {
  const { kind, from, to, today } = report;
  if (kind === 'month') {
    const thisMonth = startOfMonth(today);
    const label = from === thisMonth ? 'This month' : from === startOfMonth(addDays(thisMonth, -1)) ? 'Last month' : 'Month';
    return `${label} · ${monthName(from)} ${from.slice(0, 4)}`;
  }
  if (kind === 'week') {
    const thisWeek = startOfWeek(today);
    const label = from === thisWeek ? 'This week' : from === addDays(thisWeek, -7) ? 'Last week' : 'Week';
    return `${label} · ${describeRange(from, to)}`;
  }
  return `Custom range · ${describeRange(from, to)}`;
}

/** What we compare with, in words: "last week", "same days last month"... */
function comparisonLabel(report) {
  const { kind, comparison, days } = report;
  if (kind === 'week') return comparison.partial ? 'same days last week' : 'last week';
  if (kind === 'month') return comparison.partial ? 'same days last month' : 'last month';
  return `the ${plural(days, 'day')} before`;
}

/** "▲ 12%", "▼ 8%", "about the same", or an explanation when there's nothing to compare. */
function describeChange(theme, entry) {
  const { totalMinor, previousMinor, changeFraction } = entry;
  if (totalMinor === 0 && previousMinor === 0) return 'no spending in either';
  if (previousMinor === 0) return 'nothing spent then';
  const percent = Math.round(Math.abs(changeFraction) * 100);
  if (percent === 0) return 'about the same';
  return `${changeFraction > 0 ? theme.symbols.up : theme.symbols.down} ${percent}%`;
}

/** A muted note under a label, wrapped so it never runs past the panel. */
function noteLines(theme, label, text, inner) {
  const [first, ...rest] = wrapText(text, Math.max(20, inner - 13));
  return [`${label}${theme.muted(first)}`, ...rest.map((line) => `${' '.repeat(13)}${theme.muted(line)}`)];
}

// Pieces

function summaryPanel(theme, report, layout, category) {
  const { compact, inner } = layout;
  const { summary, primaryCurrency } = report;
  const label = (text) => theme.muted(text.padEnd(13));

  const totals = summary.map((s) => ({ currency: s.currency, totalMinor: s.totalMinor }));
  const averages = summary.map((s) => ({ currency: s.currency, totalMinor: s.averageMinor }));
  const tiles = [
    [theme.muted('TOTAL'), ...amountLines(theme, totals, primaryCurrency)],
    [theme.muted('DAILY AVERAGE'), ...amountLines(theme, averages, primaryCurrency)],
    [theme.muted('EXPENSES'), theme.bold(theme.primary(String(report.count)))],
  ];
  const lines = [];
  if (category) lines.push(`${label('Only')}${formatCategory(theme, category)}`, '');
  if (compact) {
    for (const tile of tiles) lines.push(`${padEndWidth(tile[0], 14)}${tile.slice(1).join('  ')}`);
  } else {
    const width = Math.floor(inner / 3);
    lines.push(...joinColumns(tiles, [width, width, width]));
  }
  lines.push('');

  if (report.inProgress) lines.push(...noteLines(theme, label('Progress'), `day ${report.elapsedDays} of ${report.days}; averages use the days so far`, inner));

  // Comparison with the period before: one line per currency (at most two),
  // then one muted line saying exactly what it was compared with.
  if (report.comparison.available) {
    const comparable = summary.filter((s) => s.totalMinor > 0 || s.previousMinor > 0).slice(0, 2);
    comparable.forEach((entry, index) => {
      const detail = `${formatMoney(entry.totalMinor, entry.currency)} vs ${formatMoney(entry.previousMinor, entry.currency)}`;
      lines.push(`${label(index === 0 ? 'Compared' : '')}${describeChange(theme, entry)}  ${theme.muted(detail)}`);
    });
    if (comparable.length > 0) {
      const window = describeRange(report.comparison.previousFrom, report.comparison.comparedTo);
      lines.push(...noteLines(theme, label(''), `against ${comparisonLabel(report)} (${window})`, inner));
    }
  }

  if (report.busiestDay) {
    lines.push(`${label('Busiest day')}${formatLocalDay(report.busiestDay.date, report.today)}  ${theme.bold(formatMoney(report.busiestDay.totalMinor, primaryCurrency))}`);
  }
  if (report.breakdown[0]) {
    const top = report.breakdown[0];
    lines.push(`${label('Top category')}${formatCategory(theme, top.category)}  ${theme.bold(formatMoney(top.totalMinor, primaryCurrency))} ${theme.muted(`(${formatPercent(top.share)})`)}`);
  }
  if (report.largest) {
    lines.push(`${label('Biggest')}${report.largest.description} ${theme.bold(formatMoney(report.largest.amountMinor, report.largest.currency))} ${theme.muted(`${theme.symbols.dot} ${formatLocalDay(report.largest.localDate, report.today)}`)}`);
  }
  if (report.kind !== 'week' && report.days <= MAX_SPARKLINE_DAYS && report.daily.some((d) => d.totalMinor > 0)) {
    lines.push(`${label('Day by day')}${theme.primary(sparkline(theme, report.daily.map((d) => d.totalMinor)))}`);
  }
  return renderPanel(theme, { title: heading(report), lines, width: inner, maxWidth: inner });
}

/** Bars for the days (or weeks) of the period. */
function chartPanel(theme, report, { compact, inner }) {
  const { buckets, bucketUnit, primaryCurrency, today } = report;
  const title = `${bucketUnit === 'day' ? 'Day by day' : 'Week by week'} · ${primaryCurrency}`;
  const max = Math.max(...buckets.map((b) => b.totalMinor));
  if (max === 0) return renderPanel(theme, { title, lines: [theme.muted(`Nothing spent in ${primaryCurrency} in this period.`)], width: inner, maxWidth: inner });

  const labels = buckets.map((b) => (bucketUnit === 'day' ? formatDayShort(b.from) : formatDaySpan(b.from, b.to)));
  const money = buckets.map((b) => formatMoney(b.totalMinor, primaryCurrency));
  const labelW = Math.max(...labels.map(stringWidth));
  const moneyW = Math.max(...money.map(stringWidth));
  const barW = Math.max(8, Math.min(30, inner - labelW - moneyW - (compact ? 4 : 12)));

  const lines = buckets.map((bucket, index) => {
    const isBusiest = bucket.totalMinor === max;
    const isToday = bucket.from <= today && today <= bucket.to;
    const amount = isBusiest ? theme.bold(padStartWidth(money[index], moneyW)) : padStartWidth(money[index], moneyW);
    const marker = isToday ? theme.muted(' today') : '';
    return `${padEndWidth(theme.muted(labels[index]), labelW)}  ${renderBar(theme, bucket.totalMinor / max, barW)}  ${amount}${marker}`;
  });
  return renderPanel(theme, { title, lines, width: inner, maxWidth: inner });
}

function categoryPanel(theme, report, layout) {
  const lines = report.breakdown.length === 0
    ? [theme.muted(`Nothing spent in ${report.primaryCurrency} in this period.`)]
    : breakdownRows(theme, report.breakdown, report.primaryCurrency, { ...layout, breakdownRows: 6 });
  lines.push(...otherCurrencyNote(theme, report.otherCurrencies, `pocketpulse ${report.kind}`, layout.inner));
  return renderPanel(theme, { title: `By category · ${report.primaryCurrency}`, lines, width: layout.inner, maxWidth: layout.inner });
}

// The screens

/**
 * A week, month or custom-range report.
 * @param {object} [options]
 * @param {object|null} [options.category] when set, the report is about this one category
 * @param {number} [options.maxRows] shrink to fit a window this tall (drops the chart, then the categories)
 */
function renderReportText(theme, report, { columns = 80, category = null, maxRows = Infinity } = {}) {
  const layout = layoutFor(columns);

  if (report.notStarted) {
    return renderPanel(theme, { title: heading(report), width: layout.inner, maxWidth: layout.inner, lines: ['This period hasn\'t started yet.', theme.muted('Nothing to show for it.')] });
  }
  if (report.count === 0) {
    // Long sentences wrap onto several lines instead of being clipped.
    const hint = category
      ? wrapText(`Nothing in ${category.name} for this period. Try another period, or run it without --category.`, layout.inner)
      : [`Add something: ${theme.primary('pocketpulse add chips 20')}`];
    return renderPanel(theme, {
      title: heading(report), width: layout.inner, maxWidth: layout.inner, lines: ['No expenses in this period.', '', ...hint],
    });
  }

  const panels = [summaryPanel(theme, report, layout, category), chartPanel(theme, report, layout)];
  if (report.categoryId === null) panels.push(categoryPanel(theme, report, layout));
  else if (report.otherCurrencies.length > 0) {
    panels.push(...otherCurrencyNote(theme, report.otherCurrencies, `pocketpulse ${report.kind}`, layout.inner).slice(1));
  }
  // In a short window, drop the least important panels (from the end) until it fits.
  // The summary always stays, even if that means it still doesn't quite fit.
  const height = () => panels.join('\n').split('\n').length;
  while (panels.length > 1 && height() > maxRows) panels.pop();
  return panels.join('\n');
}

/** Spending over several weeks or months. */
function renderTrendsText(theme, trend, { columns = 80, category = null } = {}) {
  const { compact, inner } = layoutFor(columns);
  const { periods, unit, primaryCurrency } = trend;
  const noun = unit === 'week' ? 'week' : 'month';
  const label = (text) => theme.muted(text.padEnd(13));
  const title = `Trend · ${unit === 'week' ? 'weekly' : 'monthly'} · ${primaryCurrency}${category ? ` · ${category.name}` : ''}`;

  const max = Math.max(...periods.map((p) => p.primaryMinor));
  if (max === 0) {
    return renderPanel(theme, { title, width: inner, maxWidth: inner, lines: [`Nothing spent in ${primaryCurrency} over the last ${plural(periods.length, noun)}.`, '', `Add something: ${theme.primary('pocketpulse add chips 20')}`] });
  }

  const names = periods.map((p) => (unit === 'week' ? formatDaySpan(p.from, addDays(p.from, 6)) : `${monthName(p.from).slice(0, 3)} ${p.from.slice(0, 4)}`));
  const money = periods.map((p) => formatMoney(p.primaryMinor, primaryCurrency));
  const nameW = Math.max(...names.map(stringWidth));
  const moneyW = Math.max(...money.map(stringWidth));
  const barW = Math.max(8, Math.min(30, inner - nameW - moneyW - (compact ? 4 : 14)));
  const rows = periods.map((p, i) => `${padEndWidth(theme.muted(names[i]), nameW)}  ${renderBar(theme, p.primaryMinor / max, barW)}  ${padStartWidth(money[i], moneyW)}${p.inProgress ? theme.muted(' so far') : ''}`);

  // Averages use finished periods only: the current one is still filling up.
  const finished = periods.filter((p) => !p.inProgress);
  const summary = [];
  summary.push(`${label('Trend')}${theme.primary(sparkline(theme, periods.map((p) => p.primaryMinor)))}  ${theme.muted(`oldest ${theme.symbols.arrow} newest`)}`);
  if (finished.length > 0) {
    const average = Math.round(finished.reduce((sum, p) => sum + p.primaryMinor, 0) / finished.length);
    summary.push(`${label(`Average/${noun}`)}${theme.bold(formatMoney(average, primaryCurrency))} ${theme.muted(`(${plural(finished.length, `finished ${noun}`)})`)}`);
  }
  const highest = periods.reduce((best, p) => (p.primaryMinor > best.primaryMinor ? p : best));
  summary.push(`${label(`Highest ${noun}`)}${names[periods.indexOf(highest)]}  ${theme.bold(formatMoney(highest.primaryMinor, primaryCurrency))}`);

  const lines = [...rows, '', ...summary, ...otherCurrencyNote(theme, trend.otherCurrencies, 'pocketpulse trends', inner)];
  return renderPanel(theme, { title, lines, width: inner, maxWidth: inner });
}

// Terminals without Unicode get plain hyphens for the en dash (–) in date ranges and the dot (·) in titles.
// Both are one column wide, so swapping them can't disturb the layout.
const forTerminal = (theme, text) => (theme.unicode ? text : text.replaceAll('–', '-').replaceAll('·', '-'));

export const renderReport = (theme, report, options) => forTerminal(theme, renderReportText(theme, report, options));
export const renderTrends = (theme, trend, options) => forTerminal(theme, renderTrendsText(theme, trend, options));
