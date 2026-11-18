import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, renderTrends } from '../src/ui/reports.js';
import { createTheme, stripAnsi } from '../src/ui/theme.js';
import { stringWidth } from '../src/ui/text.js';
import { makeWorld } from './helpers.js';

const plain = (unicode = true) => createTheme({ env: {}, colorLevel: 0, unicode });
const lines = (text) => stripAnsi(text).split('\n');

// Thu 12 Nov 2026 is "now".
async function world() {
  const w = await makeWorld();
  const { spend } = w;
  spend('2026-11-02T08:00:00Z', 'chips', '100');
  spend('2026-11-03T08:00:00Z', 'bus', '50');
  spend('2026-11-05T08:00:00Z', 'groceries', '900');
  spend('2026-11-07T08:00:00Z', 'movie', '200');
  spend('2026-11-09T08:00:00Z', 'chai', '60');
  spend('2026-11-11T08:00:00Z', 'rent', '300');
  return w;
}
const weekReport = (app, from = '2026-11-09', to = '2026-11-15', extra) => app.analytics.report({ from, to, kind: 'week', ...extra });
const monthReport = (app, from = '2026-11-01', to = '2026-11-30') => app.analytics.report({ from, to, kind: 'month' });

describe('renderReport: headings', () => {
  it('names weeks and months in words', async () => {
    const { app } = await world();
    const text = (report) => renderReport(plain(), report);
    assert.match(text(weekReport(app)), /This week · Mon 9 – Sun 15 Nov 2026/);
    assert.match(text(weekReport(app, '2026-11-02', '2026-11-08')), /Last week · Mon 2 – Sun 8 Nov 2026/);
    assert.match(text(weekReport(app, '2026-10-19', '2026-10-25')), /^╭─ Week · Mon 19 – Sun 25 Oct 2026/);
    assert.match(text(monthReport(app)), /This month · November 2026/);
    assert.match(text(monthReport(app, '2026-10-01', '2026-10-31')), /Last month · October 2026/);
    assert.match(text(monthReport(app, '2026-08-01', '2026-08-31')), /Month · August 2026/);
    assert.match(text(app.analytics.report({ from: '2026-11-03', to: '2026-11-07', kind: 'range' })), /Custom range · Tue 3 – Sat 7 Nov 2026/);
  });
});

describe('renderReport: the summary', () => {
  it('shows total, daily average, expense count, busiest day, top category and biggest expense', async () => {
    const { app } = await world();
    const text = renderReport(plain(), weekReport(app));
    for (const expected of ['TOTAL', '₹360.00', 'DAILY AVERAGE', '₹90.00', 'EXPENSES', 'Busiest day', 'Wed 11 Nov', '₹300.00',
      'Top category', '📱 Bills & Recharge', '(83%)', 'Biggest', 'rent ₹300.00']) {
      assert.ok(text.includes(expected), `missing "${expected}"\n${text}`);
    }
  });
  it('explains that an unfinished period\'s average uses the days so far', async () => {
    const { app } = await world();
    assert.match(renderReport(plain(), weekReport(app)), /Progress\s+day 4 of 7; averages use the days so far/);
    assert.ok(!renderReport(plain(), weekReport(app, '2026-11-02', '2026-11-08')).includes('Progress'));
  });
  it('says exactly what an unfinished period is compared with', async () => {
    const { app } = await world();
    const text = renderReport(plain(), weekReport(app));
    assert.match(text, /Compared\s+▼ 66%\s+₹360\.00 vs ₹1,050\.00/);
    assert.match(text, /against same days last week \(Mon 2 – Thu 5 Nov 2026\)/);
  });
  it('compares a finished period with the whole previous one', async () => {
    const { app, spend } = await world();
    spend('2026-10-27T08:00:00Z', 'earlier', '1000');
    assert.match(renderReport(plain(), weekReport(app, '2026-11-02', '2026-11-08')), /against last week \(Mon 26 Oct – Sun 1 Nov 2026\)/);
  });
  it('words changes neutrally: arrows and percentages, never "overspent"', async () => {
    const { app, spend } = await world();
    spend('2026-11-03T08:00:00Z', 'extra', '5000'); // makes this week look "up" instead of down
    const up = renderReport(plain(), weekReport(app, '2026-11-02', '2026-11-08'));
    assert.ok(!/overspen|warning|too much|careful|bad/i.test(up));
    const upWeek = renderReport(plain(), weekReport(app, '2026-11-09', '2026-11-15'));
    assert.ok(!/overspen|warning|too much|careful|bad/i.test(upWeek));
  });
  it('shows ▲ for an increase and "about the same" for no change', async () => {
    const { app, spend } = await makeWorld();
    spend('2026-11-02T08:00:00Z', 'a', '100');
    spend('2026-11-09T08:00:00Z', 'b', '150');
    assert.match(renderReport(plain(), weekReport(app)), /▲ 50%/);
    const same = await makeWorld();
    same.spend('2026-11-02T08:00:00Z', 'a', '100');
    same.spend('2026-11-09T08:00:00Z', 'b', '100');
    assert.match(renderReport(plain(), weekReport(same.app)), /about the same/);
  });
  it('explains when there is nothing to compare with', async () => {
    const { app } = await world();
    assert.match(renderReport(plain(), weekReport(app, '2026-11-02', '2026-11-08')), /nothing spent then/);
  });
  it('uses up/down letters in ASCII mode', async () => {
    const { app } = await world();
    assert.match(renderReport(plain(false), weekReport(app)), /v 66%/);
  });
  it('mentions the date range of the comparison for months too', async () => {
    const { app, spend } = await world();
    spend('2026-10-03T08:00:00Z', 'rent', '5000');
    assert.match(renderReport(plain(), monthReport(app)), /against same days last month \(Thu 1 – Mon 12 Oct 2026\)/);
  });
});

describe('renderReport: charts', () => {
  it('draws one bar per day for a week, marking today', async () => {
    const { app } = await world();
    const rows = lines(renderReport(plain(), weekReport(app))).filter((l) => /^│ (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ /.test(l));
    assert.equal(rows.length, 7);
    assert.match(rows[3], /Thu 12.*today/);
    assert.ok(rows[2].includes('₹300.00') && rows[2].includes('█'));
  });
  it('draws one bar per week for a month, with a day-by-day sparkline', async () => {
    const { app } = await world();
    const text = renderReport(plain(), monthReport(app));
    assert.match(text, /Week by week · INR/);
    assert.match(text, /2–8 Nov\s+█+░*\s+₹1,250\.00/);
    assert.match(text, /Day by day\s+[▁-█]{30}/);
  });
  it('does not repeat the sparkline on a week report (the bars already show each day)', async () => {
    const { app } = await world();
    assert.ok(!/Day by day {2,}[▁-█]/.test(renderReport(plain(), weekReport(app))));
  });
  it('scales bars to the biggest bucket, so the busiest bar is full width', async () => {
    const { app } = await world();
    const rows = lines(renderReport(plain(), weekReport(app))).filter((l) => /^│ Wed 11 /.test(l));
    assert.ok(!rows[0].includes('░'), 'the biggest bar is completely filled');
  });
  it('says so when there is spending but none in the chosen currency', async () => {
    const { app, spend } = await world();
    spend('2026-11-10T08:00:00Z', 'ramen', '800', 'JPY');
    assert.match(renderReport(plain(), weekReport(app, undefined, undefined, { currency: 'EUR' })), /Nothing spent in EUR in this period/);
  });
});

describe('renderReport: categories and filters', () => {
  it('shows a category breakdown by default', async () => {
    const { app } = await world();
    assert.match(renderReport(plain(), weekReport(app)), /By category · INR/);
  });
  it('with a category filter: says so, and drops the (pointless) category panel', async () => {
    const { app } = await world();
    const category = app.categories.find('Transport').category;
    const text = renderReport(plain(), weekReport(app, '2026-11-02', '2026-11-08', { categoryId: category.id }), { category });
    assert.match(text, /Only\s+🚌 Transport/);
    assert.ok(!text.includes('By category'));
    assert.ok(text.includes('₹50.00') && !text.includes('₹900.00'));
  });
  it('points at other currencies and how to see them', async () => {
    const { app, spend } = await world();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    assert.match(lines(renderReport(plain(), weekReport(app))).join(' '), /Also spent in USD\. See it with: pocketpulse week --currency USD/);
  });
  it('never adds currencies together', async () => {
    const { app, spend } = await world();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    const text = renderReport(plain(), weekReport(app));
    assert.ok(text.includes('₹360.00') && text.includes('$10.00'));
    assert.ok(!text.includes('370'), '₹360 + $10 must never become 370');
  });
});

describe('renderReport: empty and future periods', () => {
  it('says so, kindly, when nothing was spent', async () => {
    const { app } = await world();
    const text = renderReport(plain(), weekReport(app, '2026-08-03', '2026-08-09'));
    assert.match(text, /No expenses in this period/);
    assert.match(text, /pocketpulse add chips 20/);
    assert.ok(!text.includes('TOTAL'));
  });
  it('tailors the empty message when a category filter is on', async () => {
    const { app } = await world();
    const category = app.categories.find('Health').category;
    const text = renderReport(plain(), weekReport(app, undefined, undefined, { categoryId: category.id }), { category });
    assert.match(text, /Nothing in Health for this period/);
  });
  it('wraps the filtered empty message instead of clipping it, even on a narrow terminal', async () => {
    const { app } = await world();
    const category = app.categories.find('Health').category;
    for (const columns of [60, 80]) {
      const text = renderReport(plain(), weekReport(app, undefined, undefined, { categoryId: category.id }), { columns, category });
      assert.ok(!text.includes('…'), `clipped at ${columns} columns:\n${text}`);
      assert.ok(text.includes('--category.'), 'the end of the sentence must be there'); // it may wrap between words
      assert.equal(new Set(lines(text).map(stringWidth)).size, 1);
    }
  });
  it('says a future period has not started', async () => {
    const { app } = await world();
    assert.match(renderReport(plain(), weekReport(app, '2026-11-16', '2026-11-22')), /hasn't started yet/);
  });
});

describe('renderReport: layout', () => {
  const sizes = [60, 70, 80, 100, 140];
  it('keeps every panel one width, at several terminal sizes', async () => {
    const { app, spend } = await world();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    for (const columns of sizes) {
      for (const report of [weekReport(app), monthReport(app), weekReport(app, '2026-08-03', '2026-08-09')]) {
        const widths = new Set(lines(renderReport(plain(), report, { columns })).map(stringWidth));
        assert.equal(widths.size, 1, `at ${columns} columns: ${[...widths]}`);
      }
    }
  });
  it('never exceeds the terminal width', async () => {
    const { app, spend } = await world();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    for (const columns of [60, 64, 80, 100]) {
      for (const report of [weekReport(app), monthReport(app)]) {
        assert.ok(Math.max(...lines(renderReport(plain(), report, { columns })).map(stringWidth)) <= columns, `${columns}`);
      }
    }
  });
  it('is plain ASCII without Unicode', async () => {
    const { app } = await world();
    const text = renderReport(plain(false), monthReport(app));
    for (const forbidden of ['╭', '│', '█', '░', '▲', '▼', '–', '·', '…', '▁']) assert.ok(!text.includes(forbidden), `found ${forbidden}`);
  });
  it('has no colour codes at level 0, and colour adds nothing but codes', async () => {
    const { app } = await world();
    const report = monthReport(app);
    const bare = renderReport(plain(), report);
    assert.ok(!bare.includes('\x1b'));
    assert.equal(stripAnsi(renderReport(createTheme({ env: {}, colorLevel: 3, unicode: true }), report)), bare);
  });
});

describe('renderReport: fitting the window', () => {
  const heightOf = (text) => text.split('\n').length;
  it('shows everything when there is room', async () => {
    const { app } = await world();
    const text = renderReport(plain(), monthReport(app), { maxRows: 200 });
    assert.ok(text.includes('Week by week') && text.includes('By category'));
  });
  it('drops the categories first, then the chart, and always keeps the summary', async () => {
    const { app } = await world();
    const report = monthReport(app);
    const full = renderReport(plain(), report);
    const noCategories = renderReport(plain(), report, { maxRows: heightOf(full) - 1 });
    assert.ok(noCategories.includes('Week by week') && !noCategories.includes('By category'));
    const summaryOnly = renderReport(plain(), report, { maxRows: 10 });
    assert.ok(summaryOnly.includes('This month') && !summaryOnly.includes('Week by week'));
    assert.ok(renderReport(plain(), report, { maxRows: 1 }).includes('This month'), 'the summary stays even if it cannot fit');
  });
  it('gets shorter as the window gets shorter, never taller', async () => {
    const { app } = await world();
    const heights = [200, 40, 30, 20, 5].map((maxRows) => heightOf(renderReport(plain(), monthReport(app), { maxRows })));
    assert.deepEqual([...heights].sort((a, b) => b - a), heights);
  });
  it('fits whenever fitting is possible', async () => {
    const { app } = await world();
    const summaryHeight = heightOf(renderReport(plain(), monthReport(app), { maxRows: 1 }));
    for (const maxRows of [summaryHeight, summaryHeight + 3, 60]) {
      assert.ok(heightOf(renderReport(plain(), monthReport(app), { maxRows })) <= maxRows, `maxRows ${maxRows}`);
    }
  });
});

describe('renderTrends', () => {
  const trendOf = (app, options) => app.analytics.trend({ unit: 'week', count: 4, ...options });
  it('draws a bar per week, marks the unfinished one, and summarises', async () => {
    const { app } = await world();
    const text = renderTrends(plain(), trendOf(app));
    assert.match(text, /Trend · weekly · INR/);
    assert.match(text, /9–15 Nov\s+█+░*\s+₹360\.00 so far/);
    assert.match(text, /2–8 Nov\s+█+\s+₹1,250\.00/);
    assert.match(text, /Highest week\s+2–8 Nov\s+₹1,250\.00/);
    assert.match(text, /Trend\s+[▁-█]{4}/);
  });
  it('averages only finished weeks (the current one is still filling up)', async () => {
    const { app } = await world();
    // finished weeks: 19-25 Oct (0), 26 Oct-1 Nov (0), 2-8 Nov (1250) -> 1250 / 3
    assert.match(renderTrends(plain(), trendOf(app)), /Average\/week\s+₹416\.67 \(3 finished weeks\)/);
  });
  it('works for months', async () => {
    const { app } = await world();
    const text = renderTrends(plain(), app.analytics.trend({ unit: 'month', count: 3 }));
    assert.match(text, /Trend · monthly · INR/);
    assert.match(text, /Nov 2026\s+█+.*so far/);
    assert.match(text, /Highest month/);
  });
  it('names the category when filtered', async () => {
    const { app } = await world();
    const category = app.categories.find('Transport').category;
    assert.match(renderTrends(plain(), trendOf(app, { categoryId: category.id }), { category }), /Trend · weekly · INR · Transport/);
  });
  it('says so when there is nothing to show', async () => {
    const { app } = await makeWorld();
    assert.match(renderTrends(plain(), trendOf(app)), /Nothing spent in INR over the last 4 weeks/);
  });
  it('points at other currencies', async () => {
    const { app, spend } = await world();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    assert.match(lines(renderTrends(plain(), trendOf(app))).join(' '), /pocketpulse trends --currency USD/);
  });
  it('keeps one width, never exceeds the terminal, and is ASCII-safe', async () => {
    const { app } = await world();
    for (const columns of [60, 80, 100]) {
      const rendered = lines(renderTrends(plain(), trendOf(app), { columns }));
      assert.equal(new Set(rendered.map(stringWidth)).size, 1);
      assert.ok(Math.max(...rendered.map(stringWidth)) <= columns);
    }
    const ascii = renderTrends(plain(false), trendOf(app));
    for (const forbidden of ['╭', '█', '░', '–', '▁']) assert.ok(!ascii.includes(forbidden), forbidden);
  });
});
