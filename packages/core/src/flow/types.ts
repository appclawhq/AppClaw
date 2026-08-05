/** Optional header (first YAML document before `---`) */
export interface FlowMeta {
  appId?: string;
  /**
   * Local file path or HTTP(S) URL to the app to install for this flow (APK/IPA).
   * Passed as `appium:app` capability at session creation so Appium installs it automatically.
   * Overrides the global APP_PATH env var.
   *
   * Single string (same URL for all platforms):
   *   `app: https://example.com/MyApp.apk`
   *
   * Platform-specific URLs:
   *   ```yaml
   *   app:
   *     android: https://example.com/MyApp.apk
   *     ios: https://example.com/MyApp.zip
   *   ```
   */
  app?: string | { android?: string; ios?: string };
  name?: string;
  description?: string;
  platform?: 'android' | 'ios';
  /** Environment name — resolved from `.appclaw/env/<name>.yaml` or `--env` CLI flag */
  env?: string;
  /** Inline env block for self-contained flows */
  inlineEnv?: Record<string, unknown>;
  /**
   * Number of devices to run this flow against in parallel.
   * Requires that many devices to be available (e.g. `parallel: 2`).
   */
  parallel?: number;
}

/**
 * A test suite: a collection of YAML flow files to run together.
 *
 * Example suite.yaml:
 * ```yaml
 * name: regression_suite
 * platform: android
 * parallel: 2        # run up to 2 flows concurrently across devices
 * flows:
 *   - flows/login.yaml
 *   - flows/checkout.yaml
 *   - flows/search.yaml
 * ```
 */
export interface ParsedSuite {
  meta: FlowMeta;
  /** Resolved absolute paths to the individual flow YAML files */
  flows: string[];
}

/** Set when the step was parsed from a natural-language YAML string (shown in CLI). */
type Verbatim = {
  verbatim?: string;
  /** Internal marker: at least one resolved field originated from `${secrets.*}`. */
  sensitive?: boolean;
  /** Resolved secret values used to redact logs, labels, diagnostics, and reports. */
  sensitiveValues?: string[];
};

/** How a structured selector compares a string-valued UI attribute. */
export type StringMatchMode = 'exact' | 'contains' | 'regex';

export interface StringMatcher {
  value: string;
  /** Structured selectors default to exact matching. */
  match?: StringMatchMode;
  /** Matching is case-insensitive unless explicitly enabled. */
  caseSensitive?: boolean;
}

export type StringSelector = string | StringMatcher;

/** Numeric matcher used by count, position, and dimension assertions. */
export interface NumericMatcher {
  equals?: number;
  gte?: number;
  lte?: number;
  /** Friendly aliases for gte/lte. */
  min?: number;
  max?: number;
  /** Applied to `equals` (default 0). */
  tolerance?: number;
}

export type NumericExpectation = number | NumericMatcher;

/**
 * Cross-platform selector evaluated against the normalized accessibility tree.
 *
 * String shorthand is exact and case-insensitive. Legacy YAML string actions
 * retain their existing fuzzy matching behavior and do not use this type.
 */
export interface ElementSelector {
  text?: StringSelector;
  id?: StringSelector;
  accessibilityId?: StringSelector;
  type?: StringSelector;
  hint?: StringSelector;
  value?: StringSelector;
  /** Select one occurrence after all other filters and relations (0-based). */
  index?: number;

  enabled?: boolean;
  checked?: boolean;
  focused?: boolean;
  selected?: boolean;
  editable?: boolean;
  clickable?: boolean;
  scrollable?: boolean;
  longClickable?: boolean;

  above?: SelectorReference;
  below?: SelectorReference;
  leftOf?: SelectorReference;
  rightOf?: SelectorReference;
  near?: SelectorReference;
  within?: SelectorReference;
  childOf?: SelectorReference;
  descendantOf?: SelectorReference;
}

/** A relation anchor may use text shorthand or another structured selector. */
export type SelectorReference = string | ElementSelector;

/** Properties checked after the target element(s) have been located. */
export interface ElementPropertyExpectations {
  exists?: boolean;
  visible?: boolean;
  text?: StringSelector;
  value?: StringSelector;
  type?: StringSelector;
  enabled?: boolean;
  checked?: boolean;
  focused?: boolean;
  selected?: boolean;
  editable?: boolean;
  clickable?: boolean;
  scrollable?: boolean;
  longClickable?: boolean;
  width?: NumericExpectation;
  height?: NumericExpectation;
  x?: NumericExpectation;
  y?: NumericExpectation;
}

/** Serializable element details attached to structured-selector reports. */
export interface MatchedElementSnapshot {
  text: string;
  id: string;
  accessibilityId: string;
  type: string;
  value?: string;
  bounds: string;
  center: [number, number];
  size: [number, number];
  enabled: boolean;
  checked?: boolean;
  focused?: boolean;
  selected?: boolean;
  editable: boolean;
  clickable: boolean;
  visible?: boolean;
}

/** Structured diagnostics persisted in run manifests and rendered in reports. */
export interface SelectorDiagnostics {
  selector: ElementSelector;
  matchedCount: number;
  matched: MatchedElementSnapshot[];
  expectedProperties?: ElementPropertyExpectations;
  expectedCount?: NumericExpectation;
  failures?: string[];
}

/**
 * Spatial selectors for disambiguating which matching element to act on, modeled
 * on Taiko's proximity selectors. Applied via the `proximity` qualifier on
 * element-bearing steps (tap/type). See `rankBySpatial` in run-yaml-flow.ts.
 */
export type ProximityRelation = 'above' | 'below' | 'toLeftOf' | 'toRightOf' | 'near' | 'within';

/**
 * Optional spatial qualifier: "<target> below <anchor>", "<target> near <anchor>".
 * Both fields are set together — `relation` is the geometric relation and
 * `anchor` is the natural-language label of the reference element.
 *
 * `anchorProximity` chains a qualifier onto the ANCHOR itself, picking which
 * of several matching anchors to use: "YESBANK to the left of NSEFO which is
 * near ₹0.04" → { relation: 'toLeftOf', anchor: 'NSEFO',
 * anchorProximity: { relation: 'near', anchor: '₹0.04' } }.
 */
export type Proximity = {
  relation: ProximityRelation;
  anchor: string;
  anchorProximity?: Proximity;
};

export type FlowStep =
  | ({ kind: 'launchApp' } & Verbatim)
  | ({ kind: 'openApp'; query: string } & Verbatim)
  | ({ kind: 'closeApp'; query?: string } & Verbatim)
  | ({ kind: 'wait'; seconds: number } & Verbatim)
  | ({
      kind: 'waitUntil';
      condition: 'visible' | 'gone' | 'screenLoaded';
      text?: string;
      /** Structured targets are deterministic DOM/accessibility-tree only. */
      selector?: ElementSelector;
      timeoutSeconds: number;
    } & Verbatim)
  | ({ kind: 'tap'; label: string; selector?: ElementSelector; proximity?: Proximity } & Verbatim)
  | ({
      kind: 'doubleTap';
      label: string;
      selector?: ElementSelector;
      proximity?: Proximity;
    } & Verbatim)
  | ({ kind: 'longPress'; label: string; selector?: ElementSelector; duration?: number } & Verbatim)
  | ({
      kind: 'type';
      text: string;
      target?: string;
      selector?: ElementSelector;
      proximity?: Proximity;
    } & Verbatim)
  | ({ kind: 'enter' } & Verbatim)
  | ({ kind: 'back' } & Verbatim)
  | ({ kind: 'home' } & Verbatim)
  | ({
      kind: 'swipe';
      direction: 'up' | 'down' | 'left' | 'right';
      repeat?: number;
      /**
       * Optional label of the element to anchor the swipe on (e.g. a slider
       * thumb). When set, the gesture starts from that element's center and
       * moves in `direction`. When omitted, swipes from the screen center.
       */
      target?: string;
      selector?: ElementSelector;
    } & Verbatim)
  | ({
      kind: 'zoom';
      /** > 1 = zoom in (pinch open), < 1 = zoom out (pinch close). e.g. 2.0 = 2x zoom in, 0.5 = zoom out */
      scale: number;
      /** Optional label of the element to zoom on. If omitted, zooms on the center of the screen. */
      target?: string;
      selector?: ElementSelector;
    } & Verbatim)
  | ({
      kind: 'drag';
      from: string;
      to: string;
      /** Drag movement duration in ms. Default: 600 */
      duration?: number;
      /** Hold duration before dragging in ms. Default: 400 */
      longPressDuration?: number;
    } & Verbatim)
  | ({
      kind: 'assert';
      /** Legacy semantic/text assertion. */
      text?: string;
      /** Structured target; never silently falls back to vision. */
      selector?: ElementSelector;
      properties?: ElementPropertyExpectations;
      count?: NumericExpectation;
    } & Verbatim)
  | ({
      kind: 'scrollAssert';
      text?: string;
      selector?: ElementSelector;
      direction: 'up' | 'down' | 'left' | 'right';
      maxScrolls: number;
      /**
       * Optional anchor element: the swipe gesture starts from this element's
       * position (e.g. inside a horizontal carousel) instead of screen center.
       * Resolved once — the anchor itself may scroll away; its coordinates stay.
       */
      target?: string;
      /**
       * Spatial qualifier picking WHICH scroll area when several exist:
       * "the FII/DII below Post-Market Insights" or a pure region phrase
       * ("the area above View All") whose generic noun resolves to the
       * nearest element on that side of the qualifier's anchor.
       */
      targetProximity?: Proximity;
    } & Verbatim)
  | ({ kind: 'getInfo'; query: string } & Verbatim)
  | ({ kind: 'done'; message?: string } & Verbatim);

/**
 * Execution phase of a flow step.
 * - setup: initialization steps (app launch, login, navigation to starting screen)
 * - test: main test steps (the actions under test)
 * - assertion: verification checks (expected outcomes)
 */
export type FlowPhase = 'setup' | 'test' | 'assertion';

/** A step tagged with its execution phase. */
export interface PhasedStep {
  step: FlowStep;
  phase: FlowPhase;
}

export interface ParsedFlow {
  meta: FlowMeta;
  steps: FlowStep[];
  /**
   * When the YAML uses setup/steps/assertions sections, steps are
   * organized by phase. When using a flat step list (legacy), all
   * steps default to "test" phase.
   */
  phases: PhasedStep[];
}

/** Per-phase execution result for structured reporting. */
export interface PhaseResult {
  phase: FlowPhase;
  success: boolean;
  stepsExecuted: number;
  stepsTotal: number;
  failedAt?: number;
  reason?: string;
}

/** Resolve the app path/URL for a given platform from a FlowMeta.app value. */
export function resolveFlowApp(
  app: FlowMeta['app'],
  platform: 'android' | 'ios' | null | undefined
): string | undefined {
  if (!app) return undefined;
  if (typeof app === 'string') return app;
  return platform === 'ios' ? app.ios : app.android;
}
