import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAdd } from '../src/cli/addCommand.js';
import { runCli } from '../src/cli/commands.js';
import { makeApp, makeCtx } from './helpers.js';

const all = (lines) => lines.join('\n');

describe('add: quick, non-interactive', () => {
  it('saves "add chips 20 --yes" and shows what it saved', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    assert.equal(await runAdd(['chips', '20', '--yes'], ctx), 0);
    const [saved] = app.expenses.listRecent(1);
    assert.deepEqual([saved.description, saved.amountMinor, saved.currency], ['chips', 2000, 'INR']);
    assert.match(all(out), /Saved\s+chips\s+₹20\.00/);
  });
  it('treats the last word as the amount and everything before it as the description', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app);
    await runAdd(['college', 'printout', '10', '--yes'], ctx);
    assert.equal(app.expenses.listRecent(1)[0].description, 'college printout');
  });
  it('accepts flags anywhere, and a currency in any capitalisation', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app);
    assert.equal(await runAdd(['--yes', '-c', 'usd', 'coffee', '5.5'], ctx), 0);
    const [saved] = app.expenses.listRecent(1);
    assert.deepEqual([saved.amountMinor, saved.currency], [550, 'USD']);
  });
  it('does not mistake --theme\'s value for part of the expense', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app);
    await runAdd(['chips', '20', '--theme', 'ocean', '--yes'], ctx);
    assert.equal(app.expenses.listRecent(1)[0].description, 'chips');
  });
  it('works through the real router too, flags included', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app);
    assert.equal(await runCli(['add', 'chips', '20', '--yes'], ctx), 0);
    assert.equal(app.expenses.count(), 1);
  });
  it('shows the time in the configured zone', async () => {
    const { app } = await makeApp({ now: '2026-11-12T18:15:00Z', zone: 'Asia/Kolkata' });
    const { ctx, out } = makeCtx(app);
    await runAdd(['chips', '20', '--yes'], ctx);
    assert.match(all(out), /Thu 12 Nov, 11:45 pm \(Asia\/Kolkata\)/);
  });
});

describe('add: refusing bad input without saving', () => {
  const failsWith = async (args, pattern, code = 2) => {
    const { app } = await makeApp();
    const { ctx, err } = makeCtx(app);
    assert.equal(await runAdd(args, ctx), code);
    assert.match(all(err), pattern);
    assert.equal(app.expenses.count(), 0, 'nothing may be saved');
  };
  it('negative amounts', () => failsWith(['chips', '-20', '--yes'], /must be positive/));
  it('zero', () => failsWith(['chips', '0', '--yes'], /more than zero/));
  it('text instead of an amount', () => failsWith(['chips', 'lots', '--yes'], /enter an amount/));
  it('too many decimals', () => failsWith(['chips', '20.555', '--yes'], /at most 2 decimal places/));
  it('an unsupported currency', () => failsWith(['chips', '20', '-c', 'zzz', '--yes'], /isn't a supported currency/));
  it('a missing description', () => failsWith(['20', '--yes'], /what you spent on/));
  it('nothing at all', () => failsWith(['--yes'], /what you spent on/));
  it('a very long description', () => failsWith(['x'.repeat(101), '5', '--yes'], /100 characters/));
  it('a non-interactive run without --yes (it can\'t ask, so it must not save)', () =>
    failsWith(['chips', '20'], /Add --yes/, 1));
});

describe('add: interactive', () => {
  it('asks for both fields, shows a preview, and saves on confirm', async () => {
    const { app } = await makeApp();
    const { ctx, asked } = makeCtx(app, { interactive: true, answers: ['protein bar', '120', 'save'] });
    assert.equal(await runAdd([], ctx), 0);
    assert.deepEqual(asked, ['What did you spend on?', 'How much?', 'Save this expense?']);
    assert.equal(app.expenses.listRecent(1)[0].amountMinor, 12000);
  });
  it('only asks for what is missing', async () => {
    const { app } = await makeApp();
    const { ctx, asked } = makeCtx(app, { interactive: true, answers: ['20', 'save'] });
    await runAdd(['chips'], ctx);
    assert.deepEqual(asked, ['How much?', 'Save this expense?']);
  });
  it('treats a lone number as the amount and asks what it was for', async () => {
    const { app } = await makeApp();
    const { ctx, asked } = makeCtx(app, { interactive: true, answers: ['bus', 'save'] });
    await runAdd(['30'], ctx);
    assert.equal(asked[0], 'What did you spend on?');
    assert.equal(app.expenses.listRecent(1)[0].amountMinor, 3000);
  });
  it('re-asks only the field that was wrong', async () => {
    const { app } = await makeApp();
    const { ctx, asked, err } = makeCtx(app, { interactive: true, answers: ['abc', '30', 'save'] });
    assert.equal(await runAdd(['bus'], ctx), 0);
    assert.deepEqual(asked, ['How much?', 'How much?', 'Save this expense?']);
    assert.match(all(err), /doesn't look like an amount/);
    assert.equal(app.expenses.count(), 1);
  });
  it('saves nothing when cancelled', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app, { interactive: true, answers: ['cancel'] });
    assert.equal(await runAdd(['chips', '20'], ctx), 0);
    assert.equal(app.expenses.count(), 0);
    assert.match(all(out), /Nothing was saved/);
  });
  it('saves nothing when the person quits mid-question (Ctrl+C / Ctrl+D)', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app, { interactive: true, answers: [] });
    assert.equal(await runAdd([], ctx), 0);
    assert.equal(app.expenses.count(), 0);
    assert.match(all(out), /Nothing was saved/);
  });
  it('lets the person edit every field before saving, with the current values as defaults', async () => {
    const { app } = await makeApp();
    // edit, keep description (Enter), new amount, new currency, then save
    const { ctx } = makeCtx(app, { interactive: true, answers: ['edit', '', '99.5', 'usd', 'save'] });
    await runAdd(['tea', '15'], ctx);
    const [saved] = app.expenses.listRecent(1);
    assert.deepEqual([saved.description, saved.amountMinor, saved.currency], ['tea', 9950, 'USD']);
    assert.equal(app.expenses.count(), 1);
  });
  it('can edit and then still cancel', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app, { interactive: true, answers: ['edit', '', '', '', 'cancel'] });
    await runAdd(['tea', '15'], ctx);
    assert.equal(app.expenses.count(), 0);
  });
  it('warns about a likely duplicate, and Enter then means Cancel, not Save', async () => {
    const { app } = await makeApp();
    await runAdd(['chips', '20', '--yes'], makeCtx(app).ctx);
    const { ctx, out } = makeCtx(app, { interactive: true, answers: [''] });
    await runAdd(['chips', '20'], ctx);
    assert.match(all(out), /saved the same thing/);
    assert.equal(app.expenses.count(), 1, 'pressing Enter must not create the duplicate');
  });
  it('still lets the person knowingly save a duplicate', async () => {
    const { app } = await makeApp();
    await runAdd(['chips', '20', '--yes'], makeCtx(app).ctx);
    const { ctx } = makeCtx(app, { interactive: true, answers: ['save'] });
    await runAdd(['chips', '20'], ctx);
    assert.equal(app.expenses.count(), 2);
  });
});
