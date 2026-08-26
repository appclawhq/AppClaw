/**
 * Picks the in-terminal image backend for `/stream`.
 *
 * Detection is env-based rather than a terminal capability query: the Kitty
 * graphics protocol's "are you there" probe is a round trip that answers on
 * stdin, and stdin is already held in raw mode by Ink's input handling — the
 * reply would be delivered as keystrokes instead, or swallow the user's.
 */

export type StreamBackend = 'kitty' | 'halfblock';

/**
 * `kitty` for terminals that implement the Kitty graphics protocol (real
 * pixels), `halfblock` for everything else (24-bit colour text, always
 * available). `APPCLAW_STREAM_BACKEND` forces one, mainly so the fallback path
 * can be exercised on a terminal that supports graphics.
 */
export function detectStreamBackend(env: NodeJS.ProcessEnv = process.env): StreamBackend {
  const override = env.APPCLAW_STREAM_BACKEND?.trim().toLowerCase();
  if (override === 'kitty' || override === 'halfblock') return override;

  // Ghostty and WezTerm implement the protocol but don't advertise it in TERM.
  if (env.TERM_PROGRAM?.toLowerCase() === 'ghostty') return 'kitty';
  if (env.WEZTERM_EXECUTABLE) return 'kitty';
  if (env.KITTY_WINDOW_ID) return 'kitty';
  if ((env.TERM ?? '').toLowerCase().includes('kitty')) return 'kitty';

  return 'halfblock';
}

export function backendLabel(backend: StreamBackend): string {
  return backend === 'kitty' ? 'kitty graphics' : 'ANSI half-blocks';
}
