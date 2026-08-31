/**
 * The iPhone body composited around a streamed screen.
 *
 * The invariant worth guarding is not how it looks but that the two sides
 * agree on its SIZE: the cell box is fitted to what is transmitted, so if
 * `framedSize` and `frameDevice` ever disagree, the placeholder grid stops
 * matching the image and the terminal stretches the picture across the wrong
 * cells. Everything else here is the composite itself — body, screen, Island,
 * and the alpha that makes the outside of the body disappear.
 */
import { describe, expect, test } from 'vitest';
import { bezelWidth, frameDevice, framedSize } from '@appclaw/cli/tui/stream/device-frame';

const W = 1206;
const H = 2622;

/** An all-white screen, so anything that is not white came from the frame. */
const screen = (w = W, h = H) => Buffer.alloc(w * h * 4, 0xff);

const at = (img: { pixels: Buffer; width: number }, x: number, y: number) => [
  ...img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];

describe('framedSize', () => {
  test('matches what frameDevice actually produces', () => {
    // The agreement StreamPanel and the frame loop both depend on.
    const predicted = framedSize(W, H);
    const actual = frameDevice(screen(), W, H, 'ios');
    expect({ width: actual.width, height: actual.height }).toEqual(predicted);
  });

  test('the body costs about one row out of thirty-six', () => {
    // The whole argument for affording a bezel: the picture is height-bound,
    // so what matters is how much taller the canvas gets.
    const { height } = framedSize(W, H);
    const rows = Math.round(36 * (H / height));
    expect(rows).toBe(35);
  });

  test('the bezel is ~40px on a 1206px-wide iPhone', () => {
    expect(bezelWidth(W)).toBe(40);
  });
});

describe('frameDevice on Android', () => {
  const AW = 1080;
  const AH = 2400;
  const img = frameDevice(screen(AW, AH), AW, AH, 'android');
  const b = bezelWidth(AW);

  test('the screen is rounded here even though a bare Android screen is not', () => {
    // Not a contradiction with corner-mask.ts but a consequence of the body: a
    // rounded body around a SQUARE screen pinches, because the arc is centred
    // on (R,R) while the screen's corner sits at (bezel,bezel). Keeping a full
    // bezel there would need R <= bezel, i.e. no rounding at all.
    expect(img.pixels[3]).toBe(0); // outside the body: transparent
    // Where the screen's own corner used to be there is now BODY — not screen,
    // and not a hole: the rounding is cut against the body, not the panel.
    const corner = at(img, b, b);
    expect(corner[3]).toBe(255);
    expect(corner.slice(0, 3)).not.toEqual([255, 255, 255]);
  });

  test('there is no Dynamic Island — that is an iPhone part', () => {
    const islandY = b + Math.round(AH * 0.0126) + Math.round((AH * 0.041) / 2);
    expect(at(img, b + (AW >> 1), islandY).slice(0, 3)).toEqual([255, 255, 255]);
  });

  test('the canvas grows by exactly one bezel on each side', () => {
    expect({ width: img.width, height: img.height }).toEqual(framedSize(AW, AH));
    expect(img.width).toBe(AW + 2 * b);
  });
});

describe('bezel uniformity', () => {
  /** Bezel thickness along the 45-degree diagonal, which is where it pinches. */
  function cornerBezel(w: number, h: number, platform: 'ios' | 'android'): number {
    const img = frameDevice(screen(w, h), w, h, platform);
    let bodyStart = -1;
    for (let d = 0; d < img.width; d++) {
      const i = (d * img.width + d) * 4;
      if (bodyStart < 0 && img.pixels[i + 3] === 255) bodyStart = d;
      if (bodyStart >= 0 && img.pixels[i] === 255) return Math.round((d - bodyStart) * Math.SQRT2);
    }
    return -1;
  }

  test.each([
    ['ios', 1206, 2622],
    ['android', 1080, 2400],
    ['android', 1440, 3200],
  ] as const)('%s %ix%i keeps its bezel around the curve', (platform, w, h) => {
    // The bug the concentric radius fixes: with a square screen the body's arc
    // ran tangent to the screen's corner, so the bezel vanished exactly where
    // the eye looks for it while staying full along the sides.
    const side = bezelWidth(w);
    const corner = cornerBezel(w, h, platform);
    expect(corner / side).toBeGreaterThan(0.9);
    expect(corner / side).toBeLessThan(1.15);
  });
});

describe('frameDevice', () => {
  const img = frameDevice(screen(), W, H, 'ios');
  const b = bezelWidth(W);

  test('outside the body is transparent, so the panel shows through', () => {
    expect(at(img, 1, 1)[3]).toBe(0);
    expect(at(img, img.width - 2, 1)[3]).toBe(0);
  });

  test('the body itself is opaque and not pure black', () => {
    // Pure black would vanish into a black terminal, leaving the screen
    // looking unframed again — the thing the body exists to fix.
    const body = at(img, img.width >> 1, 4);
    expect(body[3]).toBe(255);
    expect(body.slice(0, 3)).not.toEqual([0, 0, 0]);
  });

  test('the screen is inset by exactly one bezel', () => {
    const [r, g, bl] = at(img, b + (W >> 1), b + (H >> 1));
    expect([r, g, bl]).toEqual([255, 255, 255]); // the screen we passed in
  });

  test('the Dynamic Island is a centred pill over live screen', () => {
    const islandY = b + Math.round(H * 0.0126) + Math.round((H * 0.041) / 2);
    const black = (frac: number) => at(img, b + Math.round(W * frac), islandY)[0] === 0;
    expect(black(0.5)).toBe(true); // centre
    expect(black(0.2)).toBe(false); // screen to the left
    expect(black(0.8)).toBe(false); // screen to the right
  });

  test('a BGRA screen is swapped during the copy, not in a pass of its own', () => {
    const px = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      px[i * 4] = 200; // B
      px[i * 4 + 1] = 100; // G
      px[i * 4 + 2] = 50; // R
    }
    const out = frameDevice(px, W, H, 'ios', 'bgra');
    expect(at(out, b + (W >> 1), b + (H >> 1)).slice(0, 3)).toEqual([50, 100, 200]);
  });
});
