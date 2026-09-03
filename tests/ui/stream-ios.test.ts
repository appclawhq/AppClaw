/**
 * iOS simulator capture.
 *
 * `xcrun simctl` differs from `adb` in two ways that decide this code's shape,
 * and both are pinned here because both fail *silently* if wrong — a bad
 * channel order or row order yields a plausible-looking picture rather than an
 * error, which is the worst thing to debug.
 *
 * The parsers are the testable half. The capture calls themselves shell out to
 * `xcrun` and are covered by the integration check in the PR, not here.
 */
import { describe, expect, test } from 'vitest';
import { parseBmp, parsePngSize, simulatorOnlyError } from '@appclaw/cli/tui/stream/capture-ios';
import { renderHalfBlocks } from '@appclaw/cli/tui/stream/halfblock';
import {
  frameIntervalFor,
  STREAM_FRAME_INTERVAL_MS,
  STREAM_FRAME_INTERVAL_IOS_MS,
} from '@appclaw/cli/tui/stream/frame-loop';

const DATA_OFFSET = 54; // BITMAPFILEHEADER (14) + BITMAPINFOHEADER (40)

/** Build the 32-bit BMP shape simctl emits. `height < 0` means top-down. */
function bmp(width: number, height: number, pixels: number[][], bpp = 32): Buffer {
  const rows = Math.abs(height);
  const buf = Buffer.alloc(DATA_OFFSET + width * rows * 4);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(DATA_OFFSET, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bpp, 28);
  pixels.forEach((px, i) => {
    // Stored BGRA, which is what the format's little-endian masks describe.
    buf[DATA_OFFSET + i * 4] = px[2];
    buf[DATA_OFFSET + i * 4 + 1] = px[1];
    buf[DATA_OFFSET + i * 4 + 2] = px[0];
    buf[DATA_OFFSET + i * 4 + 3] = 255;
  });
  return buf;
}

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];

describe('parseBmp', () => {
  test('reports BGRA rather than silently swapping 12MB per frame', () => {
    const frame = parseBmp(bmp(1, 1, [RED]));
    expect(frame.order).toBe('bgra');
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    // Red really is in the third byte — the swap has NOT been done here.
    expect([...frame.pixels.subarray(0, 3)]).toEqual([0, 0, 255]);
  });

  test('a top-down bitmap is passed through without a copy', () => {
    // Negative height is what simctl writes, and it is the whole reason the
    // common path costs nothing: the pixels are a subarray of the file.
    const source = bmp(1, -2, [RED, GREEN]);
    const frame = parseBmp(source);
    expect(frame.height).toBe(2);
    expect(frame.pixels.buffer).toBe(source.buffer);
  });

  test('a bottom-up bitmap is flipped, so row 0 is the top of the screen', () => {
    // Positive height means the first stored row is the BOTTOM one. Rendering
    // it unflipped produces an upside-down phone and no error at all.
    const frame = parseBmp(bmp(1, 2, [RED, GREEN]));
    expect([...frame.pixels.subarray(0, 3)]).toEqual([0, 255, 0]); // green now first
    expect([...frame.pixels.subarray(4, 7)]).toEqual([0, 0, 255]);
  });

  test('anything that is not a 32-bit BMP is rejected, not guessed at', () => {
    expect(() => parseBmp(Buffer.alloc(64))).toThrow(/not a BMP/);
    expect(() => parseBmp(bmp(1, -1, [RED], 24))).toThrow(/32-bit/);
    expect(() => parseBmp(bmp(4, -4, [RED]).subarray(0, 80))).toThrow(/Truncated/);
  });
});

describe('parsePngSize', () => {
  test('reads the IHDR without decoding a single pixel', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(1206, 16);
    png.writeUInt32BE(2622, 20);
    expect(parsePngSize(png)).toEqual({ width: 1206, height: 2622 });
  });

  test('a non-PNG is an error rather than a nonsense resolution', () => {
    expect(() => parsePngSize(Buffer.alloc(24))).toThrow(/not return a PNG/);
  });
});

describe('renderHalfBlocks channel order', () => {
  const px = (r: number, g: number, b: number) => [r, g, b, 255];

  test('an iOS frame renders the same colours an Android one would', () => {
    const rgba = {
      width: 1,
      height: 2,
      pixels: Buffer.from([...px(255, 0, 0), ...px(0, 0, 255)]),
    };
    const bgra = {
      width: 1,
      height: 2,
      pixels: Buffer.from([...px(0, 0, 255), ...px(255, 0, 0)]),
      order: 'bgra' as const,
    };
    expect(renderHalfBlocks(bgra, 1, 1)).toEqual(renderHalfBlocks(rgba, 1, 1));
    // And it is genuinely red-over-blue, not merely self-consistent.
    expect(renderHalfBlocks(bgra, 1, 1)[0]).toContain('38;2;255;0;0');
    expect(renderHalfBlocks(bgra, 1, 1)[0]).toContain('48;2;0;0;255');
  });

  test('mislabelling the order visibly swaps red and blue', () => {
    const pixels = Buffer.from([...px(255, 0, 0), ...px(255, 0, 0)]);
    const asRgba = renderHalfBlocks({ width: 1, height: 2, pixels }, 1, 1)[0];
    const asBgra = renderHalfBlocks({ width: 1, height: 2, pixels, order: 'bgra' }, 1, 1)[0];
    expect(asRgba).not.toEqual(asBgra);
  });
});

describe('frameIntervalFor', () => {
  test('iOS ticks slower, because simctl captures slower', () => {
    // ~310ms for the BMP the half-block path needs. Ticking at the Android
    // rate would just be dropped by the loop's `busy` guard.
    expect(frameIntervalFor('ios')).toBe(STREAM_FRAME_INTERVAL_IOS_MS);
    expect(frameIntervalFor('android')).toBe(STREAM_FRAME_INTERVAL_MS);
    expect(STREAM_FRAME_INTERVAL_IOS_MS).toBeGreaterThan(STREAM_FRAME_INTERVAL_MS);
  });
});

describe('simulatorOnlyError', () => {
  const udid = '00008030-001C2D0A0EF8802E';

  test('a physical iPhone gets told why, not "Invalid device"', () => {
    // Reachable via `--udid`: that path falls back to a synthetic device when
    // the identifier is not in the simulator listing, so a real iPhone can and
    // does arrive here.
    const err = simulatorOnlyError({ stderr: `Invalid device: ${udid}\n` }, udid);
    expect(err.message).toContain('is not a simulator');
    expect(err.message).toContain('QuickTime Player');
    expect(err.message).not.toContain('Invalid device');
  });

  test('any other failure is passed through untouched', () => {
    // A booted-but-wedged simulator, a missing Xcode — those are real errors
    // and their own text is more useful than a guess about the cause.
    const original = new Error('spawn xcrun ENOENT');
    expect(simulatorOnlyError(original, udid)).toBe(original);
  });
});
