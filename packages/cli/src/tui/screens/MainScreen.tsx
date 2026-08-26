import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS } from '../../ui/ink/theme.js';
import { subscribe, getSnapshot, tuiStore, type TranscriptEntry } from '../store.js';
import { executeLine, completeCommand, matchCommands, type TuiActions } from '../commands.js';
import { appendHistory } from '../input-history.js';
import { Header } from '../components/Header.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { StreamPanel } from '../components/StreamPanel.js';
import { StatusBar } from '../components/StatusBar.js';
import {
  columnWidths,
  panelImageRows,
  transcriptRows,
  visibleCommandCount,
  MIN_MAIN_ROWS,
} from '../stream/layout.js';

const KIND_COLOR: Record<TranscriptEntry['kind'], string> = {
  info: COLORS.white,
  warn: COLORS.yellow,
  error: COLORS.red,
  step: COLORS.step,
  goal: COLORS.brand,
  result: COLORS.green,
  command: COLORS.dimmed,
};

interface TranscriptRow {
  key: string;
  text: string;
  color?: string;
  /** Detail lines sit indented under the entry they belong to. */
  indent: boolean;
}

/**
 * Flatten entries into one object per rendered line.
 *
 * Scrolling needs a stable, countable unit, and an entry is not one — a single
 * entry can render as many lines (a multi-line `detail`, plus the blank
 * separator before a new instruction). Windowing over rows makes the scroll
 * maths exact instead of the estimate the tail-only view could get away with.
 */
function toRows(entries: TranscriptEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  entries.forEach((entry, i) => {
    if (entry.kind === 'goal' && i > 0) {
      rows.push({ key: `${entry.id}:gap`, text: '', indent: false });
    }
    rows.push({
      key: `${entry.id}:text`,
      text: entry.text,
      color: KIND_COLOR[entry.kind],
      indent: false,
    });
    if (entry.detail) {
      entry.detail.split('\n').forEach((line, j) => {
        rows.push({ key: `${entry.id}:d${j}`, text: line, color: COLORS.dimmed, indent: true });
      });
    }
  });
  return rows;
}

function Transcript({
  rows,
  budget,
  scrolledBy,
  total,
  focused,
}: {
  rows: TranscriptRow[];
  budget: number;
  scrolledBy: number;
  total: number;
  focused: boolean;
}) {
  const scrollable = total > budget;
  return (
    <Box
      flexDirection="column"
      height={budget + 3}
      overflow="hidden"
      borderStyle="round"
      borderColor={focused ? COLORS.brand : COLORS.muted}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color={focused ? COLORS.brand : COLORS.dimmed} bold>
          Transcript
        </Text>
        <Text color={scrolledBy > 0 ? COLORS.yellow : COLORS.dimmed}>
          {focused
            ? scrolledBy > 0
              ? `↑${scrolledBy} · ↑↓ scroll · ⇧tab back`
              : 'scrolling · ↑↓ · ⇧tab back'
            : scrollable
              ? 'live · ⇧tab to scroll'
              : ''}
        </Text>
      </Box>
      {rows.length === 0 ? (
        <Text color={COLORS.dimmed}>Nothing yet — try /help or type a goal.</Text>
      ) : (
        rows.map((row) => (
          // marginLeft on a Box rather than a leading space in the text — a
          // space only offsets the first wrapped line, leaving continuation
          // lines flush left and ragged.
          <Box key={row.key} marginLeft={row.indent ? 2 : 0}>
            <Text color={row.color}>{row.text || ' '}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

export interface MainScreenProps {
  actions: TuiActions;
}

/** Wireframe's main window: header, left command palette + instruction box, right device stream panel. */
export function MainScreen({ actions }: MainScreenProps) {
  const ui = useSyncExternalStore(subscribe, getSnapshot);
  const [value, setValue] = useState('');
  const { stdout } = useStdout();
  const rows = stdout.rows || 24;
  const cols = stdout.columns || 80;

  // The columns are full height and independent now, so the picture's size no
  // longer depends on whether a stream is running — only the panel's contents do.
  const widths = columnWidths(cols);
  const imageRows = panelImageRows(rows);
  const maxCommands = visibleCommandCount(rows);
  const transcriptBudget = transcriptRows(rows);

  /** Which pane the keyboard belongs to. Shift+Tab moves between them. */
  const [focus, setFocus] = useState<'input' | 'transcript'>('input');
  /** Lines submitted in this session only — nothing is carried in from disk. */
  const [history, setHistory] = useState<string[]>([]);
  /**
   * How far back through history we are: 0 is the live draft, 1 the most recent
   * entry. The draft is stashed on the first `↑` so coming back down restores
   * what was half-typed rather than clearing it.
   */
  const [historyIndex, setHistoryIndex] = useState(0);
  const draftRef = useRef('');

  function recallHistory(direction: -1 | 1): void {
    if (history.length === 0) return;
    const next = Math.min(history.length, Math.max(0, historyIndex - direction));
    if (next === historyIndex) return;
    if (historyIndex === 0) draftRef.current = value;
    setHistoryIndex(next);
    setValue(next === 0 ? draftRef.current : history[history.length - next]);
  }

  const allRows = useMemo(() => toRows(ui.transcript), [ui.transcript]);
  /** Rows scrolled back from the newest line; 0 follows the tail live. */
  const [scrolledBy, setScrolledBy] = useState(0);
  const maxScroll = Math.max(0, allRows.length - transcriptBudget);
  const scroll = Math.min(scrolledBy, maxScroll);
  const visibleRows = allRows.slice(maxScroll - scroll, maxScroll - scroll + transcriptBudget);

  // While the user is reading history, grow the offset by however many rows
  // arrived so the viewport stays put instead of sliding under them. At 0 the
  // offset is left alone, which is what keeps the live tail following.
  const previousRowCount = useRef(allRows.length);
  useEffect(() => {
    const added = allRows.length - previousRowCount.current;
    previousRowCount.current = allRows.length;
    if (added > 0 && scrolledBy > 0) setScrolledBy((o) => o + added);
  }, [allRows.length, scrolledBy]);

  /**
   * Focus decides what the bare arrow keys mean, so neither the prompt nor the
   * transcript needs a modifier: at the prompt they recall history, in the
   * transcript they scroll. Shift+Tab moves between the two, and typing a
   * printable character jumps straight back to the prompt with that character,
   * so getting out of scrolling never costs a keystroke.
   *
   * While the transcript has focus <TextInput> is given `focus={false}`, which
   * makes it ignore input entirely — that is what frees the arrows without the
   * component inserting stray characters.
   */
  useInput((input, key) => {
    const page = Math.max(1, transcriptBudget - 1);

    // Shift+Tab moves between the panes, in both directions — the conventional
    // "focus previous" key, and free because <TextInput> early-returns on it.
    // Plain Tab stays with completion.
    if (key.tab && key.shift) {
      if (focus === 'input') {
        if (maxScroll > 0) setFocus('transcript');
      } else {
        setFocus('input');
      }
      return;
    }

    if (focus === 'transcript') {
      if (key.upArrow) setScrolledBy((o) => Math.min(maxScroll, o + 1));
      else if (key.downArrow) setScrolledBy((o) => Math.max(0, o - 1));
      else if (key.pageUp) setScrolledBy((o) => Math.min(maxScroll, o + page));
      else if (key.pageDown) setScrolledBy((o) => Math.max(0, o - page));
      // Shift+Tab and Enter both return; Esc is deliberately unbound here, so
      // it stays free for something that genuinely means "cancel".
      else if (key.return) setFocus('input');
      else if (input && !key.ctrl && !key.meta && !key.tab) {
        // Carry the keystroke into the prompt rather than swallowing it.
        setFocus('input');
        setValue((v) => v + input);
      }
      return;
    }

    if (key.tab) {
      const completed = completeCommand(value);
      if (completed) {
        setValue(completed);
        tuiStore.setPaletteError(null);
        return;
      }
      // Tab that changes nothing has to say why. Silence is indistinguishable
      // from a broken key, and the common cases — an ambiguous prefix, or a
      // word that is already complete — both produce no edit.
      const partial = value.trim();
      if (!partial.startsWith('/') || partial.includes(' ')) return;
      const matches = matchCommands(partial);
      tuiStore.setPaletteError(
        matches.length === 0
          ? `No command matches ${partial}`
          : matches.length === 1
            ? `${matches[0].name} — already complete`
            : matches.map((m) => m.name).join('  ')
      );
      return;
    }

    if (key.upArrow) recallHistory(-1);
    else if (key.downArrow) recallHistory(1);
    // Page keys still scroll from the prompt, for anyone who reaches for them.
    else if (key.pageUp) setScrolledBy((o) => Math.min(maxScroll, o + page));
    else if (key.pageDown) setScrolledBy((o) => Math.max(0, o - page));
  });

  function updateQuery(next: string): void {
    setValue(next);
    // Typing puts you back on the live draft — otherwise the next ↓ would jump
    // to a history entry instead of the line being edited.
    if (historyIndex !== 0) setHistoryIndex(0);
    // Clear a previous "unknown command" note as soon as the user starts
    // fixing it, rather than leaving it up until they resubmit.
    if (ui.paletteError) tuiStore.setPaletteError(null);
  }

  async function submit(raw: string): Promise<void> {
    if (ui.running) return; // keep the typed text if the submit is ignored
    setValue('');
    setHistory((h) => appendHistory(h, raw));
    setHistoryIndex(0);
    draftRef.current = '';
    setScrolledBy(0); // jump back to live so the result is visible
    tuiStore.setRunning(true);
    try {
      await executeLine(raw, actions);
    } catch (err) {
      tuiStore.log('error', err instanceof Error ? err.message : String(err));
    } finally {
      tuiStore.setRunning(false);
    }
  }

  // The recorded-step count is the core feedback loop of a recording session,
  // so it rides along with the device context rather than hiding in /list.
  const recorded = `${ui.steps.length} step${ui.steps.length === 1 ? '' : 's'} recorded`;
  const subtitle = ui.platform
    ? `${ui.platform}${ui.device ? ` · ${ui.device.name}` : ' · no device selected'} · ${recorded}`
    : recorded;

  // Below this the frame cannot fit, and Ink does not clip an over-tall frame
  // — it overlaps rows, printing two lines of text onto one. Saying so beats
  // rendering something corrupted.
  if (rows < MIN_MAIN_ROWS) {
    return (
      <Box flexDirection="column" height={rows} justifyContent="center" alignItems="center">
        <Text color={COLORS.yellow} bold>
          Terminal too small
        </Text>
        <Text color={COLORS.dimmed}>
          {rows} rows available, {MIN_MAIN_ROWS} needed — resize and it redraws.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      {/* Outer frame box — the wireframe's outer rectangle, wrapping the
          palette, instruction input, stream panel and transcript. */}
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={COLORS.brand}
        paddingX={1}
      >
        <Header subtitle={subtitle} />
        {/* Two full-height columns. The transcript sits under the palette
            rather than spanning the frame, which is what frees the whole right
            column — and therefore the whole frame height — for the picture. */}
        <Box flexDirection="row" flexGrow={1}>
          {/* Transcript on top, input at the bottom of the column — history
              reads downward into the prompt you type next, and the input sits
              where the cursor already is rather than mid-column. */}
          <Box flexDirection="column" width={widths.left} marginRight={1}>
            <Transcript
              rows={visibleRows}
              budget={transcriptBudget}
              scrolledBy={scroll}
              total={allRows.length}
              focused={focus === 'transcript'}
            />
            <CommandPalette
              width={widths.left}
              maxCommands={maxCommands}
              query={value}
              onQueryChange={updateQuery}
              onSubmit={submit}
              disabled={ui.running}
              error={ui.paletteError}
              busyText={ui.busyMessage}
              focused={focus === 'input'}
            />
          </Box>
          <StreamPanel
            device={ui.device}
            stream={ui.stream}
            width={widths.right}
            imageRows={imageRows}
          />
        </Box>
      </Box>
      <StatusBar
        breadcrumb="Main"
        hints={
          focus === 'transcript'
            ? ['↑↓ scroll', '⇧tab back to prompt', 'ctrl+c quit']
            : [
                '/help',
                '/export',
                '/goal',
                '↑↓ history',
                'tab complete',
                '⇧tab scroll',
                'ctrl+c quit',
              ]
        }
        message={ui.statusMessage}
      />
    </Box>
  );
}
