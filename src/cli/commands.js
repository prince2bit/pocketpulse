// Command router: maps argv to a command and handles --help, --version, typos
// and per-command help. Nothing here touches the real terminal; everything
// arrives through `ctx` (theme, write, error, getApp...), so tests pass in fakes.

import { parseArgs } from 'node:util';
import { COMMAND_NAME, TAGLINE } from '../config/defaults.js';
import { renderBanner } from '../ui/banner.js';
import { truncateToWidth } from '../ui/text.js';
import { THEMES, createTheme } from '../ui/theme.js';
import { runAdd } from './addCommand.js';
import { runCategories } from './categoriesCommand.js';
import { runDashboard, runToday } from './dashboardCommands.js';
import { runHome } from './interactive.js';
import { runMonth, runRange, runTrends, runWeek } from './reportCommands.js';
import { runList } from './listCommand.js';
import { GLOBAL_OPTIONS } from './options.js';
import { runSettings } from './settingsCommand.js';

// Command registry. Entries without `run` are listed as planned and refuse to run.
export const COMMANDS = [
  {
    name: 'add', summary: 'Record an expense', ready: true, run: runAdd,
    usage: 'add <what and how much> [--currency USD] [--category Fitness] [--yes]',
    examples: ['pocketpulse add chips 20', 'pocketpulse add bought a notebook for 65', 'pocketpulse add spent 40 on samosa',
      'pocketpulse add coffee $5', 'pocketpulse add "protein bar" 120 --category Fitness', 'pocketpulse add          (asks step by step)'],
  },
  {
    name: 'categories', summary: 'Manage categories and keyword rules', ready: true, run: runCategories,
    usage: 'categories [add|rename|edit|delete|rules|teach|forget] ...',
    examples: ['pocketpulse categories', 'pocketpulse categories add "Fitness" --icon 🏋️ --color orange',
      'pocketpulse categories teach "protein bar" Fitness', 'pocketpulse categories rules',
      'pocketpulse categories delete Fitness --move-to Other'],
  },
  {
    name: 'today', summary: "See today's spending", ready: true, run: runToday,
    usage: 'today [--currency USD]', examples: ['pocketpulse today', 'pocketpulse today --currency USD'],
  },
  {
    name: 'dashboard', summary: 'Your spending at a glance', ready: true, run: runDashboard,
    usage: 'dashboard [--currency USD]', note: 'also what you get from just "pocketpulse"',
    examples: ['pocketpulse dashboard', 'pocketpulse dashboard --currency USD'],
  },
  {
    name: 'week', summary: 'Weekly analytics (Monday to Sunday)', ready: true, run: runWeek,
    usage: 'week [date] [--previous | --back N] [--category NAME] [--currency CODE]',
    examples: ['pocketpulse week', 'pocketpulse week --previous', 'pocketpulse week --back 3', 'pocketpulse week 2026-11-02',
      'pocketpulse week --category "Food & Snacks"'],
  },
  {
    name: 'month', summary: 'Monthly analytics', ready: true, run: runMonth,
    usage: 'month [2026-10] [--previous | --back N] [--category NAME] [--currency CODE]',
    examples: ['pocketpulse month', 'pocketpulse month --previous', 'pocketpulse month 2026-10', 'pocketpulse month --category Transport'],
  },
  {
    name: 'range', summary: 'Analytics for any range of dates', ready: true, run: runRange,
    usage: 'range <from> <to> [--category NAME] [--currency CODE]',
    examples: ['pocketpulse range 2026-11-01 2026-11-20', 'pocketpulse range 2026-10-01 yesterday', 'pocketpulse range --from 2026-09-01 --to 2026-11-30'],
  },
  {
    name: 'trends', summary: 'Spending over the last weeks or months', ready: true, run: runTrends,
    usage: 'trends [--weeks N | --months N] [--category NAME] [--currency CODE]',
    examples: ['pocketpulse trends', 'pocketpulse trends --weeks 12', 'pocketpulse trends --months 6'],
  },
  {
    name: 'list', summary: 'Show your recent expenses', ready: true, run: runList,
    usage: 'list [--limit 20]', note: 'search and filters coming soon',
    examples: ['pocketpulse list', 'pocketpulse list --limit 25'],
  },
  {
    name: 'settings', summary: 'Currency, time zone and theme', ready: true, run: runSettings,
    usage: 'settings [currency|timezone|theme] [value]', note: 'more options coming soon',
    examples: ['pocketpulse settings', 'pocketpulse settings currency USD', 'pocketpulse settings timezone Asia/Kolkata', 'pocketpulse settings theme ocean'],
  },
  { name: 'export', summary: 'Export your data as CSV or JSON', usage: 'export --format csv', ready: false },
  { name: 'themes', summary: 'Preview colour themes', usage: 'themes', ready: true, run: runThemes },
];

// Typo help

/** Edit distance: the minimum single-letter changes to turn `a` into `b`. */
function editDistance(a, b) {
  // previous[j] = distance between the first i-1 letters of a and first j of b
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Return the known command closest to `input`, or null if nothing is close. */
export function closestCommand(input, names = COMMANDS.map((c) => c.name)) {
  let best = null;
  let bestDistance = 3; // anything 3+ edits away is too different to suggest
  for (const name of names) {
    const distance = editDistance(input.toLowerCase(), name);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

// Screens

function showHelp({ theme, write, columns }) {
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  const heading = (text) => theme.bold(theme.secondary(text));

  write(renderBanner(theme, { columns }));
  write('');
  write(heading('USAGE'));
  write(`  ${COMMAND_NAME} [command] [options]`);
  write('');
  write(heading('COMMANDS'));
  for (const command of COMMANDS) {
    // Pad before colouring: escape codes count as characters but take no space.
    const name = theme.primary(command.name.padEnd(nameWidth));
    const status = command.ready
      ? (command.note ? theme.muted(`  (${command.note})`) : '')
      : theme.muted('  (planned)');
    write(`  ${name}${command.summary}${status}`);
  }
  write('');
  write(heading('OPTIONS'));
  write(`  ${theme.primary('-h, --help'.padEnd(nameWidth + 6))}Show this help`);
  write(`  ${theme.primary('-v, --version'.padEnd(nameWidth + 6))}Show the version`);
  write(`  ${theme.primary('--theme <name>'.padEnd(nameWidth + 6))}Use a colour theme for this run (see: ${COMMAND_NAME} themes)`);
  write(`  ${theme.primary('--no-color'.padEnd(nameWidth + 6))}Turn colours off (the NO_COLOR variable works too)`);
  write('');
  write(theme.muted('100% local: your data never leaves this computer.'));
}

function showCommandHelp(command, { theme, write }) {
  write(`${theme.bold(theme.secondary('USAGE'))}  ${COMMAND_NAME} ${command.usage}`);
  write(command.summary);
  if (command.examples) {
    write('');
    write(theme.bold(theme.secondary('EXAMPLES')));
    for (const example of command.examples) write(`  ${theme.primary(example)}`);
  }
  if (!command.ready) write(theme.muted('Planned for a future version.'));
}

// The themes command

async function runThemes(_args, { theme, write, columns = 80 }) {
  const nameWidth = Math.max(...Object.keys(THEMES).map((name) => name.length)) + 2;
  // Swatch width adapts to the window; each description is clipped to what is left.
  const longest = Math.max(...Object.values(THEMES).map((definition) => definition.description.length));
  const swatchLength = Math.max(8, Math.min(24, columns - 2 - nameWidth - 2 - longest));

  write(theme.bold(theme.secondary('THEMES')));
  write('');
  for (const [name, definition] of Object.entries(THEMES)) {
    // Build a temporary theme per entry so each row previews in its own colours.
    const preview = createTheme({ themeName: name, colorLevel: theme.level, unicode: theme.unicode });
    const swatch = Array.from({ length: swatchLength }, (_, i) =>
      preview.gradient(preview.symbols.block, i / (swatchLength - 1))).join('');
    const pointer = name === theme.name ? preview.primary(`${preview.symbols.arrow} `) : '  ';
    const room = Math.max(10, columns - 2 - nameWidth - swatchLength - 2);
    const description = truncateToWidth(definition.description, room, preview.symbols.ellipsis);
    write(`${pointer}${preview.bold(preview.primary(name.padEnd(nameWidth)))}${swatch}  ${description}`);
  }
  write(theme.muted(`Current theme: ${theme.name}`));
  write('');
  write('Try one:');
  write(`  ${theme.primary(`${COMMAND_NAME} --theme ocean`)}`);
  write(theme.muted(`Keep one permanently:  ${COMMAND_NAME} settings theme ocean`));
  return 0;
}

// The router

/**
 * Run PocketPulse for the given arguments.
 * Returns an exit code: 0 = success, 1 = failed, 2 = you typed it wrong.
 */
export async function runCli(argv, ctx) {
  const { theme, write, error, version } = ctx;

  // strict: false so unknown flags don't throw; each command parses its own.
  // tokens: true gives each word's position, so a command receives every arg except its own name.
  const { values, tokens } = parseArgs({
    args: argv,
    options: GLOBAL_OPTIONS,
    allowPositionals: true,
    strict: false,
    tokens: true,
  });

  if (values.version) {
    write(`PocketPulse v${version}`);
    return 0;
  }

  const firstWord = tokens.find((token) => token.kind === 'positional');
  const commandName = firstWord?.value;

  if (!commandName) {
    if (!values.help) return runHome(ctx); // the dashboard (and menu, in a real terminal)
    showHelp(ctx);
    return 0;
  }

  const command = COMMANDS.find((c) => c.name === commandName.toLowerCase());

  if (!command) {
    error(`${theme.danger(theme.symbols.cross)} I don't know the command "${commandName}".`);
    const guess = closestCommand(commandName);
    if (guess) error(`  Did you mean ${theme.primary(`${COMMAND_NAME} ${guess}`)}?`);
    error(theme.muted(`  Run ${COMMAND_NAME} --help to see everything I can do.`));
    return 2;
  }

  if (values.help) {
    showCommandHelp(command, ctx);
    return 0;
  }

  if (!command.ready) {
    error(`${theme.warn(theme.symbols.warn)} "${command.name}" isn't available yet. It's planned for a future version.`);
    error(theme.muted(`  Run ${COMMAND_NAME} --help to see the roadmap.`));
    return 1;
  }

  const commandArgs = argv.filter((_, index) => index !== firstWord.index);
  return command.run(commandArgs, ctx);
}

export { TAGLINE };
