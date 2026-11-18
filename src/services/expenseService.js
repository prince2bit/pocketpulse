// Expense rules. Recording is two steps: validate() builds a draft without saving,
// and save() stamps the time, picks a category if none was chosen and writes it.
// The confirmation prompt happens between the two.

import { MAX_DESCRIPTION_LENGTH } from '../config/defaults.js';
import { getLocalDate } from '../utils/dateTime.js';
import { normalizeCurrency, parseAmountToMinor, supportedCurrencyCodes } from '../utils/money.js';

export const DUPLICATE_WINDOW_MINUTES = 2;

/**
 * @param {object} deps
 * @param {object} deps.expenses - the expense repository
 * @param {object} deps.settings - the settings service
 * @param {object} deps.categories - the category service (used to guess a category when none is given)
 * @param {() => Date} [deps.clock] - "what time is it?". Tests give it a fixed
 *   time; the real app uses the computer's clock. We never hardcode a date.
 */
export function createExpenseService({ expenses, settings, categories, clock = () => new Date() }) {
  /** Check raw input. Returns { ok: true, draft } or { ok: false, errors: { field: message } }. */
  function validate({ description, amount, currency, categoryId }) {
    const errors = {};

    // Control characters become spaces, then runs of whitespace collapse.
    const cleaned = String(description ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) {
      errors.description = 'Please tell me what you spent on, like "chips".';
    } else if ([...cleaned].length > MAX_DESCRIPTION_LENGTH) {
      errors.description = `Descriptions can be up to ${MAX_DESCRIPTION_LENGTH} characters (yours has ${[...cleaned].length}). Shorten it a little.`;
    }

    // Blank currency means "use my default". Anything else must be supported.
    const wanted = String(currency ?? '').trim();
    const code = wanted ? normalizeCurrency(wanted) : settings.getDefaultCurrency();
    if (!code) {
      errors.currency = `"${wanted}" isn't a supported currency. Choose one of: ${supportedCurrencyCodes().join(', ')}.`;
    }

    // Amount rules depend on the currency (JPY has no decimals). If the currency was
    // invalid, check the amount against the default so all problems are reported at once.
    const parsed = parseAmountToMinor(amount, code ?? settings.getDefaultCurrency());
    if (!parsed.ok) errors.amount = parsed.error;
    const amountMinor = parsed.minor;

    // A category is optional here: when it's missing, save() picks one from the description.
    if (categoryId != null && !categories.get(categoryId)) errors.category = 'That category doesn\'t exist.';

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, draft: { description: cleaned, amountMinor, currency: code, categoryId: categoryId ?? null } };
  }

  /** Has this exact expense just been entered? Used to ask "are you sure?". */
  function findPossibleDuplicate(draft) {
    const since = new Date(clock().getTime() - DUPLICATE_WINDOW_MINUTES * 60_000);
    return expenses.findDuplicate({
      description: draft.description,
      amountMinor: draft.amountMinor,
      currency: draft.currency,
      sinceUtc: since.toISOString(),
    });
  }

  /** Save a validated draft, stamping the REAL current time. */
  function save(draft) {
    const now = clock();
    const timeZone = settings.getTimeZone();
    const categoryId = draft.categoryId ?? categories.suggest(draft.description).category.id;
    const id = expenses.insert({
      ...draft,
      categoryId,
      spentAtUtc: now.toISOString(), // always UTC
      timeZone, // remembered so history displays correctly forever
      localDate: getLocalDate(now, timeZone), // the local calendar day
      createdAtUtc: now.toISOString(),
    });
    return expenses.findById(id);
  }

  return {
    validate,
    findPossibleDuplicate,
    save,
    listRecent: (limit = 10) => expenses.listRecent(limit),
    count: () => expenses.count(),
    now: clock,
  };
}
