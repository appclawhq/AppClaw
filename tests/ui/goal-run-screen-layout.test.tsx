/**
 * The goal-run screen's whole-frame layout.
 *
 * Same hazard as MainScreen: Ink does not clip an over-tall frame, it overlaps
 * rows. This screen is more exposed to it than most, because it composes two
 * things that each budget their own height — <RunScreen>, which pins a 4-row
 * footer to the bottom of its pane, and <StreamPanel>, whose picture rows are
 * derived from layout.ts. If either disagrees with the other about the chrome
 * between them, the frame grows and the bottom border walks off the screen.
 *
 * The second assertion is the one that is easy to regress: the run pane and the
 * stream panel must be laid out from the SAME layout.ts numbers MainScreen
 * uses. The frame loop sizes each transmitted image with `streamCells` and has
 * no way to know which screen is mounted, so a run screen that split its
 * columns differently would hand the terminal an image that no longer matches
 * the placeholder grid drawn for it.
 */
import { describe, expect, test } from 'vitest';
import { Box, render } from 'ink';
import React from 'react';
import { PassThrough } from 'node:stream';
import { GoalRunScreen } from '@appclaw/cli/tui/screens/GoalRunScreen';
import { MainScreen } from '@appclaw/cli/tui/screens/MainScreen';
import type { TuiActions } from '@appclaw/cli/tui/commands';
import { tuiStore } from '@appclaw/cli/tui/store';
import { MIN_RUN_ROWS } from '@appclaw/cli/tui/stream/layout';
import { attachRunRenderer } from '@appclaw/cli/ui/ink/InkRenderer';
import * as ui from '@appclaw/core/ui/terminal';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const GOAL = 'open settings and read the wifi name';
const actions = new Proxy({}, { get: () => async () => {} }) as TuiActions;

async function frameAt(
  columns: number,
  rows: number,
  streaming: boolean,
  screen: 'run' | 'main' = 'run',
  awaitingExit: { code: number } | null = null
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
  tuiStore.setMode('goal');
  tuiStore.selectDevice({
    name: 'Pixel_7_API_34',
    udid: 'emulator-5554',
    state: 'device',
    platform: 'android',
  });
  if (streaming) {
    tuiStore.setStream({
      status: 'running',
      backend: 'halfblock',
      resolution: { width: 1080, height: 2400 },
    });
    tuiStore.setStreamFrame(Array.from({ length: rows }, () => '▀'.repeat(30)));
  }
  // Feed the run store the way core does — through the renderer seam — so the
  // pane holds a real plan, a live step and the pinned footer.
  attachRunRenderer({ overallGoal: GOAL, model: 'claude-opus-5', mode: 'dom', showSteps: true });
  tuiStore.setAwaitingExit(awaitingExit);
  tuiStore.goTo('run');

  // Wrapped exactly as TuiApp wraps every screen. The padding is not cosmetic:
  // layout.ts budgets a column for it (APP_PADDING_COLS), so a bare render puts
  // the stream panel one cell left of where the real app draws it.
  const element =
    screen === 'run' ? (
      <Box flexDirection="column" paddingX={1}>
        <GoalRunScreen goal={GOAL} actions={actions} />
      </Box>
    ) : (
      <Box flexDirection="column" paddingX={1}>
        <MainScreen actions={actions} />
      </Box>
    );

  // debug: true is load-bearing — see main-screen-layout.test.tsx. Ink buffers
  // frames instead of writing them when `is-in-ci` is set.
  const instance = render(element, {
    stdout,
    stdin,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  ui.printPlan(
    [{ goal: 'Open the Settings app' }, { goal: 'Read the Wi-Fi network name' }] as never,
    'two steps'
  );
  ui.printGoalStart('Open the Settings app', 30);
  ui.printStep(1, 30, 'launch_app', 'appId="com.android.settings"');
  if (awaitingExit) {
    ui.printJourneySummary({
      success: awaitingExit.code === 0,
      overallGoal: GOAL,
      subGoals: [
        { goal: 'Open the Settings app', status: 'completed', result: 'Settings open' },
        { goal: 'Read the Wi-Fi network name', status: 'completed', result: 'HomeNet-5G' },
      ],
      totalSteps: 7,
      durationMs: 24300,
      tokens: { input: 18420, output: 1360, cost: 0.0412, model: 'claude-opus-5' },
    });
  }
  await new Promise((r) => setTimeout(r, 40));
  const painted = frames.filter((f) => f.includes('╭'));
  instance.unmount();
  return (painted[painted.length - 1] ?? '').replace(ANSI, '').replace(/\n$/, '').split('\n');
}

describe('GoalRunScreen frame', () => {
  for (const [cols, rows] of [
    [200, 46],
    [120, 40],
    [100, 30],
    [80, 24],
  ] as const) {
    for (const streaming of [false, true]) {
      const label = streaming ? 'streaming' : 'idle';
      test(`${cols}x${rows} ${label}: fills the terminal without overlapping`, async () => {
        const frame = await frameAt(cols, rows, streaming);
        expect(frame.length).toBeLessThanOrEqual(rows);

        // Both halves survived. An over-tall frame overwrites the first line of
        // whichever box overflows, and these are the two that would show it.
        expect(frame.some((l) => l.includes('AppClaw'))).toBe(true);
        expect(frame.some((l) => l.includes('Device stream'))).toBe(true);
        // The run pane's own content and its pinned footer are both present.
        expect(frame.some((l) => l.includes('Plan'))).toBe(true);
        expect(frame.some((l) => l.includes('Goal'))).toBe(true);

        // The outer frame's bottom border is alone on its row — when the frame
        // overflowed it shared one with the panel's border.
        const closing = frame.filter((l) => l.trimStart().startsWith('╰'));
        expect(closing.every((l) => !l.replace(/[╰─╯\s│]/g, ''))).toBe(true);
      });
    }
  }

  test('a step row is clipped, never reflowed onto a second line', async () => {
    // StepLine is a fixed-width grid summing to ~79 cells; the run pane is
    // roughly half that. Left to shrink, its boxes wrapped their text and one
    // step became two rows — scrambled ("[1/3" over "0]") and, worse, a row the
    // height budget never reserved.
    const frame = await frameAt(120, 40, false);
    const step = frame.find((l) => l.includes('[1/30]'));
    expect(step).toBeDefined();
    expect(step).toContain('launch');
    // Nothing spilled onto the row below: the only thing that can follow is
    // blank pane or the panel's own border.
    const next = frame[frame.indexOf(step!) + 1] ?? '';
    expect(next).not.toMatch(/\bch\b|ngs"/);
  });

  test('the stream panel lands in the same columns MainScreen puts it in', async () => {
    // The frame loop cannot know which screen is mounted — it sizes every
    // transmitted image from layout.ts alone — so the two screens must place
    // the panel identically or the image and its placeholder grid disagree.
    // Measured off the panel's top border row, which on both screens is the one
    // row where the panel's box is the only box drawn to the right.
    const edges = (frame: string[]) => {
      const row = frame.find((l) => l.includes('Device stream'))!;
      // The panel's own left border is the last '│' before its title.
      return { open: row.lastIndexOf('│', row.indexOf('Device stream')), width: row.length };
    };
    const run = edges(await frameAt(120, 40, true, 'run'));
    const main = edges(await frameAt(120, 40, true, 'main'));
    expect(run).toEqual(main);
  });

  test('a terminal below MIN_RUN_ROWS says so instead of rendering corrupted', async () => {
    const frame = await frameAt(100, MIN_RUN_ROWS - 2, false);
    // No box is drawn at all, so the '╭' filter finds nothing.
    expect(frame).toEqual(['']);
  });

  test('a finished one-shot run holds the screen and says how to leave', async () => {
    // The result is the whole point of having watched, and leaving the
    // alternate screen erases it — so the run must not exit on its own.
    const frame = await frameAt(120, 40, true, 'run', { code: 0 });
    expect(frame.some((l) => l.includes('press any key to exit'))).toBe(true);
    expect(frame.some((l) => l.includes('Done'))).toBe(true);
    // Still the same frame, not a teardown or a bare summary.
    expect(frame.some((l) => l.includes('Device stream'))).toBe(true);
    expect(frame.length).toBeLessThanOrEqual(40);
  });

  test('the summary box closes inside the pane instead of being clipped', async () => {
    // FinalSummary sized itself off stdout.columns, which is right only while
    // the run owns the terminal. In a pane it drew wider than its column and the
    // pane's `overflow: hidden` sliced the right border and both corners off,
    // leaving a box that never closed. RunWidthContext is what fixes it.
    const frame = await frameAt(120, 40, false, 'run', { code: 0 });
    const opens = frame.filter((l) => l.includes('╭'));
    // Every box that opens inside the run pane also closes on the same row.
    const paneBoxes = opens.filter((l) => l.indexOf('╭') > 1);
    expect(paneBoxes.length).toBeGreaterThan(0);
    for (const row of paneBoxes) expect(row).toContain('╮');
  });

  test('a failed run says so rather than reporting Done', async () => {
    const frame = await frameAt(120, 40, false, 'run', { code: 1 });
    expect(frame.some((l) => l.includes('Failed'))).toBe(true);
    expect(frame.some((l) => l.includes('press any key to exit'))).toBe(true);
  });
});
