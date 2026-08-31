/**
 * ANSI half-block renderer — the backend for terminals with no graphics
 * protocol.
 *
 * Each cell prints U+2580 UPPER HALF BLOCK with a 24-bit foreground (the top
 * pixel) over a 24-bit background (the bottom pixel), so one text cell carries
 * two vertical pixels. Input is an undecoded framebuffer — `adb exec-out
 * screencap` on Android, the pixel body of simctl's BMP on iOS — which is why
 * this needs no image decoder.
 */

import type { RawFrame } from './capture.js';
import { cornerRadius, insideRoundedRect, type MaskPlatform } from './corner-mask.js';

const UPPER_HALF = '▀';
const LOWER_HALF = '▄';
const RESET = '\x1b[0m';
/** Default background — lets the terminal's own colour through a masked half. */
const DEFAULT_BG = '\x1b[49m';

/**
 * Nearest-neighbour downsample of `frame` to a `cols x rows` cell grid
 * (`cols x rows*2` pixels). Returns one ready-to-write string per row,
 * each self-terminating with a colour reset so a short row can't bleed its
 * background across the rest of the line.
 *
 * Colour escapes are emitted only when the colour actually changes: large flat
 * regions (status bars, app backgrounds) are the common case, and repeating
 * both SGR sequences per cell roughly triples the bytes written per frame.
 */
export function renderHalfBlocks(
  frame: RawFrame,
  cols: number,
  rows: number,
  platform: MaskPlatform = 'android'
): string[] {
  const { width, height, pixels } = frame;
  const lines: string[] = [];
  if (cols <= 0 || rows <= 0 || width <= 0 || height <= 0) return lines;

  // Resolved once rather than branched on per pixel: iOS frames arrive BGRA
  // and there are cols*rows*2 samples per frame.
  const bgra = frame.order === 'bgra';
  const rOff = bgra ? 2 : 0;
  const bOff = bgra ? 0 : 2;
  // 0 on Android, which makes every insideRoundedRect below return true.
  const radius = cornerRadius(width, height, platform);

  // Pixel rows per cell row is 2 — the whole point of the half block.
  const pixelRows = rows * 2;

  for (let r = 0; r < rows; r++) {
    // Sample from the middle of each source block rather than its corner, so a
    // 1px line doesn't disappear purely because it landed on a boundary.
    const topY = clamp(Math.floor(((r * 2 + 0.5) * height) / pixelRows), height - 1);
    const bottomY = clamp(Math.floor(((r * 2 + 1.5) * height) / pixelRows), height - 1);
    const topRowOffset = topY * width;
    const bottomRowOffset = bottomY * width;

    let line = '';
    let lastFg = '';
    let lastBg = '';
    for (let c = 0; c < cols; c++) {
      const x = clamp(Math.floor(((c + 0.5) * width) / cols), width - 1);
      const topIn = insideRoundedRect(x, topY, width, height, radius);
      const bottomIn = insideRoundedRect(x, bottomY, width, height, radius);

      // Outside the mask entirely: emit nothing but a space on the terminal's
      // own background, which is what makes the corner read as transparent
      // rather than as a black wedge.
      if (!topIn && !bottomIn) {
        if (lastBg !== DEFAULT_BG) {
          line += DEFAULT_BG;
          lastBg = DEFAULT_BG;
        }
        line += ' ';
        continue;
      }

      const t = (topRowOffset + x) * 4;
      const b = (bottomRowOffset + x) * 4;
      // One half masked: draw the surviving half as a half block in the
      // FOREGROUND and leave the background default, so the masked half is the
      // terminal's colour. Which glyph depends on which half survives.
      const glyph = topIn && bottomIn ? UPPER_HALF : topIn ? UPPER_HALF : LOWER_HALF;
      const src = topIn ? t : b;
      const fg = `${pixels[src + rOff]};${pixels[src + 1]};${pixels[src + bOff]}`;
      const bg =
        topIn && bottomIn ? `${pixels[b + rOff]};${pixels[b + 1]};${pixels[b + bOff]}` : null;

      if (fg !== lastFg) {
        line += `\x1b[38;2;${fg}m`;
        lastFg = fg;
      }
      if (bg === null) {
        if (lastBg !== DEFAULT_BG) {
          line += DEFAULT_BG;
          lastBg = DEFAULT_BG;
        }
      } else if (bg !== lastBg) {
        line += `\x1b[48;2;${bg}m`;
        lastBg = bg;
      }
      line += glyph;
    }
    lines.push(line + RESET);
  }
  return lines;
}

function clamp(value: number, max: number): number {
  return value < 0 ? 0 : value > max ? max : value;
}
