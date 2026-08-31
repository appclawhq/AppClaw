/**
 * What `appclaw` does when the config cannot support a run.
 *
 * This used to be `printError` + `process.exit(1)` before Ink ever mounted, so
 * the answer to a missing key was two grey lines above the shell prompt naming
 * a variable — accurate, and a dead end. The shell can write `.env`, so the
 * same problem is now reported where it can also be fixed.
 *
 * The masking test is the one that matters beyond looks: listing LLM_API_KEY in
 * settings is what makes the setup screen actionable, and it would otherwise
 * park an API key on screen for as long as the shell is open.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';
import { PassThrough } from 'node:stream';
import { TuiApp } from '@appclaw/cli/tui/TuiApp';
import { tuiStore, getSnapshot } from '@appclaw/cli/tui/store';
import { collectSetupIssues } from '@appclaw/cli/tui/setup-check';
import { BANNER_ROWS } from '@appclaw/cli/tui/components/Wordmark';
import type { TuiActions } from '@appclaw/cli/tui/commands';
import type { AppClawConfig } from '@appclaw/core/config';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const settle = () => new Promise((r) => setTimeout(r, 40));
const cfg = (over: Partial<AppClawConfig>) => over as AppClawConfig;

// Vitest's stdout is not a TTY, so chalk resolves to level 0 and every frame
// comes out uncoloured — which would make "the error is red" untestable.
// Forcing the level makes Ink emit the SGR it would emit in a real terminal.
let chalkLevel: typeof chalk.level;
beforeAll(() => {
  chalkLevel = chalk.level;
  chalk.level = 3;
});
afterAll(() => {
  chalk.level = chalkLevel;
});

/** COLORS.red as the truecolor escape Ink writes for it. */
const RED = '38;2;239;68;68';

function mount(cols = 120, rows = 34) {
  const calls: string[] = [];
  const frames: string[] = [];
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  (stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    frames.push(s);
    return true;
  };
  Object.defineProperty(stdout, 'columns', { value: cols });
  Object.defineProperty(stdout, 'rows', { value: rows });
  Object.assign(stdout, { isTTY: true });
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => {}, unref: () => {} });

  const actions = new Proxy(
    {},
    {
      get: (_t, prop: string) => () => {
        calls.push(prop);
        if (prop === 'goToSettings') tuiStore.goTo('settings');
      },
    }
  ) as TuiActions;

  const instance = render(<TuiApp actions={actions} />, {
    stdout,
    stdin,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  /** The painted frame, ANSI intact — colour is part of what these assert. */
  const raw = () => frames.filter((f) => f.includes('╭')).pop() ?? '';
  const frame = () => raw().replace(ANSI, '').split('\n');
  const press = async (keys: string) => {
    (stdin as unknown as PassThrough).write(keys);
    await settle();
  };
  return { calls, frame, raw, press, instance };
}

afterEach(() => tuiStore.reset());

describe('collectSetupIssues', () => {
  test('a missing key for a hosted provider is an issue', () => {
    const issues = collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('LLM_API_KEY');
    // The provider is named — "LLM_API_KEY is required" alone never said which
    // key to go and get.
    expect(issues[0].title).toContain('gemini');
  });

  test('ollama needs no key, so a blank one is the correct state', () => {
    expect(collectSetupIssues(cfg({ LLM_PROVIDER: 'ollama', LLM_API_KEY: '' }))).toEqual([]);
  });

  test('a configured key is not an issue', () => {
    expect(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' }))).toEqual([]);
  });
});

describe('rejected .env values', () => {
  // The worst startup failure the product had, and the most ordinary cause: a
  // typo in `.env` threw out of core's import-time `loadConfig()`, before the
  // CLI had a `main()` to catch it, so Node printed a stack trace. The shell
  // can write `.env`, so this is precisely the kind of problem it should be
  // reporting rather than dying on.
  test('a rejected value becomes an issue naming the key and what it wanted', () => {
    const issues = collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' }), [
      {
        key: 'LLM_PROVIDER',
        message: "Invalid enum value. Expected 'anthropic' | 'gemini', received 'claude'",
        options: ['anthropic', 'gemini'],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('LLM_PROVIDER');
    expect(issues[0].detail).toContain('claude');
    expect(issues[0].detail).toContain('anthropic');
  });

  test('rejected values are listed before a missing key', () => {
    // The config carrying them has fallen back to defaults, so the key check
    // below is judging a provider the user never chose.
    const issues = collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' }), [
      { key: 'AGENT_MODE', message: 'Invalid enum value.' },
    ]);
    expect(issues.map((i) => i.key)).toEqual(['AGENT_MODE', 'LLM_API_KEY']);
  });

  test('the screen shows every one of them', async () => {
    tuiStore.setSetupIssues(
      collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k' }), [
        { key: 'AGENT_MODE', message: "Expected 'dom' | 'vision', received 'hybrid'" },
        { key: 'MCP_TRANSPORT', message: "Expected 'stdio' | 'sse', received 'carrier'" },
      ])
    );
    tuiStore.goTo('setup');
    const { frame, instance } = mount(120, 34);
    await settle();
    const text = frame().join('\n');
    expect(text).toContain('AGENT_MODE');
    expect(text).toContain('MCP_TRANSPORT');
    expect(text).toContain('hybrid');
    // And it still fits — two issues is where the banner starts competing for rows.
    expect(frame().length).toBeLessThanOrEqual(34);
    instance.unmount();
  });
});

describe('SetupScreen', () => {
  test('names the problem and the way to fix it', async () => {
    tuiStore.setSetupIssues(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' })));
    tuiStore.goTo('setup');
    const { frame, instance } = mount();
    await settle();
    const text = frame().join('\n');
    expect(text).toContain('Setup needed');
    expect(text).toContain('No API key for gemini');
    // Still names the variable, for anyone who would rather edit .env directly.
    expect(text).toContain('LLM_API_KEY');
    expect(text).toContain('enter opens settings');
    expect(frame().length).toBeLessThanOrEqual(34);
    instance.unmount();
  });

  test('the failing line is red, like every other failure in the app', async () => {
    tuiStore.setSetupIssues(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' })));
    tuiStore.goTo('setup');
    const { raw, instance } = mount();
    await settle();
    const titleRow = raw()
      .split('\n')
      .find((l) => l.includes('No API key'))!;
    expect(titleRow).toContain(RED);
    instance.unmount();
  });

  test('leads with the same block wordmark the welcome screen uses', async () => {
    tuiStore.setSetupIssues(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' })));
    tuiStore.goTo('setup');
    const { frame, instance } = mount();
    await settle();
    const drawn = frame().filter((l) => l.includes('█'));
    expect(drawn).toHaveLength(BANNER_ROWS);
    instance.unmount();
  });

  test('gives the wordmark up before the message on a short terminal', async () => {
    // Five rows of branding are not worth pushing the frame past the terminal,
    // which Ink overlaps rather than clips.
    tuiStore.setSetupIssues(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' })));
    tuiStore.goTo('setup');
    const { frame, instance } = mount(120, 24);
    await settle();
    expect(frame().some((l) => l.includes('█'))).toBe(false);
    expect(frame().join('\n')).toContain('AppClaw');
    expect(frame().join('\n')).toContain('No API key for gemini');
    expect(frame().length).toBeLessThanOrEqual(24);
    instance.unmount();
  });

  test('falls back to the small mark when the terminal is too narrow to draw it', async () => {
    tuiStore.setSetupIssues(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' })));
    tuiStore.goTo('setup');
    const { frame, instance } = mount(64, 40);
    await settle();
    expect(frame().some((l) => l.includes('█'))).toBe(false);
    expect(frame().join('\n')).toContain('AppClaw');
    instance.unmount();
  });

  test('enter opens settings', async () => {
    tuiStore.setSetupIssues(collectSetupIssues(cfg({ LLM_PROVIDER: 'gemini', LLM_API_KEY: '' })));
    tuiStore.goTo('setup');
    const { calls, press, instance } = mount();
    await settle();
    await press('\r');
    expect(calls).toEqual(['goToSettings']);
    expect(getSnapshot().screen).toBe('settings');
    instance.unmount();
  });
});

describe('settings', () => {
  test('a secret is masked in the list, keeping only its last four characters', async () => {
    tuiStore.setSettingsFields([
      { key: 'LLM_PROVIDER', value: 'gemini' },
      // Deliberately not credential-shaped: a valid-looking key in a fixture
      // trips secret scanners and invites someone to paste a real one here.
      { key: 'LLM_API_KEY', value: 'not-a-real-key-0000000000000000000WXYZ', secret: true },
    ]);
    tuiStore.goTo('settings');
    const { frame, instance } = mount();
    await settle();
    const text = frame().join('\n');
    expect(text).not.toContain('not-a-real-key-0000000000000000000');
    expect(text).toContain('••••••••WXYZ');
    // Non-secret fields are untouched.
    expect(text).toContain('gemini');
    instance.unmount();
  });

  test('a short secret gives away no length at all', async () => {
    tuiStore.setSettingsFields([{ key: 'LLM_API_KEY', value: 'abc', secret: true }]);
    tuiStore.goTo('settings');
    const { frame, instance } = mount();
    await settle();
    expect(frame().join('\n')).toContain('••••');
    expect(frame().join('\n')).not.toContain('abc');
    instance.unmount();
  });

  test('an unset secret reads as unset rather than as dots', async () => {
    tuiStore.setSettingsFields([{ key: 'LLM_API_KEY', value: '', secret: true }]);
    tuiStore.goTo('settings');
    const { frame, instance } = mount();
    await settle();
    expect(frame().join('\n')).toContain('(unset)');
    instance.unmount();
  });
});
