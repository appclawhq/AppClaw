/**
 * Kitty graphics protocol escape sequences.
 *
 * Wire format is `ESC _ G <control-data> ; <payload> ESC \`, where the payload
 * is always base64. Frames are sent by PATH (`t=f`, payload = the base64'd
 * filename) rather than by inlining the image bytes: a 180KB PNG is ~245KB of
 * base64 on every tick, and pushing that through stdout five times a second
 * competes with Ink for the same pipe.
 *
 * Nothing here positions anything. Placement is the job of the U+10EEEE
 * placeholder cells Ink renders (see placeholder.ts) — this module only hands
 * the terminal the pixels those cells refer to.
 */

const ESC = '\x1b';
const GRAPHICS_START = `${ESC}_G`;
const GRAPHICS_END = `${ESC}\\`;

export interface KittyPlacement {
  /** Stable image id, so each frame replaces the last instead of stacking. */
  id: number;
  cols: number;
  rows: number;
}

/**
 * Transmit the PNG at `filePath` and declare a VIRTUAL placement (`U=1`) of
 * `cols x rows` cells for it.
 *
 * Virtual means invisible: the terminal draws nothing, moves no cursor, and
 * just remembers that image `id` is `cols x rows` cells big — which is what the
 * placeholder cells then reference. `c`/`r` make the terminal do the scaling,
 * which is why nothing here needs an image resizer.
 *
 * The virtual placement is re-declared on every frame because re-transmitting
 * data for an existing id deletes the image AND all of its placements; a
 * transmit that did not recreate it would leave the placeholders pointing at
 * nothing. `q=2` suppresses both the OK and the error replies — they would
 * otherwise arrive on stdin and be read as keystrokes by Ink.
 */
export function kittyTransmitVirtual(filePath: string, placement: KittyPlacement): string {
  const payload = Buffer.from(filePath, 'utf-8').toString('base64');
  const control = [
    'a=T', // transmit and create the placement...
    'U=1', // ...but a virtual one: nothing is drawn at the cursor
    'f=100', // payload is a PNG
    't=f', // ...referenced by file path
    `i=${placement.id}`,
    `c=${placement.cols}`,
    `r=${placement.rows}`,
    'q=2',
  ].join(',');
  return `${GRAPHICS_START}${control};${payload}${GRAPHICS_END}`;
}

/**
 * Forget the image entirely. Without this the terminal holds the last frame's
 * pixels for the rest of the session, and any stray placeholder cell left on
 * screen would still render it.
 */
export function kittyDeleteImage(id: number): string {
  return `${GRAPHICS_START}a=d,d=i,i=${id},q=2${GRAPHICS_END}`;
}
