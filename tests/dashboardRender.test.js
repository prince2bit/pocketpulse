import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard, renderToday } from '../src/ui/dashboard.js';
import { createTheme, stripAnsi } from '../src/ui/theme.js';
import { stringWidth } from '../src/ui/text.js';
import { makeApp } from './helpers.js';

const plainTheme = (unicode = true) => createTheme({ env: {}, colorLevel: 0, unicode });

// A realistic month of spending, "now" = Thu 12 Nov 2026 noon UTC.
async function populated({ extra } = {}) {
  const { app, clock } = await makeApp({ now: '2026-11-12T12:00:00Z' });
  const spend = (when, description, amount, currency) => {
    clock.current = new Date(when);
    app.expenses.save(app.expenses.validate({ description, amount, currency }).draft);
  };
  spend('2026-11-02T05:00:00Z', 'rent', '5000');
  spend('2026-11-03T06:00:00Z', 'recharge', '299');
  spend('2026-11-04T06:00:00Z', 'notebook', '65');
  spend('2026-11-05T06:00:00Z', 'movie', '180');
  spend('2026-11-06T06:00:00Z', 'shampoo', '120');
  spend('2026-11-09T06:00:00Z', 'bus', '30');
  spend('2026-11-12T03:00:00Z', 'chai', '15');
  spend('2026-11-12T04:30:00Z', 'a very long description that must be shortened to fit nicely', '40');
  extra?.(spend);
  clock.current = new Date('2026-11-12T12:00:00Z');
  return app;
}
const lines = (text) => stripAnsi(text).split('\n');

describe('renderDashboard: content', () => {
  it('shows totals, the category breakdown, highlights and recent activity from real data', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    for (const expected of ['Your spending', 'TODAY', 'THIS WEEK', 'THIS MONTH', '₹55.00', '₹85.00', '₹5,749.00',
      'Last 7 days', 'Biggest', 'rent ₹5,000.00', 'Most used', 'Where it went · November · INR',
      '📱 Bills & Recharge', 'Recent activity', 'chai']) {
      assert.ok(text.includes(expected), `missing "${expected}"`);
    }
  });
  it('counts expenses per period', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    assert.match(text, /2 expenses\s+3 expenses\s+8 expenses/); // today, this week, this month
  });
  it('says "1 expense", not "1 expenses"', async () => {
    const { app } = await makeApp();
    app.expenses.save(app.expenses.validate({ description: 'chips', amount: '20' }).draft);
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    assert.match(text, /1 expense\b(?!s)/);
  });
  it('shortens long descriptions with an ellipsis', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    assert.ok(text.includes('…'));
    assert.ok(!text.includes('must be shortened'));
  });
  it('labels recent items Today / Yesterday / a date, with times only for the first two', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    assert.match(text, /chai.*Today 3:00 am/); // saved at 03:00 UTC, and this test world runs in UTC
  });
  it('says <1% for a tiny share', async () => {
    const { app } = await makeApp();
    for (const [name, amount] of [['rent', '10000'], ['chips', '1']]) app.expenses.save(app.expenses.validate({ description: name, amount }).draft);
    assert.ok(renderDashboard(plainTheme(), app.analytics.dashboard()).includes('<1%'));
  });
  it('folds categories beyond the first five into "…and N more"', async () => {
    const app = await populated({ extra: (spend) => { spend('2026-11-07T06:00:00Z', 'doctor', '10'); spend('2026-11-07T07:00:00Z', 'pizza', '10'); spend('2026-11-07T08:00:00Z', 'zzz unknown thing', '10'); } });
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    assert.match(text, /…and \d+ more categor(y|ies)/);
    assert.ok(text.includes('…and 3 more categories') || text.includes('…and 2 more categories'));
  });
  it('uses singular "category" when exactly one is folded away', async () => {
    const { app } = await makeApp();
    for (const name of ['rent', 'bus', 'chai', 'movie', 'shampoo', 'doctor']) app.expenses.save(app.expenses.validate({ description: name, amount: '10' }).draft);
    assert.match(renderDashboard(plainTheme(), app.analytics.dashboard()), /…and 1 more category\b(?!ies)/);
  });
});

/** Just the first panel (the one with TODAY / THIS WEEK / THIS MONTH). */
const overviewOf = (text) => stripAnsi(text).split('\n╰')[0];

describe('renderDashboard: currencies', () => {
  it('stacks each currency on its own line in the summary tiles and never adds them', async () => {
    const { app } = await makeApp();
    app.expenses.save(app.expenses.validate({ description: 'chips', amount: '100' }).draft);
    app.expenses.save(app.expenses.validate({ description: 'coffee', amount: '10', currency: 'USD' }).draft);
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    const overview = overviewOf(text);
    // Look at the tiles themselves: both currencies must be there, not just in "Recent activity" below.
    assert.ok(overview.includes('₹100.00') && overview.includes('$10.00'), overview);
    assert.ok(!text.includes('110'), '₹100 + $10 must never appear as 110');
  });
  it('shows at most two currencies per tile, then "+N more" counting the hidden ones', async () => {
    const { app } = await makeApp();
    for (const currency of ['INR', 'USD', 'EUR', 'GBP']) app.expenses.save(app.expenses.validate({ description: 'x', amount: '5', currency }).draft);
    // Only the tiles (above "Last 7 days"): the "Biggest" line below may legitimately mention ₹5.00.
    const tiles = overviewOf(renderDashboard(plainTheme(), app.analytics.dashboard())).split('Last 7 days')[0];
    // Equal counts sort alphabetically: EUR, GBP, INR, USD. Two are shown, two are hidden.
    assert.ok(tiles.includes('€5.00') && tiles.includes('£5.00'), tiles);
    assert.ok(!tiles.includes('₹5.00') && !tiles.includes('$5.00'), 'the third and fourth are folded away');
    assert.match(tiles, /\+2 more/);
  });
  it('points at the other currencies and how to see them', async () => {
    const { app } = await makeApp();
    app.expenses.save(app.expenses.validate({ description: 'chips', amount: '100' }).draft);
    app.expenses.save(app.expenses.validate({ description: 'coffee', amount: '10', currency: 'USD' }).draft);
    const text = lines(renderDashboard(plainTheme(), app.analytics.dashboard())).join(' ');
    assert.match(text, /Also spent in USD\. See it with: pocketpulse dashboard --currency USD/);
  });
  it('builds the breakdown from the chosen currency', async () => {
    const { app } = await makeApp();
    app.expenses.save(app.expenses.validate({ description: 'chips', amount: '100' }).draft);
    app.expenses.save(app.expenses.validate({ description: 'coffee', amount: '10', currency: 'USD' }).draft);
    const text = renderDashboard(plainTheme(), app.analytics.dashboard({ currency: 'USD' }));
    assert.ok(text.includes('Where it went · November · USD'));
  });
});

describe('renderDashboard: layout', () => {
  it('draws every panel at one consistent width, at several terminal sizes', async () => {
    const app = await populated({ extra: (spend) => spend('2026-11-12T05:00:00Z', 'coffee', '5', 'USD') });
    for (const columns of [60, 70, 80, 100, 140]) {
      const widths = new Set(lines(renderDashboard(plainTheme(), app.analytics.dashboard(), { columns })).map(stringWidth));
      assert.equal(widths.size, 1, `at ${columns} columns the panels have widths ${[...widths]}`);
    }
  });
  it('never exceeds the terminal width (down to a reasonably narrow terminal)', async () => {
    const app = await populated({ extra: (spend) => spend('2026-11-12T05:00:00Z', 'coffee', '5', 'USD') });
    for (const columns of [60, 64, 80, 100]) {
      const widest = Math.max(...lines(renderDashboard(plainTheme(), app.analytics.dashboard(), { columns })).map(stringWidth));
      assert.ok(widest <= columns, `${widest} > ${columns}`);
    }
  });
  it('caps the width on very wide terminals, so it stays readable', async () => {
    const app = await populated();
    assert.ok(Math.max(...lines(renderDashboard(plainTheme(), app.analytics.dashboard(), { columns: 300 })).map(stringWidth)) <= 80);
  });
  it('switches to a stacked layout without bars on narrow terminals', async () => {
    const app = await populated();
    const narrow = renderDashboard(plainTheme(), app.analytics.dashboard(), { columns: 60 });
    assert.ok(!narrow.includes('░'), 'no category bars when narrow (░ is only used by the bars)');
    assert.match(narrow, /TODAY\s+₹55\.00/);
    assert.ok(renderDashboard(plainTheme(), app.analytics.dashboard(), { columns: 100 }).includes('░'));
  });
  it('uses plain ASCII borders and symbols without Unicode', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(false), app.analytics.dashboard());
    for (const forbidden of ['╭', '│', '─', '█', '░', '…', '·', '×', '▁']) assert.ok(!text.includes(forbidden), `found "${forbidden}" in ASCII mode`);
    assert.ok(text.includes('+-') && text.includes('#'));
  });
  it('contains no colour codes at colour level 0, and loses nothing when colour is stripped', async () => {
    const app = await populated();
    const data = app.analytics.dashboard();
    const bare = renderDashboard(plainTheme(), data);
    assert.ok(!bare.includes('\x1b'));
    assert.equal(stripAnsi(renderDashboard(createTheme({ env: {}, colorLevel: 3, unicode: true }), data)), bare);
  });
});

describe('renderDashboard: fitting the window', () => {
  it('shows everything when there is room', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard(), { maxRows: 100 });
    assert.ok(text.includes('Recent activity') && text.includes('Where it went'));
  });
  it('shrinks step by step to fit a shorter window, always keeping the overview', async () => {
    const app = await populated();
    const data = app.analytics.dashboard();
    const heights = [100, 28, 22, 14, 1].map((maxRows) => {
      const text = renderDashboard(plainTheme(), data, { maxRows });
      assert.ok(text.includes('Your spending'), `overview missing at maxRows=${maxRows}`);
      return text.split('\n').length;
    });
    assert.deepEqual([...heights].sort((a, b) => b - a), heights, 'smaller windows never give a taller dashboard');
    assert.ok(heights.at(-1) < heights[0]);
    assert.ok(!renderDashboard(plainTheme(), data, { maxRows: 1 }).includes('Recent activity'));
  });
  it('drops to just the summary tiles in a very short window (the classic 80x24)', async () => {
    const app = await populated();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard(), { maxRows: 6 });
    assert.ok(text.includes('THIS MONTH'));
    assert.ok(text.split('\n').length <= 6);
    assert.ok(!text.includes('Last 7 days') && !text.includes('Where it went'));
  });
  it('fits the rows it was given whenever that is possible', async () => {
    const app = await populated();
    const data = app.analytics.dashboard();
    for (const maxRows of [30, 24, 18, 9]) {
      const height = renderDashboard(plainTheme(), data, { maxRows }).split('\n').length;
      assert.ok(height <= maxRows, `${height} rows > ${maxRows}`);
    }
  });
});

describe('renderDashboard: empty database', () => {
  it('shows a friendly first-use panel with example commands, not a wall of zeros', async () => {
    const { app } = await makeApp();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard());
    assert.match(text, /No expenses yet/);
    assert.match(text, /pocketpulse add chips 20/);
    assert.ok(!text.includes('THIS WEEK'));
    assert.equal(new Set(lines(text).map(stringWidth)).size, 1);
  });
  it('wraps its message inside the panel on narrow terminals', async () => {
    const { app } = await makeApp();
    const text = renderDashboard(plainTheme(), app.analytics.dashboard(), { columns: 50 });
    assert.ok(Math.max(...lines(text).map(stringWidth)) <= 50);
  });
});

describe('renderToday', () => {
  it('shows the date, totals per currency, a breakdown, and every expense with its time', async () => {
    const app = await populated({ extra: (spend) => spend('2026-11-12T05:00:00Z', 'coffee', '5', 'USD') });
    const text = renderToday(plainTheme(), app.analytics.todayView());
    for (const expected of ['Today · Thursday 12 November', '₹55.00', '$5.00', 'By category · INR', 'Expenses', '3:00 am', 'chai', 'coffee']) {
      assert.ok(text.includes(expected), `missing "${expected}"`);
    }
    assert.ok(!text.includes('60.00'), 'rupees and dollars are not added');
  });
  it('lines the currency totals up in a column', async () => {
    const app = await populated({ extra: (spend) => spend('2026-11-12T05:00:00Z', 'coffee', '5', 'USD') });
    const rows = lines(renderToday(plainTheme(), app.analytics.todayView())).filter((line) => /\d expenses?/.test(line));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].indexOf('expense'), rows[1].indexOf('expense'), `not aligned:\n${rows.join('\n')}`);
  });
  it('says so when nothing was spent today', async () => {
    const { app } = await makeApp();
    const text = renderToday(plainTheme(), app.analytics.todayView());
    assert.match(text, /Nothing spent today yet/);
    assert.match(text, /pocketpulse add chips 20/);
  });
  it('never exceeds the terminal width, even with long descriptions', async () => {
    const app = await populated({ extra: (spend) => spend('2026-11-12T05:00:00Z', 'coffee', '5', 'USD') });
    for (const columns of [60, 64, 80]) {
      const widest = Math.max(...lines(renderToday(plainTheme(), app.analytics.todayView(), { columns })).map(stringWidth));
      assert.ok(widest <= columns, `${widest} > ${columns}`);
    }
  });
  it('draws panels at one width', async () => {
    const app = await populated();
    assert.equal(new Set(lines(renderToday(plainTheme(), app.analytics.todayView(), { columns: 80 })).map(stringWidth)).size, 1);
  });
});
