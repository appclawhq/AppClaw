/**
 * One natural-language goal, run end to end through the full planner path:
 * decompose → per-sub-goal orchestration (screen readiness + skip/rewrite) →
 * agent loop → journey summary.
 *
 * This used to live inline in `main()`, which meant only the one-shot CLI path
 * could reach it. It is a function now because Terminal Studio's goal mode runs
 * the same pipeline repeatedly against a device session it opened once —
 * so everything session-shaped (MCP, LLM, AppResolver) is a dependency here
 * rather than something this module creates and tears down.
 *
 * What it deliberately does NOT own: device setup, Ink mounting, `--export`
 * writing, and process exit. Those differ between a one-shot run and a resident
 * shell, so they stay with the caller. `onPlanned` is the seam the CLI uses to
 * mount Ink after decomposition but before the plan is rendered, so the plan
 * lands as the first transcript entry.
 */

import { getScreenState } from '@appclaw/core/perception/screen';
import { runAgent, type StepRecord } from '@appclaw/core/agent/loop';
import {
  decomposeGoal,
  createPlanExecutor,
  evaluateSubGoal,
  evaluateScreen,
  assessScreenReadiness,
} from '@appclaw/core/agent/planner';
import { buildModel, buildThinkingOptions, type LLMProvider } from '@appclaw/core/llm/provider';
import { prepareScreenshotForLlm } from '@appclaw/core/vision/prepare-screenshot-for-llm';
import { loadAppGuide } from '@appclaw/core/appguides/index';
import { AppResolver } from '@appclaw/core/agent/app-resolver';
import type { MCPClient } from '@appclaw/core/mcp/types';
import type { AppClawConfig } from '@appclaw/core/config';
import type { ActionRecorderLike } from '@appclaw/core/agent/loop';
import type { SessionLogger } from '@appclaw/core/logger';
import * as ui from '@appclaw/core/ui/terminal';
import { emitJson } from '@appclaw/core/json-emitter';

export interface GoalSessionDeps {
  config: AppClawConfig;
  /** Session-scoped MCP wrapper from `setupDevice` — never the bare client. */
  mcp: MCPClient;
  llm: LLMProvider;
  appResolver: AppResolver;
  /** Resolved model name, for token cost attribution. */
  modelName: string;
  /** Optional trajectory log (the one-shot CLI keeps one; the TUI has its own). */
  logger?: SessionLogger;
  /** Optional `--record` recorder. */
  recorder?: ActionRecorderLike;
  /**
   * Called once decomposition lands, before the plan is rendered. The CLI
   * mounts Ink here so the plan becomes the first entry in the transcript.
   */
  onPlanned?: (info: { subGoals: string[]; isComplex: boolean }) => void | Promise<void>;
  /**
   * Cooperative cancellation, checked between sub-goals and forwarded to the
   * agent loop, which checks it between steps. A stopped session still returns
   * an outcome — the steps and tokens spent so far are real and the caller has
   * to report them.
   */
  signal?: AbortSignal;
}

export interface GoalSessionOutcome {
  success: boolean;
  reason: string;
  totalSteps: number;
  durationMs: number;
  tokens: { input: number; output: number; cost: number; model: string };
  subGoals: Array<{ goal: string; status: string; result?: string }>;
  /** Complete trajectory including recovery branches — for the session log. */
  history: StepRecord[];
  /** Per-sub-goal, trimmed to the successful final attempt — for `--export`. */
  exportHistory: StepRecord[];
}

export async function runGoalSession(
  goal: string,
  deps: GoalSessionDeps
): Promise<GoalSessionOutcome> {
  const { config, mcp, llm, appResolver, modelName, logger, recorder, onPlanned, signal } = deps;

  // ── Detect app ID early — needed for AppGuide in planner + orchestrator ──
  let journeyAppId: string | undefined;
  try {
    const { extractAppIdFromText } = await import('@appclaw/core/memory/fingerprint');
    journeyAppId = extractAppIdFromText(goal);
    if (!journeyAppId) {
      const appMatch = goal.match(
        /(?:open|launch|start)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+app|\s+and\b)/i
      );
      if (appMatch) {
        journeyAppId = appResolver.resolve(appMatch[1].trim()) ?? undefined;
      }
    }
  } catch {
    // Non-critical
  }

  // Load AppGuide for the target app (if known) — shared by planner, orchestrator, and agent
  const journeyAppGuide = journeyAppId ? loadAppGuide(journeyAppId) : undefined;

  // ─── Always decompose goals into sub-goals ─────────
  ui.printPlanStart();
  const plannerModel = buildModel(config);
  const thinkingOptions = buildThinkingOptions(config);

  const planResult = await decomposeGoal(goal, plannerModel, thinkingOptions, journeyAppGuide);
  const executor = createPlanExecutor(planResult.subGoals);
  ui.stopSpinner();

  emitJson({
    event: 'plan',
    data: {
      goal,
      subGoals: planResult.subGoals.map((sg) => sg.goal),
      isComplex: planResult.isComplex,
    },
  });

  await onPlanned?.({
    subGoals: planResult.subGoals.map((sg) => sg.goal),
    isComplex: planResult.isComplex,
  });

  // Seed the live plan checklist (both simple and complex goals).
  ui.printPlan(planResult.subGoals, planResult.reasoning);

  // Execute each sub-goal sequentially
  let subGoalIdx = 0;
  let totalSteps = 0;
  let journeyInputTokens = 0;
  let journeyOutputTokens = 0;
  let journeyCost = 0;
  const journeyStart = Date.now();
  const allHistory: StepRecord[] = [];
  // exportHistory keeps only the "final successful attempt" per sub-goal —
  // recovery steps from failed branches are pruned via keepOnlyFinalAttempt.
  // Kept separate from allHistory so the session logger still records the
  // complete trajectory (including exploration) for debugging.
  const exportHistory: StepRecord[] = [];

  let stopped = false;
  while (!executor.isDone()) {
    if (signal?.aborted) {
      stopped = true;
      break;
    }
    const subGoal = executor.current!;

    // Reset action history between sub-goals for clean context
    llm.resetHistory();

    // Each sub-goal gets the full MAX_STEPS budget
    const stepsPerGoal = config.MAX_STEPS;

    // ─── Screen-aware orchestration ─────────────────────
    // Before executing, check the screen and decide: skip, rewrite, or proceed
    let effectiveGoal = subGoal.goal;

    if (planResult.isComplex && subGoalIdx > 0) {
      ui.startSpinner('Reconciling plan with device…', 'orchestrator');
      try {
        // Capture DOM and/or screenshot for orchestration between sub-goals.
        // Match agent loop: skip XML when AGENT_MODE=vision (orchestrator uses screenshot).
        const captureScreenshot = config.VISION_MODE !== 'never' || config.AGENT_MODE === 'vision';
        const skipOrchestratorPageSource = config.AGENT_MODE === 'vision';
        const screenState = await getScreenState(
          mcp,
          config.MAX_ELEMENTS,
          captureScreenshot,
          skipOrchestratorPageSource
        );
        const orchestratorDom =
          skipOrchestratorPageSource && !screenState.dom.trim()
            ? '(Vision mode: XML page source omitted — use the screenshot for visual state.)'
            : screenState.dom;

        const orchestratorScreenshot = await prepareScreenshotForLlm(
          screenState.screenshot,
          config.LLM_SCREENSHOT_MAX_EDGE_PX
        );

        // ─── Parallel: Screen readiness + Sub-goal evaluation ──
        // Run both checks in parallel — they're independent.
        // If readiness rewrites the goal, we skip the evaluation result.
        const prevGoal = executor.all[subGoalIdx - 1];
        const completedGoalsList = executor.all
          .filter((sg) => sg.status === 'completed')
          .map((sg) => `${sg.executedAs ?? sg.goal} → ${sg.result}`);

        const [readiness, decision] = await Promise.all([
          prevGoal
            ? assessScreenReadiness(
                plannerModel,
                prevGoal.executedAs ?? prevGoal.goal,
                subGoal.goal,
                orchestratorDom,
                thinkingOptions,
                orchestratorScreenshot,
                journeyAppGuide
              )
            : Promise.resolve({ ready: true, issues: [] as string[] } as {
                ready: boolean;
                issues: string[];
                suggestedAction?: string;
              }),
          evaluateSubGoal(
            plannerModel,
            goal,
            subGoal.goal,
            completedGoalsList,
            orchestratorDom,
            thinkingOptions,
            orchestratorScreenshot,
            journeyAppGuide
          ),
        ]);

        // Apply readiness result
        if (readiness && !readiness.ready) {
          ui.stopSpinner();
          ui.printScreenReadiness(readiness.issues, readiness.suggestedAction);
          if (readiness.suggestedAction) {
            effectiveGoal = `${readiness.suggestedAction}, then ${subGoal.goal}`;
            ui.printOrchestratorRewrite(subGoal.goal, effectiveGoal);
          }
          ui.startSpinner('Reconciling plan with device…', 'orchestrator');
        }

        // Apply evaluation result (only if readiness didn't already rewrite)
        if (effectiveGoal === subGoal.goal) {
          if (decision.action === 'skip') {
            ui.stopSpinner();
            ui.printOrchestratorSkip(subGoal.goal, decision.reason);
            executor.markCompleted(decision.reason);
            subGoalIdx++;
            continue;
          }
          ui.stopSpinner();
          if (decision.action === 'rewrite' && decision.rewrittenGoal) {
            ui.printOrchestratorRewrite(subGoal.goal, decision.rewrittenGoal);
            effectiveGoal = decision.rewrittenGoal;
          } else {
            ui.printOrchestratorProceed(subGoal.goal);
          }
        }
      } catch (err) {
        // Orchestrator failed — proceed with original goal
        ui.stopSpinner();
        ui.printWarning(`Orchestrator check failed: ${err}`);
      }
      ui.stopSpinner();
    }

    if (planResult.isComplex) {
      ui.printPlanContext(goal, effectiveGoal, executor.all, subGoalIdx);
    }

    // Build enriched goal with plan context so the LLM doesn't undo progress
    let enrichedGoal = effectiveGoal;
    if (planResult.isComplex) {
      const completedGoals = executor.all
        .filter((sg) => sg.status === 'completed')
        .map((sg) => `✓ ${sg.goal} (${sg.result})`)
        .join('\n');
      const remainingGoals = executor.all
        .filter((sg) => sg.status === 'pending' && sg.index !== subGoal.index)
        .map((sg) => `○ ${sg.goal}`)
        .join('\n');

      if (completedGoals) {
        enrichedGoal += `\n\nCONTEXT — Overall goal: "${goal}"\nAlready completed:\n${completedGoals}`;
        if (remainingGoals) {
          enrichedGoal += `\nStill pending (handled separately — NOT your job):\n${remainingGoals}`;
        }
        enrichedGoal += `\n\nIMPORTANT:`;
        enrichedGoal += `\n- Previous sub-goals are DONE. Do NOT navigate backwards or undo their work.`;
        enrichedGoal += `\n- ONLY perform actions for YOUR current sub-goal: "${effectiveGoal}". Do NOT perform actions for pending sub-goals — they will be handled separately after you call "done".`;
        enrichedGoal += `\n- Once YOUR sub-goal is achieved, call "done" IMMEDIATELY. Do NOT continue to the next step.`;
      }
    }

    // Track the actual goal being executed so reconciliation uses the rewritten goal, not the original
    subGoal.executedAs = effectiveGoal;

    // ── App-ID propagation (Fix B) ────────────────────
    // If we still don't know the target app, try to extract it from the
    // current sub-goal text. The planner often produces a sub-goal like
    // "Launch the YouTube app" even when the user's original goal didn't
    // contain "open|launch|start". Resolving here means every subsequent
    // sub-goal can stamp recorder entries with a real appId.
    if (!journeyAppId) {
      const { extractAppIdFromText } = await import('@appclaw/core/memory/fingerprint');
      journeyAppId =
        extractAppIdFromText(effectiveGoal) ||
        (() => {
          const m = effectiveGoal.match(
            /(?:open|launch|start|use|in)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+app|\s+and\b|$)/i
          );
          return m ? (appResolver.resolve(m[1].trim()) ?? undefined) : undefined;
        })();
    }

    emitJson({
      event: 'goal_start',
      data: {
        goal: effectiveGoal,
        subGoalIndex: subGoalIdx,
        totalSubGoals: executor.all.length,
      },
    });

    const result = await runAgent({
      goal: enrichedGoal,
      displayGoal: effectiveGoal,
      mcp,
      llm,
      appResolver,
      appId: journeyAppId,
      maxSteps: stepsPerGoal,
      stepDelay: config.STEP_DELAY,
      maxElements: config.MAX_ELEMENTS,
      visionMode: config.VISION_MODE,
      recorder,
      modelName,
      signal,
      onStep: (event) => {
        logger?.logStep({
          step: event.step,
          action: event.decision.toolName,
          decision: event.decision,
          result: event.result.message,
          screenHash: '',
        });
        emitJson({
          event: 'step',
          data: {
            step: event.step,
            action: event.decision.toolName,
            target: event.decision.args?.element as string | undefined,
            args: event.decision.args,
            success: event.result.success,
            message: event.result.message,
          },
        });
        // Stream device screenshot after each step
        if (event.screenshot) {
          emitJson({
            event: 'screen',
            data: { screenshot: event.screenshot, elementCount: event.elementsCount },
          });
        }
      },
      // Screen evaluator: checks for unexpected states mid-execution
      screenEvaluator: planResult.isComplex
        ? (dom, currentGoal, _step) =>
            evaluateScreen(plannerModel, currentGoal, dom, thinkingOptions)
        : undefined,
    });

    totalSteps += result.stepsUsed;
    allHistory.push(...result.history);
    {
      // Trim each sub-goal's history to its successful final attempt before
      // appending to the export history. Must happen per-sub-goal: a flat
      // concatenation would misidentify each sub-goal's accepted `done` as a
      // "non-last rejected done" and drop everything before it.
      const { keepOnlyFinalAttempt } = await import('@appclaw/core/sdk/goal-export');
      exportHistory.push(...keepOnlyFinalAttempt(result.history));
    }
    if (result.totalTokens) {
      journeyInputTokens += result.totalTokens.input;
      journeyOutputTokens += result.totalTokens.output;
      journeyCost += result.totalTokens.cost;
    }

    // After each sub-goal, harvest the appId from any launch_app call or
    // from a com.X.Y pattern in step results / final reason. This lets the
    // very first sub-goal ("Launch the YouTube app") establish the app for
    // every sub-goal that follows.
    if (!journeyAppId) {
      const { extractAppIdFromText } = await import('@appclaw/core/memory/fingerprint');
      for (const step of result.history) {
        const launchAppId = step.decision?.args?.appId;
        if (
          step.decision?.toolName === 'launch_app' &&
          typeof launchAppId === 'string' &&
          launchAppId
        ) {
          journeyAppId = launchAppId;
          break;
        }
        const fromResult = extractAppIdFromText(step.result ?? '');
        if (fromResult) {
          journeyAppId = fromResult;
          break;
        }
      }
      if (!journeyAppId) {
        journeyAppId = extractAppIdFromText(result.reason ?? '') ?? journeyAppId;
      }
    }

    emitJson({
      event: 'goal_done',
      data: {
        goal: effectiveGoal,
        success: result.success,
        reason: result.reason,
        stepsUsed: result.stepsUsed,
      },
    });

    if (result.success) {
      executor.markCompleted(result.reason);
    } else {
      executor.markFailed(result.reason);
      // Stop on failure for dependent sub-goals
      const nextGoal = executor.current;
      if (nextGoal?.dependsOn === subGoalIdx) {
        ui.printError('Dependent sub-goal cannot proceed', `Sub-goal ${subGoalIdx + 1} failed`);
        break;
      }
    }
    subGoalIdx++;
  }

  const success = !stopped && executor.all.every((sg) => sg.status === 'completed');
  const subGoals = executor.all.map((sg) => ({
    goal: sg.goal,
    status: sg.status,
    result: sg.result,
  }));
  const outcome: GoalSessionOutcome = {
    success,
    reason: success
      ? 'All sub-goals completed'
      : stopped
        ? 'Stopped before finishing'
        : 'Some sub-goals failed',
    totalSteps,
    durationMs: Date.now() - journeyStart,
    tokens: {
      input: journeyInputTokens,
      output: journeyOutputTokens,
      cost: journeyCost,
      model: modelName,
    },
    subGoals,
    history: allHistory,
    exportHistory,
  };

  // ── Final journey summary ──
  // Rendered here, not by the caller, because the one-shot CLI unmounts Ink as
  // soon as this returns and the summary has to land inside that frame.
  ui.printJourneySummary({
    success,
    overallGoal: goal,
    subGoals,
    totalSteps,
    durationMs: outcome.durationMs,
    tokens: outcome.tokens,
  });

  return outcome;
}
