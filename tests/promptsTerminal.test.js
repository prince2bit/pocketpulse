import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createPrompts } from '../src/ui/prompts.js';
import { createTheme } from '../src/ui/theme.js';

// A pretend real terminal: we "type" by writing to `input`, and read what was drawn from `output`.
function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const rawCalls = [];
  input.setRawMode = (flag) => { rawCalls.push(flag); input.isRaw = flag; return input; };
  const output = new PassThrough();
  output.isTTY = true;
  let drawn = '';
  output.on('data', (chunk) => { drawn += chunk; });
  const prompts = createPrompts({ input, output, theme: createTheme({ env: {}, colorLevel: 0, unicode: true }) });
  return { input, prompts, rawCalls, drawn: () => drawn, type: (...keys) => keys.forEach((key) => input.write(key)) };
}
const KEY = { up: '\u001b[A', down: '\u001b[B', home: '\u001b[H', end: '\u001b[F', enter: '\r', ctrlC: '\u0003', escape: '\u001b' };
const items = [{ label: 'One', shortcut: 'o' }, { label: 'Two', shortcut: 't' }, { label: 'Three', shortcut: 'h' }];
const choose = async (t, keys, list = items, options) => {
  const pending = t.prompts.select('Pick', list, options);
  t.type(...keys);
  return pending;
};

describe('arrow-key menu', () => {
  it('picks the first item on Enter', async () => {
    assert.equal((await choose(terminal(), [KEY.enter])).label, 'One');
  });
  it('moves down and up with the arrow keys', async () => {
    assert.equal((await choose(terminal(), [KEY.down, KEY.enter])).label, 'Two');
    assert.equal((await choose(terminal(), [KEY.down, KEY.down, KEY.up, KEY.enter])).label, 'Two');
  });
  it('wraps around at both ends', async () => {
    assert.equal((await choose(terminal(), [KEY.up, KEY.enter])).label, 'Three'); // up from the first
    assert.equal((await choose(terminal(), [KEY.down, KEY.down, KEY.down, KEY.enter])).label, 'One'); // down from the last
  });
  it('supports Home and End', async () => {
    assert.equal((await choose(terminal(), [KEY.end, KEY.enter])).label, 'Three');
    assert.equal((await choose(terminal(), [KEY.end, KEY.home, KEY.enter])).label, 'One');
  });
  it('starts on the default item', async () => {
    assert.equal((await choose(terminal(), [KEY.enter], items, { defaultIndex: 2 })).label, 'Three');
    assert.equal((await choose(terminal(), [KEY.down, KEY.enter], items, { defaultIndex: 0 })).label, 'Two');
  });
  it('ignores an out-of-range default instead of breaking', async () => {
    assert.equal((await choose(terminal(), [KEY.enter], items, { defaultIndex: 99 })).label, 'Three');
  });
  it('jumps straight to an item with its number key (short lists)', async () => {
    assert.equal((await choose(terminal(), ['3'])).label, 'Three');
    assert.equal((await choose(terminal(), ['2'])).label, 'Two');
  });
  it('ignores number keys that are out of range, and keeps waiting', async () => {
    assert.equal((await choose(terminal(), ['9', '0', KEY.enter])).label, 'One');
  });
  it('does NOT use number keys for long lists (they would be ambiguous), but arrows still work', async () => {
    const long = Array.from({ length: 11 }, (_, i) => ({ label: `Item ${i + 1}` }));
    assert.equal((await choose(terminal(), ['5', KEY.down, KEY.enter], long)).label, 'Item 2');
  });
  it('jumps to an item with its shortcut letter, in any capitals', async () => {
    assert.equal((await choose(terminal(), ['t'])).label, 'Two');
    assert.equal((await choose(terminal(), ['H'])).label, 'Three');
  });
  it('returns null on Escape', async () => {
    assert.equal(await choose(terminal(), [KEY.escape]), null);
  });
  it('returns null on Ctrl+C', async () => {
    assert.equal(await choose(terminal(), [KEY.ctrlC]), null);
  });
  it('ignores unknown keys', async () => {
    assert.equal((await choose(terminal(), ['z', '?', KEY.enter])).label, 'One');
  });
});

describe('arrow-key menu: drawing and cleaning up', () => {
  it('draws the question, every item, the selection pointer, and a hint', async () => {
    const t = terminal();
    await choose(t, [KEY.down, KEY.enter]);
    const drawn = t.drawn();
    for (const text of ['Pick', 'One', 'Two', 'Three', 'Enter choose', 'Esc cancel', '[o]', '[t]']) assert.ok(drawn.includes(text), `missing ${text}`);
    assert.match(drawn, /› 2\s+Two/, 'the pointer should be on the highlighted row (after one Down)');
    assert.match(drawn, /› 1\s+One/, 'and it starts on the first row');
  });
  it('numbers short lists', async () => {
    const t = terminal();
    await choose(t, [KEY.enter]);
    assert.match(t.drawn(), /1\s+One/);
  });
  it('redraws in place using cursor movement, rather than scrolling', async () => {
    const t = terminal();
    await choose(t, [KEY.down, KEY.enter]);
    assert.ok(t.drawn().includes('\u001b[5A'), 'should move up by the menu height (3 items + question + hint)');
  });
  it('hides the cursor while the menu is open and always shows it again', async () => {
    const t = terminal();
    await choose(t, [KEY.escape]);
    const drawn = t.drawn();
    assert.ok(drawn.indexOf('\u001b[?25l') !== -1, 'cursor hidden');
    assert.ok(drawn.lastIndexOf('\u001b[?25h') > drawn.indexOf('\u001b[?25l'), 'cursor shown again afterwards');
  });
  it('leaves a one-line record of the choice, and none when cancelled', async () => {
    const chosen = terminal();
    await choose(chosen, [KEY.down, KEY.enter]);
    assert.ok(chosen.drawn().includes('Pick Two'));
    const cancelled = terminal();
    await choose(cancelled, [KEY.escape]);
    assert.ok(!cancelled.drawn().includes('Pick One'));
  });
  it('takes the keyboard into raw mode, and gives it back', async () => {
    const t = terminal();
    await choose(t, [KEY.enter]);
    assert.deepEqual(t.rawCalls, [true, false]);
  });
  it('pauses the input afterwards so the program can exit', async () => {
    const t = terminal();
    await choose(t, [KEY.enter]);
    assert.equal(t.input.isPaused(), true);
  });
  it('can run several menus one after another', async () => {
    const t = terminal();
    assert.equal((await choose(t, [KEY.down, KEY.enter])).label, 'Two');
    assert.equal((await choose(t, [KEY.up, KEY.enter])).label, 'Three');
    assert.equal((await choose(t, [KEY.enter])).label, 'One');
  });
});

describe('questions in a real terminal (one short readline per question)', () => {
  it('asks for text after a menu without the two fighting over the keyboard', async () => {
    const t = terminal();
    assert.equal((await choose(t, [KEY.down, KEY.enter])).label, 'Two');
    const answer = t.prompts.text('Name?');
    t.type('Sam\r');
    assert.equal(await answer, 'Sam');
  });
  it('uses the default when Enter is pressed alone', async () => {
    const t = terminal();
    const answer = t.prompts.text('Amount?', { defaultValue: '20.00' });
    t.type('\r');
    assert.equal(await answer, '20.00');
  });
  it('returns null on Ctrl+C', async () => {
    const t = terminal();
    const answer = t.prompts.text('Name?');
    t.type(KEY.ctrlC);
    assert.equal(await answer, null);
  });
  it('handles a choice question, then a menu, then another question', async () => {
    const t = terminal();
    const first = t.prompts.choice('Save?', [{ key: 'save', label: 'Save' }, { key: 'edit', label: 'Edit' }], 'save');
    t.type('e\r');
    assert.equal(await first, 'edit');
    assert.equal((await choose(t, ['2'])).label, 'Two');
    const last = t.prompts.text('Done?');
    t.type('yes\r');
    assert.equal(await last, 'yes');
  });
  it('close() releases the keyboard', async () => {
    const t = terminal();
    t.prompts.close();
    assert.equal(t.input.isPaused(), true);
  });
});
