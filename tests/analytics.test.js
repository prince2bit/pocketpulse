import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

// Build an app where "now" is controllable and add expenses at chosen moments.
async function world({ now = '2026-11-12T12:00:00Z', zone = 'UTC' } = {}) {
  const { app, clock } = await makeApp({ now, zone });
  const spend = (when, description, amount, currency) => {
    const saved = clock.current;
    clock.current = new Date(when);
    app.expenses.save(app.expenses.validate({ description, amount, currency }).draft);
    clock.current = saved;
  };
  return { app, clock, spend, view: (options) => app.analytics.dashboard(options) };
}
const totalsOf = (period) => Object.fromEntries(period.totals.map((t) => [t.currency, t.totalMinor]));

describe('periods: today, this week, this month', () => {
  it('counts each expense in exactly the periods it belongs to', async () => {
    const { spend, view } = await world(); // Thu 12 Nov 2026
    spend('2026-11-12T08:00:00Z', 'today', '10');
    spend('2026-11-09T08:00:00Z', 'monday', '100'); // this week, not today
    spend('2026-11-02T08:00:00Z', 'early month', '1000'); // this month, not this week
    spend('2026-10-31T08:00:00Z', 'last month', '10000'); // none of them
    const d = view();
    assert.deepEqual([totalsOf(d.periods.today), d.periods.today.count], [{ INR: 1000 }, 1]);
    assert.deepEqual([totalsOf(d.periods.week), d.periods.week.count], [{ INR: 11000 }, 2]);
    assert.deepEqual([totalsOf(d.periods.month), d.periods.month.count], [{ INR: 111000 }, 3]);
  });
  it('reports the date ranges used', async () => {
    const { view } = await world();
    const d = view();
    assert.equal(d.today, '2026-11-12');
    assert.deepEqual([d.periods.week.from, d.periods.week.to], ['2026-11-09', '2026-11-15']);
    assert.deepEqual([d.periods.month.from, d.periods.month.to], ['2026-11-01', '2026-11-30']);
  });
  it('treats the week as Monday to Sunday: Sunday belongs to the week before, Monday starts a new one', async () => {
    const { spend, clock, view } = await world({ now: '2026-11-15T12:00:00Z' }); // a Sunday
    spend('2026-11-09T09:00:00Z', 'monday', '1');
    spend('2026-11-08T09:00:00Z', 'previous sunday', '50');
    assert.deepEqual(totalsOf(view().periods.week), { INR: 100 }, 'the previous Sunday is not in this week');
    clock.current = new Date('2026-11-16T12:00:00Z'); // the next Monday
    assert.deepEqual(view().periods.week.totals, [], 'a new week starts empty');
  });
  it('handles the first and last day of a month', async () => {
    const { spend, clock, view } = await world({ now: '2026-11-30T12:00:00Z' });
    spend('2026-11-01T01:00:00Z', 'first', '1');
    spend('2026-11-30T23:00:00Z', 'last', '2');
    spend('2026-12-01T01:00:00Z', 'next month', '4');
    assert.equal(view().periods.month.count, 2);
    clock.current = new Date('2026-12-01T12:00:00Z');
    assert.deepEqual(totalsOf(view().periods.month), { INR: 400 });
  });
  it('lets a week span two months, and two years', async () => {
    const { spend, view } = await world({ now: '2026-12-30T12:00:00Z' }); // week: Mon 28 Dec to Sun 3 Jan
    spend('2026-12-28T09:00:00Z', 'mon', '1');
    spend('2027-01-02T09:00:00Z', 'next year', '2'); // in the future relative to "now", but within this week's range
    const d = view();
    assert.deepEqual([d.periods.week.from, d.periods.week.to], ['2026-12-28', '2027-01-03']);
    assert.equal(d.periods.week.count, 2);
    assert.equal(d.periods.month.count, 1, 'the January expense is not in December');
  });
  it('is empty, not broken, on a new database', async () => {
    const { view } = await world();
    const d = view();
    assert.equal(d.hasExpenses, false);
    assert.deepEqual(d.periods.today.totals, []);
    assert.deepEqual([d.breakdown, d.largest, d.mostUsedCategory, d.recent], [[], null, null, []]);
    assert.deepEqual(d.last7.map((day) => day.totalMinor), [0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('time zones decide which day an expense belongs to', () => {
  it('an 11:45 PM purchase in Los Angeles is "today" there, even though UTC says tomorrow', async () => {
    const { spend, view } = await world({ now: '2026-11-13T07:50:00Z', zone: 'America/Los_Angeles' });
    spend('2026-11-13T07:45:00Z', 'late bus', '30'); // 11:45 PM on Thu 12 Nov in LA
    const d = view();
    assert.equal(d.today, '2026-11-12');
    assert.equal(d.periods.today.count, 1);
  });
  it('the same instant is a different day in Kolkata', async () => {
    const { spend, view } = await world({ now: '2026-11-13T07:50:00Z', zone: 'Asia/Kolkata' });
    spend('2026-11-13T07:45:00Z', 'morning chai', '15'); // 1:15 PM on Fri 13 Nov in India
    const d = view();
    assert.equal(d.today, '2026-11-13');
    assert.equal(d.periods.today.count, 1);
  });
  it('old expenses keep the day they were saved on when you change the time zone setting', async () => {
    const { app, spend, view } = await world({ now: '2026-11-12T12:00:00Z', zone: 'UTC' });
    spend('2026-11-12T08:00:00Z', 'chips', '20');
    app.settings.setTimeZone('Asia/Tokyo'); // 9 hours ahead; "today" is still 12 Nov at noon UTC (9 pm Tokyo)
    assert.equal(view().periods.today.count, 1);
    assert.equal(app.expenses.listRecent(1)[0].timeZone, 'UTC');
  });
});

describe('currencies are never combined', () => {
  it('keeps rupees and dollars as separate totals', async () => {
    const { spend, view } = await world();
    spend('2026-11-12T08:00:00Z', 'chips', '100');
    spend('2026-11-12T09:00:00Z', 'coffee', '10', 'USD');
    const d = view();
    assert.deepEqual(totalsOf(d.periods.today), { INR: 10000, USD: 1000 });
    assert.ok(!d.periods.today.totals.some((t) => t.totalMinor === 11000), '100 + 10 must never become 110');
    assert.equal(d.periods.today.count, 2); // the COUNT is currency-free
  });
  it('orders currencies by how many expenses you made in them', async () => {
    const { spend, view } = await world();
    spend('2026-11-12T08:00:00Z', 'a', '1', 'USD');
    spend('2026-11-12T09:00:00Z', 'b', '1', 'EUR');
    spend('2026-11-12T10:00:00Z', 'c', '1', 'EUR');
    assert.deepEqual(view().periods.today.totals.map((t) => t.currency), ['EUR', 'USD']);
  });
  it('picks your default currency as the primary one when you have spent in it', async () => {
    const { spend, view } = await world();
    spend('2026-11-12T08:00:00Z', 'a', '1', 'USD');
    spend('2026-11-12T09:00:00Z', 'b', '1', 'USD');
    spend('2026-11-12T10:00:00Z', 'c', '5'); // INR (the default), used less often
    const d = view();
    assert.equal(d.primaryCurrency, 'INR');
    assert.deepEqual(d.otherCurrencies, ['USD']);
  });
  it('falls back to the most-used currency when you have not spent in your default', async () => {
    const { spend, view } = await world();
    spend('2026-11-12T08:00:00Z', 'a', '1', 'EUR');
    spend('2026-11-12T09:00:00Z', 'b', '1', 'EUR');
    spend('2026-11-12T10:00:00Z', 'c', '1', 'USD');
    const d = view();
    assert.equal(d.primaryCurrency, 'EUR');
    assert.deepEqual(d.otherCurrencies, ['USD']);
  });
  it('shows the default currency when there is nothing at all', async () => {
    const { app, view } = await world();
    app.settings.setDefaultCurrency('GBP');
    assert.equal(view().primaryCurrency, 'GBP');
  });
  it('lets the caller choose the currency to look at', async () => {
    const { spend, view } = await world();
    spend('2026-11-12T08:00:00Z', 'chips', '100');
    spend('2026-11-12T09:00:00Z', 'coffee', '10', 'USD');
    const d = view({ currency: 'USD' });
    assert.equal(d.primaryCurrency, 'USD');
    assert.deepEqual(d.breakdown.map((row) => row.totalMinor), [1000]);
    assert.deepEqual(d.otherCurrencies, ['INR']);
    assert.equal(d.largest.description, 'coffee');
  });
  it('shows an empty breakdown for a currency you have not used, instead of failing', async () => {
    const { spend, view } = await world();
    spend('2026-11-12T08:00:00Z', 'chips', '100');
    const d = view({ currency: 'JPY' });
    assert.deepEqual([d.primaryCurrency, d.breakdown, d.largest], ['JPY', [], null]);
  });
});

describe('category breakdown', () => {
  it('adds up per category, biggest first, with shares that add to 100%', async () => {
    const { spend, view } = await world();
    spend('2026-11-02T08:00:00Z', 'rent', '600');
    spend('2026-11-03T08:00:00Z', 'chips', '100');
    spend('2026-11-04T08:00:00Z', 'kurkure', '100'); // also Food & Snacks
    spend('2026-11-05T08:00:00Z', 'bus', '200');
    const rows = view().breakdown;
    // Transport and Food & Snacks tie on money (200 each), so the one with MORE expenses goes first.
    assert.deepEqual(rows.map((r) => [r.category.name, r.totalMinor, r.count]), [
      ['Bills & Recharge', 60000, 1], ['Food & Snacks', 20000, 2], ['Transport', 20000, 1]]);
    assert.ok(Math.abs(rows.reduce((sum, r) => sum + r.share, 0) - 1) < 1e-9);
    assert.equal(rows[0].share, 0.6);
  });
  it('only includes the current month and the chosen currency', async () => {
    const { spend, view } = await world();
    spend('2026-11-02T08:00:00Z', 'chips', '10');
    spend('2026-10-20T08:00:00Z', 'rent', '9999');
    spend('2026-11-02T09:00:00Z', 'coffee', '5', 'USD');
    assert.deepEqual(view().breakdown.map((r) => r.totalMinor), [1000]);
  });
  it('adds up exactly, with no floating-point drift', async () => {
    const floatSum = Array.from({ length: 10 }, () => 0.1).reduce((sum, x) => sum + x, 0);
    assert.notEqual(floatSum, 1, 'the trap: ten times 0.1 is 0.9999999999999999 as JavaScript decimals');

    const { spend, view } = await world();
    for (let i = 0; i < 10; i += 1) spend(`2026-11-0${(i % 9) + 1}T08:00:00Z`, `bus ${i}`, '0.10');
    assert.equal(view().periods.month.totals[0].totalMinor, 100); // exactly Rs 1.00, as whole paise
  });
});

describe('highlights', () => {
  it('finds the biggest expense of the month in the primary currency', async () => {
    const { spend, view } = await world();
    spend('2026-11-02T08:00:00Z', 'rent', '5000');
    spend('2026-11-03T08:00:00Z', 'concert', '9000', 'USD'); // bigger number, other currency: must not win
    spend('2026-10-03T08:00:00Z', 'old', '99999'); // last month: must not win
    assert.equal(view().largest.description, 'rent');
  });
  it('breaks a tie in favour of the more recent expense', async () => {
    const { spend, view } = await world();
    spend('2026-11-02T08:00:00Z', 'older', '100');
    spend('2026-11-03T08:00:00Z', 'newer', '100');
    assert.equal(view().largest.description, 'newer');
  });
  it('finds the most-used category by number of expenses, not by money', async () => {
    const { spend, view } = await world();
    spend('2026-11-02T08:00:00Z', 'rent', '9000');
    spend('2026-11-03T08:00:00Z', 'chai', '10');
    spend('2026-11-04T08:00:00Z', 'coffee', '10');
    const top = view().mostUsedCategory;
    assert.deepEqual([top.category.name, top.count], ['Food & Drinks', 2]);
  });
  it('lists the five most recent expenses, newest first', async () => {
    const { spend, view } = await world();
    for (let day = 1; day <= 7; day += 1) spend(`2026-11-0${day}T08:00:00Z`, `item ${day}`, '1');
    assert.deepEqual(view().recent.map((e) => e.description), ['item 7', 'item 6', 'item 5', 'item 4', 'item 3']);
  });
});

describe('the last seven days', () => {
  it('lists seven days, oldest first, filling quiet days with zero', async () => {
    const { spend, view } = await world(); // Thu 12 Nov
    spend('2026-11-12T08:00:00Z', 'today', '40');
    spend('2026-11-12T09:00:00Z', 'today again', '10');
    spend('2026-11-09T08:00:00Z', 'monday', '20');
    spend('2026-11-05T08:00:00Z', 'too old', '99'); // 7 days ago: outside the window
    const days = view().last7;
    assert.deepEqual(days.map((d) => d.date), ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
    assert.deepEqual(days.map((d) => d.totalMinor), [0, 0, 0, 2000, 0, 0, 5000]);
  });
  it('crosses a month boundary', async () => {
    const { spend, view } = await world({ now: '2026-12-02T12:00:00Z' });
    spend('2026-11-30T08:00:00Z', 'last of nov', '5');
    assert.deepEqual(view().last7.map((d) => d.date).slice(0, 3), ['2026-11-26', '2026-11-27', '2026-11-28']);
    assert.equal(view().last7[4].totalMinor, 500); // 30 Nov
  });
});

describe('todayView', () => {
  it('lists today\'s expenses newest first, with totals and a breakdown', async () => {
    const { spend, app } = await world();
    spend('2026-11-12T06:00:00Z', 'chai', '15');
    spend('2026-11-12T09:00:00Z', 'bus', '30');
    spend('2026-11-11T09:00:00Z', 'yesterday', '99');
    spend('2026-11-12T10:00:00Z', 'coffee', '5', 'USD');
    const v = app.analytics.todayView();
    assert.deepEqual(v.expenses.map((e) => e.description), ['coffee', 'bus', 'chai']);
    assert.deepEqual(totalsOf(v.period), { INR: 4500, USD: 500 });
    assert.deepEqual(v.breakdown.map((r) => r.category.name), ['Transport', 'Food & Drinks']);
    assert.deepEqual(v.otherCurrencies, ['USD']);
  });
  it('is empty when nothing was spent today', async () => {
    const { app, spend } = await world();
    spend('2026-11-11T09:00:00Z', 'yesterday', '99');
    const v = app.analytics.todayView();
    assert.deepEqual([v.expenses, v.period.totals], [[], []]);
  });
});
