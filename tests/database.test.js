import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase, peekSetting } from '../src/database/connection.js';
import { LATEST_VERSION, MIGRATIONS, migrate } from '../src/database/migrations.js';
import { getDataDir, getDatabasePath } from '../src/database/paths.js';
import { PocketPulseError } from '../src/utils/errors.js';
import { makeApp } from './helpers.js';

// Real files for a few tests, in a temp folder deleted afterwards.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketpulse-test-'));
after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
const tempFile = (name) => path.join(tempRoot, name);

const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

describe('where the data lives', () => {
  const home = '/home/sam';
  it('uses POCKETPULSE_HOME when set', () => {
    assert.equal(getDataDir({ env: { POCKETPULSE_HOME: '/data/pp' }, platform: 'linux', homedir: home }), path.resolve('/data/pp'));
  });
  it('follows each operating system\'s convention', () => {
    assert.equal(getDataDir({ env: { APPDATA: 'C:\\Users\\Sam\\AppData\\Roaming' }, platform: 'win32', homedir: home }),
      path.join('C:\\Users\\Sam\\AppData\\Roaming', 'PocketPulse'));
    assert.equal(getDataDir({ env: {}, platform: 'darwin', homedir: home }), path.join(home, 'Library', 'Application Support', 'PocketPulse'));
    assert.equal(getDataDir({ env: { XDG_DATA_HOME: '/xdg' }, platform: 'linux', homedir: home }), path.join('/xdg', 'pocketpulse'));
    assert.equal(getDataDir({ env: {}, platform: 'linux', homedir: home }), path.join(home, '.local', 'share', 'pocketpulse'));
  });
  it('keeps the database file outside the source tree', () => {
    const projectRoot = path.resolve(import.meta.dirname, '..');
    assert.ok(!getDatabasePath({ env: {}, platform: 'linux', homedir: home }).startsWith(projectRoot));
  });
});

describe('migrations', () => {
  it('builds a fresh database up to the latest version', async () => {
    const db = await openDatabase(':memory:');
    assert.deepEqual(migrate(db), { from: 0, to: LATEST_VERSION });
    assert.equal(version(db), LATEST_VERSION);
    assert.ok(tableNames(db).includes('expenses'));
    assert.ok(tableNames(db).includes('settings'));
    db.close();
  });
  it('is safe to run again and again', async () => {
    const db = await openDatabase(':memory:');
    migrate(db);
    assert.deepEqual(migrate(db), { from: LATEST_VERSION, to: LATEST_VERSION });
    db.close();
  });
  it('refuses a database from a newer PocketPulse, without touching it', async () => {
    const db = await openDatabase(':memory:');
    migrate(db);
    db.exec('PRAGMA user_version = 99');
    assert.throws(() => migrate(db), (error) => error instanceof PocketPulseError && /newer version/.test(error.message));
    assert.equal(version(db), 99);
    db.close();
  });
  it('rolls back completely when a migration fails halfway', async () => {
    const db = await openDatabase(':memory:');
    migrate(db);
    MIGRATIONS.push({ version: LATEST_VERSION + 1, name: 'broken', sql: 'CREATE TABLE half_done (x); THIS IS NOT SQL;' });
    try {
      assert.throws(() => migrate(db, { targetVersion: LATEST_VERSION + 1 }));
    } finally {
      MIGRATIONS.pop();
    }
    assert.ok(!tableNames(db).includes('half_done'), 'the half-finished table must be undone');
    assert.equal(version(db), LATEST_VERSION);
    db.close();
  });
});

describe('database rules (a second line of defence behind validation)', () => {
  const insert = (db, overrides = {}) => {
    const row = { description: 'chips', amount: 2000, currency: 'INR', ...overrides };
    db.prepare('INSERT INTO expenses (description, amount_minor, currency, spent_at_utc, time_zone, local_date, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.description, row.amount, row.currency, '2026-01-01T00:00:00Z', 'UTC', '2026-01-01', '2026-01-01T00:00:00Z');
  };
  it('refuses zero and negative amounts, empty descriptions and bad currency codes', async () => {
    const { app } = await makeApp();
    insert(app.db); // a valid row works
    assert.throws(() => insert(app.db, { amount: 0 }));
    assert.throws(() => insert(app.db, { amount: -5 }));
    assert.throws(() => insert(app.db, { description: '' }));
    assert.throws(() => insert(app.db, { currency: 'RUPEES' }));
    app.close();
  });
  it('stores hostile text as plain text: SQL injection does not work', async () => {
    const { app } = await makeApp();
    const nasty = "Robert'); DROP TABLE expenses;--";
    const saved = app.expenses.save(app.expenses.validate({ description: nasty, amount: '5' }).draft);
    assert.equal(saved.description, nasty);
    assert.equal(app.expenses.count(), 1); // the table still exists and has our row
    app.close();
  });
});

describe('persistence and damaged files', () => {
  it('keeps data after the app is closed and reopened (a "restart")', async () => {
    const file = tempFile('persist.db');
    const first = await createApp({ dbPath: file, clock: () => new Date('2026-11-12T10:00:00Z'), systemTimeZone: () => 'UTC' });
    first.expenses.save(first.expenses.validate({ description: 'chips', amount: '20' }).draft);
    first.settings.setDefaultCurrency('USD');
    first.close();

    const second = await createApp({ dbPath: file, systemTimeZone: () => 'UTC' });
    assert.equal(second.expenses.count(), 1);
    assert.equal(second.expenses.listRecent(1)[0].description, 'chips');
    assert.equal(second.settings.getDefaultCurrency(), 'USD');
    second.close();
  });
  it('creates missing folders on the way', async () => {
    const file = path.join(tempRoot, 'deep', 'er', 'still', 'pp.db');
    const app = await createApp({ dbPath: file, systemTimeZone: () => 'UTC' });
    app.close();
    assert.ok(fs.existsSync(file));
  });
  it('explains a damaged database file in plain language instead of crashing', async () => {
    const file = tempFile('garbage.db');
    fs.writeFileSync(file, 'this is definitely not a sqlite database file, just some text. '.repeat(10));
    await assert.rejects(openDatabase(file), (error) =>
      error instanceof PocketPulseError && /damaged/.test(error.message) && error.hint.includes(file));
  });
  it('peekSetting reads without creating anything, and never throws', async () => {
    const missing = tempFile('does-not-exist.db');
    assert.equal(await peekSetting(missing, 'theme'), null);
    assert.ok(!fs.existsSync(missing), 'peeking must not create the file');

    const file = tempFile('peek.db');
    const app = await createApp({ dbPath: file, systemTimeZone: () => 'UTC' });
    app.settings.setTheme('grape');
    app.close();
    assert.equal(await peekSetting(file, 'theme'), 'grape');
    assert.equal(await peekSetting(file, 'nothing-here'), null);

    const garbage = tempFile('garbage2.db');
    fs.writeFileSync(garbage, 'not a database at all, not even close, honestly. '.repeat(10));
    assert.equal(await peekSetting(garbage, 'theme'), null);
  });
});
