/**
 * Frame capture for the in-terminal device stream.
 *
 * `captureRaw` serves both backends on both platforms: pixels, so downsampling
 * is plain arithmetic with no image decoder and therefore no new dependency,
 * and a buffer the device body can be composited into — its rounded outline
 * needs an alpha channel that neither adb nor simctl will produce.
 *
 * Both dispatch on platform: Android goes through `adb exec-out screencap`,
 * iOS simulators through `xcrun simctl io … screenshot` (see capture-ios.ts,
 * which explains why that path must write files rather than pipe).
 *
 * Every invocation passes argv as an array: the udid comes from device
 * discovery and must never be interpolated into a shell string.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { captureRawIOS, getDeviceResolutionIOS } from './capture-ios.js';

const execFileAsync = promisify(execFile);

/** The platforms the stream can capture from. */
export type StreamPlatform = 'android' | 'ios';

/** A raw 1080x2400 frame is ~10MB; execFile's 1MB default would truncate it. */
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

/** A capture that outlives its frame slot is already stale — fail instead of queueing. */
const CAPTURE_TIMEOUT_MS = 8000;

export interface RawFrame {
  width: number;
  height: number;
  /** Tightly packed 4-byte pixels, `width * height * 4` bytes, top row first. */
  pixels: Buffer;
  /**
   * Channel order within each pixel. Android's `screencap` is RGBA; the BMP
   * simctl writes is BGRA. Carrying the order beats swapping ~12MB per frame
   * to normalise it — the renderer resolves its offsets once instead.
   */
  order?: 'rgba' | 'bgra';
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

/**
 * Grab one frame as pixels.
 *
 * `scratchPath` is used only by iOS, which cannot pipe a screenshot and must
 * land it in a file first. Android ignores it rather than making every caller
 * branch on platform to decide whether to supply one.
 */
export async function captureRaw(
  platform: StreamPlatform,
  udid: string,
  scratchPath: string
): Promise<RawFrame> {
  if (platform === 'ios') return captureRawIOS(udid, scratchPath);
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
export async function getDeviceResolution(
  platform: StreamPlatform,
  udid: string
): Promise<DeviceResolution> {
  if (platform === 'ios') return getDeviceResolutionIOS(udid);
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
