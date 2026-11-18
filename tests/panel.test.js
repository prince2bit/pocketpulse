import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanel } from '../src/ui/panel.js';
import { createTheme, stripAnsi } from '../src/ui/theme.js';

describe('renderPanel', () => {
  it('draws a rectangle: every line is the same visible width', () => {
    const theme = createTheme({ env: {}, colorLevel: 3, unicode: true });
    const box = renderPanel(theme, { title: 'Hello', lines: ['short', theme.bold(theme.primary('a much longer line')), ''] });
    const widths = box.split('\n').map((line) => [...stripAnsi(line)].length);
    assert.equal(new Set(widths).size, 1, `uneven widths: ${widths}`);
    assert.ok(stripAnsi(box).includes('─ Hello ─'));
  });
  it('uses plain ASCII borders on terminals without Unicode', () => {
    const theme = createTheme({ env: {}, colorLevel: 0, unicode: false });
    const box = renderPanel(theme, { title: 'Hi', lines: ['x'] });
    assert.ok(/^[\x20-\x7e\n]+$/.test(box), 'only plain ASCII allowed');
  });
  it('grows to fit a title longer than its content', () => {
    const theme = createTheme({ env: {}, colorLevel: 0, unicode: true });
    const lines = renderPanel(theme, { title: 'A very long title', lines: ['x'] }).split('\n');
    assert.ok(lines[0].includes('A very long title'));
    assert.equal(new Set(lines.map((line) => [...line].length)).size, 1);
  });
});
