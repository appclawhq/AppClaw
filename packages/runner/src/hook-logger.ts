/**
 * Per-hook console capture.
 *
 * The runner wants each hook's `console.log(...)` / `console.warn(...)` etc.
 * attributed to that hook so the report can surface them next to the row.
 * With parallel workers, several hooks execute concurrently in one process,
 * so a plain monkey-patch would interleave. AsyncLocalStorage scopes the
 * capture buffer to the current async chain, so each hook sees only its own
 * output while the original console still writes to the terminal.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';

const store = new AsyncLocalStorage<string[]>();

let patched = false;
function ensurePatched(): void {
  if (patched) return;
  patched = true;
  const originals: Record<Level, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  const wrap = (level: Level) => {
    return (...args: unknown[]) => {
      const bucket = store.getStore();
      if (bucket) {
        // Match `util.format` so objects / errors render the way console does.
        const line = format(...args);
        bucket.push(level === 'log' || level === 'info' ? line : `[${level}] ${line}`);
      }
      originals[level](...args);
    };
  };
  console.log = wrap('log');
  console.info = wrap('info');
  console.warn = wrap('warn');
  console.error = wrap('error');
  console.debug = wrap('debug');
}

/**
 * Run `fn` inside a fresh capture buffer. Always returns the buffered lines
 * even when `fn` throws — so a failed hook's report still carries whatever it
 * logged before blowing up. Callers rethrow `error` themselves when needed to
 * preserve normal control flow.
 */
export async function captureHookLogs<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T | undefined; error: unknown; logs: string }> {
  ensurePatched();
  const buf: string[] = [];
  let result: T | undefined;
  let error: unknown;
  await store.run(buf, async () => {
    try {
      result = await fn();
    } catch (e) {
      error = e;
    }
  });
  return { result, error, logs: buf.join('\n') };
}
