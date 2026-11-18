import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runHome } from '../src/cli/interactive.js';
import { runCli } from '../src/cli/commands.js';
import { makeApp, makeCtx } from './helpers.js';

const all = (lines) => lines.join('\n');

/** An app that has already been through first-run setup, with a little data. */
async function readyApp(options) {
  const made = await makeApp(options);
  made.app.settings.markSetupDone();
  return made;
}
async function withData(options) {
  const made = await readyApp(options);
  for (const [description, amount] of [['chips', '20'], ['rent', '5000'], ['bus', '30']]) {
    made.app.expenses.save(made.app.expenses.validate({ description, amount }).draft);
  }
  return made;
}
const session = async (answers, { app, rows, columns } = {}) => {
  const made = app ? { app } : await readyApp();
  const ctx = makeCtx(made.app, { interactive: true, answers, rows, columns });
  let clears = 0;
  ctx.ctx.clear = () => { clears += 1; };
  const code = await runHome(ctx.ctx);
  return { ...ctx, app: made.app, code, clears: () => clears };
};

describe('home screen: not a terminal', () => {
  it('shows the dashboard once and exits, asking nothing', async () => {
    const { app } = await withData();
    const { ctx, out, asked } = makeCtx(app, { interactive: false });
    assert.equal(await runHome(ctx), 0);
    const text = all(out);
    assert.match(text, /Your spending/);
    assert.match(text, /Good morning! What would you like to do\?/);
    assert.match(text, /pocketpulse add chips 20/);
    assert.deepEqual(asked, []);
  });
  it('shows the friendly first-use panel on a brand new database', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app, { interactive: false });
    await runHome(ctx);
    assert.match(all(out), /No expenses yet/);
  });
  it('is what plain "pocketpulse" runs, via the router', async () => {
    const { app } = await withData();
    const { ctx, out } = makeCtx(app, { interactive: false });
    assert.equal(await runCli([], ctx), 0);
    assert.match(all(out), /Where it went/);
  });
  it('uses the full logo (there is no menu to make room for)', async () => {
    const { app } = await readyApp();
    const { ctx, out } = makeCtx(app, { interactive: false, rows: undefined, columns: 100 });
    await runHome(ctx);
    assert.match(all(out), /█████/);
  });
  it('does not clear the screen when there is no terminal', async () => {
    const { app } = await readyApp();
    const { ctx } = makeCtx(app, { interactive: false });
    let cleared = false;
    ctx.clear = () => { cleared = true; };
    await runHome(ctx);
    assert.equal(cleared, false);
  });
  it('greets by the hour in YOUR configured time zone', async () => {
    const { app } = await makeApp({ now: '2026-11-12T18:15:00Z', zone: 'Asia/Kolkata' }); // 11:45 pm there
    const { ctx, out } = makeCtx(app, { interactive: false });
    await runHome(ctx);
    assert.match(all(out), /Burning the midnight oil! What would you like to do\?/);
  });
});

describe('home screen: the menu loop', () => {
  it('shows the logo, the dashboard and then asks with a greeting', async () => {
    const { out, asked } = await session(['exit'], { app: (await withData()).app });
    assert.match(asked[0], /Good morning! What would you like to do\?/);
    assert.match(all(out), /POCKETPULSE|█/);
    assert.match(all(out), /Your spending/);
    assert.match(all(out), /See you soon!/);
  });
  it('exits on "Exit", on Esc/Ctrl+C (null), and returns 0 either way', async () => {
    assert.equal((await session(['exit'])).code, 0);
    const escaped = await session([null]);
    assert.equal(escaped.code, 0);
    assert.match(all(escaped.out), /See you soon!/);
  });
  it('clears the screen before each time it draws the menu', async () => {
    const made = await session(['today', '', 'exit']);
    assert.equal(made.clears(), 2); // once before the first menu, once after coming back
  });
  it('offers every option, with the spec\'s eight plus Quick add, in order', async () => {
    const { app } = await readyApp();
    const { ctx } = makeCtx(app, { interactive: true, answers: ['exit'] });
    let labels;
    const original = ctx.getPrompts().select;
    ctx.getPrompts().select = async (label, items, opts) => { labels = items.map((i) => i.label); return original(label, items, opts); };
    await runHome(ctx);
    assert.deepEqual(labels, ['Quick add', 'Add an expense', "View today's spending", 'Weekly analytics',
      'Monthly analytics', 'Transaction history', 'Manage categories', 'Settings', 'Exit']);
  });
  it('gives every option a different shortcut key', async () => {
    const { app } = await readyApp();
    const { ctx } = makeCtx(app, { interactive: true, answers: ['exit'] });
    let shortcuts;
    const original = ctx.getPrompts().select;
    ctx.getPrompts().select = async (label, items, opts) => { shortcuts = items.map((i) => i.shortcut); return original(label, items, opts); };
    await runHome(ctx);
    assert.equal(new Set(shortcuts).size, shortcuts.length);
    assert.ok(shortcuts.every(Boolean));
  });
  it('returns to the menu after each action, and exits if you quit at the "press Enter" pause', async () => {
    const made = await session(['today', null]);
    assert.equal(made.code, 0);
    assert.match(all(made.out), /Nothing spent today yet/);
  });
});

describe('home screen: what each option does', () => {
  it('"Quick add" takes a sentence, then goes through the normal preview and save', async () => {
    const made = await session(['quick', 'bought a notebook for 65', 'save', '', 'exit']);
    const [saved] = made.app.expenses.listRecent(1);
    assert.deepEqual([saved.description, saved.amountMinor, saved.category.name], ['notebook', 6500, 'College & Study']);
    assert.match(all(made.out), /Expense detected/);
  });
  it('"Quick add" with nothing typed saves nothing', async () => {
    const made = await session(['quick', '', '', 'exit']);
    assert.equal(made.app.expenses.count(), 0);
  });
  it('"Quick add" can be cancelled at the confirmation', async () => {
    const made = await session(['quick', 'chips 20', 'cancel', '', 'exit']);
    assert.equal(made.app.expenses.count(), 0);
  });
  it('"Add an expense" asks step by step', async () => {
    const made = await session(['add', 'bus', '30', 'save', '', 'exit']);
    assert.deepEqual([made.app.expenses.listRecent(1)[0].description, made.app.expenses.listRecent(1)[0].amountMinor], ['bus', 3000]);
  });
  it('"View today\'s spending" shows today', async () => {
    const { app } = await withData();
    const made = await session(['today', '', 'exit'], { app });
    assert.match(all(made.out), /Today · Thursday 12 November/);
    assert.match(all(made.out), /chips/);
  });
  it('"Weekly analytics" opens the browser and returns straight to the menu (no extra pause)', async () => {
    const { app } = await withData();
    const made = await session(['week', 'previous', 'back', 'exit'], { app });
    assert.match(all(made.out), /This week ·/);
    assert.match(all(made.out), /Last week ·/);
    assert.ok(!made.asked.some((q) => q.includes('Press Enter')), 'the browser has its own Back, so there is no pause');
    assert.equal(made.clears(), 4); // menu, browser x2, menu again
  });
  it('"Monthly analytics" does the same for months', async () => {
    const { app } = await withData();
    const made = await session(['month', 'previous', 'back', 'exit'], { app });
    assert.match(all(made.out), /This month · November 2026/);
    assert.match(all(made.out), /Last month · October 2026/);
    assert.ok(!made.asked.some((q) => q.includes('Press Enter')));
  });
  it('lets you leave the browser with Esc and carry on in the menu', async () => {
    const made = await session(['week', null, 'exit']);
    assert.match(all(made.out), /See you soon!/);
  });
  it('does not list analytics as unavailable', async () => {
    const made = await session(['exit']);
    assert.ok(!/coming soon|planned/i.test(all(made.out)));
  });
  it('"Transaction history" lists recent expenses', async () => {
    const { app } = await withData();
    const made = await session(['history', '', 'exit'], { app });
    assert.match(all(made.out), /rent/);
    assert.match(all(made.out), /Showing 3 of 3/);
  });
  it('"Manage categories" shows the categories', async () => {
    const made = await session(['categories', '', 'exit']);
    assert.match(all(made.out), /CATEGORIES/);
    assert.match(all(made.out), /Food & Snacks/);
  });
});

describe('home screen: settings', () => {
  it('changes the default currency from a menu', async () => {
    const made = await session(['settings', 'currency', '3', '', 'exit']); // 3rd currency = EUR
    assert.equal(made.app.settings.getDefaultCurrency(), 'EUR');
  });
  it('changes the time zone', async () => {
    const made = await session(['settings', 'timezone', 'asia/kolkata', '', 'exit']);
    assert.equal(made.app.settings.getTimeZone(), 'Asia/Kolkata');
  });
  it('changes the theme', async () => {
    const made = await session(['settings', 'theme', '3', '', 'exit']); // pulse, sunset, ocean
    assert.equal(made.app.settings.getTheme(), 'ocean');
  });
  it('changes nothing on "Back" or when cancelled', async () => {
    for (const choice of ['back', null]) {
      const made = await session(['settings', choice, '', 'exit']);
      assert.equal(made.app.settings.getDefaultCurrency(), 'INR');
      assert.equal(made.app.settings.getTheme(), null);
    }
  });
  it('changes nothing if the time zone question is left blank', async () => {
    const made = await session(['settings', 'timezone', '', '', 'exit']);
    assert.equal(made.app.settings.getTimeZoneOverride(), null);
  });
  it('shows the current settings first', async () => {
    const made = await session(['settings', 'back', '', 'exit']);
    assert.match(all(made.out), /SETTINGS/);
  });
});

describe('home screen: first run', () => {
  const firstRun = async (answers) => {
    const { app } = await makeApp(); // NOT marked as set up
    return session(answers, { app });
  };
  it('welcomes you and asks for your main currency', async () => {
    const made = await firstRun(['2', 'exit']);
    assert.match(all(made.out), /Welcome to PocketPulse!/);
    assert.match(all(made.out), /Everything stays on this computer/);
    assert.match(made.asked[0], /Main currency/);
    assert.equal(made.app.settings.getDefaultCurrency(), 'USD');
  });
  it('mentions the detected time zone and how to change things', async () => {
    const made = await firstRun(['exit']);
    assert.match(all(made.out), /Time zone detected: UTC/);
    assert.match(all(made.out), /pocketpulse settings/);
  });
  it('offers all nine currencies, INR first and pre-selected', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app, { interactive: true, answers: ['exit'] });
    let seen;
    const original = ctx.getPrompts().select;
    ctx.getPrompts().select = async (label, items, opts) => { seen ??= { items: items.map((i) => i.code), opts }; return original(label, items, opts); };
    await runHome(ctx);
    assert.deepEqual(seen.items, ['INR', 'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'JPY', 'SGD']);
    assert.equal(seen.opts.defaultIndex, 0);
  });
  it('keeps INR if you skip the question (Esc), and does not ask again', async () => {
    const made = await firstRun([null, 'exit']);
    assert.equal(made.app.settings.getDefaultCurrency(), 'INR');
    assert.equal(made.app.settings.isSetupDone(), true);
  });
  it('asks only once: the second launch goes straight to the menu', async () => {
    const { app } = await makeApp();
    await session(['2', 'exit'], { app });
    const again = await session(['exit'], { app });
    assert.ok(!all(again.out).includes('Welcome to PocketPulse!'));
    assert.match(again.asked[0], /What would you like to do/);
  });
  it('is not triggered by plain commands like add (only the home screen welcomes you)', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app);
    await runCli(['add', 'chips', '20', '--yes'], ctx);
    assert.equal(app.settings.isSetupDone(), false);
  });
});

describe('home screen: fitting the window', () => {
  it('uses the big logo in a tall window and the small one in a short window', async () => {
    const { app } = await withData();
    const tall = await session(['exit'], { app, rows: 60 });
    const short = await session(['exit'], { app, rows: 30 });
    assert.match(all(tall.out), /█████/);
    assert.ok(!all(short.out).includes('█████ █'), 'short windows must not get the 5-row logo');
    assert.match(all(short.out), /⚡ POCKETPULSE/);
  });
  it('shows a smaller dashboard in a short window, so the menu stays on screen', async () => {
    const { app } = await withData();
    const tall = await session(['exit'], { app, rows: 80 });
    const short = await session(['exit'], { app, rows: 32 });
    const height = (made) => all(made.out).split('\n').length;
    assert.ok(height(short) < height(tall));
    assert.match(all(short.out), /Your spending/);
  });
});
