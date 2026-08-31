import React from 'react';
import { Box, Text } from 'ink';
import { PromptInput } from './PromptInput.js';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import { matchCommands } from '../commands.js';
import { inputLineCount } from '../stream/layout.js';

export interface CommandPaletteProps {
  /** Cell width of the column — computed by layout.ts so the stream panel beside it lands where the painter expects. */
  width: number;
  /** How many commands to list — shrinks on short terminals so the frame still fits. */
  maxCommands: number;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
  /** Feedback for the just-submitted line (e.g. an unknown command) — shown right under the input, not just in the transcript below. */
  error?: string | null;
  /** Live progress text while disabled (from core's spinner hooks). */
  busyText?: string;
  /**
   * Whether the prompt owns the keyboard. When false the input stops consuming
   * keys entirely (ink-text-input's own `focus` prop), which is what lets the
   * transcript use the bare arrow keys without a modifier.
   */
  focused: boolean;
  /** What a plain line will do here — the prompt is the only place that says so. */
  placeholder: string;
  /**
   * Whether the standing command list is shown above the prompt. False in goal
   * mode until the line starts with `/`: there a plain line is a goal, so the
   * list is not a filter for anything the user is typing.
   */
  listVisible: boolean;
  /**
   * Lines the prompt may wrap to before its text is clipped. Comes from the
   * screen rather than from `maxCommands`, because with the list hidden the
   * rows have to be borrowed from the transcript instead.
   */
  maxInputLines: number;
}

/**
 * Left-column panel from the wireframe: a bordered "Command palette" list
 * (filtered live as the user types a leading "/") sitting above the
 * instruction input; plain text runs one deterministic step and records it.
 */
/**
 * The cap on the visible command list (MAX_VISIBLE_COMMANDS) lives in
 * stream/layout.ts: it decides this column's height, which is the floor for
 * the whole two-column row, which is where the stream panel's picture starts.
 */
/** Width the command name is padded to before its summary. `/stream-close` is the longest. */
const NAME_COLUMN_WIDTH = 15;

export function CommandPalette({
  width,
  maxCommands,
  query,
  onQueryChange,
  onSubmit,
  disabled,
  error,
  busyText,
  focused,
  placeholder,
  listVisible,
  maxInputLines,
}: CommandPaletteProps) {
  /**
   * A long instruction wraps the input box, and `ink-text-input` has no
   * truncate option — clipping it would leave you typing blind past the first
   * line. Something above gives up a row for every extra line the input takes
   * — the command list while it is showing, the transcript while it is not —
   * so the column's total height stays what the layout budgeted. Past
   * `maxInputLines` the input is clipped instead, because a genuinely
   * pathological line must not be allowed to grow the column and corrupt the
   * frame.
   */
  const inputLines = inputLineCount(query, width, maxInputLines);
  const commandBudget = Math.max(1, maxCommands - (inputLines - 1));

  const matched = query.trim().startsWith('/') ? matchCommands(query) : matchCommands('/');
  const commands = matched.slice(0, commandBudget);
  const hidden = matched.length - commands.length;

  return (
    // No marginRight — the parent column owns the gutter now that the
    // transcript shares this column and must line up with the palette.
    // marginTop is the gap below the transcript above it; the row is part of
    // the transcript's height budget either way, it just renders here now.
    <Box flexDirection="column" width={width} marginTop={1}>
      {listVisible ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={COLORS.brand}
          paddingX={1}
          flexGrow={1}
        >
          {/* Every row here truncates rather than wraps. The palette's height is
            budgeted as one row per command; a summary long enough to wrap
            silently costs two, and the extra rows push the whole left column
            past the frame — which Ink overlaps rather than clips. */}
          <Text color={COLORS.brand} bold wrap="truncate">
            Command palette
          </Text>
          <Text color={COLORS.dimmed} wrap="truncate">
            All / commands — type to filter, Enter to run
          </Text>
          {/* Exactly `commandBudget` rows plus one overflow row, always — padded
            with blanks when there is less to show. A filter that matches
            nothing would otherwise render one line where ten stood, and the
            column's height is budgeted, not measured. */}
          <Box flexDirection="column" marginTop={1} height={commandBudget + 1} overflow="hidden">
            {commands.length === 0 ? (
              <Text color={COLORS.dimmed} wrap="truncate">
                No matching commands
              </Text>
            ) : (
              commands.map((c) => (
                <Text key={c.id} wrap="truncate">
                  <Text color={COLORS.step} bold>
                    {c.name.padEnd(NAME_COLUMN_WIDTH)}
                  </Text>
                  <Text color={COLORS.dimmed}>{c.summary}</Text>
                </Text>
              ))
            )}
            {Array.from({
              length: Math.max(0, commandBudget - Math.max(commands.length, 1)),
            }).map((_, i) => (
              <Text key={`pad-${i}`}> </Text>
            ))}
            <Text color={COLORS.dimmed} wrap="truncate">
              {hidden > 0 ? `… +${hidden} more — type / to filter` : ' '}
            </Text>
          </Box>
        </Box>
      ) : null}

      {/* Above the prompt rather than below it. The input is the last thing in
          the column, so a message under it landed hard against the frame's
          bottom edge and read as though it had escaped the layout.

          Always occupies a row, blank when there's nothing to say: rendering it
          conditionally grew the column by a line the parent's height budget
          hadn't reserved, which pushed the frame past the terminal. */}
      {/* No marginTop: this row IS the gap between the list and the input when
          it's empty, and adding a margin on top of it made that gap two rows
          while every other gap in the column is one.

          Explicit width: `wrap="truncate"` truncates against the box it is in,
          and a box left to size itself grows to fit the text instead of
          clipping it — so a long message still cost extra rows. */}
      <Box width={width} paddingX={1}>
        <Text color={COLORS.yellow} wrap="truncate">
          {error || ' '}
        </Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor={focused ? COLORS.brand : COLORS.muted}
        paddingX={1}
        height={inputLines + 2}
        overflow="hidden"
      >
        <Text color={focused ? COLORS.brand : COLORS.dimmed} bold>
          {symbols.prompt}{' '}
        </Text>
        {disabled ? (
          <Text color={COLORS.dimmed} wrap="truncate">
            {busyText || 'working…'}
          </Text>
        ) : (
          <PromptInput
            focus={focused}
            showCursor={focused}
            value={query}
            onChange={onQueryChange}
            onSubmit={onSubmit}
            // Keep every caller's text short enough for the narrowest column
            // the layout allows: the input has no truncate option, so an
            // over-long placeholder wraps to a second line and costs the column
            // a row it hasn't budgeted.
            placeholder={placeholder}
          />
        )}
      </Box>
    </Box>
  );
}
