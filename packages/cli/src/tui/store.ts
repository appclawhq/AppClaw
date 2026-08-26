/**
 * TUI store — observable state for the `appclaw --tui` shell.
 *
 * A small custom pub/sub (subscribe + snapshot,
 * consumed via React's useSyncExternalStore) so the two Ink surfaces stay
 * consistent. This store additionally owns screen routing, since the TUI is
 * multi-screen, so one store backs several screens.
 */

import type { FlowStep, FlowMeta } from '@appclaw/core/flow/types';
import type { Language } from './highlight.js';

export type TuiScreen = 'welcome' | 'device-picker' | 'main' | 'settings' | 'history';

export type Platform = 'android' | 'ios';

export interface DeviceSummary {
  name: string;
  udid: string;
  /** "Booted" | "Shutdown" | "device" | "offline" | "unauthorized" | ... */
  state: string;
  platform: Platform;
  /** e.g. iOS runtime version */
  hint?: string;
}

export type TranscriptKind = 'info' | 'warn' | 'error' | 'step' | 'goal' | 'result' | 'command';

export interface TranscriptEntry {
  id: number;
  kind: TranscriptKind;
  text: string;
  detail?: string;
  ts: number;
}

export type StreamStatus = 'idle' | 'starting' | 'running' | 'error';

/** `/stream` — the device mirror shown in the main screen's right-hand panel. */
export interface StreamState {
  status: StreamStatus;
  error?: string;
  /**
   * The current half-block frame, one string per cell row, rendered by
   * <StreamPanel> as ordinary Ink content. Only the half-block backend uses
   * this: its output is text, so letting Ink own those cells costs nothing and
   * makes the picture immune to repaints. The kitty backend has real pixels,
   * which no component output can express — it writes to stdout instead and
   * leaves this undefined.
   */
  frameLines?: string[];
  /** Which renderer the terminal turned out to support — shown in the panel's status line. */
  backend?: 'kitty' | 'halfblock';
  resolution?: { width: number; height: number };
}

/**
 * One row in /history. Two things land here: YAML flow runs from
 * `.appclaw/runs/` and TUI recording sessions from `.appclaw/sessions/`.
 * They're different enough to label but similar enough to browse together.
 */
export interface RunSummary {
  runId: string;
  source: 'flow' | 'session';
  dir: string;
  goal: string;
  success: boolean;
  startedAt: string;
  durationMs?: number;
  stepsExecuted?: number;
  stepsTotal?: number;
  platform?: string;
  reportPath?: string;
  /** Sessions only: device, model and what went wrong, for the detail pane. */
  device?: string;
  model?: string;
  failures?: number;
  exports?: string[];
  /** Sessions only: still open (no finishedAt) — usually the run you're in now. */
  live?: boolean;
}

export interface TuiState {
  screen: TuiScreen;
  platform: Platform | null;
  device: DeviceSummary | null;
  devices: DeviceSummary[];
  devicesLoading: boolean;
  devicesError: string | null;

  /**
   * The recorded flow — the TUI is a step recorder first, so a
   * plain instruction line appends here and every /list, /yaml, /export,
   * /edit… command reads or edits this list.
   */
  steps: FlowStep[];
  meta: FlowMeta;
  /**
   * `--export-dir` override for bare-filename SDK-test exports. Stored rather
   * than threaded through TuiActions because only /export reads it.
   */
  exportDir: string | null;
  /**
   * Quitting with unexported steps asks first. A modal rather than the
   * "type /quit again" convention: the warning used to go to the
   * transcript, which the screens offering the `q` shortcut don't even render.
   */
  quitConfirmOpen: boolean;

  transcript: TranscriptEntry[];
  running: boolean;
  paletteQuery: string;
  /** Inline feedback shown right under the instruction input (e.g. a typo'd command) — separate from the transcript, which scrolls out of view. */
  paletteError: string | null;

  stream: StreamState;

  settingsFields: Array<{ key: string; value: string; description?: string }>;
  settingsLoading: boolean;
  settingsDirty: boolean;
  settingsSaved: boolean;

  history: RunSummary[];
  historyLoading: boolean;
  historyError: string | null;
  historySelected: number;

  statusMessage: string;

  /**
   * Live progress text, fed by the registered UIRenderer's spinner hooks —
   * core's device-setup pipeline reports through those (e.g. "Creating Appium
   * session..."), which would otherwise animate raw ANSI over the Ink frame.
   */
  busyMessage: string;
  busyDetail?: string;
  /** Show that progress as a modal dialog (device setup) rather than inline. */
  connecting: boolean;

  /**
   * Full-screen scrollable output modal, shared by everything whose output is
   * too big for the transcript pane: `appclaw doctor`, and the generated
   * YAML/spec bodies from /yaml, /preview and /export. The transcript is a
   * handful of rows tall, so dumping a file into it truncated the content and
   * buried the step log.
   */
  viewerOpen: boolean;
  viewerTitle: string;
  viewerSubtitle?: string;
  viewerLines: string[];
  /** Still producing output (doctor) — shows a spinner instead of the body. */
  viewerRunning: boolean;
  /** Closing verdict line, e.g. doctor's pass/fail or an export's file path. */
  viewerStatus?: { color: string; text: string };
  /** Colour applied to every body line; omit for output that carries its own ANSI (doctor). */
  viewerTint?: string;
  /** Syntax-highlight the body (generated YAML / runner specs). */
  viewerLanguage?: Language;
}

function initial(): TuiState {
  return {
    screen: 'welcome',
    platform: null,
    device: null,
    devices: [],
    devicesLoading: false,
    devicesError: null,

    steps: [],
    meta: {},
    exportDir: null,
    quitConfirmOpen: false,

    transcript: [],
    running: false,
    paletteQuery: '',
    paletteError: null,

    stream: { status: 'idle' },

    settingsFields: [],
    settingsLoading: false,
    settingsDirty: false,
    settingsSaved: false,

    history: [],
    historyLoading: false,
    historyError: null,
    historySelected: 0,

    statusMessage: '',

    busyMessage: '',
    busyDetail: undefined,
    connecting: false,

    viewerOpen: false,
    viewerTitle: '',
    viewerSubtitle: undefined,
    viewerLines: [],
    viewerRunning: false,
    viewerStatus: undefined,
    viewerTint: undefined,
    viewerLanguage: undefined,
  };
}

const MAX_TRANSCRIPT = 500;

let state: TuiState = initial();
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function set(patch: Partial<TuiState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getSnapshot(): TuiState {
  return state;
}

export const tuiStore = {
  reset(): void {
    state = initial();
    nextId = 1;
    emit();
  },

  goTo(screen: TuiScreen): void {
    set({ screen });
  },

  setPlatform(platform: Platform): void {
    // Switching platform invalidates the previous platform's device list,
    // selection, and any stale listing error.
    set({ platform, devices: [], device: null, devicesError: null });
  },

  setDevices(devices: DeviceSummary[]): void {
    set({ devices, devicesLoading: false, devicesError: null });
  },
  setDevicesLoading(loading: boolean): void {
    set({ devicesLoading: loading, devicesError: loading ? null : state.devicesError });
  },
  setDevicesError(error: string): void {
    set({ devicesError: error, devicesLoading: false });
  },
  selectDevice(device: DeviceSummary | null): void {
    set({ device });
  },

  // ── Recorded flow ──
  // Every mutator replaces the array rather than mutating in place;
  // useSyncExternalStore compares by reference, so an in-place push would
  // never repaint the step count.
  pushStep(step: FlowStep): void {
    set({ steps: [...state.steps, step] });
  },
  /** Drop the last step and return it (null when empty) — powers /undo. */
  popStep(): FlowStep | null {
    if (state.steps.length === 0) return null;
    const steps = state.steps.slice();
    const removed = steps.pop()!;
    set({ steps });
    return removed;
  },
  insertStep(index: number, step: FlowStep): void {
    const steps = state.steps.slice();
    steps.splice(index, 0, step);
    set({ steps });
  },
  replaceStep(index: number, step: FlowStep): void {
    set({ steps: state.steps.map((s, i) => (i === index ? step : s)) });
  },
  /** Remove the step at `index` and return it (null when out of range). */
  deleteStep(index: number): FlowStep | null {
    if (index < 0 || index >= state.steps.length) return null;
    const steps = state.steps.slice();
    const [removed] = steps.splice(index, 1);
    set({ steps });
    return removed;
  },
  clearSteps(): void {
    set({ steps: [], meta: {} });
  },
  setMeta(patch: Partial<FlowMeta>): void {
    set({ meta: { ...state.meta, ...patch } });
  },
  setExportDir(exportDir: string | null): void {
    set({ exportDir });
  },
  setQuitConfirm(quitConfirmOpen: boolean): void {
    set({ quitConfirmOpen });
  },

  log(kind: TranscriptKind, text: string, detail?: string): void {
    const entry: TranscriptEntry = { id: nextId++, kind, text, detail, ts: Date.now() };
    const transcript = [...state.transcript, entry];
    // Long-lived REPL: only the tail is ever rendered, so cap retention.
    set({
      transcript:
        transcript.length > MAX_TRANSCRIPT ? transcript.slice(-MAX_TRANSCRIPT) : transcript,
    });
  },
  clearTranscript(): void {
    set({ transcript: [] });
  },
  setRunning(running: boolean): void {
    set({ running });
  },

  setPaletteQuery(paletteQuery: string): void {
    set({ paletteQuery });
  },
  setPaletteError(paletteError: string | null): void {
    set({ paletteError });
  },

  setStream(stream: Partial<StreamState>): void {
    set({ stream: { ...state.stream, ...stream } });
  },
  /**
   * Separate from setStream because it runs on every captured frame: it drops
   * the update unless a stream is actually live, so a frame that arrives just
   * after /stream-close can't resurrect a closed panel.
   */
  setStreamFrame(frameLines: string[]): void {
    if (state.stream.status === 'idle') return;
    set({ stream: { ...state.stream, frameLines } });
  },

  setSettingsFields(settingsFields: TuiState['settingsFields']): void {
    set({ settingsFields, settingsLoading: false, settingsDirty: false, settingsSaved: false });
  },
  setSettingsLoading(settingsLoading: boolean): void {
    set({ settingsLoading });
  },
  updateSettingField(key: string, value: string): void {
    set({
      settingsFields: state.settingsFields.map((f) => (f.key === key ? { ...f, value } : f)),
      settingsDirty: true,
      settingsSaved: false,
    });
  },
  markSettingsSaved(): void {
    set({ settingsDirty: false, settingsSaved: true });
  },

  setHistory(history: RunSummary[]): void {
    set({ history, historyLoading: false, historyError: null, historySelected: 0 });
  },
  setHistoryLoading(historyLoading: boolean): void {
    set({ historyLoading, historyError: historyLoading ? null : state.historyError });
  },
  setHistoryError(historyError: string): void {
    set({ historyError, historyLoading: false });
  },
  setHistorySelected(historySelected: number): void {
    set({ historySelected });
  },

  setStatusMessage(statusMessage: string): void {
    set({ statusMessage });
  },

  setBusy(busyMessage: string, busyDetail?: string): void {
    set({ busyMessage, busyDetail });
  },
  clearBusy(): void {
    set({ busyMessage: '', busyDetail: undefined });
  },
  setConnecting(connecting: boolean): void {
    set(connecting ? { connecting } : { connecting, busyMessage: '', busyDetail: undefined });
  },

  /** Open the modal in its "still working" state (doctor). */
  openViewerPending(viewerTitle: string, viewerSubtitle?: string): void {
    set({
      viewerOpen: true,
      viewerRunning: true,
      viewerTitle,
      viewerSubtitle,
      viewerLines: [],
      viewerStatus: undefined,
      viewerTint: undefined,
      viewerLanguage: undefined,
    });
  },
  /** Open (or fill) the modal with finished output. */
  showViewer(opts: {
    title: string;
    subtitle?: string;
    lines: string[];
    status?: { color: string; text: string };
    tint?: string;
    language?: Language;
  }): void {
    set({
      viewerOpen: true,
      viewerRunning: false,
      viewerTitle: opts.title,
      viewerSubtitle: opts.subtitle,
      viewerLines: opts.lines,
      viewerStatus: opts.status,
      viewerTint: opts.tint,
      viewerLanguage: opts.language,
    });
  },
  closeViewer(): void {
    set({
      viewerOpen: false,
      viewerRunning: false,
      viewerTitle: '',
      viewerSubtitle: undefined,
      viewerLines: [],
      viewerStatus: undefined,
      viewerTint: undefined,
      viewerLanguage: undefined,
    });
  },
};
