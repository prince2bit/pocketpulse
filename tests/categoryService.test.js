import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { CATEGORY_SEED } from '../src/database/seeds/categoriesV1.js';
import { CATEGORY_COLORS } from '../src/ui/theme.js';
import { canonicalize } from '../src/utils/text.js';
import { makeApp } from './helpers.js';

const nameOf = (app, text) => app.categories.suggest(text).category.name;
const idOf = (app, name) => app.categories.find(name).category.id;

describe('starter categories', () => {
  it('has exactly the ten required categories, with Other last', async () => {
    const { app } = await makeApp();
    assert.deepEqual(app.categories.list().map((c) => c.name), [
      'Food & Snacks', 'Food & Drinks', 'Transport', 'College & Study', 'Entertainment',
      'Shopping', 'Personal Care', 'Health', 'Bills & Recharge', 'Other']);
  });
  it('has exactly one undeletable fallback, and it is Other', async () => {
    const { app } = await makeApp();
    const fallbacks = app.categories.list().filter((c) => c.isFallback);
    assert.deepEqual(fallbacks.map((c) => c.name), ['Other']);
  });
  it('gives every category an icon and a valid colour', async () => {
    const { app } = await makeApp();
    for (const c of app.categories.list()) {
      assert.ok(c.icon, `${c.name} needs an icon`);
      assert.ok(Object.hasOwn(CATEGORY_COLORS, c.color), `${c.name} has unknown colour ${c.color}`);
    }
  });
  it('loads EVERY seeded keyword: none is silently dropped as a duplicate', async () => {
    const { app } = await makeApp();
    const listed = CATEGORY_SEED.flatMap((c) => c.keywords);
    const distinct = new Set(listed.map(canonicalize));
    assert.equal(distinct.size, listed.length, 'two seed keywords collapse to the same canonical form');
    const stored = app.categories.list().reduce((sum, c) => sum + c.ruleCount, 0);
    assert.equal(stored, listed.length);
  });
});

describe('suggestions for the required examples', () => {
  const expectations = {
    'Food & Snacks': ['chips', 'Kurkure', 'lays', 'biscuits'],
    'Food & Drinks': ['chai', 'coffee', 'samosa', 'groceries'],
    Transport: ['bus', 'train', 'metro', 'auto'],
    'College & Study': ['notebook', 'pen', 'books', 'printing', 'college printout'],
    'Bills & Recharge': ['recharge', 'mobile data', 'internet'],
    Entertainment: ['movie', 'game', 'streaming'],
    'Personal Care': ['shampoo', 'soap', 'toothpaste'],
  };
  for (const [category, words] of Object.entries(expectations)) {
    it(`${category}: ${words.join(', ')}`, async () => {
      const { app } = await makeApp();
      for (const word of words) assert.equal(nameOf(app, word), category, word);
    });
  }
  it('ignores capitals, punctuation and plurals', async () => {
    const { app } = await makeApp();
    for (const text of ['CHIPS', 'chips!', 'Chip', 'chips,']) assert.equal(nameOf(app, text), 'Food & Snacks', text);
    assert.equal(nameOf(app, 'Samosas'), 'Food & Drinks');
  });
  it('falls back to Other, with "none" confidence, when nothing matches', async () => {
    const { app } = await makeApp();
    const result = app.categories.suggest('protein bar');
    assert.equal(result.category.name, 'Other');
    assert.equal(result.confidence, 'none');
  });
  it('is flagged low-confidence with alternatives when words disagree', async () => {
    const { app } = await makeApp();
    const result = app.categories.suggest('chips and chai');
    assert.equal(result.confidence, 'low');
    assert.deepEqual(result.alternatives.map((c) => c.name), ['Food & Drinks']);
  });
  it('lets a longer phrase beat a shorter word', async () => {
    const { app } = await makeApp();
    assert.equal(nameOf(app, 'water bottle'), 'Shopping');
    assert.equal(nameOf(app, 'water'), 'Food & Drinks');
  });
});

describe('creating, renaming and styling categories', () => {
  it('creates a category with a default icon and an automatic colour', async () => {
    const { app } = await makeApp();
    const result = app.categories.create({ name: 'Fitness' });
    assert.equal(result.ok, true);
    assert.equal(result.category.icon, '📌');
    assert.ok(Object.hasOwn(CATEGORY_COLORS, result.category.color));
    assert.equal(app.categories.list().at(-1).name, 'Other', 'Other stays last');
  });
  it('accepts a chosen icon and colour, cleaning up the name', async () => {
    const { app } = await makeApp();
    const { category } = app.categories.create({ name: '  Gym \t  Stuff ', icon: '🏋️', color: 'Orange' });
    assert.deepEqual([category.name, category.icon, category.color], ['Gym Stuff', '🏋️', 'orange']);
  });
  it('rejects bad input with a friendly message', async () => {
    const { app } = await makeApp();
    const reject = (input, pattern) => {
      const result = app.categories.create(input);
      assert.equal(result.ok, false);
      assert.match(result.error, pattern);
    };
    reject({ name: '' }, /needs a name/);
    reject({ name: '   ' }, /needs a name/);
    reject({ name: 'x'.repeat(31) }, /up to 30 characters/);
    reject({ name: 'food & snacks' }, /already have a category called "Food & Snacks"/); // any capitals
    reject({ name: 'Fitness', color: 'ultraviolet' }, /isn't one of my colours/);
    reject({ name: 'Fitness', icon: 'way too long to be one icon' }, /just one emoji/);
    reject({ name: 'Fitness', icon: '  ' }, /can't be empty/);
    assert.equal(app.categories.list().length, 10, 'nothing was created');
  });
  it('renames, keeping the id and every expense', async () => {
    const { app } = await makeApp();
    const { category } = app.categories.create({ name: 'Fitness' });
    app.expenses.save(app.expenses.validate({ description: 'gym', amount: '500', categoryId: category.id }).draft);
    const renamed = app.categories.update(category.id, { name: 'Gym & Fitness' });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.category.id, category.id);
    assert.equal(renamed.category.expenseCount, 1);
    assert.equal(app.expenses.listRecent(1)[0].category.name, 'Gym & Fitness');
  });
  it('lets a category change only the capitals of its own name, but not steal another\'s', async () => {
    const { app } = await makeApp();
    const { category } = app.categories.create({ name: 'Fitness' });
    assert.equal(app.categories.update(category.id, { name: 'FITNESS' }).ok, true);
    assert.equal(app.categories.update(category.id, { name: 'transport' }).ok, false);
  });
  it('changes only the fields you give', async () => {
    const { app } = await makeApp();
    const { category } = app.categories.create({ name: 'Fitness', icon: '🏋️', color: 'orange' });
    const result = app.categories.update(category.id, { color: 'cyan' });
    assert.deepEqual([result.category.name, result.category.icon, result.category.color], ['Fitness', '🏋️', 'cyan']);
    assert.equal(app.categories.update(category.id, { color: 'nope' }).ok, false);
    assert.equal(app.categories.update(9999, { name: 'x' }).ok, false);
  });
  it('finds categories by exact name, unique partial name, and explains ambiguity', async () => {
    const { app } = await makeApp();
    assert.equal(app.categories.find('transport').category.name, 'Transport');
    assert.equal(app.categories.find('recharge').category.name, 'Bills & Recharge');
    assert.match(app.categories.find('food').error, /Food & Snacks, Food & Drinks/);
    assert.match(app.categories.find('zzz').error, /don't have a category called "zzz"/);
    assert.equal(app.categories.find('').ok, false);
  });
});

describe('deleting categories', () => {
  const withExpense = async () => {
    const { app } = await makeApp();
    const { category } = app.categories.create({ name: 'Fitness' });
    app.categories.teach('protein bar', category.id);
    app.expenses.save(app.expenses.validate({ description: 'gym', amount: '500', categoryId: category.id }).draft);
    return { app, category };
  };
  it('refuses to delete a category that has expenses unless they are given somewhere to go', async () => {
    const { app, category } = await withExpense();
    const result = app.categories.delete(category.id);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'needs-reassign');
    assert.equal(result.expenseCount, 1);
    assert.ok(app.categories.get(category.id), 'still there');
    assert.equal(app.categories.get(category.id).expenseCount, 1);
  });
  it('moves the expenses and removes the category and its rules, together', async () => {
    const { app, category } = await withExpense();
    const other = app.categories.getFallback();
    const result = app.categories.delete(category.id, { moveTo: other.id });
    assert.equal(result.ok, true);
    assert.equal(result.moved, 1);
    assert.equal(app.categories.get(category.id), null);
    assert.equal(app.expenses.listRecent(1)[0].category.name, 'Other');
    assert.equal(app.categories.listRules({ mineOnly: true }).length, 0, 'its rules went with it');
  });
  it('deletes an empty category without needing a destination', async () => {
    const { app } = await makeApp();
    const { category } = app.categories.create({ name: 'Temp' });
    assert.equal(app.categories.delete(category.id).ok, true);
  });
  it('can delete a built-in category (only the fallback is protected)', async () => {
    const { app } = await makeApp();
    assert.equal(app.categories.delete(idOf(app, 'Entertainment')).ok, true);
  });
  it('never deletes the fallback', async () => {
    const { app } = await makeApp();
    const result = app.categories.delete(app.categories.getFallback().id);
    assert.equal(result.ok, false);
    assert.match(result.error, /safety net/);
  });
  it('refuses silly destinations', async () => {
    const { app, category } = await withExpense();
    assert.match(app.categories.delete(category.id, { moveTo: category.id }).error, /different category/);
    assert.match(app.categories.delete(category.id, { moveTo: 9999 }).error, /doesn't exist/);
    assert.equal(app.categories.get(category.id).expenseCount, 1, 'nothing moved');
    assert.equal(app.categories.delete(9999).ok, false);
  });
  it('the database itself also refuses (second line of defence)', async () => {
    const { app, category } = await withExpense();
    assert.throws(() => app.db.prepare('DELETE FROM categories WHERE id = ?').run(category.id), /FOREIGN KEY/);
  });
});

describe('teaching and forgetting keywords', () => {
  it('a taught keyword changes future suggestions', async () => {
    const { app } = await makeApp();
    const fitness = app.categories.create({ name: 'Fitness' }).category;
    assert.equal(nameOf(app, 'protein bar'), 'Other');
    const result = app.categories.teach('Protein Bar', fitness.id);
    assert.equal(result.ok, true);
    assert.equal(nameOf(app, 'protein bar'), 'Fitness');
    assert.equal(nameOf(app, 'PROTEIN BARS'), 'Fitness'); // plural and capitals still match
    assert.equal(app.categories.suggest('protein bar').source, 'custom');
  });
  it('records where a rule came from: custom or learned', async () => {
    const { app } = await makeApp();
    const fitness = app.categories.create({ name: 'Fitness' }).category;
    app.categories.teach('gym', fitness.id, 'learned');
    app.categories.teach('yoga', fitness.id);
    const sources = Object.fromEntries(app.categories.listRules({ mineOnly: true }).map((r) => [r.keyword, r.source]));
    assert.deepEqual(sources, { gym: 'learned', yoga: 'custom' });
  });
  it('overrides a built-in meaning, and says what it used to mean', async () => {
    const { app } = await makeApp();
    const health = idOf(app, 'Health');
    const result = app.categories.teach('chai', health);
    assert.equal(result.replaced.categoryName, 'Food & Drinks');
    assert.equal(nameOf(app, 'chai'), 'Health');
    assert.equal(app.categories.listRules({ categoryId: idOf(app, 'Food & Drinks') }).some((r) => r.keyword === 'chai'), false);
  });
  it('your rules always beat built-in ones, even longer built-in phrases', async () => {
    const { app } = await makeApp();
    app.categories.teach('water', idOf(app, 'Health'));
    assert.equal(nameOf(app, 'water bottle'), 'Health');
  });
  it('re-teaching the same thing changes nothing; a built-in becomes explicitly yours', async () => {
    const { app } = await makeApp();
    const drinks = idOf(app, 'Food & Drinks');
    const again = app.categories.teach('chai', drinks);
    assert.equal(again.replaced, null);
    assert.equal(again.rule.source, 'custom'); // was 'default'
    assert.equal(app.categories.teach('chai', drinks).unchanged, true);
  });
  it('rejects empty, punctuation-only, overlong keywords and unknown categories', async () => {
    const { app } = await makeApp();
    const health = idOf(app, 'Health');
    assert.match(app.categories.teach('', health).error, /at least one letter/);
    assert.match(app.categories.teach('!!!', health).error, /at least one letter/);
    assert.match(app.categories.teach('x'.repeat(41), health).error, /up to 40 characters/);
    assert.match(app.categories.teach('gym', 9999).error, /doesn't exist/);
  });
  it('forgets a keyword, including a built-in one', async () => {
    const { app } = await makeApp();
    assert.equal(nameOf(app, 'chai'), 'Food & Drinks');
    assert.equal(app.categories.forget('Chai').ok, true);
    assert.equal(nameOf(app, 'chai'), 'Other');
    assert.match(app.categories.forget('chai').error, /don't have a rule/);
    assert.equal(app.categories.forget('').ok, false);
  });
  it('lists only your own rules when asked', async () => {
    const { app } = await makeApp();
    assert.deepEqual(app.categories.listRules({ mineOnly: true }), []);
    app.categories.teach('gym', idOf(app, 'Health'));
    assert.deepEqual(app.categories.listRules({ mineOnly: true }).map((r) => r.keyword), ['gym']);
    assert.ok(app.categories.listRules().length > 100);
  });
});

describe('persistence', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketpulse-cat-'));
  after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  it('keeps categories, taught rules and categorised expenses after a restart', async () => {
    const file = path.join(tempRoot, 'persist.db');
    const first = await createApp({ dbPath: file, systemTimeZone: () => 'UTC' });
    const fitness = first.categories.create({ name: 'Fitness', icon: '🏋️', color: 'orange' }).category;
    first.categories.teach('protein bar', fitness.id, 'learned');
    first.expenses.save(first.expenses.validate({ description: 'protein bar', amount: '120' }).draft);
    first.close();

    const second = await createApp({ dbPath: file, systemTimeZone: () => 'UTC' });
    assert.equal(second.categories.list().length, 11);
    assert.equal(second.categories.suggest('protein bar').category.name, 'Fitness');
    assert.equal(second.expenses.listRecent(1)[0].category.name, 'Fitness');
    assert.equal(second.categories.listRules({ mineOnly: true })[0].source, 'learned');
    second.close();
  });
});
