/**
 * LLM token-usage helpers for the runner's cost display.
 *
 * Each test's `TestResult.usage` comes straight from `app.usage()` (see
 * @appclaw/core). Here we sum them for the suite total and format tokens/cost
 * for the console summary and HTML report.
 */

import type { RunUsage, TestResult } from './types.js';

/** One model name if the set is a singleton, 'mixed' if many, undefined if none. */
function pickModel(models: Set<string>): string | undefined {
  return models.size === 1 ? [...models][0] : models.size > 1 ? 'mixed' : undefined;
}

/** Sum every test's usage into one suite total. Returns undefined if no LLM ran. */
export function sumUsage(results: TestResult[]): RunUsage | undefined {
  let input = 0;
  let output = 0;
  let cached = 0;
  let cost = 0;
  const models = new Set<string>();
  // Vision breakdown, accumulated across tests that used vision.
  let vIn = 0;
  let vOut = 0;
  let vCached = 0;
  let vCost = 0;
  let vAny = false;
  const vModels = new Set<string>();
  let any = false;
  for (const r of results) {
    const u = r.usage;
    if (!u) continue;
    any = true;
    input += u.inputTokens;
    output += u.outputTokens;
    cached += u.cachedTokens;
    cost += u.cost;
    if (u.model) models.add(u.model);
    if (u.vision) {
      vAny = true;
      vIn += u.vision.inputTokens;
      vOut += u.vision.outputTokens;
      vCached += u.vision.cachedTokens;
      vCost += u.vision.cost;
      if (u.vision.model) vModels.add(u.vision.model);
    }
  }
  if (!any) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached,
    totalTokens: input + output,
    cost,
    // One model → name it; multiple → 'mixed' so the total isn't mislabeled.
    model: pickModel(models),
    vision: vAny
      ? {
          inputTokens: vIn,
          outputTokens: vOut,
          cachedTokens: vCached,
          totalTokens: vIn + vOut,
          cost: vCost,
          model: pickModel(vModels),
        }
      : undefined,
  };
}

/** "1.2k" / "980" — compact token count. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * USD cost, shown with enough precision to be meaningful for cheap runs.
 * Per-test AI costs are often fractions of a cent, so under $1 we keep 4
 * decimals ("$0.0043", "$0.0315"); at/above $1 two suffice ("$1.27"). "$0"
 * for un-priced/local models.
 */
export function formatCost(cost: number): string {
  if (cost <= 0) return '$0';
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * True when vision spent tokens but was priced at $0 — i.e. it ran on an
 * un-priced/local model (e.g. a local Qwen2.5-VL server). Used to annotate the
 * display so a $0 reads as "free local vision", not "cost data missing".
 */
export function hasFreeVision(usage: RunUsage | undefined): boolean {
  return !!usage?.vision && usage.vision.totalTokens > 0 && usage.vision.cost === 0;
}

/**
 * Compact one-line usage label, e.g. "3.1k tok · $0.0142". When vision ran on a
 * free local model, appends " (vision free)" so the low/zero cost is explained.
 * Empty if no usage.
 */
export function formatUsage(usage: RunUsage | undefined): string {
  if (!usage || usage.totalTokens === 0) return '';
  const base = `${formatTokens(usage.totalTokens)} tok · ${formatCost(usage.cost)}`;
  return hasFreeVision(usage) ? `${base} (vision free)` : base;
}
