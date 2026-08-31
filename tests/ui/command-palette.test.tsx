/**
 * The palette's height is budgeted exactly by stream/layout.ts, so its row
 * count must not depend on what it is showing. Both regressions it has had were
 * this: a feedback row that only rendered when there was an error, and command
 * summaries long enough to wrap onto a second line.
 */
import { describe, expect, test } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { CommandPalette } from '@appclaw/cli/tui/components/CommandPalette';
import { columnWidths } from '@appclaw/cli/tui/stream/layout';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function rowsOf(element: React.ReactElement): string[] {
  const { lastFrame } = render(element);
  return (lastFrame() ?? '').replace(ANSI, '').replace(/\n$/, '').split('\n');
}

function palette(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  return (
    <CommandPalette
      width={columnWidths(200).left}
      maxCommands={10}
      query=""
      onQueryChange={() => {}}
      onSubmit={() => {}}
      disabled={false}
      error={null}
      focused
      placeholder="Type a step or /command"
      listVisible
      maxInputLines={10}
      {...overrides}
    />
  );
}

describe('CommandPalette', () => {
  test('goal mode gets a prompt, not a standing list of commands', () => {
    // A plain line is a goal there, so the list is not a menu of what to type
    // next — it is half a column of text answering nothing.
    const rows = rowsOf(palette({ listVisible: false, maxInputLines: 4 }));
    expect(rows.join('\n')).not.toContain('Command palette');
    expect(rows.join('\n')).not.toContain('/goal');
    expect(rows.join('\n')).toContain('Type a step');
    // PALETTE_COLLAPSED_ROWS — feedback row + input box — plus the component's
    // own marginTop, which the column above it owns in the real layout.
    expect(rows.length).toBe(1 + 4);
  });

  test('the collapsed prompt still wraps a long line rather than typing blind', () => {
    const width = columnWidths(120).left;
    const long = 'open settings and read the currently connected wifi network name aloud';
    const one = rowsOf(palette({ width, listVisible: false, maxInputLines: 4 })).length;
    const many = rowsOf(
      palette({ width, listVisible: false, maxInputLines: 4, query: long })
    ).length;
    expect(many).toBeGreaterThan(one);
    // ...but never past what the screen budgeted for it.
    const absurd = rowsOf(
      palette({ width, listVisible: false, maxInputLines: 4, query: 'x'.repeat(4000) })
    ).length;
    expect(absurd).toBe(one + 3);
  });

  test('the row count does not change when a message appears', () => {
    const quiet = rowsOf(palette());
    const noisy = rowsOf(palette({ error: 'Unknown command: /qutd — try /help' }));
    expect(noisy.length).toBe(quiet.length);
  });

  test('the message sits above the prompt, not below it', () => {
    const rows = rowsOf(palette({ error: 'Unknown command: /qutd — try /help' }));
    const message = rows.findIndex((r) => r.includes('Unknown command'));
    const prompt = rows.findIndex((r) => r.includes('Type a step'));
    expect(message).toBeGreaterThanOrEqual(0);
    expect(prompt).toBeGreaterThanOrEqual(0);
    // Below the input the message landed against the frame's bottom edge.
    expect(message).toBeLessThan(prompt);
  });

  test('content it cannot control never costs it a row', () => {
    // A very long message, at the narrowest column the layout allows and a
    // roomy one: neither may wrap, because the column's height is budgeted.
    for (const cols of [80, 120, 200]) {
      const width = columnWidths(cols).left;
      const baseline = rowsOf(palette({ width })).length;
      expect(rowsOf(palette({ width, error: 'a'.repeat(400) })).length).toBe(baseline);
      expect(rowsOf(palette({ width, query: '/x'.repeat(200) })).length).toBe(baseline);
    }
  });

  test('never renders wider than its column', () => {
    for (const cols of [80, 120, 200]) {
      const width = columnWidths(cols).left;
      const rows = rowsOf(palette({ width, error: 'a'.repeat(400) }));
      expect(Math.max(...rows.map((r) => [...r].length))).toBeLessThanOrEqual(width);
    }
  });

  test('a long busy message truncates instead of wrapping', () => {
    const rows = rowsOf(palette({ disabled: true, busyText: 'Executing '.repeat(40) }));
    expect(rows.length).toBe(rowsOf(palette()).length);
  });

  test('losing focus does not change its height', () => {
    // Focus only re-colours the border and stops the input consuming keys; if
    // it changed the row count it would resize the column underneath it.
    expect(rowsOf(palette({ focused: false })).length).toBe(rowsOf(palette()).length);
  });
});
