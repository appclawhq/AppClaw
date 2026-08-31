/**
 * The keys that work while a goal is running.
 *
 * A run screen with no keyboard at all left ctrl+c — quit the whole app — as
 * the only way to react to anything, which is far too blunt for "I have seen
 * enough" or "hold that frame". These bind the two things there is any reason
 * to do mid-run, and the interesting part is what they must NOT do: `p` freezes
 * the mirror rather than closing it (closing blanks the picture, which is the
 * opposite of wanting to look at it) and `esc` asks the agent to stop rather
 * than killing the process, so the session, the report and the exit code
 * survive.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'ink';
import React from 'react';
import { PassThrough } from 'node:stream';
import { TuiApp } from '@appclaw/cli/tui/TuiApp';
import { tuiStore, getSnapshot } from '@appclaw/cli/tui/store';
import { attachRunRenderer } from '@appclaw/cli/ui/ink/InkRenderer';
import type { TuiActions } from '@appclaw/cli/tui/commands';
import * as ui from '@appclaw/core/ui/terminal';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const ESC = String.fromCharCode(27);
const settle = () => new Promise((r) => setTimeout(r, 40));

function mount(opts: { streaming?: boolean; awaitingExit?: { code: number } } = {}) {
  const calls: string[] = [];
  const frames: string[] = [];
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  (stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    frames.push(s);
    return true;
  };
  Object.defineProperty(stdout, 'columns', { value: 120 });
  Object.defineProperty(stdout, 'rows', { value: 40 });
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
  tuiStore.setRunningGoal('open settings and read the wifi name');
  if (opts.streaming) {
    tuiStore.setStream({
      status: 'running',
      backend: 'halfblock',
      resolution: { width: 1080, height: 2400 },
    });
    tuiStore.setStreamFrame(Array.from({ length: 20 }, () => '▀'.repeat(24)));
  }
  attachRunRenderer({ overallGoal: 'g', model: 'claude-opus-5', mode: 'dom' });
  if (opts.awaitingExit) tuiStore.setAwaitingExit(opts.awaitingExit);
  tuiStore.goTo('run');

  // The real actions, stubbed to the state change each one causes, so the key
  // handler is exercised against the store it actually reads back.
  const actions = new Proxy(
    {},
    {
      get: (_t, prop: string) => () => {
        calls.push(prop);
        if (prop === 'pauseStream') tuiStore.setStream({ status: 'paused' });
        if (prop === 'openStream') tuiStore.setStream({ status: 'running' });
        if (prop === 'stopRun') tuiStore.setStopping(true);
      },
    }
  ) as TuiActions;

  const instance = render(<TuiApp actions={actions} />, {
    stdout,
    stdin,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  ui.printPlan([{ goal: 'Open the Settings app' }] as never, 'one step');

  const statusRow = () => {
    const painted = frames.filter((f) => f.includes('╭'));
    const lines = (painted[painted.length - 1] ?? '').replace(ANSI, '').split('\n');
    return lines.find((l) => /│\s*(Run|Done|Failed)\s/.test(l)) ?? '';
  };
  const press = async (keys: string) => {
    (stdin as unknown as PassThrough).write(keys);
    await settle();
  };
  return { calls, press, statusRow, instance };
}

afterEach(() => tuiStore.reset());

describe('keys during a goal run', () => {
  test('p pauses the mirror and p again resumes it', async () => {
    const { calls, press, instance } = mount({ streaming: true });
    await settle();

    await press('p');
    expect(getSnapshot().stream.status).toBe('paused');
    // Pause, never close: closing deletes the transmitted image and blanks the
    // panel, which defeats the point of freezing a frame to look at.
    expect(calls).toEqual(['pauseStream']);

    await press('p');
    expect(getSnapshot().stream.status).toBe('running');
    expect(calls).toEqual(['pauseStream', 'openStream']);
    instance.unmount();
  });

  test('p does nothing when there is no mirror to freeze', async () => {
    const { calls, press, instance } = mount({ streaming: false });
    await settle();
    await press('p');
    expect(calls).toEqual([]);
    instance.unmount();
  });

  test('esc asks the run to stop, and says so until it lands', async () => {
    const { calls, press, statusRow, instance } = mount({ streaming: true });
    await settle();
    expect(statusRow()).toContain('esc stop run');

    await press(ESC);
    expect(calls).toEqual(['stopRun']);
    expect(getSnapshot().stopping).toBe(true);
    // Cancellation is cooperative — the agent finishes the step in flight — so
    // the screen must not claim the run is already over.
    expect(statusRow()).toContain('stopping…');
    expect(statusRow()).not.toContain('esc stop run');
    instance.unmount();
  });

  test('esc a second time does not re-abort', async () => {
    const { calls, press, instance } = mount({ streaming: true });
    await settle();
    await press(ESC);
    await press(ESC);
    expect(calls).toEqual(['stopRun']);
    instance.unmount();
  });

  test('the hints name what the keys currently do', async () => {
    // Advertised as the chord, because that is the form that also works at the
    // goal prompt, where a bare `p` is part of the goal being typed. Bare `p`
    // keeps working here — this screen has no input to compete with it — but
    // one set of keys in the user's head beats two.
    const { press, statusRow, instance } = mount({ streaming: true });
    await settle();
    expect(statusRow()).toContain('^p pause');
    await press('p');
    expect(statusRow()).toContain('^p resume');
    instance.unmount();
  });

  test('the mirror chords work here too, not just at the prompt', async () => {
    const running = mount({ streaming: true });
    await settle();
    await running.press(String.fromCharCode('P'.charCodeAt(0) - 64));
    expect(running.calls).toEqual(['pauseStream']);
    running.instance.unmount();

    // ^r matters most here: a run owns the screen, so this is the only way to
    // start the mirror once the agent is already going.
    const idle = mount({ streaming: false });
    await settle();
    await idle.press(String.fromCharCode('R'.charCodeAt(0) - 64));
    expect(idle.calls).toEqual(['openStream']);
    idle.instance.unmount();
  });

  test('once the run is over, any key exits instead', async () => {
    const { calls, press, instance } = mount({ streaming: true, awaitingExit: { code: 0 } });
    await settle();
    // Not pauseStream: the mirror is already paused by then, and there is
    // nothing left to do here but leave.
    await press('p');
    expect(calls).toEqual(['quit']);
    instance.unmount();
  });
});
