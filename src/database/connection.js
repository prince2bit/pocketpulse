// Opens the SQLite database. node:sqlite is imported lazily so commands that
// don't need storage (--help, themes) still work on a Node version without it.

import fs from 'node:fs';
import path from 'node:path';
import { PocketPulseError } from '../utils/errors.js';

export const MIN_NODE_VERSION = '22.13';

/**
 * node:sqlite prints an "ExperimentalWarning" the first time it loads.
 * That's noise for our users, so we hide THAT one warning (and only that
 * one: every other warning still shows).
 */
export function hideSqliteExperimentalWarning() {
  const originalEmit = process.emit;
  process.emit = function patchedEmit(eventName, payload, ...rest) {
    const isSqliteNotice = eventName === 'warning'
      && payload?.name === 'ExperimentalWarning'
      && /sqlite/i.test(payload.message);
    return isSqliteNotice ? false : originalEmit.call(this, eventName, payload, ...rest);
  };
}

async function loadSqlite() {
  try {
    return await import('node:sqlite');
  } catch {
    throw new PocketPulseError(
      `PocketPulse needs Node.js ${MIN_NODE_VERSION} or newer to store your data (you have ${process.versions.node}).`,
      { hint: 'Install a newer Node.js (the nvm tool makes this easy), then run the command again.' },
    );
  }
}

// Turn raw SQLite errors into something a human can act on.
function explainOpenError(error, dbPath) {
  if (/not a database|malformed|corrupt/i.test(error.message)) {
    return new PocketPulseError('Your PocketPulse database file looks damaged.', {
      hint: `File: ${dbPath}\nRename or move it to start fresh (nothing gets deleted), or restore a backup.`,
    });
  }
  return new PocketPulseError(`Couldn't open your PocketPulse database (${error.message}).`, {
    hint: `File: ${dbPath}\nCheck that the folder exists and you have permission to write to it.`,
  });
}

/** Open (creating if needed) the database at `dbPath`. Use ':memory:' for tests. */
export async function openDatabase(dbPath) {
  const { DatabaseSync } = await loadSqlite();

  if (dbPath !== ':memory:') {
    // 0o700: owner-only (no effect on Windows).
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }

  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    // Reading the schema makes a damaged file fail here rather than mid-save.
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (error) {
    try { db?.close(); } catch { /* already closed */ }
    throw explainOpenError(error, dbPath);
  }
  return db;
}

/**
 * Run `work` as ONE all-or-nothing unit. If it throws, every change inside
 * is undone (ROLLBACK), so we never leave the database half-updated.
 */
export function withTransaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Read one setting WITHOUT creating anything. Used at startup (to find your
 * saved colour theme). Returns null if there's no database yet or anything
 * goes wrong. Startup must never fail because of this.
 */
export async function peekSetting(dbPath, key) {
  if (!fs.existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
