import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { MCPClient } from '@appclaw/core/mcp/types';
import { runOneInstruction } from '@appclaw/core/flow/run-instruction';

// End-to-end through the shared playground/SDK pipeline (regex → executeStep →
// tapByLabel) against a Groww-style search-results page source. The regression:
// the typed query "YesBank" sits in a CLICKABLE full-width EditText while the
// row titles are non-clickable TextViews with no ids — so the old clickable-only
// spatial pool collapsed to the search box (→ "No YESBANK found to the left of
// BSE"), and even a correct pick would then be re-located by text xpath [1],
// landing on the FIRST row instead of the chosen one.
const GROWW_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" clickable="false" enabled="true">
    <android.widget.EditText class="android.widget.EditText" text="YesBank" resource-id="com.groww:id/search_input" clickable="true" enabled="true" focused="true" bounds="[90,165][990,295]" />
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="com.groww:id/row" clickable="true" enabled="true" bounds="[0,430][1080,610]">
      <android.widget.TextView class="android.widget.TextView" text="YESBANK" clickable="false" enabled="true" bounds="[50,470][270,530]" />
      <android.widget.TextView class="android.widget.TextView" text="NSE" clickable="false" enabled="true" bounds="[280,475][360,525]" />
      <android.widget.TextView class="android.widget.TextView" text="Yes Bank Limited" clickable="false" enabled="true" bounds="[50,540][390,590]" />
    </android.view.ViewGroup>
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="com.groww:id/row" clickable="true" enabled="true" bounds="[0,610][1080,790]">
      <android.widget.TextView class="android.widget.TextView" text="YESBANK" clickable="false" enabled="true" bounds="[50,650][270,710]" />
      <android.widget.TextView class="android.widget.TextView" text="BSE" clickable="false" enabled="true" bounds="[280,655][360,705]" />
      <android.widget.TextView class="android.widget.TextView" text="Yes Bank Limited" clickable="false" enabled="true" bounds="[50,720][390,770]" />
    </android.view.ViewGroup>
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="com.groww:id/row" clickable="true" enabled="true" bounds="[0,790][1080,970]">
      <android.widget.TextView class="android.widget.TextView" text="YESBANK" clickable="false" enabled="true" bounds="[50,830][270,890]" />
      <android.widget.TextView class="android.widget.TextView" text="NSE FO" clickable="false" enabled="true" bounds="[280,835][400,885]" />
      <android.widget.TextView class="android.widget.TextView" text="FUT" clickable="false" enabled="true" bounds="[410,835][470,885]" />
      <android.widget.TextView class="android.widget.TextView" text="25-AUG-26" clickable="false" enabled="true" bounds="[50,900][300,950]" />
    </android.view.ViewGroup>
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="com.groww:id/row" clickable="true" enabled="true" bounds="[0,970][1080,1150]">
      <android.widget.TextView class="android.widget.TextView" text="YESBANK" clickable="false" enabled="true" bounds="[50,1010][270,1070]" />
      <android.widget.TextView class="android.widget.TextView" text="NSE FO" clickable="false" enabled="true" bounds="[280,1015][400,1065]" />
      <android.widget.TextView class="android.widget.TextView" text="OPT" clickable="false" enabled="true" bounds="[410,1015][470,1065]" />
      <android.widget.TextView class="android.widget.TextView" text="₹2.90" clickable="false" enabled="true" bounds="[850,1015][1000,1065]" />
      <android.widget.TextView class="android.widget.TextView" text="25-Aug-26 20.00 CE" clickable="false" enabled="true" bounds="[50,1080][390,1130]" />
    </android.view.ViewGroup>
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="com.groww:id/row" clickable="true" enabled="true" bounds="[0,1150][1080,1330]">
      <android.widget.TextView class="android.widget.TextView" text="YESBANK" clickable="false" enabled="true" bounds="[50,1190][270,1250]" />
      <android.widget.TextView class="android.widget.TextView" text="NSE FO" clickable="false" enabled="true" bounds="[280,1195][400,1245]" />
      <android.widget.TextView class="android.widget.TextView" text="OPT" clickable="false" enabled="true" bounds="[410,1195][470,1245]" />
      <android.widget.TextView class="android.widget.TextView" text="₹0.04" clickable="false" enabled="true" bounds="[850,1195][1000,1245]" />
      <android.widget.TextView class="android.widget.TextView" text="25-Aug-26 20.00 PE" clickable="false" enabled="true" bounds="[50,1260][390,1310]" />
    </android.view.ViewGroup>
  </android.widget.FrameLayout>
</hierarchy>`;

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

let calls: ToolCall[];

function mockMcp(): MCPClient {
  return {
    callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === 'appium_get_page_source') {
        return { content: [{ type: 'text' as const, text: GROWW_XML }] };
      }
      if (name === 'appium_find_element') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Successfully found element. Element id 00000000-0000-000b-ffff-ffff000000de',
            },
          ],
        };
      }
      return { content: [{ type: 'text' as const, text: 'OK' }] };
    }),
    listTools: vi.fn(async () => []),
    close: vi.fn(async () => {}),
  } as unknown as MCPClient;
}

function gestureTaps(): ToolCall[] {
  return calls.filter((c) => c.name === 'appium_gesture' && c.args.action === 'tap');
}

beforeEach(() => {
  calls = [];
});

describe('runOneInstruction: spatially-qualified tap (playground/SDK path)', () => {
  test('"Click on YESBANK to the left of BSE" taps the row-2 title coordinates', async () => {
    const { step, result } = await runOneInstruction(
      mockMcp(),
      'Click on YESBANK to the left of BSE'
    );
    expect(step).toMatchObject({
      kind: 'tap',
      label: 'YESBANK',
      proximity: { relation: 'toLeftOf', anchor: 'BSE' },
    });
    expect(result.success).toBe(true);
    // Row-2 title center — NOT the search box (540,230) and NOT row 1 (160,500).
    const taps = gestureTaps();
    expect(taps).toHaveLength(1);
    expect(taps[0].args).toMatchObject({ x: 160, y: 680 });
    expect(result.message).toContain('to the left of "BSE"');
  });

  test('"Click on YESBANK near BSE" taps the row-2 title, not the search bar', async () => {
    const { step, result } = await runOneInstruction(mockMcp(), 'Click on YESBANK near BSE');
    expect(step).toMatchObject({
      kind: 'tap',
      label: 'YESBANK',
      proximity: { relation: 'near', anchor: 'BSE' },
    });
    expect(result.success).toBe(true);
    expect(gestureTaps()[0].args).toMatchObject({ x: 160, y: 680 });
  });

  test('anchor row disambiguates between identical titles ("… left of NSE" → row 1)', async () => {
    const { result } = await runOneInstruction(mockMcp(), 'Click on YESBANK to the left of NSE');
    expect(result.success).toBe(true);
    expect(gestureTaps()[0].args).toMatchObject({ x: 160, y: 500 });
  });

  test('spatial tap never re-locates by text xpath (would hit the FIRST duplicate)', async () => {
    await runOneInstruction(mockMcp(), 'Click on YESBANK to the left of BSE');
    expect(calls.filter((c) => c.name === 'appium_find_element')).toHaveLength(0);
  });

  test('compound anchor: "… to the left of NSEFO OPT" → first OPT row, not the first NSE FO row', async () => {
    // "NSEFO OPT" is no single element — it's the adjacent badges "NSE FO" + "OPT".
    // A loose single-element match would anchor on the FIRST "NSE FO" badge (a FUT row).
    const { result } = await runOneInstruction(
      mockMcp(),
      'Click on YESBANK to the left of NSEFO OPT'
    );
    expect(result.success).toBe(true);
    expect(gestureTaps()[0].args).toMatchObject({ x: 160, y: 1040 });
  });

  test('compound tap label: "Click on NSEFO OPT" taps the badge cluster by coordinates', async () => {
    const { result } = await runOneInstruction(mockMcp(), 'Click on NSEFO OPT');
    expect(result.success).toBe(true);
    // Merged rect of "NSE FO" [280..400] + "OPT" [410..470] → center (375, 1040).
    expect(gestureTaps()[0].args).toMatchObject({ x: 375, y: 1040 });
    expect(calls.filter((c) => c.name === 'appium_find_element')).toHaveLength(0);
  });

  test('chained proximity: "… to the left of NSEFO which is near ₹0.04" → PE row', async () => {
    // Every F&O row has an "NSE FO" badge; the chained qualifier picks the one
    // in the ₹0.04 row, then taps the YESBANK to its left.
    const { step, result } = await runOneInstruction(
      mockMcp(),
      'Click on YESBANK to the left of NSEFO which is near ₹0.04'
    );
    expect(step).toMatchObject({
      kind: 'tap',
      label: 'YESBANK',
      proximity: {
        relation: 'toLeftOf',
        anchor: 'NSEFO',
        anchorProximity: { relation: 'near', anchor: '₹0.04' },
      },
    });
    expect(result.success).toBe(true);
    expect(gestureTaps()[0].args).toMatchObject({ x: 160, y: 1220 });
    expect(result.message).toContain('"NSEFO" near "₹0.04"');
  });

  test('chained proximity without connector: "… to the left of OPT near ₹2.90" → CE row', async () => {
    const { result } = await runOneInstruction(
      mockMcp(),
      'Click on YESBANK to the left of OPT near ₹2.90'
    );
    expect(result.success).toBe(true);
    expect(gestureTaps()[0].args).toMatchObject({ x: 160, y: 1040 });
  });

  test('garbled qualifier ("to the righ to") fails loudly instead of tapping a random row', async () => {
    // "righ" + "to" — unparseable as a relation, so the whole phrase becomes
    // the tap label. It must NOT loose-match a row title and tap it.
    const { result } = await runOneInstruction(mockMcp(), 'Click on YESBANK to the righ to ₹2.02');
    expect(result.success).toBe(false);
    expect(gestureTaps()).toHaveLength(0);
    expect(result.message).toContain('No matching element');
    expect(result.message).toContain('spatial qualifier');
  });

  test('preposition slip "to the right to" parses as toRightOf and fails with real geometry', async () => {
    const { step, result } = await runOneInstruction(
      mockMcp(),
      'Click on YESBANK to the right to ₹2.90'
    );
    expect(step).toMatchObject({
      kind: 'tap',
      label: 'YESBANK',
      proximity: { relation: 'toRightOf', anchor: '₹2.90' },
    });
    expect(result.success).toBe(false);
    expect(gestureTaps()).toHaveLength(0);
    expect(result.message).toContain('to the right of "₹2.90"');
  });

  test('nonexistent anchor phrase ("NSEFO SAI") fails instead of guessing a fragment', async () => {
    const { result } = await runOneInstruction(
      mockMcp(),
      'Click on the YESBANK to the left of NSEFO SAI'
    );
    expect(result.success).toBe(false);
    expect(gestureTaps()).toHaveLength(0);
    expect(result.message).toContain('anchor "NSEFO SAI" not found');
  });

  test('failed qualifier reports the specific reason', async () => {
    const { result } = await runOneInstruction(mockMcp(), 'Click on YESBANK to the right of BSE');
    expect(result.success).toBe(false);
    expect(result.message).toContain('to the right of "BSE"');
    expect(result.message).toMatch(/none is to the right of/i);
  });

  test('plain tap (no qualifier) still uses the element-UUID locate path', async () => {
    const { result } = await runOneInstruction(mockMcp(), 'Click on YESBANK');
    expect(result.success).toBe(true);
    expect(calls.some((c) => c.name === 'appium_find_element')).toBe(true);
    const taps = gestureTaps();
    expect(taps).toHaveLength(1);
    expect(taps[0].args).toHaveProperty('elementUUID');
  });
});

describe('runOneInstruction: double tap', () => {
  function doubleTaps(): ToolCall[] {
    return calls.filter((c) => c.name === 'appium_gesture' && c.args.action === 'double_tap');
  }

  test('"Double tap on YESBANK to the left of BSE" fires double_tap at row-2 coords', async () => {
    const { step, result } = await runOneInstruction(
      mockMcp(),
      'Double tap on YESBANK to the left of BSE'
    );
    expect(step).toMatchObject({ kind: 'doubleTap', label: 'YESBANK' });
    expect(result.success).toBe(true);
    expect(result.message).toContain('Double-tapped');
    expect(gestureTaps()).toHaveLength(0); // no single tap fired
    expect(doubleTaps()).toHaveLength(1);
    expect(doubleTaps()[0].args).toMatchObject({ x: 160, y: 680 });
  });

  test('plain "double tap YESBANK" double-taps by element UUID', async () => {
    const { result } = await runOneInstruction(mockMcp(), 'double tap YESBANK');
    expect(result.success).toBe(true);
    expect(calls.some((c) => c.name === 'appium_find_element')).toBe(true);
    expect(doubleTaps()).toHaveLength(1);
    expect(doubleTaps()[0].args).toHaveProperty('elementUUID');
  });
});

// Anchored scroll-until-visible: a horizontal icon strip (FII/DII, Indices, …)
// low on the screen. "Goal calculator" is off the right edge and only enters
// the page source after two strip swipes. The gesture must be anchored at the
// strip (the FII/DII icon's position), not the screen center — and must KEEP
// using those coordinates even after the FII/DII icon itself scrolls away.
describe('runOneInstruction: anchored scroll-until-visible', () => {
  const stripXml = (icons: string[]) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" clickable="false" enabled="true">
    <android.widget.TextView class="android.widget.TextView" text="Post-Market Insights" clickable="false" enabled="true" bounds="[40,700][560,760]" />
    ${icons
      .map(
        (label, i) =>
          `<android.widget.TextView class="android.widget.TextView" text="${label}" clickable="true" enabled="true" bounds="[${40 + i * 210},1400][${210 + i * 210},1460]" />`
      )
      .join('\n    ')}
    <android.widget.TextView class="android.widget.TextView" text="View All" clickable="true" enabled="true" bounds="[850,1600][1010,1650]" />
  </android.widget.FrameLayout>
</hierarchy>`;

  function stripMcp(): MCPClient {
    let swipes = 0;
    return {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === 'appium_gesture' && (args.action === 'swipe' || args.action === 'scroll')) {
          swipes++;
        }
        if (name === 'appium_get_page_source') {
          const icons =
            swipes >= 2
              ? ['smallcase', 'Launchpad', 'Goal calculator']
              : ['FII/DII', 'Indices', 'Trade Easy', 'smallcase'];
          return { content: [{ type: 'text' as const, text: stripXml(icons) }] };
        }
        return { content: [{ type: 'text' as const, text: 'OK' }] };
      }),
      listTools: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    } as unknown as MCPClient;
  }

  test('"swipe the FII/DII left until Goal calculator is visible" swipes at the strip', async () => {
    const { step, result } = await runOneInstruction(
      stripMcp(),
      'swipe the FII/DII left until Goal calculator is visible'
    );
    expect(step).toMatchObject({
      kind: 'scrollAssert',
      target: 'FII/DII',
      direction: 'left',
      text: 'Goal calculator',
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('Goal calculator');
    expect(result.message).toContain('on "FII/DII"');

    const swipes = calls.filter((c) => c.name === 'appium_gesture' && c.args.action === 'swipe');
    expect(swipes).toHaveLength(2);
    for (const s of swipes) {
      // Anchored at the FII/DII icon center (125, 1430), finger moving left —
      // both swipes, including the one AFTER the icon left the page source.
      expect(s.args).toMatchObject({ x: 125, y: 1430 });
      expect(s.args.endX as number).toBeLessThan(125 + 1);
      expect(s.args.endY).toBe(1430);
    }
  }, 15000);

  test('region form: "swipe left inside the area above View All until …" swipes at the strip', async () => {
    // "area" is not a real element — the region is defined by the qualifier:
    // resolve "View All", then swipe from the nearest element ABOVE it (the
    // 'smallcase' icon at 755,1430 — inside the strip).
    const { step, result } = await runOneInstruction(
      stripMcp(),
      'swipe left inside the area above View All until Goal calculator is visible'
    );
    expect(step).toMatchObject({
      kind: 'scrollAssert',
      direction: 'left',
      target: 'area',
      targetProximity: { relation: 'above', anchor: 'View All' },
      text: 'Goal calculator',
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain('on "area above \"View All\""');

    const swipes = calls.filter((c) => c.name === 'appium_gesture' && c.args.action === 'swipe');
    expect(swipes).toHaveLength(2);
    for (const s of swipes) {
      expect(s.args).toMatchObject({ x: 755, y: 1430 });
      expect(s.args.endX as number).toBeLessThan(755 + 1);
      expect(s.args.endY).toBe(1430);
    }
  }, 15000);
});
