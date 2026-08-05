import type { UIElement } from '../perception/types.js';
import type {
  ElementPropertyExpectations,
  ElementSelector,
  MatchedElementSnapshot,
  NumericExpectation,
  NumericMatcher,
  SelectorDiagnostics,
  SelectorReference,
  StringMatcher,
  StringSelector,
} from './types.js';

const STRING_FIELDS = ['text', 'id', 'accessibilityId', 'type', 'hint', 'value'] as const;
const BOOLEAN_FIELDS = [
  'enabled',
  'checked',
  'focused',
  'selected',
  'editable',
  'clickable',
  'scrollable',
  'longClickable',
] as const;
const RELATION_FIELDS = [
  'above',
  'below',
  'leftOf',
  'rightOf',
  'near',
  'within',
  'childOf',
  'descendantOf',
] as const;

const SELECTOR_KEYS = new Set<string>([
  ...STRING_FIELDS,
  ...BOOLEAN_FIELDS,
  ...RELATION_FIELDS,
  'index',
]);
const PROPERTY_KEYS = new Set<string>([
  'exists',
  'visible',
  'text',
  'value',
  'type',
  ...BOOLEAN_FIELDS,
  'width',
  'height',
  'x',
  'y',
]);

function objectValue(raw: unknown, context: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${context} must be a YAML object`);
  }
  return raw as Record<string, unknown>;
}

function parseStringSelector(raw: unknown, context: string): StringSelector {
  if (typeof raw === 'string') return raw;
  const obj = objectValue(raw, context);
  const unknown = Object.keys(obj).filter(
    (key) => !['value', 'match', 'caseSensitive'].includes(key)
  );
  if (unknown.length) throw new Error(`${context}: unknown key(s): ${unknown.join(', ')}`);
  if (typeof obj.value !== 'string') throw new Error(`${context}.value must be a string`);
  const match = obj.match ?? 'exact';
  if (!['exact', 'contains', 'regex'].includes(String(match))) {
    throw new Error(`${context}.match must be exact, contains, or regex`);
  }
  if (obj.caseSensitive != null && typeof obj.caseSensitive !== 'boolean') {
    throw new Error(`${context}.caseSensitive must be true or false`);
  }
  if (match === 'regex') {
    try {
      new RegExp(obj.value, obj.caseSensitive ? '' : 'i');
    } catch (error) {
      throw new Error(
        `${context}.value is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return {
    value: obj.value,
    match: match as StringMatcher['match'],
    ...(obj.caseSensitive != null ? { caseSensitive: obj.caseSensitive } : {}),
  };
}

export function parseNumericExpectation(raw: unknown, context: string): NumericExpectation {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const obj = objectValue(raw, context);
  const allowed = new Set(['equals', 'gte', 'lte', 'min', 'max', 'tolerance']);
  const unknown = Object.keys(obj).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${context}: unknown key(s): ${unknown.join(', ')}`);
  const parsed: NumericMatcher = {};
  for (const key of allowed) {
    const value = obj[key];
    if (value == null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${context}.${key} must be a finite number`);
    }
    parsed[key as keyof NumericMatcher] = value;
  }
  if (Object.keys(parsed).length === 0) {
    throw new Error(`${context} needs equals, gte/lte, or min/max`);
  }
  if (
    parsed.equals == null &&
    parsed.gte == null &&
    parsed.lte == null &&
    parsed.min == null &&
    parsed.max == null
  ) {
    throw new Error(`${context}.tolerance requires equals`);
  }
  if (parsed.gte != null && parsed.min != null) {
    throw new Error(`${context} cannot combine gte and min`);
  }
  if (parsed.lte != null && parsed.max != null) {
    throw new Error(`${context} cannot combine lte and max`);
  }
  if (parsed.tolerance != null && parsed.tolerance < 0) {
    throw new Error(`${context}.tolerance must be non-negative`);
  }
  return parsed;
}

/** Parse and strictly validate a structured selector from YAML. */
export function parseElementSelector(raw: unknown, context: string): ElementSelector {
  if (typeof raw === 'string') return { text: raw };
  const obj = objectValue(raw, context);
  const unknown = Object.keys(obj).filter((key) => !SELECTOR_KEYS.has(key));
  if (unknown.length) throw new Error(`${context}: unknown selector key(s): ${unknown.join(', ')}`);
  if (Object.keys(obj).length === 0) throw new Error(`${context} must not be empty`);

  const selector: ElementSelector = {};
  for (const key of STRING_FIELDS) {
    if (obj[key] != null) selector[key] = parseStringSelector(obj[key], `${context}.${key}`);
  }
  for (const key of BOOLEAN_FIELDS) {
    if (obj[key] == null) continue;
    if (typeof obj[key] !== 'boolean') throw new Error(`${context}.${key} must be true or false`);
    selector[key] = obj[key] as never;
  }
  if (obj.index != null) {
    if (!Number.isInteger(obj.index) || Number(obj.index) < 0) {
      throw new Error(`${context}.index must be a non-negative integer`);
    }
    selector.index = Number(obj.index);
  }
  for (const key of RELATION_FIELDS) {
    if (obj[key] == null) continue;
    selector[key] =
      typeof obj[key] === 'string'
        ? String(obj[key])
        : parseElementSelector(obj[key], `${context}.${key}`);
  }
  return selector;
}

/** Parse properties used by a structured assert step. */
export function parsePropertyExpectations(
  raw: unknown,
  context: string
): ElementPropertyExpectations {
  const obj = objectValue(raw, context);
  const unknown = Object.keys(obj).filter((key) => !PROPERTY_KEYS.has(key));
  if (unknown.length) throw new Error(`${context}: unknown property key(s): ${unknown.join(', ')}`);
  const result: ElementPropertyExpectations = {};
  for (const key of ['exists', 'visible', ...BOOLEAN_FIELDS] as const) {
    if (obj[key] == null) continue;
    if (typeof obj[key] !== 'boolean') throw new Error(`${context}.${key} must be true or false`);
    result[key] = obj[key] as never;
  }
  for (const key of ['text', 'value', 'type'] as const) {
    if (obj[key] != null) result[key] = parseStringSelector(obj[key], `${context}.${key}`);
  }
  for (const key of ['width', 'height', 'x', 'y'] as const) {
    if (obj[key] != null) result[key] = parseNumericExpectation(obj[key], `${context}.${key}`);
  }
  if (Object.keys(result).length === 0) throw new Error(`${context} must not be empty`);
  if (result.exists === false && Object.keys(result).some((key) => key !== 'exists')) {
    throw new Error(`${context}.exists=false cannot be combined with other property expectations`);
  }
  return result;
}

export function isStructuredSelectorObject(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function matcherParts(expected: StringSelector): Required<StringMatcher> {
  if (typeof expected === 'string') {
    return { value: expected, match: 'exact', caseSensitive: false };
  }
  return {
    value: expected.value,
    match: expected.match ?? 'exact',
    caseSensitive: expected.caseSensitive ?? false,
  };
}

export function matchesString(actual: string | undefined, expected: StringSelector): boolean {
  if (actual == null) return false;
  const matcher = matcherParts(expected);
  const lhs = matcher.caseSensitive ? actual : actual.toLowerCase();
  const rhs = matcher.caseSensitive ? matcher.value : matcher.value.toLowerCase();
  if (matcher.match === 'exact') return lhs === rhs;
  if (matcher.match === 'contains') return lhs.includes(rhs);
  return new RegExp(matcher.value, matcher.caseSensitive ? '' : 'i').test(actual);
}

export function matchesNumber(actual: number, expected: NumericExpectation): boolean {
  if (typeof expected === 'number') return actual === expected;
  const tolerance = expected.tolerance ?? 0;
  if (expected.equals != null && Math.abs(actual - expected.equals) > tolerance) return false;
  const lower = expected.gte ?? expected.min;
  const upper = expected.lte ?? expected.max;
  if (lower != null && actual < lower) return false;
  if (upper != null && actual > upper) return false;
  return true;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectOf(el: UIElement): Rect {
  const [x, y] = el.center;
  const [width, height] = el.size;
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function bboxDistance(a: Rect, b: Rect): number {
  return (
    Math.abs(a.left - b.left) +
    Math.abs(a.right - b.right) +
    Math.abs(a.top - b.top) +
    Math.abs(a.bottom - b.bottom)
  );
}

function referenceSelector(reference: SelectorReference): ElementSelector {
  return typeof reference === 'string' ? { text: reference } : reference;
}

function baseMatches(el: UIElement, selector: ElementSelector): boolean {
  for (const key of STRING_FIELDS) {
    const expected = selector[key];
    if (expected != null && !matchesString(el[key], expected)) return false;
  }
  for (const key of BOOLEAN_FIELDS) {
    const expected = selector[key];
    if (expected == null) continue;
    const actual = el[key];
    // An unavailable state must not be confused with an explicit false.
    if (actual == null || actual !== expected) return false;
  }
  return true;
}

function sortByAnchorDistance(candidates: UIElement[], anchors: UIElement[]): UIElement[] {
  return [...candidates].sort((a, b) => {
    const ar = rectOf(a);
    const br = rectOf(b);
    const ad = Math.min(...anchors.map((anchor) => bboxDistance(ar, rectOf(anchor))));
    const bd = Math.min(...anchors.map((anchor) => bboxDistance(br, rectOf(anchor))));
    return ad - bd;
  });
}

function geometricMatch(
  candidate: UIElement,
  anchor: UIElement,
  relation: string,
  tol = 0
): boolean {
  if (candidate === anchor) return false;
  const c = rectOf(candidate);
  const a = rectOf(anchor);
  if (candidate.treeId && candidate.treeId === anchor.treeId) return false;
  switch (relation) {
    case 'above':
      return c.bottom <= a.top;
    case 'below':
      return c.top >= a.bottom;
    case 'leftOf':
      return c.right <= a.left;
    case 'rightOf':
      return c.left >= a.right;
    case 'within':
      return c.left >= a.left && c.right <= a.right && c.top >= a.top && c.bottom <= a.bottom;
    case 'near':
      return (
        c.left <= a.right + tol &&
        c.right >= a.left - tol &&
        c.top <= a.bottom + tol &&
        c.bottom >= a.top - tol
      );
    default:
      return false;
  }
}

function applyRelation(
  elements: UIElement[],
  candidates: UIElement[],
  relation: (typeof RELATION_FIELDS)[number],
  reference: SelectorReference,
  depth: number
): UIElement[] {
  const anchorResolution = resolveElementSelector(
    elements,
    referenceSelector(reference),
    depth + 1
  );
  const anchors = anchorResolution.matches;
  if (anchors.length === 0) return [];

  if (relation === 'childOf') {
    const ids = new Set(anchors.map((anchor) => anchor.treeId).filter(Boolean));
    return candidates.filter(
      (candidate) => !!candidate.parentTreeId && ids.has(candidate.parentTreeId)
    );
  }
  if (relation === 'descendantOf') {
    const ids = new Set(anchors.map((anchor) => anchor.treeId).filter(Boolean));
    return candidates.filter((candidate) =>
      (candidate.ancestorTreeIds ?? []).some((id) => ids.has(id))
    );
  }

  if (relation === 'near') {
    let scale = 1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const hits = candidates.filter((candidate) =>
        anchors.some((anchor) => {
          const [width, height] = anchor.size;
          return geometricMatch(candidate, anchor, relation, Math.max(width, height, 1) * scale);
        })
      );
      if (hits.length > 0) return sortByAnchorDistance(hits, anchors);
      scale *= 1.6;
    }
    return [];
  }

  const hits = candidates.filter((candidate) =>
    anchors.some((anchor) => geometricMatch(candidate, anchor, relation))
  );
  return sortByAnchorDistance(hits, anchors);
}

export interface SelectorResolution {
  /** Matches before applying index. Useful for ambiguity/count diagnostics. */
  allMatches: UIElement[];
  /** Final matches after applying index. */
  matches: UIElement[];
  indexOutOfRange: boolean;
}

/** Resolve a structured selector without using vision or fuzzy label scoring. */
export function resolveElementSelector(
  elements: UIElement[],
  selector: ElementSelector,
  depth = 0
): SelectorResolution {
  if (depth > 12) throw new Error('Structured selector relation nesting exceeds 12 levels');
  let candidates = elements.filter((element) => baseMatches(element, selector));
  for (const relation of RELATION_FIELDS) {
    const reference = selector[relation];
    if (reference != null) {
      candidates = applyRelation(elements, candidates, relation, reference, depth);
    }
  }
  if (selector.index == null) {
    return { allMatches: candidates, matches: candidates, indexOutOfRange: false };
  }
  const selected = candidates[selector.index];
  return {
    allMatches: candidates,
    matches: selected ? [selected] : [],
    indexOutOfRange: !selected,
  };
}

function printableStringSelector(value: StringSelector): string {
  if (typeof value === 'string') return JSON.stringify(value);
  const suffix = value.match && value.match !== 'exact' ? `/${value.match}` : '';
  return `${JSON.stringify(value.value)}${suffix}`;
}

/** Compact, stable description for terminal output and report step labels. */
export function describeElementSelector(selector: ElementSelector): string {
  const parts: string[] = [];
  for (const key of STRING_FIELDS) {
    if (selector[key] != null) parts.push(`${key}=${printableStringSelector(selector[key]!)}`);
  }
  for (const key of BOOLEAN_FIELDS) {
    if (selector[key] != null) parts.push(`${key}=${selector[key]}`);
  }
  if (selector.index != null) parts.push(`index=${selector.index}`);
  for (const key of RELATION_FIELDS) {
    const value = selector[key];
    if (value == null) continue;
    parts.push(
      `${key}=(${typeof value === 'string' ? `text=${JSON.stringify(value)}` : describeElementSelector(value)})`
    );
  }
  return parts.join(', ');
}

export function snapshotElement(element: UIElement): MatchedElementSnapshot {
  return {
    text: element.text,
    id: element.id,
    accessibilityId: element.accessibilityId,
    type: element.type,
    ...(element.value != null ? { value: element.password ? '***' : element.value } : {}),
    bounds: element.bounds,
    center: element.center,
    size: element.size,
    enabled: element.enabled,
    ...(element.checked != null ? { checked: element.checked } : {}),
    ...(element.focused != null ? { focused: element.focused } : {}),
    ...(element.selected != null ? { selected: element.selected } : {}),
    editable: element.editable,
    clickable: element.clickable,
    ...(element.visible != null ? { visible: element.visible } : {}),
  };
}

function expectedLabel(expected: unknown): string {
  return typeof expected === 'string' ? JSON.stringify(expected) : JSON.stringify(expected);
}

function actualFor(element: UIElement, key: keyof ElementPropertyExpectations): unknown {
  switch (key) {
    case 'width':
      return element.size[0];
    case 'height':
      return element.size[1];
    case 'x':
      return element.center[0];
    case 'y':
      return element.center[1];
    default:
      return element[key as keyof UIElement];
  }
}

function elementIdentity(element: UIElement, index: number): string {
  const name = element.id || element.accessibilityId || element.text || element.type || 'element';
  return `match #${index + 1} (${JSON.stringify(name)})`;
}

function redactDiagnosticsSelector(
  selector: ElementSelector,
  elements: UIElement[]
): ElementSelector {
  if (!elements.some((element) => element.password) || selector.value == null) return selector;
  return { ...selector, value: '***' };
}

function redactExpectedProperties(
  properties: ElementPropertyExpectations | undefined,
  elements: UIElement[]
): ElementPropertyExpectations | undefined {
  if (!properties || !elements.some((element) => element.password) || properties.value == null) {
    return properties;
  }
  return { ...properties, value: '***' };
}

export interface StructuredAssertionResult {
  success: boolean;
  message: string;
  diagnostics: SelectorDiagnostics;
}

/** Evaluate count and property expectations against a selector resolution. */
export function evaluateStructuredAssertion(
  elements: UIElement[],
  selector: ElementSelector,
  properties?: ElementPropertyExpectations,
  count?: NumericExpectation
): StructuredAssertionResult {
  const resolution = resolveElementSelector(elements, selector);
  const matches = resolution.matches;
  const failures: string[] = [];
  const effectiveProperties = properties ?? (count == null ? { visible: true } : undefined);

  if (count != null && !matchesNumber(matches.length, count)) {
    failures.push(`count expected ${expectedLabel(count)}, actual ${matches.length}`);
  }

  const expectsAbsent =
    effectiveProperties?.exists === false || effectiveProperties?.visible === false;
  if (effectiveProperties?.exists === false) {
    if (matches.length > 0)
      failures.push(`expected target not to exist, but found ${matches.length}`);
  } else if (effectiveProperties?.visible === false && matches.length === 0) {
    // Absence satisfies not-visible.
  } else if (effectiveProperties && matches.length === 0) {
    failures.push(
      resolution.indexOutOfRange
        ? `selector index ${selector.index} is out of range (${resolution.allMatches.length} candidate(s))`
        : 'target did not match any element'
    );
  }

  if (effectiveProperties && matches.length > 0 && !expectsAbsent) {
    for (let index = 0; index < matches.length; index++) {
      const element = matches[index];
      for (const [rawKey, expected] of Object.entries(effectiveProperties)) {
        const key = rawKey as keyof ElementPropertyExpectations;
        if (key === 'exists') continue;
        const actual = actualFor(element, key);
        let satisfied: boolean;
        if (key === 'visible') {
          satisfied = (actual !== false) === expected;
        } else if (['text', 'value', 'type'].includes(key)) {
          satisfied = matchesString(actual as string | undefined, expected as StringSelector);
        } else if (['width', 'height', 'x', 'y'].includes(key)) {
          satisfied = matchesNumber(actual as number, expected as NumericExpectation);
        } else {
          satisfied = actual != null && actual === expected;
        }
        if (!satisfied) {
          const shownActual =
            element.password && key === 'value' && actual != null ? '***' : actual;
          const unavailable = actual == null ? 'unavailable' : JSON.stringify(shownActual);
          failures.push(
            `${elementIdentity(element, index)}.${key} expected ${expectedLabel(
              element.password && key === 'value' ? '***' : expected
            )}, actual ${unavailable}`
          );
        }
      }
    }
  } else if (effectiveProperties?.visible === false && matches.length > 0) {
    const visible = matches.filter((element) => element.visible !== false);
    if (visible.length > 0)
      failures.push(
        `expected target not to be visible, but ${visible.length} visible match(es) remain`
      );
  }

  const diagnostics: SelectorDiagnostics = {
    selector: redactDiagnosticsSelector(selector, matches),
    matchedCount: matches.length,
    matched: matches.map(snapshotElement),
    ...(effectiveProperties
      ? { expectedProperties: redactExpectedProperties(effectiveProperties, matches) }
      : {}),
    ...(count != null ? { expectedCount: count } : {}),
    ...(failures.length ? { failures } : {}),
  };
  const selectorText = describeElementSelector(diagnostics.selector);
  return {
    success: failures.length === 0,
    message:
      failures.length === 0
        ? `Structured assertion passed: ${selectorText} (${matches.length} match${matches.length === 1 ? '' : 'es'})`
        : `Structured assertion failed: ${selectorText} — ${failures.join('; ')}`,
    diagnostics,
  };
}
