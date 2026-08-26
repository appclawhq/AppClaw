/**
 * ANSI half-block renderer — the backend for terminals with no graphics
 * protocol.
 *
 * Each cell prints U+2580 UPPER HALF BLOCK with a 24-bit foreground (the top
 * pixel) over a 24-bit background (the bottom pixel), so one text cell carries
 * two vertical pixels. Input is the raw RGBA framebuffer from
 * `adb exec-out screencap`, which is why this needs no PNG decoder.
 */

import type { RawFrame } from './capture.js';

const HALF_BLOCK = '▀';
const RESET = '\x1b[0m';

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
export function renderHalfBlocks(frame: RawFrame, cols: number, rows: number): string[] {
  const { width, height, pixels } = frame;
  const lines: string[] = [];
  if (cols <= 0 || rows <= 0 || width <= 0 || height <= 0) return lines;

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
      const t = (topRowOffset + x) * 4;
      const b = (bottomRowOffset + x) * 4;
      const fg = `${pixels[t]};${pixels[t + 1]};${pixels[t + 2]}`;
      const bg = `${pixels[b]};${pixels[b + 1]};${pixels[b + 2]}`;
      if (fg !== lastFg) {
        line += `\x1b[38;2;${fg}m`;
        lastFg = fg;
      }
      if (bg !== lastBg) {
        line += `\x1b[48;2;${bg}m`;
        lastBg = bg;
      }
      line += HALF_BLOCK;
    }
    lines.push(line + RESET);
  }
  return lines;
}

function clamp(value: number, max: number): number {
  return value < 0 ? 0 : value > max ? max : value;
}
