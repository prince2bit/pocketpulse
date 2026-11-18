import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createPrompts } from '../src/ui/prompts.js';
import { createTheme, stripAnsi } from '../src/ui/theme.js';

// Real prompts reading from a pretend keyboard (a stream we type into ourselves).
function setup(lines = [], { end = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompts = createPrompts({ input, output, theme: createTheme({ env: {}, colorLevel: 0, unicode: true }) });
  for (const line of lines) input.write(`${line}\n`);
  if (end) input.end();
  return { prompts, input, output };
}

describe('prompts.text', () => {
  it('returns what was typed, trimmed', async () => {
    const { prompts } = setup(['  protein bar  ']);
    assert.equal(await prompts.text('What?'), 'protein bar');
    prompts.close();
  });
  it('answers several questions from input that arrived all at once (nothing gets dropped)', async () => {
    const { prompts } = setup(['one', 'two', 'three']);
    assert.equal(await prompts.text('1?'), 'one');
    assert.equal(await prompts.text('2?'), 'two');
    assert.equal(await prompts.text('3?'), 'three');
    prompts.close();
  });
  it('uses the default when Enter is pressed alone', async () => {
    const { prompts } = setup(['']);
    assert.equal(await prompts.text('Amount?', { defaultValue: '20.00' }), '20.00');
    prompts.close();
  });
  it('returns null when the input ends (Ctrl+D) or the person quits', async () => {
    const { prompts } = setup([], { end: true });
    assert.equal(await prompts.text('What?'), null);
    prompts.close();
  });
  it('still hands out lines that arrived before the input ended, then null', async () => {
    const { prompts } = setup(['only one'], { end: true });
    assert.equal(await prompts.text('1?'), 'only one');
    assert.equal(await prompts.text('2?'), null);
    prompts.close();
  });
});

describe('prompts.choice', () => {
  const options = [{ key: 'save', label: 'Save' }, { key: 'edit', label: 'Edit' }, { key: 'cancel', label: 'Cancel' }];
  it('accepts the letter shown, the whole word, any capitalisation', async () => {
    const { prompts } = setup(['e', 'CANCEL', 's']);
    assert.equal(await prompts.choice('Ok?', options, 'save'), 'edit');
    assert.equal(await prompts.choice('Ok?', options, 'save'), 'cancel');
    assert.equal(await prompts.choice('Ok?', options, 'save'), 'save');
    prompts.close();
  });
  it('picks the default on Enter', async () => {
    const { prompts } = setup(['']);
    assert.equal(await prompts.choice('Ok?', options, 'cancel'), 'cancel');
    prompts.close();
  });
  it('asks again after an unrecognised answer', async () => {
    const { prompts, output } = setup(['banana', 'e']);
    assert.equal(await prompts.choice('Ok?', options, 'save'), 'edit');
    assert.match(output.read().toString(), /Please type one of the letters/);
    prompts.close();
  });
  it('returns null when input ends', async () => {
    const { prompts } = setup([], { end: true });
    assert.equal(await prompts.choice('Ok?', options, 'save'), null);
    prompts.close();
  });
});

describe('prompts.choice fits the window', () => {
  const confirm = [{ key: 'save', label: 'Save', shortcut: 's' }, { key: 'edit', label: 'Edit', shortcut: 'e' },
    { key: 'category', label: 'Category', shortcut: 'c' }, { key: 'cancel', label: 'Cancel', shortcut: 'x' }];
  const tick = () => new Promise((resolve) => { setImmediate(resolve); });

  // Ask first, THEN type: a line that is already waiting is returned without drawing the prompt.
  const ask = async (columns, label, options, ...answers) => {
    const { prompts, input, output } = setup([]);
    output.columns = columns;
    const pending = prompts.choice(label, options, options[0].key);
    for (const answer of answers) {
      await tick();
      input.write(`${answer}\n`);
    }
    const result = await pending;
    const text = stripAnsi(output.read().toString());
    prompts.close();
    return { result, text };
  };

  it('keeps the add-confirmation prompt on ONE line in an 80-column window', async () => {
    const { result, text } = await ask(80, 'Save this expense?', confirm, '');
    assert.equal(result, 'save');
    const lines = text.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, text);
    assert.ok(lines[0].length < 80, `${lines[0].length} columns: ${lines[0]}`);
  });
  it('puts the options on their own line when the question is too long for the window', async () => {
    const { text } = await ask(80, 'Remember "a rather long protein bar description" as Fitness for next time?', [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }], 'n');
    const lines = text.split('\n').filter(Boolean);
    assert.equal(lines.length, 2, text);
    assert.match(lines[1], /^ {2}\[y\] Yes \[n\] No/);
    for (const line of lines) assert.ok(line.length < 80, line);
  });
  it('stacks sooner in a narrow window, and answers still work', async () => {
    const { result, text } = await ask(50, 'Save this expense?', confirm, 'e');
    assert.equal(result, 'edit');
    assert.equal(text.split('\n').filter(Boolean).length, 2);
  });
  it('does not repeat the question line after an invalid answer', async () => {
    const { result, text } = await ask(50, 'Save this expense?', confirm, 'zzz', 's');
    assert.equal(result, 'save');
    assert.equal(text.match(/Save this expense\?/g).length, 1, text);
    assert.ok(text.includes('Please type one of the letters shown.'));
  });
});

describe('prompts.select', () => {
  const items = [{ label: 'INR', code: 'INR' }, { label: 'USD', code: 'USD' }, { label: 'EUR', code: 'EUR' }];
  it('returns the item for the number typed', async () => {
    const { prompts } = setup(['2']);
    assert.equal((await prompts.select('Pick', items)).code, 'USD');
    prompts.close();
  });
  it('rejects out-of-range numbers and non-numbers, then accepts a good one', async () => {
    const { prompts } = setup(['0', '4', 'two', '2x', '3']);
    assert.equal((await prompts.select('Pick', items)).code, 'EUR');
    prompts.close();
  });
  it('returns null when input ends', async () => {
    const { prompts } = setup([], { end: true });
    assert.equal(await prompts.select('Pick', items), null);
    prompts.close();
  });
});
