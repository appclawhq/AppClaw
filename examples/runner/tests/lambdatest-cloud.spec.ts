/**
 * LambdaTest cloud e2e — SDK on a remote device.
 *
 * Runs the same natural-language SDK API (`app.run` / `app.verify`) as the
 * local specs, but against a LambdaTest-uploaded VodQA build. The whole
 * stack — provider hub, WDA/Appium, appium-mcp routing — is exercised end
 * to end. Specs stay platform- and provider-agnostic; the wiring lives in
 * `.env` and `lt-caps.json`.
 *
 * How to run
 * ----------
 *   # From examples/runner — creds + provider come from .env:
 *   CLOUD_PROVIDER=lambdatest
 *   CLOUD_USERNAME=your_username
 *   CLOUD_ACCESS_KEY=your_access_key
 *
 *   npx appclaw test tests/lambdatest-cloud.spec.ts --env-file ../../.env
 *
 * Device / OS version / app id live inline in `appclaw.config.ts` under
 * `lt:options` — no separate `lt-caps.json` needed. Point `capabilitiesFile`
 * at a JSON file only when you need per-stage overrides on top of the
 * inline baseline.
 *
 * Note: the runner still discovers a device pool via the local appium-mcp
 * SSE node — cloud-aware pool discovery is not wired yet. Keep one Android
 * emulator/device connected so the runner has something to hand out; in
 * cloud mode the SDK ignores that udid and drives the LambdaTest device
 * pinned by `CLOUD_DEVICE_NAME` + `CLOUD_OS_VERSION`.
 */

import { afterAll, beforeAll, describe } from 'appclaw/runner';
import { test } from './fixtures.js';
import { tapLogin } from './steps.js';

describe('LambdaTest cloud · VodQA', () => {
  beforeAll(async () => {
    console.log('[cloud] suite starting — hub: mobile-hub.lambdatest.com');
  });
  afterAll(async () => {
    console.log('[cloud] suite finished');
  });

  test('login screen reaches the demo list', async ({ app, device }) => {
    console.log(`[cloud] running on ${device.name} (${device.platform})`);
    await tapLogin(app);
    await app.verify('the demo list is visible');
  });

  test('slider drags to reveal two green dots', async ({ loggedInApp }) => {
    await loggedInApp.run('Click on slider');
    await loggedInApp.run('Drag the slider fully to the right');
    await loggedInApp.verify('two green dots are visible');
  });
});
