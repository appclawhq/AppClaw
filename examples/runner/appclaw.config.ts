import { defineConfig, TestContext } from 'appclaw/runner';

// Cloud mode is picked purely by env: set CLOUD_PROVIDER (lambdatest, browserstack,
// saucelabs, custom) and the corresponding CLOUD_USERNAME / CLOUD_ACCESS_KEY /
// CLOUD_DEVICE_NAME / CLOUD_OS_VERSION / CLOUD_APP vars. Everything else in this
// file stays the same for local vs cloud.
const cloudProvider = process.env.CLOUD_PROVIDER?.trim();
const isCloud = !!cloudProvider;

/**
 * Provider-specific caps for a cloud run. Everything the grid needs — device,
 * OS version, app, and the dashboard-facing bits — lives right here, keyed by
 * provider. Change the device or bump the OS version in this file, not in a
 * separate JSON or a wall of env vars.
 */
function cloudOptionsCaps(): Record<string, unknown> {
  const build = process.env.CLOUD_BUILD_NAME ?? 'AppClaw';
  const project = process.env.CLOUD_PROJECT_NAME ?? 'AppClaw Runner';
  switch (cloudProvider) {
    case 'lambdatest':
      return {
        'lt:options': {
          w3c: true,
          isRealMobile: true,
          deviceName: 'Pixel 4a',
          platformVersion: '12',
          // App ids go stale when the upload expires or is deleted on the hub —
          // re-upload and set CLOUD_APP to override without a code change.
          app: process.env.CLOUD_APP ?? 'lt://APP10160371691782901740218341',
          build,
          project,
          name: 'AppClaw Runner',
        },
      };
    case 'browserstack':
      return {
        'bstack:options': {
          deviceName: 'Samsung Galaxy S24',
          osVersion: '14',
          app: 'bs://<hashed-app-id>',
          buildName: build,
          projectName: project,
          sessionName: 'AppClaw Runner',
          debug: true,
        },
      };
    case 'saucelabs':
      return {
        'sauce:options': {
          deviceName: 'Samsung Galaxy S24',
          platformVersion: '14',
          app: 'storage:filename=app.apk',
          build,
          name: 'AppClaw Runner',
        },
      };
    default:
      // 'custom' or an unknown provider — no namespace to inject. Users can still
      // pass grid-specific caps via CAPABILITIES_FILE / APPCLAW_CAPS.
      return {};
  }
}

export default defineConfig({
  suiteName: `${new Date().toISOString()} + AppClaw Runner`,
  video: true,
  waitTimeout: 3000,
  waitInterval: 800,
  testDir: 'tests',
  // Cloud specs need a provider hub — leave them out of a local run's
  // discovery (`appclaw test` with no CLOUD_PROVIDER set). The cloud CI sets
  // CLOUD_PROVIDER, so there the spec is discovered as usual. One-off
  // exclusions also work from the CLI: `appclaw test --ignore <pattern>`.
  testIgnore: isCloud ? [] : ['**/lambdatest-cloud.spec.ts'],
  concurrency: 'auto',
  retries: 1,
  // Local appium-mcp SSE node either way. In cloud mode the local node still
  // handles the WebDriver client — it forwards the session to the provider hub
  // via `remoteServerUrl` (built from CLOUD_PROVIDER + CLOUD_* env).
  node: { local: true },

  // ── AppClaw options (forwarded to every test's session) ──
  // Platform: PLATFORM env wins, else Android by default.
  platform: (process.env.PLATFORM as 'android' | 'ios') ?? 'android',
  provider: process.env.LLM_PROVIDER as any,
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,

  // Caps: cloud inlines the provider-options namespace; local reads caps.json.
  // APPCLAW_CAPS (env or CI) overrides the local file — set it in cloud too
  // when you want a per-stage file to stack on top of the inline baseline.
  ...(isCloud
    ? { capabilities: cloudOptionsCaps() }
    : { capabilitiesFile: process.env.APPCLAW_CAPS ?? './tests/caps.json' }),

  // any other AppClawOptions also work here, e.g.:
  // agentMode: 'vision', maxSteps: 40, waitTimeout: 15000,

  // ── run-scoped (once per run, in the control plane) ──
  globalSetup: async ({ pool }) => {
    const where = isCloud ? `cloud · ${cloudProvider}` : 'local';
    console.log(`[globalSetup] ${where} · pool has ${pool.length} device(s)`);
    return { startedAt: Date.now(), seededUser: 'admin' }; // injected into every test as ctx.state
  },
  globalTeardown: async ({ state }) => {
    console.log(`[globalTeardown] run took ${Date.now() - state.startedAt}ms`);
  },

  // ── device-scoped (once per device, before its first test) ──
  deviceSetup: async (app, ctx: TestContext) => {
    console.log(`[deviceSetup] preparing ${ctx.device.name}`);
    // e.g. install build / grant permissions — runs once, state persists on device
  },

  // ── test-scoped (around every test) ──
  beforeEach: async (app, ctx) => {
    console.log(
      `[beforeEach] "${ctx.title}" on ${ctx.device.name} (state.user=${ctx.state.seededUser})`
    );
  },
  afterEach: async (app, info) => {
    console.log(`[afterEach] "${info.title}" → ${info.status} in ${info.durationMs}ms`);
  },
});
