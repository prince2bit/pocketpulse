import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCategory } from '../src/services/categorizer.js';
import { canonicalize } from '../src/utils/text.js';

// A tiny hand-made rule book, so these tests don't depend on the real seed data.
const FOOD = 1; const DRINKS = 2; const SHOP = 3; const FITNESS = 4;
const rule = (categoryId, keyword, source = 'default') => ({ categoryId, keyword, keywordNorm: canonicalize(keyword), source });
const RULES = [
  rule(FOOD, 'chips'), rule(FOOD, 'biscuits'), rule(DRINKS, 'chai'), rule(DRINKS, 'water'),
  rule(SHOP, 'water bottle'), rule(SHOP, 'bag'),
];
const suggest = (text, rules = RULES) => suggestCategory(text, rules);

describe('suggestCategory: matching', () => {
  it('finds a keyword anywhere in the description', () => {
    assert.equal(suggest('chips').categoryId, FOOD);
    assert.equal(suggest('spicy chips from canteen').categoryId, FOOD);
  });
  it('ignores capitals and punctuation, and matches plural to singular', () => {
    assert.equal(suggest('CHIPS!').categoryId, FOOD);
    assert.equal(suggest('Biscuit').categoryId, FOOD);
    assert.equal(suggest('chai,').categoryId, DRINKS);
  });
  it('only matches whole words ("bagel" is not "bag")', () => {
    assert.equal(suggest('bagel').confidence, 'none');
    assert.equal(suggest('chipset').confidence, 'none');
  });
  it('matches multi-word keywords only when the words are together and in order', () => {
    assert.equal(suggest('water bottle').categoryId, SHOP);
    assert.equal(suggest('bottle of water').categoryId, DRINKS); // not the phrase "water bottle"
  });
  it('reports which keyword matched', () => {
    const result = suggest('some Chips');
    assert.equal(result.keyword, 'chips');
    assert.equal(result.source, 'default');
  });
});

describe('suggestCategory: no match', () => {
  it('says "none" and no category, so the caller can use its fallback', () => {
    assert.deepEqual(suggest('groceries'), { categoryId: null, keyword: null, source: null, confidence: 'none', alternativeCategoryIds: [] });
  });
  it('copes with empty descriptions and an empty rule book', () => {
    assert.equal(suggest('').confidence, 'none');
    assert.equal(suggest('chips', []).confidence, 'none');
  });
});

describe('suggestCategory: which rule wins', () => {
  it('prefers the longer phrase over a word inside it', () => {
    const result = suggest('water bottle');
    assert.equal(result.categoryId, SHOP);
    assert.equal(result.confidence, 'high'); // "water" doesn't count as a competing match
  });
  it('lets YOUR rules beat built-in ones, even longer built-in ones', () => {
    const rules = [...RULES, rule(FITNESS, 'water', 'learned')];
    const result = suggest('water bottle', rules);
    assert.equal(result.categoryId, FITNESS);
    assert.equal(result.source, 'learned');
  });
  it('lets your rule override a built-in keyword outright', () => {
    assert.equal(suggest('chips', [...RULES, rule(FITNESS, 'chips', 'custom')]).categoryId, FITNESS);
  });
  it('is not confused by a built-in rule for the same words in another category', () => {
    const result = suggest('protein bar', [rule(FITNESS, 'protein bar', 'learned'), rule(FOOD, 'bar')]);
    assert.equal(result.categoryId, FITNESS);
    assert.equal(result.confidence, 'high');
  });
});

describe('suggestCategory: ambiguity', () => {
  it('flags low confidence when words point to different categories, and lists the alternatives', () => {
    const result = suggest('chips and chai');
    assert.equal(result.confidence, 'low');
    assert.deepEqual([result.categoryId, ...result.alternativeCategoryIds].sort(), [FOOD, DRINKS]);
  });
  it('is high confidence when several keywords agree', () => {
    const result = suggest('chips and biscuits');
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.alternativeCategoryIds, []);
  });
  it('is deterministic: the same input always gives the same answer', () => {
    const first = suggest('chips and chai');
    for (let i = 0; i < 20; i += 1) assert.deepEqual(suggest('chips and chai'), first);
  });
  it('does not depend on the order the rules are listed in', () => {
    assert.deepEqual(suggest('chips and chai', [...RULES].reverse()), suggest('chips and chai'));
  });
});
