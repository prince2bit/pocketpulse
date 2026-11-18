#!/usr/bin/env node
// Entry point: connects the real terminal and database to the app and runs the command.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createApp } from './app.js';
import { runCli } from './cli/commands.js';
import { hideSqliteExperimentalWarning, peekSetting } from './database/connection.js';
import { getDatabasePath } from './database/paths.js';
import { createPrompts } from './ui/prompts.js';
import { createTheme, resolveThemeName } from './ui/theme.js';
import { PocketPulseError } from './utils/errors.js';

hideSqliteExperimentalWarning();

// If the reader closes the pipe early (`pocketpulse | head`), exit quietly instead of throwing EPIPE.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

// Resolve package.json relative to this file so it works from any directory.
function readVersion() {
  const packageUrl = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(packageUrl, 'utf8')).version;
}

async function main() {
  // argv is [node, script, ...args].
  const argv = process.argv.slice(2);
  const dbPath = process.env.POCKETPULSE_DB || getDatabasePath();

  // --theme must be known BEFORE we build the theme, so we peek at it here.
  const { values } = parseArgs({ args: argv, options: { theme: { type: 'string' } }, strict: false });
  const requestedTheme = typeof values.theme === 'string' ? values.theme : undefined;
  if (requestedTheme && !resolveThemeName(requestedTheme)) {
    process.stderr.write(`Unknown theme "${requestedTheme}". Using the default. Run "pocketpulse themes" to see the choices.\n`);
  }

  // Theme priority: --theme flag, then POCKETPULSE_THEME, then your saved choice, then default.
  const savedTheme = requestedTheme || process.env.POCKETPULSE_THEME ? null : await peekSetting(dbPath, 'theme');
  const theme = createTheme({
    themeName: requestedTheme ?? savedTheme ?? undefined,
    ...(argv.includes('--no-color') ? { colorLevel: 0 } : {}),
  });

  // The database and prompts are created lazily, so --help never touches them.
  let app;
  let prompts;
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const ctx = {
    theme,
    version: readVersion(),
    // `||` (not `??`): some terminals report a size of 0, which must count as "unknown" too.
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || undefined,
    interactive,
    // Clear the screen (terminal only).
    clear: () => { if (interactive) process.stdout.write('\x1b[2J\x1b[H'); },
    write: (line = '') => process.stdout.write(`${line}\n`),
    error: (line = '') => process.stderr.write(`${line}\n`),
    getApp: async () => {
      app ??= await createApp({ dbPath });
      return app;
    },
    getPrompts: () => {
      prompts ??= createPrompts({ theme });
      return prompts;
    },
  };

  try {
    return await runCli(argv, ctx);
  } finally {
    prompts?.close(); // release the keyboard so Node can exit
    app?.close();
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode; // lets pending output flush before exiting
  })
  .catch((problem) => {
    if (problem instanceof PocketPulseError) {
      console.error(`✖ ${problem.message}`);
      if (problem.hint) console.error(`  ${problem.hint.replaceAll('\n', '\n  ')}`);
    } else {
      console.error('Something unexpected went wrong inside PocketPulse.');
      console.error(problem.message);
    }
    process.exitCode = 1;
  });
