/**
 * The dialog's height is derived, not assumed — and it has been wrong twice:
 * once for forgetting the box's own paddingY, once for a status line that
 * wrapped. Both showed up the same way, as a bottom border pushed off the
 * screen, so these assert the box actually closes rather than checking the
 * arithmetic that produces it.
 */
import { describe, expect, test } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { OutputDialog } from '@appclaw/cli/tui/components/OutputDialog';

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function frameOf(element: React.ReactElement): string[] {
  const { lastFrame } = render(element);
  return (lastFrame() ?? '').replace(ANSI, '').replace(/\n$/, '').split('\n');
}

const BODY = Array.from({ length: 41 }, (_, i) => `line ${i + 1} of a generated spec`);

/** The real /export payload: a two-line status whose first line is long enough to wrap. */
const EXPORT_STATUS = {
  color: '#22C55E',
  text:
    'Saved to /Users/someone/Documents/git/AppClaw/tests/flow-1787647975314.test.ts\n' +
    'Run:  appclaw test flow-1787647975314',
};

describe('OutputDialog', () => {
  const cases: Array<[string, React.ReactElement]> = [
    [
      'export: subtitle + wrapping two-line status',
      <OutputDialog
        title="flow-1787647975314.test.ts"
        subtitle="6 steps · @appclaw/runner spec"
        lines={BODY}
        running={false}
        status={EXPORT_STATUS}
        language="ts"
        onClose={() => {}}
      />,
    ],
    [
      'doctor: subtitle + single-line status',
      <OutputDialog
        title="appclaw doctor"
        subtitle="environment preflight"
        lines={BODY}
        running={false}
        status={{ color: '#22C55E', text: 'All checks passed' }}
        onClose={() => {}}
      />,
    ],
    [
      'yaml: no status at all',
      <OutputDialog
        title="YAML flow"
        subtitle="/export <file>.yaml to save"
        lines={BODY}
        running={false}
        language="yaml"
        onClose={() => {}}
      />,
    ],
    [
      'no subtitle, no status',
      <OutputDialog title="Commands" lines={BODY} running={false} onClose={() => {}} />,
    ],
  ];

  for (const [name, element] of cases) {
    test(`${name} — the box opens and closes inside the terminal`, () => {
      const lines = frameOf(element);
      expect(lines.filter((l) => l.includes('╭'))).toHaveLength(1);
      expect(lines.filter((l) => l.includes('╰'))).toHaveLength(1);
      // ink-testing-library reports no stdout.rows, so the component falls back
      // to 24 — the shortest terminal we claim to support here.
      expect(lines.length).toBeLessThanOrEqual(24);
    });
  }

  test('an over-wide body line wraps in full without bursting the box', () => {
    // Captured console output is sized to the terminal, not to this much
    // narrower box. Truncating it loses the detail the dialog exists to show
    // (doctor's config summary ended in an ellipsis), but wrapping costs extra
    // rows the height budget has to know about — or the bottom border is
    // pushed off screen. Both halves are asserted here.
    const wide = 'x'.repeat(400);
    const lines = frameOf(
      <OutputDialog title="Memory" lines={[wide, 'after']} running={false} onClose={() => {}} />
    );
    expect(lines.filter((l) => l.includes('╰'))).toHaveLength(1);
    expect(lines.length).toBeLessThanOrEqual(24);
    // Every one of the 400 characters survives, spread across wrapped rows.
    const xs = lines.join('').match(/x/g)?.length ?? 0;
    expect(xs).toBe(400);
    expect(lines.some((l) => l.includes('…'))).toBe(false);
  });

  test('continuation rows hang two columns past the line they belong to', () => {
    // Without this a wrapped doctor line resumed at the box's left edge, so the
    // remainder read like a new entry rather than the tail of the one above.
    const long = `  ✓ ${'word '.repeat(40).trim()}`;
    const rows = frameOf(
      <OutputDialog title="t" lines={[long]} running={false} onClose={() => {}} />
    )
      // Strip the border so the measurement is relative to the box interior.
      .filter((l) => l.includes('│'))
      .map((l) => l.slice(l.indexOf('│') + 1))
      .filter((l) => l.trim());

    const first = rows.findIndex((l) => l.includes('✓'));
    expect(first).toBeGreaterThanOrEqual(0);
    const indentOf = (l: string) => l.length - l.trimStart().length;
    // The line itself is indented 2; its continuations sit at 2 + 2.
    expect(indentOf(rows[first + 1])).toBe(indentOf(rows[first]) + 2);
    // And it really did continue rather than start something new.
    expect(rows[first + 1].trimStart().startsWith('word')).toBe(true);
  });

  test('an unbreakable run is hard-broken rather than overflowing', () => {
    const path = `  ✓ /Users/someone/${'a/'.repeat(60)}file.json`;
    const rows = frameOf(
      <OutputDialog title="t" lines={[path]} running={false} onClose={() => {}} />
    );
    expect(rows.filter((l) => l.includes('╰'))).toHaveLength(1);
    // Every row is the same width — nothing punched out through the border.
    const widths = new Set(
      rows.filter((l) => l.includes('│') || l.includes('╰')).map((l) => l.length)
    );
    expect(widths.size).toBe(1);
  });

  test('scrolling accounts for wrapped rows, not just line count', () => {
    // 12 lines that each wrap to 3 rows cannot all fit a 24-row terminal, so
    // the dialog must offer to scroll even though 12 < the viewport in lines.
    const fat = Array.from({ length: 12 }, (_, i) => `${i}:${'y'.repeat(200)}`);
    const lines = frameOf(
      <OutputDialog title="t" lines={fat} running={false} onClose={() => {}} />
    );
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.filter((l) => l.includes('╰'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('scroll');
  });

  test('a long body scrolls rather than growing the box', () => {
    const short = frameOf(
      <OutputDialog title="t" lines={['one']} running={false} onClose={() => {}} />
    );
    const long = frameOf(
      <OutputDialog title="t" lines={BODY} running={false} onClose={() => {}} />
    );
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long.length).toBeGreaterThanOrEqual(short.length);
    expect(long.join('\n')).toContain('scroll');
  });
});
