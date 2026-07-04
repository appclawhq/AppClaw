/**
 * Direct iOS simulator discovery via `xcrun simctl list devices --json`.
 *
 * Bypasses appium-mcp's `select_device` text response because that response
 * strips the iOS runtime version and text-parses inconsistently for
 * unnamed / blank-named simulators (surfacing as bare UDIDs in the picker).
 * `select_device` is still called downstream to lock in the choice.
 */

import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

export interface IOSSimulatorInfo {
  name: string;
  udid: string;
  state: string;
  /** iOS runtime version, e.g. "18.2" */
  iosVersion: string;
}

export async function listIOSSimulators(): Promise<IOSSimulatorInfo[]> {
  const { stdout } = await exec('xcrun simctl list devices available --json', {
    maxBuffer: 16 * 1024 * 1024,
  });
  const data = JSON.parse(stdout);
  const devicesByRuntime = (data?.devices ?? {}) as Record<string, unknown>;

  const result: IOSSimulatorInfo[] = [];
  for (const [runtimeKey, deviceList] of Object.entries(devicesByRuntime)) {
    if (!Array.isArray(deviceList)) continue;
    const iosVersion = parseIOSRuntime(runtimeKey);
    if (!iosVersion) continue; // skip watchOS / tvOS / visionOS runtimes
    for (const dev of deviceList as Array<Record<string, unknown>>) {
      if (dev.isAvailable === false) continue;
      const name = typeof dev.name === 'string' ? dev.name : '';
      const udid = typeof dev.udid === 'string' ? dev.udid : '';
      if (!udid) continue;
      result.push({
        name: name || udid,
        udid,
        state: typeof dev.state === 'string' ? dev.state : 'Shutdown',
        iosVersion,
      });
    }
  }
  return result;
}

/**
 * Parse the iOS version out of a simctl runtime key.
 * Newer format: "com.apple.CoreSimulator.SimRuntime.iOS-18-2"
 * Older format: "iOS 18.2"
 * Returns null for non-iOS runtimes (watchOS, tvOS, visionOS).
 */
function parseIOSRuntime(key: string): string | null {
  const dashed = key.match(/SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/);
  if (dashed) {
    const [, maj, min, patch] = dashed;
    return patch ? `${maj}.${min}.${patch}` : `${maj}.${min}`;
  }
  const spaced = key.match(/^iOS (\d+\.\d+(?:\.\d+)?)$/);
  if (spaced) return spaced[1];
  return null;
}
