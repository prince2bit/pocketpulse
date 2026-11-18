// Home screen for a bare `pocketpulse`: logo, dashboard and an arrow-key menu in a
// real terminal (looping back after each action), or a one-shot dashboard when
// piped. The first run asks for a main currency.

import { COMMAND_NAME } from '../config/defaults.js';
import { renderBanner } from '../ui/banner.js';
import { renderDashboard } from '../ui/dashboard.js';
import { THEMES } from '../ui/theme.js';
import { getGreeting } from '../utils/dateTime.js';
import { SUPPORTED_CURRENCIES } from '../utils/money.js';
import { runAdd } from './addCommand.js';
import { runCategories } from './categoriesCommand.js';
import { runToday } from './dashboardCommands.js';
import { runList } from './listCommand.js';
import { browseReport } from './reportCommands.js';
import { runSettings } from './settingsCommand.js';

const FULL_LOGO_MIN_ROWS = 50; // shorter windows get the small logo, so there's room for the menu
const MENU_HEIGHT = 12; // the menu, its question, its hint, and a spare line
const HEADER_HEIGHT_COMPACT = 4;
const HEADER_HEIGHT_FULL = 9;

const MENU_ITEMS = [
  { key: 'quick', label: 'Quick add', note: 'type it like "chips 20"', shortcut: 'q' },
  { key: 'add', label: 'Add an expense', note: 'step by step', shortcut: 'a' },
  { key: 'today', label: "View today's spending", shortcut: 't' },
  { key: 'week', label: 'Weekly analytics', shortcut: 'w' },
  { key: 'month', label: 'Monthly analytics', shortcut: 'm' },
  { key: 'history', label: 'Transaction history', shortcut: 'h' },
  { key: 'categories', label: 'Manage categories', shortcut: 'c' },
  { key: 'settings', label: 'Settings', shortcut: 's' },
  { key: 'exit', label: 'Exit', shortcut: 'x' },
];

/** Logo + greeting + dashboard, sized to the window. */
function drawHome(ctx, app, { forMenu }) {
  const { theme, write, columns } = ctx;
  const rows = ctx.rows ?? 40;
  // Only a window with a menu below needs to save space. A one-shot snapshot
  // (piped output) gets the full logo; the banner shrinks itself on narrow widths.
  const compactLogo = forMenu && rows < FULL_LOGO_MIN_ROWS;

  write(renderBanner(theme, { columns, compact: compactLogo }));
  write('');
  const headerHeight = compactLogo ? HEADER_HEIGHT_COMPACT : HEADER_HEIGHT_FULL;
  const maxRows = forMenu ? rows - headerHeight - MENU_HEIGHT : Infinity;
  write(renderDashboard(theme, app.analytics.dashboard(), { columns, maxRows }));
  write('');
}

const greetingFor = (app) => getGreeting(app.expenses.now(), app.settings.getTimeZone());

/** Not a terminal: show the dashboard once and point at the commands. */
async function showSnapshot(ctx, app) {
  const { theme, write } = ctx;
  drawHome(ctx, app, { forMenu: false });
  write(`${greetingFor(app)}! What would you like to do?`);
  write(`  ${theme.primary(`${COMMAND_NAME} add chips 20`)}   record an expense`);
  write(`  ${theme.primary(`${COMMAND_NAME} today`)}           today's spending`);
  write(`  ${theme.primary(`${COMMAND_NAME} list`)}            your recent expenses`);
  write(`  ${theme.primary(`${COMMAND_NAME} --help`)}          everything else`);
  return 0;
}

/** First launch: say hello and choose a main currency. */
async function firstRunSetup(ctx, app, prompts) {
  const { theme, write, columns } = ctx;
  ctx.clear();
  write(renderBanner(theme, { columns, compact: (ctx.rows ?? 40) < FULL_LOGO_MIN_ROWS }));
  write('');
  write(theme.bold('Welcome to PocketPulse!'));
  write('Everything stays on this computer. First, which currency do you mostly spend in?');
  write(theme.muted(`(Time zone detected: ${app.settings.getTimeZone()}. Change either later with "${COMMAND_NAME} settings".)`));
  write('');
  const picked = await prompts.select(
    'Main currency',
    SUPPORTED_CURRENCIES.map((c) => ({ ...c, label: `${c.code}  ${c.name}` })),
    { defaultIndex: 0 }, // INR
  );
  if (picked) app.settings.setDefaultCurrency(picked.code);
  app.settings.markSetupDone(); // asked once; pressing Esc keeps the default (INR)
}

/** Small submenu: change a setting without leaving the app. */
async function settingsMenu(ctx, app, prompts) {
  const { theme, write } = ctx;
  await runSettings([], ctx);
  write('');
  const pick = await prompts.select('Change something?', [
    { key: 'currency', label: 'Default currency' },
    { key: 'timezone', label: 'Time zone' },
    { key: 'theme', label: 'Colour theme', note: `${Object.keys(THEMES).length} to choose from` },
    { key: 'back', label: 'Back to the menu' },
  ], { defaultIndex: 3 });
  if (!pick || pick.key === 'back') return 0;

  if (pick.key === 'timezone') {
    const zone = await prompts.text('Time zone (like Asia/Kolkata, or "reset")');
    return zone ? runSettings(['timezone', zone], ctx) : 0;
  }
  return runSettings([pick.key], ctx); // currency and theme show their own menus
}

// Returned by actions that already end with their own "back to the menu" choice.
const NO_PAUSE = Symbol('no pause');

/** Run whatever the person picked. */
async function perform(key, ctx, app, prompts) {
  const { theme, write } = ctx;
  switch (key) {
    case 'quick': {
      const text = await prompts.text('What and how much? (like "chips 20")');
      return text ? runAdd([text], ctx) : 0;
    }
    case 'add': return runAdd([], ctx);
    case 'today': return runToday([], ctx);
    case 'week':
    case 'month':
      await browseReport(key, ctx); // has its own "back" option, so no extra pause is needed
      return NO_PAUSE;
    case 'history':
      await runList([], ctx);
      write(theme.muted('Search and filters are coming soon.'));
      return 0;
    case 'categories': return runCategories([], ctx);
    case 'settings': return settingsMenu(ctx, app, prompts);
    default: return 0;
  }
}

export async function runHome(ctx) {
  const app = await ctx.getApp();
  if (!ctx.interactive) return showSnapshot(ctx, app);

  const prompts = ctx.getPrompts();
  if (!app.settings.isSetupDone()) await firstRunSetup(ctx, app, prompts);

  for (;;) {
    ctx.clear();
    drawHome(ctx, app, { forMenu: true });
    const choice = await prompts.select(`${greetingFor(app)}! What would you like to do?`, MENU_ITEMS);
    if (!choice || choice.key === 'exit') {
      ctx.write(ctx.theme.muted('See you soon!'));
      return 0;
    }

    ctx.write('');
    const outcome = await perform(choice.key, ctx, app, prompts);
    if (outcome === NO_PAUSE) continue;
    ctx.write('');
    const again = await prompts.text('Press Enter to go back to the menu');
    if (again === null) return 0; // Ctrl+C / Ctrl+D here means "I'm done"
  }
}
