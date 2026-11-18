import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPercent, renderBar, sparkline } from '../src/ui/charts.js';
import { createTheme, stripAnsi } from '../src/ui/theme.js';
import { stringWidth, wrapText } from '../src/ui/text.js';

const uni = createTheme({ env: {}, colorLevel: 0, unicode: true });
const ascii = createTheme({ env: {}, colorLevel: 0, unicode: false });

describe('renderBar', () => {
  it('fills the right share of the width', () => {
    assert.equal(renderBar(uni, 0.5, 10), '█████░░░░░');
    assert.equal(renderBar(uni, 1, 4), '████');
    assert.equal(renderBar(uni, 0, 4), '░░░░');
  });
  it('always has exactly the requested width', () => {
    for (const fraction of [0, 0.03, 0.25, 0.5, 0.999, 1]) assert.equal(stringWidth(renderBar(uni, fraction, 24)), 24);
  });
  it('shows a small but real share as one block, never as nothing', () => {
    assert.equal(renderBar(uni, 0.001, 10), '█░░░░░░░░░');
  });
  it('clamps nonsense values', () => {
    assert.equal(renderBar(uni, -3, 4), '░░░░');
    assert.equal(renderBar(uni, 7, 4), '████');
  });
  it('uses plain ASCII without Unicode', () => {
    assert.equal(renderBar(ascii, 0.5, 4), '##--');
  });
  it('paints the filled part in the category colour and the rest muted', () => {
    const bar = renderBar(createTheme({ env: {}, colorLevel: 3, unicode: true }), 0.5, 4, 'orange');
    assert.ok(bar.startsWith('\x1b[38;2;255;159;28m██'));
    assert.equal(stripAnsi(bar), '██░░');
  });
});

describe('sparkline', () => {
  it('maps the biggest value to the tallest bar and zero to the lowest', () => {
    assert.equal(sparkline(uni, [0, 5, 10]), '▁▅█');
    assert.equal(sparkline(uni, [10, 10]), '██');
  });
  it('gives a tiny non-zero value a visible bar, taller than zero', () => {
    const [zero, tiny] = [...sparkline(uni, [0, 1, 1000])];
    assert.notEqual(zero, tiny);
  });
  it('is flat when everything is zero or there are no values', () => {
    assert.equal(sparkline(uni, [0, 0, 0]), '▁▁▁');
    assert.equal(sparkline(uni, []), '');
  });
  it('has one character per value, in ASCII too', () => {
    assert.equal([...sparkline(ascii, [0, 3, 9, 1, 0, 0, 7])].length, 7);
    assert.match(sparkline(ascii, [0, 3, 9]), /^[\x21-\x7e]+$/); // printable ASCII only
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    assert.equal(formatPercent(0.4), '40%');
    assert.equal(formatPercent(0.835), '84%');
    assert.equal(formatPercent(1), '100%');
    assert.equal(formatPercent(0), '0%');
  });
  it('says <1% for a small non-zero share instead of a misleading 0%', () => {
    assert.equal(formatPercent(0.003), '<1%');
  });
});

describe('wrapText', () => {
  it('wraps at spaces without exceeding the width', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 15);
    assert.ok(lines.every((line) => stringWidth(line) <= 15), JSON.stringify(lines));
    assert.equal(lines.join(' '), 'the quick brown fox jumps over the lazy dog');
  });
  it('keeps a word that is longer than the width whole, and handles empty text', () => {
    assert.deepEqual(wrapText('supercalifragilistic', 5), ['supercalifragilistic']);
    assert.deepEqual(wrapText('', 10), []);
  });
});
