/**
 * `appclaw doctor` — environment preflight.
 *
 * Runs the setup checklist in a few seconds WITHOUT starting an Appium session,
 * so users see every problem at once instead of discovering them one run at a
 * time: Node version, .env/config validity, LLM credentials, the bundled
 * appium-mcp, and per-platform device toolchains (adb / Xcode + simulators).
 *
 * Severity rules:
 *  - Config, Node, appium-mcp, and LLM credential problems always fail.
 *  - With PLATFORM set, that platform's toolchain is required; the other is skipped.
 *  - With PLATFORM unset, both platforms are checked as warnings — doctor only
 *    fails if NO usable device target exists (neither platform nor a cloud grid).
 *  - A configured cloud grid (CLOUD_PROVIDER) satisfies the device requirement;
 *    local toolchain problems then downgrade to warnings.
 *
 * Flags: `appclaw doctor [--platform android|ios] [--full] [--env-file <path>]`
 * `--full` additionally spawns appium-mcp and performs a real MCP handshake.
 * Exit code: 0 when everything required passes, 1 otherwise.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import chalk from 'chalk';

const exec = promisify(execFile);

type Platform = 'android' | 'ios';

interface ParsedArgs {
  platform?: Platform;
  full: boolean;
  envFile?: string;
  help: boolean;
}

/** Mirrors ui/terminal.ts printSetupOk/printSetupError glyphs, plus a warn level. */
const out = {
  section(title: string): void {
    console.log(`\n  ${chalk.bold(title)}`);
  },
  ok(message: string): void {
    console.log(`  ${chalk.green('✓')} ${message}`);
  },
  warn(message: string, hint?: string): void {
    console.log(`  ${chalk.yellow('!')} ${message}`);
    if (hint) console.log(`    ${chalk.dim(hint)}`);
  },
  fail(message: string, hint?: string): void {
    console.log(`  ${chalk.red('✗')} ${message}`);
    if (hint) console.log(`    ${chalk.dim(hint)}`);
  },
};

/** Tallies for the summary + exit code. */
const counts = { ok: 0, warn: 0, fail: 0 };

function ok(message: string): void {
  counts.ok++;
  out.ok(message);
}
function warn(message: string, hint?: string): void {
  counts.warn++;
  out.warn(message, hint);
}
function fail(message: string, hint?: string): void {
  counts.fail++;
  out.fail(message, hint);
}
/** Report at the given severity: required problems fail, optional ones warn. */
function report(required: boolean, message: string, hint?: string): void {
  if (required) fail(message, hint);
  else warn(message, hint);
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { full: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') parsed.help = true;
    else if (a === '--full') parsed.full = true;
    else if (a === '--platform') {
      const p = args[++i];
      if (p !== 'android' && p !== 'ios') throw new Error(`Invalid platform: ${p}`);
      parsed.platform = p as Platform;
    } else if (a === '--env-file' || a === '--env-path') {
      const p = args[++i];
      if (!p) throw new Error(`Missing value for ${a}`);
      parsed.envFile = p;
    } else if (a.startsWith('--platform=')) {
      const p = a.slice(11);
      if (p !== 'android' && p !== 'ios') throw new Error(`Invalid platform: ${p}`);
      parsed.platform = p as Platform;
    } else if (a.startsWith('--env-file=')) {
      const p = a.slice(11);
      if (!p) throw new Error(`Missing value for --env-file=`);
      parsed.envFile = p;
    }
  }
  return parsed;
}

function printHelp(): void {
  console.log(`
  appclaw doctor [options]

  Check that this machine is ready to run AppClaw: Node, .env config, LLM
  credentials, appium-mcp, and device toolchains (adb / Xcode simulators).

  Options:
    --platform <android|ios>  Only check one platform (default: PLATFORM from .env, or both)
    --full                    Also spawn appium-mcp and perform a real MCP handshake
    --env-file <path>         Load a dotenv file before reading config (alias: --env-path)
    -h, --help                Show this help
`);
}

/** Node requirement — keep in sync with "engines" in packages/cli/package.json. */
const MIN_NODE_MAJOR = 22;

function checkNode(): void {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  if (major >= MIN_NODE_MAJOR) {
    ok(`Node ${version}`);
  } else {
    fail(
      `Node ${version} is too old — AppClaw requires Node ${MIN_NODE_MAJOR}+`,
      'Install a newer Node: https://nodejs.org or `nvm install 22`'
    );
  }
}

/** Loaded lazily so a broken .env is reported as a failed check, not a crash. */
type CoreConfig = typeof import('@appclaw/core/config');

async function checkConfig(): Promise<ReturnType<CoreConfig['loadConfig']> | null> {
  try {
    const mod: CoreConfig = await import('@appclaw/core/config');
    const cfg = mod.loadConfig();
    const { DEFAULT_MODELS } = await import('@appclaw/core/constants');
    const model = cfg.LLM_MODEL || DEFAULT_MODELS[cfg.LLM_PROVIDER] || '(default)';
    const platform = cfg.PLATFORM || 'not set (prompted at run time)';
    ok(
      `Config valid — provider ${cfg.LLM_PROVIDER}, model ${model}, ${cfg.AGENT_MODE} mode, platform ${platform}`
    );
    return cfg;
  } catch (e) {
    fail(
      `Config invalid: ${e instanceof Error ? e.message : String(e)}`,
      'Fix your .env (see README for the full variable table)'
    );
    return null;
  }
}

async function checkLLM(cfg: NonNullable<Awaited<ReturnType<typeof checkConfig>>>): Promise<void> {
  if (cfg.LLM_PROVIDER === 'ollama') {
    const base = (cfg.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { models?: unknown[] };
      ok(`Ollama reachable at ${base} (${data.models?.length ?? 0} models installed)`);
    } catch {
      fail(
        `Ollama not reachable at ${base}`,
        'Start it: ollama serve  (then: ollama pull llama3.2)'
      );
    }
    return;
  }
  if (!cfg.LLM_API_KEY) {
    fail(
      `LLM_API_KEY is not set (provider: ${cfg.LLM_PROVIDER})`,
      'Add LLM_API_KEY=... to your .env, or switch to LLM_PROVIDER=ollama for keyless local runs'
    );
  } else {
    ok(`LLM_API_KEY set (${cfg.LLM_PROVIDER})`);
  }
}

async function checkAppiumMcp(): Promise<void> {
  try {
    const { resolveAppiumMcp } = await import('@appclaw/core/mcp/client');
    const resolved = resolveAppiumMcp();
    if (resolved.command === 'node') {
      // args[0] is <pkg>/dist/index.js — the package.json sits one level up.
      const pkgPath = join(dirname(resolved.args[0]), '..', 'package.json');
      let version = '';
      try {
        version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
      } catch {
        /* version stays unknown */
      }
      ok(`appium-mcp ${version || '(version unknown)'} bundled`);
    } else {
      warn(
        'appium-mcp not bundled — will be downloaded via npx at connect time (slow, can time out in CI)',
        'Reinstall appclaw so the bundled copy resolves: npm install appclaw'
      );
    }
  } catch (e) {
    fail(`Could not resolve appium-mcp: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** @returns true when at least one Android device/emulator is usable. */
async function checkAndroid(required: boolean): Promise<boolean> {
  out.section('Android');
  try {
    const { stdout } = await exec('adb', ['version'], { timeout: 5000 });
    const versionLine = stdout.split('\n')[0]?.trim();
    ok(versionLine || 'adb on PATH');
  } catch {
    report(
      required,
      'adb not found on PATH',
      'Install Android platform-tools and add adb to PATH: https://developer.android.com/tools/adb'
    );
    return false;
  }

  try {
    const { stdout } = await exec('adb', ['devices'], { timeout: 10000 });
    const lines = stdout
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);
    const devices = lines
      .map((l) => l.split(/\s+/))
      .filter((parts) => parts.length >= 2)
      .map(([serial, state]) => ({ serial, state }));
    const online = devices.filter((d) => d.state === 'device');
    const unauthorized = devices.filter((d) => d.state === 'unauthorized');

    if (unauthorized.length > 0) {
      warn(
        `${unauthorized.length} device(s) unauthorized: ${unauthorized.map((d) => d.serial).join(', ')}`,
        'Accept the USB debugging prompt on the device'
      );
    }
    if (online.length > 0) {
      ok(`${online.length} device(s) connected: ${online.map((d) => d.serial).join(', ')}`);
      return true;
    }
    report(
      required,
      'No Android devices connected',
      'Start an emulator or connect a device with USB debugging enabled (check: adb devices)'
    );
    return false;
  } catch (e) {
    report(required, `adb devices failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** @returns true when an iOS target (booted simulator, or configured real device) is usable. */
async function checkIOS(required: boolean, realDevice: boolean): Promise<boolean> {
  out.section('iOS');
  if (process.platform !== 'darwin') {
    report(required, 'iOS automation requires macOS (Xcode / XCUITest)');
    return false;
  }

  try {
    const { stdout } = await exec('xcode-select', ['-p'], { timeout: 5000 });
    ok(`Xcode developer tools at ${stdout.trim()}`);
  } catch {
    report(
      required,
      'Xcode command line tools not installed',
      'Install them: xcode-select --install'
    );
    return false;
  }

  if (realDevice) {
    // Real-device readiness (trust, Developer Mode, WDA signing) can't be
    // verified without starting a session — just confirm the config intent.
    ok('DEVICE_TYPE=real — ensure the iPhone is connected, trusted, and in Developer Mode');
    return true;
  }

  try {
    const { stdout } = await exec('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], {
      timeout: 10000,
    });
    const parsed = JSON.parse(stdout) as {
      devices: Record<string, Array<{ name: string; state: string }>>;
    };
    const booted = Object.values(parsed.devices)
      .flat()
      .filter((d) => d.state === 'Booted');
    if (booted.length > 0) {
      ok(`${booted.length} simulator(s) booted: ${booted.map((d) => d.name).join(', ')}`);
      return true;
    }
    report(
      required,
      'No iOS simulators booted',
      'Boot one: xcrun simctl boot "iPhone 16" && open -a Simulator'
    );
    return false;
  } catch (e) {
    report(required, `simctl failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** `--full`: spawn appium-mcp over stdio and verify the tool list comes back. */
async function checkHandshake(
  cfg: NonNullable<Awaited<ReturnType<typeof checkConfig>>>
): Promise<void> {
  out.section('MCP handshake (--full)');
  try {
    const { createMCPClient } = await import('@appclaw/core/mcp/client');
    const client = await createMCPClient({
      transport: cfg.MCP_TRANSPORT,
      host: cfg.MCP_HOST,
      port: cfg.MCP_PORT,
      ...(cfg.MCP_URL ? { url: cfg.MCP_URL } : {}),
    });
    try {
      const tools = await client.listTools();
      ok(`appium-mcp handshake OK — ${tools.length} tools available`);
    } finally {
      await client.close();
    }
  } catch (e) {
    fail(
      `appium-mcp handshake failed: ${e instanceof Error ? e.message : String(e)}`,
      'Run with MCP_DEBUG=true for the server log'
    );
  }
}

export async function runDoctor(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.help) {
    printHelp();
    return 0;
  }

  // Load --env-file BEFORE importing core config (which parses process.env on import).
  if (parsed.envFile) {
    const envPath = resolve(process.cwd(), parsed.envFile);
    if (!existsSync(envPath)) {
      out.fail(`env file not found: ${parsed.envFile}`, `Resolved to ${envPath}`);
      return 1;
    }
    const { config: loadDotenvFile } = await import('dotenv');
    loadDotenvFile({ path: envPath, override: true });
  }

  console.log(`\n  ${chalk.hex('#FC8EAC')('◐')} ${chalk.bold('AppClaw doctor')}`);

  out.section('Core');
  checkNode();
  const cfg = await checkConfig();
  if (cfg) await checkLLM(cfg);
  await checkAppiumMcp();

  let cloud = false;
  if (cfg) {
    const { isCloud, cloudProviderLabel } = await import('@appclaw/core/device/cloud');
    cloud = isCloud(cfg);
    if (cloud) {
      ok(
        `Cloud grid configured — ${cloudProviderLabel(cfg)}` +
          (cfg.CLOUD_DEVICE_NAME ? ` (${cfg.CLOUD_DEVICE_NAME})` : '')
      );
    }
  }

  // Which platform sections run, and whether their failures are fatal.
  // --platform flag > PLATFORM env > both-as-warnings.
  const target = parsed.platform ?? ((cfg?.PLATFORM || undefined) as Platform | undefined);
  let androidUsable = false;
  let iosUsable = false;
  if (target !== 'ios') {
    androidUsable = await checkAndroid(target === 'android' && !cloud);
  }
  if (target !== 'android') {
    iosUsable = await checkIOS(target === 'ios' && !cloud, cfg?.DEVICE_TYPE === 'real');
  }

  // No platform pinned: fail only when there is no usable device target at all.
  if (!target && !cloud && !androidUsable && !iosUsable) {
    console.log();
    fail(
      'No usable device target found (no Android device, no iOS simulator, no cloud grid)',
      'Fix one of the platform sections above, or configure CLOUD_PROVIDER in .env'
    );
  }

  if (parsed.full && cfg) {
    await checkHandshake(cfg);
  }

  console.log();
  const summary = [
    chalk.green(`${counts.ok} ok`),
    counts.warn > 0 ? chalk.yellow(`${counts.warn} warning(s)`) : null,
    counts.fail > 0 ? chalk.red(`${counts.fail} problem(s)`) : null,
  ]
    .filter(Boolean)
    .join(chalk.dim(' · '));
  console.log(`  ${summary}`);
  if (counts.fail === 0) {
    console.log(`  ${chalk.dim('Ready to run:')} appclaw ${chalk.dim('"Open Settings"')}`);
  }
  console.log();

  return counts.fail > 0 ? 1 : 0;
}
