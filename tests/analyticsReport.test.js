import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';

// Thu 12 Nov 2026 is "now". Spending, by week:
//   last week (Mon 2 - Sun 8 Nov): Mon chips 100, Tue bus 50, Thu groceries 900, Sat movie 200  (= 1250)
//   this week (Mon 9 - Sun 15):    Mon chai 60, Wed rent 300                                      (=  360)
async function standard() {
  const world = await makeWorld();
  const { spend } = world;
  spend('2026-11-02T08:00:00Z', 'chips', '100');
  spend('2026-11-03T08:00:00Z', 'bus', '50');
  spend('2026-11-05T08:00:00Z', 'groceries', '900');
  spend('2026-11-07T08:00:00Z', 'movie', '200');
  spend('2026-11-09T08:00:00Z', 'chai', '60');
  spend('2026-11-11T08:00:00Z', 'rent', '300');
  return world;
}
const week = (app, from, to, extra) => app.analytics.report({ from, to, kind: 'week', ...extra });
const thisWeek = (app, extra) => week(app, '2026-11-09', '2026-11-15', extra);
const entry = (report, currency = 'INR') => report.summary.find((s) => s.currency === currency);

describe('report: totals and averages', () => {
  it('totals the period and counts expenses', async () => {
    const { app } = await standard();
    const r = thisWeek(app);
    assert.equal(entry(r).totalMinor, 36000);
    assert.equal(r.count, 2);
  });
  it('averages over the days SO FAR while a period is in progress', async () => {
    const { app } = await standard();
    const r = thisWeek(app); // Mon-Thu = 4 days elapsed
    assert.deepEqual([r.days, r.elapsedDays, r.inProgress], [7, 4, true]);
    assert.equal(entry(r).averageMinor, 9000); // 360 / 4, not 360 / 7
  });
  it('averages over the whole length once the period is finished', async () => {
    const { app } = await standard();
    const r = week(app, '2026-11-02', '2026-11-08');
    assert.deepEqual([r.elapsedDays, r.inProgress], [7, false]);
    assert.equal(entry(r).totalMinor, 125000);
    assert.equal(entry(r).averageMinor, Math.round(125000 / 7)); // 17857: a rounded whole number of paise
  });
  it('has no average for a period that has not started', async () => {
    const { app } = await standard();
    const r = week(app, '2026-11-16', '2026-11-22');
    assert.deepEqual([r.notStarted, r.elapsedDays, r.count, r.summary], [true, 0, 0, []]);
    assert.equal(r.comparison.available, false);
  });
  it('an empty period has no summary rows and no busiest day', async () => {
    const { app } = await standard();
    const r = week(app, '2026-08-03', '2026-08-09');
    assert.deepEqual([r.count, r.summary, r.busiestDay, r.largest, r.breakdown], [0, [], null, null, []]);
  });
});

describe('report: comparing with the previous period', () => {
  it('compares an unfinished week with the SAME DAYS of last week, not all of it', async () => {
    const { app } = await standard();
    const r = thisWeek(app);
    // Last week's first four days (Mon 2 - Thu 5): 100 + 50 + 900 = 1050. Not the whole week's 1250.
    assert.deepEqual([r.comparison.previousFrom, r.comparison.comparedTo, r.comparison.partial], ['2026-11-02', '2026-11-05', true]);
    assert.equal(entry(r).previousMinor, 105000);
    assert.equal(entry(r).changeMinor, 36000 - 105000);
    assert.ok(Math.abs(entry(r).changeFraction - (-69000 / 105000)) < 1e-12);
  });
  it('compares a finished week with all of the week before it', async () => {
    const { app } = await standard();
    const r = week(app, '2026-11-02', '2026-11-08');
    assert.deepEqual([r.comparison.previousFrom, r.comparison.comparedTo, r.comparison.partial], ['2026-10-26', '2026-11-01', false]);
  });
  it('says there is nothing to compare with (null) instead of dividing by zero', async () => {
    const { app } = await standard();
    const r = week(app, '2026-11-02', '2026-11-08'); // the week before had no spending
    assert.deepEqual([entry(r).previousMinor, entry(r).changeFraction], [0, null]);
  });
  it('compares an unfinished month with the same days of the previous month', async () => {
    const { app, spend } = await standard();
    spend('2026-10-03T08:00:00Z', 'rent', '5000');
    spend('2026-10-20T08:00:00Z', 'late october', '700'); // after the 12th: must NOT be counted
    const r = app.analytics.report({ from: '2026-11-01', to: '2026-11-30', kind: 'month' });
    assert.deepEqual([r.comparison.previousFrom, r.comparison.comparedTo], ['2026-10-01', '2026-10-12']);
    assert.equal(entry(r).previousMinor, 500000);
  });
  it('compares a finished month with the whole previous month', async () => {
    const { app, spend } = await standard();
    spend('2026-10-03T08:00:00Z', 'rent', '5000');
    spend('2026-10-20T08:00:00Z', 'late october', '700');
    const r = app.analytics.report({ from: '2026-10-01', to: '2026-10-31', kind: 'month' });
    assert.deepEqual([r.inProgress, r.comparison.previousFrom, r.comparison.comparedTo], [false, '2026-09-01', '2026-09-30']);
    assert.equal(entry(r).totalMinor, 570000);
  });
  it('finds the previous month across a year boundary', async () => {
    const { app } = await makeWorld({ now: '2027-01-05T10:00:00Z' });
    const r = app.analytics.report({ from: '2027-01-01', to: '2027-01-31', kind: 'month' });
    assert.deepEqual([r.comparison.previousFrom, r.comparison.comparedTo], ['2026-12-01', '2026-12-05']);
  });
  it('clamps to the shorter previous month (day 31 vs February)', async () => {
    const { app } = await makeWorld({ now: '2026-03-31T10:00:00Z' });
    const r = app.analytics.report({ from: '2026-03-01', to: '2026-03-31', kind: 'month' });
    assert.equal(r.comparison.comparedTo, '2026-02-28');
  });
  it('compares a custom range with the same number of days directly before it', async () => {
    const { app } = await standard();
    const r = app.analytics.report({ from: '2026-11-03', to: '2026-11-07', kind: 'range' }); // 5 days, finished
    assert.deepEqual([r.comparison.previousFrom, r.comparison.comparedTo], ['2026-10-29', '2026-11-02']);
    assert.equal(entry(r).previousMinor, 10000); // chips on Mon 2 Nov
  });
  it('compares each currency on its own', async () => {
    const { app, spend } = await standard();
    spend('2026-11-03T08:00:00Z', 'coffee', '10', 'USD');
    spend('2026-11-10T08:00:00Z', 'coffee', '25', 'USD');
    const r = thisWeek(app);
    assert.deepEqual([entry(r, 'USD').totalMinor, entry(r, 'USD').previousMinor], [2500, 1000]);
    assert.equal(entry(r, 'USD').changeFraction, 1.5);
    assert.ok(entry(r, 'INR').changeFraction < 0, 'rupees are compared with rupees');
  });
  it('lists a currency that was only used in the previous period, with a zero total', async () => {
    const { app, spend } = await standard();
    spend('2026-11-03T08:00:00Z', 'coffee', '10', 'USD');
    const r = thisWeek(app);
    assert.deepEqual([entry(r, 'USD').totalMinor, entry(r, 'USD').previousMinor, entry(r, 'USD').changeFraction], [0, 1000, -1]);
  });
});

describe('report: busiest day and daily series', () => {
  it('lists every day, oldest first, quiet days as zero', async () => {
    const { app } = await standard();
    const r = thisWeek(app);
    assert.deepEqual(r.daily.map((d) => d.date), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    assert.deepEqual(r.daily.map((d) => d.totalMinor), [6000, 0, 30000, 0, 0, 0, 0]);
  });
  it('finds the busiest day', async () => {
    const { app } = await standard();
    assert.deepEqual([thisWeek(app).busiestDay.date, thisWeek(app).busiestDay.totalMinor], ['2026-11-11', 30000]);
  });
  it('breaks a tie in favour of the earlier day', async () => {
    const { app, spend } = await makeWorld();
    spend('2026-11-10T08:00:00Z', 'a', '100');
    spend('2026-11-11T08:00:00Z', 'b', '100');
    assert.equal(thisWeek(app).busiestDay.date, '2026-11-10');
  });
  it('adds up several expenses on one day', async () => {
    const { app, spend } = await makeWorld();
    spend('2026-11-10T08:00:00Z', 'a', '10');
    spend('2026-11-10T09:00:00Z', 'b', '20.50');
    assert.equal(thisWeek(app).daily[1].totalMinor, 3050);
  });
  it('files a late-night purchase under the day it happened locally', async () => {
    const { app, spend } = await makeWorld({ now: '2026-11-13T07:50:00Z', zone: 'America/Los_Angeles' });
    spend('2026-11-13T07:45:00Z', 'late bus', '30'); // 11:45 PM Thu 12 Nov in LA
    const r = thisWeek(app);
    assert.equal(r.daily.find((d) => d.date === '2026-11-12').totalMinor, 3000);
    assert.equal(r.daily.find((d) => d.date === '2026-11-13').totalMinor, 0);
  });
});

describe('report: bars (day or week buckets)', () => {
  it('uses one bucket per day for a week', async () => {
    const { app } = await standard();
    const r = thisWeek(app);
    assert.equal(r.bucketUnit, 'day');
    assert.equal(r.buckets.length, 7);
  });
  it('uses one bucket per Monday-to-Sunday week for a month, clipped to the month', async () => {
    const { app } = await standard();
    const r = app.analytics.report({ from: '2026-11-01', to: '2026-11-30', kind: 'month' });
    assert.equal(r.bucketUnit, 'week');
    assert.deepEqual(r.buckets.map((b) => [b.from, b.to]), [
      ['2026-11-01', '2026-11-01'], ['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-15'],
      ['2026-11-16', '2026-11-22'], ['2026-11-23', '2026-11-29'], ['2026-11-30', '2026-11-30']]);
    assert.deepEqual(r.buckets.map((b) => b.totalMinor), [0, 125000, 36000, 0, 0, 0]);
  });
  it('always adds up to the total, whatever the range', async () => {
    const { app } = await standard();
    for (const [from, to, kind] of [['2026-11-01', '2026-11-30', 'month'], ['2026-10-20', '2026-11-20', 'range'], ['2026-11-03', '2026-11-09', 'range'], ['2026-11-09', '2026-11-15', 'week']]) {
      const r = app.analytics.report({ from, to, kind });
      const sum = r.buckets.reduce((s, b) => s + b.totalMinor, 0);
      assert.equal(sum, entry(r)?.totalMinor ?? 0, `${from}..${to}`);
    }
  });
  it('switches from day buckets to week buckets for custom ranges longer than 14 days', async () => {
    const { app } = await standard();
    assert.equal(app.analytics.report({ from: '2026-11-01', to: '2026-11-14', kind: 'range' }).bucketUnit, 'day');
    assert.equal(app.analytics.report({ from: '2026-11-01', to: '2026-11-15', kind: 'range' }).bucketUnit, 'week');
  });
  it('handles a one-day range', async () => {
    const { app } = await standard();
    const r = app.analytics.report({ from: '2026-11-09', to: '2026-11-09', kind: 'range' });
    assert.deepEqual([r.days, r.buckets.length, entry(r).totalMinor], [1, 1, 6000]);
  });
});

describe('report: breakdown, biggest, categories', () => {
  it('breaks the period down by category with shares', async () => {
    const { app } = await standard();
    const r = thisWeek(app);
    assert.deepEqual(r.breakdown.map((b) => [b.category.name, b.totalMinor]), [['Bills & Recharge', 30000], ['Food & Drinks', 6000]]);
    assert.ok(Math.abs(r.breakdown.reduce((s, b) => s + b.share, 0) - 1) < 1e-12);
  });
  it('finds the biggest expense', async () => {
    const { app } = await standard();
    assert.equal(thisWeek(app).largest.description, 'rent');
    assert.equal(week(app, '2026-11-02', '2026-11-08').largest.description, 'groceries');
  });
  it('can look at just one category: totals, days, biggest and count all narrow down', async () => {
    const { app } = await standard();
    const transport = app.categories.find('Transport').category;
    const r = week(app, '2026-11-02', '2026-11-08', { categoryId: transport.id });
    assert.deepEqual([entry(r).totalMinor, r.count, r.largest.description, r.categoryId], [5000, 1, 'bus', transport.id]);
    assert.deepEqual(r.daily.filter((d) => d.totalMinor > 0).map((d) => d.date), ['2026-11-03']);
    assert.deepEqual(r.breakdown, [], 'a one-category view has no category breakdown');
  });
  it('compares like with like when filtered by category', async () => {
    const { app, spend } = await standard();
    spend('2026-11-04T08:00:00Z', 'bus', '40'); // last week, Wed
    spend('2026-11-10T08:00:00Z', 'bus', '30'); // this week, Tue
    const transport = app.categories.find('Transport').category;
    const r = thisWeek(app, { categoryId: transport.id });
    assert.deepEqual([entry(r).totalMinor, entry(r).previousMinor], [3000, 9000]); // bus 50 + 40 in Mon-Thu last week
  });
  it('an unused category gives an empty report', async () => {
    const { app } = await standard();
    const health = app.categories.find('Health').category;
    assert.equal(thisWeek(app, { categoryId: health.id }).count, 0);
  });
});

describe('report: currencies', () => {
  it('keeps currencies separate and sorted by how often you used them', async () => {
    const { app, spend } = await standard();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    const r = thisWeek(app);
    assert.deepEqual(r.summary.map((s) => [s.currency, s.totalMinor, s.count]), [['INR', 36000, 2], ['USD', 1000, 1]]);
    assert.equal(r.count, 3);
  });
  it('uses your main currency for bars and breakdown, and lists the others', async () => {
    const { app, spend } = await standard();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    const r = thisWeek(app);
    assert.deepEqual([r.primaryCurrency, r.otherCurrencies], ['INR', ['USD']]);
    assert.equal(r.buckets.reduce((s, b) => s + b.totalMinor, 0), 36000, 'dollars are not in the rupee bars');
  });
  it('lets you choose the currency', async () => {
    const { app, spend } = await standard();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    const r = thisWeek(app, { currency: 'USD' });
    assert.deepEqual([r.primaryCurrency, r.otherCurrencies, r.buckets.reduce((s, b) => s + b.totalMinor, 0)], ['USD', ['INR'], 1000]);
    assert.equal(r.largest.description, 'coffee');
  });
});

describe('trend', () => {
  it('lists weeks oldest first, ending with the current unfinished week', async () => {
    const { app } = await standard();
    const t = app.analytics.trend({ unit: 'week', count: 4 });
    assert.deepEqual(t.periods.map((p) => p.from), ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    assert.deepEqual(t.periods.map((p) => p.to), ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15']);
    assert.deepEqual(t.periods.map((p) => p.inProgress), [false, false, false, true]);
    assert.deepEqual(t.periods.map((p) => p.primaryMinor), [0, 0, 125000, 36000]);
  });
  it('lists months, crossing the year boundary', async () => {
    const { app, spend } = await makeWorld({ now: '2027-01-15T10:00:00Z' });
    spend('2026-12-20T08:00:00Z', 'gift', '500');
    spend('2027-01-02T08:00:00Z', 'chai', '10');
    const t = app.analytics.trend({ unit: 'month', count: 3 });
    assert.deepEqual(t.periods.map((p) => p.from), ['2026-11-01', '2026-12-01', '2027-01-01']);
    assert.deepEqual(t.periods.map((p) => [p.to, p.primaryMinor]), [['2026-11-30', 0], ['2026-12-31', 50000], ['2027-01-31', 1000]]);
  });
  it('can follow a single category', async () => {
    const { app } = await standard();
    const transport = app.categories.find('Transport').category;
    const t = app.analytics.trend({ unit: 'week', count: 2, categoryId: transport.id });
    assert.deepEqual(t.periods.map((p) => p.primaryMinor), [5000, 0]);
  });
  it('keeps currencies apart and picks a primary one', async () => {
    const { app, spend } = await standard();
    spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    const t = app.analytics.trend({ unit: 'week', count: 2 });
    assert.deepEqual([t.primaryCurrency, t.otherCurrencies], ['INR', ['USD']]);
    assert.equal(app.analytics.trend({ unit: 'week', count: 2, currency: 'USD' }).periods.at(-1).primaryMinor, 1000);
  });
  it('is all zeros on an empty database, not an error', async () => {
    const { app } = await makeWorld();
    assert.ok(app.analytics.trend({ unit: 'week', count: 3 }).periods.every((p) => p.primaryMinor === 0));
  });
});
