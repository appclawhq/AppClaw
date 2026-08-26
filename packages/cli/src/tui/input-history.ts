/**
 * Input history for the TUI's prompt — the `↑` recall a REPL is expected to
 * have.
 *
 * Session-scoped and in memory only. A recording session is a self-contained
 * piece of work against one app on one device, so yesterday's lines are noise
 * to scroll past rather than shortcuts; and nothing here is written to disk, so
 * the prompt leaves nothing behind. The session log already keeps the durable
 * record of what was run.
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
