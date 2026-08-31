/**
 * The goal prompt's text input.
 *
 * It replaced `ink-text-input` for one reason, which the first test pins: that
 * component inserts any ctrl chord it does not recognise as a plain letter, so
 * ^p typed "p" into the goal and no screen holding a focused prompt could own a
 * keyboard shortcut. Everything else here is the behaviour that had to survive
 * the swap — typing, the cursor, backspace, submit, and keeping its hands off
 * the keys the screen uses for history, completion and scrolling.
 */
import { describe, expect, test } from 'vitest';
import { render } from 'ink-testing-library';
import React, { useState } from 'react';
import { PromptInput } from '@appclaw/cli/tui/components/PromptInput';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const settle = () => new Promise((r) => setTimeout(r, 20));

/** Ctrl+letter as the terminal actually sends it. */
const ctrl = (letter: string) => String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);
const BACKSPACE = String.fromCharCode(127);
const LEFT = String.fromCharCode(27) + '[D';

function harness(initial = '', props: Partial<React.ComponentProps<typeof PromptInput>> = {}) {
  const submitted: string[] = [];
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <PromptInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => submitted.push(v)}
        {...props}
      />
    );
  }
  const { stdin, lastFrame } = render(<Host />);
  return {
    submitted,
    value: () => (lastFrame() ?? '').replace(ANSI, ''),
    async press(keys: string) {
      // Settle first: `useInput` subscribes in an effect, so a write that lands
      // in the same tick as the render reaches nobody.
      await settle();
      stdin.write(keys);
      await settle();
    },
  };
}

describe('PromptInput', () => {
  test('a ctrl chord is left for the screen instead of being typed', async () => {
    // The regression this component exists to prevent. ink-text-input turned
    // ^r ^p ^x into "rpx" in the middle of whatever goal was being written.
    const h = harness('open settings');
    await h.press(ctrl('r') + ctrl('p') + ctrl('x'));
    expect(h.value()).toBe('open settings');
  });

  test('ctrl+c is not swallowed either — TuiApp quits on it', async () => {
    const h = harness('x');
    await h.press(ctrl('c'));
    expect(h.value()).toBe('x');
  });

  test('ordinary typing still works', async () => {
    const h = harness();
    await h.press('read the wifi name');
    expect(h.value()).toContain('read the wifi name');
  });

  test('backspace deletes the character before the cursor', async () => {
    const h = harness();
    await h.press('tapp');
    await h.press(BACKSPACE);
    expect(h.value()).toContain('tap');
    expect(h.value()).not.toContain('tapp');
  });

  test('the cursor can be moved and typed into', async () => {
    const h = harness();
    await h.press('ac');
    await h.press(LEFT);
    await h.press('b');
    expect(h.value()).toContain('abc');
  });

  test('enter submits the line', async () => {
    const h = harness();
    await h.press('open settings');
    await h.press('\r');
    expect(h.submitted).toEqual(['open settings']);
  });

  test('the keys the screen owns are not consumed', async () => {
    // ↑↓ recall history, tab completes, page keys scroll the transcript. If the
    // input inserted any of them the screen would never see them.
    const h = harness('goal');
    const UP = String.fromCharCode(27) + '[A';
    const DOWN = String.fromCharCode(27) + '[B';
    const PAGE_UP = String.fromCharCode(27) + '[5~';
    await h.press(UP + DOWN + '\t' + PAGE_UP);
    expect(h.value()).toBe('goal');
  });

  test('a value replaced from outside puts the cursor at the end', async () => {
    // History recall and tab completion rewrite the whole line. Leaving the
    // cursor mid-string meant the next character landed inside the recalled
    // text — an ink-text-input bug this does not inherit.
    function Host() {
      const [value, setValue] = useState('abcdef');
      return (
        <PromptInput
          value={value}
          onChange={setValue}
          onSubmit={() => setValue('/stream')}
          placeholder=""
        />
      );
    }
    const { stdin, lastFrame } = render(<Host />);
    await settle();
    // Walk the cursor back into the middle, then have the host replace the value.
    stdin.write(LEFT + LEFT + LEFT);
    await settle();
    stdin.write('\r');
    await settle();
    stdin.write('!');
    await settle();
    expect((lastFrame() ?? '').replace(ANSI, '')).toContain('/stream!');
  });

  test('an unfocused input consumes nothing at all', async () => {
    const h = harness('goal', { focus: false });
    await h.press('typing');
    expect(h.value()).toBe('goal');
  });

  test('the placeholder shows only while the line is empty', async () => {
    const h = harness('', { placeholder: 'Describe a goal or /command' });
    expect(h.value()).toContain('Describe a goal');
    await h.press('t');
    expect(h.value()).not.toContain('Describe a goal');
  });
});
