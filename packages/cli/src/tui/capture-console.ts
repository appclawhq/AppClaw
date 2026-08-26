/**
 * Run something that reports with `console.log` and collect what it wrote.
 *
 * Several bits of shared machinery (doctor, the memory inspector) print
 * straight to the console because they were written for a plain CLI. Under the
 * TUI that output is routed by Ink's `patchConsole` to the area *above* the
 * rendered frame — which, in the alternate screen buffer with a full-height
 * frame, is off screen. The result looked like the command silently did
 * nothing. Capturing lets the caller put the output somewhere visible instead.
 */

type ConsoleWriter = (...args: unknown[]) => void;

function install(lines: string[]): { restore: () => void } {
  // Restore to whatever console.log is *now* — under the TUI that is Ink's
  // patched version, and putting back a pristine original would break
  // patchConsole for everything afterwards.
  const previous = console.log as ConsoleWriter;
  console.log = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    lines.push(...text.split('\n'));
  };
  return {
    restore: () => {
      console.log = previous;
    },
  };
}

/** Capture a synchronous reporter's output. */
export function captureConsole(body: () => void): string[] {
  const lines: string[] = [];
  const { restore } = install(lines);
  try {
    body();
  } catch (err) {
    lines.push(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    restore();
  }
  return lines;
}

/**
 * Capture an async reporter's output.
 *
 * Note the console stays patched for the whole await, so anything else logging
 * concurrently is captured too — acceptable here because these commands own the
 * foreground while they run.
 */
export async function captureConsoleAsync<T>(
  body: () => Promise<T>
): Promise<{ result: T | undefined; lines: string[] }> {
  const lines: string[] = [];
  const { restore } = install(lines);
  let result: T | undefined;
  try {
    result = await body();
  } catch (err) {
    lines.push(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    restore();
  }
  return { result, lines };
}
