import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, COMMANDS } from '../src/cli/commands.js';
import { makeApp, makeCtx } from './helpers.js';

const all = (lines) => lines.join('\n');
async function withData() {
  const made = await makeApp();
  const spend = (description, amount, currency) => made.app.expenses.save(made.app.expenses.validate({ description, amount, currency }).draft);
  spend('chips', '100');
  spend('coffee', '10', 'USD');
  return made.app;
}

describe('pocketpulse dashboard', () => {
  it('prints the dashboard and exits 0', async () => {
    const { ctx, out } = makeCtx(await withData());
    assert.equal(await runCli(['dashboard'], ctx), 0);
    assert.match(all(out), /Your spending/);
    assert.match(all(out), /Where it went · November · INR/);
  });
  it('--currency (or -c) chooses which currency the bars and chart use', async () => {
    for (const flag of [['--currency', 'usd'], ['-c', 'USD'], ['--currency=USD']]) {
      const { ctx, out } = makeCtx(await withData());
      assert.equal(await runCli(['dashboard', ...flag], ctx), 0);
      assert.match(all(out), /Where it went · November · USD/, flag.join(' '));
    }
  });
  it('rejects an unsupported currency with a friendly message', async () => {
    const { ctx, err, out } = makeCtx(await withData());
    assert.equal(await runCli(['dashboard', '--currency', 'xyz'], ctx), 2);
    assert.match(all(err), /"xyz" isn't a supported currency/);
    assert.deepEqual(out, []);
  });
  it('shows the first-use panel when there is nothing yet', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    await runCli(['dashboard'], ctx);
    assert.match(all(out), /No expenses yet/);
  });
  it('has its own help', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    assert.equal(await runCli(['dashboard', '--help'], ctx), 0);
    assert.match(all(out), /USAGE\s+pocketpulse dashboard/);
    assert.match(all(out), /EXAMPLES/);
  });
});

describe('pocketpulse today', () => {
  it('shows today\'s total, breakdown and expenses', async () => {
    const { ctx, out } = makeCtx(await withData());
    assert.equal(await runCli(['today'], ctx), 0);
    const text = all(out);
    assert.match(text, /Today · \w+ \d+ \w+/);
    assert.match(text, /₹100\.00/);
    assert.match(text, /chips/);
    assert.match(text, /By category · INR/);
  });
  it('--currency picks the breakdown currency', async () => {
    const { ctx, out } = makeCtx(await withData());
    await runCli(['today', '-c', 'USD'], ctx);
    assert.match(all(out), /By category · USD/);
  });
  it('rejects a bad currency', async () => {
    const { ctx } = makeCtx(await withData());
    assert.equal(await runCli(['today', '--currency', 'nope'], ctx), 2);
  });
  it('says so when nothing was spent today', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    await runCli(['today'], ctx);
    assert.match(all(out), /Nothing spent today yet/);
  });
});

describe('help and registry', () => {
  it('lists today and dashboard as built, not "coming soon"', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    await runCli(['--help'], ctx);
    const text = all(out);
    assert.match(text, /today\s+See today's spending\s*$/m);
    assert.match(text, /dashboard\s+Your spending at a glance/);
    assert.ok(!/today.*planned/.test(text));
  });
  it('only export is still unbuilt', () => {
    assert.deepEqual(COMMANDS.filter((c) => !c.ready).map((c) => c.name), ['export']);
  });
});
