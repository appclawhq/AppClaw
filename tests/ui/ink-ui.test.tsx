/**
 * Ink agent-loop UI tests — render <RunScreen> via ink-testing-library and
 * drive the store the same way the InkRenderer does during a run. No device or
 * network deps, so this is CI-safe.
 */
import React from 'react';
import { describe, test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { RunScreen, tailSlice } from '@appclaw/cli/ui/ink/RunScreen';
import type { TimelineEntry, JourneySummaryData } from '@appclaw/cli/ui/ink/store';
import { store } from '@appclaw/cli/ui/ink/store';
import { askUserViaInk } from '@appclaw/cli/ui/ink/InkRenderer';
import { FinalSummary } from '@appclaw/cli/ui/ink/components/FinalSummary';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { StreamPanel } from '@appclaw/cli/tui/components/StreamPanel';
import { columnWidths, panelImageRows } from '@appclaw/cli/tui/stream/layout';
import { PLACEHOLDER_CHAR } from '@appclaw/cli/tui/stream/placeholder';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('Ink RunScreen', () => {
  test('renders goal, steps, result and token summary', async () => {
    const { frames, unmount } = render(<RunScreen />);
    store.reset();
    store.setGoal('Log in and search for headphones', 12);
    await tick();
    store.beginStep(1, 12, 'tap', 'click', 'search icon');
    store.setStepDetail('Tapped "search icon"', 'done');
    store.endStep();
    store.beginStep(2, 12, 'type', 'type', '"headphones" → field');
    store.setStepDetail('Element not found', 'failed');
    store.endStep();
    await tick();
    store.finish({ status: 'success', reason: 'Results visible', steps: 2 });
    store.summary({
      input: 24000,
      output: 850,
      cached: 12000,
      cost: 0.0123,
      model: 'claude-opus-4-8',
    });
    await tick();

    const t = frames.join('\n');
    expect(t).toContain('Log in and search');
    expect(t).toContain('tap');
    expect(t).toContain('search icon');
    expect(t).toContain('Element not found');
    expect(t).toContain('COMPLETED');
    expect(t).toContain('claude-opus-4-8');
    unmount();
  });

  test('multi sub-goal: compact dividers + pinned bottom bar', async () => {
    const { lastFrame, frames, unmount } = render(<RunScreen />);
    store.reset();
    store.setRunContext({
      overallGoal: 'open youtube and search appium',
      subGoalTotal: 3,
      model: 'gemini-3.1-flash-lite',
      mode: 'vision',
    });
    await tick();
    store.setSubGoal(0, 3, 'open youtube and search appium', 'Launch the YouTube app');
    store.beginStep(1, 30, 'launch', 'launch', 'YouTube');
    store.setStepDetail('Launched youtube', 'done');
    store.endStep();
    store.finish({ status: 'success', reason: 'app open', steps: 1 });
    await tick();
    // next sub-goal in progress
    store.setSubGoal(2, 3, 'open youtube and search appium', "Type 'appium' and submit");
    store.beginStep(2, 30, 'type', 'type', '"appium" → field');
    store.addTokens(4200, 120, 0, 0);
    await tick();

    const transcript = frames.join('\n');
    expect(transcript).toContain('1/3 Launch the YouTube app'); // compact divider
    expect(transcript).not.toContain('Progress'); // old block gone
    const live = lastFrame() ?? '';
    expect(live).toContain('sub-goal 3/3'); // pinned bottom bar
    expect(live).toContain('step 2/30');
    expect(live).toContain('gemini-3.1-flash-lite');
    unmount();
  });

  test('default view: plan checklist ticks, per-step rows + COMPLETED boxes hidden', async () => {
    store.reset();
    store.setShowSteps(false);
    store.setRunContext({ overallGoal: 'do a thing', subGoalTotal: 2 });
    store.plan(['Open the app', 'Do the thing'], '');
    const { lastFrame, frames, unmount } = render(<RunScreen />);
    await tick();
    store.setSubGoal(0, 2, 'do a thing', 'Open the app');
    store.startSubGoal('Open the app', 30);
    store.beginStep(1, 30, 'tap', 'click', 'blue search icon on the on-screen keyboard');
    store.setStepDetail('Clicked at [130,1591]', 'done');
    store.endStep();
    store.finish({ status: 'success', reason: 'app opened', steps: 1 });
    // advance to next sub-goal (clears `result`, re-shows the live checklist)
    store.setSubGoal(1, 2, 'do a thing', 'Do the thing');
    store.startSubGoal('Do the thing', 30);
    await tick();

    const t = frames.join('\n');
    expect(t).toContain('Open the app'); // shown in the plan checklist
    expect(lastFrame()).toMatch(/✓.*Open the app/s); // ticked done
    expect(t).not.toContain('COMPLETED'); // per-sub-goal result box hidden
    expect(t).not.toContain('on-screen keyboard'); // per-step row hidden
    unmount();
  });

  test('journey summary renders pass/fail panel with sub-goal table', async () => {
    store.reset();
    const { frames, unmount } = render(<RunScreen />);
    await tick();
    store.journey({
      success: false,
      overallGoal: 'log in and open settings',
      subGoals: [
        { goal: 'Log in', status: 'completed' },
        { goal: 'Open settings', status: 'failed' },
      ],
      totalSteps: 5,
      durationMs: 23400,
      tokens: { input: 12000, output: 400, cost: 0.0031, model: 'opus' },
    });
    await tick();
    const t = frames.join('\n');
    expect(t).toContain('FAILED');
    expect(t).toContain('1 passed');
    expect(t).toContain('1 failed');
    expect(t).toContain('Log in');
    expect(t).toContain('Open settings');
    expect(t).toContain('$0.0031');
    unmount();
  });

  test('plan renders in transcript; summary shows full goal + sub-goal names', async () => {
    store.reset();
    const { frames, unmount } = render(<RunScreen />, { columns: 100 } as any);
    await tick();
    store.plan(['Launch app', 'Search and favourite'], 'decomposition reasoning');
    const longGoal =
      'open rapido app and search for Mumbai Airport and favourite the first result, then delete it';
    const longSub = "Tap the destination search field and Type 'Mumbai Airport' into it";
    store.journey({
      success: true,
      overallGoal: longGoal,
      subGoals: [{ goal: longSub, status: 'completed' }],
      totalSteps: 3,
      durationMs: 1000,
      tokens: { input: 1, output: 1, cost: 0.01, model: 'm' },
    });
    await tick();
    const t = frames.join('\n');
    expect(t).toContain('Plan');
    expect(t).toContain('Launch app');
    expect(t).toContain(longGoal); // goal shown in full, not truncated
    expect(t).toContain(longSub); // sub-goal name shown in full
    unmount();
  });

  test('tailSlice keeps the most recent entries within the row budget', () => {
    const entries: TimelineEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      type: 'subgoal' as const,
      index: i,
      total: 50,
      goal: `goal ${i}`,
    }));
    // each subgoal ~2 rows; budget 20 → ~10 entries, the LAST ones
    const slice = tailSlice(entries, 20);
    expect(slice.length).toBeLessThan(entries.length);
    expect(slice[slice.length - 1].id).toBe(49); // newest kept
    expect(slice[0].id).toBeGreaterThan(0); // oldest dropped
  });

  test('flow steps render as completed rows', async () => {
    const { frames, unmount } = render(<RunScreen />);
    store.reset();
    store.setGoal('login.yaml', 2);
    await tick();
    store.pushStep(1, 2, '', 'tool_call', 'tap "Login"', 'done');
    store.pushStep(2, 2, '', 'tool_call', 'assert "Welcome"', 'failed');
    await tick();
    store.finish({ status: 'failed', reason: '1/2 steps passed', steps: 2 });
    await tick();

    const t = frames.join('\n');
    expect(t).toContain('login.yaml');
    expect(t).toContain('tap "Login"');
    expect(t).toContain('FAILED');
    unmount();
  });

  test('HITL prompt renders and resolves with mapped option', async () => {
    const { lastFrame, stdin, unmount } = render(<RunScreen />);
    store.reset();
    store.setGoal('Sign in', 10);
    await tick();
    const answer = askUserViaInk({
      type: 'choice',
      question: 'Which account? ',
      options: ['Work', 'Personal'],
    });
    await tick();
    expect(lastFrame()).toContain('[CHOICE]');
    expect(lastFrame()).toContain('Personal');
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    const res = await answer;
    expect(res).toEqual({ answered: true, answer: 'Personal', timedOut: false });
    unmount();
  });
});

describe('Ink FinalSummary', () => {
  const journeyData = (
    overrides: Partial<JourneySummaryData> = {},
    subGoals: JourneySummaryData['subGoals'] = []
  ): JourneySummaryData => ({
    success: true,
    overallGoal: 'open settings and get the wifi name',
    subGoals,
    totalSteps: 3,
    durationMs: 58400,
    tokens: { input: 17425, output: 86, cost: 0.0536, model: 'claude-sonnet-4-6' },
    ...overrides,
  });

  // Regression test for the bug where a sub-goal's `done` reason — e.g. the
  // Wi-Fi name the agent was asked to find — reached this component but was
  // never rendered, only its goal text and pass/fail were.
  test('renders each sub-goal result text, not just goal + pass/fail', () => {
    const data = journeyData({}, [
      { goal: 'Open the Settings app', status: 'completed', result: 'Opened Settings' },
      {
        goal: 'Navigate to Network & internet → Internet and identify the Wi-Fi name',
        status: 'completed',
        result: "The connected Wi-Fi network is 'AndroidWifi'",
      },
    ]);
    const { lastFrame, unmount } = render(<FinalSummary data={data} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('AndroidWifi');
    expect(out).toContain('Opened Settings');
    unmount();
  });

  test('renders a failed sub-goal result alongside FAIL', () => {
    const data = journeyData({ success: false }, [
      {
        goal: "Tap on 'Network & internet'",
        status: 'failed',
        result: 'UiAutomator2 driver crashed',
      },
    ]);
    const { lastFrame, unmount } = render(<FinalSummary data={data} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('FAIL');
    expect(out).toContain('UiAutomator2 driver crashed');
    unmount();
  });

  test('omits the result line when a sub-goal has no result text', () => {
    const data = journeyData({}, [{ goal: 'Open the Settings app', status: 'completed' }]);
    const { lastFrame, unmount } = render(<FinalSummary data={data} />);
    expect(lastFrame()).toContain('Open the Settings app');
    unmount();
  });
});

/**
 * The whole point of Unicode placeholders is that Ink lays the picture out, so
 * the thing worth pinning down is that a row of them still measures like text.
 *
 * It nearly doesn't: Ink's output buffer bills each placeholder (a surrogate
 * pair) as two cells while the terminal draws it as one, so a placeholder row
 * runs past the panel and eats the borders to its right. <StreamPanel> redraws
 * them; this asserts the redraw lands in the right column.
 */
describe('StreamPanel unicode placeholders', () => {
  const termCols = 100; // ink-testing-library's stdout width
  const termRows = 24;

  function frameOf(stream: unknown) {
    const { left, right } = columnWidths(termCols);
    const imageRows = panelImageRows(termRows, true);
    const { lastFrame, unmount } = render(
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Box flexDirection="row">
            <Box width={left} marginRight={1} borderStyle="round" flexDirection="column">
              {Array.from({ length: imageRows + 2 }, (_, i) => (
                <Text key={i}>palette</Text>
              ))}
            </Box>
            <StreamPanel
              device={{ udid: 'x', name: 'emulator-5554', platform: 'android' } as never}
              stream={stream as never}
              width={right}
              imageRows={imageRows}
            />
          </Box>
        </Box>
      </Box>
    );
    const out = lastFrame() ?? '';
    unmount();
    return out;
  }

  const live = {
    status: 'running',
    backend: 'kitty',
    resolution: { width: 1080, height: 2400 },
  };

  test('every rendered row is the same display width, borders included', () => {
    const lines = frameOf(live).split('\n');
    const widths = new Set(lines.map((line) => stringWidth(line)));
    expect(widths.size).toBe(1);
  });

  test('the rows carry one addressed placeholder cell per image row', () => {
    const out = frameOf(live);
    const rows = out.split('\n').filter((line) => line.includes(PLACEHOLDER_CHAR));
    expect(rows.length).toBeGreaterThan(0);
    // Row 0's leading cell: placeholder + row diacritic 0 + column diacritic 0.
    expect(rows[0]).toContain(`${PLACEHOLDER_CHAR}̅̅`);
    // Colour is asserted in tui-stream.test.ts — chalk emits none under vitest.
  });

  test('a half-block stream still renders as plain text rows', () => {
    const out = frameOf({
      status: 'running',
      backend: 'halfblock',
      resolution: { width: 1080, height: 2400 },
      frameLines: ['▀▀▀▀'],
    });
    expect(out).not.toContain(PLACEHOLDER_CHAR);
    expect(out).toContain('▀▀▀▀');
  });
});

describe('Ink FinalSummary', () => {
  const journeyData = (
    overrides: Partial<JourneySummaryData> = {},
    subGoals: JourneySummaryData['subGoals'] = []
  ): JourneySummaryData => ({
    success: true,
    overallGoal: 'open settings and get the wifi name',
    subGoals,
    totalSteps: 3,
    durationMs: 58400,
    tokens: { input: 17425, output: 86, cost: 0.0536, model: 'claude-sonnet-4-6' },
    ...overrides,
  });

  // Regression test for the bug where a sub-goal's `done` reason — e.g. the
  // Wi-Fi name the agent was asked to find — reached this component but was
  // never rendered, only its goal text and pass/fail were.
  test('renders each sub-goal result text, not just goal + pass/fail', () => {
    const data = journeyData({}, [
      { goal: 'Open the Settings app', status: 'completed', result: 'Opened Settings' },
      {
        goal: 'Navigate to Network & internet → Internet and identify the Wi-Fi name',
        status: 'completed',
        result: "The connected Wi-Fi network is 'AndroidWifi'",
      },
    ]);
    const { lastFrame, unmount } = render(<FinalSummary data={data} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('AndroidWifi');
    expect(out).toContain('Opened Settings');
    unmount();
  });

  test('renders a failed sub-goal result alongside FAIL', () => {
    const data = journeyData({ success: false }, [
      {
        goal: "Tap on 'Network & internet'",
        status: 'failed',
        result: 'UiAutomator2 driver crashed',
      },
    ]);
    const { lastFrame, unmount } = render(<FinalSummary data={data} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('FAIL');
    expect(out).toContain('UiAutomator2 driver crashed');
    unmount();
  });

  test('omits the result line when a sub-goal has no result text', () => {
    const data = journeyData({}, [{ goal: 'Open the Settings app', status: 'completed' }]);
    const { lastFrame, unmount } = render(<FinalSummary data={data} />);
    expect(lastFrame()).toContain('Open the Settings app');
    unmount();
  });
});
