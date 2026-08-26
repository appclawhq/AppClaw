/**
 * The whole-frame layout test.
 *
 * Ink does not clip a frame taller than the terminal — it overlaps rows, so one
 * unbudgeted row shows up as two commands printed on one line, box borders
 * colliding, and the first line of a box silently vanishing. Component-level
 * tests could not catch that: every piece was individually correct and the
 * chrome constant was wrong. This renders the real screen at real sizes and
 * asserts the frame closes properly.
 */
import { describe, expect, test } from 'vitest';
import { render } from 'ink';
import React from 'react';
import { PassThrough } from 'node:stream';
import { MainScreen } from '@appclaw/cli/tui/screens/MainScreen';
import { tuiStore } from '@appclaw/cli/tui/store';
import type { TuiActions } from '@appclaw/cli/tui/commands';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const actions = new Proxy({}, { get: () => async () => {} }) as TuiActions;

async function frameAt(columns: number, rows: number): Promise<string[]> {
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

  tuiStore.reset();
  tuiStore.goTo('main');
  // debug: true is load-bearing, not a leftover. Ink's onRender consults
  // `is-in-ci` and, when set, buffers the frame instead of writing it — so on
  // GitHub Actions nothing reaches `stdout` until unmount and every assertion
  // below sees an empty frame. The debug branch is checked first and writes on
  // every render, which is also how ink-testing-library stays CI-safe.
  const instance = render(<MainScreen actions={actions} />, {
    stdout,
    stdin,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await new Promise((r) => setTimeout(r, 40));
  const painted = frames.filter((f) => f.includes('╭'));
  instance.unmount();
  return (painted[0] ?? '').replace(ANSI, '').replace(/\n$/, '').split('\n');
}

describe('MainScreen frame', () => {
  for (const [cols, rows] of [
    [200, 46],
    [120, 40],
    [100, 30],
  ] as const) {
    test(`${cols}x${rows}: fills the terminal without overlapping`, async () => {
      const frame = await frameAt(cols, rows);
      expect(frame.length).toBeLessThanOrEqual(rows);

      // Both titles survive: an over-tall frame overwrites the first line of
      // whichever boxes overflow, and these are the two that showed it.
      expect(frame.some((l) => l.includes('AppClaw'))).toBe(true);
      expect(frame.some((l) => l.includes('Command palette'))).toBe(true);

      // The first command keeps its own row rather than merging with the next.
      const goal = frame.find((l) => l.includes('/goal'));
      expect(goal).toBeDefined();
      expect(goal).not.toContain('/list');

      // The outer frame's bottom border is alone on its row — when the frame
      // overflowed it shared one with the input box's border ("╰─╰───").
      const closing = frame.filter((l) => l.trimStart().startsWith('╰'));
      expect(closing.every((l) => !l.replace(/[╰─╯\s]/g, ''))).toBe(true);
    });
  }
});
