import { createContext, useContext } from 'react';

/**
 * Cells the agent-loop UI may draw into.
 *
 * Its components used to size themselves off `stdout.columns` directly, which
 * was correct while the run owned the whole terminal. Terminal Studio puts the
 * run in a column beside the device stream, and there that assumption draws
 * boxes wider than their pane — clipped by the pane's `overflow: hidden`, so
 * they lose their right border and corners rather than resizing.
 *
 * A context rather than a prop on each component: the timeline is rendered from
 * stored entries by `renderEntry`, which has no width to pass down and no
 * reason to grow one.
 *
 * Null means "no host is constraining us" — fall back to the terminal.
 */
export const RunWidthContext = createContext<number | null>(null);

/**
 * Available cells, from the nearest host that declared one. Components apply
 * their own maximum on top: a summary box that filled a 200-column terminal
 * would be unreadable.
 */
export function useRunWidth(terminalColumns: number | undefined): number {
  const provided = useContext(RunWidthContext);
  return provided ?? terminalColumns ?? 80;
}
