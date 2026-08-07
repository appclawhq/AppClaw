import { describe, expect, test, vi } from 'vitest';
import type { MCPClient } from '@appclaw/core/mcp/types';
import { createPlatformSession } from '@appclaw/core/device/session';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

function makeConfig() {
  return {
    CAPABILITIES_FILE: '',
    CLOUD_PROVIDER: '',
    APP_PATH: '',
    APPIUM_MJPEG_SCREENSHOT_URL: '',
    APPIUM_MJPEG_SERVER_PORT: 0,
  } as any;
}

function makeMcp(calls: ToolCall[], settingsResult = 'Successfully updated driver settings.') {
  return {
    callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === 'appium_session_management') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'ANDROID session created successfully with ID: device-session-123',
            },
          ],
        };
      }
      if (name === 'appium_driver_settings') {
        return { content: [{ type: 'text' as const, text: settingsResult }] };
      }
      if (name === 'appium_mobile_device_info') {
        return { content: [{ type: 'text' as const, text: '{"realDisplaySize":"1080x2400"}' }] };
      }
      if (name === 'appium_get_window_size') {
        return { content: [{ type: 'text' as const, text: '{"width":390,"height":844}' }] };
      }
      return { content: [] };
    }),
    listTools: vi.fn(async () => []),
    close: vi.fn(async () => {}),
  } satisfies MCPClient;
}

describe('createPlatformSession driver settings', () => {
  test('updates Android driver settings before device probing', async () => {
    const calls: ToolCall[] = [];

    await createPlatformSession(makeMcp(calls), makeConfig(), 'android');

    expect(calls.map((call) => call.name)).toEqual([
      'appium_session_management',
      'appium_driver_settings',
      'appium_mobile_device_info',
    ]);
    expect(calls[1].args).toEqual({
      sessionId: 'device-session-123',
      action: 'update',
      settings: {
        actionAcknowledgmentTimeout: 0,
        waitForIdleTimeout: 0,
        waitForSelectorTimeout: 0,
      },
    });
  });

  test('does not apply Android-only settings to iOS sessions', async () => {
    const calls: ToolCall[] = [];

    await createPlatformSession(makeMcp(calls), makeConfig(), 'ios');

    expect(calls.some((call) => call.name === 'appium_driver_settings')).toBe(false);
  });

  test('fails session initialization when driver settings are rejected', async () => {
    const calls: ToolCall[] = [];

    await expect(
      createPlatformSession(
        makeMcp(calls, 'Failed to update driver settings. Error: unsupported setting'),
        makeConfig(),
        'android'
      )
    ).rejects.toThrow('Failed to update driver settings. Error: unsupported setting');

    expect(calls.some((call) => call.name === 'appium_mobile_device_info')).toBe(false);
    expect(calls.at(-1)).toEqual({
      name: 'appium_session_management',
      args: { action: 'delete', sessionId: 'device-session-123' },
    });
  });
});
