import React, { useSyncExternalStore } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS } from '../../ui/ink/theme.js';
import { RunScreen } from '../../ui/ink/RunScreen.js';
import { subscribe, getSnapshot } from '../store.js';
import { Header } from '../components/Header.js';
import { StreamPanel } from '../components/StreamPanel.js';
import { StatusBar } from '../components/StatusBar.js';
import { handleStreamKey, streamHints } from '../stream-keys.js';
import { columnWidths, panelImageRows, runPaneRows, MIN_RUN_ROWS } from '../stream/layout.js';
import type { TuiActions } from '../commands.js';

export interface GoalRunScreenProps {
  /** The goal being run, for the header line. */
  goal: string;
  /** Only needed to quit once a held one-shot run is dismissed. */
  actions: TuiActions;
}

/**
 * The screen a `/goal` run owns: the agent-loop UI on the left, the device
 * mirror on the right.
 *
 * Watching the phone is most useful exactly while the agent is driving it, so
 * the panel that `/stream` fills on the main screen is here too rather than
 * disappearing for the length of the run. It is deliberately the same panel at
 * the same size: <StreamPanel> renders the placeholder cells the picture is
 * drawn into, and the frame loop sizes the image it transmits from `layout.ts`
 * without knowing which screen is mounted — so both screens must lay the column
 * out identically or the image and its grid disagree.
 *
 * The left pane is <RunScreen>, the same component the one-shot CLI renders
 * full-screen, told to fit a column instead of the terminal.
 */
export function GoalRunScreen({ goal, actions }: GoalRunScreenProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;
  const rows = stdout.rows || 24;

  const done = ui.awaitingExit !== null;
  const streaming = ui.stream.status === 'running' || ui.stream.status === 'paused';

  // Ctrl+C is never handled here — TuiApp owns it, and quitting mid-run should
  // stay one keystroke away from anywhere in the app.
  useInput(
    (input, key) => {
      // The same mirror chords the goal prompt binds, so one set of keys works
      // whether the agent is running or you are about to describe a goal.
      // Checked before the ctrl guard below, and it lets ctrl+c fall through.
      if (!done && handleStreamKey(input, key, ui.stream.status, actions)) return;
      if (key.ctrl) return;

      // A finished one-shot run holds the screen so the summary and the last
      // device frame can be read. Any key dismisses it: there is nothing else
      // to do at that point, so binding a specific one is only something to
      // guess at.
      if (done) {
        void actions.quit();
        return;
      }

      // `p` toggles the mirror. Pause, not close — the picture stays on screen,
      // which is the whole point of being able to freeze a frame you want to
      // look at while the agent keeps working.
      if (input === 'p' && streaming) {
        if (ui.stream.status === 'running') actions.pauseStream();
        else void actions.openStream();
        return;
      }

      // esc asks the run to stop. Cooperative, so the screen says "stopping…"
      // until the agent reaches its next step boundary and returns.
      if (key.escape && !ui.stopping) actions.stopRun();
    },
    { isActive: ui.screen === 'run' }
  );

  // Same reasoning as MainScreen: Ink overlaps an over-tall frame rather than
  // clipping it, so saying the terminal is too small beats rendering garbage.
  if (rows < MIN_RUN_ROWS) {
    return (
      <Box flexDirection="column" height={rows} justifyContent="center" alignItems="center">
        <Text color={COLORS.yellow} bold>
          Terminal too small
        </Text>
        <Text color={COLORS.dimmed}>
          {rows} rows available, {MIN_RUN_ROWS} needed — resize and it redraws.
        </Text>
      </Box>
    );
  }

  const widths = columnWidths(cols);
  const paneRows = runPaneRows(rows);
  const state = done
    ? ui.awaitingExit!.code === 0
      ? 'done'
      : 'failed'
    : ui.stopping
      ? 'stopping after this step…'
      : 'running a goal';
  const subtitle = ui.device ? `${ui.device.platform} · ${ui.device.name} · ${state}` : state;

  return (
    <Box flexDirection="column" height={rows}>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={1}
      >
        <Header subtitle={subtitle} />
        <Box flexDirection="row" flexGrow={1}>
          <Box flexDirection="column" width={widths.left} marginRight={1}>
            <RunScreen rows={paneRows} width={widths.left} />
          </Box>
          <StreamPanel
            device={ui.device}
            stream={ui.stream}
            width={widths.right}
            imageRows={panelImageRows(rows)}
          />
        </Box>
      </Box>
      <StatusBar
        breadcrumb={done ? (ui.awaitingExit!.code === 0 ? 'Done' : 'Failed') : 'Run'}
        hints={
          done
            ? ['press any key to exit']
            : [
                // `p` alone works here — there is no text input on this screen
                // to compete for it — but the chord is what the goal prompt
                // binds, so naming that keeps one set of keys in the user's
                // head across both screens.
                ...streamHints(ui.stream.status),
                ui.stopping ? 'stopping…' : 'esc stop run',
                'ctrl+c quit',
              ]
        }
        message={goal || ui.statusMessage}
      />
    </Box>
  );
}
