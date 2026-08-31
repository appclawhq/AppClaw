/**
 * The rounded-corner mask — iOS only.
 *
 * Its radius is not arbitrary: `simctl screenshot --mask=black` on an iPhone
 * 17 Pro masks 198px in from each edge of a 1206px-wide framebuffer, and the
 * proportional constant reproduces that number exactly. That agreement is the
 * first test — it is what justifies not carrying a per-device table.
 *
 * Android is deliberately unmasked, expressed as a radius of 0 so that both
 * backends skip the work without either knowing why. There is nothing to
 * measure against there and a guessed radius would crop real content.
 */
import { describe, expect, test } from 'vitest';
import {
  applyRoundedAlpha,
  cornerRadius,
  insideRoundedRect,
} from '@appclaw/cli/tui/stream/corner-mask';

describe('cornerRadius', () => {
  test("matches simctl's own mask on the device it was measured against", () => {
    expect(cornerRadius(1206, 2622, 'ios')).toBe(198);
  });

  test('scales with the shorter side, so a landscape frame is not over-rounded', () => {
    expect(cornerRadius(2622, 1206, 'ios')).toBe(cornerRadius(1206, 2622, 'ios'));
  });

  test('a frame too small to round is left alone', () => {
    // Guards the unit-test-sized frames elsewhere in the suite, which would
    // otherwise be masked into near-nothing.
    expect(cornerRadius(4, 4, 'ios')).toBe(1);
    expect(insideRoundedRect(0, 0, 2, 2, cornerRadius(2, 2, 'ios'))).toBe(true);
  });

  test('Android is not masked at all', () => {
    // Zero radius, so every corner test short-circuits to "inside" and neither
    // backend does any masking work.
    expect(cornerRadius(1080, 2400, 'android')).toBe(0);
    expect(insideRoundedRect(0, 0, 1080, 2400, 0)).toBe(true);
  });
});

describe('insideRoundedRect', () => {
  const w = 1206;
  const h = 2622;
  const r = cornerRadius(w, h, 'ios');

  test('all four corners are outside and the centre is inside', () => {
    for (const [x, y] of [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ]) {
      expect(insideRoundedRect(x, y, w, h, r)).toBe(false);
    }
    expect(insideRoundedRect(w >> 1, h >> 1, w, h, r)).toBe(true);
  });

  test('the straight edges between the corners survive', () => {
    // A mask that rounded the whole outline would quietly crop the screen.
    expect(insideRoundedRect(w >> 1, 0, w, h, r)).toBe(true); // top edge
    expect(insideRoundedRect(0, h >> 1, w, h, r)).toBe(true); // left edge
  });
});

describe('applyRoundedAlpha', () => {
  test('an explicit radius of 0 leaves every pixel opaque', () => {
    // How Android skips masking without the function knowing it is Android.
    const px = Buffer.alloc(4 * 4 * 4, 0xff);
    applyRoundedAlpha(px, 4, 4, 0, 'rgba');
    expect([...px].every((b) => b === 0xff)).toBe(true);
  });

  /** A 4x4 frame with every pixel opaque, in the given channel order. */
  const frame = () => Buffer.alloc(4 * 4 * 4, 0xff);

  test('corner pixels lose their alpha, the middle keeps it', () => {
    const px = frame();
    applyRoundedAlpha(px, 4, 4, cornerRadius(4, 4, 'ios'), 'rgba');
    expect(px[3]).toBe(0); // (0,0)
    const centre = (1 * 4 + 1) * 4;
    expect(px[centre + 3]).toBe(255);
  });

  test('a BGRA frame is swapped to RGBA in the same pass', () => {
    // The swap is owed anyway for the kitty protocol, which is what makes the
    // mask effectively free on iOS.
    const px = Buffer.alloc(4 * 4 * 4);
    const centre = (1 * 4 + 1) * 4;
    // Stored BGRA — a mostly-blue pixel: B=200, G=100, R=50.
    px.set([200, 100, 50, 0], centre);
    applyRoundedAlpha(px, 4, 4, cornerRadius(4, 4, 'ios'), 'bgra');
    // Read back as RGBA it must still be mostly blue, with blue now last.
    expect([...px.subarray(centre, centre + 4)]).toEqual([50, 100, 200, 255]);
  });

  test('an RGBA frame keeps its channels exactly where they were', () => {
    const px = Buffer.alloc(4 * 4 * 4);
    const centre = (1 * 4 + 1) * 4;
    px.set([50, 100, 200, 255], centre);
    applyRoundedAlpha(px, 4, 4, cornerRadius(4, 4, 'ios'), 'rgba');
    expect([...px.subarray(centre, centre + 4)]).toEqual([50, 100, 200, 255]);
  });

  test('the mask is symmetric across all four corners', () => {
    const w = 64;
    const h = 64;
    const px = Buffer.alloc(w * h * 4, 0xff);
    applyRoundedAlpha(px, w, h, cornerRadius(w, h, 'ios'), 'rgba');
    const a = (x: number, y: number) => px[(y * w + x) * 4 + 3];
    expect([a(0, 0), a(w - 1, 0), a(0, h - 1), a(w - 1, h - 1)]).toEqual([0, 0, 0, 0]);
  });
});
