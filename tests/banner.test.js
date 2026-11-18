import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BANNER_WIDTH, FONT, renderBanner } from '../src/ui/banner.js';
import { createTheme, stripAnsi } from '../src/ui/theme.js';

const plain = (unicode) => createTheme({ colorLevel: 0, unicode });

describe('banner font', () => {
  it('every letter is exactly 5 rows of 5 columns (so rows line up)', () => {
    for (const [letter, rows] of Object.entries(FONT)) {
      assert.equal(rows.length, 5, `${letter} should have 5 rows`);
      for (const row of rows) assert.equal(row.length, 5, `${letter} has a row of the wrong width`);
    }
  });
  it('contains every letter needed to spell POCKETPULSE', () => {
    for (const letter of new Set('POCKETPULSE')) assert.ok(FONT[letter], `missing ${letter}`);
  });
});

describe('renderBanner', () => {
  it('draws the full logo when there is room', () => {
    const lines = renderBanner(plain(true), { columns: 100 }).split('\n');
    assert.equal(lines.length, 7); // 5 art rows + rule + tagline
    assert.ok(lines[0].includes('█'));
    for (const line of lines.slice(0, 6)) assert.equal(line.length, BANNER_WIDTH);
  });
  it('uses # instead of █ on ASCII-only terminals', () => {
    const banner = renderBanner(plain(false), { columns: 100 });
    assert.ok(!banner.includes('█'));
    assert.ok(banner.includes('#'));
  });
  it('switches to a compact logo on narrow terminals', () => {
    const lines = renderBanner(plain(true), { columns: BANNER_WIDTH - 1 }).split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /POCKETPULSE/);
  });
  it('contains no colour codes at level 0 and loses nothing when stripped', () => {
    const coloured = renderBanner(createTheme({ colorLevel: 3, unicode: true }), { columns: 100 });
    const bare = renderBanner(plain(true), { columns: 100 });
    assert.ok(!bare.includes('\x1b'));
    assert.equal(stripAnsi(coloured), bare);
  });
});
