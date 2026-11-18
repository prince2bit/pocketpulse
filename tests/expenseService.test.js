import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DESCRIPTION_LENGTH } from '../src/config/defaults.js';
import { makeApp } from './helpers.js';

const draftOf = (app, input) => {
  const result = app.expenses.validate(input);
  assert.ok(result.ok, `expected valid input, got ${JSON.stringify(result.errors)}`);
  return result.draft;
};

describe('creating an expense', () => {
  it('stores money as whole minor units, and defaults to INR', async () => {
    const { app } = await makeApp();
    const saved = app.expenses.save(draftOf(app, { description: 'chips', amount: '20.50' }));
    assert.equal(saved.amountMinor, 2050);
    assert.equal(saved.currency, 'INR');
    assert.ok(Number.isInteger(saved.amountMinor));
    assert.equal(saved.id, 1);
  });
  it('stamps the time from the clock: UTC instant, time zone, and local calendar day', async () => {
    const { app } = await makeApp({ now: '2026-11-13T07:45:00Z', zone: 'America/Los_Angeles' });
    const saved = app.expenses.save(draftOf(app, { description: 'late bus', amount: '30' }));
    assert.equal(saved.spentAtUtc, '2026-11-13T07:45:00.000Z');
    assert.equal(saved.timeZone, 'America/Los_Angeles');
    assert.equal(saved.localDate, '2026-11-12'); // 11:45 PM: still the 12th for the person who lived it
  });
  it('takes the time at SAVE, not when the draft was validated', async () => {
    const { app, clock } = await makeApp({ now: '2026-11-12T10:00:00Z' });
    const draft = draftOf(app, { description: 'tea', amount: '15' });
    clock.current = new Date('2026-11-12T10:05:00Z'); // the person took five minutes to confirm
    assert.equal(app.expenses.save(draft).spentAtUtc, '2026-11-12T10:05:00.000Z');
  });
  it('trims, collapses whitespace and replaces control characters in descriptions', async () => {
    const { app } = await makeApp();
    assert.equal(draftOf(app, { description: '  college   printout  ', amount: '10' }).description, 'college printout');
    assert.equal(draftOf(app, { description: 'a\tb\nc\u001b[31m', amount: '1' }).description, 'a b c [31m');
  });
});

describe('validation', () => {
  it('reports a missing or blank description', async () => {
    const { app } = await makeApp();
    for (const description of [undefined, '', '   ', '\n\t']) {
      assert.ok(app.expenses.validate({ description, amount: '20' }).errors.description);
    }
  });
  it('enforces the description length limit by characters, not bytes', async () => {
    const { app } = await makeApp();
    assert.ok(app.expenses.validate({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH), amount: '1' }).ok);
    assert.match(app.expenses.validate({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1), amount: '1' }).errors.description, /100 characters/);
    assert.ok(app.expenses.validate({ description: '🍟'.repeat(MAX_DESCRIPTION_LENGTH), amount: '1' }).ok); // 100 emoji = 100 characters
  });
  it('rejects bad amounts and unsupported currencies, naming every problem at once', async () => {
    const { app } = await makeApp();
    const result = app.expenses.validate({ description: '', amount: '-5', currency: 'xyz' });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.errors).sort(), ['amount', 'currency', 'description']);
  });
  it('applies each currency\'s own decimal rules', async () => {
    const { app } = await makeApp();
    assert.equal(draftOf(app, { description: 'ramen', amount: '800', currency: 'jpy' }).amountMinor, 800);
    assert.ok(app.expenses.validate({ description: 'ramen', amount: '8.5', currency: 'JPY' }).errors.amount);
  });
  it('never saves anything just because validation ran', async () => {
    const { app } = await makeApp();
    app.expenses.validate({ description: 'chips', amount: '20' });
    assert.equal(app.expenses.count(), 0);
  });
});

describe('currencies stay separate and unchanged', () => {
  it('keeps each expense\'s own currency when the default changes', async () => {
    const { app } = await makeApp();
    app.expenses.save(draftOf(app, { description: 'chips', amount: '20' })); // INR
    app.settings.setDefaultCurrency('USD');
    app.expenses.save(draftOf(app, { description: 'coffee', amount: '5' })); // now USD
    const [newest, oldest] = app.expenses.listRecent(5);
    assert.equal(newest.currency, 'USD');
    assert.equal(oldest.currency, 'INR');
    assert.equal(oldest.amountMinor, 2000); // untouched: not "reinterpreted" as dollars
  });
  it('keeps each expense\'s own time zone when the zone setting changes', async () => {
    const { app, clock } = await makeApp({ now: '2026-11-12T10:00:00Z', zone: 'UTC' });
    app.expenses.save(draftOf(app, { description: 'one', amount: '1' }));
    app.settings.setTimeZone('Asia/Tokyo');
    clock.current = new Date('2026-11-12T10:01:00Z');
    app.expenses.save(draftOf(app, { description: 'two', amount: '1' }));
    const [two, one] = app.expenses.listRecent(5);
    assert.equal(one.timeZone, 'UTC');
    assert.equal(two.timeZone, 'Asia/Tokyo');
  });
});

describe('duplicate detection', () => {
  const saveChips = (app) => app.expenses.save(draftOf(app, { description: 'Chips', amount: '20' }));
  it('spots the same expense entered again within two minutes, ignoring letter case', async () => {
    const { app, clock } = await makeApp();
    saveChips(app);
    clock.current = new Date(clock.current.getTime() + 60_000);
    assert.ok(app.expenses.findPossibleDuplicate(draftOf(app, { description: 'chips', amount: '20' })));
  });
  it('lets it through once enough time has passed', async () => {
    const { app, clock } = await makeApp();
    saveChips(app);
    clock.current = new Date(clock.current.getTime() + 3 * 60_000);
    assert.equal(app.expenses.findPossibleDuplicate(draftOf(app, { description: 'chips', amount: '20' })), null);
  });
  it('does not confuse different amounts, currencies or descriptions', async () => {
    const { app } = await makeApp();
    saveChips(app);
    assert.equal(app.expenses.findPossibleDuplicate(draftOf(app, { description: 'chips', amount: '25' })), null);
    assert.equal(app.expenses.findPossibleDuplicate(draftOf(app, { description: 'chips', amount: '20', currency: 'USD' })), null);
    assert.equal(app.expenses.findPossibleDuplicate(draftOf(app, { description: 'lays', amount: '20' })), null);
  });
});

describe('listing', () => {
  it('returns newest first and respects the limit', async () => {
    const { app, clock } = await makeApp({ now: '2026-11-12T10:00:00Z' });
    for (const name of ['first', 'second', 'third']) {
      app.expenses.save(draftOf(app, { description: name, amount: '1' }));
      clock.current = new Date(clock.current.getTime() + 60_000);
    }
    assert.deepEqual(app.expenses.listRecent(2).map((e) => e.description), ['third', 'second']);
    assert.equal(app.expenses.count(), 3);
  });
  it('breaks ties by id when two expenses share the same instant', async () => {
    const { app } = await makeApp();
    app.expenses.save(draftOf(app, { description: 'a', amount: '1' }));
    app.expenses.save(draftOf(app, { description: 'b', amount: '1' }));
    assert.deepEqual(app.expenses.listRecent(2).map((e) => e.description), ['b', 'a']);
  });
  it('is simply empty on a brand new database', async () => {
    const { app } = await makeApp();
    assert.deepEqual(app.expenses.listRecent(10), []);
    assert.equal(app.expenses.count(), 0);
  });
  it('orders correctly across a daylight-saving fall-back by UTC, even though both read "1:30 am"', async () => {
    const { app, clock } = await makeApp({ now: '2026-11-01T05:30:00Z', zone: 'America/New_York' });
    app.expenses.save(draftOf(app, { description: 'before change', amount: '1' }));
    clock.current = new Date('2026-11-01T06:30:00Z');
    app.expenses.save(draftOf(app, { description: 'after change', amount: '1' }));
    const [later, earlier] = app.expenses.listRecent(2);
    assert.equal(later.description, 'after change');
    assert.equal(earlier.localDate, later.localDate);
  });
});

describe('year boundary', () => {
  it('files a New Year\'s Eve purchase under the 31st in its own zone', async () => {
    const { app } = await makeApp({ now: '2027-01-01T04:30:00Z', zone: 'America/New_York' });
    assert.equal(app.expenses.save(draftOf(app, { description: 'fireworks', amount: '50' })).localDate, '2026-12-31');
  });
});
