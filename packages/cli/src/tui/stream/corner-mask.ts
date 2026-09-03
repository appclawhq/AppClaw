/**
 * The rounded-corner mask that makes a streamed frame read as a phone rather
 * than a rectangle of pixels.
 *
 * One module because both backends need the same shape from different sides:
 * the half-block renderer asks per cell-half whether to draw, the kitty path
 * asks per pixel whether to zero the alpha. A mask that disagreed between them
 * would round the two backends differently.
 *
 * **iOS only.** The radius is proportional rather than per-device, and it is
 * measured: `simctl screenshot --mask=black` on an iPhone 17 Pro masks 198px
 * in from each edge of a 1206px-wide framebuffer — 16.4%, and every current
 * iPhone is close enough to that for a device table to buy nothing.
 *
 * **Android is not masked at all**, which a ratio of 0 expresses so that both
 * backends skip the work without either of them knowing why. There is nothing
 * to measure against there: `screencap` always returns the unmasked
 * rectangle, devices round by wildly different amounts, and plenty of emulator
 * skins are square. A guessed radius would crop content that is really on the
 * screen — a worse outcome than a square frame, which is at least honest about
 * what was captured.
 */

export type MaskPlatform = 'android' | 'ios';

/** Fraction of the SHORTER side, per platform. See the note above. */
const RADIUS_RATIO: Record<MaskPlatform, number> = {
  ios: 0.164,
  android: 0, // not masked — see the note above
};

/** Corner radius in pixels for a frame of this size, or 0 where masking is off. */
export function cornerRadius(width: number, height: number, platform: MaskPlatform): number {
  return Math.round(Math.min(width, height) * RADIUS_RATIO[platform]);
}

/**
 * Whether `(x, y)` falls inside the rounded rectangle.
 *
 * Only the four corner squares can fail, so the common case is two compares.
 * Coordinates are pixel centres, which is why the comparison uses `x + 0.5`:
 * testing the corner of a pixel puts the boundary half a pixel out and leaves
 * a visible step on the diagonal.
 */
export function insideRoundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): boolean {
  if (radius <= 0) return true;
  const cx = x < radius ? radius : x >= width - radius ? width - radius - 1 : -1;
  if (cx < 0) return true; // not in a corner column
  const cy = y < radius ? radius : y >= height - radius ? height - radius - 1 : -1;
  if (cy < 0) return true; // not in a corner row
  const dx = x + 0.5 - (cx + 0.5);
  const dy = y + 0.5 - (cy + 0.5);
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Rewrite `pixels` in place as RGBA with the corners fully transparent, for
 * the kitty backend (`f=32`).
 *
 * In place, and one pass, because both jobs land on the same bytes: iOS frames
 * arrive BGRA and have to be swapped for the protocol anyway, so folding the
 * alpha into that pass makes the mask free on iOS and near-free on Android
 * (where the buffer is already RGBA and only the corner rows are touched).
 *
 * `radius` is passed rather than derived so a caller can round something other
 * than a bare screen — the device frame rounds its outer body with a radius
 * concentric to the screen's, which is not what this frame's own dimensions
 * would produce.
 */
export function applyRoundedAlpha(
  pixels: Buffer,
  width: number,
  height: number,
  radius: number,
  order: 'rgba' | 'bgra' = 'rgba'
): void {
  const swap = order === 'bgra';

  for (let y = 0; y < height; y++) {
    const inCornerBand = y < radius || y >= height - radius;
    // Away from the top and bottom bands nothing can be masked, so an RGBA
    // frame has no work to do on this row at all.
    if (!inCornerBand && !swap) continue;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (swap) {
        const b = pixels[i];
        pixels[i] = pixels[i + 2];
        pixels[i + 2] = b;
      }
      if (inCornerBand) {
        pixels[i + 3] = insideRoundedRect(x, y, width, height, radius) ? 255 : 0;
      } else if (swap) {
        pixels[i + 3] = 255;
      }
    }
  }
}
