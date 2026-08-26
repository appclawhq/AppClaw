/**
 * Direct device/emulator discovery for UI surfaces that need a device list
 * BEFORE an Appium/MCP session exists (the TUI's device picker, `appclaw
 * doctor`). Shells out to `adb` / `xcrun simctl` directly — no MCP round
 * trip — mirroring the checks in `appclaw doctor` but returning structured
 * data instead of printing.
 *
 * For the actual Appium session, `discoverAndSelectDevice` in
 * device-picker.ts remains the source of truth (it also locks the choice in
 * via the `select_device` MCP tool). This module is read-only.
 */

import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { listIOSSimulators } from './ios-simulators.js';

const exec = promisify(execCallback);

export interface RunningDevice {
  name: string;
  udid: string;
  /** "device" | "offline" | "unauthorized" | "Booted" | "Shutdown" */
  state: string;
  platform: 'android' | 'ios';
  hint?: string;
}

/** List Android devices/emulators via `adb devices -l`. Empty array if adb is unavailable. */
export async function listAndroidDevices(): Promise<RunningDevice[]> {
  // adb is commonly not on the user's interactive PATH — mirror the augmented
  // PATH mcp/client.ts builds for the appium-mcp subprocess, so the picker
  // sees the same devices the agent will.
  const androidHome =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    join(homedir(), 'Library', 'Android', 'sdk');
  let stdout: string;
  try {
    ({ stdout } = await exec('adb devices -l', {
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: [
          join(androidHome, 'platform-tools'),
          join(androidHome, 'emulator'),
          process.env.PATH ?? '',
        ].join(delimiter),
      },
    }));
  } catch {
    return [];
  }

  // Filter structurally rather than dropping line 0: adb can prepend daemon
  // startup notices ("* daemon not running; starting now…"), which would push
  // the real header down and turn "List of devices attached" into a phantom
  // device entry.
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('*') && !/^(List of devices|adb server version)/i.test(l));

  const devices: RunningDevice[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, ...rest] = parts;
    // Two-word states exist, e.g. "no permissions (user not in plugdev group)".
    const state = rest[0] === 'no' && rest.length > 1 ? `${rest[0]} ${rest[1]}` : rest[0];
    const modelMatch = line.match(/model:(\S+)/);
    const name = modelMatch ? modelMatch[1].replace(/_/g, ' ') : serial;
    devices.push({ name, udid: serial, state, platform: 'android' });
  }
  return devices;
}

/** List iOS simulators via `xcrun simctl`. Empty array on non-macOS or if Xcode CLT is missing. */
export async function listIOSDevices(): Promise<RunningDevice[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const sims = await listIOSSimulators();
    return sims.map((s) => ({
      name: s.name,
      udid: s.udid,
      state: s.state,
      platform: 'ios' as const,
      hint: `iOS ${s.iosVersion}`,
    }));
  } catch {
    return [];
  }
}

/** List devices for one platform, booted/online first. */
export async function listRunningDevices(platform: 'android' | 'ios'): Promise<RunningDevice[]> {
  const devices = platform === 'android' ? await listAndroidDevices() : await listIOSDevices();
  const isUp = (d: RunningDevice) =>
    d.state.toLowerCase() === 'booted' || d.state.toLowerCase() === 'device';
  return [...devices].sort((a, b) => {
    const upDiff = Number(isUp(b)) - Number(isUp(a));
    if (upDiff !== 0) return upDiff;
    return a.name.localeCompare(b.name);
  });
}
