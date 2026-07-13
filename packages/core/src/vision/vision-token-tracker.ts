/**
 * Module-level accumulator for Stark vision token usage.
 *
 * All StarkVisionClient instances (stark-locate, vision-execute) report here
 * via the onTokenUsage callback. Call resetVisionTokens() at the start of each
 * flow/run, then getVisionTokens() to read the totals.
 */

import { addVisionUsage } from '../flow/usage-context.js';

export interface VisionTokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

let _totals: VisionTokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
};

export function resetVisionTokens(): void {
  _totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 };
}

export function getVisionTokens(): VisionTokenTotals {
  return { ..._totals };
}

export function trackVisionTokenUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}): void {
  _totals.inputTokens += usage.inputTokens;
  _totals.outputTokens += usage.outputTokens;
  _totals.totalTokens += usage.totalTokens;
  _totals.cachedTokens += usage.cachedTokens ?? 0;

  // Also feed the active per-run sink's *vision* bucket so SDK/runner cost
  // accounting prices these tokens by the vision model (e.g. a free local Qwen),
  // not the text model. Concurrency-safe; no-op outside an `app.run()` context.
  // The module-global `_totals` above stays for the YAML-flow path.
  addVisionUsage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens ?? 0,
  });
}
