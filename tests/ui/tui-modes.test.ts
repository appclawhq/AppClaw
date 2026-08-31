/**
 * Terminal Studio's two modes.
 *
 * The whole design rests on one line of dispatch: a plain line means "record a
 * step" in `record` and "run the agent" in `goal`. Get that backwards and the
 * shell silently does the expensive thing instead of the cheap one (or records
 * nothing when the user is trying to build a flow), with no error to notice.
 * The palette scoping matters for the same reason — `/export` in goal mode has
 * no step list to act on, so it has to say so rather than appear to work.
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  COMMANDS,
  commandsFor,
  completeCommand,
  executeLine,
  matchCommands,
  type TuiActions,
} from '@appclaw/cli/tui/commands';
import { tuiStore, getSnapshot } from '@appclaw/cli/tui/store';

/** Records which action a line reached, so dispatch is observable. */
function spyActions() {
  const calls: Array<{ action: string; arg: string }> = [];
  const actions = new Proxy(
    {},
    {
      get: (_t, prop: string) => async (arg: string) => {
        calls.push({ action: prop, arg });
      },
    }
  ) as TuiActions;
  return { actions, calls };
}

afterEach(() => tuiStore.reset());

describe('mode dispatch', () => {
  test('a plain line records a step in record mode', async () => {
    const { actions, calls } = spyActions();
    tuiStore.setMode('record');
    await executeLine('tap on Login', actions);
    expect(calls).toEqual([{ action: 'runInstruction', arg: 'tap on Login' }]);
  });

  test('a plain line runs the agent in goal mode', async () => {
    const { actions, calls } = spyActions();
    tuiStore.setMode('goal');
    await executeLine('open settings and read the wifi name', actions);
    expect(calls).toEqual([{ action: 'runGoal', arg: 'open settings and read the wifi name' }]);
  });

  test('/goal reaches the agent from either mode', async () => {
    for (const mode of ['record', 'goal'] as const) {
      const { actions, calls } = spyActions();
      tuiStore.setMode(mode);
      await executeLine('/goal do the thing', actions);
      expect(calls).toEqual([{ action: 'runGoal', arg: 'do the thing' }]);
    }
  });

  test('/goal with no argument switches into goal mode instead of erroring', async () => {
    const { actions, calls } = spyActions();
    tuiStore.setMode('record');
    await executeLine('/goal', actions);
    expect(getSnapshot().mode).toBe('goal');
    expect(calls).toEqual([]);
    expect(getSnapshot().paletteError).toBeNull();
  });

  test('/mode switches back and forth without touching the device session', async () => {
    const { actions } = spyActions();
    tuiStore.setMode('record');
    await executeLine('/mode goal', actions);
    expect(getSnapshot().mode).toBe('goal');
    await executeLine('/mode record', actions);
    expect(getSnapshot().mode).toBe('record');
  });

  test('/mode rejects anything that is not a mode', async () => {
    const { actions } = spyActions();
    await executeLine('/mode sideways', actions);
    expect(getSnapshot().mode).toBe('record');
    expect(getSnapshot().paletteError).toMatch(/mode goal/);
  });
});

describe('palette scoping', () => {
  test('the recorder commands are listed only in record mode', () => {
    const record = commandsFor('record').map((c) => c.id);
    const goal = commandsFor('goal').map((c) => c.id);
    for (const id of ['list', 'yaml', 'undo', 'edit', 'meta']) {
      expect(record).toContain(id);
      expect(goal).not.toContain(id);
    }
    // The shell itself is the same in both — device, settings, history, quit.
    // /export is in both too: it answers the same question in each, from
    // different material — the recorded steps, or the last agent run.
    for (const id of ['device', 'settings', 'history', 'help', 'quit', 'goal', 'export']) {
      expect(record).toContain(id);
      expect(goal).toContain(id);
    }
  });

  test('matchCommands and completion follow the active mode', () => {
    for (const mode of ['goal', 'record'] as const) {
      tuiStore.setMode(mode);
      expect(matchCommands('/exp').map((c) => c.id)).toEqual(['export']);
      // /ex stays ambiguous with /exit in both modes now that /export is in both.
      expect(completeCommand('/ex')).toBeNull();
    }

    tuiStore.setMode('goal');
    expect(matchCommands('/yam')).toHaveLength(0);
    tuiStore.setMode('record');
    expect(matchCommands('/yam').map((c) => c.id)).toEqual(['yaml']);
  });

  test('a wrong-mode command explains itself rather than running', async () => {
    const { actions, calls } = spyActions();
    tuiStore.setMode('goal');
    await executeLine('/yaml', actions);
    expect(calls).toEqual([]);
    expect(getSnapshot().paletteError).toMatch(/record mode/);
    // And it names the way out.
    expect(getSnapshot().paletteError).toMatch(/\/mode record/);
  });

  test('/export goes to the goal exporter in goal mode, the recorder in record mode', async () => {
    const { actions, calls } = spyActions();
    tuiStore.setMode('goal');
    await executeLine('/export wifi.test.ts', actions);
    expect(calls).toEqual([{ action: 'exportGoal', arg: 'wifi.test.ts' }]);

    // Record mode writes the step list itself rather than calling an action,
    // so the observable difference is that no action is reached.
    const recorder = spyActions();
    tuiStore.setMode('record');
    await executeLine('/export flow.yaml', recorder.actions);
    expect(recorder.calls).toEqual([]);
    expect(getSnapshot().transcript.at(-1)?.text).toContain('No steps to export');
  });

  test('every command with a mode restriction is reachable from some mode', () => {
    for (const command of COMMANDS) {
      expect(command.modes?.length ?? 1).toBeGreaterThan(0);
    }
  });
});
