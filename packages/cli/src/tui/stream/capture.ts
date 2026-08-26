/**
 * Frame capture for the in-terminal device stream.
 *
 * Two shapes, one per render backend:
 *  - `capturePng` (`screencap -p`) for the Kitty path, which hands the PNG
 *    file to the terminal and never decodes it here.
 *  - `captureRaw` (`screencap`, no `-p`) for the half-block path — a raw RGBA
 *    framebuffer, so downsampling is plain arithmetic with no PNG decoder and
 *    therefore no new dependency.
 *
 * Every adb invocation passes argv as an array: the udid comes from device
 * discovery and must never be interpolated into a shell string.
 */

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** A raw 1080x2400 frame is ~10MB; execFile's 1MB default would truncate it. */
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

/** A capture that outlives its frame slot is already stale — fail instead of queueing. */
const CAPTURE_TIMEOUT_MS = 8000;

export interface RawFrame {
  width: number;
  height: number;
  /** Tightly packed RGBA, `width * height * 4` bytes. */
  pixels: Buffer;
}

export interface DeviceResolution {
  width: number;
  height: number;
}

async function adb(udid: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('adb', ['-s', udid, ...args], {
    encoding: 'buffer',
    maxBuffer: MAX_CAPTURE_BYTES,
    timeout: CAPTURE_TIMEOUT_MS,
  });
  return stdout;
}

/** Grab one PNG frame straight to `outPath` (the terminal reads the file itself). */
export async function capturePng(udid: string, outPath: string): Promise<void> {
  const png = await adb(udid, ['exec-out', 'screencap', '-p']);
  if (png.length === 0) throw new Error('adb screencap returned no data — is the device still up?');
  await writeFile(outPath, png);
}

/** Grab one raw RGBA frame. */
export async function captureRaw(udid: string): Promise<RawFrame> {
  return parseRawScreencap(await adb(udid, ['exec-out', 'screencap']));
}

/** Header sizes to try, oldest first: newer Android appended a colorspace field. */
const HEADER_SIZES = [12, 16] as const;

/**
 * Parse `screencap`'s raw output: little-endian uint32 width, height, format,
 * and (newer Android only) colorspace, followed by RGBA pixels.
 *
 * Which header size applies is not discoverable from a version string, so it's
 * inferred from the payload length. If neither fits, the frame is rejected
 * rather than rendered — a wrong offset produces plausible-looking garbage,
 * which is far worse to debug than an error message.
 */
export function parseRawScreencap(buf: Buffer): RawFrame {
  if (buf.length < 16) {
    throw new Error(`adb screencap returned ${buf.length} bytes — too short to be a framebuffer`);
  }
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  if (width <= 0 || height <= 0 || width > 20000 || height > 20000) {
    throw new Error(`adb screencap header looks invalid (${width}x${height})`);
  }
  for (const headerSize of HEADER_SIZES) {
    if (buf.length - headerSize === width * height * 4) {
      return { width, height, pixels: buf.subarray(headerSize) };
    }
  }
  throw new Error(
    `Unreadable screencap framebuffer: ${buf.length} bytes for ${width}x${height} ` +
      '(expected a 12- or 16-byte header followed by RGBA pixels)'
  );
}

/**
 * Device resolution, read once when the stream opens. The Kitty path never
 * decodes the PNG, so this is the only source of the aspect ratio it needs to
 * size the cell box with.
 */
export async function getDeviceResolution(udid: string): Promise<DeviceResolution> {
  const out = (await adb(udid, ['shell', 'wm', 'size'])).toString('utf-8');
  // "Physical size: 1080x2400" — optionally followed by "Override size: …",
  // which is what the framebuffer actually is, so the LAST match wins.
  const matches = [...out.matchAll(/(\d+)x(\d+)/g)];
  const last = matches[matches.length - 1];
  if (!last) {
    throw new Error(`Could not read device resolution from: ${out.trim() || '(no adb output)'}`);
  }
  return { width: Number(last[1]), height: Number(last[2]) };
}
