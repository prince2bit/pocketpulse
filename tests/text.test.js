import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTheme } from '../src/ui/theme.js';
import { formatCategory, padEndWidth, padStartWidth, stringWidth } from '../src/ui/text.js';
import { canonicalWord, canonicalize, tokenize } from '../src/utils/text.js';

describe('tokenize / canonicalize', () => {
  it('lowercases, drops punctuation and splits into words', () => {
    assert.deepEqual(tokenize('Bought: 2 Samosas!'), ['bought', '2', 'samosa']);
    assert.equal(canonicalize('  Face-Wash,  '), 'face wash');
  });
  it('makes plurals match singulars', () => {
    for (const [plural, singular] of [['chips', 'chip'], ['books', 'book'], ['sandwiches', 'sandwich'],
      ['boxes', 'box'], ['glasses', 'glass'], ['biscuits', 'biscuit'], ['movies', 'movie']]) {
      assert.equal(canonicalWord(plural), singular);
    }
  });
  it('leaves words that only LOOK plural alone', () => {
    for (const word of ['bus', 'gas', 'pass', 'campus', 'tennis', 'ors', 'lab']) assert.equal(canonicalWord(word), word);
  });
  it('copes with empty and odd input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(null), []);
    assert.deepEqual(tokenize('!!! ???'), []);
    assert.equal(canonicalize(undefined), '');
  });
  it('keeps letters from other languages', () => {
    assert.deepEqual(tokenize('चाय 20'), ['चाय', '20']);
  });
});

describe('stringWidth: measuring in terminal columns', () => {
  it('counts ordinary characters and ₹ as one column', () => {
    assert.equal(stringWidth('abc'), 3);
    assert.equal(stringWidth('₹20'), 3);
  });
  it('counts emoji as two columns, however many code points they use', () => {
    assert.equal(stringWidth('🍟'), 2);
    assert.equal(stringWidth('☕'), 2);
    assert.equal(stringWidth('🏋️'), 2); // emoji + invisible "show as emoji" marker
  });
  it('counts wide East Asian characters as two columns', () => {
    assert.equal(stringWidth('日本'), 4);
  });
  it('ignores colour codes', () => {
    assert.equal(stringWidth(createTheme({ env: {}, colorLevel: 3 }).primary('hello')), 5);
  });
  it('pads by columns, not characters', () => {
    assert.equal(stringWidth(padEndWidth('🍟 a', 8)), 8);
    assert.equal(stringWidth(padStartWidth('🍟', 5)), 5);
    assert.equal(padEndWidth('abcdef', 3), 'abcdef'); // never cuts text off
  });
});

describe('formatCategory', () => {
  const category = { icon: '🍟', name: 'Food & Snacks', color: 'orange' };
  it('shows icon and name', () => {
    assert.equal(formatCategory(createTheme({ env: {}, colorLevel: 0, unicode: true }), category), '🍟 Food & Snacks');
  });
  it('falls back to a letter in brackets without Unicode', () => {
    assert.equal(formatCategory(createTheme({ env: {}, colorLevel: 0, unicode: false }), category), '[F] Food & Snacks');
  });
  it('says Uncategorised when there is no category', () => {
    assert.equal(formatCategory(createTheme({ env: {}, colorLevel: 0, unicode: true }), null), 'Uncategorised');
  });
  it('uses the category\'s own colour', () => {
    const painted = formatCategory(createTheme({ env: {}, colorLevel: 3, unicode: true }), category);
    assert.ok(painted.startsWith('\x1b[38;2;255;159;28m'));
  });
});

import { truncateToWidth } from '../src/ui/text.js';
import { renderPanel } from '../src/ui/panel.js';

describe('truncateToWidth', () => {
  it('leaves text that fits alone', () => {
    assert.equal(truncateToWidth('hello', 10), 'hello');
    assert.equal(truncateToWidth('hello', 5), 'hello');
  });
  it('cuts to exactly the width, ending with an ellipsis', () => {
    assert.equal(truncateToWidth('hello world', 8), 'hello w…');
    assert.equal(stringWidth(truncateToWidth('hello world', 8)), 8);
    assert.equal(truncateToWidth('hello world', 8, '...'), 'hello...');
  });
  it('never splits a two-column character', () => {
    const cut = truncateToWidth('🍟🍟🍟🍟', 5); // 8 columns of text into 5: two emoji (4) + ellipsis (1)
    assert.equal(cut, '🍟🍟…');
    assert.equal(stringWidth(cut), 5);
  });
  it('keeps colour codes and adds a reset when it cuts inside colour, so colour cannot leak', () => {
    const theme = createTheme({ env: {}, colorLevel: 3, themeName: 'pulse' });
    const cut = truncateToWidth(theme.primary('hello world'), 7);
    assert.equal(stringWidth(cut), 7);
    assert.ok(cut.startsWith('\x1b[38;2;182;255;0mhello '));
    assert.ok(cut.includes('\x1b[0m…'));
  });
  it('does not touch coloured text that already fits', () => {
    const theme = createTheme({ env: {}, colorLevel: 3, themeName: 'pulse' });
    const text = theme.primary('hi');
    assert.equal(truncateToWidth(text, 10), text);
  });
  it('copes with tiny widths', () => {
    assert.equal(truncateToWidth('hello', 1), '…');
    assert.equal(truncateToWidth('hello', 0), '…');
    assert.equal(truncateToWidth('', 3), '');
  });
});

describe('renderPanel maxWidth', () => {
  const theme = createTheme({ env: {}, colorLevel: 0, unicode: true });
  it('clips over-long lines so the box stays a rectangle of the maximum width', () => {
    const box = renderPanel(theme, { title: 'T', lines: ['short', 'x'.repeat(100)], width: 20, maxWidth: 20 }).split('\n');
    assert.deepEqual(new Set(box.map(stringWidth)), new Set([24])); // 20 inside + borders and padding
    assert.ok(box[2].includes('…'));
  });
  it('does not clip anything when no maximum is given', () => {
    const box = renderPanel(theme, { lines: ['x'.repeat(100)] }).split('\n');
    assert.ok(!box.join('').includes('…'));
  });
});
