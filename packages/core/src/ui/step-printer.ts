/**
 * Per-step result printer shared by the CLI's step recorders and the SDK.
 *
 * Renders a single executed step in the compact two-line form:
 *
 *   ✓ #1  tap      "search icon"
 *     ●  Tapped "search icon" at [432, 421]
 *
 * Extracted here so callers don't have to reimplement the formatting. The
 * CLI uses it for interactive step feedback; `src/sdk/step-runner.ts`
 * uses it so SDK consumers see what's happening on the device without having
 * to enable verbose logging.
 */

import chalk from 'chalk';
import { theme } from './terminal.js';
import type { FlowStep } from '../flow/types.js';
import { describeElementSelector } from '../flow/selector.js';
import { redactSensitiveValues } from '../flow/variable-resolver.js';

/** Short verb word for a step kind — fits in a fixed-width badge. */
export function stepAction(step: FlowStep): string {
  switch (step.kind) {
    case 'launchApp':
      return 'launch';
    case 'openApp':
      return 'open';
    case 'closeApp':
      return 'close';
    case 'tap':
      return 'tap';
    case 'doubleTap':
      return 'doubletap';
    case 'longPress':
      return 'longpress';
    case 'type':
      return 'type';
    case 'swipe':
      return 'swipe';
    case 'zoom':
      return 'zoom';
    case 'wait':
      return 'wait';
    case 'waitUntil':
      return 'wait';
    case 'enter':
      return 'enter';
    case 'back':
      return 'back';
    case 'home':
      return 'home';
    case 'assert':
      return 'assert';
    case 'scrollAssert':
      return 'scroll';
    case 'drag':
      return 'drag';
    case 'getInfo':
      return 'info';
    case 'done':
      return 'done';
  }
}

/** Human-readable target description for a step. */
function rawStepTarget(step: FlowStep): string {
  switch (step.kind) {
    case 'launchApp':
      return 'app';
    case 'openApp':
      return step.query;
    case 'closeApp':
      return step.query ?? 'current app';
    case 'tap':
      return `"${step.label}"`;
    case 'doubleTap':
      return `"${step.label}"`;
    case 'longPress':
      return `"${step.label}"${step.duration != null ? ` (${step.duration}ms)` : ''}`;
    case 'type':
      return `"${step.text}"${step.selector ? ` → selector(${describeElementSelector(step.selector)})` : step.target ? ` → ${step.target}` : ''}`;
    case 'swipe':
      return `${step.direction}${step.selector ? ` from selector(${describeElementSelector(step.selector)})` : ''}`;
    case 'zoom':
      return `${step.scale >= 1 ? 'in' : 'out'} (${step.scale}x)${step.selector ? ` on selector(${describeElementSelector(step.selector)})` : step.target ? ` on "${step.target}"` : ''}`;
    case 'wait':
      return `${step.seconds}s`;
    case 'waitUntil':
      if (step.condition === 'screenLoaded') return `screen loaded (${step.timeoutSeconds}s)`;
      if (step.selector)
        return `selector(${describeElementSelector(step.selector)}) ${step.condition === 'gone' ? 'gone' : 'visible'} (${step.timeoutSeconds}s)`;
      if (step.condition === 'gone') return `"${step.text}" gone (${step.timeoutSeconds}s)`;
      return `"${step.text}" visible (${step.timeoutSeconds}s)`;
    case 'enter':
      return '';
    case 'back':
      return '';
    case 'home':
      return '';
    case 'assert':
      return step.selector
        ? `selector(${describeElementSelector(step.selector)})`
        : `"${step.text ?? ''}"`;
    case 'scrollAssert':
      return `${
        step.selector
          ? `selector(${describeElementSelector(step.selector)})`
          : `"${step.text ?? ''}"`
      } ${step.direction} ×${step.maxScrolls}${step.target ? ` on "${step.target}"` : ''}`;
    case 'drag':
      return `"${step.from}" → "${step.to}"`;
    case 'getInfo':
      return `"${step.query}"`;
    case 'done':
      return step.message ?? '';
  }
}

export function stepTarget(step: FlowStep): string {
  return redactSensitiveValues(rawStepTarget(step), step.sensitiveValues);
}

/**
 * Print one step's result in the two-line compact form used by the step recorders
 * and the SDK. Goes to stdout — no spinners, no progress bars, safe for CI logs.
 */
export function printStepResult(
  stepNum: number,
  step: FlowStep,
  success: boolean,
  message: string
): void {
  const action = stepAction(step);
  const target = stepTarget(step);
  const icon = success ? theme.success('✓') : theme.error('✗');
  const actionBadge = success
    ? chalk.bgHex('#FC8EAC').white.bold(` ${action} `)
    : chalk.bgRed.white.bold(` ${action} `);
  const statusDot = success ? chalk.green('●') : chalk.red('●');

  console.log(`  ${icon} ${theme.dim(`#${stepNum}`)} ${actionBadge} ${theme.white(target)}`);
  if (message) {
    console.log(`    ${statusDot} ${success ? theme.success(message) : theme.error(message)}`);
  }
}
