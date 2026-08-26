import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';

export interface HeaderProps {
  subtitle?: string;
}

/** Brand header reused across TUI screens — "AppClaw" plus an optional context line. */
export function Header({ subtitle }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.brand} bold>
        {symbols.diamond} AppClaw
      </Text>
      {subtitle ? <Text color={COLORS.dimmed}>{subtitle}</Text> : null}
    </Box>
  );
}
