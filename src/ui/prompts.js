// Terminal prompts, in two modes chosen automatically.
//
// Real terminal: each question opens a short-lived readline session, and menus
// take over the keyboard for arrow keys.
// Piped input: one readline stays open and queues incoming lines, since readline
// would otherwise drop lines that arrive before they're asked for.
//
// Every question returns null when input ends or the user presses Ctrl+C/Esc;
// callers treat that as "cancel".

import readline from 'node:readline';
import { stringWidth } from './text.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

export function createPrompts({ input = process.stdin, output = process.stdout, theme }) {
  const tty = Boolean(input.isTTY && output.isTTY);
  const marker = theme.primary(theme.symbols.arrow);

  // Reading one line

  // Piped mode: a single readline plus a queue of lines nobody has asked for yet.
  let pipedReader;
  const queue = [];
  const waiting = [];
  let closed = false;
  if (!tty) {
    pipedReader = readline.createInterface({ input, output, terminal: false });
    pipedReader.on('line', (line) => {
      const resolve = waiting.shift();
      if (resolve) resolve(line);
      else queue.push(line);
    });
    pipedReader.on('close', () => {
      closed = true;
      for (const resolve of waiting.splice(0)) resolve(null); // unblock anyone still waiting
    });
  }

  const readLinePiped = (promptText) => new Promise((resolve) => {
    if (queue.length > 0) return resolve(queue.shift());
    if (closed) return resolve(null);
    pipedReader.setPrompt(promptText);
    pipedReader.prompt();
    waiting.push(resolve);
    return undefined;
  });

  // Terminal mode: a fresh readline per question, closed straight afterwards
  // so a menu can use the keyboard next without the two fighting over it.
  const readLineTerminal = (promptText) => new Promise((resolve) => {
    const reader = readline.createInterface({ input, output, terminal: true });
    let answered = false;
    reader.on('line', (line) => {
      answered = true;
      reader.close();
      resolve(line);
    });
    reader.on('close', () => { if (!answered) resolve(null); }); // Ctrl+D
    reader.on('SIGINT', () => reader.close()); // Ctrl+C = cancel
    reader.setPrompt(promptText);
    reader.prompt();
  });

  const readLine = tty ? readLineTerminal : readLinePiped;

  // Menus

  /** One row of a menu. Items may carry a `note` (muted hint) and a `shortcut` key. */
  function menuRow(item, index, selected, numbered) {
    const pointer = selected ? theme.primary(theme.symbols.arrow) : ' ';
    const number = numbered ? `${theme.muted(String(index + 1))}  ` : '';
    const label = selected ? theme.bold(item.label) : item.label;
    const note = item.note ? `  ${theme.muted(item.note)}` : '';
    const shortcut = item.shortcut ? `  ${theme.muted(`[${item.shortcut}]`)}` : '';
    return `${pointer} ${number}${label}${note}${shortcut}`;
  }

  /** Arrow-key menu (real terminals only). Resolves with the chosen item or null. */
  function arrowMenu(label, items, defaultIndex) {
    return new Promise((resolve) => {
      readline.emitKeypressEvents(input);
      const wasRaw = input.isRaw === true;
      input.setRawMode?.(true); // raw mode: we receive each key press, not whole lines
      input.resume();
      output.write(HIDE_CURSOR);
      const restoreCursor = () => output.write(SHOW_CURSOR); // even if the program dies mid-menu
      process.on('exit', restoreCursor);

      const numbered = items.length <= 9; // number keys only make sense for short lists
      const hint = `  ${theme.unicode ? '↑/↓' : 'up/down'} move ${theme.symbols.dot} Enter choose ${theme.symbols.dot} Esc cancel`;
      const height = items.length + 2; // question + items + hint
      let index = Math.min(Math.max(defaultIndex, 0), items.length - 1);
      let drawn = false;

      const draw = () => {
        if (drawn) output.write(`\x1b[${height}A`); // jump back up to the top of the menu
        drawn = true;
        const lines = [`${marker} ${theme.bold(label)}`, ...items.map((item, i) => menuRow(item, i, i === index, numbered)), theme.muted(hint)];
        for (const line of lines) output.write(`\x1b[2K\r${line}\n`); // clear the row, then rewrite it
      };

      const finish = (chosen) => {
        input.removeListener('keypress', onKey);
        process.removeListener('exit', restoreCursor);
        input.setRawMode?.(wasRaw);
        input.pause();
        output.write(`\x1b[${height}A\x1b[J${SHOW_CURSOR}`); // erase the menu
        if (chosen) output.write(`${marker} ${label} ${theme.bold(chosen.label)}\n`); // leave a one-line record
        resolve(chosen);
      };

      function onKey(text, key = {}) {
        if (key.ctrl && key.name === 'c') return finish(null);
        switch (key.name) {
          case 'escape': return finish(null);
          case 'return': case 'enter': return finish(items[index]);
          case 'up': index = (index - 1 + items.length) % items.length; return draw();
          case 'down': index = (index + 1) % items.length; return draw();
          case 'home': index = 0; return draw();
          case 'end': index = items.length - 1; return draw();
          default: break;
        }
        if (numbered && /^[1-9]$/.test(text) && Number(text) <= items.length) return finish(items[Number(text) - 1]);
        const byShortcut = text && items.find((item) => item.shortcut && item.shortcut === text.toLowerCase());
        if (byShortcut) return finish(byShortcut);
        return undefined;
      }

      input.on('keypress', onKey);
      draw();
    });
  }

  /** Numbered list for piped input: the person types a number. */
  async function numberedMenu(label, items, defaultIndex) {
    output.write(`${theme.bold(label)}\n`);
    items.forEach((item, index) => {
      const current = index === defaultIndex ? theme.muted('  (current)') : '';
      output.write(`  ${theme.primary(String(index + 1).padStart(2))}  ${item.label}${current}\n`);
    });
    const hint = defaultIndex === undefined ? `(1-${items.length})` : `(1-${items.length}, Enter = ${defaultIndex + 1})`;
    for (;;) {
      const answer = await readLine(`${marker} Number ${theme.muted(hint)} `);
      if (answer === null) return null;
      if (answer.trim() === '' && defaultIndex !== undefined) return items[defaultIndex];
      const picked = items[Number.parseInt(answer, 10) - 1];
      if (picked && /^\s*\d+\s*$/.test(answer)) return picked;
      output.write(`${theme.warn(theme.symbols.warn)} Type a number from 1 to ${items.length}.\n`);
    }
  }

  return {
    /** Ask for text. Enter alone gives `defaultValue`. */
    async text(label, { defaultValue } = {}) {
      const hint = defaultValue ? theme.muted(` (${defaultValue})`) : '';
      const answer = await readLine(`${marker} ${label}${hint} `);
      if (answer === null) return null;
      const trimmed = answer.trim();
      return trimmed === '' && defaultValue !== undefined ? defaultValue : trimmed;
    },

    /**
     * Pick one action by typing its shortcut letter (or the whole word).
     * options: [{ key: 'save', label: 'Save', shortcut: 's' }, ...]. The
     * shortcut defaults to the label's first letter. Enter picks `defaultKey`.
     * Returns the chosen key, or null.
     */
    async choice(label, options, defaultKey) {
      const shortcutOf = (option) => (option.shortcut ?? option.label[0]).toLowerCase();
      const shown = options
        .map((option) => `${theme.bold(theme.primary(`[${shortcutOf(option)}]`))} ${option.label}`)
        .join(' ');
      const defaultLabel = options.find((o) => o.key === defaultKey)?.label;
      const hint = theme.muted(`(Enter = ${defaultLabel})`);
      // One line if it fits the window with room to type; otherwise the options go on their own line.
      const oneLine = `${marker} ${label} ${shown} ${hint} `;
      const stacked = stringWidth(oneLine) + 2 > (output.columns || 80);
      if (stacked) output.write(`${marker} ${label}\n`);
      const promptText = stacked ? `  ${shown} ${hint} ` : oneLine;
      for (;;) {
        const answer = await readLine(promptText);
        if (answer === null) return null;
        const typed = answer.trim().toLowerCase();
        if (typed === '') return defaultKey;
        // The shortcut we SHOW, the whole word, or the key all work.
        const match = options.find((o) => typed === shortcutOf(o) || typed === o.label.toLowerCase() || typed === o.key);
        if (match) return match.key;
        output.write(`${theme.warn(theme.symbols.warn)} Please type one of the letters shown.\n`);
      }
    },

    /**
     * Pick one item from a list. In a real terminal: ↑/↓ and Enter (number
     * keys and `item.shortcut` letters jump straight to an item). With piped
     * input: type a number. `defaultIndex` (0-based) is the starting choice.
     * Returns the chosen item, or null if cancelled.
     */
    select(label, items, { defaultIndex } = {}) {
      return tty ? arrowMenu(label, items, defaultIndex ?? 0) : numberedMenu(label, items, defaultIndex);
    },

    close() {
      pipedReader?.close();
      if (tty) input.pause(); // release the keyboard so Node can exit
    },
  };
}
