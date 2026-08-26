import React, { useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import { KITTY_IMAGE_ID, setStreamPanelVisible } from '../stream/frame-loop.js';
import { imageRowWidth, panelImageCols, streamCells } from '../stream/layout.js';
import { imageIdColor, MAX_PLACEHOLDER_INDEX, placeholderRow } from '../stream/placeholder.js';
import { backendLabel } from '../stream/terminal-caps.js';
import type { DeviceSummary, StreamState } from '../store.js';

export interface StreamPanelProps {
  device: DeviceSummary | null;
  stream: StreamState;
  /** Cell width of the whole panel box — computed by layout.ts, not a percentage. */
  width: number;
  /** Rows inside the border that belong to the picture. Must match layout.ts exactly. */
  imageRows: number;
}

const STATUS_LABEL: Record<StreamState['status'], string> = {
  idle: 'Not started',
  starting: 'Starting…',
  running: 'Live',
  error: 'Error',
};

const STATUS_COLOR: Record<StreamState['status'], string> = {
  idle: COLORS.dimmed,
  starting: COLORS.cyan,
  running: COLORS.green,
  error: COLORS.red,
};

/** A row that exists only to be reserved — see the body comment. */
function blank(key: string) {
  return <Text key={key}> </Text>;
}

/** Round border glyph, matching `borderStyle="round"` on the panel and the frame. */
const VERTICAL = '│';

/**
 * One row of Unicode placeholder cells, plus the chrome it is about to eat.
 *
 * Ink bills each placeholder — a surrogate pair — as two cells of its output
 * buffer while the terminal draws it as one, so this row overwrites the panel's
 * right border, the frame's, and the padding between them. Re-emitting those
 * characters here puts them back at the right *display* column; the miscounted
 * cells run off the end of the line, where trailing spaces are trimmed anyway.
 */
function placeholderLine(key: string, row: number, cols: number, areaCols: number) {
  const leftPad = Math.max(0, Math.floor((areaCols - cols) / 2));
  const rightPad = Math.max(0, areaCols - leftPad - cols);
  return (
    <Text key={key} wrap="truncate">
      {' '.repeat(leftPad)}
      {/* The terminal reads the image id out of this colour. */}
      <Text color={imageIdColor(KITTY_IMAGE_ID)}>{placeholderRow(row, cols)}</Text>
      {' '.repeat(rightPad)} <Text color={COLORS.brand}>{VERTICAL}</Text>{' '}
      <Text color={COLORS.brand}>{VERTICAL}</Text>
    </Text>
  );
}

/**
 * Exactly `imageRows` rows, always.
 *
 * For kitty those rows carry the placeholder cells the terminal turns into the
 * device screen; for half-blocks they carry the frame as text. Either way the
 * count is fixed, which keeps the panel's height from changing with the aspect
 * ratio of the fitted image.
 */
function imageBody(
  stream: StreamState,
  imageRows: number,
  areaCols: number,
  cells: { cols: number; rows: number } | null
): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  const frame = stream.frameLines ?? [];

  if (cells) {
    const above = Math.max(0, Math.floor((imageRows - cells.rows) / 2));
    for (let i = 0; i < above; i++) rows.push(blank(`pad-${i}`));
    for (let r = 0; r < cells.rows; r++) {
      rows.push(placeholderLine(`img-${r}`, r, cells.cols, areaCols));
    }
  } else if (frame.length > 0) {
    const above = Math.max(0, Math.floor((imageRows - frame.length) / 2));
    for (let i = 0; i < above; i++) rows.push(blank(`pad-${i}`));
    frame.slice(0, imageRows - above).forEach((line, i) => {
      // truncate rather than wrap: a row wider than the panel would otherwise
      // reflow onto the next one and push the whole picture down.
      rows.push(
        <Text key={`frame-${i}`} wrap="truncate">
          {line}
        </Text>
      );
    });
  } else {
    const message =
      stream.status === 'error' && stream.error
        ? `${symbols.cross} ${stream.error}`
        : stream.status === 'starting'
          ? 'Waiting for the first frame…'
          : '/stream mirrors the screen here';
    const above = Math.max(0, Math.floor((imageRows - 1) / 2));
    for (let i = 0; i < above; i++) rows.push(blank(`pad-${i}`));
    rows.push(
      <Text
        key="message"
        wrap="truncate"
        color={stream.status === 'error' ? COLORS.red : COLORS.dimmed}
      >
        {message}
      </Text>
    );
  }

  while (rows.length < imageRows) rows.push(blank(`fill-${rows.length}`));
  return rows.slice(0, imageRows);
}

/**
 * Right-hand column from the wireframe: two lines of status over the live
 * device screen, sitting beside the command palette so the input stays usable
 * while the picture updates.
 */
export function StreamPanel({ device, stream, width, imageRows }: StreamPanelProps) {
  // TuiApp renders dialogs and other screens INSTEAD of MainScreen, so this
  // panel — and with it every placeholder cell the picture is drawn into — can
  // disappear while the loop is still running. Tell the loop, so it stops
  // capturing frames nothing will render.
  useEffect(() => {
    setStreamPanelVisible(true);
    return () => setStreamPanelVisible(false);
  }, []);

  const { stdout } = useStdout();
  const termCols = stdout.columns || 80;
  const termRows = stdout.rows || 24;
  const areaCols = panelImageCols(termCols);
  // The frame loop sizes the transmitted image with the same call on the same
  // numbers, so the cell box and the placeholder grid always agree.
  const fitted = stream.resolution
    ? streamCells(termCols, termRows, stream.resolution.width, stream.resolution.height)
    : null;
  // Beyond the diacritic table a row cannot be addressed at all; no terminal is
  // this tall, but a clamp beats throwing out of a render.
  const cells =
    fitted && stream.status === 'running' && stream.backend === 'kitty'
      ? { cols: fitted.cols, rows: Math.min(fitted.rows, MAX_PLACEHOLDER_INDEX + 1) }
      : null;

  const renderer = stream.backend ? backendLabel(stream.backend) : null;
  const resolution = stream.resolution
    ? `${stream.resolution.width}x${stream.resolution.height}`
    : null;
  // One line, built by parts — the row count above the picture is fixed at
  // PANEL_STATUS_ROWS, so nothing here may ever become two lines.
  const detail =
    [device ? device.name : '(no device)', resolution, renderer]
      .filter(Boolean)
      .join(` ${symbols.dot} `) || '(no device)';

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={COLORS.brand}
      paddingX={1}
    >
      {/* Exactly PANEL_STATUS_ROWS rows, unconditionally and never wrapping:
          the painter's first image row is derived from that constant, so an
          extra (or conditional) line here shifts the picture off its hole. */}
      <Text wrap="truncate">
        <Text color={COLORS.brand} bold>
          Device stream{'  '}
        </Text>
        <Text color={STATUS_COLOR[stream.status]}>
          {symbols.circle} {STATUS_LABEL[stream.status]}
        </Text>
      </Text>
      <Text color={COLORS.dimmed} wrap="truncate">
        {detail}
      </Text>

      {/* Wider than the panel on purpose while placeholders are up: the rows
          have to reach the terminal's right edge to redraw the chrome their own
          miscounted cells overwrite. flexShrink={0} stops Yoga from pulling it
          back inside the panel. */}
      <Box
        flexDirection="column"
        flexShrink={0}
        width={cells ? imageRowWidth(termCols) : undefined}
      >
        {imageBody(stream, imageRows, areaCols, cells)}
      </Box>
    </Box>
  );
}
