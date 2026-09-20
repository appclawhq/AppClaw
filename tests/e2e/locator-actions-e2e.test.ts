/**
 * SDK E2E tests for locator-based actions (tapByLocator, typeByLocator, etc.)
 *
 * These tests demonstrate the correct way to use UIAutomator, xpath, and other
 * native Appium locators through the AppClaw SDK, as opposed to trying to pass
 * them through the natural-language `app.run()` interface.
 *
 * IMPORTANT DISTINCTION:
 * - `app.run("tap Search")` → natural language; LLM/regex parses it as "tap the Search label"
 * - `app.tapByLocator({ uiautomator: '...' })` → direct Appium locator; bypasses NL parsing
 */

import { AppClaw } from '@appclaw/core';
import { describe, it } from 'vitest';
import 'dotenv/config';

describe('SDK E2E — locator-based actions', () => {
  it('tapByLocator with UIAutomator selector', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    // Correct approach: use tapByLocator() with uiautomator property
    // Use .description() to match content-desc attribute (from inspector screenshot)
    // The `skipNl: true` tells AppClaw to skip natural-language resolution.
    const result = await app.tapByLocator({
      name: 'Watchlist',
      accessibilityIds: ['Watchlist'],  // Must be an array to try multiple values
      skipNl: true,
    });

    console.log('Result:', result.success ? '✓ SUCCESS' : '✗ FAILED');
    if (result.message) console.log('Message:', result.message);

    await app.teardown();
  }, 90000);

  it('tapByLocator with xpath selector', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open AngelOne app');
    await app.run('wait 3 seconds');

    // Tap using xpath locator
    const result = await app.tapByLocator({
      name: 'Watchlist',
      xpath: '//*[@content-desc="Watchlist"]',
      skipNl: true,
    });

    console.log('Result:', result.success ? '✓ SUCCESS' : '✗ FAILED');
    if (result.message) console.log('Message:', result.message);

    await app.teardown();
  }, 90000);

  it('tapByLocator with resource-id', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open AngelOne app');
    await app.run('wait 3 seconds');

    // Tap using resource-id (Android-specific ID attribute)
    const result = await app.tapByLocator({
      name: 'Watchlist',
      id: 'com.msf.angelone:id/watchlist',
      skipNl: true,
    });

    console.log('Result:', result.success ? '✓ SUCCESS' : '✗ FAILED');
    if (result.message) console.log('Message:', result.message);

    await app.teardown();
  }, 90000);

  it('typeByLocator with UIAutomator selector', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open AngelOne app');
    await app.run('wait 3 seconds');
    await app.run('tap Search');
    await app.run('wait 1 second');

    // Type into a field identified by UIAutomator selector
    const result = await app.typeByLocator({
      name: 'Search field',
      text: 'ITC',
      uiautomator: 'new UiSelector().resourceId("com.msf.angelone:id/search")',
      skipNl: true,
    });

    console.log('Result:', result.success ? '✓ SUCCESS' : '✗ FAILED');
    if (result.message) console.log('Message:', result.message);

    await app.teardown();
  }, 90000);

  it('getTextByLocator with UIAutomator selector', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open AngelOne app');
    await app.run('wait 3 seconds');

    // Get text from an element identified by UIAutomator selector
    const result = await app.getTextByLocator({
      name: 'Portfolio value',
      uiautomator: 'new UiSelector().resourceId("com.msf.angelone:id/portfolio_value")',
      skipNl: true,
    });

    console.log('Result:', result.success ? '✓ SUCCESS' : '✗ FAILED');
    if (result.success && result.text) {
      console.log('Text:', result.text);
    } else if (result.message) {
      console.log('Message:', result.message);
    }

    await app.teardown();
  }, 90000);

  it('tapByLocator with NL + locator fallback', async () => {
    const app = new AppClaw({
      provider: 'gemini',
      apiKey: process.env.LLM_API_KEY,
      platform: 'android',
      video: true,
      mcpDebug: false,
    });

    await app.run('open AngelOne app');
    await app.run('wait 3 seconds');

    // By default (skipNl not set), tapByLocator tries natural language first.
    // If that fails, it falls back to the UIAutomator locator.
    // This is useful when element text might change but you want an alternative.
    const result = await app.tapByLocator({
      name: 'Watchlist',
      nl: 'tap Watchlist', // Try this first (natural language)
      uiautomator: 'new UiSelector().text("Watchlist")', // Fall back if NL fails
    });

    console.log('Result:', result.success ? '✓ SUCCESS' : '✗ FAILED');
    console.log('Via:', result.via); // Either 'nl' or 'locator'
    if (result.message) console.log('Message:', result.message);

    await app.teardown();
  }, 90000);
});
