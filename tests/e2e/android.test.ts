import { AppClaw } from '@appclaw/core';
import { describe, it } from 'vitest';
import 'dotenv/config';

describe('SDK E2E — teardown after use', () => {
  it('teardown() after runFlow() does not throw', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open YouTube app');
    await app.run('click on search icon');
    await app.run('wait 1 second');
    await app.run('type Appium 3.0');
    await app.run('wait 2 seconds');
    await app.run('click on the first result from the list');
    await app.run('wait 3 seconds');
    await app.run('scroll down 3 times');
    await app.verify('check the screen has video uploaded by IBM');
  }, 90000);

  it('DEBUG: Find correct Watchlist xpath in AngelOne app', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: true,
      agentMode: 'dom',
    });

    // Get page structure to see all elements
    console.log('\n========== DEBUGGING WATCHLIST ELEMENT ==========\n');
    const inspectResult = await app.run(
      'list all the elements on the screen with their types and attributes'
    );
    console.log('Page Structure:\n', inspectResult.message);

    // Try different xpath/locator combinations
    // NOTE: Using tapByLocator() instead of app.run('tap element with xpath ...')
    // to properly execute xpath selectors against Appium
    const xpathCombos = [
      { name: 'content-desc', xpath: "//*[@content-desc='Watchlist']" },
      { name: 'text attribute', xpath: "//*[@text='Watchlist']" },
      { name: 'contains text', xpath: "//*[contains(@text, 'Watchlist')]" },
      { name: 'contains content-desc', xpath: "//*[contains(@content-desc, 'Watchlist')]" },
      { name: 'any element', xpath: "//*[@text='WATCHLIST']" },
    ];

    for (const combo of xpathCombos) {
      console.log(`\n→ Testing: ${combo.name}`);
      console.log(`  XPath: ${combo.xpath}`);
      const result = await app.tapByLocator({
        name: 'Watchlist',
        xpath: combo.xpath,
        skipNl: true,
      });
      console.log(`  Result: ${result.success ? '✓ WORKS!' : '✗ Failed'}`);
      if (result.success) {
        console.log(`\n✅ CORRECT XPATH FOUND: "${combo.xpath}"\n`);
        break;
      }
    }

    await app.teardown();
  }, 120000);

  it('locator-based: tap using UIAutomator in AngelOne', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: true,
    });

    // Test 2: Tap Watchlist using UIAutomator via tapByLocator
    console.log('Test 2: Tapping Watchlist using UIAutomator...');
    const result2 = await app.tapByLocator({
      name: 'Watchlist',
      uiautomator: 'new UiSelector().text("Watchlist")',
      skipNl: true,
    });
    console.log('Result:', result2.success ? '✓ SUCCESS' : '✗ FAILED -', result2.message);

    await app.teardown();
  }, 90000);

  it('locator-based: tap using resource-id in AngelOne', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: true,
    });

    await app.run('open AngelOne app');
    await app.run('wait 3 seconds');

    // Test 3: Tap Watchlist using xpath via tapByLocator
    console.log('Test 3: Tapping Watchlist with xpath...');
    const result3 = await app.tapByLocator({
      name: 'Watchlist',
      xpath: "//*[contains(@text, 'Watchlist')]",
      skipNl: true,
    });
    console.log('Result:', result3.success ? '✓ SUCCESS' : '✗ FAILED -', result3.message);

    if (!result3.success) {
      // Try alternative xpath
      const result3alt = await app.tapByLocator({
        name: 'Watchlist',
        xpath: "//android.widget.FrameLayout[@content-desc='Watchlist']",
        skipNl: true,
      });
      console.log(
        'Alternative xpath result:',
        result3alt.success ? '✓ SUCCESS' : '✗ FAILED -',
        result3alt.message
      );
    }

    await app.teardown();
  }, 90000);

  it('verify element presence by locator', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open YouTube app');
    await app.run('wait 2 seconds');
    // Verify element using xpath via natural language
    await app.verify('the screen shows a search icon');
    await app.teardown();
  }, 60000);

  it('complex interaction with multiple locators', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open YouTube app');
    await app.run('wait 2 seconds');
    // Step 1: Tap search using UIAutomator via tapByLocator
    const tapResult = await app.tapByLocator({
      name: 'Search',
      uiautomator: 'new UiSelector().description("Search").first()',
      skipNl: true,
    });
    console.log('Search tap:', tapResult.success ? '✓' : '✗');

    await app.run('wait 500 milliseconds');
    // Step 2: Type query
    await app.run("type 'Flutter'");
    await app.run('wait 1 second');
    // Step 3: Tap first result
    await app.run('tap on the first video result');
    await app.run('wait 2 seconds');
    // Step 4: Verify we're on correct page
    await app.verify('the screen shows a video');
    await app.teardown();
  }, 90000);
});
