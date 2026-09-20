/**
 * Unit tests for locator-action helpers (no device / MCP required).
 */
import { describe, expect, test } from 'vitest';
import {
  escapeIosPredicateValue,
  hasClassicLocator,
  iosLabelPredicate,
  resolveNativeLocator,
  resolveTapInstruction,
  resolveTextInstruction,
  resolveTypeInstruction,
  textMatches,
} from '@appclaw/core/sdk/locator-actions';

describe('locator-actions helpers', () => {
  test('resolveNativeLocator prefers explicit strategy+selector', () => {
    expect(
      resolveNativeLocator({
        strategy: 'xpath',
        selector: '//*[@text="WATCHLIST"]',
        uiautomator: 'new UiSelector().text("WATCHLIST")',
      })
    ).toEqual({ strategy: 'xpath', selector: '//*[@text="WATCHLIST"]' });
  });

  test('resolveNativeLocator expands shorthands', () => {
    expect(resolveNativeLocator({ uiautomator: 'new UiSelector().text("X")' })).toEqual({
      strategy: '-android uiautomator',
      selector: 'new UiSelector().text("X")',
    });
    expect(resolveNativeLocator({ iosPredicate: 'label == "Y"' })).toEqual({
      strategy: '-ios predicate string',
      selector: 'label == "Y"',
    });
    expect(resolveNativeLocator({ iosClassChain: '**/XCUIElementTypeButton' })).toEqual({
      strategy: '-ios class chain',
      selector: '**/XCUIElementTypeButton',
    });
    expect(resolveNativeLocator({})).toBeNull();
  });

  test('iosLabelPredicate escapes quotes', () => {
    expect(escapeIosPredicateValue('a"b\\c')).toBe('a\\"b\\\\c');
    expect(iosLabelPredicate('Buy')).toBe('label == "Buy" OR name == "Buy" OR value == "Buy"');
  });

  test('hasClassicLocator detects id/label/xpath', () => {
    expect(hasClassicLocator({ id: 'x' })).toBe(true);
    expect(hasClassicLocator({ labels: ['A'] })).toBe(true);
    expect(hasClassicLocator({ xpath: '//*' })).toBe(true);
    expect(hasClassicLocator({ uiautomator: '…' })).toBe(false);
  });

  test('resolveTapInstruction prefers nl, then name, then locator fields', () => {
    expect(resolveTapInstruction({ nl: 'tap Search' })).toBe('tap Search');
    expect(resolveTapInstruction({ name: 'Search' })).toBe('tap Search');
    expect(resolveTapInstruction({ name: 'tap Home' })).toBe('tap Home');
    expect(resolveTapInstruction({ id: 'com.app:id/x' })).toBe('com.app:id/x');
  });

  test('resolveTypeInstruction', () => {
    expect(resolveTypeInstruction({ nl: "type 'a' in Search", text: 'a' })).toBe(
      "type 'a' in Search"
    );
    expect(resolveTypeInstruction({ name: 'Search', text: 'ITC' })).toBe(
      "type 'ITC' into Search"
    );
    expect(resolveTypeInstruction({ id: 'field', text: 'x' })).toBe("type 'x' into field");
  });

  test('resolveTextInstruction', () => {
    expect(resolveTextInstruction({ name: 'CTA', expected: 'BUY' })).toBe(
      "assert CTA is 'BUY'"
    );
    expect(resolveTextInstruction({ name: 'CTA' })).toBe('get text of CTA');
  });

  test('textMatches equals / contains / matches', () => {
    expect(textMatches('  Place BUY  ', 'place buy', 'equals')).toBe(true);
    expect(textMatches('Place BUY ORDER', 'BUY', 'contains')).toBe(true);
    expect(textMatches('Order #42', '^Order #\\d+$', 'matches')).toBe(true);
    expect(textMatches('nope', 'yes', 'equals')).toBe(false);
  });

});
