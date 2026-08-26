/**
 * Command palette — the slash commands shown in the left pane of the main
 * TUI screen (wireframe: "Command pallet / All / commands for first time
 * user"). Each command is a small declarative spec; `TuiActions` is the
 * side-effecting surface a command is allowed to call into, implemented by
 * the TUI entry point (packages/cli/src/tui/index.ts) so this module stays
 * free of process/IO concerns and is easy to unit test / extend.
 *
 * The TUI is a step recorder first: a plain line runs
 * ONE deterministic instruction and appends it to `store.steps`, and the flow
 * commands below edit/preview/export that list. The autonomous agent loop is
 * still available, but explicitly, behind `/goal`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { tryParseNaturalFlowLine } from '@appclaw/core/flow/natural-line';

import { COLORS } from '../ui/ink/theme.js';

import { tuiStore, getSnapshot, type Platform, type DeviceSummary } from './store.js';
import {
  buildYamlString,
  buildSdkTestString,
  isSdkTestFilename,
  resolveRecordedExportPath,
  formatStepLines,
} from '../step-recorder/flow-builder.js';
import { runMemoryCommand } from '../step-recorder/memory-inspect.js';
import { currentSessionLog } from './session-log.js';
import { captureConsole } from './capture-console.js';

export interface TuiActions {
  /** Welcome screen: record the chosen platform and move to the device picker. */
  selectPlatform(platform: Platform): void;
  /** Device picker screen: lock in a device, connect the Appium/MCP session, and move to main. */
  selectDevice(device: DeviceSummary): Promise<void>;
  goToDevicePicker(): void;
  goToPlatformPicker(): void;
  goToSettings(): void;
  goToHistory(): void;
  goToMain(): void;
  saveSettings(): Promise<void>;
  /** `/stream` — mirror the device in the main screen's right-hand panel. */
  openStream(): Promise<void>;
  /** `/stream-close` — stop the mirror. */
  closeStream(): void;
  runDoctor(): Promise<void>;
  /** One deterministic step, executed on device and recorded — the default for a plain line. */
  runInstruction(instruction: string): Promise<void>;
  /** Full autonomous agent loop (`/goal`) — nothing is recorded. */
  runGoal(goal: string): Promise<void>;
  quit(): Promise<void>;
}

export interface PaletteCommand {
  id: string;
  /** e.g. "/device" */
  name: string;
  aliases?: string[];
  summary: string;
  run(actions: TuiActions, args: string): void | Promise<void>;
}

/** Shared guard for the commands that need at least one recorded step. */
function requireSteps(what: string): boolean {
  if (getSnapshot().steps.length > 0) return true;
  tuiStore.log(
    'warn',
    `No steps to ${what}.`,
    'Type an instruction (e.g. tap on Login) to record one.'
  );
  return false;
}

/** `<number> <rest>` argument shape shared by /edit and /insert. */
function parseIndexedArg(args: string): { index: number; rest: string } | null {
  const match = args.match(/^(\d+)\s+(.+)$/);
  if (!match) return null;
  return { index: parseInt(match[1], 10) - 1, rest: match[2] };
}

export const COMMANDS: PaletteCommand[] = [
  {
    id: 'goal',
    name: '/goal',
    summary: 'Run the autonomous agent loop for a goal (not recorded)',
    run: async (actions, args) => {
      if (!args.trim()) {
        tuiStore.setPaletteError('Usage: /goal <what you want the agent to achieve>');
        return;
      }
      await actions.runGoal(args.trim());
    },
  },
  {
    id: 'list',
    name: '/list',
    summary: 'List all recorded steps',
    run: () => {
      const { steps, meta } = getSnapshot();
      if (steps.length === 0) {
        tuiStore.log('info', 'No steps yet.', 'Type a command like: open youtube app');
        return;
      }
      const title = meta.name
        ? `${meta.name}${meta.appId ? ` (${meta.appId})` : ''}`
        : (meta.appId ?? 'Recorded flow');
      tuiStore.showViewer({
        title,
        subtitle: `${steps.length} step${steps.length === 1 ? '' : 's'} recorded`,
        lines: formatStepLines(steps),
      });
    },
  },
  {
    id: 'yaml',
    name: '/yaml',
    summary: 'Preview the YAML flow output',
    run: () => {
      if (!requireSteps('preview')) return;
      const { steps, meta } = getSnapshot();
      tuiStore.showViewer({
        title: 'YAML flow',
        subtitle: '/export <file>.yaml to save',
        lines: buildYamlString(steps, meta).split('\n'),
        language: 'yaml',
      });
    },
  },
  {
    id: 'preview',
    name: '/preview',
    summary: 'Preview the generated code without saving (filename picks the format)',
    run: (_actions, args) => {
      if (!requireSteps('preview')) return;
      const { steps, meta } = getSnapshot();
      const filename = args.trim() || `flow-${Date.now()}.spec.ts`;
      const asSdkTest = isSdkTestFilename(filename);
      const body = asSdkTest ? buildSdkTestString(steps, meta) : buildYamlString(steps, meta);
      tuiStore.showViewer({
        title: path.basename(filename),
        subtitle: asSdkTest ? 'runner spec — not saved' : 'YAML flow — not saved',
        lines: body.split('\n'),
        language: asSdkTest ? 'ts' : 'yaml',
      });
    },
  },
  {
    id: 'export',
    name: '/export',
    summary: 'Export steps as an @appclaw/runner spec (.spec.ts) or YAML flow (.yaml)',
    run: (_actions, args) => {
      if (!requireSteps('export')) return;
      const { steps, meta, exportDir } = getSnapshot();
      const filename = args.trim() || `flow-${Date.now()}.spec.ts`;
      const asSdkTest = isSdkTestFilename(filename);
      const filepath = resolveRecordedExportPath(filename, asSdkTest, exportDir);
      const body = asSdkTest ? buildSdkTestString(steps, meta) : buildYamlString(steps, meta);
      try {
        mkdirSync(path.dirname(filepath), { recursive: true });
        writeFileSync(filepath, body, 'utf-8');
      } catch (err) {
        tuiStore.log(
          'error',
          `Could not write ${filepath}`,
          err instanceof Error ? err.message : String(err)
        );
        return;
      }
      currentSessionLog()?.addExport(filepath);
      const runHint = asSdkTest
        ? // `appclaw test` (not the bare appclaw-runner bin) — it registers the
          // tsx loader first, without which a .ts spec cannot be imported. It
          // discovers specs under testDir and matches filters, not paths, so
          // hint with the name rather than the path.
          `appclaw test ${path.basename(filepath).replace(/\.[^.]+$/, '')}`
        : `appclaw --flow ${path.relative(process.cwd(), filepath)}`;
      // Show what was written, the way the CLI printed the body before
      // saving — the transcript entry stays as the scrollback record.
      tuiStore.showViewer({
        title: path.basename(filepath),
        subtitle: `${steps.length} step${steps.length === 1 ? '' : 's'} · ${asSdkTest ? 'runner spec' : 'YAML flow'}`,
        lines: body.split('\n'),
        language: asSdkTest ? 'ts' : 'yaml',
        status: { color: COLORS.green, text: `Saved to ${filepath}\nRun:  ${runHint}` },
      });
      tuiStore.log(
        'result',
        `${steps.length} step${steps.length === 1 ? '' : 's'} exported as ${asSdkTest ? 'runner spec' : 'YAML flow'}`,
        `File: ${filepath}\nRun:  ${runHint}`
      );
    },
  },
  {
    id: 'undo',
    name: '/undo',
    summary: 'Remove the last recorded step',
    run: () => {
      const removed = tuiStore.popStep();
      if (!removed) {
        tuiStore.log('warn', 'Nothing to undo.');
        return;
      }
      tuiStore.log(
        'info',
        `Removed: ${removed.verbatim ?? removed.kind}`,
        `${getSnapshot().steps.length} step(s) left`
      );
    },
  },
  {
    id: 'edit',
    name: '/edit',
    summary: 'Replace a step by number (e.g. /edit 3 tap "Settings")',
    run: (_actions, args) => {
      const parsed = parseIndexedArg(args);
      if (!parsed) {
        tuiStore.setPaletteError('Usage: /edit <number> <new command>');
        return;
      }
      const { steps } = getSnapshot();
      if (parsed.index < 0 || parsed.index >= steps.length) {
        tuiStore.setPaletteError(`Step ${parsed.index + 1} does not exist (1–${steps.length}).`);
        return;
      }
      const step = tryParseNaturalFlowLine(parsed.rest);
      if (!step) {
        tuiStore.setPaletteError(`Could not parse: ${parsed.rest}`);
        return;
      }
      tuiStore.replaceStep(parsed.index, step);
      tuiStore.log('info', `Updated step ${parsed.index + 1}`, parsed.rest);
    },
  },
  {
    id: 'insert',
    name: '/insert',
    summary: 'Insert a step at a position (e.g. /insert 2 wait 3 s)',
    run: (_actions, args) => {
      const parsed = parseIndexedArg(args);
      if (!parsed) {
        tuiStore.setPaletteError('Usage: /insert <position> <command>');
        return;
      }
      const { steps } = getSnapshot();
      // One past the end is legal — that's an append.
      if (parsed.index < 0 || parsed.index > steps.length) {
        tuiStore.setPaletteError(`Position must be 1–${steps.length + 1}.`);
        return;
      }
      const step = tryParseNaturalFlowLine(parsed.rest);
      if (!step) {
        tuiStore.setPaletteError(`Could not parse: ${parsed.rest}`);
        return;
      }
      tuiStore.insertStep(parsed.index, step);
      tuiStore.log('info', `Inserted at position ${parsed.index + 1}`, parsed.rest);
    },
  },
  {
    id: 'delete',
    name: '/delete',
    summary: 'Delete a step by number (e.g. /delete 3)',
    run: (_actions, args) => {
      const { steps } = getSnapshot();
      const index = parseInt(args.trim(), 10) - 1;
      if (isNaN(index) || index < 0 || index >= steps.length) {
        tuiStore.setPaletteError(`Invalid step number. Use 1–${steps.length}.`);
        return;
      }
      const removed = tuiStore.deleteStep(index)!;
      tuiStore.log('info', `Deleted: ${removed.verbatim ?? removed.kind}`);
    },
  },
  {
    id: 'meta',
    name: '/meta',
    summary: 'Set flow metadata (/meta appId com.foo, /meta name Login, /meta platform ios)',
    run: (_actions, args) => {
      const parts = args.trim().split(/\s+/);
      const key = parts[0];
      const value = parts.slice(1).join(' ');
      if (key === 'appId' && value) {
        tuiStore.setMeta({ appId: value });
        tuiStore.log('info', `appId = ${value}`);
        return;
      }
      if (key === 'name' && value) {
        tuiStore.setMeta({ name: value });
        tuiStore.log('info', `name = ${value}`);
        return;
      }
      if (key === 'platform') {
        const p = value.toLowerCase();
        if (p === 'android' || p === 'ios') {
          tuiStore.setMeta({ platform: p });
          tuiStore.log('info', `platform = ${p}`);
        } else {
          tuiStore.setPaletteError('Usage: /meta platform <android|ios>');
        }
        return;
      }
      const { meta } = getSnapshot();
      const current = [
        meta.appId ? `appId:    ${meta.appId}` : null,
        meta.name ? `name:     ${meta.name}` : null,
        meta.platform ? `platform: ${meta.platform}` : null,
      ].filter((l): l is string => l !== null);
      tuiStore.log(
        'warn',
        'Usage: /meta appId <package.id> | /meta name <flow name> | /meta platform <android|ios>',
        current.length > 0 ? `Current:\n${current.join('\n')}` : undefined
      );
    },
  },
  {
    id: 'clear',
    name: '/clear',
    summary: 'Clear all recorded steps and metadata',
    run: () => {
      const count = getSnapshot().steps.length;
      tuiStore.clearSteps();
      tuiStore.log('info', `Cleared ${count} step${count === 1 ? '' : 's'} and metadata.`);
    },
  },
  {
    id: 'clear-log',
    name: '/clear-log',
    summary: 'Clear the transcript (recorded steps are kept)',
    run: () => tuiStore.clearTranscript(),
  },
  {
    id: 'session',
    name: '/session',
    summary: 'Show where this session’s JSON log is being written',
    run: () => {
      const log = currentSessionLog();
      if (!log) {
        tuiStore.log('warn', 'No session log for this run.');
        return;
      }
      tuiStore.log(
        'info',
        'Session log',
        `${log.path}\nUpdated after every step, so a crash still leaves it readable.`
      );
    },
  },
  {
    id: 'memory',
    name: '/memory',
    summary: 'Inspect episodic + procedural memory (stats | list | paths)',
    run: (_actions, args) => {
      // Captured into the modal rather than left to console.log: Ink puts that
      // above the frame, which is off screen under a full-height alt-screen
      // layout, so the report was written but never visible.
      const lines = captureConsole(() => runMemoryCommand(args.trim()));
      tuiStore.showViewer({
        title: 'Memory',
        subtitle: args.trim() ? `/memory ${args.trim()}` : 'episodic + procedural',
        lines,
      });
    },
  },
  {
    id: 'device',
    name: '/device',
    summary: 'Pick a running Android emulator / iOS simulator',
    run: (actions) => actions.goToDevicePicker(),
  },
  {
    id: 'platform',
    name: '/platform',
    summary: 'Switch between Android and iOS',
    run: (actions) => actions.goToPlatformPicker(),
  },
  {
    id: 'stream',
    name: '/stream',
    summary: 'Mirror the device screen in the side panel (keeps typing live)',
    run: (actions) => actions.openStream(),
  },
  {
    id: 'stream-close',
    name: '/stream-close',
    summary: 'Stop the device mirror',
    run: (actions) => actions.closeStream(),
  },
  {
    id: 'settings',
    name: '/settings',
    aliases: ['/config'],
    summary: 'View and edit AppClaw configuration',
    run: (actions) => actions.goToSettings(),
  },
  {
    id: 'history',
    name: '/history',
    aliases: ['/runs'],
    summary: 'Browse past run reports (.appclaw/runs)',
    run: (actions) => actions.goToHistory(),
  },
  {
    id: 'doctor',
    name: '/doctor',
    summary: 'Run the environment preflight check',
    run: (actions) => actions.runDoctor(),
  },
  {
    id: 'help',
    name: '/help',
    aliases: ['/?'],
    summary: 'List available commands',
    run: () => {
      // The scrollable modal, not the transcript: the full list is longer than
      // the transcript pane is tall, so logging it there overflowed the pane's
      // height budget and pushed the status bar off screen.
      const width = COMMANDS.reduce((w, c) => Math.max(w, c.name.length), 0);
      tuiStore.showViewer({
        title: 'Commands',
        subtitle: 'type a plain line to record a step · /goal to run the agent',
        lines: COMMANDS.map((c) => `${c.name.padEnd(width + 2)}${c.summary}`),
      });
    },
  },
  {
    id: 'quit',
    name: '/quit',
    aliases: ['/exit', '/q'],
    summary: 'Exit the TUI (warns once about unexported steps)',
    run: async (actions) => {
      await requestQuit(actions);
    },
  },
];

/**
 * Quit, confirming first if there are unexported steps. Shared by `/quit` and
 * the `q` key on the screens that have no text input — going straight to
 * `actions.quit()` from a keypress would discard a recording with no warning.
 *
 * The confirmation is a modal rather than a transcript line: the screens that
 * offer the `q` shortcut are exactly the ones that don't render a transcript,
 * so a logged warning was invisible on all of them.
 */
export async function requestQuit(actions: TuiActions): Promise<void> {
  if (getSnapshot().steps.length > 0) {
    tuiStore.setQuitConfirm(true);
    return;
  }
  await actions.quit();
}

/** Case-insensitive prefix match against name + aliases, for the palette list. */
export function matchCommands(query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q || q === '/') return COMMANDS;
  return COMMANDS.filter(
    (c) =>
      c.name.toLowerCase().startsWith(q) || c.aliases?.some((a) => a.toLowerCase().startsWith(q))
  );
}

/**
 * Tab completion for the prompt. Returns the line the input should become, or
 * null when there is nothing to add.
 *
 * Completes to the longest prefix every candidate shares rather than jumping to
 * the first match — `/stream` is also a prefix of `/stream-close`, so guessing
 * either one would be wrong half the time. A single match completes fully and
 * gains a trailing space, since every such command either takes arguments or is
 * about to be submitted.
 */
export function completeCommand(line: string): string | null {
  // Only the command word completes; once there's a space the rest is an
  // argument (a filename, a step) that this cannot know anything about.
  if (!line.startsWith('/') || line.includes(' ')) return null;

  // Complete against whatever actually matched — the alias if that's what was
  // typed, not the canonical name. Otherwise "/co" would rewrite itself to
  // "/settings", replacing the prefix rather than extending it.
  const q = line.toLowerCase();
  const candidates: string[] = [];
  for (const command of COMMANDS) {
    if (command.name.toLowerCase().startsWith(q)) candidates.push(command.name);
    for (const alias of command.aliases ?? []) {
      if (alias.toLowerCase().startsWith(q)) candidates.push(alias);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return `${candidates[0]} `;

  let prefix = candidates[0];
  for (const candidate of candidates.slice(1)) {
    while (!candidate.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return null;
    }
  }
  return prefix.length > line.length ? prefix : null;
}

/** Resolve a full command line (e.g. "/device") to its spec, ignoring trailing args. */
export function resolveCommand(line: string): PaletteCommand | undefined {
  const head = line.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!head) return undefined;
  return COMMANDS.find(
    (c) => c.name.toLowerCase() === head || c.aliases?.some((a) => a.toLowerCase() === head)
  );
}

/**
 * Execute one submitted line from the main screen's instruction box.
 * A leading "/" dispatches to the matching palette command; anything else is
 * one natural-language instruction, executed on device and recorded.
 */
export async function executeLine(line: string, actions: TuiActions): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Clear any stale feedback from a previous mistyped line before evaluating
  // this one — it re-appears below if this line is also invalid.
  tuiStore.setPaletteError(null);

  if (trimmed.startsWith('/')) {
    const head = trimmed.split(/\s+/, 1)[0] ?? trimmed;
    let cmd = resolveCommand(trimmed);
    if (!cmd) {
      // The palette advertises "type to filter, Enter to run", so honor a
      // uniquely-matching prefix — e.g. "/dev" runs /device.
      const candidates = matchCommands(head);
      if (candidates.length === 1) cmd = candidates[0];
    }
    if (!cmd) {
      // Inline-only, right under the input — that's where the user is
      // actually looking right after pressing enter. Also logging this to
      // the transcript would duplicate it a second time further down.
      tuiStore.setPaletteError(`Unknown command: ${trimmed} — try /help`);
      return;
    }
    // Slice off what the user actually typed (alias or prefix), not the
    // canonical name — their lengths can differ.
    const args = trimmed.slice(head.length).trim();
    await cmd.run(actions, args);
    return;
  }

  await actions.runInstruction(trimmed);
}
