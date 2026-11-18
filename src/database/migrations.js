// Versioned schema changes, tracked with SQLite's PRAGMA user_version.
// On startup only migrations newer than the file's version run, each in a
// transaction. Never edit a released migration; add a new one instead.
// A migration is plain `sql`, or an `up(db)` function when it needs code.

import { PocketPulseError } from '../utils/errors.js';
import { canonicalize } from '../utils/text.js';
import { withTransaction } from './connection.js';
import { CATEGORY_SEED } from './seeds/categoriesV1.js';

export const MIGRATIONS = [
  {
    version: 1,
    name: 'settings and expenses',
    sql: `
      -- Simple key/value preferences: default currency, time zone, theme...
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE expenses (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        description    TEXT    NOT NULL CHECK (length(description) BETWEEN 1 AND 100),

        -- Money as a whole number of minor units (paise, cents...). See money.js.
        amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
        currency       TEXT    NOT NULL CHECK (length(currency) = 3),

        -- WHEN: the exact instant in UTC, plus where you were and which
        -- local calendar day it was for you. See dateTime.js.
        spent_at_utc   TEXT    NOT NULL,
        time_zone      TEXT    NOT NULL,
        local_date     TEXT    NOT NULL,

        created_at_utc TEXT    NOT NULL
      );

      -- Indexes make "give me this week/month" fast even with thousands of rows.
      CREATE INDEX idx_expenses_local_date ON expenses (local_date);
      CREATE INDEX idx_expenses_currency   ON expenses (currency);
    `,
  },
  {
    version: 2,
    name: 'categories, keyword rules, and a category on every expense',
    up(db) {
      db.exec(`
        CREATE TABLE categories (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          -- COLLATE NOCASE: "fitness" and "Fitness" count as the same name.
          name           TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 30),
          icon           TEXT    NOT NULL,
          color          TEXT    NOT NULL,
          is_default     INTEGER NOT NULL DEFAULT 0,  -- 1 = came with PocketPulse
          is_fallback    INTEGER NOT NULL DEFAULT 0,  -- 1 = "Other": the safety net, can't be deleted
          created_at_utc TEXT    NOT NULL
        );

        -- A rule says: when a description contains this keyword, suggest this category.
        CREATE TABLE category_rules (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          -- ON DELETE CASCADE: deleting a category removes its rules automatically.
          category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          keyword        TEXT    NOT NULL,                -- as shown to people: "Protein Bar"
          keyword_norm   TEXT    NOT NULL UNIQUE,         -- as matched: "protein bar" (one rule per keyword)
          source         TEXT    NOT NULL CHECK (source IN ('default', 'custom', 'learned')),
          created_at_utc TEXT    NOT NULL
        );
        CREATE INDEX idx_category_rules_category ON category_rules (category_id);

        -- Every expense now points at a category. No ON DELETE rule here, so SQLite
        -- itself refuses to delete a category that still has expenses.
        ALTER TABLE expenses ADD COLUMN category_id INTEGER REFERENCES categories(id);
        CREATE INDEX idx_expenses_category ON expenses (category_id);
      `);

      // Fill in the starter categories and their keywords.
      const now = new Date().toISOString();
      const addCategory = db.prepare(
        'INSERT INTO categories (name, icon, color, is_default, is_fallback, created_at_utc) VALUES (?, ?, ?, 1, ?, ?)',
      );
      // INSERT OR IGNORE: if two keywords ever collapse to the same canonical form, keep the first.
      const addRule = db.prepare(
        "INSERT OR IGNORE INTO category_rules (category_id, keyword, keyword_norm, source, created_at_utc) VALUES (?, ?, ?, 'default', ?)",
      );
      for (const category of CATEGORY_SEED) {
        const { lastInsertRowid } = addCategory.run(category.name, category.icon, category.color, category.fallback ? 1 : 0, now);
        for (const keyword of category.keywords) {
          addRule.run(Number(lastInsertRowid), keyword, canonicalize(keyword), now);
        }
      }

      // Expenses from before categories existed go to "Other" rather than being guessed.
      db.exec('UPDATE expenses SET category_id = (SELECT id FROM categories WHERE is_fallback = 1)');
    },
  },
];

export const LATEST_VERSION = MIGRATIONS.at(-1).version;

/**
 * Bring the database up to date. Safe to call every time the app starts.
 * `targetVersion` lets tests stop part-way (to simulate an older database).
 */
export function migrate(db, { targetVersion = LATEST_VERSION } = {}) {
  const current = db.prepare('PRAGMA user_version').get().user_version;

  if (current > LATEST_VERSION) {
    throw new PocketPulseError('This database was created by a newer version of PocketPulse.', {
      hint: 'Update PocketPulse to the latest version. Your data has not been touched.',
    });
  }

  for (const migration of MIGRATIONS.filter((m) => m.version > current && m.version <= targetVersion)) {
    // Structure change + version bump happen together or not at all.
    withTransaction(db, () => {
      if (migration.up) migration.up(db);
      else db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return { from: current, to: Math.min(targetVersion, LATEST_VERSION) };
}
