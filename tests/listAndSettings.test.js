import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAdd } from '../src/cli/addCommand.js';
import { runList } from '../src/cli/listCommand.js';
import { runSettings } from '../src/cli/settingsCommand.js';
import { makeApp, makeCtx } from './helpers.js';

const all = (lines) => lines.join('\n');
const addQuick = (app, ...args) => runAdd([...args, '--yes'], makeCtx(app).ctx);

describe('list', () => {
  it('invites you to add something when empty', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    assert.equal(await runList([], ctx), 0);
    assert.match(all(out), /No expenses yet/);
  });
  it('shows each amount in its own currency and never adds different currencies together', async () => {
    const { app } = await makeApp();
    await addQuick(app, 'chips', '20');
    await addQuick(app, 'coffee', '10', '-c', 'USD');
    const { ctx, out } = makeCtx(app);
    await runList([], ctx);
    const text = all(out);
    assert.match(text, /₹20\.00/);
    assert.match(text, /\$10\.00/);
    assert.ok(!/30\.00/.test(text), '₹20 + $10 must never appear as 30');
    assert.match(text, /Showing 2 of 2/);
  });
  it('respects --limit and tells you how many exist in total', async () => {
    const { app, clock } = await makeApp();
    for (const name of ['tea', 'bus', 'pen']) {
      await addQuick(app, name, '1');
      clock.current = new Date(clock.current.getTime() + 60_000);
    }
    const { ctx, out } = makeCtx(app);
    await runList(['--limit', '2'], ctx);
    assert.match(all(out), /Showing 2 of 3/);
  });
  it('rejects a bad --limit', async () => {
    const { app } = await makeApp();
    for (const bad of ['0', '-1', 'ten', '1.5', '9999']) {
      const { ctx, err } = makeCtx(app);
      assert.equal(await runList(['--limit', bad], ctx), 2, `--limit ${bad}`);
      assert.match(all(err), /whole number/);
    }
  });
  it('shortens very long descriptions for display only, but keeps the full text stored', async () => {
    const { app } = await makeApp();
    const long = 'x'.repeat(90);
    await addQuick(app, long, '5');
    const { ctx, out } = makeCtx(app);
    await runList([], ctx);
    assert.ok(all(out).includes('…'));
    assert.ok(!all(out).includes(long));
    assert.equal(app.expenses.listRecent(1)[0].description, long);
  });
  it('shows each row in the time zone it was saved in', async () => {
    const { app } = await makeApp({ now: '2026-11-12T18:15:00Z', zone: 'Asia/Kolkata' });
    await addQuick(app, 'chips', '20');
    app.settings.setTimeZone('America/Los_Angeles'); // changing the setting later...
    const { ctx, out } = makeCtx(app);
    await runList([], ctx);
    assert.match(all(out), /Thu 12 Nov, 11:45 pm/); // ...doesn't rewrite history
  });
});

describe('list: categories', () => {
  it('shows each expense\'s category with its icon', async () => {
    const { app } = await makeApp();
    await addQuick(app, 'chips', '20');
    await addQuick(app, 'bus', '30');
    const { ctx, out } = makeCtx(app);
    await runList([], ctx);
    assert.match(all(out), /Category/);
    assert.match(all(out), /🍟 Food & Snacks/);
    assert.match(all(out), /🚌 Transport/);
  });
  it('keeps columns lined up even though emoji are two columns wide', async () => {
    const { app } = await makeApp();
    await addQuick(app, 'chips', '20');
    await addQuick(app, 'bus', '3000');
    const { ctx, out } = makeCtx(app);
    await runList([], ctx);
    const rows = out.filter((line) => line.includes('₹'));
    const columnOf = (line) => [...line.slice(0, line.indexOf('₹'))].reduce((sum, ch) => sum + (ch.codePointAt(0) > 0x1f000 ? 2 : 1), 0);
    assert.equal(new Set(rows.map((row) => columnOf(row) + row.slice(row.indexOf('₹')).length)).size, 1, 'rows end at the same column');
  });
});

describe('settings', () => {
  it('shows current values', async () => {
    const { app } = await makeApp({ zone: 'Asia/Calcutta' });
    const { ctx, out } = makeCtx(app);
    assert.equal(await runSettings([], ctx), 0);
    assert.match(all(out), /Currency\s+INR/);
    assert.match(all(out), /Asia\/Calcutta.*your computer's/);
  });
  it('changes the default currency and rejects unknown ones', async () => {
    const { app } = await makeApp();
    assert.equal(await runSettings(['currency', 'gbp'], makeCtx(app).ctx), 0);
    assert.equal(app.settings.getDefaultCurrency(), 'GBP');
    const { ctx, err } = makeCtx(app);
    assert.equal(await runSettings(['currency', 'doge'], ctx), 2);
    assert.match(all(err), /isn't a supported currency/);
    assert.equal(app.settings.getDefaultCurrency(), 'GBP');
  });
  it('offers a numbered menu for currency when interactive', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app, { interactive: true, answers: ['2'] });
    await runSettings(['currency'], ctx);
    assert.equal(app.settings.getDefaultCurrency(), 'USD'); // second in the list
  });
  it('asks to be told the value when it can\'t show a menu', async () => {
    const { app } = await makeApp();
    const { ctx, err } = makeCtx(app, { interactive: false });
    assert.equal(await runSettings(['currency'], ctx), 2);
    assert.match(all(err), /INR, USD/);
  });
  it('sets, shows and resets a time zone override', async () => {
    const { app } = await makeApp({ zone: 'UTC' });
    await runSettings(['timezone', 'asia/kolkata'], makeCtx(app).ctx);
    assert.equal(app.settings.getTimeZone(), 'Asia/Kolkata');
    const { ctx, out } = makeCtx(app);
    await runSettings([], ctx);
    assert.match(all(out), /your override/);
    await runSettings(['timezone', 'reset'], makeCtx(app).ctx);
    assert.equal(app.settings.getTimeZone(), 'UTC');
    assert.equal(await runSettings(['timezone', 'Mars/Base'], makeCtx(app).ctx), 2);
  });
  it('saves a theme and rejects unknown ones', async () => {
    const { app } = await makeApp();
    assert.equal(await runSettings(['theme', 'grape'], makeCtx(app).ctx), 0);
    assert.equal(app.settings.getTheme(), 'grape');
    assert.equal(await runSettings(['theme', 'nope'], makeCtx(app).ctx), 2);
  });
  it('explains an unknown setting', async () => {
    const { app } = await makeApp();
    const { ctx, err } = makeCtx(app);
    assert.equal(await runSettings(['colour'], ctx), 2);
    assert.match(all(err), /currency, timezone or theme/);
  });
  it('a currency change affects only NEW expenses', async () => {
    const { app } = await makeApp();
    await addQuick(app, 'chips', '20');
    await runSettings(['currency', 'USD'], makeCtx(app).ctx);
    await addQuick(app, 'coffee', '5');
    const [coffee, chips] = app.expenses.listRecent(2);
    assert.deepEqual([chips.currency, coffee.currency], ['INR', 'USD']);
  });
});
