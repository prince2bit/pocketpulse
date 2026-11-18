// `pocketpulse add`
//
//   pocketpulse add chips 20
//   pocketpulse add bought a notebook for 65
//   pocketpulse add coffee $5 --currency EUR
//   pocketpulse add "protein bar" 120 --category Fitness
//   pocketpulse add                      (prompts for everything)
//   pocketpulse add chips 20 --yes       (skip the confirmation)
//
// Flow: parse -> validate -> suggest a category -> preview -> confirm -> save,
// then offer to remember a category the user changed. Nothing is saved without
// a preview unless --yes is given.

import { parseArgs } from 'node:util';
import { parseExpenseText } from '../services/parserService.js';
import { renderPanel } from '../ui/panel.js';
import { formatCategory } from '../ui/text.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import { formatMoney, minorToDecimalString, normalizeCurrency } from '../utils/money.js';
import { GLOBAL_OPTIONS } from './options.js';

// Prompts for fields that are missing or invalid.
const FIELD_QUESTIONS = [
  ['description', 'What did you spend on?'],
  ['amount', 'How much?'],
  ['currency', 'Which currency code?'],
];

const CONFIRM_OPTIONS = [
  { key: 'save', label: 'Save', shortcut: 's' },
  { key: 'edit', label: 'Edit', shortcut: 'e' },
  { key: 'category', label: 'Category', shortcut: 'c' },
  { key: 'cancel', label: 'Cancel', shortcut: 'x' },
];

export async function runAdd(args, ctx) {
  const { theme, write, error } = ctx;
  const { symbols } = theme;

  // parseArgs would read "-20" as a flag, so reject negatives here.
  if (args.some((arg) => /^-\d/.test(arg))) {
    error(`${theme.danger(symbols.cross)} Amounts must be positive. Just enter what you spent, like: pocketpulse add chips 20`);
    return 2;
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      ...GLOBAL_OPTIONS,
      currency: { type: 'string', short: 'c' },
      category: { type: 'string', short: 'k' },
      yes: { type: 'boolean', short: 'y' },
    },
    allowPositionals: true,
    strict: false,
  });

  const app = await ctx.getApp();
  const prompts = ctx.interactive ? ctx.getPrompts() : null;
  const cancelled = () => {
    write(theme.muted('Cancelled. Nothing was saved.'));
    return 0;
  };
  const fail = (message) => {
    error(`${theme.danger(symbols.cross)} ${message}`);
    return 2;
  };

  // 1. Parse the text
  const text = positionals.join(' ');
  const defaultCurrency = app.settings.getDefaultCurrency();
  let parsed = parseExpenseText(text, { defaultCurrency });

  // Several numbers: ask which one is the amount instead of guessing.
  const multiple = parsed.issues.find((issue) => issue.type === 'multiple-amounts');
  if (multiple) {
    const numbers = multiple.candidates.map((c) => c.text).join(' and ');
    if (!prompts) {
      return fail(`I found more than one number (${numbers}). Put the amount last, like: pocketpulse add "2 samosa" 30`);
    }
    const picked = await prompts.select(
      `I found more than one number (${numbers}). Which one is the amount?`,
      multiple.candidates.map((c) => ({ label: c.text, index: c.index })),
    );
    if (!picked) return cancelled();
    parsed = parseExpenseText(text, { defaultCurrency, amountChoice: picked.index });
  }

  // --currency beats a symbol in the text, and we say so.
  const flagCurrency = typeof values.currency === 'string' ? values.currency : '';
  if (flagCurrency && parsed.currency && normalizeCurrency(flagCurrency) !== parsed.currency) {
    write(theme.muted(`Using ${flagCurrency.toUpperCase()} from --currency (you also wrote ${parsed.currency}).`));
  }
  const inputs = {
    description: parsed.description,
    amount: parsed.amount,
    currency: flagCurrency || parsed.currency || '',
  };

  // Check --category up front.
  let manualCategoryId = null;
  if (typeof values.category === 'string') {
    const found = app.categories.find(values.category);
    if (!found.ok) return fail(found.error);
    manualCategoryId = found.category.id;
  }

  // Ask for whatever is still missing (interactive only).
  if (prompts) {
    for (const [field, question] of FIELD_QUESTIONS.slice(0, 2)) {
      if (inputs[field]) continue;
      const answer = await prompts.text(question);
      if (answer === null) return cancelled();
      inputs[field] = answer;
    }
  }

  // 2. Validate, suggest, preview, confirm. Loops for fixes and edits.
  let draft;
  let suggestion;
  let category;
  for (;;) {
    const result = app.expenses.validate(inputs);

    if (!result.ok) {
      for (const message of Object.values(result.errors)) error(`${theme.danger(symbols.cross)} ${message}`);
      if (!prompts) {
        error(theme.muted('  Example: pocketpulse add "chips" 20'));
        return 2;
      }
      for (const [field, question] of FIELD_QUESTIONS) {
        if (!result.errors[field]) continue;
        const answer = await prompts.text(question);
        if (answer === null) return cancelled();
        inputs[field] = answer;
      }
      continue;
    }

    draft = result.draft;
    suggestion = app.categories.suggest(draft.description);
    category = manualCategoryId ? app.categories.get(manualCategoryId) : suggestion.category;
    draft.categoryId = category.id;
    showPreview({ draft, category, suggestion, chosenByUser: manualCategoryId !== null, app, ctx });

    if (values.yes) break;
    if (!prompts) {
      error(`${theme.warn(symbols.warn)} Not saved: I can't ask for confirmation here. Add --yes to save without asking.`);
      return 1;
    }

    const duplicate = app.expenses.findPossibleDuplicate(draft);
    const decision = await prompts.choice(
      'Save this expense?',
      CONFIRM_OPTIONS,
      duplicate ? 'cancel' : 'save', // if it looks like a repeat, Enter does the safe thing
    );
    if (decision === 'save') break;

    if (decision === 'category') {
      const all = app.categories.list();
      const picked = await prompts.select(
        'Which category?',
        all.map((c) => ({ ...c, label: formatCategory(theme, c) })),
        { defaultIndex: all.findIndex((c) => c.id === category.id) },
      );
      if (!picked) return cancelled();
      manualCategoryId = picked.id;
      continue;
    }

    if (decision !== 'edit') return cancelled(); // 'cancel' or input ended

    // Edit: re-ask every field, defaulting to the current value.
    const current = {
      description: draft.description,
      amount: minorToDecimalString(draft.amountMinor, draft.currency),
      currency: draft.currency,
    };
    for (const [field, question] of FIELD_QUESTIONS) {
      const answer = await prompts.text(question, { defaultValue: current[field] });
      if (answer === null) return cancelled();
      inputs[field] = answer;
    }
  }

  // 3. Save. The timestamp comes from the clock at this moment.
  const saved = app.expenses.save(draft);
  const when = formatLocalDateTime(saved.spentAtUtc, saved.timeZone, { now: app.expenses.now() });
  write(`${theme.primary(symbols.tick)} ${theme.bold('Saved')}  ${saved.description}  ${theme.bold(formatMoney(saved.amountMinor, saved.currency))}  ${formatCategory(theme, saved.category)}  ${theme.muted(when)}`);

  // 4. Offer to remember a category the user changed (never with --yes).
  if (prompts && !values.yes && manualCategoryId !== null && manualCategoryId !== suggestion.category.id) {
    await offerToLearn({ description: saved.description, category: saved.category, app, prompts, ctx });
  }

  write(theme.muted('  See your expenses with: pocketpulse list'));
  return 0;
}

/** "Remember protein bar -> Fitness for next time?" */
async function offerToLearn({ description, category, app, prompts, ctx }) {
  const { theme, write, error } = ctx;
  const answer = await prompts.choice(
    `Remember "${description}" as ${category.name} for next time?`,
    [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }],
    'yes',
  );
  if (answer !== 'yes') return;

  // Default to the whole description; the user can narrow it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const keyword = await prompts.text('Which words should I look for?', { defaultValue: description.toLowerCase() });
    if (!keyword) return;
    const result = app.categories.teach(keyword, category.id, 'learned');
    if (result.ok) {
      const replaced = result.replaced ? theme.muted(` (it used to mean ${result.replaced.categoryName})`) : '';
      write(`${theme.primary(theme.symbols.tick)} Got it: "${result.rule.keyword}" ${theme.symbols.arrow} ${formatCategory(theme, category)}${replaced}`);
      return;
    }
    error(`${theme.danger(theme.symbols.cross)} ${result.error}`);
  }
}

/** The "Expense detected" box. */
function showPreview({ draft, category, suggestion, chosenByUser, app, ctx }) {
  const { theme, write } = ctx;
  const now = app.expenses.now();
  const zone = app.settings.getTimeZone();
  const label = (text) => theme.muted(text.padEnd(10));

  // Say why a category was chosen so the suggestion isn't a black box.
  let reason;
  if (chosenByUser) reason = 'your choice';
  else if (suggestion.confidence === 'none') reason = `no match, so ${category.name}`;
  else if (suggestion.source === 'default') reason = `matched "${suggestion.keyword}"`;
  else reason = `your rule: "${suggestion.keyword}"`;
  if (!chosenByUser && suggestion.confidence === 'low') {
    reason += `; could also be ${suggestion.alternatives.map((c) => c.name).join(' or ')}`;
  }

  const lines = [
    `${label('Expense')}${theme.bold(draft.description)}`,
    `${label('Amount')}${theme.bold(theme.primary(formatMoney(draft.amountMinor, draft.currency)))}`,
    `${label('Category')}${formatCategory(theme, category)}  ${theme.muted(`(${reason})`)}`,
    `${label('When')}${formatLocalDateTime(now.toISOString(), zone, { now })} ${theme.muted(`(${zone})`)}`,
  ];

  const duplicate = app.expenses.findPossibleDuplicate(draft);
  if (duplicate) {
    const at = formatLocalDateTime(duplicate.spentAtUtc, duplicate.timeZone, { now });
    lines.push('', `${theme.warn(theme.symbols.warn)} You saved the same thing at ${at}. Saving again makes a second entry.`);
  }

  write('');
  write(renderPanel(theme, { title: 'Expense detected', lines }));
}
