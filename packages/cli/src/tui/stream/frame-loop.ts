/**
 * The capture → encode → present loop behind `/stream`.
 *
 * Deliberately outside React, because the two backends need different things:
 *
 *  - halfblock frames are just text with SGR colours, so they are handed to the
 *    store via `onFrame` and rendered as ordinary Ink content. The capture
 *    interval doubles as the store's update rate — every frame is an Ink
 *    re-render, so it must stay coarse.
 *  - kitty frames are real pixels, which no component output can express. This
 *    module ships them to the terminal and stops there: it never places them.
 *    Placement is done by the U+10EEEE placeholder cells <StreamPanel> renders,
 *    so Ink decides where the picture goes and every Ink repaint redraws it.
 *
 * That split is why nothing here touches the cursor, wraps `process.stdout.write`
 * or knows a terminal coordinate.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { captureRaw } from './capture.js';
import { frameDevice } from './device-frame.js';
import { displayTarget, downscale } from './scale.js';
import { renderHalfBlocks } from './halfblock.js';
import { kittyDeleteImage, kittyTransmitVirtual } from './kitty.js';
import { streamCells } from './layout.js';
import type { StreamPlatform } from './capture.js';
import type { StreamBackend } from './terminal-caps.js';

/**
 * ~5fps, which is a ceiling rather than a promise: `adb exec-out screencap`
 * costs ~150ms on a fast device but was measured at ~870ms on an arm64
 * emulator (~480ms of that inside the device's own screencap, the rest
 * transfer), so a tick that fires while a capture is still in flight is simply
 * skipped by the `busy` guard.
 */
export const STREAM_FRAME_INTERVAL_MS = 200;

/**
 * ~3fps. `simctl io … screenshot` costs ~275ms for a PNG and ~310ms for the
 * BMP the half-block path needs — appreciably slower than adb, and it has to
 * round-trip a file besides. Ticking at the Android rate would just be skipped
 * by the `busy` guard, so the slower interval is the honest one.
 */
export const STREAM_FRAME_INTERVAL_IOS_MS = 350;

/** How often to capture, for a platform whose capture cost differs. */
export function frameIntervalFor(platform: StreamPlatform): number {
  return platform === 'ios' ? STREAM_FRAME_INTERVAL_IOS_MS : STREAM_FRAME_INTERVAL_MS;
}

/**
 * Arbitrary but stable, and the number <StreamPanel> encodes into the
 * foreground colour of every placeholder cell. Reusing one id is what makes
 * each frame replace the last.
 */
export const KITTY_IMAGE_ID = 7301;

export interface StreamLoopOptions {
  platform: StreamPlatform;
  udid: string;
  deviceWidth: number;
  deviceHeight: number;
  backend: StreamBackend;
  /** halfblock only: one ready-to-render text row per cell row, for the store. */
  onFrame(lines: string[]): void;
  /** Called once, after the loop has already stopped itself. */
  onError(message: string): void;
}

/**
 * How many captures in a row may fail before the stream gives up.
 *
 * Capture fails transiently for reasons that have nothing to do with the
 * stream being unviable — the compositor is mid-transition while an app opens
 * or closes, or adb/simctl is briefly busy. Stopping on the first error meant
 * closing an app could kill the mirror, which is exactly when you want to
 * watch it. A genuinely dead device fails every tick and still stops within a
 * second or two.
 */
const MAX_CONSECUTIVE_FAILURES = 4;

interface LoopState extends StreamLoopOptions {
  timer: NodeJS.Timeout;
  tmpDir: string;
  /** A capture is in flight — skip this tick rather than stacking captures. */
  busy: boolean;
  /** Ping-pong index for the two PNG paths. */
  slot: 0 | 1;
  /** An image is loaded in the terminal and has to be deleted on teardown. */
  transmitted: boolean;
  /** Consecutive failed captures; any success resets it. */
  failures: number;
}

let loop: LoopState | null = null;

/**
 * Whether the panel is currently on screen. TuiApp renders dialogs and other
 * screens INSTEAD of MainScreen, so the placeholder cells can vanish while the
 * loop is still running, and capturing for a picture nobody renders is pure
 * cost.
 */
let visible = true;

/**
 * Whether `/stream-pause` has asked the loop to stop capturing.
 *
 * A separate gate from `visible`, not the same one: that tracks whether anything
 * is rendering the picture, this tracks whether the user wants it updated. Both
 * must be clear for a tick to capture, and neither may clear the other — a pause
 * has to survive the panel unmounting and remounting (a dialog, a screen
 * change), and a remount must not silently resume a paused stream.
 *
 * Pausing deliberately leaves the loop, its temp dir and any transmitted kitty
 * image alone. That is the whole difference from `/stream-close`: the last frame
 * stays on screen, and resuming costs nothing — no backend re-detection, no
 * resolution round-trip, no re-transmit.
 */
let paused = false;

export function isStreamLoopRunning(): boolean {
  return loop !== null;
}

export function isStreamLoopPaused(): boolean {
  return paused;
}

/** Driven by <StreamPanel>'s mount/unmount — the panel is what renders the picture. */
export function setStreamPanelVisible(next: boolean): void {
  visible = next;
}

/** `/stream-pause` — hold the last frame and stop capturing. */
export function pauseStreamLoop(): void {
  paused = true;
}

/** `/stream` on a paused mirror — start capturing again into the same picture. */
export function resumeStreamLoop(): void {
  paused = false;
}

export function startStreamLoop(options: StreamLoopOptions): void {
  stopStreamLoop();
  // A fresh stream is never born paused — stopStreamLoop leaves the flag alone
  // so a pause survives a panel remount, which means a later start has to clear
  // it explicitly.
  paused = false;
  const state: LoopState = {
    ...options,
    // Placeholder: replaced immediately below. setInterval needs `state` to
    // exist, and `state` needs the handle, so one of the two has to be filled
    // in after construction.
    timer: undefined as unknown as NodeJS.Timeout,
    tmpDir: mkdtempSync(join(tmpdir(), 'appclaw-stream-')),
    busy: false,
    slot: 0,
    transmitted: false,
    failures: 0,
  };
  state.timer = setInterval(() => void tick(state), frameIntervalFor(options.platform));
  // The Ink app already keeps the process alive; this timer must not be what
  // holds it open after the TUI is gone.
  state.timer.unref();
  loop = state;
  void tick(state);
}

export function stopStreamLoop(): void {
  const state = loop;
  if (!state) return;
  // Null first: an in-flight tick checks identity and bails instead of
  // transmitting into a panel that is already closing.
  loop = null;
  clearInterval(state.timer);
  if (state.transmitted) {
    write(kittyDeleteImage(KITTY_IMAGE_ID));
    state.transmitted = false;
  }
  try {
    rmSync(state.tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort — a leftover temp dir is harmless */
  }
}

async function tick(state: LoopState): Promise<void> {
  if (loop !== state || state.busy || !visible || paused) return;
  state.busy = true;
  try {
    // Read the terminal size every tick so a resize re-fits the image without
    // any resize plumbing of its own. <StreamPanel> runs the same function
    // against the same numbers, so the cell box always matches the placeholders.
    const cells = streamCells(
      process.stdout.columns || 80,
      process.stdout.rows || 24,
      state.deviceWidth,
      state.deviceHeight
    );

    // Alternate paths on every frame: the terminal reads the file itself,
    // asynchronously from our point of view, so overwriting the one it may
    // still be reading would tear the frame.
    state.slot = state.slot === 0 ? 1 : 0;

    const frame = await captureRaw(
      state.platform,
      state.udid,
      join(state.tmpDir, `frame-${state.slot}.bmp`)
    );
    if (loop !== state) return;

    if (state.backend === 'kitty') {
      // Composite the screen into a device body. Its rounded outline needs an
      // alpha channel, and neither adb nor simctl supplies one — simctl's
      // `--mask` offers black only, and a PNG is the one format we would have
      // to encode ourselves. So the payload is raw, which is also what the
      // half-block path has always pulled on Android. Any BGRA -> RGBA swap the
      // protocol owes happens during the composite's copy.
      const framed = frameDevice(
        frame.pixels,
        frame.width,
        frame.height,
        state.platform,
        frame.order ?? 'rgba'
      );
      // Scale to roughly what the cell box will actually show. Raw frames are
      // ~11MB at device resolution and the terminal rescales every byte on
      // every frame; none of that detail survives the trip.
      const target = displayTarget(cells.rows, framed.width, framed.height);
      const shown = downscale(framed, target.width, target.height);
      const file = join(state.tmpDir, `frame-${state.slot}.rgba`);
      await writeFile(file, shown.pixels);
      if (loop !== state) return;
      write(
        kittyTransmitVirtual(file, {
          id: KITTY_IMAGE_ID,
          ...cells,
          image: { format: 'rgba', pixelWidth: shown.width, pixelHeight: shown.height },
        })
      );
      state.transmitted = true;
    } else {
      // Half-blocks have no alpha to write into, so they get no body — only
      // the per-cell-half corner mask, which is a no-op on Android (radius 0).
      state.onFrame(renderHalfBlocks(frame, cells.cols, cells.rows, state.platform));
    }
    state.failures = 0;
  } catch (err) {
    if (loop !== state) return;
    state.failures += 1;
    // Ride out a transient failure; only a sustained one means the stream is
    // actually unviable (device gone, adb/simctl missing), and that fails every tick
    // so it still stops promptly.
    if (state.failures < MAX_CONSECUTIVE_FAILURES) return;
    stopStreamLoop();
    state.onError(err instanceof Error ? err.message : String(err));
  } finally {
    state.busy = false;
  }
}

/**
 * Graphics commands carry no cursor movement and paint nothing, so they can be
 * interleaved with Ink's frames without saving or restoring anything.
 */
function write(body: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(body);
}
