/**
 * Frame capture for iOS simulators, via `xcrun simctl io … screenshot`.
 *
 * Shaped by two things simctl does that adb does not:
 *
 *  - **It cannot write to stdout.** `screenshot -` is documented ("use \"-\"
 *    for stdout") and exits 0, but emits zero bytes. So every capture lands in
 *    a file and the caller owns the path. That suits the kitty backend, which
 *    wants a file anyway, and costs the half-block backend one read.
 *  - **It has no raw framebuffer.** `--type=bmp` is the way out: a 32-bit
 *    Windows bitmap is a fixed header followed by uncompressed pixels, so the
 *    half-block path still needs no image decoder and no new dependency —
 *    which is the same reason the Android path passes `screencap` without
 *    `-p`.
 *
 * Only simulators are reachable this way — simctl has no notion of a physical
 * iPhone, and there is no first-party CLI that streams one. A real device needs
 * either WebDriverAgent (`appium_screenshot` on the session `connect()` has
 * already built by the time /stream runs) or appium-ios-remotexpc's DVT
 * screenshot instrument, which needs a sudo-created tunnel on iOS 18+. Neither
 * is wired up here yet. The picker lists iOS devices via
 * `listIOSSimulators`, so that is normally unreachable; `--udid` with a real
 * device's identifier is the way in, and `simulatorOnlyError` makes sure it
 * says so rather than leaking "Invalid device: …".
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DeviceResolution, RawFrame } from './capture.js';

const execFileAsync = promisify(execFile);

/** A simulator screenshot is ~275ms; well inside this, but a wedged one must not pile up. */
const CAPTURE_TIMEOUT_MS = 8000;

/**
 * simctl prints "Wrote screenshot to: …" on success and a diagnostic on
 * failure, both small — but it also emits a "No display specified" note every
 * single call, so nothing here should treat stderr as a failure signal. The
 * exit code is the signal: an invalid udid exits 148, a shut-down simulator 60.
 */
async function simctl(udid: string, args: string[]): Promise<void> {
  try {
    await execFileAsync('xcrun', ['simctl', 'io', udid, ...args], {
      timeout: CAPTURE_TIMEOUT_MS,
    });
  } catch (err) {
    throw simulatorOnlyError(err, udid);
  }
}

/**
 * simctl answers "Invalid device: <udid>" for anything it does not manage,
 * which for an iOS udid overwhelmingly means a physical iPhone — reachable
 * here via `--udid`, since that path accepts an identifier the simulator
 * listing never returned.
 *
 * Left as-is that reads like a bug in AppClaw. Replaced, it names the real
 * limitation and points at the thing that does work.
 */
export function simulatorOnlyError(err: unknown, udid: string): Error {
  const text = `${(err as { stderr?: string })?.stderr ?? ''}${(err as Error)?.message ?? ''}`;
  if (!text.includes('Invalid device')) return err instanceof Error ? err : new Error(String(text));
  return new Error(
    `${udid} is not a simulator. In-terminal streaming uses xcrun simctl, ` +
      'which cannot reach a physical iPhone — mirror it with QuickTime Player ' +
      '(File ▸ New Movie Recording, then pick the device) instead.'
  );
}

/** Grab one PNG frame straight to `outPath` (the terminal reads the file itself). */
export async function capturePngIOS(udid: string, outPath: string): Promise<void> {
  await simctl(udid, ['screenshot', '--type=png', outPath]);
}

/**
 * Grab one frame as pixels, via a BMP written to `scratchPath`.
 *
 * The file is a scratch slot owned by the caller and is overwritten every
 * frame — simctl replaces an existing file without complaint.
 */
export async function captureRawIOS(udid: string, scratchPath: string): Promise<RawFrame> {
  await simctl(udid, ['screenshot', '--type=bmp', scratchPath]);
  return parseBmp(await readFile(scratchPath));
}

/**
 * Read the simulator's framebuffer size.
 *
 * There is no `wm size` equivalent — `simctl list` reports runtimes and names,
 * never pixels — so the only honest answer comes from a frame. One PNG is
 * taken into a temp dir of its own and only its IHDR is read; the pixels are
 * never decoded.
 */
export async function getDeviceResolutionIOS(udid: string): Promise<DeviceResolution> {
  const dir = await mkdtemp(join(tmpdir(), 'appclaw-simsize-'));
  const file = join(dir, 'probe.png');
  try {
    await capturePngIOS(udid, file);
    return parsePngSize(await readFile(file));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      /* best effort — a leftover temp dir is harmless */
    });
  }
}

/**
 * Width and height from a PNG's IHDR: an 8-byte signature, then a chunk whose
 * length and type occupy 8 more bytes, then two big-endian uint32s.
 */
export function parsePngSize(buf: Buffer): DeviceResolution {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('simctl did not return a PNG — is the simulator still booted?');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`PNG header reports an impossible size (${width}x${height})`);
  }
  return { width, height };
}

/** Offsets into the BITMAPFILEHEADER + DIB header that simctl emits. */
const PIXEL_OFFSET = 10;
const WIDTH = 18;
const HEIGHT = 22;
const BITS_PER_PIXEL = 28;

/**
 * Parse the 32-bit BMP simctl writes, into the same tightly packed frame the
 * Android path produces.
 *
 * Two details decide correctness, and both are read from the header rather
 * than assumed, because getting either wrong yields a plausible-looking
 * picture instead of an error — the worst possible failure to debug:
 *
 *  - **Row order.** A negative height means top-down, which is what simctl
 *    writes today. A positive one means bottom-up, the format's older default,
 *    and has to be flipped before the renderer's row indices mean anything.
 *  - **Channel order.** The pixels are BGRA, not RGBA. Rather than swap 12MB
 *    per frame, the frame carries its `order` and the renderer picks its
 *    offsets once.
 */
export function parseBmp(buf: Buffer): RawFrame {
  if (buf.length < 30 || buf[0] !== 0x42 || buf[1] !== 0x4d) {
    throw new Error('simctl screenshot is not a BMP — is the simulator still booted?');
  }
  const bpp = buf.readUInt16LE(BITS_PER_PIXEL);
  if (bpp !== 32) {
    throw new Error(`Expected a 32-bit BMP from simctl, got ${bpp}-bit`);
  }
  const offset = buf.readUInt32LE(PIXEL_OFFSET);
  const width = buf.readInt32LE(WIDTH);
  const signedHeight = buf.readInt32LE(HEIGHT);
  const height = Math.abs(signedHeight);
  if (width <= 0 || height <= 0 || width > 20000 || height > 20000) {
    throw new Error(`BMP header looks invalid (${width}x${signedHeight})`);
  }

  const stride = width * 4;
  const needed = stride * height;
  if (buf.length - offset < needed) {
    throw new Error(
      `Truncated BMP: ${buf.length - offset} pixel bytes for ${width}x${height} (expected ${needed})`
    );
  }
  const body = buf.subarray(offset, offset + needed);

  // Top-down needs no copy at all, which is the case simctl actually produces.
  if (signedHeight < 0) return { width, height, pixels: body, order: 'bgra' };

  const flipped = Buffer.allocUnsafe(needed);
  for (let y = 0; y < height; y++) {
    body.copy(flipped, y * stride, (height - 1 - y) * stride, (height - y) * stride);
  }
  return { width, height, pixels: flipped, order: 'bgra' };
}
