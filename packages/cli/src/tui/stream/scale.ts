/**
 * Downscaling the frame before it is handed to the terminal.
 *
 * The kitty payload used to be a PNG the terminal decoded for itself; it is now
 * raw RGBA, because the device body needs an alpha channel neither adb nor
 * simctl will produce. Raw at full device resolution is ~11MB per frame against
 * a PNG's ~1.4MB, and the terminal reads and rescales every byte of it on every
 * frame — work that is invisible from here but lands on the same screen.
 *
 * None of those bytes survive: the image is scaled into a `cols x rows` cell
 * box perhaps 500px wide. Scaling it here first is the same arithmetic the
 * terminal would do, on a buffer we already hold, and it cuts the payload by
 * roughly five times. The cell box is unchanged, so `layout.ts` and the
 * placeholder grid are untouched — only the pixel density of what fills it.
 */

/**
 * Pixel height budgeted per terminal row. Deliberately generous: a HiDPI cell
 * is around 30-40 physical pixels tall, and the protocol offers no way to ask
 * (a query would answer on the stdin Ink holds in raw mode). Guessing high
 * costs some payload; guessing low would visibly soften the picture.
 */
export const MAX_PX_PER_ROW = 32;

export interface Bitmap {
  pixels: Buffer;
  width: number;
  height: number;
}

/** The size to transmit for an image that will be drawn into `cellRows` rows. */
export function displayTarget(
  cellRows: number,
  width: number,
  height: number
): { width: number; height: number } {
  const maxHeight = Math.max(1, cellRows) * MAX_PX_PER_ROW;
  if (height <= maxHeight) return { width, height };
  const scale = maxHeight / height;
  return { width: Math.max(1, Math.round(width * scale)), height: maxHeight };
}

/**
 * Box-filter downscale: each destination pixel is the mean of the source block
 * it covers.
 *
 * Averaging rather than point-sampling because the content is mostly text and
 * icons, which alias badly under nearest-neighbour at these ratios. Alpha is
 * averaged with the colour, which antialiases the body's outline for free —
 * the transparent pixels outside it still carry the body's colour, so the edge
 * fades into the body rather than into whatever was in the buffer.
 */
export function downscale(src: Bitmap, dstWidth: number, dstHeight: number): Bitmap {
  const { pixels, width, height } = src;
  if (dstWidth >= width || dstHeight >= height) return src;

  const out = Buffer.allocUnsafe(dstWidth * dstHeight * 4);
  for (let dy = 0; dy < dstHeight; dy++) {
    const y0 = Math.floor((dy * height) / dstHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * height) / dstHeight));
    for (let dx = 0; dx < dstWidth; dx++) {
      const x0 = Math.floor((dx * width) / dstWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * width) / dstWidth));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++) {
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
          i += 4;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const o = (dy * dstWidth + dx) * 4;
      out[o] = (r / n) | 0;
      out[o + 1] = (g / n) | 0;
      out[o + 2] = (b / n) | 0;
      out[o + 3] = (a / n) | 0;
    }
  }
  return { pixels: out, width: dstWidth, height: dstHeight };
}
