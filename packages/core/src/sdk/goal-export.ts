/**
 * Goal export — turn an agent run into a replayable SDK test.
 *
 * After `app.runGoal(goal)` finishes, the agent leaves behind a `history` of
 * tool-call decisions (find_and_click, find_and_type, launch_app, …). This
 * module translates those decisions back into the natural-language form that
 * `app.run(...)` accepts, then renders a complete AppClaw runner spec file.
 *
 * Why translate back to natural language instead of dumping raw tool calls?
 * The SDK's `app.run()` is the supported public surface — `find_and_click` is
 * an internal agent-loop concept. Natural-language steps are also human-readable
 * and survive minor UI changes better than coordinate-pinned tool calls.
 */

import type { AgentResult, StepRecord } from '../agent/loop.js';
import type { ToolCallDecision } from '../llm/provider.js';

/** Subset of AppClawOptions worth pinning into the generated test header. */
export interface GenerateSdkTestConfig {
  provider?: string;
  /** Recorded platform — noted in the header comment for traceability. */
  platform?: string;
  agentMode?: string;
  /** Module the runner `test`/`describe` are imported from. Default: '@appclaw/runner'. */
  sdkImport?: string;
  /** `describe(...)` block title. Default: 'Recorded flow'. */
  describeName?: string;
  /** `test(...)` title. Default: derived from the recorded steps. */
  testName?: string;
  /**
   * Deprecated — the runner owns per-test timeouts via appclaw.config.ts, so this
   * is no longer emitted. Kept for backward compatibility with older callers.
   */
  timeoutMs?: number;
}

/**
 * Translate one agent decision into a natural-language SDK instruction.
 * Returns null for decisions that have no replayable equivalent (`done`,
 * `screenshot`, internal book-keeping). Failed steps are filtered out by the
 * caller, not here.
 */
export function decisionToInstruction(decision: ToolCallDecision): string | null {
  const { toolName, args } = decision;
  switch (toolName) {
    case 'find_and_click': {
      const selector = (args.selector as string | undefined)?.trim();
      return selector ? `tap ${selector}` : null;
    }
    case 'find_and_long_press': {
      const selector = (args.selector as string | undefined)?.trim();
      return selector ? `long press ${selector}` : null;
    }
    case 'find_and_type': {
      const selector = (args.selector as string | undefined)?.trim();
      const text = (args.text as string | undefined) ?? '';
      if (!selector) return null;
      // Quote the text so multi-word strings parse correctly via tryParseNaturalFlowLine.
      return `type "${text.replace(/"/g, '\\"')}" into ${selector}`;
    }
    case 'launch_app': {
      // Prefer the friendly name (e.g. "YouTube") when the agent recorded one,
      // so the replay reads naturally. Fall back to the package/bundle ID.
      const appName = (args.appName as string | undefined)?.trim();
      const appId = (args.appId as string | undefined)?.trim();
      const target = appName || appId;
      return target ? `open ${target} app` : null;
    }
    case 'go_back':
      return 'back';
    case 'go_home':
      return 'home';
    case 'press_enter':
      return 'press enter';
    default:
      // done / screenshot / wait / get_info / anything custom — skip.
      // The agent's own retry/completion bookkeeping shouldn't show up in the replay.
      return null;
  }
}

/**
 * Drop steps from earlier "failed branches" within a single agent run.
 *
 * The agent's `done` tool is its "I'm finished" signal. The verification layer
 * may reject a `done` if the screen doesn't actually match the goal — in that
 * case the loop continues. Therefore: any `done` that is NOT the last record
 * in this history was rejected, and everything from the start of the history
 * up to and including that `done` was a failed branch that the agent then
 * recovered from.
 *
 * We keep only the records AFTER the last rejected `done` so the replay
 * captures just the successful path. If there are no rejected `done`s, the
 * input is returned unchanged.
 *
 * IMPORTANT: this must be applied per agent run (per sub-goal). A flat
 * concatenation of multiple sub-goals' histories would mis-identify each
 * sub-goal's accepted `done` as a "non-last rejected done".
 */
export function keepOnlyFinalAttempt(history: StepRecord[]): StepRecord[] {
  let lastRejectedIdx = -1;
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].decision.toolName === 'done') {
      lastRejectedIdx = i;
    }
  }
  if (lastRejectedIdx === -1) return history;
  return history.slice(lastRejectedIdx + 1);
}

/**
 * Build a descriptive `it(...)` test name from the recorded instructions.
 * Prefers anchors that tell a story: the launched app + the final user action,
 * e.g. "launches YouTube and taps search icon". Falls back to "executes <N>
 * recorded steps" when the trajectory doesn't have a clean anchor.
 */
function defaultTestNameFromSteps(instructions: string[]): string {
  if (instructions.length === 0) return 'executes 0 recorded steps';

  // The launched app is often the most identifying anchor for what the test covers.
  const opener = instructions.find((i) => /^open\s+.+\s+app$/i.test(i));
  // The last non-trivial step usually describes the user's intent at the end.
  const closer = [...instructions]
    .reverse()
    .find((i) => !/^(wait|back|home|press enter)\b/i.test(i));

  if (opener && closer && opener !== closer) {
    const appName = opener.replace(/^open\s+(.+)\s+app$/i, '$1');
    return `launches ${appName} and ${closer}`;
  }
  if (closer) return closer;
  return `executes ${instructions.length} recorded steps`;
}

/**
 * Build an array of natural-language instructions from an AgentResult's history.
 * Drops failed steps (they didn't actually affect the device state we want to
 * replay) and any decisions with no replayable equivalent.
 */
export function instructionsFromHistory(history: StepRecord[]): string[] {
  const out: string[] = [];
  for (const record of history) {
    // Skip steps whose `result` string clearly indicates failure. The agent's
    // recovery logic means a successful run may include failed attempts that
    // were superseded — replaying those would diverge from the live trajectory.
    const looksFailed = /^(failed|error|could not|element not found)/i.test(record.result);
    if (looksFailed) continue;
    const instruction = decisionToInstruction(record.decision);
    if (instruction) out.push(instruction);
  }
  return out;
}

/**
 * Render a complete AppClaw runner spec that replays the agent's trajectory via
 * `app.run(...)` calls. The output is ready to write to disk and run with
 * `appclaw-runner path/to/file`.
 */
export function generateSdkTest(opts: {
  goal: string;
  result: AgentResult;
  config?: GenerateSdkTestConfig;
}): string {
  return renderSdkTest({
    instructions: instructionsFromHistory(opts.result.history),
    goal: opts.goal,
    agentStepsUsed: opts.result.stepsUsed,
    config: opts.config,
  });
}

/**
 * Render an AppClaw runner spec from a flat list of natural-language instructions.
 *
 * Used by the playground (`/export some.test.ts`) where steps are already in
 * `app.run()`-ready form — no agent history to translate. The optional `goal`
 * is purely for the header comment; pass empty string if there's no concept
 * of a goal (interactive sessions).
 */
export function generateSdkTestFromInstructions(opts: {
  instructions: string[];
  goal?: string;
  config?: GenerateSdkTestConfig;
}): string {
  return renderSdkTest({
    instructions: opts.instructions,
    goal: opts.goal ?? '',
    config: opts.config,
  });
}

function renderSdkTest(opts: {
  instructions: string[];
  goal: string;
  agentStepsUsed?: number;
  config?: GenerateSdkTestConfig;
}): string {
  const cfg = opts.config ?? {};
  const { instructions, goal } = opts;
  const runnerImport = cfg.sdkImport ?? '@appclaw/runner';
  const describeName = cfg.describeName ?? 'Recorded flow';
  // Default test name describes what the steps DO, not what the goal asked for.
  // The original goal is preserved in the file header comment for traceability.
  const testName = cfg.testName ?? defaultTestNameFromSteps(instructions);
  const agentStepsUsed = opts.agentStepsUsed;

  // Runner tests receive `app` from the fixture and run one natural-language
  // step per `app.run(...)` — no client construction, no teardown.
  const runLines = instructions.map((i) => `    await app.run(${JSON.stringify(i)});`);

  const fromAgent = agentStepsUsed !== undefined;
  const goalLine = goal.trim()
    ? `Original goal: ${goal.replace(/\*\//g, '*\\/')}`
    : 'Source: AppClaw playground';
  const stepsLine = fromAgent
    ? `Steps recorded: ${instructions.length} (from ${agentStepsUsed} agent step${agentStepsUsed === 1 ? '' : 's'})`
    : `Steps recorded: ${instructions.length}`;
  const platformLine = cfg.platform ? `\n * Recorded on: ${cfg.platform}` : '';

  // Caveats vary by source: agent-mode exports inherit non-determinism from the
  // LLM trajectory; playground exports are user-validated steps and only need a
  // brief reminder that selectors may drift across UI revisions.
  const caveats = fromAgent
    ? [
        '1. Replay does not have the goal-mode safety net. In goal mode the agent',
        '   re-checks the screen after each step, retries failed actions, and adapts',
        '   when the UI is in an unexpected state. `app.run(...)` calls below do none',
        '   of that — each step fires once and moves on. If a step worked on the',
        "   second try in goal mode, it may need an explicit `app.run('wait 2 seconds')`",
        '   or an `app.verify(...)` checkpoint here before the next step.',
        '',
        '2. Failed/recovered steps were filtered out, so the count above may differ',
        '   from what you saw in the live run.',
        '',
        '3. Coverage is best-effort. The translator (sdk/goal-export.ts) maps a fixed',
        "   set of agent tools to natural language. Any newer agent tool that isn't",
        '   in that map is silently skipped — if your replay is missing a step,',
        '   cross-check against the AgentResult.history.',
        '',
        '4. Edit freely. Treat this file as a draft: rename the test, add assertions',
        '   (`app.verify(...)`), tighten selectors, split into multiple `test()` blocks.',
      ]
    : [
        '1. Each step is the verbatim text you typed in the playground — exactly',
        '   what `app.run()` will receive. There is no translator in between,',
        '   so the replay should behave identically to the playground session.',
        '',
        '2. Selectors are still locator strings, not stable IDs. If the app UI',
        '   changes (icons relabelled, layout shifts), the natural-language',
        '   selectors above may need updating.',
        '',
        '3. Edit freely. Treat this file as a draft: rename the test, add',
        '   assertions (`app.verify(...)`), split into multiple `test()` blocks.',
      ];

  const caveatBlock = caveats.map((l) => ` * ${l}`.replace(/ +$/, '')).join('\n');

  return `/**
 * Generated by AppClaw — a replayable starting point, not a final test.
 *
 * ${goalLine}
 * ${stepsLine}${platformLine}
 *
 * Runs with the AppClaw runner (\`appclaw-runner\`). The runner injects a ready
 * \`app\` and owns the device session — provider, apiKey, and platform come from
 * appclaw.config.ts, so there is no client to construct or tear down here.
 *
 * Caveats — read before running this in CI:
 *
${caveatBlock}
 */
import { describe, test } from ${JSON.stringify(runnerImport)};

describe(${JSON.stringify(describeName)}, () => {
  test(${JSON.stringify(testName)}, async ({ app }) => {
${runLines.join('\n')}
  });
});
`;
}
