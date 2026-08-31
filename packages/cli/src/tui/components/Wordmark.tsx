import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';

/**
 * Block-letter wordmark. Terminals can't scale a font, so "bigger" has to be
 * drawn — one glyph per 5 rows of block characters.
 */
const BANNER = [
  ' █████  ██████  ██████   ██████ ██       █████  ██     ██',
  '██   ██ ██   ██ ██   ██ ██      ██      ██   ██ ██     ██',
  '███████ ██████  ██████  ██      ██      ███████ ██  █  ██',
  '██   ██ ██      ██      ██      ██      ██   ██ ██ ███ ██',
  '██   ██ ██      ██       ██████ ███████ ██   ██  ███ ███ ',
];

/** Rows the drawn banner occupies, for callers budgeting their own height. */
export const BANNER_ROWS = BANNER.length;

/** Widest banner row plus the frame's border+padding, below which we fall back to plain text. */
export const BANNER_MIN_COLUMNS = 57 + 8;

export interface WordmarkProps {
  /**
   * Extra reason to draw the small form even though the terminal is wide
   * enough — a screen with more content below than Welcome has may not have
   * five rows to spare.
   */
  compact?: boolean;
}

/**
 * The brand mark, shared by every screen that leads with it rather than with a
 * corner header. It lives here so those screens cannot drift apart: the banner
 * was a private constant in WelcomeScreen, and the second screen to want it
 * would otherwise have got a smaller, different-looking one.
 */
export function Wordmark({ compact = false }: WordmarkProps) {
  const { stdout } = useStdout();
  const columns = stdout.columns || 80;

  if (compact || columns < BANNER_MIN_COLUMNS) {
    return (
      <Text color={COLORS.brand} bold>
        {symbols.diamond} AppClaw
      </Text>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center">
      {BANNER.map((line, i) => (
        <Text key={i} color={COLORS.brand} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
}
