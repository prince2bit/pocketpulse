import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database/connection.js';
import { LATEST_VERSION, migrate } from '../src/database/migrations.js';

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const addOldExpense = (db, description, amount) => db.prepare(
  'INSERT INTO expenses (description, amount_minor, currency, spent_at_utc, time_zone, local_date, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)',
).run(description, amount, 'INR', '2026-11-01T10:00:00.000Z', 'Asia/Kolkata', '2026-11-01', '2026-11-01T10:00:00.000Z');

describe('upgrading an older database (schema version 1)', () => {
  it('keeps every existing expense exactly as it was and puts it in Other', async () => {
    const db = await openDatabase(':memory:');
    migrate(db, { targetVersion: 1 }); // a version-1 database
    assert.equal(version(db), 1);
    addOldExpense(db, 'chips', 2000);
    addOldExpense(db, 'bus', 3050);

    assert.deepEqual(migrate(db), { from: 1, to: LATEST_VERSION }); // the upgrade
    assert.equal(version(db), LATEST_VERSION);

    const rows = db.prepare('SELECT e.description, e.amount_minor, e.currency, e.local_date, c.name AS category FROM expenses e JOIN categories c ON c.id = e.category_id ORDER BY e.id').all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { description: 'chips', amount_minor: 2000, currency: 'INR', local_date: '2026-11-01', category: 'Other' },
      { description: 'bus', amount_minor: 3050, currency: 'INR', local_date: '2026-11-01', category: 'Other' },
    ]);
    db.close();
  });
  it('upgrades an empty version-1 database too, and seeds the categories', async () => {
    const db = await openDatabase(':memory:');
    migrate(db, { targetVersion: 1 });
    migrate(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM categories').get().n, 10);
    assert.ok(db.prepare('SELECT count(*) AS n FROM category_rules').get().n > 200);
    db.close();
  });
  it('does not seed twice if run again', async () => {
    const db = await openDatabase(':memory:');
    migrate(db);
    migrate(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM categories').get().n, 10);
    db.close();
  });
  it('is all-or-nothing: a failure leaves the version-1 database untouched', async () => {
    const db = await openDatabase(':memory:');
    migrate(db, { targetVersion: 1 });
    addOldExpense(db, 'chips', 2000);
    db.exec('CREATE TABLE categories (oops TEXT)'); // sabotage: migration 2 will collide with this
    assert.throws(() => migrate(db));
    assert.equal(version(db), 1);
    const columns = db.prepare("PRAGMA table_info('expenses')").all().map((c) => c.name);
    assert.ok(!columns.includes('category_id'), 'the new column must be rolled back');
    assert.equal(db.prepare('SELECT count(*) AS n FROM expenses').get().n, 1);
    db.close();
  });
});

describe('the new tables enforce their own rules', () => {
  const fresh = async () => {
    const db = await openDatabase(':memory:');
    migrate(db);
    return db;
  };
  const addCategory = (db, name) => db.prepare("INSERT INTO categories (name, icon, color, created_at_utc) VALUES (?, '📌', 'cyan', 'now')").run(name);
  const addRule = (db, categoryId, norm, source = 'custom') => db.prepare("INSERT INTO category_rules (category_id, keyword, keyword_norm, source, created_at_utc) VALUES (?, ?, ?, ?, 'now')").run(categoryId, norm, norm, source);

  it('category names are unique ignoring capitals', async () => {
    const db = await fresh();
    addCategory(db, 'Fitness');
    assert.throws(() => addCategory(db, 'fitness'), /UNIQUE/);
    db.close();
  });
  it('a keyword can mean only one thing', async () => {
    const db = await fresh();
    const { lastInsertRowid: id } = addCategory(db, 'Fitness');
    addRule(db, id, 'gym');
    assert.throws(() => addRule(db, id, 'gym'), /UNIQUE/);
    db.close();
  });
  it('rule sources are limited to the three known kinds', async () => {
    const db = await fresh();
    const { lastInsertRowid: id } = addCategory(db, 'Fitness');
    assert.throws(() => addRule(db, id, 'gym', 'telepathy'), /CHECK/);
    db.close();
  });
  it('deleting a category deletes its rules', async () => {
    const db = await fresh();
    const { lastInsertRowid: id } = addCategory(db, 'Fitness');
    addRule(db, id, 'gym');
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    assert.equal(db.prepare("SELECT count(*) AS n FROM category_rules WHERE keyword_norm = 'gym'").get().n, 0);
    db.close();
  });
  it('an expense cannot point at a category that does not exist', async () => {
    const db = await fresh();
    assert.throws(() => db.prepare(
      "INSERT INTO expenses (description, amount_minor, currency, spent_at_utc, time_zone, local_date, created_at_utc, category_id) VALUES ('x', 1, 'INR', 't', 'UTC', 'd', 't', 9999)",
    ).run(), /FOREIGN KEY/);
    db.close();
  });
});
