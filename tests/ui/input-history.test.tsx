/**
 * The prompt's `↑` recall.
 *
 * The bug this pins: history used to be `useState` inside MainScreen, and
 * TuiApp renders dialogs and other screens *instead of* the active screen (so
 * their `useInput` handlers stop competing for keystrokes). That unmounts
 * MainScreen — so every `/list`, `/yaml`, `/doctor`, `/settings` or `/history`
 * silently wiped the history, and the prompt came back remembering only what
 * had been typed since. Recall has to outlive the screen that offers it.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { render } from 'ink';
import React from 'react';
import { PassThrough } from 'node:stream';
import { MainScreen } from '@appclaw/cli/tui/screens/MainScreen';
import {
  appendHistory,
  historyLines,
  recordLine,
  resetHistory,
} from '@appclaw/cli/tui/input-history';
import { tuiStore } from '@appclaw/cli/tui/store';
import type { TuiActions } from '@appclaw/cli/tui/commands';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const settle = () => new Promise((r) => setTimeout(r, 40));
const UP = String.fromCharCode(27) + '[A';
const DOWN = String.fromCharCode(27) + '[B';
const actions = new Proxy({}, { get: () => async () => {} }) as TuiActions;

function mount(columns = 160, rows = 45) {
  const frames: string[] = [];
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  (stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    frames.push(s);
    return true;
  };
  Object.defineProperty(stdout, 'columns', { value: columns });
  Object.defineProperty(stdout, 'rows', { value: rows });
  Object.assign(stdout, { isTTY: true });
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => {}, unref: () => {} });
  const instance = render(React.createElement(MainScreen, { actions }), {
    stdout,
    stdin,
    debug: true,
    patchConsole: false,
  });
  return {
    instance,
    write: (s: string) => (stdin as unknown as PassThrough).write(s),
    prompt: () => {
      const f = (frames[frames.length - 1] ?? '').replace(ANSI, '');
      return f.split('\n').find((l) => l.includes('❯')) ?? '';
    },
  };
}

async function submit(h: ReturnType<typeof mount>, lines: string[]): Promise<void> {
  for (const l of lines) {
    h.write(l);
    await settle();
    h.write('\r');
    await settle();
  }
}

beforeEach(() => {
  resetHistory();
  tuiStore.reset();
  tuiStore.goTo('main');
  tuiStore.setPlatform('android');
});

describe('appendHistory', () => {
  test('collapses consecutive duplicates the way a shell does', () => {
    let h: string[] = [];
    for (const l of ['tap login', 'tap login', 'tap next']) h = appendHistory(h, l);
    expect(h).toEqual(['tap login', 'tap next']);
  });

  test('keeps a repeat that is not consecutive', () => {
    // The screenshot that surfaced the bug ended "open youtube ... open youtube".
    let h: string[] = [];
    for (const l of ['open youtube', 'tap search', 'open youtube']) h = appendHistory(h, l);
    expect(h).toHaveLength(3);
  });

  test('ignores blank lines', () => {
    expect(appendHistory(['a'], '   ')).toEqual(['a']);
  });
});

describe('recall', () => {
  test('walks back through every submitted line, not just the last', async () => {
    const lines = ['open youtube', 'tap search', 'type foo', 'close youtube', 'open maps'];
    const h = mount();
    await settle();
    await submit(h, lines);
    const seen: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      h.write(UP);
      await settle();
      seen.push(h.prompt());
    }
    h.instance.unmount();
    for (const [i, line] of [...lines].reverse().entries()) {
      expect(seen[i]).toContain(line);
    }
  });

  test('survives the screen being unmounted and remounted', async () => {
    // What `/list` and friends actually do: TuiApp swaps the screen out, so the
    // component that owned the history is destroyed and rebuilt.
    const first = mount();
    await settle();
    await submit(first, ['open youtube', 'tap search']);
    first.instance.unmount();

    const second = mount();
    await settle();
    second.write(UP);
    await settle();
    const recalled = second.prompt();
    second.instance.unmount();
    expect(recalled).toContain('tap search');
  });

  test('down returns to the draft that was being typed', async () => {
    const h = mount();
    await settle();
    await submit(h, ['open youtube']);
    h.write('half typed');
    await settle();
    h.write(UP);
    await settle();
    expect(h.prompt()).toContain('open youtube');
    h.write(DOWN);
    await settle();
    const back = h.prompt();
    h.instance.unmount();
    expect(back).toContain('half typed');
  });
});

describe('recordLine', () => {
  test('is what the prompt reads back', () => {
    recordLine('tap login');
    recordLine('tap next');
    expect([...historyLines()]).toEqual(['tap login', 'tap next']);
  });
});
