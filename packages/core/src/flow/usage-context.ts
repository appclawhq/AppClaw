/**
 * Per-run LLM token-usage accumulator, propagated via AsyncLocalStorage.
 *
 * The runner executes many tests concurrently in a single process, so a
 * module-global counter (see vision-token-tracker.ts) would mix usage across
 * tests. This mirrors the `locatorCacheStorage` pattern: each `app.run()` /
 * `app.verify()` runs inside `usageStorage.run(sink, ...)`, and every LLM call
 * on that async call-stack (the DOM resolver in `llm-parser.ts` and the vision
 * client via `vision-token-tracker.ts`) pushes into *that test's* sink.
 *
 * `addUsage()` is a no-op when there is no active sink (standalone helpers,
 * non-SDK callers), so it is always safe to call.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { computeUsdCost } from '../constants.js';
import type { RunUsage } from '../report/types.js';

/**
 * A run's token counters, split by model source. Text (`inputTokens` etc.) is
 * the reasoning/DOM-resolution model (`LLM_MODEL`); `vision*` is the separate
 * Stark vision model (`STARK_VISION_MODEL`), which is often a *different* model
 * on a *different* endpoint — e.g. a local Qwen2.5-VL server that costs nothing.
 * Keeping them apart lets each bucket be priced by its own model instead of
 * charging local vision tokens at the cloud text model's rate.
 */
export interface UsageSink {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  visionInputTokens: number;
  visionOutputTokens: number;
  visionCachedTokens: number;
}

/** A fresh zeroed sink. Use everywhere a sink is created so fields never drift. */
export function newUsageSink(): UsageSink {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    visionInputTokens: 0,
    visionOutputTokens: 0,
    visionCachedTokens: 0,
  };
}

export const usageStorage = new AsyncLocalStorage<UsageSink>();

/** Add one text/reasoning LLM call's token counts to the active run's sink, if any. */
export function addUsage(usage: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
}): void {
  const sink = usageStorage.getStore();
  if (!sink) return;
  sink.inputTokens += usage.inputTokens ?? 0;
  sink.outputTokens += usage.outputTokens ?? 0;
  sink.cachedTokens += usage.cachedTokens ?? 0;
}

/** Add one vision-model call's token counts to the active run's sink, if any. */
export function addVisionUsage(usage: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
}): void {
  const sink = usageStorage.getStore();
  if (!sink) return;
  sink.visionInputTokens += usage.inputTokens ?? 0;
  sink.visionOutputTokens += usage.outputTokens ?? 0;
  sink.visionCachedTokens += usage.cachedTokens ?? 0;
}

/**
 * Turn a sink into a priced `RunUsage`, charging text and vision tokens each to
 * their own model. Top-level fields are the *combined* totals (so existing
 * displays keep working); `vision` carries the separately-priced breakdown when
 * any vision tokens were spent. Vision on an un-priced/local model contributes
 * real token counts but $0 cost — the honest result for a local Qwen server.
 */
export function buildRunUsage(
  sink: UsageSink,
  textModel: string | undefined,
  visionModel: string | undefined
): RunUsage {
  const textCost = computeUsdCost(textModel, sink.inputTokens, sink.outputTokens);
  const visionTotal = sink.visionInputTokens + sink.visionOutputTokens;
  const visionCost = computeUsdCost(visionModel, sink.visionInputTokens, sink.visionOutputTokens);
  const inputTokens = sink.inputTokens + sink.visionInputTokens;
  const outputTokens = sink.outputTokens + sink.visionOutputTokens;
  const cachedTokens = sink.cachedTokens + sink.visionCachedTokens;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens: inputTokens + outputTokens,
    cost: textCost + visionCost,
    model: textModel,
    vision:
      visionTotal > 0
        ? {
            inputTokens: sink.visionInputTokens,
            outputTokens: sink.visionOutputTokens,
            cachedTokens: sink.visionCachedTokens,
            totalTokens: visionTotal,
            cost: visionCost,
            model: visionModel,
          }
        : undefined,
  };
}
