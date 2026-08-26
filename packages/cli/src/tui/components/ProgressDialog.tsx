import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { COLORS } from '../../ui/ink/theme.js';
import { OrbitalSpinner } from '../../ui/ink/components/OrbitalSpinner.js';

export interface ProgressDialogProps {
  title: string;
  /** Current step text, e.g. "Creating Appium session...". */
  message: string;
  /** Optional secondary line under the message. */
  detail?: string;
  /** Static hint pinned at the bottom of the dialog. */
  hint?: string;
}

/**
 * Centered modal progress box for long, multi-step work (device setup).
 *
 * Ink has no absolute positioning, so a "modal" here means this replaces the
 * screen's content while it's up — which is also what keeps core's spinner
 * output (routed in through the UIRenderer seam) from animating raw ANSI over
 * the frame the way it did when it wrote straight to stdout.
 */
export function ProgressDialog({ title, message, detail, hint }: ProgressDialogProps) {
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  return (
    <Box height={rows} justifyContent="center" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={3}
        paddingY={1}
        minWidth={44}
      >
        <Text color={COLORS.brand} bold>
          {title}
        </Text>

        <Box marginTop={1}>
          <OrbitalSpinner />
          <Text color={COLORS.white}> {message || 'Working…'}</Text>
        </Box>

        {detail ? <Text color={COLORS.dimmed}> {detail}</Text> : null}

        {hint ? (
          <Box marginTop={1}>
            <Text color={COLORS.dimmed}>{hint}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
