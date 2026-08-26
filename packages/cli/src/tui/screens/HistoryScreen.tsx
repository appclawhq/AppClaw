import React, { useSyncExternalStore } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import { subscribe, getSnapshot, tuiStore } from '../store.js';
import { requestQuit, type TuiActions } from '../commands.js';
import { Header } from '../components/Header.js';
import { StatusBar } from '../components/StatusBar.js';
import { useAvailableRows, windowFor } from '../useLayout.js';

export interface HistoryScreenProps {
  actions: TuiActions;
}

/** Header (2) + border/padding (2) + StatusBar (3). */
const RESERVED_ROWS = 2 + 2 + 3;

function formatDuration(ms?: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Browses `.appclaw/runs/` (flow-run reports) via the shared runs.json index. */
export function HistoryScreen({ actions }: HistoryScreenProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const runs = ui.history;
  const selected = runs[ui.historySelected];
  const maxVisible = useAvailableRows(RESERVED_ROWS);
  const { items: visibleRuns, start } = windowFor(runs, ui.historySelected, maxVisible);
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  useInput((input, key) => {
    if (input === 'q' && !key.ctrl && !key.meta) {
      void requestQuit(actions);
      return;
    }
    if (key.upArrow) tuiStore.setHistorySelected(Math.max(0, ui.historySelected - 1));
    else if (key.downArrow)
      tuiStore.setHistorySelected(Math.min(runs.length - 1, ui.historySelected + 1));
    else if (key.escape) actions.goToMain();
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={1}
      >
        <Header subtitle="Run history — .appclaw/runs" />
        <Box flexDirection="row">
          <Box
            flexDirection="column"
            width="55%"
            marginRight={1}
            borderStyle="round"
            borderColor={COLORS.brand}
            paddingX={1}
          >
            {ui.historyLoading ? (
              <Text color={COLORS.dimmed}>Loading…</Text>
            ) : ui.historyError ? (
              <Text color={COLORS.red}>{ui.historyError}</Text>
            ) : runs.length === 0 ? (
              <Text color={COLORS.dimmed}>
                Nothing yet — record steps in the TUI, or run a YAML flow.
              </Text>
            ) : (
              <Box flexDirection="column">
                {visibleRuns.map((r, i) => {
                  const trueIndex = start + i;
                  return (
                    <Text
                      key={r.runId}
                      color={trueIndex === ui.historySelected ? COLORS.brand : COLORS.white}
                      bold={trueIndex === ui.historySelected}
                      wrap="truncate"
                    >
                      {trueIndex === ui.historySelected ? `${symbols.prompt} ` : '  '}
                      <Text color={r.success ? COLORS.green : COLORS.red}>
                        {r.success ? symbols.check : symbols.cross}
                      </Text>{' '}
                      {/* The two kinds live in different places on disk and mean
                          different things, so the row says which it is. */}
                      <Text color={r.source === 'session' ? COLORS.step : COLORS.dimmed}>
                        {r.source === 'session' ? 'session' : 'flow   '}
                      </Text>{' '}
                      {r.goal}
                      {r.live ? <Text color={COLORS.yellow}> · live</Text> : null}
                    </Text>
                  );
                })}
              </Box>
            )}
          </Box>
          <Box
            flexDirection="column"
            width="45%"
            borderStyle="round"
            borderColor={COLORS.muted}
            paddingX={1}
          >
            <Text color={COLORS.brand} bold>
              Detail
            </Text>
            {selected ? (
              <Box flexDirection="column" marginTop={1}>
                <Text wrap="truncate">{selected.goal}</Text>
                <Text color={COLORS.dimmed}>{selected.startedAt}</Text>
                <Text color={COLORS.dimmed}>
                  {selected.platform ?? ''} ·{' '}
                  {selected.live ? 'running' : formatDuration(selected.durationMs)} ·{' '}
                  {selected.stepsExecuted ?? 0}/{selected.stepsTotal ?? 0} steps
                </Text>
                {selected.device ? (
                  <Text color={COLORS.dimmed} wrap="truncate">
                    {selected.device}
                  </Text>
                ) : null}
                {selected.model ? (
                  <Text color={COLORS.dimmed} wrap="truncate">
                    {selected.model}
                  </Text>
                ) : null}
                {/* Failed instructions never became steps, so the step count
                    alone hides them — the whole reason the log keeps them. */}
                {selected.failures ? (
                  <Text color={COLORS.red}>
                    {selected.failures} failed instruction
                    {selected.failures === 1 ? '' : 's'}
                  </Text>
                ) : null}
                {selected.exports?.length ? (
                  <Text color={COLORS.green} wrap="truncate">
                    {selected.exports.length} export
                    {selected.exports.length === 1 ? '' : 's'}
                  </Text>
                ) : null}
                <Box marginTop={1}>
                  <Text color={COLORS.dimmed} wrap="truncate">
                    {selected.dir}
                  </Text>
                </Box>
              </Box>
            ) : (
              <Text color={COLORS.dimmed}>Select a run</Text>
            )}
          </Box>
        </Box>
      </Box>
      <StatusBar
        breadcrumb="History"
        hints={['↑↓ select', 'esc back', 'q quit']}
        message={ui.statusMessage}
      />
    </Box>
  );
}
