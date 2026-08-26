/**
 * Headless step-recorder bridge — `appclaw --json --playground`.
 *
 * Reads one instruction per line from stdin and emits NDJSON events on stdout.
 * The VS Code / Cursor extension drives this over a child process, so the
 * protocol (event names, field names, ordering) is a shipped contract: change
 * it only in lockstep with `vscode-extension/src/bridge.ts`.
 *
 * The interactive counterpart is `appclaw --tui`; this file deliberately keeps
 * its own small copies of the session helpers rather than sharing a module with
 * the TUI, so a TUI redesign can never shift the extension's wire behaviour.
 */

import readline from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, Config } from '@appclaw/core/config';
import { createMCPClient } from '@appclaw/core/mcp/client';
import { setupDevice } from '@appclaw/core/device/index';
import { AppResolver } from '@appclaw/core/agent/app-resolver';
import { tryParseNaturalFlowLine } from '@appclaw/core/flow/natural-line';
import { runOneInstruction, DEFAULT_MIN_MATCH_SCORE } from '@appclaw/core/flow/run-instruction';
import { isVisionLocateEnabled } from '@appclaw/core/vision/locate-enabled';
import type { FlowStep, FlowMeta } from '@appclaw/core/flow/types';
import type { MCPClient } from '@appclaw/core/mcp/types';
import { theme, printBox, printPanel } from '@appclaw/core/ui/terminal';
import * as ui from '@appclaw/core/ui/terminal';

import {
  buildYamlString as buildYaml,
  buildSdkTestString as buildSdkTest,
  isSdkTestFilename,
  resolveRecordedExportPath,
} from './flow-builder.js';
import { fetchScreenInfo } from './screen-info.js';

// ─── State ──────────────────────────────────────────────

interface BridgeState {
  steps: FlowStep[];
  meta: FlowMeta;
  mcp: MCPClient | null;
  appResolver: AppResolver | null;
}

const state: BridgeState = {
  steps: [],
  meta: {},
  mcp: null,
  appResolver: null,
};

/**
 * Minimum matchScore (1-10) required to execute a tap. Below this threshold,
 * vision found a loose match — surface the suggestion but don't execute.
 *
 * Sourced from `flow/run-instruction.ts` so the SDK, the TUI and this bridge
 * share one threshold (it used to be defined per-surface, which drifted).
 */
const MIN_MATCH_SCORE = DEFAULT_MIN_MATCH_SCORE;

/** YAML body for the current recording — delegates to the shared builder. */
function buildYamlString(): string {
  return buildYaml(state.steps, state.meta);
}

/** Runner-spec body for the current recording — delegates to the shared builder. */
function buildSdkTestString(): string {
  return buildSdkTest(state.steps, state.meta);
}

/** `/export` path resolution, with the `--export-dir` override applied. */
function resolveBridgeExportPath(filename: string, asSdkTest: boolean): string {
  return resolveRecordedExportPath(filename, asSdkTest, _deviceArgs.exportDir);
}

// ─── Device connection ──────────────────────────────────

let _resolvedPlatform: 'android' | 'ios' = 'android';

async function connectToDevice(): Promise<boolean> {
  const config = loadConfig();

  try {
    ui.startSpinner(`Connecting to appium-mcp (${config.MCP_TRANSPORT})…`);
    const mcpClient = await createMCPClient({
      transport: config.MCP_TRANSPORT,
      host: config.MCP_HOST,
      port: config.MCP_PORT,
      url: config.MCP_URL || undefined,
    });
    state.mcp = mcpClient;
    ui.stopSpinner();
    ui.printSetupOk('Connected to appium-mcp');

    // Full device setup pipeline (platform → device → iOS setup → session)
    const deviceResult = await setupDevice(mcpClient, {
      cliPlatform: _deviceArgs.platform ?? null,
      cliDeviceType: _deviceArgs.deviceType ?? null,
      cliUdid: _deviceArgs.udid ?? null,
      cliDeviceName: _deviceArgs.deviceName ?? null,
      config,
      alwaysPickDevice: true,
    });
    _resolvedPlatform = deviceResult.platform;

    // Auto-set platform in flow metadata so exported YAML includes it
    if (!state.meta.platform) {
      state.meta.platform = deviceResult.platform;
    }

    // Initialize app resolver for "open X app" commands
    ui.startSpinner('Loading installed apps…');
    const appResolver = new AppResolver();
    await appResolver.initialize(mcpClient, deviceResult.platform);
    state.appResolver = appResolver;
    ui.stopSpinner();
    ui.printSetupOk('App resolver ready');

    // Surface the effective interaction mode so a silent DOM fallback is never a
    // mystery. `isVisionMode()` (run-yaml-flow) requires BOTH AGENT_MODE=vision AND
    // vision-locate being configured — if vision is requested but not configured,
    // every command quietly runs against the DOM instead.
    const visionLocate = isVisionLocateEnabled();
    if (Config.AGENT_MODE === 'vision' && visionLocate) {
      ui.printSetupOk('Interaction mode: vision');
    } else if (Config.AGENT_MODE === 'vision' && !visionLocate) {
      ui.printWarning(
        'AGENT_MODE=vision is set, but vision-locate is not configured — running in DOM mode. ' +
          'Set GEMINI_API_KEY / STARK_VISION_API_KEY / STARK_VISION_BASE_URL (or LLM_PROVIDER=gemini) to enable vision.'
      );
    } else {
      ui.printSetupOk('Interaction mode: dom');
    }

    const readyContent = [
      `${theme.dim('Type commands to execute on device.')}`,
      '',
      `${theme.dim('Examples:')}`,
      `  ${theme.white('open youtube app')}`,
      `  ${theme.white('click on Search')}`,
      `  ${theme.white('type "hello"')}`,
    ].join('\n');
    console.log();
    printBox(readyContent, {
      title: 'Device connected',
      titleAlignment: 'left',
      borderColor: '#22C55E',
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
    });
    console.log();

    return true;
  } catch (err: any) {
    ui.stopSpinner();
    // Always write to stderr so IDE extensions can see the error
    process.stderr.write(`[playground] Connection failed: ${err?.message ?? err}\n`);
    if (err?.stack) process.stderr.write(`[playground] ${err.stack}\n`);
    ui.printError(`Failed to connect: ${err?.message ?? err}`);
    // AppClaw drives Appium through the appium-mcp subprocess, which it starts itself —
    // there is no separate "Appium server" to launch. A timeout (-32001) almost always
    // means appium-mcp couldn't start/handshake in time (e.g. a cold `npx` download on a
    // global install that doesn't bundle it), NOT that a server is missing.
    const errMsg = String(err?.message ?? err);
    const timedOut = errMsg.includes('-32001') || /timed out/i.test(errMsg);
    if (timedOut) {
      ui.printInfo(
        'AppClaw starts appium-mcp itself — no separate Appium server is needed. The MCP handshake ' +
          'timed out: on a first run appium-mcp may still be downloading via npx. Retry, or reinstall so ' +
          "it's bundled (e.g. npm i -g appclaw@latest). Set MCP_DEBUG=1 to see appium-mcp's startup logs."
      );
    } else {
      ui.printInfo(
        'AppClaw starts appium-mcp itself — no separate Appium server is needed. Make sure a ' +
          'device/emulator is connected. Set MCP_DEBUG=1 to see appium-mcp’s startup logs.'
      );
    }
    console.log();
    return false;
  }
}

async function cleanup(): Promise<void> {
  if (state.mcp) {
    try {
      await state.mcp.callTool('appium_session_management', { action: 'delete' });
    } catch {
      /* ignore — session may already be gone */
    }
    try {
      await state.mcp.close();
    } catch {
      /* ignore */
    }
  }
}

// ─── Screen queries (via vision getInfo) ─────────────

async function handleGetInfo(query: string): Promise<string | null> {
  if (!state.mcp) {
    console.log(`  ${theme.error('✗')} Not connected to device`);
    return null;
  }

  const res = await fetchScreenInfo(state.mcp, query);
  if (!res.ok) {
    console.log(
      res.reason === 'error'
        ? `  ${theme.error('✗')} Failed to get info: ${theme.error(res.message)}`
        : `  ${theme.error('✗')} ${res.message}`
    );
    return null;
  }

  console.log();
  const ansContent = res.explanation
    ? `${res.answer}\n\n${theme.dim(res.explanation)}`
    : res.answer;
  printPanel({ title: 'Answer', content: ansContent });
  console.log();
  return res.answer;
}

// ─── Entry point ────────────────────────────────────────

export interface PlaygroundDeviceArgs {
  platform?: 'android' | 'ios' | null;
  deviceType?: 'simulator' | 'real' | null;
  udid?: string | null;
  deviceName?: string | null;
  /**
   * Override directory for bare-filename SDK-test exports (`--export-dir`).
   * Takes precedence over the `EXPORT_DIR` config/env default. Ignored for
   * paths that already include a directory hint or are absolute.
   */
  exportDir?: string | null;
}

/** Stash device args so connectToDevice can use them */
let _deviceArgs: PlaygroundDeviceArgs = {};

/**
 * JSON-mode step recorder — reads commands from stdin (one per line),
 * emits NDJSON events to stdout. Used by IDE extensions.
 */
export async function runPlaygroundJson(deviceArgs?: PlaygroundDeviceArgs): Promise<void> {
  if (deviceArgs) _deviceArgs = deviceArgs;

  const { emitJson } = await import('@appclaw/core/json-emitter');

  let connectError: string | undefined;
  try {
    const connected = await connectToDevice();
    if (!connected) {
      connectError = 'connectToDevice returned false';
    }
  } catch (err: any) {
    connectError = err?.message ?? String(err);
  }

  if (connectError) {
    emitJson({ event: 'error', data: { message: `Failed to connect: ${connectError}` } });
    process.exit(1);
  }

  emitJson({ event: 'connected', data: { transport: 'stdio' } });
  emitJson({ event: 'device_ready', data: { platform: _resolvedPlatform } });

  // Graceful shutdown on SIGTERM (sent by VS Code extension bridge.stop())
  const gracefulShutdown = async () => {
    await cleanup();
    emitJson({ event: 'done', data: { success: true, totalSteps: state.steps.length } });
    process.exit(0);
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  if (process.stdin.isPaused()) process.stdin.resume();

  const rl = readline.createInterface({ input: process.stdin });
  let processing = false;

  rl.on('line', async (input: string) => {
    const line = input.trim();
    if (!line) return;

    if (processing) {
      emitJson({ event: 'error', data: { message: 'Still processing previous command' } });
      return;
    }

    processing = true;

    // Slash commands
    if (line.startsWith('/')) {
      if (line === '/quit' || line === '/exit' || line === '/q') {
        await cleanup();
        emitJson({ event: 'done', data: { success: true, totalSteps: state.steps.length } });
        rl.close();
        processing = false;
        return;
      }
      if (line === '/yaml') {
        if (state.steps.length === 0) {
          emitJson({
            event: 'flow_step',
            data: {
              step: 0,
              total: 0,
              kind: 'yaml',
              target: 'No steps to preview',
              status: 'failed',
            },
          });
        } else {
          const yamlStr = buildYamlString();
          emitJson({
            event: 'flow_step',
            data: {
              step: state.steps.length,
              total: state.steps.length,
              kind: 'yaml',
              target: yamlStr,
              status: 'passed',
            },
          });
        }
        processing = false;
        return;
      }
      if (line.startsWith('/export')) {
        const arg = line.slice(7).trim();
        const filename = arg || `flow-${Date.now()}.spec.ts`;
        const asSdkTest = isSdkTestFilename(filename);
        const filepath = resolveBridgeExportPath(filename, asSdkTest);
        if (state.steps.length === 0) {
          emitJson({
            event: 'flow_step',
            data: {
              step: 0,
              total: 0,
              kind: 'export',
              target: 'No steps to export',
              status: 'failed',
            },
          });
        } else {
          const body = asSdkTest ? buildSdkTestString() : buildYamlString();
          mkdirSync(path.dirname(filepath), { recursive: true });
          writeFileSync(filepath, body, 'utf-8');
          emitJson({
            event: 'flow_step',
            data: {
              step: state.steps.length,
              total: state.steps.length,
              kind: 'export',
              target: filepath,
              status: 'passed',
            },
          });
        }
        processing = false;
        return;
      }
      if (line === '/clear') {
        state.steps.length = 0;
        state.meta = {};
        emitJson({
          event: 'flow_step',
          data: { step: 0, total: 0, kind: 'clear', target: 'All steps cleared', status: 'passed' },
        });
        processing = false;
        return;
      }
      if (line === '/undo') {
        if (state.steps.length === 0) {
          emitJson({
            event: 'flow_step',
            data: { step: 0, total: 0, kind: 'undo', target: 'Nothing to undo', status: 'failed' },
          });
        } else {
          const removed = state.steps.pop()!;
          emitJson({
            event: 'flow_step',
            data: {
              step: state.steps.length,
              total: state.steps.length,
              kind: 'undo',
              target: removed.verbatim ?? removed.kind,
              status: 'passed',
            },
          });
        }
        processing = false;
        return;
      }
      if (line === '/list') {
        const stepsInfo = state.steps.map((s, i) => `${i + 1}. ${s.verbatim ?? s.kind}`).join('\n');
        emitJson({
          event: 'flow_step',
          data: {
            step: state.steps.length,
            total: state.steps.length,
            kind: 'list',
            target: stepsInfo || 'No steps yet',
            status: state.steps.length > 0 ? 'passed' : 'failed',
          },
        });
        processing = false;
        return;
      }
      // Unknown slash command
      emitJson({
        event: 'flow_step',
        data: {
          step: 0,
          total: 0,
          kind: 'info',
          target: `Unknown command: ${line}. Available: /yaml /export /list /undo /clear /quit`,
          status: 'failed',
        },
      });
      processing = false;
      return;
    }

    const stepNum = state.steps.length + 1;

    // ── Per-line execution (JSON mode) ──
    //
    // Same pipeline as the TUI's step recorder — both delegate to
    // runOneInstruction() so a fix to the instruction pipeline applies to all
    // surfaces at once. Only the IO layer (emit JSON event vs draw a frame)
    // differs here.
    if (!state.mcp) {
      emitJson({
        event: 'step',
        data: {
          step: stepNum,
          action: 'error',
          target: line,
          success: false,
          message: 'Not connected to device',
        },
      });
      processing = false;
      return;
    }

    // Early-outs for bookkeeping-only steps that don't need device execution.
    const earlyParse = tryParseNaturalFlowLine(line);
    if (earlyParse?.kind === 'done') {
      state.steps.push(earlyParse);
      emitJson({
        event: 'step',
        data: { step: stepNum, action: 'done', target: line, success: true, message: 'recorded' },
      });
      processing = false;
      return;
    }
    if (earlyParse?.kind === 'getInfo') {
      const infoAnswer = await handleGetInfo(earlyParse.query);
      emitJson({
        event: 'step',
        data: {
          step: stepNum,
          action: 'getInfo',
          target: line,
          success: true,
          message: infoAnswer || 'No answer',
        },
      });
      processing = false;
      return;
    }

    let outcome;
    try {
      outcome = await runOneInstruction(state.mcp, line, {
        appResolver: state.appResolver ?? undefined,
        minMatchScore: MIN_MATCH_SCORE,
      });
    } catch (err: any) {
      emitJson({
        event: 'step',
        data: {
          step: stepNum,
          action: 'error',
          target: line,
          success: false,
          message: err?.message ?? String(err),
        },
      });
      processing = false;
      return;
    }

    if (outcome.isGetInfo) {
      emitJson({
        event: 'step',
        data: {
          step: stepNum,
          action: 'getInfo',
          target: line,
          success: true,
          message: outcome.getInfoAnswer || outcome.result.message,
        },
      });
      processing = false;
      return;
    }
    if (outcome.step.kind === 'getInfo') {
      const infoAnswer = await handleGetInfo(outcome.step.query);
      emitJson({
        event: 'step',
        data: {
          step: stepNum,
          action: 'getInfo',
          target: line,
          success: true,
          message: infoAnswer || 'No answer',
        },
      });
      processing = false;
      return;
    }
    if (outcome.step.kind === 'done') {
      state.steps.push(outcome.step);
      emitJson({
        event: 'step',
        data: { step: stepNum, action: 'done', target: line, success: true, message: 'recorded' },
      });
      processing = false;
      return;
    }

    if (outcome.result.success) {
      state.steps.push(outcome.step);
    }
    const suggestion =
      !outcome.result.success && outcome.step.kind === 'tap' && outcome.closestMatch
        ? `Closest match: "${outcome.closestMatch}". Try: tap on ${outcome.closestMatch}`
        : null;
    emitJson({
      event: 'step',
      data: {
        step: stepNum,
        action: outcome.step.kind,
        target: line,
        success: outcome.result.success,
        message: suggestion ? `${outcome.result.message}\n${suggestion}` : outcome.result.message,
      },
    });

    processing = false;
  });

  rl.on('close', () => {
    process.exit(0);
  });

  return new Promise((resolve) => {
    rl.on('close', resolve);
  });
}
