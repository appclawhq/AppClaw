import React from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Blocking yes/no modal. Rendered in place of the active screen so the screen
 * underneath unmounts and its key handlers stop competing — important here,
 * because the answer is a single keypress that several screens also bind.
 */
export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onConfirm();
    // Enter deliberately does NOT confirm — this dialog appears on a keypress,
    // and a stray return shouldn't be able to discard a recording.
    else if (input === 'n' || input === 'N' || key.escape) onCancel();
  });

  return (
    <Box height={rows} justifyContent="center" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLORS.yellow}
        paddingX={3}
        paddingY={1}
        minWidth={52}
      >
        <Text color={COLORS.yellow} bold>
          {symbols.warning} {title}
        </Text>

        <Box marginTop={1}>
          <Text color={COLORS.white}>{message}</Text>
        </Box>
        {detail ? <Text color={COLORS.dimmed}>{detail}</Text> : null}

        <Box marginTop={1}>
          <Text color={COLORS.dimmed}>
            <Text color={COLORS.red} bold>
              y
            </Text>{' '}
            {confirmLabel} ·{' '}
            <Text color={COLORS.green} bold>
              n
            </Text>{' '}
            {cancelLabel}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
