/**
 * The mirror's keyboard shortcuts.
 *
 * Two screens bind these — the goal prompt and the run screen — and the status
 * bar is the only place they are advertised, so the risk this file covers is
 * drift: a chord that does something the hint does not name, a hint for a chord
 * that no longer fires, or a chord that reaches the goal text instead of the
 * screen.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'ink';
import React from 'react';
import { PassThrough } from 'node:stream';
import { render as renderInk } from 'ink-testing-library';
import { MainScreen } from '@appclaw/cli/tui/screens/MainScreen';
import { StreamPanel } from '@appclaw/cli/tui/components/StreamPanel';
import { handleStreamKey, streamHints, STREAM_KEYS } from '@appclaw/cli/tui/stream-keys';
import { tuiStore, getSnapshot, type StreamStatus } from '@appclaw/cli/tui/store';
import type { TuiActions } from '@appclaw/cli/tui/commands';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const settle = () => new Promise((r) => setTimeout(r, 40));
const ctrl = (letter: string) => String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64);

/** The key object Ink hands a `useInput` handler, with only what matters set. */
const key = (over: Partial<Record<string, boolean>> = {}) =>
  ({ ctrl: true, meta: false, ...over }) as never;

function spyActions() {
  const calls: string[] = [];
  const actions = new Proxy(
    {},
    { get: (_t, prop: string) => () => calls.push(prop) }
  ) as TuiActions;
  return { actions, calls };
}

afterEach(() => tuiStore.reset());

describe('handleStreamKey', () => {
  test('^r starts the mirror, and resumes a paused one', () => {
    for (const status of ['idle', 'paused', 'error'] as StreamStatus[]) {
      const { actions, calls } = spyActions();
      expect(handleStreamKey(STREAM_KEYS.start, key(), status, actions)).toBe(true);
      // openStream resumes a paused mirror rather than restarting it, so one
      // chord covers both.
      expect(calls).toEqual(['openStream']);
    }
  });

  test('^r on a running mirror says so rather than restarting it', () => {
    const { actions, calls } = spyActions();
    handleStreamKey(STREAM_KEYS.start, key(), 'running', actions);
    expect(calls).toEqual([]);
    expect(getSnapshot().transcript.at(-1)?.text).toContain('already running');
  });

  test('^p toggles: pause while running, resume while paused', () => {
    const running = spyActions();
    handleStreamKey(STREAM_KEYS.pause, key(), 'running', running.actions);
    expect(running.calls).toEqual(['pauseStream']);

    const paused = spyActions();
    handleStreamKey(STREAM_KEYS.pause, key(), 'paused', paused.actions);
    expect(paused.calls).toEqual(['openStream']);
  });

  test('^x closes', () => {
    const { actions, calls } = spyActions();
    expect(handleStreamKey(STREAM_KEYS.close, key(), 'running', actions)).toBe(true);
    expect(calls).toEqual(['closeStream']);
  });

  test('the same letters without ctrl are not chords', () => {
    // They are goal text. This is the whole reason the bindings are chords.
    for (const letter of Object.values(STREAM_KEYS)) {
      const { actions, calls } = spyActions();
      expect(handleStreamKey(letter, key({ ctrl: false }), 'running', actions)).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  test('an unbound chord is declined, so ctrl+c still reaches Ink', () => {
    const { actions, calls } = spyActions();
    expect(handleStreamKey('c', key(), 'running', actions)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('streamHints', () => {
  test('every state names a chord that does something in it', () => {
    const states: StreamStatus[] = ['idle', 'starting', 'running', 'paused', 'error'];
    for (const status of states) {
      const hints = streamHints(status);
      expect(hints.length).toBeGreaterThan(0);
      // Short enough that the rest of the status bar survives the truncation.
      expect(hints.join('  ·  ').length).toBeLessThanOrEqual(24);
      for (const hint of hints) expect(hint).toMatch(/^\^[rpx] /);
    }
  });

  test('the hint follows the state — pause while running, resume while paused', () => {
    expect(streamHints('running').join()).toContain('pause');
    expect(streamHints('paused').join()).toContain('resume');
    expect(streamHints('idle').join()).toContain('stream');
  });
});

describe('what the UI tells you to press', () => {
  // Goal mode hides the palette, so a transcript line saying "/stream-pause
  // holds the frame" was pointing at something the user could no longer see —
  // and the chord that does the same thing went unmentioned. Everything the
  // stream says about itself names a key now.
  test('the idle panel names the chord that fills it', () => {
    const { lastFrame } = renderInk(
      <StreamPanel
        device={{
          name: 'sdk gphone64 arm64',
          udid: 'emulator-5554',
          state: 'device',
          platform: 'android',
        }}
        stream={{ status: 'idle' }}
        width={50}
        imageRows={6}
      />
    );
    const text = (lastFrame() ?? '').replace(ANSI, '');
    expect(text).toContain('^r');
    expect(text).not.toContain('/stream');
  });
});

describe('on the goal prompt', () => {
  async function mount(streamStatus: StreamStatus = 'idle') {
    const calls: string[] = [];
    const frames: string[] = [];
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    (stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      frames.push(s);
      return true;
    };
    Object.defineProperty(stdout, 'columns', { value: 140 });
    Object.defineProperty(stdout, 'rows', { value: 40 });
    Object.assign(stdout, { isTTY: true });
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => {}, unref: () => {} });

    const actions = new Proxy(
      {},
      { get: (_t, prop: string) => () => calls.push(prop) }
    ) as TuiActions;

    tuiStore.reset();
    tuiStore.setMode('goal');
    tuiStore.setStream({ status: streamStatus });
    tuiStore.goTo('main');
    const instance = render(<MainScreen actions={actions} />, {
      stdout,
      stdin,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    await settle();
    return {
      calls,
      frame: () =>
        (frames.filter((f) => f.includes('╭')).pop() ?? '').replace(ANSI, '').split('\n'),
      async press(keys: string) {
        (stdin as unknown as PassThrough).write(keys);
        await settle();
      },
      instance,
    };
  }

  test('a chord runs the action instead of typing into the goal', async () => {
    const m = await mount('idle');
    await m.press('open settings');
    await m.press(ctrl('r'));
    expect(m.calls).toEqual(['openStream']);
    // The goal being typed is untouched — the failure mode with ink-text-input
    // was "open settingsr".
    expect(m.frame().join('\n')).toContain('open settings');
    expect(m.frame().join('\n')).not.toContain('open settingsr');
    m.instance.unmount();
  });

  test('^p and ^x reach the mirror from the prompt too', async () => {
    const running = await mount('running');
    await running.press(ctrl('p'));
    expect(running.calls).toEqual(['pauseStream']);
    running.instance.unmount();

    const closing = await mount('running');
    await closing.press(ctrl('x'));
    expect(closing.calls).toEqual(['closeStream']);
    closing.instance.unmount();
  });

  test('the status bar advertises the chords for the current state', async () => {
    const idle = await mount('idle');
    expect(idle.frame().join('\n')).toContain('^r stream');
    idle.instance.unmount();

    const running = await mount('running');
    const text = running.frame().join('\n');
    expect(text).toContain('^p pause');
    expect(text).toContain('^x close');
    running.instance.unmount();
  });
});
