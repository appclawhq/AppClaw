/**
 * `appclaw --tui` entry point.
 *
 * Mounts the multi-screen Ink app (TuiApp) and implements TuiActions — the
 * side-effecting surface screens and commands call into: platform/device
 * selection (which lazily opens one Appium/MCP session, reused across every
 * line typed afterwards), settings read/write, run history, the device mirror
 * (`/stream` shows frames in the main screen's right-hand panel), and the two
 * execution modes below.
 *
 * Execution modes: a plain line is ONE deterministic instruction
 * (`runInstruction` → runOneInstruction) that gets recorded into
 * `store.steps` — the TUI is a step recorder, and
 * `/list`, `/yaml`, `/export`… operate on that list. `/goal` opts into the
 * autonomous agent loop instead.
 *
 * Scope note: `/goal` calls `runAgent` directly (one flat agent loop per
 * submitted goal) rather than the CLI's full multi-sub-goal
 * planner/orchestrator (decomposeGoal + screen-readiness reconciliation) —
 * that keeps this surface simple for iterative, REPL-style use. For a single
 * complex multi-step goal, `appclaw "goal"` outside the TUI still applies
 * the full planner.
 */

import React from 'react';
import { render } from 'ink';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { refreshConfig, Config, type AppClawConfig } from '@appclaw/core/config';
import { createMCPClient } from '@appclaw/core/mcp/client';
import { createLLMProvider } from '@appclaw/core/llm/provider';
import { setupDevice } from '@appclaw/core/device/index';
import { AppResolver } from '@appclaw/core/agent/app-resolver';
import { runAgent } from '@appclaw/core/agent/loop';
import { tryParseNaturalFlowLine } from '@appclaw/core/flow/natural-line';
import { runOneInstruction, DEFAULT_MIN_MATCH_SCORE } from '@appclaw/core/flow/run-instruction';
import { stepAction, stepTarget } from '@appclaw/core/ui/step-printer';
import { listRunningDevices } from '@appclaw/core/device/emulator-list';
import { loadRunIndex } from '@appclaw/core/report/writer';
import { DEFAULT_MODELS } from '@appclaw/core/constants';
import { setRenderer, type UIRenderer } from '@appclaw/core/ui/renderer';
import type { FlowStep } from '@appclaw/core/flow/types';

import { COLORS, symbols } from '../ui/ink/theme.js';

import { TuiApp } from './TuiApp.js';
import {
  tuiStore,
  getSnapshot,
  subscribe,
  type Platform,
  type DeviceSummary,
  type RunSummary,
} from './store.js';
import {
  createSessionLog,
  setCurrentSessionLog,
  listSessions,
  sessionSucceeded,
  SESSIONS_DIRNAME,
} from './session-log.js';
import type { TuiActions } from './commands.js';
import { getDeviceResolution } from './stream/capture.js';
import { startStreamLoop, stopStreamLoop } from './stream/frame-loop.js';
import { detectStreamBackend, backendLabel } from './stream/terminal-caps.js';
import { fetchScreenInfo } from '../step-recorder/screen-info.js';
import { captureConsoleAsync } from './capture-console.js';
import { runDoctor } from '../cli/doctor.js';

export interface RunTuiOptions {
  platform: Platform | null;
  deviceType: 'simulator' | 'real' | null;
  udid: string | null;
  deviceName: string | null;
  /** `--export-dir`: default directory for bare-filename `/export` writes. */
  exportDir?: string | null;
}

/**
 * Ink has no built-in full-screen mode — left alone, it renders inline in
 * the normal scrollback, and any frame taller than the terminal scrolls off
 * permanently (each redraw then stacks a new copy below the last). Entering
 * the terminal's alternate screen buffer (same mechanism vim/htop/Claude
 * Code use) gives the TUI a real, self-contained viewport instead, and
 * restores whatever was on screen before when we leave it.
 */
function enterAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?1049h\x1b[?25l');
}
function exitAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h\x1b[?1049l');
}

/** Config keys the settings screen exposes — a curated subset, not the full schema. */
const SETTINGS_KEYS: Array<{ key: keyof AppClawConfig; description: string }> = [
  { key: 'LLM_PROVIDER', description: 'anthropic | openai | gemini | groq | ollama' },
  { key: 'LLM_MODEL', description: 'blank = provider default' },
  { key: 'AGENT_MODE', description: 'dom | vision' },
  { key: 'PLATFORM', description: 'android | ios | blank (prompt)' },
  { key: 'MAX_STEPS', description: 'per-goal step budget' },
  { key: 'WAIT_TIMEOUT', description: 'implicit wait, ms' },
];

/**
 * Routes core's imperative spinner calls into the store instead of letting
 * them animate raw ANSI (cursor-hide, \r repaint) straight to stdout, which
 * fights Ink for the same lines. Streaming is swallowed for the same reason.
 */
const tuiRenderer: Partial<UIRenderer> = {
  startSpinner(message, detail) {
    tuiStore.setBusy(message, detail);
  },
  updateSpinner(message, detail) {
    const s = getSnapshot();
    tuiStore.setBusy(message ?? s.busyMessage, detail ?? s.busyDetail);
  },
  stopSpinner() {
    tuiStore.clearBusy();
  },
  startStreaming() {},
  streamChunk() {},
  stopStreaming() {},
};

/** Transcript row for a step that just got recorded: "✓ tap  Login  (0.8s)". */
function logRecorded(step: FlowStep, message: string, ms?: number): void {
  const duration = ms == null ? '' : ms < 1000 ? `  (${ms}ms)` : `  (${(ms / 1000).toFixed(1)}s)`;
  tuiStore.log(
    'step',
    `${symbols.check} ${stepAction(step)} ${stepTarget(step)}${duration}`,
    message && message !== 'recorded' ? message : undefined
  );
}

/** Run a getInfo query and put the answer in the transcript (never recorded as a step). */
async function showScreenInfo(mcp: Parameters<typeof fetchScreenInfo>[0], query: string) {
  const res = await fetchScreenInfo(mcp, query);
  if (!res.ok) {
    tuiStore.log(
      'error',
      res.reason === 'error' ? `Failed to get info: ${res.message}` : res.message
    );
    return;
  }
  tuiStore.log('result', res.answer, res.explanation);
}

interface DeviceSession {
  mcpClient: Awaited<ReturnType<typeof createMCPClient>>;
  scopedMcp: Awaited<ReturnType<typeof createMCPClient>>;
  llm: ReturnType<typeof createLLMProvider>;
  appResolver: AppResolver;
  platform: Platform;
  modelName: string;
}

export async function runTui(opts: RunTuiOptions): Promise<void> {
  const config = refreshConfig();
  tuiStore.reset();
  tuiStore.setExportDir(opts.exportDir ?? null);

  const sessionLog = createSessionLog(process.cwd());
  setCurrentSessionLog(sessionLog);

  // Mirror the recorded flow into the log whenever it changes, rather than
  // calling setFlow from each of /undo, /edit, /insert, /delete and /clear —
  // the store is the one place every mutation already passes through.
  let loggedSteps = getSnapshot().steps;
  let loggedMeta = getSnapshot().meta;
  subscribe(() => {
    const snapshot = getSnapshot();
    if (snapshot.steps === loggedSteps && snapshot.meta === loggedMeta) return;
    loggedSteps = snapshot.steps;
    loggedMeta = snapshot.meta;
    sessionLog.setFlow(snapshot.steps, snapshot.meta);
  });

  let session: DeviceSession | null = null;
  let quitting = false;
  /** Generation token so a stale device-list response can't clobber a newer one. */
  let devicesReq = 0;

  /**
   * Stop the frame loop (which also deletes the kitty image and its temp dir)
   * and clear the panel state. Shared by /stream-close, device switches and
   * quit, so no caller has to check whether a stream is running first.
   */
  function resetStream(): void {
    stopStreamLoop();
    tuiStore.setStream({
      status: 'idle',
      error: undefined,
      backend: undefined,
      resolution: undefined,
      frameLines: undefined,
    });
  }

  /** Tear down the current Appium session + appium-mcp subprocess, if any. */
  async function closeSession(): Promise<void> {
    if (!session) return;
    const old = session;
    session = null;
    try {
      await old.mcpClient.callTool('appium_session_management', { action: 'delete' });
    } catch {
      /* ignore */
    }
    try {
      await old.mcpClient.close();
    } catch {
      /* ignore */
    }
  }

  async function connect(platform: Platform, udid: string): Promise<void> {
    // A stream is bound to one udid — carrying it across a device switch would
    // keep screencapping the device the user just left.
    resetStream();
    // /device supports re-picking — close the previous session first, or each
    // switch would orphan an appium-mcp subprocess and its Appium session.
    await closeSession();
    tuiStore.setConnecting(true);
    tuiStore.setBusy('Starting appium-mcp…');
    let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
    try {
      mcpClient = await createMCPClient({
        transport: config.MCP_TRANSPORT,
        host: config.MCP_HOST,
        port: config.MCP_PORT,
        url: config.MCP_URL || undefined,
      });
      const availableTools = await mcpClient.listTools();
      const llm = createLLMProvider(config, availableTools);
      tuiStore.setBusy('Setting up device…');
      const deviceResult = await setupDevice(mcpClient, {
        cliPlatform: platform,
        cliDeviceType: opts.deviceType ?? (platform === 'ios' ? 'simulator' : null),
        cliUdid: udid,
        cliDeviceName: null,
        config,
      });
      const appResolver = new AppResolver();
      tuiStore.setBusy('Loading installed apps…');
      await appResolver.initialize(deviceResult.scopedMcp, deviceResult.platform);
      const modelName = config.LLM_MODEL || DEFAULT_MODELS[config.LLM_PROVIDER] || 'default';

      session = {
        mcpClient,
        scopedMcp: deviceResult.scopedMcp,
        llm,
        appResolver,
        platform: deviceResult.platform,
        modelName,
      };
      tuiStore.setConnecting(false);
      tuiStore.setStatusMessage('');
      // Seed flow metadata so an exported YAML/spec carries the platform it was
      // recorded against — /meta platform still wins if the user sets it.
      if (!getSnapshot().meta.platform) tuiStore.setMeta({ platform: deviceResult.platform });
      sessionLog.setDevice(deviceResult.platform, {
        name: deviceResult.deviceName,
        udid: deviceResult.deviceUdid,
      });
      sessionLog.setLlm(config.LLM_PROVIDER, modelName, config.AGENT_MODE);
      tuiStore.log('info', `Connected — ${deviceResult.deviceName} (${deviceResult.platform})`);
      tuiStore.goTo('main');
    } catch (err) {
      // Don't leak the appium-mcp subprocess spawned before the failure.
      if (mcpClient) {
        try {
          await mcpClient.close();
        } catch {
          /* ignore */
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      tuiStore.setConnecting(false);
      tuiStore.setStatusMessage('');
      // The picker doesn't render the transcript, so surface the failure in
      // the error slot it does render — otherwise a failed connect looks like
      // a silent no-op — and clear the not-actually-connected selection.
      tuiStore.selectDevice(null);
      tuiStore.setDevicesError(`Connection failed: ${message}`);
      tuiStore.log('error', 'Device connection failed', message);
      tuiStore.goTo('device-picker');
    }
  }

  const actions: TuiActions = {
    selectPlatform(platform) {
      tuiStore.setPlatform(platform);
      actions.goToDevicePicker();
    },

    async selectDevice(device: DeviceSummary) {
      tuiStore.selectDevice(device);
      await connect(device.platform, device.udid);
    },

    goToDevicePicker() {
      const platform = getSnapshot().platform;
      if (!platform) {
        tuiStore.log('warn', 'Pick a platform first', '/platform');
        return;
      }
      const req = ++devicesReq;
      tuiStore.setDevicesLoading(true);
      tuiStore.goTo('device-picker');
      listRunningDevices(platform)
        .then((devices) => {
          if (req !== devicesReq) return; // stale response (platform switched / refreshed)
          tuiStore.setDevices(devices);
          if (devices.length === 0) {
            // listRunningDevices never rejects (missing adb/Xcode returns []),
            // so give the empty state a diagnosis pointer.
            tuiStore.setDevicesError(
              platform === 'android'
                ? // No key hints here — the picker has no command input, so it
                  // renders its own ("d run doctor · r refresh") beneath this.
                  'Is adb on PATH and an emulator booted?'
                : 'Is Xcode installed and a simulator booted?'
            );
          }
        })
        .catch((err) => {
          if (req !== devicesReq) return;
          tuiStore.setDevicesError(err instanceof Error ? err.message : String(err));
        });
    },

    goToPlatformPicker() {
      tuiStore.goTo('welcome');
    },

    goToMain() {
      tuiStore.goTo('main');
    },

    goToSettings() {
      tuiStore.setSettingsLoading(true);
      tuiStore.goTo('settings');
      const fields = SETTINGS_KEYS.map(({ key, description }) => ({
        key: key as string,
        value: String(Config[key] ?? ''),
        description,
      }));
      tuiStore.setSettingsFields(fields);
    },

    async saveSettings() {
      const { settingsFields } = getSnapshot();
      const envPath = resolve(process.cwd(), '.env');
      let lines: string[] = [];
      if (existsSync(envPath)) {
        lines = (await readFile(envPath, 'utf-8')).split('\n');
      }
      for (const field of settingsFields) {
        const idx = lines.findIndex((l) => l.startsWith(`${field.key}=`));
        const line = `${field.key}=${field.value}`;
        if (idx >= 0) lines[idx] = line;
        else lines.push(line);
        // refreshConfig() re-parses process.env (dotenv only runs at startup),
        // so mirror the new value there or the save wouldn't take effect until
        // the next launch.
        process.env[field.key] = field.value;
      }
      await writeFile(envPath, lines.join('\n'), 'utf-8');
      refreshConfig();
      tuiStore.markSettingsSaved();
      tuiStore.log(
        'info',
        'Settings saved to .env',
        session ? 'Reconnect (/device) for provider/model changes to apply' : undefined
      );
    },

    goToHistory() {
      tuiStore.setHistoryLoading(true);
      tuiStore.goTo('history');
      // Flow runs and recording sessions are separate stores on disk; /history
      // is the one place a user looks for "what have I run", so merge them.
      // A failure to read either must not blank the other.
      Promise.allSettled([loadRunIndex(process.cwd()), listSessions(process.cwd())])
        .then(([runsResult, sessionsResult]) => {
          const flows: RunSummary[] =
            runsResult.status === 'fulfilled'
              ? runsResult.value.runs.map((r) => ({
                  runId: r.runId,
                  source: 'flow' as const,
                  dir: `.appclaw/runs/${r.runId}`,
                  goal: r.flowName || r.flowFile,
                  success: r.success,
                  startedAt: r.startedAt,
                  durationMs: r.durationMs,
                  stepsExecuted: r.stepsExecuted,
                  stepsTotal: r.stepsTotal,
                  platform: r.platform,
                }))
              : [];

          const sessions: RunSummary[] =
            sessionsResult.status === 'fulfilled'
              ? sessionsResult.value.map((s) => {
                  const failures = s.events.filter((e) => e.ok === false).length;
                  const finished = s.finishedAt ? Date.parse(s.finishedAt) : null;
                  return {
                    runId: s.sessionId,
                    source: 'session' as const,
                    dir: `${SESSIONS_DIRNAME}/${s.sessionId}.json`,
                    goal: s.meta.name || `${s.steps.length} recorded step(s)`,
                    success: sessionSucceeded(s),
                    startedAt: s.startedAt,
                    durationMs: finished ? finished - Date.parse(s.startedAt) : undefined,
                    stepsExecuted: s.steps.length,
                    stepsTotal: s.steps.length,
                    platform: s.platform,
                    device: s.device?.name,
                    model: s.llm ? `${s.llm.provider}/${s.llm.model}` : undefined,
                    failures,
                    exports: s.exports,
                    live: !s.finishedAt,
                  };
                })
              : [];

          const failed = [runsResult, sessionsResult].find((r) => r.status === 'rejected');
          if (flows.length === 0 && sessions.length === 0 && failed) {
            tuiStore.setHistoryError(String((failed as PromiseRejectedResult).reason));
            return;
          }
          tuiStore.setHistory(
            [...flows, ...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
          );
        })
        .catch((err) => tuiStore.setHistoryError(err instanceof Error ? err.message : String(err)));
    },

    /**
     * In-terminal mirror, shown in the main screen's right-hand panel so the
     * command palette and instruction input stay usable while it runs. No
     * browser and no second window — just adb screencap on a timer, fed to
     * stream/frame-loop.ts, which works the same for an emulator, a physical
     * device or a headless emulator.
     */
    async openStream() {
      const { device } = getSnapshot();
      if (!device) {
        tuiStore.log('warn', 'No device selected', '/device');
        return;
      }
      if (device.platform !== 'android') {
        // Capture is `adb exec-out screencap`; iOS simulators have no
        // equivalent that streams into a pipe.
        const message =
          'In-terminal streaming is Android-only (adb screencap). For an iOS simulator, use the Simulator app window.';
        tuiStore.setStream({ status: 'error', error: message });
        tuiStore.log('warn', 'Stream not available for iOS', message);
        return;
      }

      // Set before startStreamLoop: the panel has to be in its streaming
      // layout (and therefore the right height) before the first frame is
      // painted into it.
      tuiStore.setStream({
        status: 'starting',
        error: undefined,
        frameLines: undefined,
      });
      const backend = detectStreamBackend();
      try {
        // Read once up front: the kitty path hands the PNG to the terminal
        // without decoding it, so this is the only source of the aspect ratio
        // the cell box is sized from.
        const resolution = await getDeviceResolution(device.udid);
        startStreamLoop({
          udid: device.udid,
          deviceWidth: resolution.width,
          deviceHeight: resolution.height,
          backend,
          // Half-blocks are text, so they go through the store and Ink renders
          // them; the kitty backend never calls this (it writes pixels itself).
          onFrame: (lines) => tuiStore.setStreamFrame(lines),
          onError: (message) => {
            // The loop has already stopped itself; the panel keeps showing the
            // reason instead of flashing it past in the transcript.
            tuiStore.setStream({ status: 'error', error: message, frameLines: undefined });
            tuiStore.log('error', 'Screen stream stopped', message);
          },
        });
        tuiStore.setStream({
          status: 'running',
          backend,
          resolution,
          error: undefined,
        });
        tuiStore.log(
          'info',
          `Streaming ${device.name} in the side panel (${backendLabel(backend)})`,
          '/stream-close stops it — the input stays usable meanwhile'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stopStreamLoop();
        tuiStore.setStream({
          status: 'error',
          error: message,
          frameLines: undefined,
        });
        tuiStore.log('error', 'Could not start the screen stream', message);
      }
    },

    /** Stops the mirror and clears the panel. */
    closeStream() {
      resetStream();
    },

    async runDoctor() {
      tuiStore.openViewerPending('appclaw doctor', 'environment preflight');
      const { result, lines } = await captureConsoleAsync(() => runDoctor([]));
      const code = result ?? 1;
      tuiStore.showViewer({
        title: 'appclaw doctor',
        subtitle: 'environment preflight',
        lines,
        // No tint — doctor's lines already carry their own chalk colouring.
        status:
          code === 0
            ? { color: COLORS.green, text: `${symbols.check} All checks passed` }
            : { color: COLORS.yellow, text: `${symbols.warning} Issues found — see above` },
      });
      tuiStore.log(
        code === 0 ? 'result' : 'warn',
        code === 0 ? 'doctor: all checks passed' : 'doctor: issues found'
      );
    },

    /**
     * One deterministic instruction — the shared per-line pipeline
     * (vision → regex → LLM → executeStep, via runOneInstruction), with the
     * same two early-outs for bookkeeping-only kinds that never touch the
     * device: `done` is recorded without executing, `getInfo` is answered by
     * a separate vision call and is NOT recorded.
     */
    async runInstruction(instruction: string) {
      if (!session) {
        tuiStore.log('warn', 'No device connected yet', '/device to pick one');
        return;
      }
      const active = session;
      tuiStore.log('goal', instruction);

      const earlyParse = tryParseNaturalFlowLine(instruction);
      if (earlyParse?.kind === 'done') {
        tuiStore.pushStep(earlyParse);
        logRecorded(earlyParse, 'recorded');
        return;
      }
      if (earlyParse?.kind === 'getInfo') {
        await showScreenInfo(active.scopedMcp, earlyParse.query);
        return;
      }

      const t0 = performance.now();
      let outcome: Awaited<ReturnType<typeof runOneInstruction>>;
      // The pipeline's own spinner calls come and go; seed the busy text so the
      // disabled input reads "Executing <line>" rather than a bare "working…".
      tuiStore.setBusy('Executing', instruction);
      try {
        outcome = await runOneInstruction(active.scopedMcp, instruction, {
          appResolver: active.appResolver,
          minMatchScore: DEFAULT_MIN_MATCH_SCORE,
        });
      } catch (err) {
        tuiStore.log(
          'error',
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
          'Type /help to see supported patterns'
        );
        return;
      } finally {
        tuiStore.clearBusy();
      }
      const elapsedMs = Math.round(performance.now() - t0);

      // Vision read the line as a "what's on screen" question — no device
      // action happened, so there is nothing to record.
      if (outcome.isGetInfo) {
        const answer = outcome.getInfoAnswer || outcome.result.message;
        tuiStore.log('result', answer, outcome.getInfoExplanation);
        return;
      }
      // `done` / `getInfo` resolved by the LLM fallback rather than the regex above.
      if (outcome.step.kind === 'getInfo') {
        await showScreenInfo(active.scopedMcp, outcome.step.query);
        return;
      }
      if (outcome.step.kind === 'done') {
        tuiStore.pushStep(outcome.step);
        logRecorded(outcome.step, 'recorded');
        sessionLog.record({
          kind: 'instruction',
          input: instruction,
          ok: true,
          step: outcome.step,
        });
        return;
      }

      if (outcome.result.success) {
        tuiStore.pushStep(outcome.step);
        logRecorded(outcome.step, outcome.result.message, elapsedMs);
        sessionLog.record({
          kind: 'instruction',
          input: instruction,
          ok: true,
          message: outcome.result.message,
          durationMs: elapsedMs,
          step: outcome.step,
        });
        return;
      }
      const hint =
        outcome.step.kind === 'tap' && outcome.closestMatch
          ? `Closest match: "${outcome.closestMatch}". Try: tap on ${outcome.closestMatch}`
          : null;
      tuiStore.log(
        'error',
        `${symbols.cross} ${stepAction(outcome.step)} ${stepTarget(outcome.step)}`,
        [outcome.result.message, hint, 'Step not recorded. Fix and try again.']
          .filter((l): l is string => !!l)
          .join('\n')
      );
      sessionLog.record({
        kind: 'instruction',
        input: instruction,
        ok: false,
        message: outcome.result.message,
        durationMs: elapsedMs,
      });
    },

    async runGoal(goal: string) {
      if (!session) {
        tuiStore.log('warn', 'No device connected yet', '/device to pick one');
        return;
      }
      const active = session;
      tuiStore.log('goal', goal);
      try {
        const result = await runAgent({
          goal,
          displayGoal: goal,
          mcp: active.scopedMcp,
          llm: active.llm,
          appResolver: active.appResolver,
          maxSteps: config.MAX_STEPS,
          stepDelay: config.STEP_DELAY,
          maxElements: config.MAX_ELEMENTS,
          visionMode: config.VISION_MODE,
          modelName: active.modelName,
          onStep: (event) => {
            // The final "done" step's message is the same text as the
            // Done/Failed summary logged right after runAgent resolves —
            // showing both back-to-back is a duplicate, not new information.
            if (event.decision.toolName === 'done') return;
            tuiStore.log('step', `${event.step}. ${event.decision.toolName}`, event.result.message);
          },
        });
        tuiStore.log(
          result.success ? 'result' : 'error',
          result.success ? `Done — ${result.reason}` : `Failed — ${result.reason}`
        );
        sessionLog.record({
          kind: 'goal',
          input: goal,
          ok: result.success,
          message: result.reason,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tuiStore.log('error', 'Goal execution error', message);
        sessionLog.record({ kind: 'goal', input: goal, ok: false, message });
      } finally {
        active.llm.resetHistory();
      }
    },

    async quit() {
      if (quitting) return;
      quitting = true;
      // Don't let a wedged Appium/MCP teardown trap the user in the TUI.
      const hardExit = setTimeout(() => process.exit(0), 5000);
      hardExit.unref();
      try {
        sessionLog.finish();
        // Also clears the frame loop's temp dir and its lingering kitty image
        // placement, which would otherwise outlive the process on screen.
        resetStream();
        await closeSession();
      } finally {
        clearTimeout(hardExit);
        setRenderer(null);
        instance.unmount();
        exitAltScreen();
        process.exit(0);
      }
    },
  };

  enterAltScreen();
  setRenderer(tuiRenderer);
  // Safety net for any exit path that skips actions.quit() (uncaught
  // exception, Ink itself throwing) — otherwise the user's shell is left
  // stuck showing the alt screen after the process is already gone.
  process.once('exit', exitAltScreen);

  const instance = render(React.createElement(TuiApp, { actions }), {
    // Route core's console output (doctor, agent-loop fallbacks) above the
    // frame instead of interleaving with it.
    patchConsole: true,
    exitOnCtrlC: false,
  });
  // Ctrl+C is handled inside TuiApp (raw mode suppresses tty SIGINT, so a
  // process-level SIGINT handler alone can never fire while the app is
  // mounted). These cover `kill -INT/-TERM/-HUP` — without them, Ink's
  // signal-exit hook would re-raise and die with no session/child cleanup.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      void actions.quit();
    });
  }

  if (opts.platform) {
    actions.selectPlatform(opts.platform);
    if (opts.udid) {
      const devices = await listRunningDevices(opts.platform);
      const match = devices.find((d) => d.udid === opts.udid) ?? {
        name: opts.deviceName || opts.udid,
        udid: opts.udid,
        state: 'unknown',
        platform: opts.platform,
      };
      await actions.selectDevice(match);
    }
  }

  // Keep runTui alive until the app unmounts for any reason (React render
  // error, external unmount) and still run cleanup — quit() is idempotent.
  await instance.waitUntilExit();
  await actions.quit();
}
