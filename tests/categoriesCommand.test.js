import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCategories } from '../src/cli/categoriesCommand.js';
import { runCli } from '../src/cli/commands.js';
import { makeApp, makeCtx } from './helpers.js';

const all = (lines) => lines.join('\n');
const run = async (args, options = {}) => {
  const { app } = options.app ? { app: options.app } : await makeApp();
  const made = makeCtx(app, options);
  const code = await runCategories(args, made.ctx);
  return { app, code, ...made };
};

describe('categories: list', () => {
  it('shows every category with counts', async () => {
    const { code, out } = await run([]);
    assert.equal(code, 0);
    const text = all(out);
    for (const name of ['Food & Snacks', 'Transport', 'College & Study', 'Other']) assert.ok(text.includes(name), name);
    assert.match(text, /0 expenses/);
    assert.match(text, /25 keywords/);
  });
  it('uses singular and plural correctly', async () => {
    const { app } = await makeApp();
    await runCli(['add', 'chips', '20', '--yes'], makeCtx(app).ctx);
    const { out } = await run(['list'], { app });
    assert.match(all(out), /1 expense\b/);
  });
  it('works through the real router', async () => {
    const { app } = await makeApp();
    const { ctx, out } = makeCtx(app);
    assert.equal(await runCli(['categories'], ctx), 0);
    assert.match(all(out), /CATEGORIES/);
  });
});

describe('categories: add, rename, edit', () => {
  it('adds a category with an icon and colour', async () => {
    const { app, code } = await run(['add', 'Fitness', '--icon', '🏋️', '--color', 'orange']);
    assert.equal(code, 0);
    const fitness = app.categories.find('Fitness').category;
    assert.deepEqual([fitness.icon, fitness.color], ['🏋️', 'orange']);
  });
  it('joins unquoted words into one name', async () => {
    const { app } = await run(['add', 'Gym', 'Stuff']);
    assert.ok(app.categories.find('Gym Stuff').ok);
  });
  it('explains problems', async () => {
    for (const [args, pattern] of [
      [['add'], /needs a name/],
      [['add', 'Transport'], /already have a category/],
      [['add', 'Fitness', '--color', 'ultraviolet'], /isn't one of my colours/],
    ]) {
      const { code, err } = await run(args);
      assert.equal(code, 2);
      assert.match(all(err), pattern);
    }
  });
  it('renames', async () => {
    const { app, code } = await run(['rename', 'Transport', 'Travel']);
    assert.equal(code, 0);
    assert.ok(app.categories.find('Travel').ok);
    assert.equal(app.categories.find('Transport').ok, false);
  });
  it('rename needs both names and a real category', async () => {
    assert.equal((await run(['rename', 'Transport'])).code, 2);
    assert.equal((await run(['rename', 'Nope', 'X'])).code, 2);
    assert.equal((await run(['rename', 'Transport', 'Health'])).code, 2); // name taken
  });
  it('edits icon and colour', async () => {
    const { app, code } = await run(['edit', 'Transport', '--icon', '🚆', '--color', 'purple']);
    assert.equal(code, 0);
    const transport = app.categories.find('Transport').category;
    assert.deepEqual([transport.icon, transport.color], ['🚆', 'purple']);
  });
  it('edit needs something to change', async () => {
    assert.equal((await run(['edit', 'Transport'])).code, 2);
  });
});

describe('categories: delete', () => {
  const withFitness = async () => {
    const { app } = await makeApp();
    app.categories.create({ name: 'Fitness' });
    await runCli(['add', 'gym', '500', '--category', 'fitness', '--yes'], makeCtx(app).ctx);
    return app;
  };
  it('deletes an empty category with --yes', async () => {
    const { app } = await makeApp();
    app.categories.create({ name: 'Temp' });
    assert.equal((await run(['delete', 'Temp', '--yes'], { app })).code, 0);
    assert.equal(app.categories.find('Temp').ok, false);
  });
  it('refuses to delete a category with expenses unless told where they go', async () => {
    const app = await withFitness();
    const { code, err } = await run(['delete', 'Fitness', '--yes'], { app });
    assert.equal(code, 2);
    assert.match(all(err), /1 expense uses "Fitness".*--move-to/);
    assert.ok(app.categories.find('Fitness').ok);
  });
  it('moves the expenses with --move-to', async () => {
    const app = await withFitness();
    const { code, out } = await run(['delete', 'Fitness', '--move-to', 'Other', '--yes'], { app });
    assert.equal(code, 0);
    assert.match(all(out), /1 expense moved to 📦 Other/);
    assert.equal(app.expenses.listRecent(1)[0].category.name, 'Other');
  });
  it('asks where to move them, and to confirm, when interactive', async () => {
    const app = await withFitness();
    // The menu lists every OTHER category; Enter picks the current default (Other, which is last).
    const { code, asked } = await run(['delete', 'Fitness'], { app, interactive: true, answers: ['', 'yes'] });
    assert.equal(code, 0);
    assert.match(asked[0], /Move it to which category/);
    assert.match(asked[1], /Delete Fitness/);
    assert.equal(app.expenses.listRecent(1)[0].category.name, 'Other');
  });
  it('does nothing if you answer No at the confirmation', async () => {
    const app = await withFitness();
    await run(['delete', 'Fitness'], { app, interactive: true, answers: ['', 'no'] });
    assert.ok(app.categories.find('Fitness').ok);
    assert.equal(app.expenses.listRecent(1)[0].category.name, 'Fitness');
  });
  it('does nothing if you walk away from the question', async () => {
    const app = await withFitness();
    const { code } = await run(['delete', 'Fitness'], { app, interactive: true, answers: [] });
    assert.equal(code, 0);
    assert.ok(app.categories.find('Fitness').ok);
  });
  it('will not delete without confirmation when it cannot ask', async () => {
    const { app } = await makeApp();
    app.categories.create({ name: 'Temp' });
    const { code, err } = await run(['delete', 'Temp'], { app });
    assert.equal(code, 2);
    assert.match(all(err), /Add --yes/);
    assert.ok(app.categories.find('Temp').ok);
  });
  it('never deletes Other', async () => {
    const { code, err } = await run(['delete', 'Other', '--yes']);
    assert.equal(code, 2);
    assert.match(all(err), /safety net/);
  });
});

describe('categories: keyword rules', () => {
  it('teaches a keyword, which then changes suggestions', async () => {
    const { app } = await makeApp();
    app.categories.create({ name: 'Fitness' });
    const { code, out } = await run(['teach', 'protein bar', 'Fitness'], { app });
    assert.equal(code, 0);
    assert.match(all(out), /"protein bar" › 🏋️|"protein bar" › 📌 Fitness/);
    assert.equal(app.categories.suggest('protein bar').category.name, 'Fitness');
  });
  it('reports what a keyword used to mean', async () => {
    const { out } = await run(['teach', 'chai', 'Health']);
    assert.match(all(out), /it used to mean Food & Drinks/);
  });
  it('needs a keyword and a category', async () => {
    assert.equal((await run(['teach', 'chai'])).code, 2);
    assert.equal((await run(['teach', 'chai', 'Nowhere'])).code, 2);
  });
  it('forgets a keyword', async () => {
    const { app, code } = await run(['forget', 'chai']);
    assert.equal(code, 0);
    assert.equal(app.categories.suggest('chai').category.name, 'Other');
    assert.equal((await run(['forget', 'chai'], { app })).code, 2); // already gone
    assert.equal((await run(['forget'])).code, 2);
  });
  it('shows only your own rules by default, marked learned or yours', async () => {
    const { app } = await makeApp();
    const fitness = app.categories.create({ name: 'Fitness' }).category;
    app.categories.teach('gym', fitness.id, 'learned');
    app.categories.teach('yoga', fitness.id, 'custom');
    const { out } = await run(['rules'], { app });
    const text = all(out);
    assert.match(text, /gym \(learned\)/);
    assert.match(text, /yoga \(yours\)/);
    assert.ok(!text.includes('chips'), 'built-in keywords are hidden by default');
  });
  it('says so, and how to start, when you have no rules', async () => {
    const { out } = await run(['rules']);
    assert.match(all(out), /haven't taught me any keywords yet/);
    assert.match(all(out), /categories teach/);
  });
  it('shows everything for one category, or for all with --all', async () => {
    const one = all((await run(['rules', 'Food & Snacks'])).out);
    assert.ok(one.includes('kurkure') && one.includes('chips'));
    assert.ok(!one.includes('metro'));
    const everything = all((await run(['rules', '--all'])).out);
    assert.ok(everything.includes('chips') && everything.includes('metro'));
  });
  it('rejects an unknown category for rules', async () => {
    assert.equal((await run(['rules', 'Nope'])).code, 2);
  });
});

describe('categories: misc', () => {
  it('explains an unknown subcommand', async () => {
    const { code, err } = await run(['explode']);
    assert.equal(code, 2);
    assert.match(all(err), /Try one of: list, add, rename/);
  });
});
