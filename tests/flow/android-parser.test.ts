import { describe, expect, test } from 'vitest';
import { parseAndroidPageSource } from '@appclaw/core/perception/android-parser';

describe('parseAndroidPageSource', () => {
  test('keeps an id-only node even when Android reports clickable=false', () => {
    const elements = parseAndroidPageSource(`
      <hierarchy rotation="0">
        <android.widget.FrameLayout
          class="android.widget.FrameLayout"
          resource-id="com.smile.gifmaker:id/merchant_ai_container"
          text=""
          content-desc=""
          clickable="false"
          enabled="true"
          bounds="[427,2205][652,2352]" />
      </hierarchy>
    `);

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      id: 'com.smile.gifmaker:id/merchant_ai_container',
      accessibilityId: 'merchant_ai_container',
      clickable: false,
      action: 'read',
      center: [539, 2278],
    });
  });

  test('still filters empty non-interactive layout nodes without an id', () => {
    const elements = parseAndroidPageSource(`
      <hierarchy rotation="0">
        <android.widget.FrameLayout
          class="android.widget.FrameLayout"
          text=""
          content-desc=""
          clickable="false"
          enabled="true"
          bounds="[0,0][1080,2400]" />
      </hierarchy>
    `);

    expect(elements).toEqual([]);
  });
});
