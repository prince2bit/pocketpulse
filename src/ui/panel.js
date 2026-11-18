// Bordered box with an optional title.

import { padEndWidth, stringWidth, truncateToWidth } from './text.js';

const UNICODE_BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
const ASCII_BOX = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };

/** @returns {string} the box as text, ready to print */
export function renderPanel(theme, { title = '', lines: rawLines, width = 0, maxWidth = Infinity }) {
  const box = theme.unicode ? UNICODE_BOX : ASCII_BOX;
  // maxWidth clips over-long lines with an ellipsis.
  const lines = rawLines.map((line) => truncateToWidth(line, maxWidth, theme.symbols.ellipsis));
  // Measure visible width in terminal columns.
  // width is a minimum inner width, so panels can line up.
  const widest = Math.max(width, ...lines.map(stringWidth), stringWidth(title) + 2);
  const border = (text) => theme.secondary(text);

  const top = title
    ? `${box.tl}${box.h} ${title} ${box.h.repeat(widest - stringWidth(title) - 1)}${box.tr}`
    : `${box.tl}${box.h.repeat(widest + 2)}${box.tr}`;

  const body = lines.map((line) => {
    return `${border(box.v)} ${padEndWidth(line, widest)} ${border(box.v)}`;
  });

  return [border(top), ...body, border(`${box.bl}${box.h.repeat(widest + 2)}${box.br}`)].join('\n');
}
