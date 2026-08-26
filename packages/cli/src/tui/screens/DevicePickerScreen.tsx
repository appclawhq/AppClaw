import React, { useState, useSyncExternalStore, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import { subscribe, getSnapshot } from '../store.js';
import { requestQuit, type TuiActions } from '../commands.js';
import { Header } from '../components/Header.js';
import { StatusBar } from '../components/StatusBar.js';
import { useAvailableRows, windowFor } from '../useLayout.js';

export interface DevicePickerScreenProps {
  actions: TuiActions;
}

/** Header (2) + "Select a device" title (1) + border/padding (2) + StatusBar (3) + connecting line (1). */
const RESERVED_ROWS = 2 + 1 + 2 + 3 + 1;

/** Lists running Android emulators / iOS simulators for the chosen platform. */
export function DevicePickerScreen({ actions }: DevicePickerScreenProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const [index, setIndex] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const maxVisible = useAvailableRows(RESERVED_ROWS);
  const { items: visibleDevices, start } = windowFor(ui.devices, index, maxVisible);
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  const showError = Boolean(ui.devicesError) && !errorDismissed;

  useEffect(() => {
    setIndex(0);
  }, [ui.devices]);

  // A newly-arrived error is always worth showing, even if the previous one
  // was dismissed.
  useEffect(() => {
    if (ui.devicesError) setErrorDismissed(false);
  }, [ui.devicesError]);

  useInput((input, key) => {
    if (connecting) return;
    // Escape closes the notice first; only a second press leaves the screen,
    // so dismissing can't accidentally navigate away.
    if (key.escape && showError) {
      setErrorDismissed(true);
      return;
    }
    if (input === 'd' && !key.ctrl && !key.meta) {
      void actions.runDoctor();
      return;
    }
    if (input === 'q' && !key.ctrl && !key.meta) {
      void requestQuit(actions);
      return;
    }
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.max(0, Math.min(ui.devices.length - 1, i + 1)));
    else if (key.return && ui.devices[index]) {
      setConnecting(true);
      void actions
        .selectDevice(ui.devices[index])
        .catch(() => {
          /* connect() reports its own errors via the store */
        })
        .finally(() => setConnecting(false));
    } else if (key.escape) actions.goToPlatformPicker();
    else if (input === 'r' && !key.ctrl && !key.meta) actions.goToDevicePicker();
  });

  const hints = showError
    ? ['d doctor', 'r refresh', 'esc dismiss', 'q quit']
    : ['↑↓ select', 'enter connect', 'r refresh', 'd doctor', 'esc back', 'q quit'];

  return (
    <Box flexDirection="column" height={rows}>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={1}
      >
        <Header subtitle={ui.platform ?? undefined} />

        {/* Centered in the remaining space — this screen holds a short list,
            so pinning it to the top left it stranded in a mostly empty frame. */}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Box flexDirection="column" alignItems="center">
            <Text color={COLORS.brand} bold>
              Select a device
            </Text>

            {ui.devicesLoading ? (
              <Box marginTop={1}>
                <Text color={COLORS.dimmed}>Searching for {ui.platform} devices…</Text>
              </Box>
            ) : showError ? (
              <Box
                flexDirection="column"
                marginTop={1}
                borderStyle="round"
                borderColor={COLORS.red}
                paddingX={2}
                paddingY={1}
              >
                <Text color={COLORS.red} bold>
                  {symbols.cross} No devices found
                </Text>
                <Box marginTop={1}>
                  <Text color={COLORS.white}>{ui.devicesError}</Text>
                </Box>
                <Box marginTop={1}>
                  <Text color={COLORS.dimmed}>d run doctor · r refresh · esc dismiss</Text>
                </Box>
              </Box>
            ) : ui.devices.length === 0 ? (
              <Box marginTop={1}>
                <Text color={COLORS.dimmed}>
                  No {ui.platform === 'android' ? 'emulators' : 'simulators'} running — press r to
                  refresh.
                </Text>
              </Box>
            ) : (
              // No explicit height — windowFor() already caps the row count, and
              // forcing height={maxVisible} stretched this to the full screen
              // when fewer devices were listed.
              <Box
                flexDirection="column"
                marginTop={1}
                borderStyle="round"
                borderColor={COLORS.muted}
                paddingX={3}
                paddingY={1}
              >
                {visibleDevices.map((d, i) => {
                  const trueIndex = start + i;
                  const up =
                    d.state.toLowerCase() === 'booted' || d.state.toLowerCase() === 'device';
                  return (
                    <Text
                      key={d.udid}
                      color={trueIndex === index ? COLORS.brand : COLORS.white}
                      bold={trueIndex === index}
                    >
                      {trueIndex === index ? `${symbols.prompt} ` : '  '}
                      {d.name} <Text color={up ? COLORS.green : COLORS.dimmed}>{d.state}</Text>
                      {d.hint ? <Text color={COLORS.dimmed}> · {d.hint}</Text> : null}
                    </Text>
                  );
                })}
              </Box>
            )}

            {connecting ? (
              <Box marginTop={1}>
                <Text color={COLORS.cyan}>Connecting…</Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
      <StatusBar breadcrumb="Device" hints={hints} message={ui.statusMessage} />
    </Box>
  );
}
