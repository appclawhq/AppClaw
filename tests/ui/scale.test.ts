/**
 * Downscaling before transmit.
 *
 * Measured on an Android emulator: a framed 1152x2472 frame is 11.4MB of raw
 * RGBA, and the terminal reads and rescales all of it on every frame to fill a
 * cell box a few hundred pixels wide. Scaling here first costs ~19ms and cuts
 * the payload 5.5x.
 */
import { describe, expect, test } from 'vitest';
import { displayTarget, downscale, MAX_PX_PER_ROW } from '@appclaw/cli/tui/stream/scale';

const solid = (w: number, h: number, v: number) => ({
  pixels: Buffer.alloc(w * h * 4, v),
  width: w,
  height: h,
});

describe('displayTarget', () => {
  test('caps height at the row budget and keeps the aspect ratio', () => {
    const t = displayTarget(33, 1152, 2472);
    expect(t.height).toBe(33 * MAX_PX_PER_ROW);
    // 1152/2472 preserved to within a pixel of rounding.
    expect(Math.abs(t.width / t.height - 1152 / 2472)).toBeLessThan(0.005);
  });

  test('never upscales a frame that is already small enough', () => {
    // Upscaling would spend payload inventing detail the capture never had.
    const t = displayTarget(100, 400, 900);
    expect(t).toEqual({ width: 400, height: 900 });
  });
});

describe('downscale', () => {
  test('a flat image stays exactly that colour', () => {
    const out = downscale(solid(64, 64, 0x40), 16, 16);
    expect(out.width).toBe(16);
    expect([...out.pixels].every((b) => b === 0x40)).toBe(true);
  });

  test('averages rather than point-samples', () => {
    // Nearest-neighbour would return one of the two source values; a box filter
    // returns their mean. Text and icons alias badly under the former at these
    // ratios, which is the whole reason for the extra arithmetic.
    const w = 4;
    const h = 4;
    const pixels = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) pixels.fill(i % 2 === 0 ? 0 : 200, i * 4, i * 4 + 4);
    const out = downscale({ pixels, width: w, height: h }, 2, 2);
    expect(out.pixels[0]).toBe(100); // mean of 0 and 200
  });

  test('a request to enlarge returns the source untouched', () => {
    const src = solid(8, 8, 1);
    expect(downscale(src, 16, 16)).toBe(src);
  });

  test('alpha is carried through, so the body outline survives', () => {
    // The mask lives in alpha; losing it would square the frame off again.
    const w = 4;
    const h = 4;
    const pixels = Buffer.alloc(w * h * 4, 0xff);
    for (let i = 0; i < w * h; i++) pixels[i * 4 + 3] = i < 8 ? 0 : 255;
    const out = downscale({ pixels, width: w, height: h }, 2, 2);
    expect(out.pixels[3]).toBe(0); // top half fully transparent
    expect(out.pixels[(1 * 2 + 0) * 4 + 3]).toBe(255); // bottom half opaque
  });
});
