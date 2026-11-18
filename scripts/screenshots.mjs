// Generates the README screenshots as SVG files in docs/images/.
//
//   node scripts/screenshots.mjs [--theme ocean] [--out docs/images]
//
// The images are not photos of a terminal. This script runs the real program
// code against a fixed sample dataset and clock, replays its output through a
// small terminal emulator, and draws the resulting character grid as SVG.
// Box borders and bars are drawn as shapes so they line up with any font.
// (The PNGs in docs/images were made by loading these SVGs in headless Chromium.)

import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createApp } from '../src/app.js';
import { runAdd } from '../src/cli/addCommand.js';
import { runCli } from '../src/cli/commands.js';
import { runHome } from '../src/cli/interactive.js';
import { renderBanner } from '../src/ui/banner.js';
import { renderDashboard } from '../src/ui/dashboard.js';
import { createPrompts } from '../src/ui/prompts.js';
import { stringWidth } from '../src/ui/text.js';
import { createTheme } from '../src/ui/theme.js';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const THEME = option('--theme', 'ocean');
const OUT = path.resolve(import.meta.dirname, '..', option('--out', 'docs/images'));
const COLUMNS = 80;

// ── Sample data: a student's October and the first 12 days of November ───────

const SAMPLE = [
  ['2026-10-01', '09:10', 'mess', '1200'], ['2026-10-02', '18:00', 'recharge', '299'], ['2026-10-03', '17:30', 'groceries', '340'],
  ['2026-10-04', '08:20', 'chai', '20'], ['2026-10-05', '08:40', 'bus', '40'], ['2026-10-06', '12:10', 'notebook', '120'],
  ['2026-10-07', '16:30', 'samosa', '30'], ['2026-10-08', '11:00', 'printout', '25'], ['2026-10-09', '20:15', 'movie', '220'],
  ['2026-10-10', '21:00', 'pizza', '349'], ['2026-10-11', '08:30', 'chai', '20'], ['2026-10-12', '09:00', 'metro', '60'],
  ['2026-10-13', '22:10', 'maggi', '28'], ['2026-10-14', '19:00', 'shampoo', '180'], ['2026-10-15', '08:45', 'bus', '40'],
  ['2026-10-16', '15:20', 'coffee', '90'], ['2026-10-17', '13:00', 'books', '450'], ['2026-10-18', '17:00', 'chips', '20'],
  ['2026-10-19', '10:30', 'auto', '70'], ['2026-10-20', '18:30', 'groceries', '410'], ['2026-10-21', '08:10', 'chai', '20'],
  ['2026-10-22', '13:30', 'lunch', '110'], ['2026-10-23', '16:00', 'haircut', '150'], ['2026-10-24', '08:50', 'bus', '40'],
  ['2026-10-25', '20:00', 'movie', '180'], ['2026-10-26', '14:00', 'biryani', '180'], ['2026-10-27', '08:25', 'chai', '20'],
  ['2026-10-28', '09:05', 'metro', '60'], ['2026-10-29', '19:40', 'medicine', '85'], ['2026-10-30', '16:45', 'samosa', '30'],
  ['2026-10-31', '21:30', 'pizza', '299'],
  ['2026-11-01', '09:00', 'mess', '1200'], ['2026-11-02', '18:00', 'recharge', '299'], ['2026-11-02', '08:30', 'chai', '20'],
  ['2026-11-03', '08:45', 'bus', '40'], ['2026-11-03', '17:30', 'groceries', '380'], ['2026-11-04', '12:00', 'notebook', '65'],
  ['2026-11-04', '16:30', 'samosa', '30'], ['2026-11-05', '09:00', 'metro', '60'], ['2026-11-05', '13:30', 'lunch', '120'],
  ['2026-11-06', '20:15', 'movie', '250'], ['2026-11-06', '17:00', 'chips', '20'], ['2026-11-07', '21:00', 'pizza', '320'],
  ['2026-11-07', '10:30', 'auto', '80'], ['2026-11-08', '15:20', 'coffee', '110'], ['2026-11-08', '19:00', 'shampoo', '190'],
  ['2026-11-09', '08:20', 'chai', '20'], ['2026-11-09', '08:50', 'bus', '40'], ['2026-11-09', '11:00', 'printout', '35'],
  ['2026-11-10', '18:30', 'groceries', '420'], ['2026-11-10', '22:10', 'maggi', '28'], ['2026-11-11', '08:15', 'chai', '20'],
  ['2026-11-11', '09:00', 'metro', '60'], ['2026-11-11', '14:00', 'books', '380'], ['2026-11-12', '08:25', 'chai', '20'],
  ['2026-11-12', '12:45', 'samosa', '30'], ['2026-11-12', '13:30', 'lunch', '110'], ['2026-11-12', '18:20', 'bus', '40'],
  ['2026-11-12', '19:10', 'udemy course', '12', 'USD'],
];
const NOW = new Date('2026-11-12T21:40:00+05:30'); // Thursday evening in India
const ZONE = 'Asia/Kolkata';

async function sampleApp() {
  const clock = { now: NOW };
  const app = await createApp({ dbPath: ':memory:', clock: () => clock.now, systemTimeZone: () => ZONE });
  for (const [date, time, description, amount, currency] of SAMPLE) {
    clock.now = new Date(`${date}T${time}:00+05:30`);
    app.expenses.save(app.expenses.validate({ description, amount, currency }).draft);
  }
  clock.now = NOW;
  app.settings.markSetupDone();
  return app;
}

// ── A minimal terminal emulator: enough to replay this program's output ──────

const DEFAULT_FG = [205, 214, 224];

class Screen {
  constructor(columns) {
    this.columns = columns;
    this.rows = [];
    this.row = 0;
    this.col = 0;
    this.style = { fg: null, bold: false, dim: false };
  }

  cell(row, col) {
    while (this.rows.length <= row) this.rows.push(Array.from({ length: this.columns }, () => null));
    return this.rows[row];
  }

  put(character) {
    const width = stringWidth(character);
    if (width === 0) { // an invisible joiner or emoji selector: attach it to the previous glyph
      const previous = this.cell(this.row)[this.col - 1] ?? this.cell(this.row)[this.col - 2];
      if (previous && !previous.continuation) previous.ch += character;
      return;
    }
    const line = this.cell(this.row);
    line[this.col] = { ch: character, width, ...this.style };
    if (width === 2) line[this.col + 1] = { continuation: true };
    this.col += width;
  }

  write(text) {
    for (let i = 0; i < text.length;) {
      const code = text.codePointAt(i);
      const character = String.fromCodePoint(code);
      i += character.length;
      if (character === '\x1b' && text[i] === '[') {
        const end = text.slice(i + 1).search(/[@-~]/);
        const params = text.slice(i + 1, i + 1 + end);
        this.csi(params, text[i + 1 + end]);
        i += end + 2;
      } else if (character === '\n') { this.row += 1; this.col = 0; this.cell(this.row); }
      else if (character === '\r') this.col = 0;
      else if (code >= 0x20) this.put(character);
    }
  }

  csi(params, final) {
    const numbers = params.replace('?', '').split(';').map((n) => (n === '' ? NaN : Number(n)));
    const first = Number.isNaN(numbers[0]) ? undefined : numbers[0];
    if (params.startsWith('?')) return; // cursor show/hide and similar: not drawn
    if (final === 'm') return this.sgr(numbers.map((n) => (Number.isNaN(n) ? 0 : n)));
    if (final === 'A') this.row = Math.max(0, this.row - (first ?? 1));
    if (final === 'B') this.row += first ?? 1;
    if (final === 'C') this.col += first ?? 1;
    if (final === 'D') this.col = Math.max(0, this.col - (first ?? 1));
    if (final === 'G') this.col = Math.max(0, (first ?? 1) - 1);
    if (final === 'H') { this.row = Math.max(0, (first ?? 1) - 1); this.col = Math.max(0, (numbers[1] || 1) - 1); }
    if (final === 'K') {
      const line = this.cell(this.row);
      const from = first === 2 ? 0 : this.col;
      for (let c = from; c < this.columns; c += 1) line[c] = null;
    }
    if (final === 'J') {
      if (first === 2) { this.rows = []; this.row = 0; this.col = 0; return undefined; }
      const line = this.cell(this.row);
      for (let c = this.col; c < this.columns; c += 1) line[c] = null;
      this.rows.length = this.row + 1; // everything below the cursor is erased
    }
    return undefined;
  }

  sgr(codes) {
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      if (code === 0) this.style = { fg: null, bold: false, dim: false };
      else if (code === 1) this.style = { ...this.style, bold: true };
      else if (code === 2) this.style = { ...this.style, dim: true };
      else if (code === 22) this.style = { ...this.style, bold: false, dim: false };
      else if (code === 39) this.style = { ...this.style, fg: null };
      else if (code === 38 && codes[i + 1] === 2) { this.style = { ...this.style, fg: codes.slice(i + 2, i + 5) }; i += 4; }
    }
  }

  text() { return this.rows.map((line) => line.map((c) => c?.ch ?? ' ').join('')).join('\n'); }

  clone() {
    const copy = new Screen(this.columns);
    copy.rows = this.rows.map((line) => line.map((c) => (c ? { ...c } : null)));
    copy.fullRows = this.fullRows;
    return copy;
  }

  /** Drop blank rows at the bottom. */
  trimmed() {
    const copy = this.clone();
    while (copy.rows.length > 0 && copy.rows.at(-1).every((c) => c === null || c.ch === ' ')) copy.rows.pop();
    return copy;
  }
}

// ── Drawing a screen as SVG ──────────────────────────────────────────────────

const CELL_W = 9;
const CELL_H = 20;
const FONT_SIZE = 15;
const PAD = 22;
const BAR_TOP = 3; // block elements fill this vertical band of the cell, so rows of bars don't merge
const SPARK = '▁▂▃▄▅▆▇█';
const MONO = "'JetBrains Mono','Fira Code','SF Mono','Cascadia Code',Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace";
const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rgb = (color) => `rgb(${(color ?? DEFAULT_FG).join(',')})`;
const isEmoji = (ch) => { const cp = ch.codePointAt(0); return cp >= 0x1f000 || cp === 0x2615 || cp === 0x26a1; };

/** SVG for one cell that is drawn as a shape (box borders, bars) instead of a glyph. */
function shape(cell, x, y, full = false) {
  const { ch } = cell;
  const color = rgb(cell.fg);
  const opacity = cell.dim ? 0.6 : 1;
  const midX = x + CELL_W / 2;
  const midY = y + CELL_H / 2;
  const r = 5;
  const stroke = `fill="none" stroke="${color}" stroke-width="1.3" opacity="${opacity}"`;
  const inset = full ? 0 : BAR_TOP; // the big logo uses full-height blocks so its letters stay solid
  const band = CELL_H - inset * 2;

  if (ch === '─') return `<line x1="${x}" y1="${midY}" x2="${x + CELL_W}" y2="${midY}" ${stroke}/>`;
  if (ch === '│') return `<line x1="${midX}" y1="${y}" x2="${midX}" y2="${y + CELL_H}" ${stroke}/>`;
  if (ch === '╭') return `<path d="M${midX} ${y + CELL_H} V${midY + r} Q${midX} ${midY} ${midX + r} ${midY} H${x + CELL_W}" ${stroke}/>`;
  if (ch === '╮') return `<path d="M${x} ${midY} H${midX - r} Q${midX} ${midY} ${midX} ${midY + r} V${y + CELL_H}" ${stroke}/>`;
  if (ch === '╰') return `<path d="M${midX} ${y} V${midY - r} Q${midX} ${midY} ${midX + r} ${midY} H${x + CELL_W}" ${stroke}/>`;
  if (ch === '╯') return `<path d="M${x} ${midY} H${midX - r} Q${midX} ${midY} ${midX} ${midY - r} V${y}" ${stroke}/>`;
  if (ch === '█') return `<rect x="${x}" y="${y + inset}" width="${CELL_W}" height="${band}" fill="${color}" opacity="${opacity}"/>`;
  if (ch === '░') return `<rect x="${x}" y="${y + inset}" width="${CELL_W}" height="${band}" fill="${color}" opacity="0.22"/>`;
  const level = SPARK.indexOf(ch);
  if (level >= 0) {
    const height = (band * (level + 1)) / 8;
    return `<rect x="${x}" y="${y + inset + band - height}" width="${CELL_W}" height="${height}" fill="${color}" opacity="${opacity}"/>`;
  }
  return null;
}

function toSvg(screen, { title = 'pocketpulse' } = {}) {
  const trimmed = screen.trimmed();
  const width = PAD * 2 + trimmed.columns * CELL_W;
  const top = 38 + PAD / 2;
  const height = top + trimmed.rows.length * CELL_H + PAD;
  const parts = [];

  trimmed.rows.forEach((line, row) => {
    const y = top + row * CELL_H;
    let run = null;
    const flush = () => {
      if (!run) return;
      const weight = run.bold ? ' font-weight="700"' : '';
      parts.push(`<text x="${run.xs.map((n) => n.toFixed(1)).join(' ')}" y="${y + 15}" fill="${rgb(run.fg)}" opacity="${run.dim ? 0.6 : 1}"${weight} xml:space="preserve">${escapeXml(run.text)}</text>`);
      run = null;
    };
    line.forEach((cell, col) => {
      if (!cell || cell.continuation || cell.ch === ' ') return flush();
      const x = PAD + col * CELL_W;
      const drawn = shape(cell, x, y, trimmed.fullRows?.has(row));
      if (drawn) { flush(); parts.push(drawn); return undefined; }
      if (isEmoji(cell.ch)) {
        flush();
        parts.push(`<text x="${x + 1}" y="${y + 15}" font-size="14" font-family="'Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji',sans-serif">${escapeXml(cell.ch)}</text>`);
        return undefined;
      }
      const same = run && run.fg === cell.fg && run.bold === cell.bold && run.dim === cell.dim && run.next === col;
      if (!same) { flush(); run = { fg: cell.fg, bold: cell.bold, dim: cell.dim, xs: [], text: '', next: col }; }
      run.xs.push(x); // one x per character: glyphs sit on the grid whatever font is used
      run.text += cell.ch;
      run.next = col + 1;
      return undefined;
    });
    flush();
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${MONO}" font-size="${FONT_SIZE}">
<title>${escapeXml(title)}</title>
<rect width="${width}" height="${height}" rx="12" fill="#12161c" stroke="#2b323c"/>
<path d="M0 12a12 12 0 0 1 12-12h${width - 24}a12 12 0 0 1 12 12v26H0z" fill="#1a1f27"/>
<circle cx="22" cy="19" r="6" fill="#ff5f56"/><circle cx="42" cy="19" r="6" fill="#ffbd2e"/><circle cx="62" cy="19" r="6" fill="#27c93f"/>
<text x="${width / 2}" y="24" text-anchor="middle" fill="#8b95a5" font-size="13" font-family="-apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif">${escapeXml(title)}</text>
${parts.join('\n')}
</svg>
`;
}

// ── Running the real program against the emulator ────────────────────────────

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function until(screen, text) {
  for (let i = 0; i < 300; i += 1) {
    if (screen.text().includes(text)) { await sleep(60); return; }
    await sleep(10);
  }
  throw new Error(`timed out waiting for "${text}"\n${screen.text()}`);
}

/** A context like the one index.js builds, but writing into `screen`. */
function session(app, theme, { interactive = false, rows } = {}) {
  const screen = new Screen(COLUMNS);
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (flag) => { input.isRaw = flag; return input; };
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = COLUMNS;
  output.on('data', (chunk) => screen.write(chunk.toString()));
  let prompts;
  const ctx = {
    theme,
    version: '0.1.0',
    columns: COLUMNS,
    rows,
    interactive,
    clear: () => screen.write('\x1b[2J\x1b[H'),
    write: (line = '') => screen.write(`${line}\n`),
    error: (line = '') => screen.write(`${line}\n`),
    getApp: async () => app,
    getPrompts: () => { prompts ??= createPrompts({ input, output, theme }); return prompts; },
  };
  const shellLine = (command) => screen.write(`${theme.muted('$')} ${theme.bold(command)}\n`);
  return { screen, ctx, input, shellLine };
}

const SCENES = {
  async hero(app, theme) {
    const { screen, ctx, shellLine } = session(app, theme);
    shellLine('pocketpulse');
    ctx.write(renderBanner(theme, { columns: COLUMNS }));
    screen.fullRows = new Set([1, 2, 3, 4, 5]); // the five rows of logo art
    ctx.write('');
    ctx.write(renderDashboard(theme, app.analytics.dashboard(), { columns: COLUMNS, maxRows: 25 }));
    return screen;
  },

  async add(app, theme) {
    const { screen, ctx, input, shellLine } = session(app, theme, { interactive: true });
    shellLine('pocketpulse add bought a notebook for 65');
    const finished = runAdd(['bought', 'a', 'notebook', 'for', '65'], ctx);
    await until(screen, 'Save this expense?');
    input.write('s\r');
    await finished;
    return screen;
  },

  async menu(app, theme) {
    const { screen, ctx, input, shellLine } = session(app, theme, { interactive: true, rows: 36 });
    const home = runHome(ctx);
    await until(screen, 'Esc cancel');
    for (let i = 0; i < 3; i += 1) { input.write('\u001b[B'); await sleep(40); } // arrow down to "Weekly analytics"
    await sleep(80);
    const picture = screen.clone();
    input.write('\u0003'); // Ctrl+C ends the menu
    await home;
    void shellLine;
    return picture;
  },

  async week(app, theme) {
    const { screen, ctx, shellLine } = session(app, theme);
    shellLine('pocketpulse week');
    await runCli(['week'], ctx);
    return screen;
  },

  async month(app, theme) {
    const { screen, ctx, shellLine } = session(app, theme);
    shellLine('pocketpulse month');
    await runCli(['month'], ctx);
    return screen;
  },

  async themes(app, theme) {
    const { screen, ctx, shellLine } = session(app, theme);
    shellLine('pocketpulse themes');
    await runCli(['themes'], ctx);
    return screen;
  },
};

fs.mkdirSync(OUT, { recursive: true });
const theme = createTheme({ env: {}, colorLevel: 3, unicode: true, themeName: THEME });
for (const [name, scene] of Object.entries(SCENES)) {
  const app = await sampleApp();
  const screen = await scene(app, theme);
  const svg = toSvg(screen, { title: name === 'add' ? 'pocketpulse add' : 'pocketpulse' });
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
  console.log(`${name}.svg  ${screen.trimmed().rows.length} rows`);
  app.close();
}
