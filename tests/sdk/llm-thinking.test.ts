/**
 * Anthropic rejects `thinking:{type:'enabled'}` whenever tool_choice forces a
 * tool call ("Thinking may not be enabled when tool_choice forces tool use"),
 * and the agent loop always forces tool choice — so every Anthropic reasoning
 * call failed until buildThinkingOptions switched to adaptive thinking on
 * 4.6+ models. These lock in the per-model routing so a future model id
 * (Claude 5.x, a new 4.x point release) doesn't silently fall back to the
 * budgeted form and reintroduce the crash.
 */
import { describe, test, expect } from 'vitest';
import { loadConfig } from '@appclaw/core/config';
import { buildThinkingOptions } from '@appclaw/core/llm/provider';

describe('buildThinkingOptions — Anthropic adaptive-thinking routing', () => {
  test.each([
    ['claude-sonnet-4-6', true],
    ['claude-opus-5', true],
    ['claude-sonnet-5', true],
    ['claude-fable-5', true],
    ['claude-opus-4-8', true],
    ['claude-opus-4-7', true],
    ['claude-sonnet-4-5', false],
    ['claude-haiku-4-5', false],
    ['claude-3-5-sonnet', false],
  ])('%s → adaptive: %s', (model, expectAdaptive) => {
    const config = loadConfig({ LLM_PROVIDER: 'anthropic', LLM_MODEL: model, LLM_THINKING: 'on' });
    const options = buildThinkingOptions(config);
    expect(options?.anthropic?.thinking?.type).toBe(expectAdaptive ? 'adaptive' : 'enabled');
  });

  test('adaptive thinking requests display:summarized so reasoning reaches the UI', () => {
    const config = loadConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-sonnet-4-6',
      LLM_THINKING: 'on',
    });
    const options = buildThinkingOptions(config);
    // The API default for `display` is 'omitted', which streams empty
    // thinking blocks — 'summarized' is required for the terminal's
    // "Reasoning…" panel to actually show anything.
    expect(options?.anthropic?.thinking?.display).toBe('summarized');
  });

  test('pre-4.6 models still carry a budgetTokens value (no adaptive support)', () => {
    const config = loadConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-sonnet-4-5',
      LLM_THINKING: 'on',
    });
    const options = buildThinkingOptions(config);
    expect(options?.anthropic?.thinking).toMatchObject({ type: 'enabled' });
    expect(typeof options?.anthropic?.thinking?.budgetTokens).toBe('number');
  });

  test('LLM_THINKING=off disables thinking regardless of model', () => {
    const config = loadConfig({
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-sonnet-4-6',
      LLM_THINKING: 'off',
    });
    expect(buildThinkingOptions(config)).toBeUndefined();
  });

  test('Gemini routing is unaffected by the Anthropic adaptive-thinking change', () => {
    const gemini25 = loadConfig({
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-2.5-flash',
      LLM_THINKING: 'on',
    });
    expect(buildThinkingOptions(gemini25)).toMatchObject({
      google: { thinkingConfig: { thinkingBudget: expect.any(Number) } },
    });

    const gemini3 = loadConfig({
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-3.1-flash-lite',
      LLM_THINKING: 'on',
    });
    expect(buildThinkingOptions(gemini3)).toMatchObject({
      google: { thinkingConfig: { thinkingLevel: expect.any(String) } },
    });
  });
});
