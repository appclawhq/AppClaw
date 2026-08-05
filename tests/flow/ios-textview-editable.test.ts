import { describe, expect, test } from 'vitest';
import { resolveEditableForTarget } from '@appclaw/core/flow/run-yaml-flow';
import { trimDOM } from '@appclaw/core/perception/dom-trimmer';
import { parseIOSPageSource } from '@appclaw/core/perception/ios-parser';

const krnComposerSource = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication
    type="XCUIElementTypeApplication"
    name="快手"
    label="快手"
    enabled="true"
    visible="true"
    accessible="false"
    x="0"
    y="0"
    width="430"
    height="932">
    <XCUIElementTypeTextView
      type="XCUIElementTypeTextView"
      name="kitchen-composer-text-input"
      label="聊天输入框 输入问题..."
      enabled="true"
      visible="true"
      accessible="true"
      x="35"
      y="522"
      width="331"
      height="30"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

describe('iOS XCUIElementTypeTextView inputs', () => {
  test('page-source parser exposes a TextView as an editable type target', () => {
    const elements = parseIOSPageSource(krnComposerSource);
    const input = elements.find((element) => element.id === 'kitchen-composer-text-input');

    expect(input).toMatchObject({
      type: 'TextView',
      editable: true,
      action: 'type',
    });
    expect(resolveEditableForTarget(elements, 'kitchen-composer-text-input').el).toBe(input);
  });

  test('can retain hidden nodes for exists versus visible assertions', () => {
    const hiddenSource = krnComposerSource.replace(
      'visible="true"\n      accessible="true"\n      x="35"',
      'visible="false"\n      accessible="true"\n      x="35"'
    );
    expect(
      parseIOSPageSource(hiddenSource).find(
        (element) => element.id === 'kitchen-composer-text-input'
      )
    ).toBeUndefined();
    expect(
      parseIOSPageSource(hiddenSource, { includeHidden: true }).find(
        (element) => element.id === 'kitchen-composer-text-input'
      )
    ).toMatchObject({ visible: false });
  });

  test('DOM trimmer marks a TextView editable and includes it in editableCount', () => {
    const result = trimDOM(krnComposerSource, 'ios');

    expect(result.editableCount).toBe(1);
    expect(result.xml).toContain('<TextView');
    expect(result.xml).toContain('name="kitchen-composer-text-input"');
    expect(result.xml).toContain('editable="true"');
  });
});
