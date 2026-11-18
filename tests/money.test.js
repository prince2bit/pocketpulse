import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney, getMinorUnits, minorToDecimalString, normalizeCurrency, parseAmountToMinor,
  supportedCurrencyCodes,
} from '../src/utils/money.js';

const minor = (text, currency = 'INR') => parseAmountToMinor(text, currency);

describe('parseAmountToMinor: accepting amounts', () => {
  it('turns plain numbers into minor units', () => {
    assert.deepEqual(minor('20'), { ok: true, minor: 2000 });
    assert.deepEqual(minor('49.5'), { ok: true, minor: 4950 });
    assert.deepEqual(minor('49.50'), { ok: true, minor: 4950 });
    assert.deepEqual(minor('.5', 'USD'), { ok: true, minor: 50 });
    assert.deepEqual(minor('  20  '), { ok: true, minor: 2000 });
  });
  it('is exact where floating point is not (19.99 * 100 is 1998.9999999999998 in JavaScript)', () => {
    assert.equal(19.99 * 100 === 1999, false); // the trap we are avoiding
    assert.equal(minor('19.99').minor, 1999);
    assert.equal(minor('1.15').minor, 115);
    assert.equal(minor('0.07').minor, 7);
  });
  it('understands comma grouping, Western and Indian style', () => {
    assert.equal(minor('1,234.50').minor, 123450);
    assert.equal(minor('1,23,456').minor, 12345600);
  });
  it('allows extra decimal places only when they are zeros', () => {
    assert.equal(minor('20.000').minor, 2000);
  });
  it('respects currencies with no decimals', () => {
    assert.equal(minor('500', 'JPY').minor, 500);
  });
});

describe('parseAmountToMinor: rejecting amounts', () => {
  const rejected = (text, currency, pattern) => {
    const result = minor(text, currency);
    assert.equal(result.ok, false, `${JSON.stringify(text)} should be rejected`);
    assert.match(result.error, pattern);
  };
  it('rejects empty input', () => {
    rejected('', 'INR', /enter an amount/);
    rejected('   ', 'INR', /enter an amount/);
    assert.equal(parseAmountToMinor(undefined, 'INR').ok, false);
  });
  it('rejects negative amounts, including the typographic minus', () => {
    rejected('-20', 'INR', /positive/);
    rejected('−20', 'INR', /positive/);
  });
  it('rejects zero', () => {
    rejected('0', 'INR', /more than zero/);
    rejected('0.00', 'INR', /more than zero/);
  });
  it('rejects text and malformed numbers', () => {
    rejected('abc', 'INR', /doesn't look like an amount/);
    rejected('20.', 'INR', /doesn't look like an amount/);
    rejected('1.2.3', 'INR', /doesn't look like an amount/);
    rejected('1,5', 'INR', /doesn't look like an amount/); // must NOT silently become 15
    rejected('₹20', 'INR', /doesn't look like an amount/);
  });
  it('rejects too many decimal places instead of silently rounding', () => {
    rejected('20.555', 'INR', /at most 2 decimal places/);
    rejected('20.5', 'JPY', /no decimal places/);
  });
  it('rejects absurdly large amounts', () => {
    rejected('99999999999999999999', 'INR', /too large/);
  });
});

describe('currencies', () => {
  it('supports the nine required currencies', () => {
    assert.deepEqual(supportedCurrencyCodes(), ['INR', 'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'JPY', 'SGD']);
  });
  it('normalizes codes and rejects unknown ones', () => {
    assert.equal(normalizeCurrency(' usd '), 'USD');
    assert.equal(normalizeCurrency('xyz'), null);
    assert.equal(normalizeCurrency(''), null);
    assert.equal(normalizeCurrency(123), null);
  });
  it('knows how many decimals each currency has', () => {
    assert.equal(getMinorUnits('INR'), 2);
    assert.equal(getMinorUnits('USD'), 2);
    assert.equal(getMinorUnits('JPY'), 0);
  });
});

describe('formatMoney', () => {
  it('shows the right symbol and decimals', () => {
    assert.equal(formatMoney(2050, 'INR'), '₹20.50');
    assert.equal(formatMoney(599, 'USD'), '$5.99');
    assert.equal(formatMoney(500, 'JPY'), '¥500');
    assert.equal(formatMoney(1234, 'GBP'), '£12.34');
    assert.equal(formatMoney(1234, 'EUR'), '€12.34');
  });
  it('groups digits Indian-style for INR', () => {
    assert.equal(formatMoney(123456750, 'INR'), '₹12,34,567.50');
  });
  it('keeps Canadian and Australian dollars distinguishable from US dollars', () => {
    assert.equal(formatMoney(100, 'CAD'), 'CA$1.00');
    assert.equal(formatMoney(100, 'AUD'), 'A$1.00');
  });
});

describe('minorToDecimalString', () => {
  it('writes exact decimals', () => {
    assert.equal(minorToDecimalString(2000, 'INR'), '20.00');
    assert.equal(minorToDecimalString(5, 'USD'), '0.05');
    assert.equal(minorToDecimalString(500, 'JPY'), '500');
  });
  it('round-trips through the parser without losing a single unit', () => {
    for (const [value, currency] of [[1, 'INR'], [99, 'USD'], [2050, 'INR'], [123456789, 'GBP'], [7, 'JPY']]) {
      assert.equal(parseAmountToMinor(minorToDecimalString(value, currency), currency).minor, value);
    }
  });
});
