import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MCPClient } from '@appclaw/core/mcp/types';
import { executeStep } from '@appclaw/core/flow/run-yaml-flow';
import type { FlowStep } from '@appclaw/core/flow/types';

const PAGE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,1920]" enabled="true">
    <android.widget.Button class="android.widget.Button" text="Submit" resource-id="com.demo:id/submit" content-desc="submit_button" clickable="true" enabled="true" bounds="[100,200][500,320]" />
    <android.widget.Button class="android.widget.Button" text="Item" resource-id="com.demo:id/item" clickable="true" enabled="true" bounds="[100,400][500,520]" />
    <android.widget.Button class="android.widget.Button" text="Item" resource-id="com.demo:id/item" clickable="true" enabled="true" bounds="[100,600][500,720]" />
    <android.widget.EditText class="android.widget.EditText" text="runtime-secret" resource-id="com.demo:id/password" password="true" clickable="true" enabled="true" bounds="[100,800][700,920]" />
    <android.view.ViewGroup class="android.view.ViewGroup" text="" content-desc="" resource-id="com.demo:id/merchant_ai_container" clickable="false" enabled="true" bounds="[427,1700][652,1847]" />
  </android.widget.FrameLayout>
</hierarchy>`;

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

let calls: ToolCall[];

function mockMcp(): MCPClient {
  return {
    callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === 'appium_get_page_source') {
        return { content: [{ type: 'text' as const, text: PAGE_SOURCE }] };
      }
      return { content: [{ type: 'text' as const, text: 'OK' }] };
    }),
    listTools: vi.fn(async () => []),
    close: vi.fn(async () => {}),
  };
}

async function run(step: FlowStep) {
  return executeStep(mockMcp(), step, {}, undefined, { maxAttempts: 1, intervalMs: 1 });
}

beforeEach(() => {
  calls = [];
});

describe('structured selector runtime', () => {
  test('taps the exact resolved element and returns selector diagnostics', async () => {
    const result = await run({
      kind: 'tap',
      label: 'structured target',
      selector: { accessibilityId: 'submit_button', enabled: true },
    });

    expect(result.success).toBe(true);
    expect(
      calls.find((call) => call.name === 'appium_gesture' && call.args.action === 'tap')?.args
    ).toMatchObject({ x: 300, y: 260 });
    expect(result.selectorDiagnostics).toMatchObject({ matchedCount: 1 });
  });

  test('taps an id-only container even when the node itself is not marked clickable', async () => {
    const result = await run({
      kind: 'tap',
      label: 'id-only structured target',
      selector: { id: 'com.demo:id/merchant_ai_container' },
    });

    expect(result.success).toBe(true);
    expect(
      calls.find((call) => call.name === 'appium_gesture' && call.args.action === 'tap')?.args
    ).toMatchObject({ x: 539, y: 1773 });
    expect(result.selectorDiagnostics).toMatchObject({
      matchedCount: 1,
      matched: [expect.objectContaining({ clickable: false })],
    });
  });

  test('fails ambiguous actions instead of silently choosing an element', async () => {
    const result = await run({
      kind: 'tap',
      label: 'ambiguous target',
      selector: { id: 'com.demo:id/item' },
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/ambiguous.*matched 2/i);
    expect(calls.some((call) => call.name === 'appium_gesture')).toBe(false);
    expect(result.selectorDiagnostics?.matchedCount).toBe(2);
  });

  test('evaluates properties through executeStep with expected/actual diagnostics', async () => {
    const result = await run({
      kind: 'assert',
      selector: { id: 'com.demo:id/submit' },
      properties: { enabled: false, width: 400 },
    });

    expect(result.success).toBe(false);
    expect(result.selectorDiagnostics?.failures?.join(' ')).toMatch(/enabled.*false.*true/i);
    expect(result.selectorDiagnostics?.expectedProperties).toEqual({
      enabled: false,
      width: 400,
    });
  });

  test('keeps structured scroll assertions compatible with anchored scroll targets', async () => {
    const result = await run({
      kind: 'scrollAssert',
      selector: { id: 'com.demo:id/submit' },
      direction: 'down',
      maxScrolls: 2,
      target: 'Item',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('selector(id="com.demo:id/submit")');
    expect(result.selectorDiagnostics).toMatchObject({ matchedCount: 1 });
    expect(calls.some((call) => call.name === 'appium_gesture')).toBe(false);
  });

  test('redacts resolved secrets from messages and nested diagnostics', async () => {
    const result = await run({
      kind: 'type',
      text: 'runtime-secret',
      selector: { id: 'com.demo:id/password', value: 'runtime-secret' },
      sensitive: true,
      sensitiveValues: ['runtime-secret'],
    });

    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('runtime-secret');
    expect(result.message).toContain('***');
    expect(result.selectorDiagnostics?.matched[0].value).toBe('***');
  });
});
