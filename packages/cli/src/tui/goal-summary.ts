/**
 * The journey summary, as the transcript sees it.
 *
 * Its own module so it can be tested without standing up the whole shell, and
 * because `index.ts` is long enough already.
 */

import { symbols } from '../ui/ink/theme.js';
import type { GoalSessionOutcome } from '../goal-session.js';

/**
 * The journey summary as transcript detail lines.
 *
 * The run screen draws this once and then the screen is gone; a resident shell
 * came back to the prompt holding "Done — All sub-goals completed" and nothing
 * else. Everything expensive to reproduce goes here — what each sub-goal did,
 * and what the run cost — because re-running the agent is the only other way to
 * find out.
 */
export function summariseOutcome(outcome: GoalSessionOutcome): string {
  const { input, output, cost } = outcome.tokens;
  const lines = [
    [
      `${outcome.totalSteps} step${outcome.totalSteps === 1 ? '' : 's'}`,
      `${(outcome.durationMs / 1000).toFixed(1)}s`,
      `${input.toLocaleString()} in / ${output.toLocaleString()} out`,
      `$${cost.toFixed(4)}`,
    ].join(` ${symbols.dot} `),
  ];
  for (const sub of outcome.subGoals) {
    const mark = sub.status === 'completed' ? symbols.check : symbols.cross;
    // The result is what the agent actually found — the Wi-Fi name, the order
    // number — so it is the one part worth keeping verbatim.
    lines.push(`${mark} ${sub.goal}${sub.result ? ` ${symbols.arrow} ${sub.result}` : ''}`);
  }
  return lines.join('\n');
}
