/**
 * In-terminal device stream — the pure pieces behind `/stream`.
 *
 * Everything covered here is deliberately free of adb, React and stdout, which
 * is why the capture/encode logic lives in its own modules rather than inside
 * the Ink component.
 */
import { describe, test, expect } from 'vitest';
import { parseRawScreencap } from '@appclaw/cli/tui/stream/capture';
import { renderHalfBlocks } from '@appclaw/cli/tui/stream/halfblock';
import { kittyTransmitVirtual, kittyDeleteImage } from '@appclaw/cli/tui/stream/kitty';
import {
  APP_PADDING_COLS,
  COLUMN_GAP_COLS,
  FRAME_BORDER,
  FRAME_PADDING_COLS,
  IMAGE_ROW_TRAILING_COLS,
  PANEL_BORDER,
  PANEL_PADDING_COLS,
  PANEL_STATUS_ROWS,
  columnWidths,
  contentRows,
  fitCells,
  imageRowWidth,
  paletteRows,
  panelImageCols,
  panelImageRows,
  streamCells,
  transcriptRows,
  TRANSCRIPT_CHROME_ROWS,
} from '@appclaw/cli/tui/stream/layout';
import {
  diacritic,
  imageIdColor,
  MAX_PLACEHOLDER_INDEX,
  PLACEHOLDER_CHAR,
  placeholderRow,
  ROWCOLUMN_DIACRITICS,
} from '@appclaw/cli/tui/stream/placeholder';
import { detectStreamBackend } from '@appclaw/cli/tui/stream/terminal-caps';

/** A screencap payload: little-endian w/h/format (+ optional colorspace), then RGBA. */
function framebuffer(width: number, height: number, headerSize: 12 | 16): Buffer {
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(width, 0);
  header.writeUInt32LE(height, 4);
  header.writeUInt32LE(1, 8);
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = i; // R varies per pixel so downsampling is observable
    pixels[i * 4 + 1] = 10;
    pixels[i * 4 + 2] = 20;
    pixels[i * 4 + 3] = 255;
  }
  return Buffer.concat([header, pixels]);
}

describe('parseRawScreencap', () => {
  test('reads a 12-byte header (older Android)', () => {
    const frame = parseRawScreencap(framebuffer(4, 3, 12));
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(3);
    expect(frame.pixels.length).toBe(4 * 3 * 4);
  });

  test('reads a 16-byte header (colorspace field present)', () => {
    const frame = parseRawScreencap(framebuffer(4, 3, 16));
    expect(frame.width).toBe(4);
    expect(frame.pixels.length).toBe(4 * 3 * 4);
  });

  test('rejects a payload matching neither header size instead of rendering garbage', () => {
    const bad = Buffer.concat([framebuffer(4, 3, 12), Buffer.alloc(7)]);
    expect(() => parseRawScreencap(bad)).toThrow(/Unreadable screencap framebuffer/);
  });

  test('rejects a nonsense header', () => {
    const bad = Buffer.alloc(64); // width/height both 0
    expect(() => parseRawScreencap(bad)).toThrow(/looks invalid/);
  });
});

describe('renderHalfBlocks', () => {
  test('emits one line per cell row, each ending in a colour reset', () => {
    const frame = parseRawScreencap(framebuffer(8, 8, 12));
    const lines = renderHalfBlocks(frame, 4, 3);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.endsWith('\x1b[0m')).toBe(true);
      // One upper-half-block per column — two source pixels per cell.
      expect([...line].filter((c) => c === '▀')).toHaveLength(4);
    }
  });

  test('carries 24-bit foreground and background colours', () => {
    const frame = parseRawScreencap(framebuffer(8, 8, 12));
    const [first] = renderHalfBlocks(frame, 4, 3);
    expect(first).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
    expect(first).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
  });

  test('repeats a colour escape only when the colour actually changes', () => {
    // A uniform frame should cost exactly one fg + one bg escape per row.
    const width = 4;
    const height = 4;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(width, 0);
    header.writeUInt32LE(height, 4);
    const flat = Buffer.alloc(width * height * 4, 0x40);
    const frame = parseRawScreencap(Buffer.concat([header, flat]));
    const [line] = renderHalfBlocks(frame, 4, 2);
    expect(line.match(/\x1b\[38;2;/g)).toHaveLength(1);
    expect(line.match(/\x1b\[48;2;/g)).toHaveLength(1);
  });
});

describe('kitty escape sequences', () => {
  test('transmits by path, base64-encoded, sized in cells', () => {
    const seq = kittyTransmitVirtual('/tmp/frame-0.png', { id: 7, cols: 40, rows: 50 });
    expect(seq.startsWith('\x1b_G')).toBe(true);
    expect(seq.endsWith('\x1b\\')).toBe(true);
    const [control, payload] = seq.slice(3, -2).split(';');
    expect(control).toContain('a=T');
    expect(control).toContain('f=100');
    expect(control).toContain('t=f');
    expect(control).toContain('i=7');
    expect(control).toContain('c=40');
    expect(control).toContain('r=50');
    // q=2 suppresses the terminal's reply, which would otherwise land on the
    // stdin Ink is reading in raw mode.
    expect(control).toContain('q=2');
    expect(Buffer.from(payload, 'base64').toString('utf-8')).toBe('/tmp/frame-0.png');
  });

  test('the placement is virtual, so nothing is drawn at the cursor', () => {
    // U=1 is the whole point: the image is only a prototype for the U+10EEEE
    // cells Ink renders. Without it the terminal would paint at the cursor,
    // which is exactly the absolute-coordinate painting this replaced.
    const seq = kittyTransmitVirtual('/tmp/frame-0.png', { id: 7, cols: 4, rows: 5 });
    expect(seq.slice(3, -2).split(';')[0]).toContain('U=1');
    // No cursor movement anywhere in the sequence.
    expect(seq).not.toMatch(/\x1b\[\d+;\d+H/);
  });

  test('deletes the image by id', () => {
    expect(kittyDeleteImage(7)).toBe('\x1b_Ga=d,d=i,i=7,q=2\x1b\\');
  });
});

describe('unicode placeholders', () => {
  const D = (n: number) => String.fromCodePoint(ROWCOLUMN_DIACRITICS[n]!);

  test('the placeholder is U+10EEEE', () => {
    expect(PLACEHOLDER_CHAR.codePointAt(0)).toBe(0x10eeee);
    expect([...PLACEHOLDER_CHAR]).toHaveLength(1);
  });

  test('the diacritic table starts where kitty says it does', () => {
    // From rowcolumn-diacritics.txt: 0 -> U+0305, 1 -> U+030D, 2 -> U+030E.
    expect(diacritic(0)).toBe('̅');
    expect(diacritic(1)).toBe('̍');
    expect(diacritic(2)).toBe('̎');
    expect(ROWCOLUMN_DIACRITICS).toHaveLength(256);
    expect(new Set(ROWCOLUMN_DIACRITICS).size).toBe(256);
  });

  test('a row is one diacritic-carrying cell followed by bare placeholders', () => {
    // kitty's own example: `\U10EEEE\U0305\U0305` is row 0, column 0.
    expect(placeholderRow(0, 1)).toBe(`${PLACEHOLDER_CHAR}̅̅`);
    expect(placeholderRow(3, 4)).toBe(
      `${PLACEHOLDER_CHAR}${D(3)}${D(0)}${PLACEHOLDER_CHAR.repeat(3)}`
    );
  });

  test('every row has exactly one placeholder per cell', () => {
    for (const cols of [1, 2, 17, 64]) {
      const row = placeholderRow(5, cols);
      expect([...row].filter((c) => c === PLACEHOLDER_CHAR)).toHaveLength(cols);
      // Only the leading cell is addressed; the rest inherit row and column.
      expect([...row].filter((c) => ROWCOLUMN_DIACRITICS.includes(c.codePointAt(0)!))).toHaveLength(
        2
      );
    }
    expect(placeholderRow(0, 0)).toBe('');
  });

  test('rows past the table are refused rather than silently mis-addressed', () => {
    expect(() => placeholderRow(MAX_PLACEHOLDER_INDEX, 1)).not.toThrow();
    expect(() => placeholderRow(MAX_PLACEHOLDER_INDEX + 1, 1)).toThrow(RangeError);
  });

  test('the image id round-trips through a 24-bit foreground colour', () => {
    const id = 7301;
    expect(imageIdColor(id)).toBe('#001c85');
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(imageIdColor(id))!;
    expect((parseInt(r!, 16) << 16) | (parseInt(g!, 16) << 8) | parseInt(b!, 16)).toBe(id);
    // 0 is not a valid image id, and anything past 24 bits cannot be carried.
    expect(() => imageIdColor(0)).toThrow(RangeError);
    expect(() => imageIdColor(0x1000000)).toThrow(RangeError);
  });
});

describe('layout', () => {
  test('fitCells preserves the device aspect over ~1:2 cells', () => {
    // 1080x2400 in a tall, wide area: height-bound, so cols ≈ rows * 0.45 * 2.
    const { cols, rows } = fitCells(1080, 2400, 200, 50);
    expect(rows).toBe(50);
    expect(cols).toBe(45);
  });

  test('fitCells falls back to width when the area is too narrow', () => {
    const { cols, rows } = fitCells(1080, 2400, 20, 50);
    expect(cols).toBe(20);
    expect(rows).toBeLessThanOrEqual(50);
    expect(rows).toBe(22);
  });

  test('the two columns fill the frame exactly, with one gutter cell', () => {
    const termCols = 120;
    const { left, right } = columnWidths(termCols);
    const chrome = 2 * (APP_PADDING_COLS + FRAME_BORDER + FRAME_PADDING_COLS);
    expect(left + COLUMN_GAP_COLS + right).toBe(termCols - chrome);
  });

  test('the image area is the inside of the right panel', () => {
    const { right } = columnWidths(120);
    expect(panelImageCols(120)).toBe(right - 2 * (PANEL_BORDER + PANEL_PADDING_COLS));
  });

  test('a placeholder row reaches from the panel content to the terminal edge', () => {
    // Panel content start + this width must be exactly the terminal width, or
    // the chrome the row redraws would land in the wrong column.
    const { left, right } = columnWidths(120);
    const contentStart =
      APP_PADDING_COLS +
      FRAME_BORDER +
      FRAME_PADDING_COLS +
      left +
      COLUMN_GAP_COLS +
      PANEL_BORDER +
      PANEL_PADDING_COLS;
    expect(contentStart + imageRowWidth(120)).toBe(120);
    expect(imageRowWidth(120)).toBe(panelImageCols(120) + IMAGE_ROW_TRAILING_COLS);
    expect(right).toBeGreaterThan(0);
  });

  test('streamCells fits the device into the panel, in cells only', () => {
    const cells = streamCells(120, 40, 1080, 2400);
    expect(cells).toEqual(fitCells(1080, 2400, panelImageCols(120), panelImageRows(40, true)));
    // No absolute coordinates survive: Ink positions the picture now.
    expect(Object.keys(cells).sort()).toEqual(['cols', 'rows']);
  });

  test('the picture gets the full content height, independent of the palette', () => {
    for (const termRows of [30, 40, 60]) {
      // The columns are independent now: the panel spans the whole content
      // area rather than matching the palette's height.
      expect(panelImageRows(termRows)).toBe(
        contentRows(termRows) - 2 * PANEL_BORDER - PANEL_STATUS_ROWS
      );
      expect(panelImageRows(termRows)).toBeGreaterThan(paletteRows(termRows) - PANEL_STATUS_ROWS);
    }
  });

  test('the left column fills the content height exactly', () => {
    for (const termRows of [30, 40, 60, 80]) {
      const used = paletteRows(termRows) + TRANSCRIPT_CHROME_ROWS + transcriptRows(termRows);
      // Palette + transcript must fill their column exactly, or the frame
      // over/under-runs the terminal — Ink overlaps rows rather than clipping.
      expect(used).toBe(contentRows(termRows));
    }
  });

  test('the palette column never gets so narrow the command list is unreadable', () => {
    for (const termCols of [80, 120, 200, 400]) {
      const { left, right } = columnWidths(termCols);
      expect(left).toBeGreaterThanOrEqual(34);
      // The picture takes the larger share on any reasonably wide terminal.
      if (termCols >= 120) expect(right).toBeGreaterThan(left);
    }
  });
});

describe('detectStreamBackend', () => {
  test('kitty for Ghostty, kitty, WezTerm', () => {
    expect(detectStreamBackend({ TERM_PROGRAM: 'ghostty' })).toBe('kitty');
    expect(detectStreamBackend({ KITTY_WINDOW_ID: '1' })).toBe('kitty');
    expect(detectStreamBackend({ TERM: 'xterm-kitty' })).toBe('kitty');
    expect(detectStreamBackend({ WEZTERM_EXECUTABLE: '/usr/bin/wezterm' })).toBe('kitty');
  });

  test('half-blocks for everything else', () => {
    expect(detectStreamBackend({ TERM: 'xterm-256color' })).toBe('halfblock');
    expect(detectStreamBackend({})).toBe('halfblock');
  });

  test('APPCLAW_STREAM_BACKEND overrides detection', () => {
    expect(
      detectStreamBackend({ TERM_PROGRAM: 'ghostty', APPCLAW_STREAM_BACKEND: 'halfblock' })
    ).toBe('halfblock');
  });
});
