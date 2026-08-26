import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { COLORS } from '../../ui/ink/theme.js';
import { OrbitalSpinner } from '../../ui/ink/components/OrbitalSpinner.js';
import { highlight, type Language } from '../highlight.js';

export interface OutputDialogProps {
  title: string;
  subtitle?: string;
  lines: string[];
  running: boolean;
  status?: { color: string; text: string };
  /** Colour for every body line; omit for text that already carries its own ANSI. */
  tint?: string;
  /** Syntax-highlight the body; takes precedence over `tint`. */
  language?: Language;
  onClose: () => void;
}

/** SGR escapes carry no width, so they must come off before measuring. */
const SGR = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

/** Terminal rows a line occupies once wrapped into `width` columns. */
function rowsFor(line: string, width: number): number {
  return Math.max(1, Math.ceil(line.replace(SGR, '').length / width));
}

/**
 * Break one captured line into the terminal rows it will occupy, indenting
 * every continuation two columns past where the line itself started.
 *
 * Wrapping is done here rather than left to Ink for two reasons: a hanging
 * indent needs the first row and the rest to have different widths, which
 * flexbox cannot express; and pre-wrapping keeps one array entry equal to one
 * terminal row, so the viewport arithmetic below stays a plain slice.
 *
 * `wrap-ansi` rather than a hand-rolled split because these lines carry theme
 * colour — cutting a string mid-escape corrupts the sequence, and the colour
 * active at a break has to be reopened on the next row.
 */
function wrapWithHangingIndent(line: string, width: number): string[] {
  const indent = /^ */.exec(line)?.[0].length ?? 0;
  const body = line.slice(indent);
  if (body === '') return [line];

  // Never let the indent eat the line: a deeply indented line still needs
  // usable columns for its text.
  const hang = Math.min(indent + 2, Math.max(0, width - 8));
  const inner = Math.max(1, width - hang);

  // hard: break words with nowhere to wrap (a long path, a run of dashes)
  // instead of letting them overflow the box. trim (the default) drops the
  // space a break lands on, so continuations line up at exactly `hang` rather
  // than one column further whenever the wrap happened to fall after a space.
  const rows = wrapAnsi(body, inner, { hard: true }).split('\n');
  return rows.map((row, i) => ' '.repeat(i === 0 ? indent : hang) + row);
}

/**
 * Rows the dialog spends on everything except the scrolling body: the box
 * border(2), the title(1), the body's marginTop(1), and the footer's
 * marginTop(1) + line(1).
 *
 * Counted from the actual content rather than assumed, because the variable
 * parts really do vary: /export's status is two lines ("Saved to …" then
 * "Run: …") where doctor's is one, and a fixed estimate made the box taller
 * than the terminal — which clipped its bottom border off the screen.
 */
function chromeRows(hasSubtitle: boolean, statusLines: number): number {
  const border = 2;
  const paddingY = 2;
  const title = 1;
  const subtitle = hasSubtitle ? 1 : 0;
  const bodyMargin = 1;
  const status = statusLines > 0 ? 1 + statusLines : 0;
  const footer = 1 + 1; // its marginTop plus the line itself
  return border + paddingY + title + subtitle + bodyMargin + status + footer;
}

/**
 * Scrollable modal for output the transcript pane can't hold — doctor's report
 * and the generated YAML/spec bodies. Two reasons it exists rather than
 * logging into the transcript: that pane is only a few rows tall (a file
 * dumped there is truncated and buries the step log), and `console.log`
 * output lands above the frame, off-screen under a full-height layout.
 *
 * Rendered in place of the active screen, so the screen underneath unmounts
 * and its useInput handlers stop competing for the same keystrokes.
 */
export function OutputDialog({
  title,
  subtitle,
  lines,
  running,
  status,
  tint,
  language,
  onClose,
}: OutputDialogProps) {
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;
  const columns = stdout.columns || 80;
  const [offset, setOffset] = useState(0);

  const width = Math.min(columns - 6, 100);
  // Usable text width inside the box: its border(2) plus paddingX={2} a side.
  const contentWidth = Math.max(1, width - 6);
  // A long status (an absolute export path) wraps inside the box, and every
  // wrapped line is a row the body cannot also have.
  const statusLines = status
    ? status.text.split('\n').reduce((n, line) => n + rowsFor(line, contentWidth), 0)
    : 0;
  const viewport = Math.max(3, rows - chromeRows(Boolean(subtitle), statusLines));

  // Body lines are wrapped, not truncated: doctor's config summary and absolute
  // export paths run past the box, and an ellipsis there hides the very detail
  // the dialog exists to show. Wrapping happens here so that one entry in
  // `displayLines` is exactly one terminal row — which is what lets the
  // viewport below stay a plain slice and the box close where it promises to.
  const displayLines = useMemo(
    () => lines.flatMap((line) => wrapWithHangingIndent(line, contentWidth)),
    [lines, contentWidth]
  );

  // Highlight the whole body, not just the visible slice: block-comment state
  // carries across lines, so colouring a window in isolation would mis-colour
  // any body scrolled into from the middle of a comment.
  const highlighted = useMemo(
    () => (language ? highlight(displayLines, language) : null),
    [displayLines, language]
  );

  const maxOffset = Math.max(0, displayLines.length - viewport);
  const clamped = Math.min(offset, maxOffset);
  const visible = displayLines.slice(clamped, clamped + viewport);

  useInput((input, key) => {
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
    else if (key.pageUp) setOffset((o) => Math.max(0, o - viewport));
    else if (key.pageDown) setOffset((o) => Math.min(maxOffset, o + viewport));
    else if (key.escape || input === 'q' || key.return) onClose();
  });

  return (
    <Box height={rows} justifyContent="center" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={2}
        paddingY={1}
        width={width}
      >
        <Text color={COLORS.brand} bold>
          {title}
        </Text>
        {subtitle ? <Text color={COLORS.dimmed}>{subtitle}</Text> : null}

        {running ? (
          <Box marginTop={1}>
            <OrbitalSpinner />
            <Text color={COLORS.white}> Working…</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {visible.length === 0 ? (
              <Text color={COLORS.dimmed}>(no output)</Text>
            ) : (
              visible.map((line, i) => {
                const segments = highlighted?.[clamped + i];
                if (!segments || segments.length === 0) {
                  return (
                    <Text key={clamped + i} color={tint}>
                      {line || ' '}
                    </Text>
                  );
                }
                return (
                  <Text key={clamped + i}>
                    {segments.map((seg, j) => (
                      <Text key={j} color={seg.color} bold={seg.bold}>
                        {seg.text}
                      </Text>
                    ))}
                  </Text>
                );
              })
            )}
          </Box>
        )}

        {status ? (
          <Box marginTop={1}>
            <Text color={status.color}>{status.text}</Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          <Text color={COLORS.dimmed}>
            {maxOffset > 0
              ? `↑↓ scroll (${clamped + 1}-${clamped + visible.length}/${displayLines.length}) · `
              : ''}
            esc close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
