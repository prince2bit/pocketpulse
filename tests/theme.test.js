import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_COLORS, DEFAULT_THEME, THEMES, createTheme, detectColorLevel, detectUnicode,
  resolveThemeName, rgbToAnsi256, stripAnsi,
} from '../src/ui/theme.js';

// A fake terminal: tests describe the environment instead of using the real one.
const terminal = (env = {}, overrides = {}) => ({ env, isTTY: true, platform: 'linux', ...overrides });

describe('detectColorLevel', () => {
  it('turns colour off when NO_COLOR is set', () => {
    assert.equal(detectColorLevel(terminal({ NO_COLOR: '1', COLORTERM: 'truecolor' })), 0);
  });
  it('ignores an EMPTY NO_COLOR, per the no-color.org rule', () => {
    assert.equal(detectColorLevel(terminal({ NO_COLOR: '', COLORTERM: 'truecolor' })), 3);
  });
  it('turns colour off when output is not a terminal (piped to a file)', () => {
    assert.equal(detectColorLevel(terminal({ COLORTERM: 'truecolor' }, { isTTY: false })), 0);
  });
  it('turns colour off for TERM=dumb', () => {
    assert.equal(detectColorLevel(terminal({ TERM: 'dumb' })), 0);
  });
  it('detects truecolor, 256-colour and basic terminals', () => {
    assert.equal(detectColorLevel(terminal({ COLORTERM: '24bit' })), 3);
    assert.equal(detectColorLevel(terminal({ TERM: 'xterm-256color' })), 2);
    assert.equal(detectColorLevel(terminal({ TERM: 'xterm' })), 1);
  });
  it('honours FORCE_COLOR even when piped, but NO_COLOR still wins', () => {
    assert.equal(detectColorLevel(terminal({ FORCE_COLOR: '2' }, { isTTY: false })), 2);
    assert.equal(detectColorLevel(terminal({ FORCE_COLOR: '3', NO_COLOR: '1' })), 0);
  });
});

describe('detectUnicode', () => {
  it('reads UTF-8 from the locale on Linux/macOS', () => {
    assert.equal(detectUnicode({ env: { LANG: 'en_US.UTF-8' }, platform: 'linux' }), true);
    assert.equal(detectUnicode({ env: { LANG: 'C' }, platform: 'linux' }), false);
  });
  it('LC_ALL takes priority over LANG', () => {
    assert.equal(detectUnicode({ env: { LC_ALL: 'C', LANG: 'en_US.UTF-8' }, platform: 'linux' }), false);
  });
  it('trusts Windows Terminal but not the legacy console', () => {
    assert.equal(detectUnicode({ env: { WT_SESSION: 'x' }, platform: 'win32' }), true);
    assert.equal(detectUnicode({ env: {}, platform: 'win32' }), false);
  });
  it('can be forced to ASCII', () => {
    assert.equal(detectUnicode({ env: { LANG: 'en_US.UTF-8', POCKETPULSE_ASCII: '1' }, platform: 'linux' }), false);
  });
});

// env: {} keeps these tests independent of whatever is in YOUR shell
// (for example a POCKETPULSE_THEME you exported earlier).
describe('createTheme', () => {
  it('returns text untouched at colour level 0', () => {
    const theme = createTheme({ env: {}, colorLevel: 0 });
    assert.equal(theme.primary('hi'), 'hi');
    assert.equal(theme.bold('hi'), 'hi');
    assert.equal(theme.gradient('hi', 0.5), 'hi');
  });
  it('uses exact RGB codes on truecolor', () => {
    const theme = createTheme({ env: {}, colorLevel: 3, themeName: 'pulse' });
    assert.equal(theme.primary('hi'), '\x1b[38;2;182;255;0mhi\x1b[39m');
  });
  it('uses 256-colour codes at level 2 and basic codes at level 1', () => {
    assert.match(createTheme({ env: {}, colorLevel: 2 }).secondary('hi'), /^\x1b\[38;5;\d+mhi\x1b\[39m$/);
    assert.equal(createTheme({ env: {}, colorLevel: 1, themeName: 'pulse' }).primary('hi'), '\x1b[92mhi\x1b[39m');
  });
  it('stripAnsi removes every colour code', () => {
    const theme = createTheme({ env: {}, colorLevel: 3 });
    assert.equal(stripAnsi(theme.bold(theme.primary('hi'))), 'hi');
  });
  it('gradient goes from the first theme colour (t=0) to the second (t=1)', () => {
    const theme = createTheme({ env: {}, colorLevel: 3, themeName: 'pulse' });
    assert.equal(theme.gradient('x', 0), '\x1b[38;2;182;255;0mx\x1b[39m');
    assert.equal(theme.gradient('x', 1), '\x1b[38;2;0;229;255mx\x1b[39m');
  });
  it('picks ASCII symbols when Unicode is unavailable', () => {
    assert.equal(createTheme({ env: {}, colorLevel: 0, unicode: false }).symbols.block, '#');
    assert.equal(createTheme({ env: {}, colorLevel: 0, unicode: true }).symbols.block, '█');
  });
});

describe('themes', () => {
  it('every theme defines all five roles, a gradient and a basic fallback', () => {
    const roles = ['primary', 'secondary', 'warn', 'danger', 'muted'];
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const role of roles) {
        assert.equal(theme.colors[role]?.length, 3, `${name}.colors.${role} needs [r, g, b]`);
        assert.ok(Number.isInteger(theme.basic[role]), `${name}.basic.${role} is missing`);
      }
      assert.equal(theme.gradient.length, 2, `${name} needs two gradient colours`);
      assert.ok(theme.description, `${name} needs a description`);
    }
  });
  it('has a default theme that exists', () => {
    assert.ok(THEMES[DEFAULT_THEME]);
  });
  it('resolveThemeName is forgiving about case and spaces, and rejects unknown names', () => {
    assert.equal(resolveThemeName(' Ocean '), 'ocean');
    assert.equal(resolveThemeName('nonsense'), null);
    assert.equal(resolveThemeName(undefined), null);
    assert.equal(resolveThemeName('constructor'), null); // inherited object keys must not count
  });
  it('an explicit themeName beats the environment variable', () => {
    const theme = createTheme({ env: { POCKETPULSE_THEME: 'grape' }, colorLevel: 0, themeName: 'ocean' });
    assert.equal(theme.name, 'ocean');
  });
  it('reads POCKETPULSE_THEME, and falls back to the default if it is garbage', () => {
    assert.equal(createTheme({ env: { POCKETPULSE_THEME: 'grape' }, colorLevel: 0 }).name, 'grape');
    assert.equal(createTheme({ env: { POCKETPULSE_THEME: 'zzz' }, colorLevel: 0 }).name, DEFAULT_THEME);
  });
  it('different themes really produce different colours', () => {
    const colours = Object.keys(THEMES).map((themeName) =>
      createTheme({ env: {}, colorLevel: 3, themeName }).gradient('x', 0));
    assert.equal(new Set(colours).size, Object.keys(THEMES).length);
  });
});

describe('category colours', () => {
  it('paints in the category\'s own colour, whatever theme is active', () => {
    for (const themeName of ['pulse', 'sunset', 'mono']) {
      assert.equal(createTheme({ env: {}, colorLevel: 3, themeName }).category('orange', 'x'), '\x1b[38;2;255;159;28mx\x1b[39m');
    }
  });
  it('has a fallback for unknown colour names, and plain text without colour', () => {
    assert.equal(createTheme({ env: {}, colorLevel: 3 }).category('nonsense', 'x'), '\x1b[38;2;140;140;155mx\x1b[39m');
    assert.equal(createTheme({ env: {}, colorLevel: 0 }).category('orange', 'x'), 'x');
    assert.equal(createTheme({ env: {}, colorLevel: 1 }).category('orange', 'x'), '\x1b[33mx\x1b[39m');
  });
  it('offers every colour on the 16-colour fallback too', () => {
    for (const name of Object.keys(CATEGORY_COLORS)) {
      assert.match(createTheme({ env: {}, colorLevel: 1 }).category(name, 'x'), /^\x1b\[\d+mx\x1b\[39m$/);
    }
  });
});

describe('rgbToAnsi256', () => {
  it('maps pure colours to the 6x6x6 cube', () => {
    assert.equal(rgbToAnsi256([255, 0, 0]), 196);
    assert.equal(rgbToAnsi256([0, 0, 255]), 21);
  });
  it('maps greys to the grey ramp', () => {
    assert.equal(rgbToAnsi256([0, 0, 0]), 16);
    assert.equal(rgbToAnsi256([255, 255, 255]), 231);
  });
});
