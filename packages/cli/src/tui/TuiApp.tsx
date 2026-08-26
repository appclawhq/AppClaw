import React, { useSyncExternalStore } from 'react';
import { Box, useInput } from 'ink';
import { subscribe, getSnapshot } from './store.js';
import type { TuiActions } from './commands.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { DevicePickerScreen } from './screens/DevicePickerScreen.js';
import { MainScreen } from './screens/MainScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { HistoryScreen } from './screens/HistoryScreen.js';
import { ProgressDialog } from './components/ProgressDialog.js';
import { OutputDialog } from './components/OutputDialog.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { tuiStore } from './store.js';

export interface TuiAppProps {
  actions: TuiActions;
}

/** Root router for `appclaw --tui` — switches on store.screen. */
export function TuiApp({ actions }: TuiAppProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);

  // With `exitOnCtrlC: false`, Ink delivers Ctrl+C here as a normal keypress
  // (raw mode also suppresses tty SIGINT, so the process-level handler can't
  // fire while the app is mounted). This always-mounted handler is the one
  // reliable quit path — and it keeps raw mode held for the app's lifetime,
  // so keystrokes never leak to the host shell while a goal is running.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') void actions.quit();
  });

  // Ahead of everything else — it's a blocking question, and leaving the
  // screen behind it live would let the same keypress act twice.
  if (ui.quitConfirmOpen) {
    const count = `${ui.steps.length} step${ui.steps.length === 1 ? '' : 's'}`;
    return (
      <Box flexDirection="column" paddingX={1}>
        <ConfirmDialog
          title="Unexported steps"
          message={`${count} recorded but not exported.`}
          detail="Cancel and run /export <file> to save them first."
          confirmLabel="discard and quit"
          cancelLabel="stay"
          onConfirm={() => {
            tuiStore.setQuitConfirm(false);
            void actions.quit();
          }}
          onCancel={() => tuiStore.setQuitConfirm(false)}
        />
      </Box>
    );
  }

  // Rendered instead of the active screen (not layered over it) so the
  // underlying screen unmounts and its useInput handlers stop competing for
  // the same keystrokes.
  if (ui.viewerOpen) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <OutputDialog
          title={ui.viewerTitle}
          subtitle={ui.viewerSubtitle}
          lines={ui.viewerLines}
          running={ui.viewerRunning}
          status={ui.viewerStatus}
          tint={ui.viewerTint}
          language={ui.viewerLanguage}
          onClose={() => tuiStore.closeViewer()}
        />
      </Box>
    );
  }

  // Device setup owns the screen while it runs — it's a multi-step pipeline
  // (discover → select → boot/WDA → create session) with no useful
  // interaction available until it settles.
  if (ui.connecting) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressDialog
          title="Connecting to device"
          message={ui.busyMessage}
          detail={ui.busyDetail}
          hint="ctrl+c to cancel"
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {ui.screen === 'welcome' && <WelcomeScreen actions={actions} />}
      {ui.screen === 'device-picker' && <DevicePickerScreen actions={actions} />}
      {ui.screen === 'main' && <MainScreen actions={actions} />}
      {ui.screen === 'settings' && <SettingsScreen actions={actions} />}
      {ui.screen === 'history' && <HistoryScreen actions={actions} />}
    </Box>
  );
}
