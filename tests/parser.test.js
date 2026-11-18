import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpenseText } from '../src/services/parserService.js';

const parse = (text, options) => parseExpenseText(text, options);
const check = (text, description, amount, currency = null, options) => {
  const result = parse(text, options);
  assert.deepEqual([result.description, result.amount, result.currency], [description, amount, currency], text);
  assert.deepEqual(result.issues, [], `${text} should have no issues`);
};

describe('parseExpenseText: everyday phrasings', () => {
  it('"description amount"', () => {
    check('chips 20', 'chips', '20');
    check('chai 15', 'chai', '15');
    check('college printout 10', 'college printout', '10');
    check('groceries 250', 'groceries', '250');
    check('recharge 299', 'recharge', '299');
  });
  it('"amount description"', () => {
    check('50 petrol', 'petrol', '50');
    check('20 chips', 'chips', '20');
  });
  it('sentences', () => {
    check('bought a notebook for 65', 'notebook', '65');
    check('spent 40 on samosa', 'samosa', '40');
    check('paid 299 for recharge', 'recharge', '299');
    check('I spent 500 on groceries', 'groceries', '500');
    check('got a haircut for 150', 'haircut', '150');
    check('took bus 30', 'bus', '30');
    check('spent 40 on a samosa', 'samosa', '40');
  });
  it('decimals and grouped amounts are passed on for validation, unchanged', () => {
    check('coffee 49.50', 'coffee', '49.50');
    check('1,234.50 rent', 'rent', '1,234.50');
    check('rent 1,23,456', 'rent', '1,23,456');
    check('tea .5', 'tea', '.5');
  });
  it('tolerates trailing punctuation and the Indian "/-" suffix', () => {
    check('chips 20.', 'chips', '20');
    check('chips 20,', 'chips', '20');
    check('50/- petrol', 'petrol', '50');
  });
  it('is not bothered by extra spaces or capitals', () => {
    check('   Chips    20  ', 'Chips', '20');
    check('SPENT 40 ON Samosa', 'Samosa', '40');
  });
  it('keeps words that merely contain digits as part of the description', () => {
    check('7up 20', '7up', '20');
    check('4g recharge 299', '4g recharge', '299');
    check('cs101 book 450', 'cs101 book', '450');
    check('100ml bottle 30', '100ml bottle', '30');
  });
});

describe('parseExpenseText: currencies', () => {
  it('reads symbols stuck to the amount', () => {
    check('₹20 chips', 'chips', '20', 'INR');
    check('coffee €5', 'coffee', '5', 'EUR');
    check('book £12.50', 'book', '12.50', 'GBP');
    check('ramen ¥800', 'ramen', '800', 'JPY');
  });
  it('reads codes and words before or after the amount', () => {
    check('20 usd bus', 'bus', '20', 'USD');
    check('usd 20 bus', 'bus', '20', 'USD');
    check('bus 20USD', 'bus', '20', 'USD');
    check('lunch 12 eur', 'lunch', '12', 'EUR');
    check('rs 120 lunch', 'lunch', '120', 'INR');
    check('rs.120 lunch', 'lunch', '120', 'INR');
    check('lunch 20rs', 'lunch', '20', 'INR');
    check('coffee 5 dollars', 'coffee', '5', 'USD');
    check('chai 20 rupees', 'chai', '20', 'INR');
    check('sushi 800 yen', 'sushi', '800', 'JPY');
  });
  it('turns "$" into the default currency when that is a dollar currency', () => {
    check('coffee $5', 'coffee', '5', 'USD');
    check('coffee $5', 'coffee', '5', 'CAD', { defaultCurrency: 'CAD' });
    check('coffee $5', 'coffee', '5', 'SGD', { defaultCurrency: 'SGD' });
    check('coffee $5', 'coffee', '5', 'USD', { defaultCurrency: 'INR' });
  });
  it('leaves currency null when none is written (the default applies later)', () => {
    assert.equal(parse('chips 20').currency, null);
  });
  it('does not mistake a currency-looking word elsewhere for the currency', () => {
    const result = parse('pound cake 120');
    assert.equal(result.currency, null);
    assert.equal(result.description, 'pound cake');
  });
});

describe('parseExpenseText: things it must NOT guess', () => {
  it('reports a missing amount', () => {
    const result = parse('chips');
    assert.deepEqual(result.issues, [{ type: 'no-amount' }]);
    assert.equal(result.description, 'chips');
    assert.equal(result.amount, '');
  });
  it('reports a missing description', () => {
    for (const text of ['20', 'paid 200', '₹50']) {
      assert.deepEqual(parse(text).issues, [{ type: 'no-description' }], text);
    }
  });
  it('reports both problems for empty input', () => {
    assert.deepEqual(parse('').issues.map((i) => i.type).sort(), ['no-amount', 'no-description']);
    assert.deepEqual(parse(undefined).issues.map((i) => i.type).sort(), ['no-amount', 'no-description']);
  });
  it('asks which number is the amount when there are several', () => {
    const result = parse('2 samosa 30');
    assert.deepEqual(result.issues, [{ type: 'multiple-amounts', candidates: [{ index: 0, text: '2' }, { index: 1, text: '30' }] }]);
    assert.equal(result.amount, '');
  });
  it('uses the chosen number once the person has chosen', () => {
    const result = parse('2 samosa 30', { amountChoice: 1 });
    assert.deepEqual([result.description, result.amount, result.issues], ['2 samosa', '30', []]);
    assert.equal(parse('2 samosa 30', { amountChoice: 0 }).amount, '2');
  });
});
