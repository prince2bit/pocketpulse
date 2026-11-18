// Rules for categories and keyword rules. Operations that can fail on user input
// return { ok, ... } instead of throwing.

import { CATEGORY_COLORS } from '../ui/theme.js';
import { canonicalize } from '../utils/text.js';
import { suggestCategory } from './categorizer.js';

const MAX_NAME_LENGTH = 30;
const MAX_KEYWORD_LENGTH = 40;
const MAX_ICON_CODE_POINTS = 8;
const DEFAULT_ICON = '📌';
const COLOR_ORDER = Object.keys(CATEGORY_COLORS).filter((name) => name !== 'grey');

const clean = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * @param {object} deps
 * @param {object} deps.categories - the category repository
 * @param {(work: () => any) => any} deps.transaction - runs `work` all-or-nothing
 * @param {() => Date} [deps.clock]
 */
export function createCategoryService({ categories, transaction, clock = () => new Date() }) {
  const now = () => clock().toISOString();

  function checkName(input, { exceptId } = {}) {
    const name = clean(input);
    if (!name) return { ok: false, error: 'A category needs a name, like "Fitness".' };
    if ([...name].length > MAX_NAME_LENGTH) return { ok: false, error: `Category names can be up to ${MAX_NAME_LENGTH} characters.` };
    const taken = categories.findByName(name);
    if (taken && taken.id !== exceptId) return { ok: false, error: `You already have a category called "${taken.name}".` };
    return { ok: true, value: name };
  }

  function checkIcon(input) {
    const icon = clean(input);
    if (!icon) return { ok: false, error: 'The icon can\'t be empty. Use one emoji or character, like 🏋️.' };
    if ([...icon].length > MAX_ICON_CODE_POINTS) return { ok: false, error: 'Use just one emoji or character as the icon.' };
    return { ok: true, value: icon };
  }

  function checkColor(input) {
    const color = String(input ?? '').trim().toLowerCase();
    if (!Object.hasOwn(CATEGORY_COLORS, color)) {
      return { ok: false, error: `"${String(input).trim()}" isn't one of my colours. Choose from: ${Object.keys(CATEGORY_COLORS).join(', ')}.` };
    }
    return { ok: true, value: color };
  }

  /** Run several checks; return the first failure, or all the cleaned values. */
  const allOk = (checks) => checks.find((c) => !c.ok) ?? { ok: true };

  const rulesForMatching = () => categories.allRules();

  return {
    list: () => categories.list(),
    get: (id) => categories.findById(id),
    getFallback: () => categories.findFallback(),

    /**
     * Find a category by what a person typed. Exact name first (any capitals),
     * then a unique partial match: "fit" finds "Fitness" unless several match.
     */
    find(query) {
      const text = clean(query).toLowerCase();
      if (!text) return { ok: false, error: 'Which category? Run "pocketpulse categories" to see them.' };
      const all = categories.list();
      const exact = all.find((c) => c.name.toLowerCase() === text);
      if (exact) return { ok: true, category: exact };
      const partial = all.filter((c) => c.name.toLowerCase().includes(text));
      if (partial.length === 1) return { ok: true, category: partial[0] };
      if (partial.length > 1) return { ok: false, error: `"${clean(query)}" could mean: ${partial.map((c) => c.name).join(', ')}. Please be more specific.` };
      return { ok: false, error: `I don't have a category called "${clean(query)}". Run "pocketpulse categories" to see them.` };
    },

    create({ name, icon, color }) {
      const checks = [checkName(name), checkIcon(icon ?? DEFAULT_ICON), checkColor(color ?? COLOR_ORDER[categories.list().length % COLOR_ORDER.length])];
      const failed = allOk(checks);
      if (!failed.ok) return failed;
      const id = categories.insert({ name: checks[0].value, icon: checks[1].value, color: checks[2].value, createdAtUtc: now() });
      return { ok: true, category: categories.findById(id) };
    },

    /** Change any of name, icon, colour. Leave a field out to keep it. */
    update(id, { name, icon, color }) {
      const current = categories.findById(id);
      if (!current) return { ok: false, error: 'That category doesn\'t exist any more.' };
      const checks = [
        name === undefined ? { ok: true, value: current.name } : checkName(name, { exceptId: id }),
        icon === undefined ? { ok: true, value: current.icon } : checkIcon(icon),
        color === undefined ? { ok: true, value: current.color } : checkColor(color),
      ];
      const failed = allOk(checks);
      if (!failed.ok) return failed;
      categories.update(id, { name: checks[0].value, icon: checks[1].value, color: checks[2].value });
      return { ok: true, category: categories.findById(id) };
    },

    /**
     * Delete a category. If expenses use it, they MUST be moved: pass `moveTo`
     * (a category id). We never delete a category that has expenses without
     * somewhere for them to go.
     */
    delete(id, { moveTo } = {}) {
      const category = categories.findById(id);
      if (!category) return { ok: false, error: 'That category doesn\'t exist.' };
      if (category.isFallback) return { ok: false, error: `"${category.name}" is the safety net for anything uncategorised, so it can't be deleted.` };

      if (category.expenseCount > 0 && moveTo === undefined) {
        return {
          ok: false,
          code: 'needs-reassign',
          expenseCount: category.expenseCount,
          error: `${category.expenseCount} expense${category.expenseCount === 1 ? ' is' : 's are'} in "${category.name}". Choose a category to move ${category.expenseCount === 1 ? 'it' : 'them'} to.`,
        };
      }
      let destination = null;
      if (moveTo !== undefined) {
        destination = categories.findById(moveTo);
        if (!destination) return { ok: false, error: 'The category to move expenses to doesn\'t exist.' };
        if (destination.id === id) return { ok: false, error: 'Pick a different category to move the expenses to.' };
      }

      // Move the expenses and delete in one transaction.
      const moved = transaction(() => {
        const count = destination ? categories.moveExpenses(id, destination.id) : 0;
        categories.delete(id);
        return count;
      });
      return { ok: true, moved, movedTo: destination, deleted: category };
    },

    // Keyword rules

    /** Rules shown to people. Filter by category id and/or `mine` (hides built-ins). */
    listRules({ categoryId, mineOnly = false } = {}) {
      const rules = categoryId === undefined ? categories.allRules() : categories.rulesFor(categoryId);
      return mineOnly ? rules.filter((rule) => rule.source !== 'default') : rules;
    },

    /**
     * Teach a keyword. If that keyword already points elsewhere, it MOVES
     * (a keyword can only mean one thing); the old rule is reported back.
     * source: 'custom' (typed by hand) or 'learned' (from "remember this?").
     */
    teach(keywordInput, categoryId, source = 'custom') {
      const keyword = clean(keywordInput);
      const keywordNorm = canonicalize(keyword);
      if (!keywordNorm) return { ok: false, error: 'A keyword needs at least one letter or number.' };
      if ([...keyword].length > MAX_KEYWORD_LENGTH) return { ok: false, error: `Keywords can be up to ${MAX_KEYWORD_LENGTH} characters. Use the key words, not the whole sentence.` };
      const category = categories.findById(categoryId);
      if (!category) return { ok: false, error: 'That category doesn\'t exist.' };

      const previous = categories.findRule(keywordNorm);
      if (previous && previous.categoryId === categoryId) {
        // Same meaning already. If it was a built-in rule, now it's explicitly YOURS (so it wins ties).
        if (previous.source !== 'default') return { ok: true, rule: previous, category, unchanged: true };
      }
      categories.saveRule({ categoryId, keyword, keywordNorm, source, createdAtUtc: now() });
      return { ok: true, rule: categories.findRule(keywordNorm), category, replaced: previous && previous.categoryId !== categoryId ? previous : null };
    },

    /** Remove a keyword rule (yours or built-in). */
    forget(keywordInput) {
      const keywordNorm = canonicalize(keywordInput);
      const rule = keywordNorm ? categories.findRule(keywordNorm) : null;
      if (!rule) return { ok: false, error: `I don't have a rule for "${clean(keywordInput)}". Run "pocketpulse categories rules" to see yours.` };
      categories.deleteRule(keywordNorm);
      return { ok: true, rule };
    },

    /**
     * Guess a category for a description. Always returns a category: if
     * nothing matches, it's the fallback ("Other") with confidence 'none'.
     */
    suggest(description) {
      const result = suggestCategory(description, rulesForMatching());
      const category = result.categoryId === null ? categories.findFallback() : categories.findById(result.categoryId);
      return {
        category,
        keyword: result.keyword,
        source: result.source,
        confidence: result.confidence,
        alternatives: result.alternativeCategoryIds.map((id) => categories.findById(id)),
      };
    },
  };
}
