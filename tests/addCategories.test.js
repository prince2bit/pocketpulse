import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAdd } from '../src/cli/addCommand.js';
import { makeApp, makeCtx } from './helpers.js';

const all = (lines) => lines.join('\n');
const last = (app) => app.expenses.listRecent(1)[0];
const addQuick = async (args, options = {}) => {
  const { app } = await makeApp();
  const made = makeCtx(app, options);
  const code = await runAdd([...args, '--yes'], made.ctx);
  return { app, code, ...made };
};

describe('add: natural sentences', () => {
  const cases = [
    [['bought', 'a', 'notebook', 'for', '65'], 'notebook', 6500, 'INR', 'College & Study'],
    [['spent', '40', 'on', 'samosa'], 'samosa', 4000, 'INR', 'Food & Drinks'],
    [['chips', '20'], 'chips', 2000, 'INR', 'Food & Snacks'],
    [['paid', '299', 'for', 'recharge'], 'recharge', 29900, 'INR', 'Bills & Recharge'],
    [['groceries', '250'], 'groceries', 25000, 'INR', 'Food & Drinks'],
    [['movie', '180'], 'movie', 18000, 'INR', 'Entertainment'],
    [['₹20', 'chips'], 'chips', 2000, 'INR', 'Food & Snacks'],
    [['ramen', '¥800'], 'ramen', 800, 'JPY', 'Other'],
  ];
  for (const [args, description, minor, currency, category] of cases) {
    it(`"${args.join(' ')}" -> ${description}, ${currency} ${minor}, ${category}`, async () => {
      const { app, code } = await addQuick(args);
      assert.equal(code, 0);
      const saved = last(app);
      assert.deepEqual([saved.description, saved.amountMinor, saved.currency, saved.category.name], [description, minor, currency, category]);
    });
  }
  it('works through shell quoting: ["movie ticket", "12.50"]', async () => {
    const { app } = await addQuick(['movie ticket', '12.50', '-c', 'usd']);
    assert.deepEqual([last(app).description, last(app).amountMinor, last(app).currency], ['movie ticket', 1250, 'USD']);
  });
  it('reads "$" as the default currency when that is a dollar currency', async () => {
    const { app } = await makeApp();
    app.settings.setDefaultCurrency('CAD');
    await runAdd(['coffee', '$5', '--yes'], makeCtx(app).ctx);
    assert.equal(last(app).currency, 'CAD');
  });
  it('says so when --currency overrules a symbol in the text', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    await runAdd(['coffee', '$5', '--currency', 'EUR', '--yes'], ctx);
    assert.equal(last(app).currency, 'EUR');
    assert.match(all(out), /Using EUR from --currency/);
  });
});

describe('add: showing the category and why', () => {
  it('explains a keyword match', async () => {
    const { out } = await addQuick(['chips', '20']);
    assert.match(all(out), /Category\s+🍟 Food & Snacks\s+\(matched "chips"\)/);
  });
  it('says plainly when nothing matched', async () => {
    const { out } = await addQuick(['protein', 'bar', '120']);
    assert.match(all(out), /Category\s+📦 Other\s+\(no match, so Other\)/);
  });
  it('mentions the alternatives when the words disagree', async () => {
    const { out } = await addQuick(['chips', 'and', 'chai', '35']);
    assert.match(all(out), /could also be Food & Drinks/);
  });
  it('names the rule when it came from you', async () => {
    const { app } = await makeApp();
    app.categories.teach('protein bar', app.categories.create({ name: 'Fitness' }).category.id);
    const { ctx, out } = makeCtx(app);
    await runAdd(['protein', 'bar', '120', '--yes'], ctx);
    assert.match(all(out), /your rule: "protein bar"/);
    assert.equal(last(app).category.name, 'Fitness');
  });
  it('shows the category on the "Saved" line too', async () => {
    const { out } = await addQuick(['bus', '30']);
    assert.match(all(out), /Saved\s+bus\s+₹30\.00\s+🚌 Transport/);
  });
});

describe('add --category', () => {
  it('uses the category you name, ignoring the guess', async () => {
    const { app } = await makeApp();
    app.categories.create({ name: 'Fitness' });
    const { ctx, out } = makeCtx(app);
    assert.equal(await runAdd(['chips', '20', '-k', 'fitness', '--yes'], ctx), 0);
    assert.equal(last(app).category.name, 'Fitness');
    assert.match(all(out), /\(your choice\)/);
  });
  it('accepts a unique partial name', async () => {
    const { app, code } = await addQuick(['pen', '10', '--category', 'recharge']);
    assert.equal(code, 0);
    assert.equal(last(app).category.name, 'Bills & Recharge');
  });
  it('refuses an unknown or ambiguous category without saving anything', async () => {
    for (const [name, pattern] of [['nonsense', /don't have a category/], ['food', /could mean/]]) {
      const { app } = await makeApp();
      const { ctx, err } = makeCtx(app);
      assert.equal(await runAdd(['chips', '20', '--category', name, '--yes'], ctx), 2);
      assert.match(all(err), pattern);
      assert.equal(app.expenses.count(), 0);
    }
  });
});

describe('add: asking instead of guessing', () => {
  it('refuses two numbers when it cannot ask', async () => {
    const { app } = await makeApp();
    const { ctx, err } = makeCtx(app);
    assert.equal(await runAdd(['2', 'samosa', '30', '--yes'], ctx), 2);
    assert.match(all(err), /more than one number \(2 and 30\)/);
    assert.equal(app.expenses.count(), 0);
  });
  it('asks which number is the amount, then uses it', async () => {
    const { app } = await makeApp();
    const { ctx, asked } = makeCtx(app, { interactive: true, answers: ['2', 'save'] }); // 2nd candidate = 30
    assert.equal(await runAdd(['2', 'samosa', '30'], ctx), 0);
    assert.match(asked[0], /Which one is the amount/);
    assert.deepEqual([last(app).description, last(app).amountMinor], ['2 samosa', 3000]);
  });
  it('stops cleanly if the person walks away during that question', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app, { interactive: true, answers: [] });
    assert.equal(await runAdd(['2', 'samosa', '30'], ctx), 0);
    assert.match(all(out), /Nothing was saved/);
    assert.equal(app.expenses.count(), 0);
  });
  it('asks for a missing amount when the text had only a description', async () => {
    const { app } = await makeApp();
    const { ctx, asked } = makeCtx(app, { interactive: true, answers: ['20', 'save'] });
    await runAdd(['bought', 'chips'], ctx);
    assert.deepEqual(asked, ['How much?', 'Save this expense?']);
    assert.equal(last(app).amountMinor, 2000);
  });
});

describe('add: changing the category and learning from it', () => {
  const setup = async (answers, args = ['protein', 'bar', '120']) => {
    const { app } = await makeApp();
    const fitness = app.categories.create({ name: 'Fitness' }).category;
    const position = app.categories.list().findIndex((c) => c.id === fitness.id) + 1; // the number shown in the menu
    const made = makeCtx(app, { interactive: true, answers: answers.map((a) => (a === 'FITNESS' ? String(position) : a)) });
    const code = await runAdd(args, made.ctx);
    return { app, fitness, code, ...made };
  };

  it('lets you pick another category before saving', async () => {
    const { app } = await setup(['category', 'FITNESS', 'save', 'no']);
    assert.equal(last(app).category.name, 'Fitness');
  });
  it('offers to remember it, and remembers it', async () => {
    const { app, asked } = await setup(['category', 'FITNESS', 'save', 'yes', '']);
    assert.ok(asked.some((q) => q.includes('Remember "protein bar" as Fitness')));
    const rule = app.categories.listRules({ mineOnly: true })[0];
    assert.deepEqual([rule.keyword, rule.source, rule.categoryName], ['protein bar', 'learned', 'Fitness']);
    assert.equal(app.categories.suggest('protein bar').category.name, 'Fitness'); // next time it just works
  });
  it('lets you narrow what it remembers', async () => {
    const { app } = await setup(['category', 'FITNESS', 'save', 'yes', 'protein']);
    assert.equal(app.categories.suggest('protein shake').category.name, 'Fitness');
  });
  it('remembers nothing when you say no', async () => {
    const { app } = await setup(['category', 'FITNESS', 'save', 'no']);
    assert.deepEqual(app.categories.listRules({ mineOnly: true }), []);
  });
  it('does not ask to remember if you chose what it had already suggested', async () => {
    const { app } = await makeApp();
    const position = app.categories.list().findIndex((c) => c.name === 'Food & Snacks') + 1;
    const { ctx, asked } = makeCtx(app, { interactive: true, answers: ['category', String(position), 'save'] });
    await runAdd(['chips', '20'], ctx);
    assert.ok(!asked.some((q) => q.includes('Remember')));
  });
  it('does not ask when you pass --yes (it cannot ask)', async () => {
    const { app } = await makeApp();
    app.categories.create({ name: 'Fitness' });
    const { ctx, asked } = makeCtx(app, { interactive: true });
    await runAdd(['protein', 'bar', '120', '--category', 'fitness', '--yes'], ctx);
    assert.ok(!asked.some((q) => q.includes('Remember')));
  });
  it('learns nothing if you change the category and then cancel', async () => {
    const { app } = await setup(['category', 'FITNESS', 'cancel']);
    assert.equal(app.expenses.count(), 0);
    assert.deepEqual(app.categories.listRules({ mineOnly: true }), []);
  });
  it('keeps your category choice when you then edit the description', async () => {
    const { app } = await setup(['category', 'FITNESS', 'edit', 'whey protein', '', '', 'save', 'no']);
    assert.deepEqual([last(app).description, last(app).category.name], ['whey protein', 'Fitness']);
  });
  it('re-guesses the category when you edit the description and have NOT chosen one', async () => {
    const { app } = await makeApp();
    const { ctx } = makeCtx(app, { interactive: true, answers: ['edit', 'bus', '', '', 'save'] });
    await runAdd(['protein', 'bar', '120'], ctx);
    assert.deepEqual([last(app).description, last(app).category.name], ['bus', 'Transport']);
  });
  it('tells you when a learned keyword replaces an older meaning', async () => {
    const { app } = await makeApp();
    const position = app.categories.list().findIndex((c) => c.name === 'Health') + 1;
    const { ctx, out } = makeCtx(app, { interactive: true, answers: ['category', String(position), 'save', 'yes', ''] });
    await runAdd(['chai', '15'], ctx);
    assert.match(all(out), /it used to mean Food & Drinks/);
    assert.equal(app.categories.suggest('chai').category.name, 'Health');
  });
  it('re-asks if the keyword is not acceptable, instead of giving up', async () => {
    const { app } = await setup(['category', 'FITNESS', 'save', 'yes', '!!!', 'protein bar']);
    assert.equal(app.categories.listRules({ mineOnly: true }).length, 1);
  });
});
