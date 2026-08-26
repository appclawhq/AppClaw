/**
 * Goal export — turn an agent run into a replayable SDK test.
 *
 * After `app.runGoal(goal)` finishes, the agent leaves behind a `history` of
 * tool-call decisions (find_and_click, find_and_type, launch_app, …). This
 * module translates those decisions back into the natural-language form that
 * `app.run(...)` accepts, then renders a complete @appclaw/runner spec file.
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
  platform?: string;
  agentMode?: string;
  /** Module path for the generated `import { test } from '<...>'`. Default: '@appclaw/runner'. */
  sdkImport?: string;
  /** Prefixed onto the test title when set (e.g. from `/meta name`). */
  describeName?: string;
  /** `test(...)` title. Default: derived from the recorded steps. */
  testName?: string;
  /**
   * Unused. The runner takes its per-test timeout from `appclaw.config.ts` or
   * `--timeout`, so a literal in the spec would be ignored.
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
 * Build a descriptive `test(...)` name from the recorded instructions.
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
 * Render a complete @appclaw/runner spec that replays the agent's trajectory
 * via `app.run(...)` calls. Write it under the runner's `testDir` and it is
 * picked up by `appclaw test`.
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
 * Render a runner spec from a flat list of natural-language instructions.
 *
 * Used by `/export some.test.ts` where steps are already in
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
  // Default test name describes what the steps DO, not what the goal asked for.
  // The original goal is preserved in the file header comment for traceability.
  const testName = cfg.testName ?? defaultTestNameFromSteps(instructions);
  // The runner has no `describe` requirement, so the group name (when the user
  // set one via /meta name) is folded into the title rather than wrapping the
  // file in a block that exists only to hold one test.
  const describeName = cfg.describeName ?? '';
  const testTitle =
    describeName && describeName !== 'Recorded flow' ? `${describeName} — ${testName}` : testName;
  const agentStepsUsed = opts.agentStepsUsed;

  // Provider, apiKey and agentMode are not written into the spec any more: the
  // runner owns the session, and those belong in appclaw.config.ts where one
  // change covers every test. Platform is the exception — it selects which
  // devices a test is eligible for, so it stays per-test.
  const testOptions = cfg.platform ? `{ platform: ${JSON.stringify(cfg.platform)} }, ` : '';

  const runLines = instructions.map((i) => `  await app.run(${JSON.stringify(i)});`);

  const fromAgent = agentStepsUsed !== undefined;
  const goalLine = goal.trim()
    ? `Original goal: ${goal.replace(/\*\//g, '*\\/')}`
    : 'Source: AppClaw recording session';
  const stepsLine = fromAgent
    ? `Steps recorded: ${instructions.length} (from ${agentStepsUsed} agent step${agentStepsUsed === 1 ? '' : 's'})`
    : `Steps recorded: ${instructions.length}`;

  // Caveats vary by source: agent-mode exports inherit non-determinism from the
  // LLM trajectory; recorded exports are user-validated steps and only need a
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
        '1. Each step is the verbatim text you typed — exactly what `app.run()`',
        '   will receive. There is no translator in between, so the replay should',
        '   behave identically to the session it was recorded in.',
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
 * ${stepsLine}
 *
 * Caveats — read before running this in CI:
 *
${caveatBlock}
 */
import { test } from ${JSON.stringify(runnerImport)};

test(${JSON.stringify(testTitle)}, ${testOptions}async ({ app }) => {
${runLines.join('\n')}
});
`;
}
