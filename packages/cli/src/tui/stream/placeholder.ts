/**
 * Kitty Unicode placeholders — the encoding that lets Ink, not us, decide where
 * a graphics-protocol image lands.
 *
 * The alternative is to write the image at absolute terminal coordinates from
 * outside React, which loses twice over: Ink is mounted with `patchConsole`, so
 * any console line above the frame shifts every one of those coordinates; and
 * Ink blanks the image's cells on every repaint, so the picture has to be
 * restored after each keystroke — an erase-then-redraw that reads as flicker.
 *
 * With placeholders the image is bound to TEXT: a cell holding U+10EEEE with
 * the image id in its foreground colour is drawn by the terminal as the
 * corresponding cell of the image. Ink emits those cells as ordinary component
 * output, so Ink positions the picture and every repaint re-draws it.
 */

/**
 * The placeholder character. A cell containing it renders as one cell of the
 * image identified by the cell's foreground colour.
 */
export const PLACEHOLDER_CHAR = String.fromCodePoint(0x10eeee);

/**
 * Ordered diacritic table: entry N encodes the number N.
 *
 * Verbatim first 256 entries of kitty's `rowcolumn-diacritics.txt`
 * (https://sw.kovidgoyal.net/kitty/graphics-protocol/ → "Unicode placeholders";
 * the file is generated from UnicodeData.txt 6.0.0, combining class 230). 256 is
 * far more than the rows or columns any terminal panel can have, so the table is
 * truncated there rather than carrying all 297 entries.
 */
export const ROWCOLUMN_DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7, 0x06d8,
  0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e4, 0x06e7, 0x06e8, 0x06eb,
  0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee, 0x07ef, 0x07f0, 0x07f1, 0x07f3,
  0x0816, 0x0817, 0x0818, 0x0819, 0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c, 0x082d, 0x0951, 0x0953, 0x0954,
  0x0f82, 0x0f83, 0x0f86, 0x0f87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75, 0x1a76,
  0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e, 0x1b6f, 0x1b70, 0x1b71,
  0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4,
  0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5,
  0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb, 0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1,
  0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe, 0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7,
  0x20db, 0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2,
  0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9, 0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee,
  0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4, 0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa,
  0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1,
  0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5,
];

/** Largest row index `placeholderRow` can encode. */
export const MAX_PLACEHOLDER_INDEX = ROWCOLUMN_DIACRITICS.length - 1;

/** The diacritic that encodes `index`, as a string. */
export function diacritic(index: number): string {
  const codePoint = ROWCOLUMN_DIACRITICS[index];
  if (codePoint === undefined) {
    throw new RangeError(`No row/column diacritic for index ${index}`);
  }
  return String.fromCodePoint(codePoint);
}

/**
 * One row of an image, as `cols` placeholder cells.
 *
 * Only the first cell carries diacritics (its row, then column 0). The protocol
 * lets the rest inherit: a placeholder with no diacritics takes its row and its
 * image id from the cell on its left and adds one to that cell's column — which
 * holds as long as the whole run shares one foreground colour, and it does,
 * because a single <Text> paints it.
 */
export function placeholderRow(row: number, cols: number): string {
  if (cols <= 0) return '';
  return PLACEHOLDER_CHAR + diacritic(row) + diacritic(0) + PLACEHOLDER_CHAR.repeat(cols - 1);
}

/**
 * The image id as a hex colour, for Ink's `color` prop.
 *
 * The terminal reads the id out of the cell's foreground colour, so the id has
 * to survive the trip through Ink and chalk as 24-bit RGB — which caps usable
 * ids at 0xFFFFFF and needs a truecolor-capable terminal (chalk downgrading to
 * 256 colours would hand the terminal a different number).
 */
export function imageIdColor(id: number): string {
  if (!Number.isInteger(id) || id <= 0 || id > 0xffffff) {
    throw new RangeError(`Image id ${id} does not fit a 24-bit foreground colour`);
  }
  return `#${id.toString(16).padStart(6, '0')}`;
}
