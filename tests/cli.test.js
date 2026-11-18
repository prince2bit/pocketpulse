import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, closestCommand, runCli } from '../src/cli/commands.js';
import { THEMES, createTheme } from '../src/ui/theme.js';
import { makeApp } from './helpers.js';

// Build a fake context that records what the app prints.
function setup() {
  let app;
  const out = [];
  const err = [];
  const ctx = {
    theme: createTheme({ env: {}, colorLevel: 0, unicode: true }),
    version: '9.9.9',
    columns: 100,
    write: (line = '') => out.push(line),
    error: (line = '') => err.push(line),
    // The home screen reads from the database; give it a throwaway one (created on first use).
    getApp: async () => { app ??= (await makeApp()).app; return app; },
  };
  return { ctx, out, err };
}

describe('runCli', () => {
  it('shows the welcome screen with no arguments', async () => {
    const { ctx, out } = setup();
    assert.equal(await runCli([], ctx), 0);
    assert.match(out.join('\n'), /Your money\. Your rules\. Your pace\./);
    assert.match(out.join('\n'), /What would you like to do\?/);
  });

  it('--version prints the version we give it', async () => {
    const { ctx, out } = setup();
    assert.equal(await runCli(['--version'], ctx), 0);
    assert.deepEqual(out, ['PocketPulse v9.9.9']);
  });

  it('--help lists every registered command', async () => {
    const { ctx, out } = setup();
    assert.equal(await runCli(['--help'], ctx), 0);
    const text = out.join('\n');
    for (const command of COMMANDS) assert.ok(text.includes(command.name), `help is missing "${command.name}"`);
  });

  it('suggests the closest command for a typo and exits with code 2', async () => {
    const { ctx, err } = setup();
    assert.equal(await runCli(['weak'], ctx), 2);
    assert.match(err.join('\n'), /Did you mean pocketpulse week\?/);
  });

  it('does not suggest anything for gibberish', async () => {
    const { ctx, err } = setup();
    assert.equal(await runCli(['zzzzzzzz'], ctx), 2);
    assert.ok(!err.join('\n').includes('Did you mean'));
  });

  it('is honest about commands that are not available yet (exit code 1, not a fake success)', async () => {
    const { ctx, err } = setup();
    assert.equal(await runCli(['export'], ctx), 1);
    assert.match(err.join('\n'), /isn't available yet.*planned/);
  });

  it('shows per-command help with --help after the command name', async () => {
    const { ctx, out } = setup();
    assert.equal(await runCli(['week', '--help'], ctx), 0);
    assert.match(out.join('\n'), /USAGE\s+pocketpulse week/);
  });

  it('treats command names case-insensitively', async () => {
    const { ctx } = setup();
    assert.equal(await runCli(['EXPORT'], ctx), 1); // found (not "unknown", which would be 2)
  });
});

describe('themes command and --theme flag', () => {
  it('lists every theme and exits 0', async () => {
    const { ctx, out } = setup();
    assert.equal(await runCli(['themes'], ctx), 0);
    for (const name of Object.keys(THEMES)) assert.ok(out.join('\n').includes(name), `missing ${name}`);
  });
  it('does not mistake the value of --theme for a command', async () => {
    const { ctx, out } = setup();
    assert.equal(await runCli(['--theme', 'ocean'], ctx), 0); // welcome screen, not "unknown command ocean"
    assert.match(out.join('\n'), /What would you like to do\?/);
    const second = setup();
    assert.equal(await runCli(['--theme=ocean', 'themes'], second.ctx), 0);
  });
  it('marks the theme currently in use', async () => {
    const { ctx, out } = setup();
    ctx.theme = createTheme({ env: {}, colorLevel: 0, unicode: true, themeName: 'grape' });
    await runCli(['themes'], ctx);
    assert.match(out.find((line) => line.includes('grape')), /^› grape/); // the pointer marks the active theme
    assert.match(out.find((line) => line.includes('ocean')), /^ {2}ocean/);
    assert.ok(out.includes('Current theme: grape'));
  });
});

describe('router hands each command its own arguments', () => {
  it('passes flags and words through, minus the command name itself', async () => {
    let received;
    const command = COMMANDS.find((c) => c.name === 'themes');
    const original = command.run;
    command.run = async (args) => { received = args; return 0; };
    try {
      const { ctx } = setup();
      await runCli(['--theme', 'ocean', 'themes', 'a', '--flag', 'b'], ctx);
      assert.deepEqual(received, ['--theme', 'ocean', 'a', '--flag', 'b']);
    } finally {
      command.run = original;
    }
  });
});

describe('themes list fits the window', () => {
  for (const columns of [60, 70, 80, 100, 140]) {
    it(`at ${columns} columns no line is wider than the window, and every theme is listed`, async () => {
      const { ctx, out } = setup();
      ctx.columns = columns;
      await runCli(['themes'], ctx);
      for (const line of out) assert.ok([...line].length <= columns, `${[...line].length} > ${columns}: ${line}`);
      for (const name of Object.keys(THEMES)) assert.ok(out.some((line) => line.includes(name)), `${name} missing`);
    });
  }
  it('shrinks the colour swatch (not the descriptions) so full descriptions stay readable at 70 and 80 columns', async () => {
    for (const columns of [70, 80]) {
      const { ctx, out } = setup();
      ctx.columns = columns;
      await runCli(['themes'], ctx);
      for (const { description } of Object.values(THEMES)) {
        assert.ok(out.some((line) => line.includes(description)), `"${description}" was clipped at ${columns} columns`);
      }
    }
  });
  it('still shows the pointer for the active theme at 80 columns (it used to be pushed off the edge)', async () => {
    const { ctx, out } = setup();
    ctx.theme = createTheme({ env: {}, colorLevel: 0, unicode: true, themeName: 'ocean' });
    await runCli(['themes'], ctx);
    assert.match(out.find((line) => line.includes('ocean')), /^› ocean/);
  });
});

describe('closestCommand', () => {
  it('finds near-misses', () => {
    assert.equal(closestCommand('mnth'), 'month');
    assert.equal(closestCommand('lsit'), 'list');
    assert.equal(closestCommand('settngs'), 'settings');
  });
  it('returns null when nothing is close', () => {
    assert.equal(closestCommand('banana'), null);
  });
});
