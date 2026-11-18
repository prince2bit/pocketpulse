// Understands typed expenses such as:
//
//   chips 20                      bought a notebook for 65
//   spent 40 on samosa            ₹20 chips      coffee $5      20 usd bus
//   paid 299 for recharge         50/- petrol    rs 120 lunch
//
// Pure logic. Anything ambiguous (several numbers, no number, no description) is
// reported in `issues` for the caller to ask about.

import { supportedCurrencyCodes } from '../utils/money.js';

// Words that frame a sentence but aren't the thing you bought.
const VERBS = new Set(['i', 'just', 'bought', 'buy', 'purchased', 'paid', 'pay', 'spent', 'spend',
  'got', 'ordered', 'order', 'had', 'took', 'take', 'gave']);
const ARTICLES = new Set(['a', 'an', 'the', 'some', 'my']);
const PREPOSITIONS = new Set(['on', 'for', 'at', 'to', 'of', 'in', '@']);

// "$" and "dollar" are ambiguous (US, Canadian, Australian, Singapore...).
// They become the person's default currency if that's a dollar one, else USD.
const DOLLAR = 'DOLLAR';
const DOLLAR_CURRENCIES = ['USD', 'CAD', 'AUD', 'SGD'];

const CURRENCY_WORDS = {
  '₹': 'INR', rs: 'INR', rupee: 'INR', rupees: 'INR',
  $: DOLLAR, dollar: DOLLAR, dollars: DOLLAR,
  '€': 'EUR', euro: 'EUR', euros: 'EUR',
  '£': 'GBP', pound: 'GBP', pounds: 'GBP',
  '¥': 'JPY', yen: 'JPY',
  dirham: 'AED', dirhams: 'AED',
};
for (const code of supportedCurrencyCodes()) CURRENCY_WORDS[code.toLowerCase()] = code;

const lookupCurrency = (word) => CURRENCY_WORDS[word.toLowerCase().replace(/\.$/, '')];

// A number, optionally glued to a currency: "20", "₹20", "rs.20", "20rs", "usd5", "1,234.50"
const AMOUNT_TOKEN = /^(?<before>[₹$€£¥]|rs\.?|[a-z]{3})?(?<number>\d[\d,]*(?:\.\d+)?|\.\d+)(?<after>[₹$€£¥]|rs|[a-z]{3})?$/i;

/** What is this word: an amount, a currency, or just a word? */
function classify(rawToken) {
  // Drop an Indian-style "/-" suffix and sentence punctuation: "50/-" -> "50", "150." -> "150", "rs." -> "rs"
  const token = rawToken.replace(/\/-$/, '').replace(/[.,;!?]+$/, '');
  const match = AMOUNT_TOKEN.exec(token);
  if (match) {
    const { before, number, after } = match.groups;
    const currency = (before && lookupCurrency(before)) || (after && lookupCurrency(after)) || null;
    const hasUnknownLetters = (before && !lookupCurrency(before)) || (after && !lookupCurrency(after));
    if (!hasUnknownLetters) return { kind: 'amount', number, currency };
  }
  const currency = lookupCurrency(token);
  if (currency) return { kind: 'currency', currency };
  return { kind: 'word' };
}

/**
 * @param {string} text what the person typed
 * @param {{defaultCurrency?: string, amountChoice?: number}} [options]
 *   amountChoice: when the text has several numbers, which one (0, 1, ...) is the amount
 * @returns {{description: string, amount: string, currency: string|null, issues: object[]}}
 */
export function parseExpenseText(text, { defaultCurrency = 'INR', amountChoice } = {}) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const kinds = words.map(classify);
  const issues = [];

  const resolve = (currency) => {
    if (currency !== DOLLAR) return currency;
    return DOLLAR_CURRENCIES.includes(defaultCurrency) ? defaultCurrency : 'USD';
  };

  // Which word is the amount?
  const amountPositions = kinds.flatMap((kind, index) => (kind.kind === 'amount' ? [index] : []));
  let amountAt = null;
  if (amountPositions.length === 1) {
    [amountAt] = amountPositions;
  } else if (amountPositions.length > 1) {
    if (amountChoice === undefined) {
      issues.push({
        type: 'multiple-amounts',
        candidates: amountPositions.map((position, index) => ({ index, text: kinds[position].number })),
      });
    } else {
      amountAt = amountPositions[amountChoice] ?? null;
    }
  } else {
    issues.push({ type: 'no-amount' });
  }

  // A currency word right next to the amount belongs to it ("usd 20", "20 dollars").
  let currency = amountAt === null ? null : kinds[amountAt].currency;
  let consumed = -1;
  if (amountAt !== null && !currency) {
    for (const neighbour of [amountAt - 1, amountAt + 1]) {
      if (kinds[neighbour]?.kind === 'currency') {
        currency = kinds[neighbour].currency;
        consumed = neighbour;
        break;
      }
    }
  }

  // Whatever is left is the description, minus sentence framing.
  let rest = words.filter((_, index) => index !== amountAt && index !== consumed);
  const lower = (word) => word.toLowerCase();
  while (rest.length > 0 && VERBS.has(lower(rest[0]))) rest.shift();
  while (rest.length > 0 && (ARTICLES.has(lower(rest[0])) || PREPOSITIONS.has(lower(rest[0])))) rest.shift();
  while (rest.length > 0 && PREPOSITIONS.has(lower(rest.at(-1)))) rest.pop();
  rest = rest.map((word) => word.replace(/^[,;:]+|[,;:]+$/g, '')).filter(Boolean);

  const description = rest.join(' ');
  if (!description) issues.push({ type: 'no-description' });

  return {
    description,
    amount: amountAt === null ? '' : kinds[amountAt].number,
    currency: currency ? resolve(currency) : null,
    issues,
  };
}
