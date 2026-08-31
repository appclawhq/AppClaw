/**
 * Keyboard shortcuts for the device stream, and the hints that advertise them.
 *
 * Both live here for the same reason the geometry lives in `stream/layout.ts`:
 * two screens bind these (the goal prompt and the run screen), and a chord the
 * status bar does not name is a chord nobody finds. Changing one without the
 * other is the failure this module makes impossible.
 *
 * They are ctrl chords rather than bare letters because the goal prompt is a
 * focused text input — a bare `p` is part of the goal you are typing. That in
 * turn is why the prompt uses <PromptInput> instead of `ink-text-input`, which
 * inserts unrecognised chords as plain letters. The run screen has no input, so
 * it keeps its bare `p` as well.
 */

import type { Key } from 'ink';
import { tuiStore } from './store.js';
import type { StreamStatus } from './store.js';
import type { TuiActions } from './commands.js';

/** ^r starts or resumes, ^p pauses or resumes, ^x tears it down. */
export const STREAM_KEYS = { start: 'r', pause: 'p', close: 'x' } as const;

/**
 * Act on a stream chord. Returns whether the key was one, so callers can stop
 * processing — nothing else in the app should see it.
 *
 * Every branch does something observable, including the ones that decline: a
 * shortcut that silently does nothing is indistinguishable from a broken key,
 * and these are pressed without looking at the panel.
 */
export function handleStreamKey(
  input: string,
  key: Key,
  status: StreamStatus,
  actions: TuiActions
): boolean {
  if (!key.ctrl || key.meta) return false;

  switch (input) {
    case STREAM_KEYS.start:
      if (status === 'running') {
        tuiStore.log('info', 'The stream is already running', '^p pauses it · ^x closes it');
      } else {
        // openStream resumes a paused stream rather than restarting it, so one
        // chord covers both "start" and "carry on".
        void actions.openStream();
      }
      return true;

    case STREAM_KEYS.pause:
      // Pause, never close: the picture stays up. Freezing a frame you want to
      // look at is the point, and closing would take it away.
      if (status === 'running') actions.pauseStream();
      else void actions.openStream();
      return true;

    case STREAM_KEYS.close:
      actions.closeStream();
      return true;

    default:
      return false;
  }
}

/**
 * Status-bar hints for the stream's current state — one or two entries, since
 * the bar truncates and the rest of the line has to survive too.
 */
export function streamHints(status: StreamStatus): string[] {
  switch (status) {
    case 'running':
      return ['^p pause', '^x close'];
    case 'paused':
      return ['^p resume', '^x close'];
    case 'starting':
      return ['^x close'];
    default:
      return ['^r stream'];
  }
}
