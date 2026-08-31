/**
 * What happens when `.env` holds something the schema rejects.
 *
 * This used to be the worst startup failure in the product, for the most
 * ordinary cause: `Config` is built at import time (`export const Config =
 * safeLoadConfig().config`), so a `throw` there escaped every try/catch in the
 * CLI — there was no `main()` yet — and Node printed a raw ZodError and a stack
 * trace because someone typed `LLM_PROVIDER=claude`.
 *
 * The contract now: loading never throws, it reports; the offending keys fall
 * back to their defaults so the process survives long enough to say so; and
 * every other variable in the environment still applies.
 */
import { describe, expect, test } from 'vitest';
import { safeLoadConfig, loadConfig, formatConfigIssues } from '@appclaw/core/config';

describe('safeLoadConfig', () => {
  test('a rejected enum is reported, not thrown', () => {
    const { issues } = safeLoadConfig({ LLM_PROVIDER: 'claude' });
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('LLM_PROVIDER');
    // The values it will take, so a settings screen can offer them.
    expect(issues[0].options).toEqual(['anthropic', 'openai', 'gemini', 'groq', 'ollama']);
    expect(issues[0].message).toContain('claude');
  });

  test('the config that comes back is usable, with the rejected key defaulted', () => {
    const { config } = safeLoadConfig({ LLM_PROVIDER: 'claude', MAX_STEPS: '7' });
    expect(config.LLM_PROVIDER).toBe('gemini'); // the schema default
    // Everything the user got right still applies — the point of dropping only
    // the offending keys rather than falling back to a bare default config.
    expect(config.MAX_STEPS).toBe(7);
  });

  test('every bad key is reported, not just the first', () => {
    const { issues } = safeLoadConfig({
      LLM_PROVIDER: 'claude',
      AGENT_MODE: 'hybrid',
      VISION_MODE: 'sometimes',
    });
    expect(issues.map((i) => i.key).sort()).toEqual(['AGENT_MODE', 'LLM_PROVIDER', 'VISION_MODE']);
  });

  test('a valid environment reports nothing', () => {
    expect(safeLoadConfig({ LLM_PROVIDER: 'anthropic', AGENT_MODE: 'vision' }).issues).toEqual([]);
  });

  test('cross-field rules zod cannot express come back as issues too', () => {
    // These were `throw new Error(...)` from the same import-time call, so they
    // crashed the process just as hard as a bad enum did.
    const custom = safeLoadConfig({ CLOUD_PROVIDER: 'custom', CLOUD_SERVER_URL: '' });
    expect(custom.issues.map((i) => i.key)).toEqual(['CLOUD_SERVER_URL']);

    const hosted = safeLoadConfig({ CLOUD_PROVIDER: 'browserstack', CLOUD_USERNAME: '' });
    expect(hosted.issues[0].key).toBe('CLOUD_USERNAME');
    expect(hosted.issues[0].message).toContain('browserstack');
  });

  test('formatConfigIssues names the key on every line', () => {
    const { issues } = safeLoadConfig({ LLM_PROVIDER: 'claude', AGENT_MODE: 'hybrid' });
    const lines = formatConfigIssues(issues).split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(/^[A-Z_]+: /);
  });
});

describe('loadConfig', () => {
  test('still throws, for the SDK and anyone else wanting strict behaviour', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'claude' })).toThrow(/LLM_PROVIDER/);
  });

  test('the message is readable — it was a raw ZodError dump before', () => {
    try {
      loadConfig({ LLM_PROVIDER: 'claude' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Invalid AppClaw configuration');
      expect(message).not.toContain('"code"'); // not a serialised issue array
    }
  });

  test('a valid environment loads', () => {
    expect(loadConfig({ LLM_PROVIDER: 'ollama' }).LLM_PROVIDER).toBe('ollama');
  });
});
