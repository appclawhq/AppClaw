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

async function frameAt(
  columns: number,
  rows: number,
  mode: 'record' | 'goal' = 'record',
  type = ''
): Promise<string[]> {
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
  tuiStore.setMode(mode);
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
  if (type) {
    (stdin as unknown as PassThrough).write(type);
    await new Promise((r) => setTimeout(r, 40));
  }
  const painted = frames.filter((f) => f.includes('╭'));
  instance.unmount();
  // The last frame, not the first: a keystroke has to be allowed to change it.
  return (painted[painted.length - 1] ?? '').replace(ANSI, '').replace(/\n$/, '').split('\n');
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

/**
 * Goal mode's prompt has no menu above it.
 *
 * The list is a menu of what you might type next, which is true in record mode
 * — a plain line and a `/command` are the same kind of thing there — and false
 * in goal mode, where a plain line is a goal. Leaving it up cost the transcript
 * half its column to say nothing. These assert both halves: it is gone, and the
 * rows it freed went to the transcript rather than off the bottom of the frame.
 */
describe('MainScreen in goal mode', () => {
  for (const [cols, rows] of [
    [200, 46],
    [120, 40],
    [100, 30],
  ] as const) {
    test(`${cols}x${rows}: no standing command list, and the frame still closes`, async () => {
      const frame = await frameAt(cols, rows, 'goal');
      expect(frame.length).toBeLessThanOrEqual(rows);
      expect(frame.some((l) => l.includes('Command palette'))).toBe(false);
      expect(frame.some((l) => l.includes('/goal'))).toBe(false);
      // The prompt survives — this hides the list, not the way in.
      expect(frame.some((l) => l.includes('Describe a goal'))).toBe(true);

      const closing = frame.filter((l) => l.trimStart().startsWith('╰'));
      expect(closing.every((l) => !l.replace(/[╰─╯\s]/g, ''))).toBe(true);
    });
  }

  test('the freed rows go to the transcript, not off the frame', async () => {
    const record = await frameAt(120, 40, 'record');
    const goal = await frameAt(120, 40, 'goal');
    expect(goal.length).toBe(record.length);
    // The transcript box is the only thing that can have grown.
    const height = (frame: string[]) => {
      const top = frame.findIndex((l) => l.includes('Transcript'));
      // The transcript box's own bottom border — the first one below its title.
      // Not `startsWith`: it sits inside the outer frame, so its row begins
      // with the frame's left border.
      const bottom = frame.findIndex((l, i) => i > top && l.includes('╰'));
      return bottom - top;
    };
    expect(height(goal)).toBeGreaterThan(height(record));
  });

  test('typing / brings the list back, because then it is a filter', async () => {
    const frame = await frameAt(120, 40, 'goal', '/st');
    expect(frame.some((l) => l.includes('Command palette'))).toBe(true);
    expect(frame.some((l) => l.includes('/stream'))).toBe(true);
    // Still fits: the transcript gives the rows back.
    expect(frame.length).toBeLessThanOrEqual(40);
    const closing = frame.filter((l) => l.trimStart().startsWith('╰'));
    expect(closing.every((l) => !l.replace(/[╰─╯\s]/g, ''))).toBe(true);
  });
});
