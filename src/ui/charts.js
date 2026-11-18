// Text-mode bar and sparkline. Decorative: the numbers are always printed next to them.

/**
 * A bar like ████████░░░░ showing `fraction` (0 to 1) of `width` columns.
 * A tiny-but-real share still gets one block, so it never looks like zero.
 */
export function renderBar(theme, fraction, width, colorName) {
  const clamped = Math.max(0, Math.min(1, fraction));
  let filled = Math.round(clamped * width);
  if (clamped > 0 && filled === 0) filled = 1;
  const full = theme.symbols.block.repeat(filled);
  const empty = (theme.unicode ? '░' : '-').repeat(width - filled);
  return (colorName ? theme.category(colorName, full) : theme.primary(full)) + theme.muted(empty);
}

/** "▂▁▃▇▂▁▅": one character per value, taller = bigger. Zero shows as the lowest bar. */
export function sparkline(theme, values) {
  const levels = [...(theme.unicode ? '▁▂▃▄▅▆▇█' : '._-=+*#@')];
  const max = Math.max(0, ...values);
  return values.map((value) => {
    if (value <= 0 || max === 0) return levels[0];
    // Anything above zero gets at least level 1, so a small spend is still visible.
    return levels[1 + Math.round((value / max) * (levels.length - 2))];
  }).join('');
}

/** 0.4 -> "40%", but a small non-zero share says "<1%" instead of a misleading "0%". */
export function formatPercent(fraction) {
  if (fraction <= 0) return '0%';
  const rounded = Math.round(fraction * 100);
  return rounded === 0 ? '<1%' : `${rounded}%`;
}
