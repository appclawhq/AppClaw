/**
 * iOS XCUITest XML → UIElement[] parser.
 * Handles the XCUITest page source format which differs from Android:
 * - Element types: XCUIElementType* (e.g. XCUIElementTypeButton)
 * - Coordinates: x, y, width, height (not bounds="[x1,y1][x2,y2]")
 * - Text: label attribute (not text)
 * - Accessibility: name attribute (not content-desc)
 */

import { XMLParser } from 'fast-xml-parser';
import type { UIElement } from './types.js';

/** Map iOS element types to short readable names */
function shortTypeName(xcuiType: string): string {
  return xcuiType.replace('XCUIElementType', '');
}

/** Check if an iOS element type is typically editable */
function isEditableType(typeName: string): boolean {
  // XCUITest exposes UIKit/RN multiline inputs (including KRN composers) as TextView.
  const editableTypes = ['TextField', 'TextView', 'SecureTextField', 'TextEditor', 'SearchField'];
  return editableTypes.some((t) => typeName.includes(t));
}

export function parseIOSPageSource(
  xmlContent: string,
  options: { includeHidden?: boolean } = {}
): UIElement[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xmlContent);
  } catch {
    console.warn('Warning: Error parsing iOS XML. The screen might be loading.');
    return [];
  }

  const elements: UIElement[] = [];
  let treeSequence = 0;

  function walk(
    node: any,
    parentLabel: string,
    depth: number,
    parentTreeId?: string,
    ancestorTreeIds: string[] = []
  ): void {
    if (!node || typeof node !== 'object') return;

    // iOS elements have x, y, width, height attributes
    const hasPosition = node['@_x'] !== undefined && node['@_y'] !== undefined;

    if (hasPosition) {
      const treeId = `ios-${treeSequence++}`;
      const x = parseInt(node['@_x'] ?? '0', 10);
      const y = parseInt(node['@_y'] ?? '0', 10);
      const width = parseInt(node['@_width'] ?? '0', 10);
      const height = parseInt(node['@_height'] ?? '0', 10);

      const label: string = node['@_label'] ?? '';
      const name: string = node['@_name'] ?? '';
      const value: string = node['@_value'] ?? '';
      const elementType: string = node['@_type'] ?? '';
      const typeName = shortTypeName(elementType);

      const isAccessible = node['@_accessible'] === 'true';
      const isEnabled = node['@_enabled'] !== 'false';
      const isVisible = node['@_visible'] !== 'false';

      const isEditable = isEditableType(typeName);
      const isClickable =
        isAccessible ||
        typeName === 'Button' ||
        typeName === 'Cell' ||
        typeName === 'Link' ||
        typeName === 'Switch' ||
        typeName === 'Slider';
      const isScrollable =
        typeName === 'ScrollView' || typeName === 'Table' || typeName === 'CollectionView';
      const isCheckable =
        typeName === 'Switch' || typeName === 'CheckBox' || typeName === 'RadioButton';
      const isChecked = isCheckable
        ? ['1', 'true', 'on', 'checked'].includes(value.toLowerCase())
        : undefined;
      const isFocused = node['@_hasFocus'] == null ? undefined : node['@_hasFocus'] === 'true';
      const isSelected = node['@_selected'] == null ? undefined : node['@_selected'] === 'true';
      const isPassword = typeName.includes('SecureTextField');

      const displayText = label || name || value;
      const nodeLabel = displayText || typeName;

      const isInteractive = isClickable || isEditable || isScrollable;
      const hasContent = !!displayText;

      if (
        (isInteractive || hasContent) &&
        width > 0 &&
        height > 0 &&
        (isVisible || options.includeHidden)
      ) {
        const centerX = Math.floor(x + width / 2);
        const centerY = Math.floor(y + height / 2);

        let suggestedAction: UIElement['action'];
        if (isEditable) suggestedAction = 'type';
        else if (isScrollable && !isClickable) suggestedAction = 'scroll';
        else if (isClickable) suggestedAction = 'tap';
        else suggestedAction = 'read';

        elements.push({
          id: name,
          accessibilityId: name || label,
          text: displayText,
          ...(value ? { value } : {}),
          type: typeName,
          bounds: `[${x},${y}][${x + width},${y + height}]`,
          center: [centerX, centerY],
          size: [width, height],
          clickable: isClickable,
          editable: isEditable,
          enabled: isEnabled,
          checked: isChecked,
          focused: isFocused,
          selected: isSelected,
          visible: isVisible,
          password: isPassword,
          scrollable: isScrollable,
          longClickable: false, // iOS doesn't expose this in XML
          hint: node['@_placeholderValue'] ?? '',
          action: suggestedAction,
          parent: parentLabel,
          depth,
          treeId,
          ...(parentTreeId ? { parentTreeId } : {}),
          ancestorTreeIds,
          platform: 'ios',
        });
      }

      walkChildren(node, nodeLabel, depth + 1, treeId, [...ancestorTreeIds, treeId]);
      return;
    }

    walkChildren(node, parentLabel, depth, parentTreeId, ancestorTreeIds);
  }

  function walkChildren(
    node: any,
    parentLabel: string,
    depth: number,
    parentTreeId?: string,
    ancestorTreeIds: string[] = []
  ): void {
    for (const key of Object.keys(node)) {
      if (key.startsWith('@_')) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) walk(item, parentLabel, depth, parentTreeId, ancestorTreeIds);
      } else if (typeof child === 'object' && child !== null) {
        walk(child, parentLabel, depth, parentTreeId, ancestorTreeIds);
      }
    }
  }

  walk(parsed, 'root', 0);
  return elements;
}
