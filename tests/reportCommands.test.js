import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli/commands.js';
import { browseReport } from '../src/cli/reportCommands.js';
import { makeCtx, makeWorld } from './helpers.js';

const all = (lines) => lines.join('\n');

// Thu 12 Nov 2026 is "now".
async function standard() {
  const world = await makeWorld();
  const { spend } = world;
  spend('2026-11-02T08:00:00Z', 'chips', '100');
  spend('2026-11-03T08:00:00Z', 'bus', '50');
  spend('2026-11-05T08:00:00Z', 'groceries', '900');
  spend('2026-11-09T08:00:00Z', 'chai', '60');
  spend('2026-11-11T08:00:00Z', 'rent', '300');
  spend('2026-10-03T08:00:00Z', 'october rent', '5000');
  return world;
}
const run = async (args, world) => {
  const { app } = world ?? await standard();
  const made = makeCtx(app);
  const code = await runCli(args, made.ctx);
  return { code, text: all(made.out), errors: all(made.err), app };
};
const fails = async (args, pattern) => {
  const { code, text, errors } = await run(args);
  assert.equal(code, 2, `${args.join(' ')} should exit 2`);
  assert.match(errors, pattern);
  assert.equal(text, '', 'nothing should be printed to stdout');
};

describe('pocketpulse week', () => {
  it('shows this week by default', async () => {
    const { code, text } = await run(['week']);
    assert.equal(code, 0);
    assert.match(text, /This week · Mon 9 – Sun 15 Nov 2026/);
    assert.match(text, /₹360\.00/);
  });
  it('goes back with --previous, -p and --back', async () => {
    for (const flags of [['--previous'], ['-p'], ['--back', '1'], ['--back=1']]) {
      assert.match((await run(['week', ...flags])).text, /Last week · Mon 2 – Sun 8 Nov 2026/, flags.join(' '));
    }
    assert.match((await run(['week', '--back', '2'])).text, /Week · Mon 26 Oct – Sun 1 Nov 2026/);
    assert.match((await run(['week', '--back', '0'])).text, /This week/);
  });
  it('accepts a date and shows the week containing it', async () => {
    assert.match((await run(['week', '2026-11-03'])).text, /Last week/);
    assert.match((await run(['week', 'yesterday'])).text, /This week/);
    assert.match((await run(['week', 'today'])).text, /This week/);
    assert.match((await run(['week', '2026-11-15'])).text, /This week/); // a Sunday belongs to the week before it
    assert.match((await run(['week', '2026-11-16'])).text, /hasn't started yet/);
  });
  it('combines a date with --back', async () => {
    assert.match((await run(['week', '2026-11-12', '--back', '1'])).text, /Last week/);
  });
  it('allows --previous together with an agreeing --back 1', async () => {
    assert.equal((await run(['week', '--previous', '--back', '1'])).code, 0);
  });
  it('filters by category (partial names work) and says so', async () => {
    const { text } = await run(['week', '--back', '1', '--category', 'transport']);
    assert.match(text, /Only\s+🚌 Transport/);
    assert.ok(text.includes('₹50.00') && !text.includes('₹900.00'));
    assert.match((await run(['week', '--back', '1', '-k', 'transp'])).text, /Only\s+🚌 Transport/);
  });
  it('chooses the currency', async () => {
    const world = await standard();
    world.spend('2026-11-10T08:00:00Z', 'coffee', '10', 'USD');
    assert.match((await run(['week', '--currency', 'usd'], world)).text, /Day by day · USD/);
    assert.match((await run(['week', '-c', 'USD'], world)).text, /Day by day · USD/);
  });
  it('explains bad input and prints nothing else', async () => {
    await fails(['week', 'abc'], /"abc" isn't a date/);
    await fails(['week', '2026-02-30'], /isn't a date/);
    await fails(['week', '--back', 'x'], /--back should be a whole number from 0 to 520/);
    await fails(['week', '--back', '1.5'], /whole number/);
    await fails(['week', '--back', '9999'], /from 0 to 520/);
    await fails(['week', '--previous', '--back', '2'], /--previous means "one period back"/);
    await fails(['week', '--category', 'nope'], /don't have a category called "nope"/);
    await fails(['week', '--category', 'food'], /could mean/);
    await fails(['week', '--currency', 'xyz'], /isn't a supported currency/);
  });
  it('has its own help with examples', async () => {
    const { text } = await run(['week', '--help']);
    assert.match(text, /USAGE\s+pocketpulse week/);
    assert.match(text, /pocketpulse week --previous/);
  });
  it('is quiet, not broken, when there is no data at all', async () => {
    const { text, code } = await run(['week'], await makeWorld());
    assert.equal(code, 0);
    assert.match(text, /No expenses in this period/);
  });
});

describe('pocketpulse month', () => {
  it('shows this month by default, and last month with --previous', async () => {
    assert.match((await run(['month'])).text, /This month · November 2026/);
    assert.match((await run(['month', '--previous'])).text, /Last month · October 2026/);
    assert.match((await run(['month', '--previous'])).text, /october rent/);
  });
  it('names a month directly', async () => {
    assert.match((await run(['month', '2026-10'])).text, /Last month · October 2026/);
    assert.match((await run(['month', '2026-10-15'])).text, /Last month/);
    assert.match((await run(['month', 'today'])).text, /This month/);
    assert.match((await run(['month', '2026-08'])).text, /Month · August 2026/);
  });
  it('goes back a year', async () => {
    assert.match((await run(['month', '--back', '12'])).text, /Month · November 2025/);
  });
  it('rejects things that are not months', async () => {
    await fails(['month', '2026-13'], /isn't a month or date/);
    await fails(['month', 'abc'], /isn't a month or date/);
    await fails(['month', '2026-00'], /isn't a month or date/);
  });
  it('filters by category', async () => {
    assert.match((await run(['month', '--category', 'Bills'])).text, /Only\s+📱 Bills & Recharge/);
  });
});

describe('pocketpulse range', () => {
  it('takes two dates, positionally or with flags', async () => {
    for (const args of [['range', '2026-11-03', '2026-11-07'], ['range', '--from', '2026-11-03', '--to', '2026-11-07']]) {
      const { code, text } = await run(args);
      assert.equal(code, 0);
      assert.match(text, /Custom range · Tue 3 – Sat 7 Nov 2026/);
      assert.ok(text.includes('₹950.00') || text.includes('₹50.00'), text); // bus 50 + groceries 900
    }
  });
  it('understands "today" and "yesterday"', async () => {
    assert.match((await run(['range', '2026-11-01', 'yesterday'])).text, /Custom range · Sun 1 – Wed 11 Nov 2026/);
  });
  it('allows a single day and a full leap year', async () => {
    assert.match((await run(['range', '2026-11-05', '2026-11-05'])).text, /Thu 5 Nov 2026/);
    assert.equal((await run(['range', '2028-01-01', '2028-12-31'])).code, 0); // 366 days
  });
  it('works over a range that crosses a year boundary', async () => {
    assert.match((await run(['range', '2026-12-28', '2027-01-03'])).text, /Mon 28 Dec 2026 – Sun 3 Jan 2027/);
  });
  it('filters by category', async () => {
    const { text } = await run(['range', '2026-11-01', '2026-11-30', '--category', 'transport']);
    assert.ok(text.includes('₹50.00') && !text.includes('₹900.00'));
  });
  it('explains problems', async () => {
    await fails(['range'], /Give a start and an end/);
    await fails(['range', '2026-11-03'], /Give a start and an end/);
    await fails(['range', '2026-11-20', '2026-11-01'], /start \(2026-11-20\) comes after the end/);
    await fails(['range', 'x', '2026-11-01'], /"x" isn't a date/);
    await fails(['range', '2026-11-01', 'y'], /"y" isn't a date/);
    await fails(['range', '2020-01-01', '2026-11-01'], /more than 366 days/);
    await fails(['range', '2028-01-01', '2029-01-01'], /more than 366 days/); // 367 days
  });
});

describe('pocketpulse trends', () => {
  it('shows 8 weeks by default', async () => {
    const { text } = await run(['trends']);
    assert.match(text, /Trend · weekly · INR/);
    assert.equal(text.split('\n').filter((l) => /[█░]{8}/.test(l)).length, 8); // a bar of 8+ blocks marks a data row
  });
  it('takes --weeks and --months', async () => {
    const weeks = (await run(['trends', '--weeks', '12'])).text.split('\n').filter((l) => /[█░]{8}/.test(l));
    assert.equal(weeks.length, 12);
    const months = (await run(['trends', '--months', '3'])).text;
    assert.match(months, /Trend · monthly/);
    assert.equal(months.split('\n').filter((l) => /[█░]{8}/.test(l)).length, 3);
  });
  it('filters by category', async () => {
    assert.match((await run(['trends', '--category', 'transport'])).text, /Trend · weekly · INR · Transport/);
  });
  it('rejects bad counts and conflicting flags', async () => {
    await fails(['trends', '--weeks', '0'], /--weeks should be a whole number from 1 to 52/);
    await fails(['trends', '--weeks', '53'], /from 1 to 52/);
    await fails(['trends', '--weeks', 'x'], /whole number/);
    await fails(['trends', '--months', '25'], /--months should be a whole number from 1 to 24/);
    await fails(['trends', '--weeks', '4', '--months', '4'], /either --weeks or --months/);
    await fails(['trends', '--currency', 'xyz'], /isn't a supported currency/);
  });
});

describe('interactive report browser', () => {
  const browse = async (kind, answers, world) => {
    const { app } = world ?? await standard();
    const made = makeCtx(app, { interactive: true, answers });
    let clears = 0;
    made.ctx.clear = () => { clears += 1; };
    await browseReport(kind, made.ctx);
    return { ...made, app, clears: () => clears, text: all(made.out) };
  };
  const order = (text, ...needles) => needles.map((n) => text.indexOf(n));

  it('shows the current week, then returns on "back"', async () => {
    const r = await browse('week', ['back']);
    assert.match(r.text, /This week/);
    assert.equal(r.clears(), 1);
    assert.deepEqual(r.asked, ['Weekly analytics']);
  });
  it('flips to the previous week and back to this one', async () => {
    const r = await browse('week', ['previous', 'next', 'back']);
    const [first, last, again] = order(r.text, 'This week', 'Last week', 'This week · ');
    assert.ok(first < last, 'this week first, then last week');
    assert.equal(r.text.match(/This week ·/g).length, 2, 'and this week again after "next"');
    assert.ok(again !== -1);
  });
  it('goes back several weeks', async () => {
    const r = await browse('week', ['previous', 'previous', 'back']);
    assert.match(r.text, /Week · Mon 26 Oct – Sun 1 Nov 2026/);
  });
  it('refuses to go into the future, with a friendly note', async () => {
    const r = await browse('week', ['next', 'back']);
    assert.match(r.text, /You're already looking at the current week\./);
    assert.equal(r.text.match(/This week ·/g).length, 2, 'it redraws the same week');
  });
  it('works the same way for months', async () => {
    const r = await browse('month', ['previous', 'next', 'next', 'back']);
    assert.match(r.text, /Last month · October 2026/);
    assert.match(r.text, /already looking at the current month/);
    assert.deepEqual(r.asked.slice(0, 1), ['Monthly analytics']);
  });
  it('filters by category from a picker, shows the filter in the menu, and can clear it', async () => {
    const world = await standard();
    const bills = String(world.app.categories.find('Bills & Recharge').category.id); // the picker's item key is the category id
    const r = await browse('week', ['category', bills, 'back'], world);
    assert.match(r.text, /Only\s+📱 Bills & Recharge/);
    assert.match(r.asked.join('|'), /Show which category\?/);
    const cleared = await browse('week', ['category', bills, 'category', 'all', 'back'], world);
    const afterClear = cleared.text.slice(cleared.text.lastIndexOf('This week ·'));
    assert.ok(!afterClear.includes('Only'), 'the filter is gone after choosing "All categories"');
  });
  it('keeps the current filter if the category picker is cancelled', async () => {
    const world = await standard();
    const transport = String(world.app.categories.find('Transport').category.id);
    const r = await browse('week', ['category', transport, 'category', null, 'back'], world);
    // This week has no transport spending, so the empty message names the filter; it must survive the cancel.
    const lastScreen = r.text.slice(r.text.lastIndexOf('This week ·'));
    assert.match(lastScreen, /Nothing in Transport for this period/);
  });
  it('keeps the filter while flipping periods', async () => {
    const world = await standard();
    const transport = String(world.app.categories.find('Transport').category.id);
    const r = await browse('week', ['category', transport, 'previous', 'back'], world);
    const lastScreen = r.text.slice(r.text.lastIndexOf('Last week ·'));
    assert.match(lastScreen, /Only\s+🚌 Transport/);
    assert.ok(lastScreen.includes('₹50.00'));
  });
  it('shows a smaller report in a short window so the menu stays on screen', async () => {
    const world = await standard();
    const tall = makeCtx(world.app, { interactive: true, answers: ['back'], rows: 80 });
    const short = makeCtx(world.app, { interactive: true, answers: ['back'], rows: 24 });
    await browseReport('month', tall.ctx);
    await browseReport('month', short.ctx);
    assert.ok(all(short.out).split('\n').length < all(tall.out).split('\n').length);
    assert.match(all(short.out), /This month/);
    assert.ok(!all(short.out).includes('By category'));
    assert.ok(all(tall.out).includes('By category'));
  });
  it('leaves when the menu is cancelled (Esc / Ctrl+C)', async () => {
    const r = await browse('week', [null]);
    assert.equal(r.clears(), 1);
  });
  it('clears the screen before every redraw', async () => {
    const r = await browse('week', ['previous', 'previous', 'next', 'back']);
    assert.equal(r.clears(), 4);
  });
  it('offers p, n, c and b shortcuts', async () => {
    const { app } = await standard();
    const made = makeCtx(app, { interactive: true, answers: ['back'] });
    let items;
    const original = made.ctx.getPrompts().select;
    made.ctx.getPrompts().select = async (label, list, options) => { items = list; return original(label, list, options); };
    await browseReport('week', made.ctx);
    assert.deepEqual(items.map((i) => [i.key, i.shortcut]), [['previous', 'p'], ['next', 'n'], ['category', 'c'], ['back', 'b']]);
  });
});
