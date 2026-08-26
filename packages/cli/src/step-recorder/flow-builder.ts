/**
 * Flow-building helpers shared by every step-recording surface.
 *
 * Both recording surfaces — the TUI (`appclaw --tui`) and the headless JSON
 * bridge (`appclaw --json --playground`) — accumulate the same `FlowStep[]` and
 * must produce identical YAML / runner-spec output, so these take
 * `(steps, meta)` explicitly instead of reaching into any surface's state.
 * One implementation, two callers, no drift.
 */

import path from 'node:path';
import { stringify } from 'yaml';

import { loadConfig } from '@appclaw/core/config';
import { generateSdkTestFromInstructions } from '@appclaw/core/sdk/goal-export';
import { stepAction, stepTarget } from '@appclaw/core/ui/step-printer';
import type { FlowStep, FlowMeta } from '@appclaw/core/flow/types';

/** Convert step to YAML — preserve the user's original natural language input. */
export function stepToYaml(step: FlowStep): unknown {
  // Recorded steps always have verbatim (the exact text the user typed).
  // Use it directly so the YAML reads like the user's instructions.
  if (step.verbatim) return step.verbatim;

  // Fallback for steps without verbatim (shouldn't happen when recording)
  switch (step.kind) {
    case 'launchApp':
      return 'launchApp';
    case 'openApp':
      return `open ${step.query} app`;
    case 'tap':
      return `tap ${step.label}`;
    case 'doubleTap':
      return `double tap ${step.label}`;
    case 'longPress':
      return step.duration != null
        ? `long press ${step.label} for ${step.duration}ms`
        : `long press ${step.label}`;
    case 'type':
      return `type "${step.text}"`;
    case 'swipe':
      return `swipe ${step.direction}`;
    case 'zoom':
      return step.target
        ? `zoom ${step.scale >= 1 ? 'in' : 'out'} ${step.scale}x on ${step.target}`
        : `zoom ${step.scale >= 1 ? 'in' : 'out'} ${step.scale}x`;
    case 'wait':
      return `wait ${step.seconds} s`;
    case 'waitUntil':
      if (step.condition === 'screenLoaded') return 'wait until screen is loaded';
      if (step.condition === 'gone') return `wait until "${step.text}" is gone`;
      return `wait until "${step.text}" is visible`;
    case 'enter':
      return 'press enter';
    case 'back':
      return 'go back';
    case 'home':
      return 'go home';
    case 'assert':
      return `assert "${step.text}" is visible`;
    case 'scrollAssert':
      return `scroll ${step.direction} until "${step.text}" is visible`;
    case 'getInfo':
      return `getInfo: ${step.query}`;
    case 'done':
      return step.message ? `done: ${step.message}` : 'done';
  }
}

export function buildYamlString(steps: FlowStep[], meta: FlowMeta): string {
  const parts: string[] = [];

  if (meta.appId || meta.name || meta.platform) {
    const metaObj: Record<string, string> = {};
    if (meta.appId) metaObj.appId = meta.appId;
    if (meta.name) metaObj.name = meta.name;
    if (meta.platform) metaObj.platform = meta.platform;
    parts.push(stringify(metaObj).trim());
    parts.push('---');
  }

  const yamlSteps = steps.map(stepToYaml);

  // Auto-append "done" if the last step isn't already a done step
  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.kind !== 'done') {
    yamlSteps.push('done');
  }

  parts.push(stringify({ steps: yamlSteps }).trim());

  return parts.join('\n') + '\n';
}

/**
 * Whether the given filename should be exported as an @appclaw/runner spec
 * format rather than the default YAML flow format.
 */
export function isSdkTestFilename(name: string): boolean {
  return /\.(?:test|spec)\.(?:m|c)?[jt]sx?$/i.test(name) || /\.(?:m|c)?ts$/i.test(name);
}

/**
 * Resolve the final on-disk path for an `/export` write — same rules as the
 * CLI's `--export`. Bare filenames land in the configured directory (EXPORT_DIR);
 * paths with a directory hint (./tests/foo.test.ts, /abs/...) are used verbatim.
 *
 * The configured directory differs by format: SDK tests go to EXPORT_DIR, YAML
 * flows stay in cwd.
 *
 * `exportDir` is the `--export-dir` override; nullish falls back to EXPORT_DIR.
 */
export function resolveRecordedExportPath(
  filename: string,
  asSdkTest: boolean,
  exportDir?: string | null
): string {
  if (path.isAbsolute(filename)) return filename;
  if (filename.includes('/') || filename.includes(path.sep)) {
    return path.resolve(process.cwd(), filename);
  }
  if (asSdkTest) {
    const dir = exportDir ?? loadConfig().EXPORT_DIR;
    return path.resolve(process.cwd(), dir, filename);
  }
  return path.resolve(process.cwd(), filename);
}

/**
 * Build the @appclaw/runner spec body for a recorded step list.
 * Each step's `verbatim` (the user's original natural-language text) becomes
 * one `await app.run(...)` call — no translation needed because the recording
 * surfaces accept the same syntax that `AppClaw.run()` does.
 */
export function buildSdkTestString(steps: FlowStep[], meta: FlowMeta): string {
  const instructions = steps
    .map((s) => s.verbatim?.trim())
    .filter((v): v is string => !!v && v.length > 0);
  return generateSdkTestFromInstructions({
    instructions,
    config: {
      describeName: meta.name || 'Recorded flow',
      ...(meta.platform === 'ios' || meta.platform === 'android'
        ? { platform: meta.platform }
        : {}),
    },
  });
}

/**
 * Compact one-line-per-step rendering, for surfaces that can't draw a table
 * (the TUI logs these into its in-frame transcript).
 */
export function formatStepLines(steps: FlowStep[]): string[] {
  return steps.map(
    (s, i) => `${String(i + 1).padStart(2)}. ${stepAction(s).padEnd(8)}${stepTarget(s)}`
  );
}
