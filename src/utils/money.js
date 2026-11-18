// Amounts and currencies.
//
// Money is stored as an integer count of the currency's minor unit (₹20.50 -> 2050,
// ¥500 -> 500), never as a float: 0.1 + 0.2 is 0.30000000000000004. Decimals only
// appear when formatting for display.

import { DEFAULT_CURRENCY } from '../config/defaults.js';

// locale controls grouping and symbols: en-IN groups as 12,34,567, and en-US shows
// CA$ / A$ so the dollar currencies stay distinguishable.
export const SUPPORTED_CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', name: 'Euro', locale: 'en-IE' },
  { code: 'GBP', name: 'British Pound', locale: 'en-GB' },
  { code: 'AED', name: 'UAE Dirham', locale: 'en-AE' },
  { code: 'CAD', name: 'Canadian Dollar', locale: 'en-US' },
  { code: 'AUD', name: 'Australian Dollar', locale: 'en-US' },
  { code: 'JPY', name: 'Japanese Yen', locale: 'en-US' },
  { code: 'SGD', name: 'Singapore Dollar', locale: 'en-US' },
];

// Upper bound in minor units; mostly guards against typos.
const MAX_MINOR = 1_000_000_000_000;

/** "usd " -> "USD", or null if we don't support it. */
export function normalizeCurrency(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.some((currency) => currency.code === code) ? code : null;
}

export const supportedCurrencyCodes = () => SUPPORTED_CURRENCIES.map((currency) => currency.code);

/** How many decimal places does this currency use? 2 for INR/USD, 0 for JPY. */
export function getMinorUnits(currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency })
    .resolvedOptions().maximumFractionDigits;
}

// One formatter per currency; constructing them is slow.
const formatters = new Map();
function getFormatter(currency) {
  if (!formatters.has(currency)) {
    const locale = SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.locale ?? 'en-US';
    formatters.set(currency, new Intl.NumberFormat(locale, { style: 'currency', currency }));
  }
  return formatters.get(currency);
}

/** 2050, 'INR' -> "₹20.50".  Display only: never do maths on the result. */
export function formatMoney(minor, currency = DEFAULT_CURRENCY) {
  return getFormatter(currency).format(minor / 10 ** getMinorUnits(currency));
}

/** 2050, 'INR' -> "20.50": a plain decimal string, used to pre-fill edit prompts. */
export function minorToDecimalString(minor, currency) {
  const digits = getMinorUnits(currency);
  if (digits === 0) return String(minor);
  const padded = String(minor).padStart(digits + 1, '0');
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

// Accepted shapes: 20  |  20.5  |  .5  |  1,234.50  |  1,23,456 (Indian grouping)
const PLAIN_NUMBER = /^(\d+(\.\d+)?|\.\d+)$/;
const GROUPED_NUMBER = /^\d{1,3}(,\d{2,3})+(\.\d+)?$/;

/**
 * Turn what the person typed into minor units, WITHOUT using decimal maths.
 * Returns { ok: true, minor } or { ok: false, error } with a friendly message.
 */
export function parseAmountToMinor(text, currency) {
  const fail = (error) => ({ ok: false, error });
  const raw = String(text ?? '').trim();

  if (!raw) return fail('Please enter an amount, like 20 or 49.50.');
  if (/^[-−]/.test(raw)) return fail('Amounts must be positive. Just enter what you spent, like 20.');

  let number;
  if (PLAIN_NUMBER.test(raw)) number = raw;
  else if (GROUPED_NUMBER.test(raw)) number = raw.replaceAll(',', '');
  else return fail(`"${raw}" doesn't look like an amount. Try something like 20 or 49.50.`);

  const [whole = '0', fraction = ''] = number.split('.');
  const digits = getMinorUnits(currency);

  // Extra decimal places are only OK if they're zeros (20.000 is just 20).
  const extra = fraction.slice(digits);
  if (/[1-9]/.test(extra)) {
    return fail(digits === 0
      ? `${currency} has no decimal places, so ${raw} isn't valid. Try a whole number.`
      : `${currency} amounts can have at most ${digits} decimal places.`);
  }

  const minor = Number(`${whole}${fraction.slice(0, digits).padEnd(digits, '0')}`);
  if (minor === 0) return fail('The amount must be more than zero.');
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return fail('That amount is too large. Is there an extra zero?');

  return { ok: true, minor };
}
