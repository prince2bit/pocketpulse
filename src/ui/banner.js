// The PocketPulse logo, rendered from a small 5-row font table.

import { TAGLINE } from '../config/defaults.js';

// 5x5 glyphs. "#" becomes a block (█) on Unicode terminals.
export const FONT = {
  P: ['#### ', '#   #', '#### ', '#    ', '#    '],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'],
  K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
};

const WORD = 'POCKETPULSE';
const FONT_HEIGHT = 5;

// Rows are built once at load.
const ART_ROWS = Array.from({ length: FONT_HEIGHT }, (_, row) =>
  [...WORD].map((letter) => FONT[letter][row]).join(' '));

/** How many terminal columns the full logo needs. */
export const BANNER_WIDTH = ART_ROWS[0].length;

/**
 * Return the banner as a string, ready to print.
 * On narrow terminals (or when `compact` is set, for short windows) we use a
 * small two-line logo instead of letting the big art wrap into a mess.
 */
export function renderBanner(theme, { columns = 80, compact = false } = {}) {
  const { symbols } = theme;

  if (compact || columns < BANNER_WIDTH) {
    return [
      theme.bold(theme.primary(`${symbols.pulse} POCKETPULSE`)),
      theme.muted(TAGLINE),
    ].join('\n');
  }

  const art = ART_ROWS.map((row, index) =>
    theme.gradient(row.replaceAll('#', symbols.block), index / (FONT_HEIGHT - 1)));

  return [
    ...art,
    theme.secondary(symbols.rule.repeat(BANNER_WIDTH)),
    `${theme.primary(symbols.pulse)} ${theme.muted(TAGLINE)}`,
  ].join('\n');
}
