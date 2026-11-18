// `pocketpulse categories ...`
//
//   categories                               list categories
//   categories add "Fitness" --icon 🏋️ --color orange
//   categories rename Fitness "Gym & Fitness"
//   categories edit Fitness --icon 🏃 --color cyan
//   categories delete Fitness --move-to Other
//   categories rules [Category] [--all]      keyword rules (yours by default)
//   categories teach "protein bar" Fitness   map a keyword to a category
//   categories forget "protein bar"          remove a keyword rule

import { parseArgs } from 'node:util';
import { CATEGORY_COLORS } from '../ui/theme.js';
import { formatCategory, padEndWidth, padStartWidth, stringWidth } from '../ui/text.js';
import { GLOBAL_OPTIONS } from './options.js';

const SUBCOMMANDS = ['list', 'add', 'rename', 'edit', 'delete', 'rules', 'teach', 'forget'];

export async function runCategories(args, ctx) {
  const { theme, error } = ctx;
  const { values, positionals } = parseArgs({
    args,
    options: {
      ...GLOBAL_OPTIONS,
      icon: { type: 'string' },
      color: { type: 'string' },
      'move-to': { type: 'string' },
      all: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
    allowPositionals: true,
    strict: false,
  });

  const [sub = 'list', ...rest] = positionals;
  const app = await ctx.getApp();
  const context = { app, ctx, values, rest };

  switch (sub.toLowerCase()) {
    case 'list': return showList(context);
    case 'add': return addCategory(context);
    case 'rename': return renameCategory(context);
    case 'edit': return editCategory(context);
    case 'delete': return deleteCategory(context);
    case 'rules': return showRules(context);
    case 'teach': return teachKeyword(context);
    case 'forget': return forgetKeyword(context);
    default:
      error(`${theme.danger(theme.symbols.cross)} I don't know "categories ${sub}". Try one of: ${SUBCOMMANDS.join(', ')}.`);
      return 2;
  }
}

// Small helpers shared by the subcommands

const failWith = (ctx, message) => {
  ctx.error(`${ctx.theme.danger(ctx.theme.symbols.cross)} ${message}`);
  return 2;
};
const done = (ctx, message) => {
  ctx.write(`${ctx.theme.primary(ctx.theme.symbols.tick)} ${message}`);
  return 0;
};
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const verb = (count) => (count === 1 ? 'uses' : 'use');

// Subcommands

function showList({ app, ctx }) {
  const { theme, write } = ctx;
  const categories = app.categories.list();
  const nameW = Math.max(...categories.map((c) => stringWidth(formatCategory(theme, c))));
  const expensesText = categories.map((c) => plural(c.expenseCount, 'expense'));
  const expensesW = Math.max(...expensesText.map((t) => t.length));

  write('');
  write(theme.bold(theme.secondary('CATEGORIES')));
  categories.forEach((category, index) => {
    write(`  ${padEndWidth(formatCategory(theme, category), nameW)}  ${padStartWidth(expensesText[index], expensesW)}  ${theme.muted(plural(category.ruleCount, 'keyword'))}`);
  });
  write('');
  write(theme.muted('Add one: pocketpulse categories add "Fitness"   See keywords: pocketpulse categories rules'));
  return 0;
}

function addCategory({ app, ctx, values, rest }) {
  const result = app.categories.create({
    name: rest.join(' '),
    icon: typeof values.icon === 'string' ? values.icon : undefined,
    color: typeof values.color === 'string' ? values.color : undefined,
  });
  if (!result.ok) return failWith(ctx, result.error);
  return done(ctx, `Added ${formatCategory(ctx.theme, result.category)}. Teach it keywords with: pocketpulse categories teach "protein bar" "${result.category.name}"`);
}

function renameCategory({ app, ctx, rest }) {
  if (rest.length !== 2) return failWith(ctx, 'Say which category and the new name, in quotes if they have spaces: pocketpulse categories rename "Fitness" "Gym"');
  const found = app.categories.find(rest[0]);
  if (!found.ok) return failWith(ctx, found.error);
  const result = app.categories.update(found.category.id, { name: rest[1] });
  if (!result.ok) return failWith(ctx, result.error);
  return done(ctx, `Renamed "${found.category.name}" to ${formatCategory(ctx.theme, result.category)}.`);
}

function editCategory({ app, ctx, values, rest }) {
  if (rest.length !== 1 || (values.icon === undefined && values.color === undefined)) {
    return failWith(ctx, `Say which category and what to change: pocketpulse categories edit Fitness --icon 🏃 --color cyan\n  Colours: ${Object.keys(CATEGORY_COLORS).join(', ')}`);
  }
  const found = app.categories.find(rest[0]);
  if (!found.ok) return failWith(ctx, found.error);
  const result = app.categories.update(found.category.id, {
    icon: typeof values.icon === 'string' ? values.icon : undefined,
    color: typeof values.color === 'string' ? values.color : undefined,
  });
  if (!result.ok) return failWith(ctx, result.error);
  return done(ctx, `Updated ${formatCategory(ctx.theme, result.category)}.`);
}

async function deleteCategory({ app, ctx, values, rest }) {
  const { theme, write } = ctx;
  if (rest.length !== 1) return failWith(ctx, 'Say which category: pocketpulse categories delete Fitness --move-to Other');
  const found = app.categories.find(rest[0]);
  if (!found.ok) return failWith(ctx, found.error);
  const category = found.category;

  if (category.isFallback) return failWith(ctx, app.categories.delete(category.id).error);

  // Where should its expenses go? Only needed if it has any.
  let moveTo;
  if (typeof values['move-to'] === 'string') {
    const destination = app.categories.find(values['move-to']);
    if (!destination.ok) return failWith(ctx, destination.error);
    moveTo = destination.category.id;
  } else if (category.expenseCount > 0) {
    if (!ctx.interactive) {
      return failWith(ctx, `${plural(category.expenseCount, 'expense')} ${verb(category.expenseCount)} "${category.name}". Say where they should go: pocketpulse categories delete "${category.name}" --move-to Other`);
    }
    const options = app.categories.list().filter((c) => c.id !== category.id);
    const picked = await ctx.getPrompts().select(
      `${plural(category.expenseCount, 'expense')} ${verb(category.expenseCount)} "${category.name}". Move ${category.expenseCount === 1 ? 'it' : 'them'} to which category?`,
      options.map((c) => ({ ...c, label: formatCategory(theme, c) })),
      { defaultIndex: options.findIndex((c) => c.isFallback) },
    );
    if (!picked) { write(theme.muted('Cancelled. Nothing was deleted.')); return 0; }
    moveTo = picked.id;
  }

  // Deleting is permanent, so confirm.
  if (!values.yes) {
    if (!ctx.interactive) return failWith(ctx, 'Deleting needs confirmation, and I can\'t ask here. Add --yes to delete without asking.');
    const answer = await ctx.getPrompts().choice(
      `Delete ${category.name} and its ${plural(category.ruleCount, 'keyword')}?`,
      [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }],
      'no',
    );
    if (answer !== 'yes') { write(theme.muted('Cancelled. Nothing was deleted.')); return 0; }
  }

  const result = app.categories.delete(category.id, { moveTo });
  if (!result.ok) return failWith(ctx, result.error);
  const movedNote = result.moved > 0 ? ` ${plural(result.moved, 'expense')} moved to ${formatCategory(theme, result.movedTo)}.` : '';
  return done(ctx, `Deleted "${category.name}".${movedNote}`);
}

function showRules({ app, ctx, values, rest }) {
  const { theme, write } = ctx;
  let categories = app.categories.list();
  let mineOnly = !values.all;

  if (rest.length > 0) {
    const found = app.categories.find(rest.join(' '));
    if (!found.ok) return failWith(ctx, found.error);
    categories = [found.category];
    mineOnly = false; // asking about one category shows everything it has
  }

  let shown = 0;
  write('');
  for (const category of categories) {
    const rules = app.categories.listRules({ categoryId: category.id, mineOnly });
    if (rules.length === 0) continue;
    shown += 1;
    write(`${formatCategory(theme, category)}  ${theme.muted(plural(rules.length, 'keyword'))}`);
    // Your own rules are highlighted and tagged; built-ins are plain.
    const words = rules.map((rule) => (rule.source === 'default'
      ? rule.keyword
      : `${theme.primary(rule.keyword)}${theme.muted(rule.source === 'learned' ? ' (learned)' : ' (yours)')}`));
    write(`  ${words.join(', ')}`);
    write('');
  }
  if (shown === 0) {
    write(mineOnly ? 'You haven\'t taught me any keywords yet.' : 'No keywords here yet.');
    write(theme.muted('Teach one: pocketpulse categories teach "protein bar" Fitness'));
    write(theme.muted('See the built-in ones: pocketpulse categories rules --all  (or name a category)'));
  } else if (mineOnly) {
    write(theme.muted('Showing your own rules. See built-ins with: pocketpulse categories rules --all'));
  }
  return 0;
}

function teachKeyword({ app, ctx, rest }) {
  const { theme } = ctx;
  if (rest.length !== 2) return failWith(ctx, 'Give a keyword and a category, in quotes if they have spaces: pocketpulse categories teach "protein bar" Fitness');
  const found = app.categories.find(rest[1]);
  if (!found.ok) return failWith(ctx, found.error);
  const result = app.categories.teach(rest[0], found.category.id, 'custom');
  if (!result.ok) return failWith(ctx, result.error);
  if (result.unchanged) return done(ctx, `"${result.rule.keyword}" already points to ${formatCategory(theme, found.category)}.`);
  const replaced = result.replaced ? theme.muted(` (it used to mean ${result.replaced.categoryName})`) : '';
  return done(ctx, `From now on "${result.rule.keyword}" ${theme.symbols.arrow} ${formatCategory(theme, found.category)}${replaced}`);
}

function forgetKeyword({ app, ctx, rest }) {
  if (rest.length === 0) return failWith(ctx, 'Which keyword? pocketpulse categories forget "protein bar"');
  const result = app.categories.forget(rest.join(' '));
  if (!result.ok) return failWith(ctx, result.error);
  return done(ctx, `Forgot "${result.rule.keyword}". It no longer suggests ${result.rule.categoryName}.`);
}
