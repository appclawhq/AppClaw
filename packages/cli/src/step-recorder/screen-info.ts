/**
 * "What's on screen?" queries (getInfo) — screenshot + a single Stark vision call.
 *
 * Shared by the TUI and the headless JSON bridge. Only the data-fetching half
 * lives here; each surface formats the answer and the failure reasons itself,
 * so neither one's existing output changes.
 */

import type { MCPClient } from '@appclaw/core/mcp/types';
import * as ui from '@appclaw/core/ui/terminal';

export type ScreenInfoResult =
  | { ok: true; answer: string; explanation?: string }
  /**
   * `reason` lets callers keep their own wording: 'error' is an unexpected
   * throw (message is the raw error), the others are expected preconditions.
   */
  | { ok: false; reason: 'screenshot' | 'no-vision' | 'error'; message: string };

/**
 * Ask the vision model a question about the current screen. Drives the shared
 * spinner (the TUI's renderer turns that into in-frame busy text), and always
 * stops it before returning.
 */
export async function fetchScreenInfo(mcp: MCPClient, query: string): Promise<ScreenInfoResult> {
  try {
    ui.startSpinner('Analyzing screen', query);
    const { screenshot } = await import('@appclaw/core/mcp/tools');
    const imageBase64 = await screenshot(mcp);
    if (!imageBase64) {
      ui.stopSpinner();
      return { ok: false, reason: 'screenshot', message: 'Failed to capture screenshot' };
    }

    const {
      getStarkVisionApiKey,
      getStarkVisionBaseUrl,
      getStarkVisionCoordinateOrder,
      getStarkVisionModel,
    } = await import('@appclaw/core/vision/locate-enabled');
    const apiKey = getStarkVisionApiKey();
    const baseUrl = getStarkVisionBaseUrl();
    if (!apiKey && !baseUrl) {
      ui.stopSpinner();
      return {
        ok: false,
        reason: 'no-vision',
        message: 'getInfo requires vision (GEMINI_API_KEY or STARK_VISION_BASE_URL)',
      };
    }

    const { default: starkVision } = await import('@appclaw/vision');
    const { StarkVisionClient } = starkVision;
    const client = new StarkVisionClient({
      apiKey: apiKey || 'local',
      model: getStarkVisionModel(),
      disableThinking: true,
      ...(baseUrl && { baseUrl }),
      ...(baseUrl && { coordinateOrder: getStarkVisionCoordinateOrder() }),
    });
    const response = await client.getElementInfo(imageBase64, query, true);

    let answer: string;
    let explanation: string | undefined;
    try {
      const parsed = JSON.parse(response.replace(/(^```json\s*|```\s*$)/g, '').trim());
      answer = parsed.answer || response;
      explanation = parsed.explanation;
    } catch {
      answer = response;
    }

    ui.stopSpinner();
    return { ok: true, answer, explanation };
  } catch (err: any) {
    ui.stopSpinner();
    return { ok: false, reason: 'error', message: err?.message ?? String(err) };
  }
}
