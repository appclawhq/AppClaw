/**
 * Input history for the TUI's prompt — the `↑` recall a REPL is expected to
 * have.
 *
 * Session-scoped and in memory only. A recording session is a self-contained
 * piece of work against one app on one device, so yesterday's lines are noise
 * to scroll past rather than shortcuts; and nothing here is written to disk, so
 * the prompt leaves nothing behind. The session log already keeps the durable
 * record of what was run.
 *
 * The list lives HERE, at module scope, rather than in MainScreen's `useState`.
 * TuiApp renders dialogs and other screens *instead of* the active screen so
 * their `useInput` handlers stop competing for keystrokes, which unmounts
 * MainScreen — so component state died on every `/list`, `/yaml`, `/doctor`,
 * `/settings` or `/history`, and the prompt came back remembering only the
 * lines typed since. Recall has to outlive the screen that offers it.
 */

/** Enough for a long session's recall without unbounded growth. */
const MAX_ENTRIES = 500;

/**
 * Append one line. Consecutive duplicates collapse the way a shell's history
 * does: holding `↑` through ten identical "tap on Login" entries is not recall,
 * it's noise.
 */
export function appendHistory(history: string[], line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return history;
  if (history[history.length - 1] === trimmed) return history;
  return [...history, trimmed].slice(-MAX_ENTRIES);
}

/** The session's lines, oldest first. */
let sessionHistory: string[] = [];

/** Record a submitted line. Safe to call for slash commands and steps alike. */
export function recordLine(line: string): void {
  sessionHistory = appendHistory(sessionHistory, line);
}

/** Everything recalled by the prompt's arrow keys, oldest first. */
export function historyLines(): readonly string[] {
  return sessionHistory;
}

/** Drop the session's history — for tests, and for a fresh shell in-process. */
export function resetHistory(): void {
  sessionHistory = [];
}
