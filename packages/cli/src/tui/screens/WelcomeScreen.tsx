import React, { useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import type { Platform } from '../store.js';
import { requestQuit, type TuiActions } from '../commands.js';
import { StatusBar } from '../components/StatusBar.js';
import { subscribe, getSnapshot } from '../store.js';

const OPTIONS: Platform[] = ['android', 'ios'];

const LABELS: Record<Platform, string> = { android: 'Android', ios: 'iOS' };

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

/** Widest banner row plus the frame's border+padding, below which we fall back to plain text. */
const BANNER_MIN_COLUMNS = 57 + 8;

export interface WelcomeScreenProps {
  actions: TuiActions;
}

/**
 * Splash screen: the wordmark and platform picker centered together inside the
 * full-screen frame. No separate top-left header here — the banner is the
 * branding, so repeating it in the corner would just be noise.
 */
export function WelcomeScreen({ actions }: WelcomeScreenProps) {
  const [index, setIndex] = useState(0);
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;
  const columns = stdout.columns || 80;
  const showBanner = columns >= BANNER_MIN_COLUMNS;

  useInput((input, key) => {
    if (input === 'q' && !key.ctrl && !key.meta) {
      void requestQuit(actions);
      return;
    }
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : OPTIONS.length - 1));
    else if (key.downArrow) setIndex((i) => (i < OPTIONS.length - 1 ? i + 1 : 0));
    else if (key.return) actions.selectPlatform(OPTIONS[index]);
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Box
        flexDirection="column"
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={2}
        paddingY={1}
      >
        {showBanner ? (
          <Box flexDirection="column" alignItems="center">
            {BANNER.map((line, i) => (
              <Text key={i} color={COLORS.brand} bold>
                {line}
              </Text>
            ))}
          </Box>
        ) : (
          <Text color={COLORS.brand} bold>
            {symbols.diamond} AppClaw
          </Text>
        )}

        <Box marginTop={1}>
          <Text color={COLORS.dimmed}>Agentic mobile automation</Text>
        </Box>

        <Box marginTop={2}>
          <Text color={COLORS.dimmed}>Select a platform</Text>
        </Box>

        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={COLORS.muted}
          paddingX={5}
          paddingY={1}
        >
          {OPTIONS.map((opt, i) => (
            // A blank row between options so the box reads as a deliberate
            // menu rather than two cramped lines.
            <Box key={opt} marginBottom={i < OPTIONS.length - 1 ? 1 : 0}>
              <Text color={i === index ? COLORS.brand : COLORS.white} bold={i === index}>
                {i === index ? `${symbols.prompt}  ` : '   '}
                {LABELS[opt].padEnd(9)}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
      <StatusBar
        breadcrumb="Welcome"
        hints={['↑↓ select', 'enter confirm', 'q quit']}
        message={ui.statusMessage}
      />
    </Box>
  );
}
