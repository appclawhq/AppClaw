/**
 * Geometry for the two-column row, shared by MainScreen and GoalRunScreen.
 *
 * Every constant below mirrors a prop somewhere in TuiApp / MainScreen /
 * GoalRunScreen / CommandPalette / StreamPanel, and they live together because
 * several of them have to add up: the two columns must fill the frame exactly,
 * and the panel's rows must be the ones the transcript budgeted around.
 *
 * Both screens use the SAME split and the same chrome height, and that is a
 * requirement rather than a preference: the frame loop sizes each transmitted
 * image with `streamCells` and cannot know which screen is mounted, so a screen
 * that laid the panel out differently would hand the terminal an image that no
 * longer matches the placeholder grid drawn for it.
 *
 * Note what is NOT here any more: absolute terminal coordinates. The device
 * picture is placed by the Unicode placeholder cells <StreamPanel> renders, so
 * Ink positions it — which is what makes it immune to `patchConsole` output
 * pushing the frame down the screen.
 */

/** TuiApp wraps every screen in `paddingX={1}`, so column 1 is never content. */
export const APP_PADDING_COLS = 1;
/** MainScreen's outer frame box: `borderStyle="round"` — one cell on each side. */
export const FRAME_BORDER = 1;
/** ...plus its `paddingX={1}`. */
export const FRAME_PADDING_COLS = 1;
/** <Header>: title line + subtitle line + `marginBottom={1}`. */
export const HEADER_ROWS = 3;
/** CommandPalette's `marginRight={1}` — the gutter between the two columns. */
export const COLUMN_GAP_COLS = 1;
/** StreamPanel's own `borderStyle="round"`. */
export const PANEL_BORDER = 1;
/** ...plus its `paddingX={1}`. */
export const PANEL_PADDING_COLS = 1;
/** Text rows StreamPanel spends above the picture (status + device line). */
export const PANEL_STATUS_ROWS = 2;

/**
 * Longest command list the palette shows before folding the rest into a
 * "+N more" line. Lives here rather than in the component because the palette
 * column's height is the floor for the whole row's height, and therefore part
 * of this module's arithmetic.
 */
export const MAX_VISIBLE_COMMANDS = 10;

/**
 * Rows the palette spends no matter how many commands it lists.
 * List box: border(2) + title(1) + subtitle(1) + marginTop(1) + the "+N more"
 * overflow line(1). Feedback row: 1 — always rendered, blank when idle, and it
 * doubles as the single-row gap before the input. Input box: border(2) + 1 line.
 */
const PALETTE_FIXED_ROWS = 2 + 1 + 1 + 1 + 1 + 1 + (2 + 1);

/**
 * Rows the palette spends with its list hidden: the feedback row and the input
 * box, nothing else.
 *
 * Goal mode has no use for a standing list of commands — a plain line is a
 * goal, so the list is answering a question nobody asked while occupying half
 * the column. It reappears the moment the line starts with `/`, which is the
 * only time it is a filter rather than wallpaper.
 */
const PALETTE_COLLAPSED_ROWS = 1 + (2 + 1);

/**
 * <StatusBar>: its `marginTop` + border(2) + the hint line + the message line.
 * The message row is always rendered (blank when idle) so this stays constant —
 * it was budgeted at 3 while rendering 4, and that single missing row made the
 * whole frame over-tall, which Ink resolves by overlapping rows rather than
 * clipping them (two commands printed on one line, box borders colliding).
 */
export const STATUS_BAR_ROWS = 1 + 2 + 1 + 1;

/**
 * Rows spent outside the two columns entirely: frame border(2) + header +
 * StatusBar. Everything else belongs to one of the two columns.
 */
const CHROME_ROWS = 2 + HEADER_ROWS + STATUS_BAR_ROWS;
/** The transcript box's own marginTop(1) + border(2) + title(1). */
export const TRANSCRIPT_CHROME_ROWS = 4;
/** A transcript shorter than this stops being useful. */
const MIN_TRANSCRIPT_ROWS = 4;
/** Below this the two-column layout is nonsense anyway; clamp so the maths stays positive. */
const MIN_CONTENT_COLS = 20;
/**
 * The palette's share of the content width — the rest goes to the picture.
 *
 * Close to half, and that costs the stream nothing: `fitCells` derives the
 * picture's width from its height and the device aspect ratio, so for a tall
 * phone the rows are the binding constraint and the spare columns on the right
 * would only have been blank. Giving them to the left column is what keeps
 * command summaries readable instead of truncated.
 */
const LEFT_COLUMN_SHARE = 0.45;
/** Narrow enough and the command list becomes unreadable, so the split stops here. */
const MIN_PALETTE_COLS = 34;

/**
 * Rows available to the two columns.
 *
 * The layout is two full-height columns, not a row of panels above a
 * full-width transcript: the palette and transcript stack on the left, and the
 * stream panel owns the whole right column. That is what lets the picture use
 * the full height of the frame — the device screen is tall and thin, so height
 * is the only dimension that makes it bigger.
 */
export function contentRows(termRows: number): number {
  return Math.max(1, termRows - CHROME_ROWS);
}

/**
 * How many commands the palette can list without pushing the frame past the
 * terminal. A fixed count made the chrome a fixed 33 rows, so anything shorter
 * than ~36 rows rendered a frame taller than the screen — which Ink does not
 * clip, it overlaps, producing two rows of text on one line.
 */
export function visibleCommandCount(termRows: number): number {
  const spare =
    contentRows(termRows) - MIN_TRANSCRIPT_ROWS - TRANSCRIPT_CHROME_ROWS - PALETTE_FIXED_ROWS;
  return Math.max(1, Math.min(MAX_VISIBLE_COMMANDS, spare));
}

/**
 * The palette's height at the top of the left column.
 *
 * `listVisible` is the mode's doing, not the terminal's: with the list hidden
 * the palette is just a prompt, and the rows it gives up go to the transcript
 * rather than to the frame, so the two columns still add up.
 */
export function paletteRows(termRows: number, listVisible = true): number {
  return listVisible ? PALETTE_FIXED_ROWS + visibleCommandCount(termRows) : PALETTE_COLLAPSED_ROWS;
}

/**
 * Shortest terminal the layout still fits in: chrome + the smallest useful
 * palette + the smallest useful transcript. Below this MainScreen shows a "too
 * small" notice instead of a frame that would render corrupted.
 */
export const MIN_MAIN_ROWS =
  CHROME_ROWS + PALETTE_FIXED_ROWS + 1 + TRANSCRIPT_CHROME_ROWS + MIN_TRANSCRIPT_ROWS;

/**
 * Rows the goal-run pane gets: the whole left column, since it has no palette
 * under it. Same `contentRows` the stream panel is sized from, which is what
 * lets the run screen and the main screen show the picture at identical size —
 * the frame loop asks `streamCells` for a cell box without knowing, or being
 * able to know, which screen is currently mounted.
 */
export function runPaneRows(termRows: number): number {
  return contentRows(termRows);
}

/**
 * Shortest terminal the run screen fits in. Lower than MIN_MAIN_ROWS: there is
 * no command palette here, only the chrome plus a pane tall enough for a plan
 * checklist above the pinned footer.
 */
export const MIN_RUN_ROWS = CHROME_ROWS + 8;

/**
 * Scrolling rows in the transcript — whatever the palette above it leaves.
 * Unlike before, this does not shrink when a stream starts: the transcript is
 * beside the picture now, not above it, so the two no longer compete for rows.
 */
export function transcriptRows(termRows: number, listVisible = true): number {
  return Math.max(
    MIN_TRANSCRIPT_ROWS,
    contentRows(termRows) - paletteRows(termRows, listVisible) - TRANSCRIPT_CHROME_ROWS
  );
}

/**
 * Lines the prompt may grow to before its text is clipped instead.
 *
 * A long line has to wrap — `ink-text-input` has no truncate option, so
 * clipping it means typing blind past the first line, and goal mode is where
 * the longest lines get typed. The rows have to come from somewhere: from the
 * command list while it is showing, and from the transcript while it is not,
 * down to the point where the transcript stops being worth reading.
 */
export function inputLineBudget(termRows: number, listVisible = true): number {
  return listVisible
    ? visibleCommandCount(termRows)
    : Math.max(1, transcriptRows(termRows, false) - MIN_TRANSCRIPT_ROWS + 1);
}

/**
 * Lines `query` occupies in a `width`-wide column, capped at `max`.
 *
 * Shared so the palette and the screen that budgets around it cannot disagree:
 * the screen shrinks the transcript by exactly the rows the prompt takes.
 */
export function inputLineCount(query: string, width: number, max: number): number {
  const inner = Math.max(1, width - 2 /* border */ - 2 /* paddingX */ - 2 /* "\u276f " */);
  const wanted = Math.max(1, Math.ceil(Math.max(query.length, 1) / inner));
  return Math.min(wanted, Math.max(1, max));
}

/** Rows inside StreamPanel's border that belong to the picture — the full column. */
export function panelImageRows(termRows: number): number {
  return Math.max(1, contentRows(termRows) - 2 * PANEL_BORDER - PANEL_STATUS_ROWS);
}

/**
 * Width of each column. Explicit integers rather than Ink's `width="50%"`:
 * a percentage is resolved by the layout engine's own rounding, which the
 * painter cannot reproduce, and two 50% columns plus a 1-cell gutter overflow
 * and get shrunk by an amount that depends on the terminal width.
 */
export function columnWidths(termCols: number): { left: number; right: number } {
  const content = Math.max(
    MIN_CONTENT_COLS,
    termCols - 2 * (APP_PADDING_COLS + FRAME_BORDER + FRAME_PADDING_COLS)
  );
  // A third to the palette and transcript, two thirds to the picture. The left
  // column holds text that reads fine narrow; the right holds a phone screen
  // whose width follows its height, so extra columns there are not wasted.
  const left = Math.max(
    MIN_PALETTE_COLS,
    Math.floor((content - COLUMN_GAP_COLS) * LEFT_COLUMN_SHARE)
  );
  return { left, right: Math.max(1, content - COLUMN_GAP_COLS - left) };
}

/** Cells inside StreamPanel's border and padding that the picture may use. */
export function panelImageCols(termCols: number): number {
  const { right } = columnWidths(termCols);
  return Math.max(1, right - 2 * (PANEL_BORDER + PANEL_PADDING_COLS));
}

/**
 * Chrome between the panel's content and the right edge of the terminal:
 * the panel's own padding and border, the frame's, and the app's padding.
 *
 * A row of placeholder cells has to redraw all of it. Ink's output buffer bills
 * a placeholder (a surrogate pair) as two cells while the terminal draws it as
 * one, so the write runs past the panel and overwrites whatever chrome sits to
 * its right. Since the panel is the last column, the overspill lands off the
 * end of the row — harmless — as long as the row itself carries the chrome it
 * clobbered.
 */
export const IMAGE_ROW_TRAILING_COLS =
  PANEL_PADDING_COLS + PANEL_BORDER + FRAME_PADDING_COLS + FRAME_BORDER + APP_PADDING_COLS;

/** Display width of one placeholder row: the panel's content plus that chrome. */
export function imageRowWidth(termCols: number): number {
  return panelImageCols(termCols) + IMAGE_ROW_TRAILING_COLS;
}

/**
 * Largest `cols x rows` cell box inside `maxCols x maxRows` that preserves the
 * device's aspect ratio. Terminal cells are roughly twice as tall as they are
 * wide, so a cell box matching `deviceW:deviceH` needs
 * `cols = rows * (deviceW/deviceH) * 2`.
 */
export function fitCells(
  deviceWidth: number,
  deviceHeight: number,
  maxCols: number,
  maxRows: number
): { cols: number; rows: number } {
  if (deviceWidth <= 0 || deviceHeight <= 0) {
    return { cols: Math.max(1, maxCols), rows: Math.max(1, maxRows) };
  }
  const aspect = deviceWidth / deviceHeight;
  let rows = Math.max(1, maxRows);
  let cols = Math.round(rows * aspect * 2);
  if (cols > maxCols) {
    cols = Math.max(1, maxCols);
    rows = Math.round(cols / (aspect * 2));
  }
  return {
    cols: Math.max(1, Math.min(maxCols, cols)),
    rows: Math.max(1, Math.min(maxRows, rows)),
  };
}

/**
 * The cell box one frame occupies. Both sides of the stream call this — the
 * loop to tell the terminal how big the image is, <StreamPanel> to know how
 * many placeholder cells to render — so they cannot disagree.
 */
export function streamCells(
  termCols: number,
  termRows: number,
  deviceWidth: number,
  deviceHeight: number
): { cols: number; rows: number } {
  return fitCells(deviceWidth, deviceHeight, panelImageCols(termCols), panelImageRows(termRows));
}
