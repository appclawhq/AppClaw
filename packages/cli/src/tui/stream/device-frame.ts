/**
 * The device body drawn around an iOS screen: a black bezel with the screen
 * inset into it, and the Dynamic Island on top.
 *
 * Why this is affordable at all is a fact about the panel's geometry. The
 * picture is HEIGHT-bound with enormous horizontal slack — a 200x50 terminal
 * gives the stream a 103x36 cell budget and fits a 33x36 image into it, so 70
 * columns go unused while not a single row is spare. Widening the canvas is
 * therefore free and heightening it is not: a bezel of 3.3% of screen width
 * turns 1206x2622 into 1286x2702 and costs `36 * 2622/2702` — one row out of
 * thirty-six.
 *
 * Kitty only: half-blocks would render the bezel as a single cell of flat
 * colour, which reads as a border rather than a body.
 *
 * Both platforms get a body, and inside it both screens are rounded — even
 * Android, whose bare screen is deliberately left square (see corner-mask.ts).
 * That is not a contradiction but a geometric necessity: a rounded body around
 * a SQUARE screen pinches at the corners, because the body's arc is centred on
 * `(R, R)` while the screen's corner sits at `(bezel, bezel)`, leaving a gap of
 * `R - √2(R - bezel)`. Keeping the full bezel there needs `R ≤ bezel`, i.e. no
 * rounding at all; anything more eats the corner until, at `R ≈ 3.41·bezel`,
 * the arc is tangent to it and the bezel vanishes exactly where the eye looks
 * for it. Rounding the screen makes the body concentric and the bezel uniform.
 *
 * So Android's radius here is a deliberate stylisation of a framed device,
 * distinct from `cornerMask`'s refusal to cut a bare screen — and small, since
 * it does crop pixels that were really captured.
 *
 * Android has no Dynamic Island; that is an iPhone part, not a phone part.
 */

import {
  applyRoundedAlpha,
  cornerRadius,
  insideRoundedRect,
  type MaskPlatform,
} from './corner-mask.js';

/** Bezel thickness as a fraction of screen width. ~40px on a 1206px iPhone. */
const BEZEL_RATIO = 0.033;

/**
 * Not pure black. A titanium iPhone body is a very dark grey, and against a
 * genuinely black terminal a pure-black body would vanish into it, leaving the
 * screen looking unframed again.
 */
const BODY: readonly [number, number, number] = [18, 18, 20];

/**
 * Android's framed screen radius, as a fraction of the shorter side.
 *
 * Smaller than iOS's measured 16.4% because it is a guess rather than a
 * measurement, and every pixel of it is content that really was captured. Big
 * enough that the body reads as a phone instead of a picture frame.
 */
const ANDROID_SCREEN_RADIUS_RATIO = 0.06;

/**
 * Dynamic Island, as fractions of the screen. Measured off an iPhone 17 Pro:
 * roughly 125x36pt sitting 11pt below the top of a 402x874pt screen.
 *
 * It is drawn rather than captured because the framebuffer does not contain
 * it: iOS renders app content underneath the Island, and `simctl`'s own
 * `--mask=black` leaves that region untouched — verified by sampling the
 * centre of row 30, which comes back as wallpaper, not black.
 */
const ISLAND_WIDTH_RATIO = 0.311;
const ISLAND_HEIGHT_RATIO = 0.041;
const ISLAND_TOP_RATIO = 0.0126;

export interface FramedImage {
  pixels: Buffer;
  width: number;
  height: number;
}

/** Bezel thickness in pixels for a screen this wide. */
export function bezelWidth(screenWidth: number): number {
  return Math.round(screenWidth * BEZEL_RATIO);
}

/**
 * Canvas size for a framed screen.
 *
 * Exported because the cell box is fitted to the aspect ratio of what is
 * actually transmitted, and the frame changes it. `StreamPanel` and the frame
 * loop must both fit to THIS, or the placeholder grid and the image disagree
 * and the terminal stretches the picture across the wrong cells.
 */
export function framedSize(
  screenWidth: number,
  screenHeight: number
): { width: number; height: number } {
  const b = bezelWidth(screenWidth);
  return { width: screenWidth + 2 * b, height: screenHeight + 2 * b };
}

/** Whether `(x, y)` is inside a rounded rect placed at `(left, top)`. */
function insideAt(
  x: number,
  y: number,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number
): boolean {
  const lx = x - left;
  const ly = y - top;
  if (lx < 0 || ly < 0 || lx >= width || ly >= height) return false;
  return insideRoundedRect(lx, ly, width, height, radius);
}

/**
 * Composite `screen` into a device body and return the RGBA canvas to transmit.
 *
 * `order` is the screen's channel order; the swap iOS owes for the kitty
 * protocol happens during the copy rather than in a pass of its own.
 */
export function frameDevice(
  screen: Buffer,
  screenWidth: number,
  screenHeight: number,
  platform: MaskPlatform,
  order: 'rgba' | 'bgra' = 'rgba'
): FramedImage {
  const b = bezelWidth(screenWidth);
  const { width, height } = framedSize(screenWidth, screenHeight);
  // Not cornerMask's Android radius (0): a framed screen must be rounded or
  // the body pinches it — see the note at the top of this file.
  const screenRadius =
    platform === 'ios'
      ? cornerRadius(screenWidth, screenHeight, 'ios')
      : Math.round(Math.min(screenWidth, screenHeight) * ANDROID_SCREEN_RADIUS_RATIO);
  // Concentric with the screen so the bezel stays an even width around the
  // curve — plus, on Android, the rounding its square screen cannot supply.
  // Concentric with the screen, which is what keeps the bezel an even width all
  // the way around the curve.
  const bodyRadius = screenRadius + b;

  // Opaque body everywhere; the screen and the alpha mask are punched into it.
  const canvas = Buffer.alloc(width * height * 4);
  canvas.fill(Buffer.from([BODY[0], BODY[1], BODY[2], 255]));

  const swap = order === 'bgra';
  const rOff = swap ? 2 : 0;
  const bOff = swap ? 0 : 2;

  for (let y = 0; y < screenHeight; y++) {
    const src = y * screenWidth * 4;
    const dst = ((y + b) * width + b) * 4;
    // Only the corner bands can fall outside the screen's own rounding, so
    // every other row is a straight copy — but a BGRA source has to be walked
    // pixel by pixel regardless, since Buffer.copy cannot reorder channels.
    const inCornerBand = y < screenRadius || y >= screenHeight - screenRadius;
    if (!inCornerBand && !swap) {
      screen.copy(canvas, dst, src, src + screenWidth * 4);
      continue;
    }
    for (let x = 0; x < screenWidth; x++) {
      // Outside the screen's rounded corner the body shows through, so leave
      // the fill in place rather than copying a square screen over it.
      if (inCornerBand && !insideRoundedRect(x, y, screenWidth, screenHeight, screenRadius)) {
        continue;
      }
      const s = src + x * 4;
      const d = dst + x * 4;
      canvas[d] = screen[s + rOff];
      canvas[d + 1] = screen[s + 1];
      canvas[d + 2] = screen[s + bOff];
      canvas[d + 3] = 255;
    }
  }

  // An iPhone part, not a phone part.
  if (platform === 'ios') drawIsland(canvas, width, b, screenWidth, screenHeight);

  // Deriving this from the canvas size instead would pinch the corners.
  applyRoundedAlpha(canvas, width, height, bodyRadius, 'rgba');

  return { pixels: canvas, width, height };
}

/** Fill the Dynamic Island pill — fully rounded ends, opaque black. */
function drawIsland(
  canvas: Buffer,
  canvasWidth: number,
  bezel: number,
  screenWidth: number,
  screenHeight: number
): void {
  const w = Math.round(screenWidth * ISLAND_WIDTH_RATIO);
  const h = Math.round(screenHeight * ISLAND_HEIGHT_RATIO);
  if (w <= 0 || h <= 0) return;
  const left = bezel + Math.round((screenWidth - w) / 2);
  const top = bezel + Math.round(screenHeight * ISLAND_TOP_RATIO);
  const radius = Math.floor(h / 2); // a pill: the ends are semicircles

  for (let y = top; y < top + h; y++) {
    const row = y * canvasWidth * 4;
    for (let x = left; x < left + w; x++) {
      if (!insideAt(x, y, left, top, w, h, radius)) continue;
      const i = row + x * 4;
      canvas[i] = 0;
      canvas[i + 1] = 0;
      canvas[i + 2] = 0;
      canvas[i + 3] = 255;
    }
  }
}
