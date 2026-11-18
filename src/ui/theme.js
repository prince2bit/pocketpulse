// Colour support detection and the theme catalogue.
// Colour levels: 0 none, 1 basic 16, 2 256-colour, 3 truecolor.

// Themes name colour roles (primary, warn, ...) so the rest of the app never
// hardcodes a colour.
//   colors    [r, g, b] per role
//   gradient  the two colours the logo blends between
//   basic     fallback codes for 16-colour terminals

const WARN = [255, 159, 28];
const DANGER = [255, 70, 110];
const MUTED = [140, 140, 155];
const BASIC_COMMON = { warn: 33, danger: 91, muted: 90 };

export const THEMES = {
  pulse: {
    description: 'Neon lime into electric cyan',
    colors: { primary: [182, 255, 0], secondary: [0, 229, 255], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[182, 255, 0], [0, 229, 255]],
    basic: { ...BASIC_COMMON, primary: 92, secondary: 96 },
  },
  sunset: {
    description: 'Warm amber fading into hot pink',
    colors: { primary: [255, 150, 50], secondary: [255, 90, 160], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[255, 190, 50], [255, 50, 150]],
    basic: { ...BASIC_COMMON, primary: 33, secondary: 95 },
  },
  ocean: {
    description: 'Deep blue into soft aqua. Easy on the eyes',
    colors: { primary: [64, 196, 255], secondary: [120, 255, 214], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[40, 140, 255], [120, 255, 214]],
    basic: { ...BASIC_COMMON, primary: 94, secondary: 96 },
  },
  grape: {
    description: 'Violet into candy pink',
    colors: { primary: [185, 140, 255], secondary: [255, 120, 200], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[140, 110, 255], [255, 120, 200]],
    basic: { ...BASIC_COMMON, primary: 95, secondary: 94 },
  },
  ember: {
    description: 'Red-hot into golden yellow',
    colors: { primary: [255, 110, 50], secondary: [255, 205, 70], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[255, 60, 50], [255, 210, 70]],
    basic: { ...BASIC_COMMON, primary: 91, secondary: 93 },
  },
  matrix: {
    description: 'Classic green-on-black hacker terminal',
    colors: { primary: [0, 255, 100], secondary: [120, 255, 160], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[0, 255, 90], [0, 120, 50]],
    basic: { ...BASIC_COMMON, primary: 92, secondary: 32 },
  },
  mono: {
    description: 'No colour personality: clean white and grey',
    colors: { primary: [240, 240, 240], secondary: [170, 170, 180], warn: WARN, danger: DANGER, muted: MUTED },
    gradient: [[255, 255, 255], [120, 120, 130]],
    basic: { ...BASIC_COMMON, primary: 97, secondary: 37 },
  },
};

// Category colours are chosen by the person (and stored by name), so they live
// outside the themes: "orange" stays orange whichever theme is active.
export const CATEGORY_COLORS = {
  lime: { rgb: [182, 255, 0], basic: 92 },
  yellow: { rgb: [255, 220, 60], basic: 93 },
  orange: { rgb: [255, 159, 28], basic: 33 },
  red: { rgb: [255, 70, 70], basic: 91 },
  pink: { rgb: [255, 130, 190], basic: 95 },
  magenta: { rgb: [255, 46, 147], basic: 95 },
  purple: { rgb: [170, 120, 255], basic: 35 },
  blue: { rgb: [70, 130, 255], basic: 94 },
  cyan: { rgb: [0, 229, 255], basic: 96 },
  teal: { rgb: [0, 200, 170], basic: 36 },
  grey: { rgb: [140, 140, 155], basic: 90 },
};

export const DEFAULT_THEME = 'ocean';

/** Turn user input like "Ocean" into a valid theme key, or null if unknown. */
export function resolveThemeName(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  return Object.hasOwn(THEMES, key) ? key : null;
}

// ANSI escape prefix.
const ESC = '\x1b[';

/** Remove colour codes from a string (handy for tests and for measuring width). */
export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

/** Convert an [r, g, b] colour to the nearest of the 256-colour palette. */
export function rgbToAnsi256([r, g, b]) {
  if (r === g && g === b) {
    // Greys have their own ramp (codes 232-255)
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  // Everything else lives on a 6x6x6 colour cube starting at code 16
  const toCube = (value) => Math.round((value / 255) * 5);
  return 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
}

/**
 * Decide how many colours we may use.
 * The environment is passed IN (instead of read from `process` directly) so
 * tests can simulate any terminal without touching the real one.
 */
export function detectColorLevel({ env, isTTY, platform }) {
  // https://no-color.org: if NO_COLOR is set to anything non-empty, no colour. Ever.
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0;

  const force = env.FORCE_COLOR;
  if (force === '0' || force === 'false') return 0;
  const forced = force !== undefined;

  // When output is piped to a file or another program, don't send colour codes.
  if (!forced && !isTTY) return 0;
  if (env.TERM === 'dumb') return 0;

  if (force === '1') return 1;
  if (force === '2') return 2;
  if (force === '3') return 3;

  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 3;
  if (env.WT_SESSION) return 3; // Windows Terminal
  if (platform === 'win32') return 2;
  if (/256color/i.test(env.TERM ?? '')) return 2;
  return 1;
}

/** Can we safely print Unicode symbols like █ and ✔ ? */
export function detectUnicode({ env, platform }) {
  if (env.POCKETPULSE_ASCII) return false; // manual escape hatch
  if (platform === 'win32') {
    return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuTask);
  }
  // POSIX rule: LC_ALL beats LC_CTYPE beats LANG
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return /utf-?8/i.test(locale);
}

const UNICODE_SYMBOLS = {
  block: '█', rule: '━', bullet: '•', arrow: '›',
  tick: '✔', cross: '✖', warn: '▲', pulse: '⚡',
  dot: '·', ellipsis: '…', times: '×', up: '▲', down: '▼',
};
const ASCII_SYMBOLS = {
  block: '#', rule: '-', bullet: '*', arrow: '>',
  tick: 'v', cross: 'x', warn: '!', pulse: '*',
  dot: '-', ellipsis: '...', times: 'x', up: '^', down: 'v',
};

/**
 * Build a theme object. With no options it inspects the real terminal;
 * tests pass explicit options instead.
 *
 * Theme choice, strongest first: options.themeName, then the
 * POCKETPULSE_THEME environment variable, then the default.
 */
export function createTheme(options = {}) {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const platform = options.platform ?? process.platform;

  const level = options.colorLevel ?? detectColorLevel({ env, isTTY, platform });
  const unicode = options.unicode ?? detectUnicode({ env, platform });
  const name = resolveThemeName(options.themeName ?? env.POCKETPULSE_THEME) ?? DEFAULT_THEME;
  const definition = THEMES[name];

  // Paint text with an exact [r, g, b] colour, downgrading as needed.
  const paintRgb = (rgb, text) => {
    const value = String(text);
    if (level === 0) return value;
    const open = level === 3
      ? `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
      : `${ESC}38;5;${rgbToAnsi256(rgb)}m`;
    return `${open}${value}${ESC}39m`; // 39 = "back to default colour"
  };

  // Paint text with a role colour from the current theme.
  const paint = (role, text) => {
    const value = String(text);
    if (level === 0) return value;
    if (level === 1) return `${ESC}${definition.basic[role]}m${value}${ESC}39m`;
    return paintRgb(definition.colors[role], value);
  };

  // Bold and dim are "styles", not colours, so every level >= 1 shares them.
  const style = (openCode, text) =>
    level === 0 ? String(text) : `${ESC}${openCode}m${text}${ESC}22m`;

  // Blend the theme's two gradient colours. t=0 is the first, t=1 the second.
  const gradient = (text, t) => {
    if (level === 0) return String(text);
    if (level === 1) return paint(t < 0.5 ? 'primary' : 'secondary', text);
    const [from, to] = definition.gradient;
    const rgb = from.map((start, i) => Math.round(start + (to[i] - start) * t));
    return paintRgb(rgb, text);
  };

  return Object.freeze({
    name,
    level,
    unicode,
    symbols: unicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS,
    primary: (text) => paint('primary', text),
    secondary: (text) => paint('secondary', text),
    warn: (text) => paint('warn', text),
    danger: (text) => paint('danger', text),
    muted: (text) => paint('muted', text),
    bold: (text) => style(1, text),
    dim: (text) => style(2, text),
    gradient,
    /** Paint text in one of the CATEGORY_COLORS (unknown names fall back to grey). */
    category: (colorName, text) => {
      const color = CATEGORY_COLORS[colorName] ?? CATEGORY_COLORS.grey;
      if (level === 0) return String(text);
      if (level === 1) return `${ESC}${color.basic}m${text}${ESC}39m`;
      return paintRgb(color.rgb, text);
    },
  });
}
