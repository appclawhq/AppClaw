/**
 * Android display-power probe.
 *
 * UiAutomator2 builds a page source by walking the focused window. While the
 * display is asleep there is no focused window, so the dump never returns and
 * the call burns the entire MCP request budget (MCP_TIMEOUT_MS, default 120 s)
 * before failing with a bare "Request timed out" — which says nothing about the
 * actual cause. Probing the power state turns that into an actionable message.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getADBPath } from '../mcp/keyboard.js';

const execAsync = promisify(exec);

/** Appended to screen-capture timeouts that a sleeping display explains. */
export const SCREEN_OFF_HINT =
  'device screen is off — UiAutomator cannot read the screen while the display sleeps. ' +
  'Wake it with `adb shell input keyevent KEYCODE_WAKEUP`; ' +
  'for longer runs `adb shell svc power stayon true` keeps it awake while charging.';

/**
 * Resolve SCREEN_OFF_HINT when the Android display is asleep, else undefined.
 *
 * Never throws and never blocks for long — a diagnostic must not mask or delay
 * the failure it is explaining. Returns undefined when adb is missing, the
 * device is gone, or the probe itself times out.
 */
export async function detectScreenOff(deviceUdid?: string): Promise<string | undefined> {
  const deviceFlag = deviceUdid ? `-s ${deviceUdid}` : '';
  try {
    // Filter on-device: a full `dumpsys power` dump runs to megabytes and blows
    // past exec's 1 MB maxBuffer, which would fail the probe before it ever
    // reads the field. Grepping on the device returns a couple of lines.
    const { stdout } = await execAsync(
      `${getADBPath()} ${deviceFlag} shell "dumpsys power | grep mWakefulness"`,
      { timeout: 5000 }
    );
    // Asleep = display off. Dozing = ambient/always-on display, equally unreadable.
    return /mWakefulness=(Asleep|Dozing)/.test(stdout) ? SCREEN_OFF_HINT : undefined;
  } catch {
    return undefined;
  }
}
