import { describe, test, expect } from 'vitest';
import {
  rankBySpatial,
  resolveEditableForTarget,
  resolveTapTarget,
} from '@appclaw/core/flow/run-yaml-flow';
import type { UIElement } from '@appclaw/core/perception/types';

function el(
  text: string,
  center: [number, number],
  size: [number, number],
  over: Partial<UIElement> = {}
): UIElement {
  return {
    id: '',
    accessibilityId: '',
    text,
    type: '',
    bounds: '',
    center,
    size,
    clickable: false,
    editable: false,
    enabled: true,
    checked: false,
    focused: false,
    selected: false,
    scrollable: false,
    longClickable: false,
    hint: '',
    action: 'tap',
    parent: '',
    depth: 0,
    platform: 'android',
    ...over,
  };
}

// ── Login-screen layout (device-pixel coords, top-down) ──────────────
const headerLogin = el('Login', [322, 470], [180, 80], { clickable: true });
const usernameField = el('username', [430, 700], [760, 120], { editable: true });
const passwordField = el('Password', [430, 880], [760, 120], { editable: true });
const orangeLoginBtn = el('LOGIN', [430, 1200], [600, 130], { clickable: true });
const navLogin = el('Login', [310, 2300], [120, 140], { clickable: true });
const formCard = el('', [430, 900], [800, 1000]);
const loginCandidates = [headerLogin, orangeLoginBtn, navLogin];

describe('rankBySpatial: relations', () => {
  test('below → nearest below first (orange button, not nav)', () => {
    expect(rankBySpatial(loginCandidates, passwordField, 'below')).toEqual([
      orangeLoginBtn,
      navLogin,
    ]);
  });
  test('above → header tab', () => {
    expect(rankBySpatial(loginCandidates, passwordField, 'above')[0]).toBe(headerLogin);
  });
  test('near → closest by bbox distance, far excluded', () => {
    const r = rankBySpatial([usernameField, orangeLoginBtn, navLogin], passwordField, 'near');
    expect(r[0]).toBe(usernameField);
    expect(r).not.toContain(navLogin);
  });
  test('within → contained element only', () => {
    const r = rankBySpatial([orangeLoginBtn, navLogin], formCard, 'within');
    expect(r).toContain(orangeLoginBtn);
    expect(r).not.toContain(navLogin);
  });
  test('toLeftOf / toRightOf', () => {
    const a = el('A', [200, 500], [100, 60]);
    const b = el('B', [600, 500], [100, 60]);
    expect(rankBySpatial([b], a, 'toRightOf')[0]).toBe(b);
    expect(rankBySpatial([a], b, 'toLeftOf')[0]).toBe(a);
    expect(rankBySpatial([b], a, 'toLeftOf')).toHaveLength(0); // wrong side
  });
});

describe('rankBySpatial: invariants', () => {
  test('anchor itself never returned', () => {
    expect(rankBySpatial([passwordField, orangeLoginBtn], passwordField, 'below')).not.toContain(
      passwordField
    );
  });
  test('no qualifying candidate → empty', () => {
    expect(rankBySpatial([orangeLoginBtn, navLogin], headerLogin, 'above')).toHaveLength(0);
  });
  test('disabled candidates dropped', () => {
    const disabled = el('LOGIN', [430, 1200], [600, 130], { enabled: false });
    expect(rankBySpatial([disabled], passwordField, 'below')).toHaveLength(0);
  });
  test('near expands to reach a moderately distant candidate', () => {
    const anchor = el('a', [100, 100], [20, 20]);
    const reachable = el('b', [100, 250], [20, 20]); // found only after a few expansions
    expect(rankBySpatial([reachable], anchor, 'near')[0]).toBe(reachable);
  });
  test('near is bounded — does not match across the whole screen', () => {
    const anchor = el('a', [100, 100], [20, 20]);
    const tooFar = el('b', [100, 5000], [20, 20]);
    expect(rankBySpatial([tooFar], anchor, 'near')).toHaveLength(0);
  });
});

describe('resolveEditableForTarget', () => {
  const emailInput = el('', [430, 700], [760, 120], { hint: 'Email', editable: true });
  const pwdInput = el('', [430, 880], [760, 120], { hint: 'Password', editable: true });
  const userLabel = el('Username', [120, 600], [200, 40]);
  const elements = [userLabel, emailInput, pwdInput];

  test('target picks THAT field, not the first editable (latent bug)', () => {
    expect(resolveEditableForTarget(elements, 'password').el).toBe(pwdInput);
    expect(resolveEditableForTarget(elements, 'email').el).toBe(emailInput);
  });
  test('label-only target → nearest editable', () => {
    expect(resolveEditableForTarget(elements, 'username').el).toBe(emailInput);
  });
  test('no target → first editable', () => {
    expect(resolveEditableForTarget(elements).el).toBe(emailInput);
  });
  test('explicit proximity narrows by anchor', () => {
    expect(
      resolveEditableForTarget(elements, undefined, { relation: 'below', anchor: 'username' }).el
    ).toBe(emailInput);
  });
  test('unmatched target → null + reason', () => {
    const r = resolveEditableForTarget(elements, 'zzz');
    expect(r.el).toBeNull();
    expect(r.reason).toBeTruthy();
  });
  test('no editable fields → null + reason', () => {
    const r = resolveEditableForTarget([userLabel], 'username');
    expect(r.el).toBeNull();
    expect(r.reason).toMatch(/no editable/i);
  });
  test('proximity anchor missing → null + reason', () => {
    const r = resolveEditableForTarget(elements, undefined, { relation: 'below', anchor: 'nope' });
    expect(r.el).toBeNull();
    expect(r.reason).toMatch(/not found/i);
  });
});

// Faithful to the WDIO login screen page source (center/size in device px).
// The help paragraph mentions "login button" and sits CLOSER to the password
// field than the real submit button — the exact trap that mis-fired before.
describe('resolveTapTarget: WDIO login screen', () => {
  const headerToggle = el('button-login-container', [529, 739], [311, 140], {
    accessibilityId: 'button-login-container',
    clickable: true,
  });
  const passwordInput = el('Password', [789, 1412], [1093, 158], {
    accessibilityId: 'input-password',
    hint: 'Password',
    editable: true,
    clickable: true,
  });
  const biometricsHelp = el(
    'When the device has Touch/FaceID enabled a biometrics button will be shown to test the login.',
    [720, 1681],
    [1300, 180]
  ); // clickable: false — pure text
  const orangeLogin = el('button-LOGIN', [721, 1971], [990, 150], {
    accessibilityId: 'button-LOGIN',
    clickable: true,
  });
  const navLogin = el('Login', [514, 2931], [160, 170], {
    accessibilityId: 'Login',
    clickable: true,
  });
  const screen = [headerToggle, passwordInput, biometricsHelp, orangeLogin, navLogin];

  test('"login button near password field" → orange submit, not the help paragraph', () => {
    const r = resolveTapTarget(screen, 'login button', {
      relation: 'near',
      anchor: 'password field',
    });
    expect(r.el).toBe(orangeLogin);
  });
  test('"login button below password field" → orange submit, not nav', () => {
    const r = resolveTapTarget(screen, 'login button', {
      relation: 'below',
      anchor: 'password field',
    });
    expect(r.el).toBe(orangeLogin);
  });
  test('non-clickable help paragraph is never the spatial pick', () => {
    const r = resolveTapTarget(screen, 'login button', {
      relation: 'near',
      anchor: 'password field',
    });
    expect(r.el).not.toBe(biometricsHelp);
  });
  test('anchor "password field" resolves and is not returned as the pick', () => {
    const r = resolveTapTarget(screen, 'login button', {
      relation: 'near',
      anchor: 'password field',
    });
    expect(r.el).not.toBe(passwordInput);
  });
});

// Search-results list (Groww-style). The typed query sits in the search box —
// a CLICKABLE EditText whose text exact-matches the row titles — while the row
// titles themselves are non-clickable TextViews inside clickable containers
// that carry no text. A hard clickable-only spatial pool collapses to the
// full-width search box, which can never satisfy toLeftOf → the exact
// "No YESBANK found to the left of BSE" regression.
describe('resolveTapTarget: list rows with non-clickable text (Groww regression)', () => {
  const searchBox = el('YesBank', [540, 230], [900, 130], { editable: true, clickable: true });
  const row1Container = el('', [540, 520], [1080, 180], { clickable: true });
  const row1Title = el('YESBANK', [160, 500], [220, 60]);
  const row1Badge = el('NSE', [320, 500], [80, 50]);
  const row2Container = el('', [540, 700], [1080, 180], { clickable: true });
  const row2Title = el('YESBANK', [160, 680], [220, 60]);
  const row2Badge = el('BSE', [320, 680], [80, 50]);
  const row2Sub = el('Yes Bank Limited', [220, 740], [340, 50]);
  const screen = [
    searchBox,
    row1Container,
    row1Title,
    row1Badge,
    row2Container,
    row2Title,
    row2Badge,
    row2Sub,
  ];

  test('"YESBANK toLeftOf BSE" → row-2 title, not the search box', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'BSE' });
    expect(r.el).toBe(row2Title);
  });
  test('"YESBANK near BSE" → row-2 title — typed search text is a value, not a label', () => {
    // `near` expands its radius until something matches, so a clickable-first
    // pool holding only the search box would eventually "match" it. The search
    // box must not be a candidate at all: its text is the typed query.
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'near', anchor: 'BSE' });
    expect(r.el).toBe(row2Title);
  });
  test('plain "YESBANK" no longer targets the search box holding the typed query', () => {
    const r = resolveTapTarget(screen, 'YESBANK');
    expect(r.el).not.toBe(searchBox);
  });
  test('long garbled phrase does not loose-match a short title', () => {
    const r = resolveTapTarget(screen, 'YESBANK to the righ to ₹2.02');
    expect(r.el).toBeNull();
  });
  test('vertical distance breaks the tie between identical row titles', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'NSE' });
    expect(r.el).toBe(row1Title);
  });
  test('clickable match still wins over closer stray text when it satisfies the relation', () => {
    const saveBtn = el('Save', [200, 500], [100, 60], { clickable: true });
    const strayText = el('Save your work', [250, 500], [180, 60]); // closer to anchor by bbox
    const cancel = el('Cancel', [600, 500], [100, 60], { clickable: true });
    const r = resolveTapTarget([saveBtn, strayText, cancel], 'Save', {
      relation: 'toLeftOf',
      anchor: 'Cancel',
    });
    expect(r.el).toBe(saveBtn);
  });
  test('anchor missing → null + reason naming the anchor', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'NASDAQ' });
    expect(r.el).toBeNull();
    expect(r.reason).toMatch(/NASDAQ/);
  });
  test('matches exist but wrong side → null + reason saying so', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toRightOf', anchor: 'BSE' });
    expect(r.el).toBeNull();
    expect(r.reason).toMatch(/none is to the right of/i);
  });
});

// Badge clusters: "NSE FO" and "OPT" are ADJACENT elements — no single element
// carries the phrase "NSEFO OPT". The resolver must merge the same-row run of
// elements whose concatenated text spells the label, instead of loosely
// matching the first "NSE FO" badge (which sits in the wrong, FUT, row).
describe('resolveTapTarget: compound labels spanning adjacent elements', () => {
  const futTitle = el('YESBANK', [160, 930], [220, 60]);
  const futBadge1 = el('NSE FO', [340, 930], [120, 50]);
  const futBadge2 = el('FUT', [440, 930], [60, 50]);
  const optTitle = el('YESBANK', [160, 1130], [220, 60]);
  const optBadge1 = el('NSE FO', [340, 1130], [120, 50]);
  const optBadge2 = el('OPT', [440, 1130], [60, 50]);
  const cePrice = el('₹2.90', [925, 1130], [150, 50]);
  const peTitle = el('YESBANK', [160, 1330], [220, 60]);
  const peBadge1 = el('NSE FO', [340, 1330], [120, 50]);
  const peBadge2 = el('OPT', [440, 1330], [60, 50]);
  const pePrice = el('₹0.04', [925, 1330], [150, 50]);
  const screen = [
    futTitle,
    futBadge1,
    futBadge2,
    optTitle,
    optBadge1,
    optBadge2,
    cePrice,
    peTitle,
    peBadge1,
    peBadge2,
    pePrice,
  ];

  test('anchor "NSEFO OPT" merges the badge cluster → OPT-row title, not FUT-row', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'NSEFO OPT' });
    expect(r.el).toBe(optTitle);
  });
  test('plain label "NSE FO OPT" resolves to the merged cluster, coordinate-only', () => {
    const r = resolveTapTarget(screen, 'NSE FO OPT');
    expect(r.coordinateOnly).toBe(true);
    expect(r.el?.center).toEqual([375, 1130]);
  });
  test('single-element anchors are untouched by compound matching ("FUT")', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'FUT' });
    expect(r.el).toBe(futTitle);
  });
  test('chained anchor: "NSEFO near ₹0.04" picks the PE-row badge → PE-row title', () => {
    // Three identical "NSE FO" badges — the chained qualifier selects the one
    // in the ₹0.04 row before the outer relation is applied.
    const r = resolveTapTarget(screen, 'YESBANK', {
      relation: 'toLeftOf',
      anchor: 'NSEFO',
      anchorProximity: { relation: 'near', anchor: '₹0.04' },
    });
    expect(r.el).toBe(peTitle);
  });
  test('fragment anchor ("NSEFO SAI") is not guessed → null with reason', () => {
    // "NSE FO" is a fragment of the anchor, but "SAI" exists nowhere — the
    // anchor must fail rather than silently resolve to the first "NSE FO".
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'NSEFO SAI' });
    expect(r.el).toBeNull();
    expect(r.reason).toMatch(/NSEFO SAI/);
  });
  test('anchor with a role-word suffix still resolves ("OPT badge")', () => {
    const r = resolveTapTarget(screen, 'YESBANK', { relation: 'toLeftOf', anchor: 'OPT badge' });
    expect(r.el).toBe(optTitle);
  });
  test('chained anchor unresolvable → null with the full chain in the reason', () => {
    const r = resolveTapTarget(screen, 'YESBANK', {
      relation: 'toLeftOf',
      anchor: 'NSEFO',
      anchorProximity: { relation: 'near', anchor: '₹9.99' },
    });
    expect(r.el).toBeNull();
    expect(r.reason).toMatch(/₹9\.99/);
  });
});

describe('resolveEditableForTarget: iOS elements', () => {
  // Parser fills the same fields cross-platform; resolver is platform-agnostic.
  const f1 = el('', [400, 600], [700, 110], { hint: 'Email', editable: true, platform: 'ios' });
  const f2 = el('', [400, 760], [700, 110], { hint: 'Password', editable: true, platform: 'ios' });
  test('targets the password field on iOS too', () => {
    expect(resolveEditableForTarget([f1, f2], 'password').el).toBe(f2);
  });
});
