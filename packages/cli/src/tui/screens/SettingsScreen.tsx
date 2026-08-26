import React, { useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS, symbols } from '../../ui/ink/theme.js';
import { subscribe, getSnapshot, tuiStore } from '../store.js';
import { requestQuit, type TuiActions } from '../commands.js';
import { Header } from '../components/Header.js';
import { StatusBar } from '../components/StatusBar.js';

export interface SettingsScreenProps {
  actions: TuiActions;
}

/** View/edit the curated config subset, written back to .env on save. */
export function SettingsScreen({ actions }: SettingsScreenProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;

  useInput(
    (input, key) => {
      const fields = ui.settingsFields;
      // Safe to bind here because this handler is inactive while editing —
      // otherwise "q" would be swallowed instead of typed into a value.
      if (input === 'q' && !key.ctrl && !key.meta) {
        void requestQuit(actions);
        return;
      }
      if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setIndex((i) => Math.max(0, Math.min(fields.length - 1, i + 1)));
      else if (key.return && fields[index]) {
        setDraft(fields[index].value);
        setEditing(true);
      } else if (input === 's' && !key.ctrl && !key.meta) {
        // plain "s" only — Ink reports Ctrl+S as input "s" + key.ctrl, and a
        // flow-control reflex shouldn't silently write .env
        setSaving(true);
        void actions
          .saveSettings()
          .catch((err) =>
            tuiStore.log(
              'error',
              'Could not save settings',
              err instanceof Error ? err.message : String(err)
            )
          )
          .finally(() => setSaving(false));
      } else if (key.escape) {
        actions.goToMain();
      }
    },
    { isActive: !editing }
  );

  // While editing, Escape cancels back to browsing (ink-text-input has no
  // escape handling of its own — without this, Enter/commit is the only exit).
  useInput(
    (_input, key) => {
      if (key.escape) setEditing(false);
    },
    { isActive: editing }
  );

  function commit(value: string): void {
    const field = ui.settingsFields[index];
    if (field) tuiStore.updateSettingField(field.key, value);
    setEditing(false);
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={1}
      >
        <Header subtitle="Settings — written to .env" />
        <Box flexDirection="column">
          {ui.settingsLoading ? (
            <Text color={COLORS.dimmed}>Loading…</Text>
          ) : (
            ui.settingsFields.map((f, i) => (
              <Box key={f.key} flexDirection="column" marginBottom={i === index && editing ? 0 : 0}>
                <Text color={i === index ? COLORS.brand : COLORS.white} bold={i === index}>
                  {i === index ? `${symbols.prompt} ` : '  '}
                  {f.key.padEnd(14)}
                  {i === index && editing ? (
                    <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
                  ) : (
                    <Text color={COLORS.step}>{f.value || '(unset)'}</Text>
                  )}
                </Text>
                {f.description && i === index ? (
                  <Text color={COLORS.dimmed}> {f.description}</Text>
                ) : null}
              </Box>
            ))
          )}
        </Box>
        <Box marginTop={1}>
          {saving ? (
            <Text color={COLORS.cyan}>Saving…</Text>
          ) : ui.settingsSaved ? (
            <Text color={COLORS.green}>{symbols.check} Saved</Text>
          ) : ui.settingsDirty ? (
            <Text color={COLORS.yellow}>Unsaved changes — press s to save</Text>
          ) : null}
        </Box>
      </Box>
      <StatusBar
        breadcrumb="Settings"
        hints={['↑↓ select', 'enter edit', 's save', 'esc back', 'q quit']}
        message={ui.statusMessage}
      />
    </Box>
  );
}
