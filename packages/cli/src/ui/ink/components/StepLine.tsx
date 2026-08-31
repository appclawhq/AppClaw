import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, symbols, getActionIcon } from '../theme.js';
import { OrbitalSpinner } from './OrbitalSpinner.js';
import { ShimmerText } from './ShimmerText.js';
import type { StepData } from '../store.js';

const VERB_WIDTH = 7;
const TARGET_WIDTH = 48;

function fmtDuration(ms?: number): string {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One agent step row:
 *
 *   [3/12]  ✓  tap    "search icon"                    ●  0.8s
 *              ↳  Tapped "search icon" at [432, 421]
 *
 * The row is a fixed-width grid summing to ~79 cells. Rendered into anything
 * narrower — Terminal Studio puts the run in a column beside the device stream —
 * Yoga shrinks the boxes, and without `wrap="truncate"` the text inside them
 * reflows onto a second line, which both scrambles the row ("[1/3" over "0]")
 * and costs the caller a row its height budget never reserved.
 */
export function StepLine({ data }: { data: StepData }) {
  const { step, maxSteps, verb, actionType, target, status, detail, durationMs, tokens } = data;
  const isRunning = status === 'running';
  const isFailed = status === 'failed';
  const isDone = status === 'done';

  const maxTarget = TARGET_WIDTH;
  const displayTarget = target.length > maxTarget ? target.slice(0, maxTarget - 1) + '…' : target;

  return (
    <Box flexDirection="column">
      <Box marginLeft={2} overflow="hidden">
        {/* step counter */}
        <Box width={8} flexShrink={0}>
          <Text color={COLORS.dimmed} wrap="truncate">{`[${step}/${maxSteps}]`}</Text>
        </Box>

        {/* status icon */}
        <Box width={3} flexShrink={0}>
          {isRunning ? (
            <OrbitalSpinner />
          ) : isFailed ? (
            <Text color={COLORS.red} bold>
              {symbols.cross}
            </Text>
          ) : (
            <Text color={COLORS.green} bold>
              {symbols.check}
            </Text>
          )}
        </Box>

        {/* verb */}
        <Box width={VERB_WIDTH} flexShrink={0}>
          <Text color={isFailed ? COLORS.red : COLORS.step} wrap="truncate">
            {verb}
          </Text>
        </Box>

        {/* target */}
        <Box width={TARGET_WIDTH + 1} flexShrink={0}>
          {isRunning ? (
            <ShimmerText text={displayTarget} active />
          ) : isFailed ? (
            <Text color={COLORS.red} wrap="truncate">
              {displayTarget}
            </Text>
          ) : (
            <Text wrap="truncate">{displayTarget}</Text>
          )}
        </Box>

        {/* action icon */}
        <Box width={3} flexShrink={0}>
          {isDone || isFailed ? (
            <Text color={COLORS.muted}>{getActionIcon(actionType)}</Text>
          ) : null}
        </Box>

        {/* duration */}
        <Box width={7} justifyContent="flex-end" flexShrink={0}>
          <Text color={COLORS.dimmed}>{fmtDuration(durationMs)}</Text>
        </Box>
      </Box>

      {/* result detail */}
      {detail ? (
        <Box marginLeft={13}>
          <Text color={isFailed ? COLORS.red : COLORS.dimmed} wrap="truncate">
            {symbols.arrowDown} {detail}
          </Text>
        </Box>
      ) : null}

      {/* per-step tokens */}
      {tokens ? (
        <Box marginLeft={13}>
          <Text color={COLORS.muted} wrap="truncate">
            ⟠ {tokens.input + tokens.output} tokens (in {tokens.input} · out {tokens.output}
            {tokens.cached ? ` · cached ${tokens.cached}` : ''})
            {tokens.cost != null && tokens.cost > 0 ? `  $${tokens.cost.toFixed(5)}` : ''}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
