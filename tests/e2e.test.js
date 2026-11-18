// End-to-end: run the REAL program as a separate process, the way a person
// would. This is the only place index.js (the wiring that connects the real
// terminal, files and database) gets exercised.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENTRY = path.resolve(import.meta.dirname, '..', 'src', 'index.js');
const VERSION = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

let home;
before(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketpulse-e2e-')); });
after(() => fs.rmSync(home, { recursive: true, force: true }));

function pocketpulse(args, { env = {}, folder = home } = {}) {
  const base = { ...process.env, POCKETPULSE_HOME: folder, LANG: 'en_US.UTF-8' };
  delete base.FORCE_COLOR; // the test runner may set it, and Node warns if it meets NO_COLOR
  delete base.NO_COLOR;
  delete base.POCKETPULSE_THEME;
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: 'utf8', env: { ...base, NO_COLOR: '1', ...env }, timeout: 15_000,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe('the real program', () => {
  it('prints its version', () => {
    const { code, out } = pocketpulse(['--version']);
    assert.equal(code, 0);
    assert.equal(out.trim(), `PocketPulse v${VERSION}`);
  });
  it('shows the friendly first-use dashboard when run with no terminal and no data', () => {
    const { code, out } = pocketpulse([], { folder: fs.mkdtempSync(path.join(os.tmpdir(), 'pp-empty-')) });
    assert.equal(code, 0);
    assert.match(out, /No expenses yet/);
    assert.match(out, /What would you like to do\?/);
  });
  it('--help works without touching the database', () => {
    const fresh = path.join(home, 'never-created');
    const { code, out } = pocketpulse(['--help'], { folder: fresh });
    assert.equal(code, 0);
    assert.match(out, /COMMANDS/);
    assert.ok(!fs.existsSync(fresh), 'help must not create the data folder');
  });
  it('saves an expense, creating the database in the data folder (not in the project)', () => {
    const { code, out } = pocketpulse(['add', 'bought', 'a', 'notebook', 'for', '65', '--yes']);
    assert.equal(code, 0);
    assert.match(out, /Saved\s+notebook\s+₹65\.00\s+🎓 College & Study/);
    assert.ok(fs.existsSync(path.join(home, 'pocketpulse.db')));
    assert.ok(!fs.existsSync(path.resolve(import.meta.dirname, '..', 'pocketpulse.db')));
  });
  it('remembers it in a second, separate run (persistence)', () => {
    pocketpulse(['add', 'chips', '20', '--yes']);
    const { out } = pocketpulse(['list']);
    assert.match(out, /notebook/);
    assert.match(out, /chips/);
    assert.match(out, /Showing 2 of 2/);
  });
  it('shows the data on the dashboard and on the today screen', () => {
    const dashboard = pocketpulse(['dashboard']).out;
    assert.match(dashboard, /₹85\.00/);
    assert.match(dashboard, /Recent activity/);
    const today = pocketpulse(['today']).out;
    assert.match(today, /Today · /);
    assert.match(today, /notebook/);
  });
  it('plain "pocketpulse" with data shows the dashboard', () => {
    const { code, out } = pocketpulse([]);
    assert.equal(code, 0);
    assert.match(out, /Where it went/);
  });
  it('shows weekly, monthly, range and trend analytics from real saved data', () => {
    const week = pocketpulse(['week']);
    assert.equal(week.code, 0);
    assert.match(week.out, /This week ·/);
    assert.match(week.out, /TOTAL/);
    assert.match(week.out, /notebook ₹65\.00/);
    assert.match(pocketpulse(['week', '--previous']).out, /Last week ·/);
    const month = pocketpulse(['month']);
    assert.match(month.out, /This month ·/);
    assert.match(month.out, /Week by week/);
    assert.match(pocketpulse(['range', 'yesterday', 'today']).out, /Custom range ·/);
    assert.match(pocketpulse(['trends']).out, /Trend · weekly · INR/);
    assert.match(pocketpulse(['week', '--category', 'college']).out, /Only\s+🎓 College & Study/);
  });
  it('reports analytics mistakes with exit code 2 and no stack trace', () => {
    for (const args of [['week', 'abc'], ['month', '2026-13'], ['range', '2026-11-20', '2026-11-01'], ['trends', '--weeks', '0'], ['week', '--category', 'zzz']]) {
      const { code, err, out } = pocketpulse(args);
      assert.equal(code, 2, args.join(' '));
      assert.match(err, /✖/);
      assert.equal(out, '');
      assert.ok(!/\.js:\d+/.test(err));
    }
  });
  it('reports a bad currency on the dashboard with exit code 2', () => {
    const { code, err } = pocketpulse(['dashboard', '--currency', 'xyz']);
    assert.equal(code, 2);
    assert.match(err, /isn't a supported currency/);
  });
  it('suggests the right command for a typo', () => {
    const { code, err } = pocketpulse(['dashbord']);
    assert.equal(code, 2);
    assert.match(err, /Did you mean pocketpulse dashboard\?/);
  });
  it('remembers a theme across runs, and the flag overrides it for one run', () => {
    assert.equal(pocketpulse(['settings', 'theme', 'ocean']).code, 0);
    const colour = { NO_COLOR: undefined, FORCE_COLOR: '3' };
    const saved = pocketpulse([], { env: colour }).out;
    assert.ok(saved.includes('\u001b[38;2;40;140;255m'), 'ocean starts blue'); // the pulse default would start 182;255;0
    const flagged = pocketpulse(['--theme', 'sunset'], { env: colour }).out;
    assert.ok(flagged.includes('\u001b[38;2;255;190;50m'), 'sunset starts amber');
  });
  it('explains a damaged database instead of crashing', () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-broken-'));
    fs.writeFileSync(path.join(broken, 'pocketpulse.db'), 'definitely not a database file, just text. '.repeat(20));
    const { code, err } = pocketpulse(['list'], { folder: broken });
    assert.equal(code, 1);
    assert.match(err, /looks damaged/);
    assert.ok(!/\.js:\d+/.test(err), 'no stack trace for the user');
    fs.rmSync(broken, { recursive: true, force: true });
  });
  it('stops quietly when the reader of its output hangs up (like "pocketpulse | head")', async () => {
    // Deterministic version: the reader hangs up BEFORE we print anything, so
    // our first write is guaranteed to hit a closed pipe.
    const env = { ...process.env, POCKETPULSE_HOME: home, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const child = spawn(process.execPath, [ENTRY, 'dashboard'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.destroy();
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => { child.on('close', resolve); });
    assert.ok(!/EPIPE|node:events/.test(stderr), `ugly error leaked: ${stderr}`);
    assert.equal(code, 0);
  });
});
