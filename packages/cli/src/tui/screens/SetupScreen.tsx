import React, { useSyncExternalStore } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import { subscribe, getSnapshot } from '../store.js';
import { STATUS_BAR_ROWS } from '../stream/layout.js';
import type { TuiActions } from '../commands.js';
import { StatusBar } from '../components/StatusBar.js';
import { BANNER_ROWS, Wordmark } from '../components/Wordmark.js';

export interface SetupScreenProps {
  actions: TuiActions;
}

/**
 * What `appclaw` shows when the config cannot support a run.
 *
 * The old behaviour was `✗ LLM_API_KEY is required for provider "gemini".`
 * printed to the console followed by `process.exit(1)` — accurate, and a dead
 * end: it named a variable and left the user to go find the file. This screen
 * says the same thing in the shell's own language and, because the shell can
 * already write `.env`, offers to fix it right here.
 *
 * Centred in the frame like WelcomeScreen rather than sitting under a header:
 * there is exactly one thing to attend to, so the layout should not imply
 * anything else is available yet.
 */
export function SetupScreen({ actions }: SetupScreenProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  useInput((input, key) => {
    if (input === 'q' && !key.ctrl && !key.meta) {
      // No confirmation: nothing can have been recorded yet — this screen is
      // the first thing the shell shows when it appears at all.
      void actions.quit();
      return;
    }
    if (key.return) actions.goToSettings();
  });

  const issues = ui.setupIssues;

  // The banner is five rows this screen also has to fit an issue list into, so
  // it is the first thing given up on a short terminal — the message is what
  // the user is here for, the branding is not.
  const chrome = 2 + 2 + 1 + 2 + 2 + 1 + STATUS_BAR_ROWS; // frame, margins, title, hint, bar
  const issueRows = issues.reduce((n) => n + 4, 2 + 2);
  const compact = rows - chrome - issueRows < BANNER_ROWS;

  return (
    <Box flexDirection="column" height={rows}>
      <Box
        flexDirection="column"
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        borderStyle="round"
        borderColor={COLORS.yellow}
        paddingX={2}
        paddingY={1}
      >
        <Wordmark compact={compact} />
        <Box marginTop={1}>
          <Text color={COLORS.yellow} bold>
            Setup needed
          </Text>
        </Box>

        <Box
          flexDirection="column"
          marginTop={2}
          borderStyle="round"
          borderColor={COLORS.muted}
          paddingX={3}
          paddingY={1}
        >
          {issues.map((issue, i) => (
            <Box
              key={issue.key}
              flexDirection="column"
              marginBottom={i < issues.length - 1 ? 1 : 0}
            >
              {/* Red, like every other failure in the app — this is the one
                  line that says something is wrong, and it read as ordinary
                  body text in white. */}
              <Text color={COLORS.red} bold>
                {symbols.cross} {issue.title}
              </Text>
              <Text color={COLORS.dimmed}>{issue.detail}</Text>
              <Text color={COLORS.muted}>
                {issue.key} — set it in .env, or press enter to edit it here
              </Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={2}>
          <Text color={COLORS.dimmed}>
            {symbols.prompt} enter opens settings · saving writes .env and continues
          </Text>
        </Box>
      </Box>
      <StatusBar
        breadcrumb="Setup"
        hints={['enter settings', 'q quit']}
        message={ui.statusMessage}
      />
    </Box>
  );
}
