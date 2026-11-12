/**
 * Locator-based actions — Appium strategy/selector taps, types, and asserts
 * without going through natural-language parsing.
 *
 * Mirrors the AngelOne AppClaw SDK helpers (`tapByLocator`, `typeByLocator`, …):
 * try English first (optional), then hard-coded id / a11y / xpath / UiAutomator /
 * iOS predicate / class chain.
 *
 * Pure MCP helpers live here; `AppClaw` owns session connect, reporting, and
 * failOnError / soft semantics.
 */

import { extractText, findElement, isMCPError } from '../mcp/tools.js';
import type { LocatorStrategy, MCPClient } from '../mcp/types.js';
import type { RunResult } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Result of a locator (or NL→locator) action. */
export interface LocatorActionResult extends RunResult {
  /** Which path succeeded (or was last attempted). */
  via?: 'nl' | 'locator';
  /** Populated by getText / assertText locator helpers. */
  text?: string;
}

/** Shared Appium locator fields accepted by tap/type/getText/assert. */
export interface LocatorSpec {
  /** Resource id or accessibility id (tried as id and/or accessibility id). */
  id?: string | string[];
  accessibilityIds?: string[];
  labels?: string[];
  /** Raw Appium xpath(s), e.g. `//*[@text="Holdings"]` (Android; skipped on iOS). */
  xpath?: string | string[];
  /** Native Appium strategy + selector (any LocatorStrategy). */
  strategy?: LocatorStrategy;
  selector?: string;
  /** Shorthand → strategy `-android uiautomator` */
  uiautomator?: string;
  /** Shorthand → strategy `-ios predicate string` */
  iosPredicate?: string;
  /** Shorthand → strategy `-ios class chain` */
  iosClassChain?: string;
}

export interface LocatorActionOptions extends LocatorSpec {
  /**
   * Human-readable label for logs + HTML report
   * (e.g. `"Search"` → step `"tap Search"`).
   */
  name?: string;
  /** NL instruction when `skipNl` is false; also used as step label if set. */
  nl?: string;
  /**
   * Skip AppClaw English — run locator only.
   * On iOS, locator is preferred first even when false (page-source NL is costly).
   */
  skipNl?: boolean;
  /**
   * Soft failure: return `{ success: false }` instead of throwing, and do not
   * mark the overall HTML report as failed.
   */
  soft?: boolean;
  /** Implicit wait (ms) for this command's target element. */
  waitTimeout?: number;
  /** Poll cadence (ms) for this command's implicit wait. */
  waitInterval?: number;
}

export interface TypeByLocatorOptions extends LocatorActionOptions {
  text: string;
}

export interface AssertTextByLocatorOptions extends LocatorActionOptions {
  /** Expected text (or regex source when match is `matches`). */
  expected?: string;
  /** Default `equals`. Use `contains` / `matches` for looser checks. */
  match?: 'equals' | 'contains' | 'matches';
}

/** Escape a string for use inside an iOS NSPredicate double-quoted literal. */
export function escapeIosPredicateValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Fast label match on iOS — prefer over xpath (xpath walks the full tree). */
export function iosLabelPredicate(label: string): string {
  const v = escapeIosPredicateValue(label);
  return `label == "${v}" OR name == "${v}" OR value == "${v}"`;
}

/** Resolve native strategy/selector from shorthand or explicit fields. */
export function resolveNativeLocator(
  opts: Pick<
    LocatorSpec,
    'strategy' | 'selector' | 'uiautomator' | 'iosPredicate' | 'iosClassChain'
  >
): { strategy: LocatorStrategy; selector: string } | null {
  if (opts.strategy && opts.selector) {
    return { strategy: opts.strategy, selector: opts.selector };
  }
  if (opts.uiautomator) {
    return { strategy: '-android uiautomator', selector: opts.uiautomator };
  }
  if (opts.iosPredicate) {
    return { strategy: '-ios predicate string', selector: opts.iosPredicate };
  }
  if (opts.iosClassChain) {
    return { strategy: '-ios class chain', selector: opts.iosClassChain };
  }
  return null;
}

export function hasClassicLocator(opts: LocatorSpec): boolean {
  const ids = normalizeIds(opts.id);
  return Boolean(
    ids.length ||
    opts.labels?.length ||
    opts.accessibilityIds?.length ||
    (typeof opts.xpath === 'string' ? opts.xpath : opts.xpath?.length)
  );
}

function normalizeIds(id?: string | string[]): string[] {
  if (!id) return [];
  return Array.isArray(id) ? id.filter(Boolean) : id ? [id] : [];
}

function normalizeXpaths(xpath?: string | string[]): string[] {
  if (!xpath) return [];
  return Array.isArray(xpath) ? xpath.filter(Boolean) : xpath ? [xpath] : [];
}

/** Build readable tap instruction from name / nl / locator fields. */
export function resolveTapInstruction(opts: LocatorActionOptions): string {
  if (opts.nl?.trim()) return opts.nl.trim();
  const name = opts.name?.trim();
  if (name) {
    return /^(tap|click|press)\b/i.test(name) ? name : `tap ${name}`;
  }
  const ids = normalizeIds(opts.id);
  return (
    opts.labels?.[0] ??
    ids[0] ??
    opts.uiautomator ??
    opts.selector ??
    opts.iosPredicate ??
    opts.iosClassChain ??
    'tap'
  );
}

/** Build readable type instruction from name / nl / locator fields. */
export function resolveTypeInstruction(opts: TypeByLocatorOptions): string {
  if (opts.nl?.trim()) return opts.nl.trim();
  const name = opts.name?.trim();
  if (name) {
    return /^type\b/i.test(name) ? name : `type '${opts.text}' into ${name}`;
  }
  const ids = normalizeIds(opts.id);
  if (ids[0]) return `type '${opts.text}' into ${ids[0]}`;
  return opts.uiautomator ?? opts.selector ?? `type '${opts.text}'`;
}

/** Build readable get-text / assert instruction. */
export function resolveTextInstruction(opts: {
  name?: string;
  nl?: string;
  expected?: string;
}): string {
  if (opts.nl?.trim()) return opts.nl.trim();
  const name = opts.name?.trim() || 'element';
  if (opts.expected !== undefined) {
    return `assert ${name} is '${opts.expected}'`;
  }
  return `get text of ${name}`;
}

export function normalizeComparable(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function textMatches(
  actual: string,
  expected: string,
  match: 'equals' | 'contains' | 'matches' = 'equals'
): boolean {
  const a = normalizeComparable(actual);
  const e = normalizeComparable(expected);
  if (match === 'contains') return a.toLowerCase().includes(e.toLowerCase());
  if (match === 'matches') {
    try {
      return new RegExp(expected, 'i').test(actual);
    } catch {
      return false;
    }
  }
  return a.toLowerCase() === e.toLowerCase();
}

/** Find element by strategy; returns UUID or null (never throws). */
export async function findByStrategy(
  mcp: MCPClient,
  strategy: LocatorStrategy,
  selector: string
): Promise<string | null> {
  try {
    return await findElement(mcp, strategy, selector);
  } catch {
    return null;
  }
}

/** Tap using any Appium LocatorStrategy. */
export async function tapByStrategy(
  mcp: MCPClient,
  strategy: LocatorStrategy,
  selector: string
): Promise<boolean> {
  const uuid = await findByStrategy(mcp, strategy, selector);
  if (!uuid) return false;
  try {
    const result = await mcp.callTool('appium_gesture', { action: 'tap', elementUUID: uuid });
    return !isMCPError(result);
  } catch {
    return false;
  }
}

/** Type into an element found by any Appium LocatorStrategy. */
export async function typeByStrategy(
  mcp: MCPClient,
  strategy: LocatorStrategy,
  selector: string,
  text: string
): Promise<boolean> {
  const uuid = await findByStrategy(mcp, strategy, selector);
  if (!uuid) return false;
  try {
    await mcp.callTool('appium_gesture', { action: 'tap', elementUUID: uuid });
    await sleep(200);
    await mcp.callTool('appium_clear_element', { elementUUID: uuid }).catch(() => undefined);
    await mcp.callTool('appium_set_value', { elementUUID: uuid, text: '' }).catch(() => undefined);
    await sleep(150);
    const set = await mcp.callTool('appium_set_value', { elementUUID: uuid, text });
    if (isMCPError(set)) return false;
    await mcp.callTool('appium_mobile_keyboard', { action: 'hide' }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Strip Appium-MCP success wrappers so asserts compare real UI text. */
function cleanMcpTextPayload(raw: string): string {
  const full = String(raw ?? '').trim();
  if (!full) return '';

  const got = full.match(
    /(?:successfully\s+)?got\s+text[:\s]+(.+?)(?:\s+from\s+element\s+[0-9a-f-]+\.?|\s*$)/is
  );
  if (got?.[1]) {
    return got[1].replace(/^["']|["']$/g, '').trim();
  }

  const attr = full.match(/^Attribute\s+"[^"]+"\s+of element[^:]*:\s*(.+)$/is);
  if (attr?.[1]) {
    const v = attr[1].trim();
    return /^null$/i.test(v) ? '' : v;
  }

  return full
    .replace(/^elementId\s+'[^']+'\s*/im, '')
    .replace(/^elementId\s+"[^"]+"\s*/im, '')
    .replace(/\s+from\s+element\s+[0-9a-f-]+\.?$/i, '')
    .replace(/^null$/i, '')
    .trim();
}

/** Read text from an element found by any Appium LocatorStrategy. */
export async function getTextByStrategy(
  mcp: MCPClient,
  strategy: LocatorStrategy,
  selector: string
): Promise<string | null> {
  const uuid = await findByStrategy(mcp, strategy, selector);
  if (!uuid) return null;
  try {
    const result = await mcp.callTool('appium_get_text', { elementUUID: uuid });
    if (isMCPError(result)) return null;
    const text = cleanMcpTextPayload(extractText(result));
    if (text && !/^failed|^error/i.test(text)) return text;

    for (const attr of ['content-desc', 'name', 'label', 'text', 'value'] as const) {
      try {
        const raw = await mcp.callTool('appium_get_element_attribute', {
          elementUUID: uuid,
          attribute: attr,
        });
        if (isMCPError(raw)) continue;
        const cleaned = cleanMcpTextPayload(extractText(raw));
        if (cleaned) return cleaned;
      } catch {
        /* next attr */
      }
    }
    return text || null;
  } catch {
    return null;
  }
}

function buildIdLabelStrategies(
  resourceId: string,
  opts: {
    platform: 'android' | 'ios';
    accessibilityIds?: string[];
    labels?: string[];
    xpaths?: string[];
  }
): Array<{ s: LocatorStrategy; v: string }> {
  const ios = opts.platform === 'ios';
  const strategies: Array<{ s: LocatorStrategy; v: string }> = [];
  if (resourceId) {
    if (resourceId.includes(':id/') || resourceId.startsWith('com.')) {
      strategies.push({ s: 'id', v: resourceId });
    } else {
      strategies.push({ s: 'accessibility id', v: resourceId });
      strategies.push({ s: 'id', v: resourceId });
      if (ios) {
        strategies.push({ s: '-ios predicate string', v: iosLabelPredicate(resourceId) });
      }
    }
  }
  for (const id of opts.accessibilityIds ?? []) {
    strategies.push({ s: 'accessibility id', v: id });
    if (ios) {
      strategies.push({ s: '-ios predicate string', v: iosLabelPredicate(id) });
    }
  }
  for (const label of opts.labels ?? []) {
    strategies.push({ s: 'accessibility id', v: label });
    if (ios) {
      strategies.push({ s: '-ios predicate string', v: iosLabelPredicate(label) });
    } else {
      strategies.push({
        s: 'xpath',
        v: `//*[@text="${label}" or @content-desc="${label}" or @name="${label}"]`,
      });
    }
  }
  // Explicit xpaths: Android only — on iOS callers must use predicate/a11y/class chain.
  if (!ios) {
    for (const xp of opts.xpaths ?? []) {
      strategies.push({ s: 'xpath', v: xp });
    }
  }
  return strategies;
}

/** Tap by resource-id / a11y / labels / xpaths (first match wins). */
export async function tapById(
  mcp: MCPClient,
  resourceId: string,
  opts: {
    platform: 'android' | 'ios';
    accessibilityIds?: string[];
    labels?: string[];
    xpaths?: string[];
  }
): Promise<boolean> {
  for (const { s, v } of buildIdLabelStrategies(resourceId, opts)) {
    if (await tapByStrategy(mcp, s, v)) return true;
  }
  return false;
}

/** Type by resource-id / a11y (first match wins). */
export async function typeById(
  mcp: MCPClient,
  resourceId: string,
  text: string,
  platform: 'android' | 'ios'
): Promise<boolean> {
  const strategies: Array<{ s: LocatorStrategy; v: string }> =
    resourceId.includes(':id/') || resourceId.startsWith('com.')
      ? [{ s: 'id', v: resourceId }]
      : [
          { s: 'accessibility id', v: resourceId },
          { s: 'id', v: resourceId },
          ...(platform === 'ios'
            ? [{ s: '-ios predicate string' as const, v: iosLabelPredicate(resourceId) }]
            : []),
        ];

  for (const { s, v } of strategies) {
    if (await typeByStrategy(mcp, s, v, text)) return true;
  }
  return false;
}

/** Read text by resource-id / a11y / labels / xpaths (first match wins). */
export async function getTextById(
  mcp: MCPClient,
  resourceId: string,
  opts: {
    platform: 'android' | 'ios';
    accessibilityIds?: string[];
    labels?: string[];
    xpaths?: string[];
  }
): Promise<string | null> {
  for (const { s, v } of buildIdLabelStrategies(resourceId, opts)) {
    const text = await getTextByStrategy(mcp, s, v);
    if (text !== null) return text;
  }
  return null;
}

/** Execute a locator tap against MCP (no NL). */
export async function executeLocatorTap(
  mcp: MCPClient,
  opts: LocatorActionOptions,
  platform: 'android' | 'ios'
): Promise<LocatorActionResult> {
  const native = resolveNativeLocator(opts);
  if (native) {
    const ok = await tapByStrategy(mcp, native.strategy, native.selector);
    if (ok) {
      return {
        success: true,
        action: 'tap',
        message: `Tapped via ${native.strategy}: ${native.selector}`,
        via: 'locator',
      };
    }
    if (!hasClassicLocator(opts)) {
      return {
        success: false,
        action: 'tap',
        message: `Native locator failed (${native.strategy}): ${native.selector}`,
        via: 'locator',
      };
    }
  }

  if (!hasClassicLocator(opts)) {
    return {
      success: false,
      action: 'tap',
      message:
        'tapByLocator requires id, labels, accessibilityIds, xpath, and/or strategy+selector (or uiautomator / iosPredicate / iosClassChain)',
      via: 'locator',
    };
  }

  const ids = normalizeIds(opts.id);
  const xpaths = normalizeXpaths(opts.xpath);
  const idList = ids.length ? ids : [''];
  for (const id of idList) {
    const ok = await tapById(mcp, id, {
      platform,
      accessibilityIds: opts.accessibilityIds,
      labels: opts.labels,
      xpaths,
    });
    if (ok) {
      return {
        success: true,
        action: 'tap',
        message: `Locator tap ok: ${resolveTapInstruction(opts)}`,
        via: 'locator',
      };
    }
  }

  return {
    success: false,
    action: 'tap',
    message: `Locator tap failed: ${resolveTapInstruction(opts)}`,
    via: 'locator',
  };
}

/** Execute a locator type against MCP (no NL). */
export async function executeLocatorType(
  mcp: MCPClient,
  opts: TypeByLocatorOptions,
  platform: 'android' | 'ios'
): Promise<LocatorActionResult> {
  const native = resolveNativeLocator(opts);
  if (native) {
    const ok = await typeByStrategy(mcp, native.strategy, native.selector, opts.text);
    if (ok) {
      return {
        success: true,
        action: 'type',
        message: `Typed via ${native.strategy}: ${native.selector}`,
        via: 'locator',
      };
    }
  }

  const ids = normalizeIds(opts.id);
  if (!ids.length && !native) {
    return {
      success: false,
      action: 'type',
      message:
        'typeByLocator requires id and/or strategy+selector (or uiautomator / iosPredicate / iosClassChain)',
      via: 'locator',
    };
  }

  for (const id of ids) {
    if (await typeById(mcp, id, opts.text, platform)) {
      return {
        success: true,
        action: 'type',
        message: `Locator type ok: ${resolveTypeInstruction(opts)}`,
        via: 'locator',
      };
    }
  }

  return {
    success: false,
    action: 'type',
    message: ids.length
      ? `Could not type into: ${ids.join(' | ')}`
      : `Native type failed (${native!.strategy}): ${native!.selector}`,
    via: 'locator',
  };
}

/** Read text via locator fields (no NL). */
export async function executeLocatorGetText(
  mcp: MCPClient,
  opts: LocatorActionOptions,
  platform: 'android' | 'ios'
): Promise<LocatorActionResult> {
  const native = resolveNativeLocator(opts);
  if (native) {
    const text = await getTextByStrategy(mcp, native.strategy, native.selector);
    if (text !== null) {
      return {
        success: true,
        action: 'gettext',
        message: `Got text via ${native.strategy}: '${text}'`,
        via: 'locator',
        text,
      };
    }
  }

  const ids = normalizeIds(opts.id);
  const xpaths = normalizeXpaths(opts.xpath);
  const idList = ids.length ? ids : hasClassicLocator(opts) ? [''] : [];

  for (const id of idList) {
    const text = await getTextById(mcp, id, {
      platform,
      accessibilityIds: opts.accessibilityIds,
      labels: opts.labels,
      xpaths,
    });
    if (text !== null) {
      const target = opts.name?.trim() ?? 'element';
      return {
        success: true,
        action: 'gettext',
        message: `Got text of ${target}: '${text}'`,
        via: 'locator',
        text,
      };
    }
  }

  return {
    success: false,
    action: 'gettext',
    message: `Could not get text for: ${resolveTextInstruction(opts)}`,
    via: 'locator',
  };
}
