import { useStdout } from 'ink';

/**
 * Rows left for scrollable content after `reserved` fixed rows (header,
 * status bar, borders). Ink has no alt-screen concept of its own — without
 * bounding content to the real terminal height, a tall frame just scrolls
 * the terminal, and once a frame scrolls off it can never be redrawn again
 * (that's what produced the duplicated stacked frames in scrollback).
 */
export function useAvailableRows(reserved: number): number {
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;
  return Math.max(3, rows - reserved);
}

/** Slice a list to a scrolling window that always keeps `selected` in view. `start` is the original index of `items[0]`, for re-deriving each row's true index. */
export function windowFor<T>(
  items: T[],
  selected: number,
  maxVisible: number
): { items: T[]; start: number } {
  if (items.length <= maxVisible) return { items, start: 0 };
  let start = Math.max(0, selected - maxVisible + 1);
  start = Math.min(start, items.length - maxVisible);
  return { items: items.slice(start, start + maxVisible), start };
}
