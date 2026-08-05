import { describe, expect, test } from 'vitest';
import type { UIElement } from '@appclaw/core/perception/types';
import {
  evaluateStructuredAssertion,
  parseElementSelector,
  parseNumericExpectation,
  resolveElementSelector,
} from '@appclaw/core/flow/selector';

function element(
  text: string,
  center: [number, number],
  size: [number, number] = [100, 40],
  extra: Partial<UIElement> = {}
): UIElement {
  return {
    id: '',
    accessibilityId: '',
    text,
    type: 'TextView',
    bounds: `[${center[0] - size[0] / 2},${center[1] - size[1] / 2}]`,
    center,
    size,
    clickable: false,
    editable: false,
    enabled: true,
    scrollable: false,
    longClickable: false,
    hint: '',
    action: 'read',
    parent: 'root',
    depth: 0,
    platform: 'android',
    visible: true,
    ...extra,
  };
}

describe('structured selector matching', () => {
  const login = element('Login', [100, 400], [160, 60], {
    id: 'com.demo:id/login',
    accessibilityId: 'login_button',
    type: 'Button',
    clickable: true,
  });
  const loginHelp = element('Login help', [100, 500]);

  test('string shorthand is exact while contains and regex are explicit', () => {
    expect(resolveElementSelector([login, loginHelp], { text: 'Login' }).matches).toEqual([login]);
    expect(
      resolveElementSelector([login, loginHelp], {
        text: { value: 'Login', match: 'contains' },
      }).matches
    ).toEqual([login, loginHelp]);
    expect(
      resolveElementSelector([login, loginHelp], {
        text: { value: '^login\\s+help$', match: 'regex' },
      }).matches
    ).toEqual([loginHelp]);
  });

  test('combines stable identifiers and state with AND semantics', () => {
    const disabled = { ...login, enabled: false };
    expect(
      resolveElementSelector([disabled, loginHelp], {
        accessibilityId: 'login_button',
        enabled: false,
      }).matches
    ).toEqual([disabled]);
  });

  test('does not confuse unavailable boolean state with false', () => {
    expect(
      resolveElementSelector([loginHelp], { text: 'Login help', checked: false }).matches
    ).toEqual([]);
    const unchecked = { ...loginHelp, type: 'CheckBox', checked: false };
    expect(
      resolveElementSelector([unchecked], { text: 'Login help', checked: false }).matches
    ).toEqual([unchecked]);
  });

  test('index is applied after filtering', () => {
    const first = element('Add', [100, 100]);
    const second = element('Add', [100, 200]);
    const result = resolveElementSelector([first, second], { text: 'Add', index: 1 });
    expect(result.allMatches).toHaveLength(2);
    expect(result.matches).toEqual([second]);
  });

  test('strict parser rejects typos and invalid regexes', () => {
    expect(() => parseElementSelector({ enableded: true }, 'selector')).toThrow(/unknown/i);
    expect(() =>
      parseElementSelector({ text: { value: '[', match: 'regex' } }, 'selector')
    ).toThrow(/regular expression/i);
    expect(() => parseNumericExpectation({ tolerance: 2 }, 'count')).toThrow(
      /tolerance requires equals/i
    );
  });
});

describe('structured selector relations', () => {
  const form = element('Form', [300, 300], [500, 500], {
    treeId: 'form',
    type: 'View',
  });
  const password = element('Password', [300, 300], [300, 60], {
    treeId: 'password',
    parentTreeId: 'form',
    ancestorTreeIds: ['form'],
    editable: true,
  });
  const submit = element('Submit', [300, 430], [200, 70], {
    treeId: 'submit',
    parentTreeId: 'form',
    ancestorTreeIds: ['form'],
    clickable: true,
  });
  const icon = element('Arrow', [220, 430], [30, 30], {
    treeId: 'arrow',
    parentTreeId: 'submit',
    ancestorTreeIds: ['form', 'submit'],
  });

  test('supports geometric relations', () => {
    const screen = [form, password, submit, icon];
    expect(resolveElementSelector(screen, { text: 'Submit', below: 'Password' }).matches).toEqual([
      submit,
    ]);
    expect(resolveElementSelector(screen, { text: 'Arrow', within: 'Form' }).matches).toEqual([
      icon,
    ]);
    expect(resolveElementSelector([form], { text: 'Form', within: 'Form' }).matches).toEqual([]);
  });

  test('supports immediate-child and descendant relations', () => {
    const screen = [form, password, submit, icon];
    expect(resolveElementSelector(screen, { text: 'Submit', childOf: 'Form' }).matches).toEqual([
      submit,
    ]);
    expect(
      resolveElementSelector(screen, { text: 'Arrow', descendantOf: { text: 'Form' } }).matches
    ).toEqual([icon]);
    expect(resolveElementSelector(screen, { text: 'Arrow', childOf: 'Form' }).matches).toEqual([]);
  });
});

describe('structured assertions', () => {
  const switchElement = element('Notifications', [300, 400], [240, 80], {
    id: 'notifications_switch',
    type: 'Switch',
    checked: false,
    selected: false,
    value: 'off',
    clickable: true,
  });

  test('checks value, state, and dimensions with actionable diagnostics', () => {
    const result = evaluateStructuredAssertion(
      [switchElement],
      { id: 'notifications_switch' },
      {
        visible: true,
        checked: false,
        value: 'off',
        width: { gte: 200, lte: 260 },
        height: 80,
      }
    );
    expect(result.success).toBe(true);
    expect(result.diagnostics.matchedCount).toBe(1);
    expect(result.diagnostics.matched[0].bounds).toBeTruthy();
  });

  test('reports expected and actual property values', () => {
    const result = evaluateStructuredAssertion(
      [switchElement],
      { id: 'notifications_switch' },
      { checked: true }
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics.failures?.join(' ')).toMatch(/checked.*true.*false/);
  });

  test('supports count assertions', () => {
    const items = [
      element('Item', [100, 100], [100, 40], { type: 'Cell' }),
      element('Item', [100, 200], [100, 40], { type: 'Cell' }),
      element('Item', [100, 300], [100, 40], { type: 'Cell' }),
    ];
    expect(
      evaluateStructuredAssertion(items, { type: 'Cell' }, undefined, { gte: 2 }).success
    ).toBe(true);
    expect(evaluateStructuredAssertion(items, { type: 'Cell' }, undefined, 2).success).toBe(false);
  });

  test('absence satisfies visible=false and exists=false', () => {
    expect(evaluateStructuredAssertion([], { id: 'spinner' }, { visible: false }).success).toBe(
      true
    );
    expect(evaluateStructuredAssertion([], { id: 'spinner' }, { exists: false }).success).toBe(
      true
    );
  });

  test('masks secure values in diagnostics', () => {
    const password = element('Password', [100, 100], [200, 50], {
      id: 'password',
      type: 'SecureTextField',
      password: true,
      value: 'super-secret',
      editable: true,
    });
    const result = evaluateStructuredAssertion([password], { id: 'password' }, { value: 'wrong' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.diagnostics)).not.toContain('super-secret');
    expect(result.diagnostics.matched[0].value).toBe('***');
  });
});
