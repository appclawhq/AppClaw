/**
 * Generic cloud-provider support.
 *
 * AppClaw drives Appium through appium-mcp. For a remote/cloud device we hand
 * appium-mcp a `remoteServerUrl` (the provider's Appium hub) plus a flat set of
 * W3C capabilities; appium-mcp forwards them verbatim to the grid (it injects
 * NO defaults on the remote path — unlike the embedded local drivers). So this
 * module is responsible for:
 *
 *   1. building the hub URL (with basic-auth embedded, which appium-mcp decodes),
 *   2. supplying the caps the grid needs — including `platformName` and
 *      `appium:automationName`, which the caller MUST provide for a remote session.
 *
 * Provider-specific capability *namespaces* (bstack:options / sauce:options /
 * lt:options) are deliberately NOT modelled here. Users supply them via
 * CAPABILITIES_FILE (`--caps`), which is merged on top of the caps below. The
 * only convenience we map for the user are build/project labels (the most-used
 * dashboard fields), placed into the active provider's namespace.
 */

import type { AppClawConfig } from '../config.js';
import type { Platform } from '../sdk/types.js';

export type CloudProvider = Exclude<AppClawConfig['CLOUD_PROVIDER'], ''>;

/** Per-provider connection details. */
interface ProviderSpec {
  label: string;
  /** Build the base hub URL (no auth) for this provider from config. */
  hubHost: (config: AppClawConfig) => string;
  /** The `xxx:options` capability namespace this provider reads dashboard/session opts from. */
  optionsNamespace: string;
}

const PROVIDERS: Record<Exclude<CloudProvider, 'custom'>, ProviderSpec> = {
  browserstack: {
    label: 'BrowserStack',
    hubHost: () => 'hub-cloud.browserstack.com/wd/hub',
    optionsNamespace: 'bstack:options',
  },
  saucelabs: {
    label: 'Sauce Labs',
    // Sauce hubs are regional; default us-west-1, overridable via CLOUD_REGION.
    hubHost: (c) => `ondemand.${c.CLOUD_REGION || 'us-west-1'}.saucelabs.com/wd/hub`,
    optionsNamespace: 'sauce:options',
  },
  lambdatest: {
    label: 'LambdaTest',
    hubHost: () => 'mobile-hub.lambdatest.com/wd/hub',
    optionsNamespace: 'lt:options',
  },
};

/** True when a cloud/remote provider is configured (any non-empty CLOUD_PROVIDER). */
export function isCloud(config: AppClawConfig): boolean {
  return config.CLOUD_PROVIDER !== '';
}

/** Human-readable provider name for logs/messages. */
export function cloudProviderLabel(config: AppClawConfig): string {
  if (config.CLOUD_PROVIDER === 'custom' || config.CLOUD_PROVIDER === '') {
    return config.CLOUD_PROVIDER === 'custom' ? 'Custom grid' : 'local';
  }
  return PROVIDERS[config.CLOUD_PROVIDER].label;
}

/**
 * Build the full Appium hub URL for the configured provider, embedding basic
 * auth (`https://user:key@host/wd/hub`) when the URL doesn't already carry it.
 * appium-mcp parses this and passes user/key to the WebDriver client.
 */
export function buildCloudHubUrl(config: AppClawConfig): string {
  const provider = config.CLOUD_PROVIDER;
  if (provider === '') {
    throw new Error('buildCloudHubUrl called without a CLOUD_PROVIDER');
  }

  // `custom` (self-hosted grid): user supplies the whole URL. Inject creds only
  // if they gave them separately and didn't already embed auth in the URL.
  if (provider === 'custom') {
    return injectAuth(config.CLOUD_SERVER_URL, config);
  }

  // Known provider: allow CLOUD_SERVER_URL to override the built-in host.
  const host = config.CLOUD_SERVER_URL || `https://${PROVIDERS[provider].hubHost(config)}`;
  return injectAuth(host, config);
}

/** Embed `user:key@` into an http(s) URL if not already present. */
function injectAuth(rawUrl: string, config: AppClawConfig): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid cloud hub URL "${rawUrl}". Provide a full http(s) URL, e.g. https://hub.example.com/wd/hub`
    );
  }
  if (!url.username && config.CLOUD_USERNAME)
    url.username = encodeURIComponent(config.CLOUD_USERNAME);
  if (!url.password && config.CLOUD_ACCESS_KEY)
    url.password = encodeURIComponent(config.CLOUD_ACCESS_KEY);
  return url.toString();
}

/** W3C platformName + default automationName per AppClaw platform. */
function platformCaps(platform: Platform): Record<string, unknown> {
  return platform === 'ios'
    ? { platformName: 'iOS', 'appium:automationName': 'XCUITest' }
    : { platformName: 'Android', 'appium:automationName': 'UiAutomator2' };
}

/**
 * Build the capability object sent to the remote grid.
 *
 * Precedence (later wins): platform/automation defaults < device/os/app <
 * build/project convenience labels < user-supplied fileCaps (CAPABILITIES_FILE).
 * The caps file wins last so a user can override anything — including the
 * automationName or the provider-options namespace — for their grid.
 *
 * Device selectors (`appium:deviceName` / `appium:platformVersion` /
 * `appium:app`) are injected ONLY when the CLOUD_* env vars are set. Callers
 * who prefer to keep everything inline (e.g. `capabilities: { 'lt:options':
 * { deviceName, platformVersion, app } }` in appclaw.config.ts) can omit the
 * env vars entirely — the inline caps flow through fileCaps and reach the
 * grid unchanged.
 */
export function buildCloudCapabilities(
  config: AppClawConfig,
  platform: Platform,
  fileCaps: Record<string, unknown> = {}
): Record<string, unknown> {
  const caps: Record<string, unknown> = { ...platformCaps(platform) };
  if (config.CLOUD_DEVICE_NAME) caps['appium:deviceName'] = config.CLOUD_DEVICE_NAME;
  if (config.CLOUD_OS_VERSION) caps['appium:platformVersion'] = config.CLOUD_OS_VERSION;
  if (config.CLOUD_APP) caps['appium:app'] = config.CLOUD_APP;

  // Map build/project labels into the active provider's options namespace.
  // `custom` has no known namespace, so these are only applied for known providers.
  const provider = config.CLOUD_PROVIDER;
  if (provider !== '' && provider !== 'custom') {
    const ns = PROVIDERS[provider].optionsNamespace;
    const options: Record<string, unknown> = {};
    if (config.CLOUD_BUILD_NAME) options.build = config.CLOUD_BUILD_NAME;
    if (config.CLOUD_PROJECT_NAME) options.project = config.CLOUD_PROJECT_NAME;
    // BrowserStack uses camelCase (buildName/projectName); alias so both grids read it.
    if (provider === 'browserstack') {
      if (config.CLOUD_BUILD_NAME) options.buildName = config.CLOUD_BUILD_NAME;
      if (config.CLOUD_PROJECT_NAME) options.projectName = config.CLOUD_PROJECT_NAME;
    }
    if (Object.keys(options).length > 0) {
      // Merge into any namespace the user already set via fileCaps below.
      caps[ns] = { ...options, ...((fileCaps[ns] as Record<string, unknown>) ?? {}) };
    }
  }

  // User caps win last (including a fuller provider-options object).
  return { ...caps, ...fileCaps };
}
