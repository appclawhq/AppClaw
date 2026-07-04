/**
 * Shared interactive picker with search, viewport scrolling, and flicker-free rendering.
 *
 * Features:
 * - Arrow keys to navigate, Enter to select, Ctrl+C to exit
 * - Type to filter/search (Backspace to clear, Escape to reset)
 * - Fixed viewport window (no flickering with long lists)
 * - Items can be sorted/grouped (e.g., booted devices first)
 */

import readline from 'node:readline';
import { Writable } from 'node:stream';
import boxen from 'boxen';

export interface PickerItem<T> {
  label: string;
  value: T;
  /** Optional tag shown as a colored badge (e.g., "Booted") */
  tag?: string;
  /** Optional hint shown dimmed (e.g., "iOS 18.2") */
  hint?: string;
}

export interface PickerOptions {
  /** Prompt text shown above the list */
  prompt: string;
  /** Max visible items in the viewport (default: 10) */
  viewportSize?: number;
  /** Enable type-to-search (default: true) */
  searchable?: boolean;
}

/**
 * Interactive arrow-key picker with optional inline search.
 * Renders a fixed-height viewport to avoid terminal flickering.
 */
export async function interactivePicker<T>(
  items: PickerItem<T>[],
  options: PickerOptions
): Promise<T> {
  const { prompt, viewportSize = 10, searchable = true } = options;

  // Single item — auto-select
  if (items.length === 1) return items[0].value;
  // No items
  if (items.length === 0) throw new Error('No items to pick from');

  return new Promise((resolve) => {
    let selectedIndex = 0;
    let scrollOffset = 0;
    let searchQuery = '';
    let filteredItems = items;
    let lastRenderedLineCount = 0;
    const maxVisible = Math.min(viewportSize, items.length);

    // Use a Writable that discards output to prevent readline from interfering with our rendering.
    // We handle all stdout writes ourselves.
    const devNull = new Writable({
      write(_c: any, _e: any, cb: () => void) {
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: devNull, terminal: false });
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin);

    const formatItem = (item: PickerItem<T>, selected: boolean): string => {
      const prefix = selected ? '\x1B[36m>\x1B[0m ' : '  ';

      let line = '';
      if (selected) {
        line += `\x1B[36m${item.label}\x1B[0m`;
      } else {
        line += item.label;
      }
      if (item.tag) {
        const tagColor = item.tag.toLowerCase() === 'booted' ? '\x1B[32m' : '\x1B[90m';
        line += ` ${tagColor}${item.tag}\x1B[0m`;
      }
      if (item.hint) {
        line += ` \x1B[90m${item.hint}\x1B[0m`;
      }
      return `${prefix}${line}`;
    };

    const updateFilter = () => {
      if (!searchQuery) {
        filteredItems = items;
      } else {
        const q = searchQuery.toLowerCase();
        filteredItems = items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.tag?.toLowerCase().includes(q) ||
            item.hint?.toLowerCase().includes(q)
        );
      }
      selectedIndex = 0;
      scrollOffset = 0;
    };

    const render = (initialRender = false) => {
      // Move cursor up to overwrite the PREVIOUS render (use tracked line count)
      if (!initialRender && lastRenderedLineCount > 0) {
        process.stdout.write(`\x1B[${lastRenderedLineCount}A`);
      }
      // Clear everything from cursor to end of screen
      process.stdout.write('\x1B[J');

      // Build the inner content of the boxed frame.
      const lines: string[] = [];

      // Search hint line inside the box.
      if (searchable && searchQuery) {
        lines.push(`\x1B[33m${searchQuery}\x1B[90m|\x1B[0m`);
      } else if (searchable) {
        lines.push(`\x1B[90m(type to filter)\x1B[0m`);
      }

      if (filteredItems.length === 0) {
        lines.push(`\x1B[90mNo matches found\x1B[0m`);
      } else {
        // Adjust scroll to keep selection visible
        const visibleCount = Math.min(maxVisible, filteredItems.length);
        if (selectedIndex < scrollOffset) {
          scrollOffset = selectedIndex;
        } else if (selectedIndex >= scrollOffset + visibleCount) {
          scrollOffset = selectedIndex - visibleCount + 1;
        }

        for (
          let i = scrollOffset;
          i < scrollOffset + visibleCount && i < filteredItems.length;
          i++
        ) {
          lines.push(formatItem(filteredItems[i], i === selectedIndex));
        }

        if (filteredItems.length > maxVisible) {
          const below = filteredItems.length - scrollOffset - visibleCount;
          const above = scrollOffset;
          const parts: string[] = [];
          if (above > 0) parts.push(`${above} more above`);
          if (below > 0) parts.push(`${below} more below`);
          lines.push(`\x1B[90m${parts.join(' · ')}\x1B[0m`);
        }
      }

      const boxed = boxen(lines.join('\n'), {
        title: prompt,
        titleAlignment: 'left',
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { left: 2, right: 0, top: 0, bottom: 0 },
        borderStyle: 'round',
        borderColor: '#FC8EAC',
      });

      process.stdout.write(`${boxed}\n`);
      // Track how many terminal lines we just drew so the next render can
      // rewind and overwrite them cleanly. boxed has N-1 internal newlines and
      // the trailing `\n` we added advances the cursor a total of N lines.
      lastRenderedLineCount = boxed.split('\n').length;
    };

    // Initial render
    render(true);

    const onKeypress = (_str: string | undefined, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'up') {
        if (selectedIndex > 0) {
          selectedIndex--;
          render();
        }
      } else if (key.name === 'down') {
        if (selectedIndex < filteredItems.length - 1) {
          selectedIndex++;
          render();
        }
      } else if (key.name === 'return') {
        if (filteredItems.length > 0) {
          cleanup();
          // Show final selection
          const selected = filteredItems[selectedIndex];
          console.log(
            `  \x1B[32m✓\x1B[0m ${options.prompt} \x1B[36m${selected.label}\x1B[0m${selected.tag ? ` \x1B[32m${selected.tag}\x1B[0m` : ''}`
          );
          resolve(selected.value);
        }
      } else if (key.name === 'c' && key.ctrl) {
        cleanup();
        process.exit(0);
      } else if (key.name === 'backspace') {
        if (searchQuery.length > 0) {
          searchQuery = searchQuery.slice(0, -1);
          updateFilter();
          render();
        }
      } else if (key.name === 'escape') {
        if (searchQuery) {
          searchQuery = '';
          updateFilter();
          render();
        }
      } else if (searchable && _str && _str.length === 1 && !key.ctrl && !key.meta) {
        // Printable character — add to search query
        searchQuery += _str;
        updateFilter();
        render();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      rl.close();
      // Clear the picker UI before showing result
      if (lastRenderedLineCount > 0) {
        process.stdout.write(`\x1B[${lastRenderedLineCount}A\x1B[J`);
      }
      // Ensure stdin is unpaused so subsequent readline interfaces work
      if (process.stdin.isPaused()) process.stdin.resume();
    };

    process.stdin.on('keypress', onKeypress);
  });
}
