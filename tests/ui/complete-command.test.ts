/**
 * Tab completion for the TUI prompt.
 *
 * The interesting cases are the ambiguous ones: `/stream` is also a prefix of
 * `/stream-close`, and `/exit` is an alias of `/quit` that collides with
 * `/export` — so "complete to the first match" would guess wrong more often
 * than not.
 */
import { describe, expect, test } from 'vitest';
import { completeCommand } from '@appclaw/cli/tui/commands';

describe('completeCommand', () => {
  test('a unique prefix completes and gains a trailing space', () => {
    expect(completeCommand('/exp')).toBe('/export ');
    expect(completeCommand('/mem')).toBe('/memory ');
    expect(completeCommand('/g')).toBe('/goal ');
  });

  test('an ambiguous prefix extends only as far as every candidate agrees', () => {
    // /stream and /stream-close — no trailing space, since the word is not
    // finished.
    expect(completeCommand('/st')).toBe('/stream');
  });

  test('nothing to add returns null rather than a no-op edit', () => {
    expect(completeCommand('/stream')).toBeNull(); // already at the shared prefix
    expect(completeCommand('/ex')).toBeNull(); // /export vs /exit
    expect(completeCommand('/zzz')).toBeNull(); // no match
  });

  test('completes the alias that was typed, not the canonical name', () => {
    // /co is a prefix of /config, an alias of /settings. Completing to
    // "/settings" would replace what was typed instead of extending it.
    expect(completeCommand('/co')).toBe('/config ');
  });

  test('leaves plain instructions and command arguments alone', () => {
    expect(completeCommand('tap on Login')).toBeNull();
    expect(completeCommand('/export flow')).toBeNull();
    expect(completeCommand('')).toBeNull();
  });
});
