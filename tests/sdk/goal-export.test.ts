/**
 * The generated spec is a user-facing artifact — it is what `/export` and
 * `--export` write to disk, and it has to be runnable by `appclaw-runner`
 * without edits. Nothing covered its shape before, which is how it kept
 * emitting vitest boilerplate after the runner became the target.
 */
import { describe, expect, test } from 'vitest';
import { generateSdkTest, generateSdkTestFromInstructions } from '@appclaw/core/sdk/goal-export';
import type { AgentResult } from '@appclaw/core/agent/loop';

const INSTRUCTIONS = ['open youtube', 'click on search', 'type hello'];

function spec(config?: Parameters<typeof generateSdkTestFromInstructions>[0]['config']): string {
  return generateSdkTestFromInstructions({ instructions: INSTRUCTIONS, config });
}

describe('generated spec targets @appclaw/runner', () => {
  test('imports the runner, not vitest or the SDK class', () => {
    const out = spec();
    expect(out).toContain(`import { test } from "@appclaw/runner"`);
    expect(out).not.toContain('vitest');
    expect(out).not.toContain('new AppClaw');
    // The runner owns the session, so the spec must not manage its lifecycle.
    expect(out).not.toContain('teardown');
    expect(out).not.toContain('dotenv');
  });

  test('uses the runner call shape: test(title, async ({ app }) => …)', () => {
    const out = spec();
    expect(out).toMatch(/test\(".*", async \(\{ app \}\) => \{/);
    for (const instruction of INSTRUCTIONS) {
      expect(out).toContain(`await app.run(${JSON.stringify(instruction)});`);
    }
    // No describe wrapper around a single test.
    expect(out).not.toContain('describe(');
  });

  test('platform rides along as a test option, not constructor config', () => {
    const out = spec({ platform: 'android' });
    expect(out).toContain('{ platform: "android" }');
    // Credentials and mode belong in appclaw.config.ts, not in every spec.
    expect(out).not.toContain('apiKey');
    expect(out).not.toContain('agentMode');
  });

  test('omits the option object entirely when no platform is known', () => {
    expect(spec()).toMatch(/test\(".*", async \(/);
  });

  test('a /meta name is folded into the title rather than wrapping in describe', () => {
    const out = spec({ describeName: 'Login flow' });
    expect(out).toContain('Login flow — ');
    expect(out).not.toContain('describe(');
  });

  test('agent exports keep the goal in the header and translate history', () => {
    const result = {
      success: true,
      reason: 'done',
      stepsUsed: 2,
      history: [
        { decision: { toolName: 'launch_app', args: { appName: 'YouTube' } }, result: 'ok' },
        {
          decision: { toolName: 'find_and_click', args: { selector: 'search icon' } },
          result: 'ok',
        },
      ],
    } as unknown as AgentResult;

    const out = generateSdkTest({ goal: 'search youtube', result });
    expect(out).toContain('Original goal: search youtube');
    expect(out).toContain('await app.run("open YouTube app");');
    expect(out).toContain('await app.run("tap search icon");');
    expect(out).toContain(`import { test } from "@appclaw/runner"`);
  });
});
