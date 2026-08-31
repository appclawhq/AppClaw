import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../../ui/ink/theme.js';

export interface StatusBarProps {
  breadcrumb: string;
  hints: string[];
  message?: string;
}

/**
 * Fixed bottom hint bar — breadcrumb + keybinding hints.
 *
 * Its height is exactly STATUS_BAR_ROWS, always: `marginTop` + border(2) +
 * the hint line + the message line. The message row is rendered even when
 * empty because MainScreen budgets the rest of the frame around this number,
 * and a bar that grew by a row whenever a status message appeared would push
 * the frame past the terminal — which Ink overlaps rather than clips.
 */
export function StatusBar({ breadcrumb, hints, message }: StatusBarProps) {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor={COLORS.muted}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        {/* The breadcrumb does not shrink: Yoga would otherwise take the row's
            overflow out of both children, and "Goa" tells you less than the
            last hint does. The hints truncate from the right instead, which is
            why callers order them by how much they matter. */}
        <Box flexShrink={0} marginRight={2}>
          <Text color={COLORS.brand} bold wrap="truncate">
            {breadcrumb}
          </Text>
        </Box>
        <Text color={COLORS.dimmed} wrap="truncate">
          {hints.join('  ·  ')}
        </Text>
      </Box>
      <Text color={COLORS.step} wrap="truncate">
        {message || ' '}
      </Text>
    </Box>
  );
}
