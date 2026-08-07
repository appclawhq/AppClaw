/**
 * Android UiAutomator2 XML → UIElement[] parser.
 * Parse Android UiAutomator2 page source XML from Appium into UIElement trees.
 */

import { XMLParser } from 'fast-xml-parser';
import type { UIElement } from './types.js';

export function parseAndroidPageSource(xmlContent: string): UIElement[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xmlContent);
  } catch {
    console.warn('Warning: Error parsing Android XML. The screen might be loading.');
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

    if (node['@_bounds']) {
      const treeId = `android-${treeSequence++}`;
      const isClickable = node['@_clickable'] === 'true';
      const isLongClickable = node['@_long-clickable'] === 'true';
      const isScrollable = node['@_scrollable'] === 'true';
      const isEnabled = node['@_enabled'] !== 'false';
      const isCheckable =
        node['@_checkable'] === 'true' ||
        /Switch|CheckBox|RadioButton/i.test(node['@_class'] ?? '');
      const isChecked = isCheckable ? node['@_checked'] === 'true' : undefined;
      const isFocused = node['@_focused'] == null ? undefined : node['@_focused'] === 'true';
      const isSelected = node['@_selected'] == null ? undefined : node['@_selected'] === 'true';
      const isVisible = node['@_displayed'] == null ? true : node['@_displayed'] !== 'false';

      const elementClass: string = node['@_class'] ?? '';
      const isEditable =
        elementClass.includes('EditText') ||
        elementClass.includes('AutoCompleteTextView') ||
        node['@_editable'] === 'true';

      const text: string = node['@_text'] ?? '';
      const desc: string = node['@_content-desc'] ?? '';
      const resourceId: string = node['@_resource-id'] ?? '';
      const hint: string = node['@_hint'] ?? '';
      const isPassword = node['@_password'] === 'true';

      const typeName = elementClass.split('.').pop() ?? '';
      const nodeLabel = text || desc || resourceId.split('/').pop() || typeName;

      const isInteractive = isClickable || isEditable || isLongClickable || isScrollable;
      const hasContent = !!(text || desc);
      // Some Android apps attach the gesture to an ancestor while exposing a
      // stable resource-id and bounds on a child container. Keeping id-bearing
      // nodes makes those targets addressable by deterministic selectors even
      // when UiAutomator2 reports clickable=false and no accessible label.
      const hasStableId = !!resourceId;

      if (isInteractive || hasContent || hasStableId) {
        const bounds: string = node['@_bounds'];
        try {
          const coords = bounds
            .replace('][', ',')
            .replace('[', '')
            .replace(']', '')
            .split(',')
            .map(Number);

          const [x1, y1, x2, y2] = coords;
          const width = x2 - x1;
          const height = y2 - y1;

          if (width > 0 && height > 0) {
            const centerX = Math.floor((x1 + x2) / 2);
            const centerY = Math.floor((y1 + y2) / 2);

            let suggestedAction: UIElement['action'];
            if (isEditable) suggestedAction = 'type';
            else if (isLongClickable && !isClickable) suggestedAction = 'longpress';
            else if (isScrollable && !isClickable) suggestedAction = 'scroll';
            else if (isClickable) suggestedAction = 'tap';
            else suggestedAction = 'read';

            elements.push({
              id: resourceId,
              accessibilityId: desc || resourceId.split('/').pop() || '',
              text: text || desc,
              ...(isEditable && text ? { value: text } : {}),
              type: typeName,
              bounds,
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
              longClickable: isLongClickable,
              hint,
              action: suggestedAction,
              parent: parentLabel,
              depth,
              treeId,
              ...(parentTreeId ? { parentTreeId } : {}),
              ancestorTreeIds,
              platform: 'android',
            });
          }
        } catch {
          // Skip malformed bounds
        }
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
    // Appium page source nests children directly as element type keys
    for (const key of Object.keys(node)) {
      if (key.startsWith('@_')) continue; // skip attributes
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
