// Measuring text in terminal columns. "🍟".length is 2 and takes 2 columns, "₹" is 1
// and 1, so padding has to use columns. Covers emoji and East Asian wide characters
// only; it is not a full Unicode width table.

import { stripAnsi } from './theme.js';

const isZeroWidth = (cp) => cp === 0x200d // joins emoji together
  || (cp >= 0xfe00 && cp <= 0xfe0f) // "show as emoji" selectors
  || (cp >= 0x0300 && cp <= 0x036f) // accents that sit on the previous letter
  || (cp >= 0x200b && cp <= 0x200f);

const isWide = (cp) => (cp >= 0x1f300 && cp <= 0x1faff) // emoji
  || cp === 0x2615 || cp === 0x26a1 // ☕ ⚡ (emoji-style by default)
  || (cp >= 0x2e80 && cp <= 0xa4cf) // CJK
  || (cp >= 0xac00 && cp <= 0xd7a3) // Hangul
  || (cp >= 0xff00 && cp <= 0xff60);

/** How many terminal columns `text` occupies (colour codes don't count). */
export function stringWidth(text) {
  let width = 0;
  for (const character of stripAnsi(text)) {
    const codePoint = character.codePointAt(0);
    if (isZeroWidth(codePoint)) continue;
    width += isWide(codePoint) ? 2 : 1;
  }
  return width;
}

export const padEndWidth = (text, columns) => text + ' '.repeat(Math.max(0, columns - stringWidth(text)));
export const padStartWidth = (text, columns) => ' '.repeat(Math.max(0, columns - stringWidth(text))) + text;

/** "🍟 Food & Snacks" in the category's own colour (or "[F] Food..." without Unicode). */
export function formatCategory(theme, category) {
  if (!category) return theme.muted('Uncategorised');
  const icon = theme.unicode ? category.icon : `[${[...category.name][0].toUpperCase()}]`;
  return theme.category(category.color, `${icon} ${category.name}`);
}

/**
 * Break plain text into lines no wider than `width` columns, splitting at
 * spaces. (A single word longer than the width stays whole.)
 */
export function wrapText(text, width) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && stringWidth(candidate) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Cut `text` to at most `width` columns, ending with an ellipsis when it was
 * cut. Colour codes cost no width and are kept intact; if we cut inside a
 * coloured stretch, a reset code is added so colour can't leak onto the border.
 */
export function truncateToWidth(text, width, ellipsis = '…') {
  if (stringWidth(text) <= width) return text;
  const room = Math.max(0, width - stringWidth(ellipsis));
  let result = '';
  let used = 0;
  let sawColour = false;
  for (const part of String(text).split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) {
      result += part;
      sawColour = true;
      continue;
    }
    for (const character of part) {
      const columns = stringWidth(character);
      if (used + columns > room) return `${result}${sawColour ? '\x1b[0m' : ''}${ellipsis}`;
      result += character;
      used += columns;
    }
  }
  return result;
}
