/**
 * Writing a finished goal run out as a replayable `@appclaw/runner` spec —
 * the `--export` half of goal mode.
 *
 * Separate from `goal-session.ts` because the run and the artifact have
 * different lifetimes: the one-shot CLI writes as soon as the agent returns,
 * while Terminal Studio holds the outcome until the shell exits. Both need the
 * same path rules, and those rules are documented in the CLI's `--export` help,
 * so they live in exactly one place.
 */

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateSdkTest } from '@appclaw/core/sdk/goal-export';
import type { GoalSessionOutcome } from './goal-session.js';

/** Build a filesystem-safe slug from a goal string for default export paths. */
export function slugForExport(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'goal-replay';
}

/**
 * Resolve the final on-disk path for a `--export` write.
 *
 * Rules (in order of precedence):
 * - Empty `cliPath` → `<dir>/<slug>.test.ts` (slug derived from the goal).
 * - `cliPath` is absolute or contains a directory separator → use verbatim.
 *   This lets users override the configured dir with `--export ./tests/foo.test.ts`.
 * - `cliPath` is a bare filename (no separators) → `<dir>/<cliPath>`.
 */
export function resolveExportPath(cliPath: string, dir: string, goal: string): string {
  if (!cliPath) return path.join(dir, `${slugForExport(goal)}.test.ts`);
  if (path.isAbsolute(cliPath) || cliPath.includes(path.sep) || cliPath.includes('/')) {
    return cliPath;
  }
  return path.join(dir, cliPath);
}

export interface WriteGoalExportOptions {
  goal: string;
  outcome: GoalSessionOutcome;
  /** The raw `--export` value: '' means "pick a path from the goal". */
  cliPath: string;
  /** `--export-dir`, or the configured EXPORT_DIR. */
  dir: string;
  provider: string;
  platform: 'android' | 'ios';
  agentMode: string;
}

/** Render and write the spec. Returns the path written. */
export async function writeGoalExport(opts: WriteGoalExportOptions): Promise<string> {
  const target = resolveExportPath(opts.cliPath, opts.dir, opts.goal);
  const source = generateSdkTest({
    goal: opts.goal,
    result: {
      success: opts.outcome.success,
      reason: opts.outcome.reason,
      stepsUsed: opts.outcome.totalSteps,
      // exportHistory, not history — this is the per-sub-goal trimmed
      // trajectory, so the spec replays the successful path rather than the
      // recovery dance the agent did when verification rejected an early `done`.
      history: opts.outcome.exportHistory,
    },
    config: {
      provider: opts.provider,
      platform: opts.platform,
      agentMode: opts.agentMode,
    },
  });
  await mkdir(path.dirname(path.resolve(target)), { recursive: true });
  await writeFile(target, source, 'utf8');
  return target;
}
