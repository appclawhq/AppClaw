/**
 * What survives a finished goal run.
 *
 * The run screen is the only place the journey summary is drawn, and leaving it
 * used to take the sub-goal breakdown, the token count and the cost with it —
 * the resident shell came back to the prompt holding one line. Re-running the
 * agent was the only way to see any of it again, which is the most expensive
 * possible way to answer "what did it actually find?".
 */
import { describe, expect, test } from 'vitest';
import { summariseOutcome } from '@appclaw/cli/tui/goal-summary';
import type { GoalSessionOutcome } from '@appclaw/cli/goal-session';

const outcome = (over: Partial<GoalSessionOutcome> = {}): GoalSessionOutcome =>
  ({
    success: true,
    reason: 'All sub-goals completed',
    totalSteps: 12,
    durationMs: 34_200,
    tokens: { input: 18_420, output: 1_360, cost: 0.0412, model: 'claude-opus-5' },
    subGoals: [
      { goal: 'Open the Settings app', status: 'completed', result: 'Settings open' },
      { goal: 'Read the Wi-Fi network name', status: 'completed', result: 'HomeNet-5G' },
    ],
    history: [],
    exportHistory: [],
    ...over,
  }) as GoalSessionOutcome;

describe('summariseOutcome', () => {
  test('keeps what the agent found, not just that it finished', () => {
    const lines = summariseOutcome(outcome()).split('\n');
    // The answer to the goal is the whole reason the run happened.
    expect(lines.join('\n')).toContain('HomeNet-5G');
    expect(lines).toHaveLength(3); // one cost line + one per sub-goal
  });

  test('the first line is what the run cost', () => {
    const [first] = summariseOutcome(outcome()).split('\n');
    expect(first).toContain('12 steps');
    expect(first).toContain('34.2s');
    expect(first).toContain('18,420 in / 1,360 out');
    expect(first).toContain('$0.0412');
  });

  test('a failed sub-goal is marked as one', () => {
    const text = summariseOutcome(
      outcome({
        success: false,
        subGoals: [
          { goal: 'Open the Settings app', status: 'completed', result: 'Settings open' },
          { goal: 'Read the Wi-Fi network name', status: 'failed' },
        ],
      })
    );
    expect(text).toContain('✓ Open the Settings app');
    expect(text).toContain('✗ Read the Wi-Fi network name');
  });

  test('a sub-goal with no result still gets a line', () => {
    // Skipped and failed sub-goals carry no result; dropping them would leave
    // the plan looking shorter than it was.
    const text = summariseOutcome(
      outcome({ subGoals: [{ goal: 'Dismiss the update prompt', status: 'skipped' }] })
    );
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('Dismiss the update prompt');
  });

  test('one step reads as one step', () => {
    expect(summariseOutcome(outcome({ totalSteps: 1 }))).toContain('1 step ');
  });
});
