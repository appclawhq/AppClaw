import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'gemini', 'groq', 'ollama']).default('gemini'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),

  /** Ollama HTTP API base (default http://127.0.0.1:11434). Set for remote or Docker. */
  OLLAMA_BASE_URL: z.string().default(''),
  /** Bearer token for Ollama Cloud / authenticated endpoints (optional). */
  OLLAMA_API_KEY: z.string().default(''),

  /** Target platform: "android" or "ios". Empty = prompt on macOS, default android elsewhere. */
  PLATFORM: z.enum(['android', 'ios', '']).default(''),

  /** iOS device type: "simulator" or "real". Only used when PLATFORM=ios. */
  DEVICE_TYPE: z.enum(['simulator', 'real', '']).default(''),

  /** Device UDID to target. Skips interactive device picker when set. */
  DEVICE_UDID: z.string().default(''),

  /** Device name to target (e.g. "iPhone 16 Pro"). Alternative to DEVICE_UDID. */
  DEVICE_NAME: z.string().default(''),

  /**
   * Local file path or HTTP(S) URL to an APK/IPA to install at session start.
   * Passed as the `appium:app` capability so Appium downloads and installs it automatically.
   * Example: APP_PATH=/path/to/app.apk  or  APP_PATH=https://example.com/MyApp.apk
   * Can be overridden per-flow via the `app:` key in the YAML meta section.
   */
  APP_PATH: z.string().default(''),

  /**
   * Path to a JSON file of extra Appium capabilities to merge into create_session.
   * The file must contain a flat JSON object of capability key/values, e.g.:
   *   { "appium:automationName": "UiAutomator2", "appium:autoGrantPermissions": true }
   * Merged on top of the config-derived defaults; framework-managed caps (parallel
   * ports, pinned udid) still take final precedence. Set via CAPABILITIES_FILE env,
   * the `--caps <path>` CLI flag, or the SDK `capabilitiesFile` option.
   */
  CAPABILITIES_FILE: z.string().default(''),

  MCP_TRANSPORT: z.enum(['stdio', 'sse']).default('stdio'),
  MCP_HOST: z.string().default('localhost'),
  MCP_PORT: z.coerce.number().default(8080),
  /**
   * Full appium-mcp SSE URL. When set (transport 'sse') it takes precedence over
   * MCP_HOST/MCP_PORT and preserves scheme + path — required for https tunnels
   * (ngrok) and non-default ports. Empty string means "reconstruct from host:port".
   */
  MCP_URL: z.string().default(''),

  /**
   * Android UiAutomator2: appium:mjpegScreenshotUrl — MJPEG stream URL for faster screenshots.
   * Default: http://127.0.0.1:7810 (matches default mjpegServerPort).
   */
  APPIUM_MJPEG_SCREENSHOT_URL: z.string().default('http://127.0.0.1:7810'),

  /**
   * Android UiAutomator2: appium:mjpegServerPort — port for the MJPEG screenshot server.
   * Default: 7810. Set to 0 to disable MJPEG and use normal screenshots.
   */
  APPIUM_MJPEG_SERVER_PORT: z.coerce.number().default(7810),

  MAX_STEPS: z.coerce.number().default(30),
  STEP_DELAY: z.coerce.number().default(500),

  /**
   * Implicit wait for element readiness before an action (tap/type/verify/scroll)
   * is performed. The target is polled until it is present on screen or this
   * budget is exhausted — so callers don't need explicit `wait`/`wait until …`
   * steps between actions. Default 10 s. Set to 0 to disable implicit waiting
   * (single-shot, fail-fast). Applies to both DOM and vision modes.
   */
  WAIT_TIMEOUT: z.coerce.number().default(10_000),
  /** Poll cadence (ms) for the implicit wait above. Default 300 ms. */
  WAIT_INTERVAL: z.coerce.number().default(300),
  MAX_ELEMENTS: z.coerce.number().default(40),
  MAX_HISTORY_STEPS: z.coerce.number().default(10),
  /** Milliseconds before an LLM request is aborted. Default 60 s. Set to 0 to disable. */
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().default(60_000),

  VISION_MODE: z.enum(['always', 'fallback', 'never']).default('fallback'),
  LOG_DIR: z.string().default('logs'),

  /**
   * Default directory for exported test specs (from `--export` and `/export
   * <name>.test.ts`). Bare filenames land here; paths with a directory
   * component (e.g. `./tests/foo.test.ts` or `/abs/path`) are used verbatim.
   * Override per-run via the `--export-dir` CLI flag.
   *
   * Defaults to the runner's own `testDir` so an export is runnable where it
   * lands: `appclaw-runner` discovers specs under `testDir` and takes filters,
   * not paths, so a file written outside it could never be run without being
   * moved first.
   */
  EXPORT_DIR: z.string().default('tests'),

  /** Gemini API key for Stark vision (optional if GEMINI_API_KEY is set). */
  STARK_VISION_API_KEY: z.string().default(''),

  /** Shared Gemini key name — used by Stark when STARK_VISION_API_KEY is empty. */
  GEMINI_API_KEY: z.string().default(''),

  /**
   * Model id for StarkVisionClient (@google/genai). Empty = use LLM_MODEL when LLM_PROVIDER=gemini, else a built-in default.
   */
  STARK_VISION_MODEL: z.string().default(''),

  /**
   * Base URL for an OpenAI-compatible local vision server (e.g. LM Studio: http://127.0.0.1:1234).
   * When set, StarkVisionClient routes all calls through the local server instead of Google GenAI.
   * STARK_VISION_MODEL must also be set to the model name shown by the local server.
   */
  STARK_VISION_BASE_URL: z.string().default(''),

  /**
   * Coordinate order returned by the local vision model.
   * 'yx' (default): model returns [y, x] as the prompt instructs (Gemma, most models).
   * 'xy': model returns [x, y] despite the prompt (some Qwen variants).
   */
  STARK_VISION_COORDINATE_ORDER: z.enum(['yx', 'xy']).default('yx'),

  /** Agent interaction mode: "dom" uses DOM locators, "vision" uses AI vision as primary strategy */
  AGENT_MODE: z.enum(['dom', 'vision']).default('dom'),

  /**
   * Log Stark vision locate calls (`[vision-locate] stark-vision | …`).
   * Set to false to silence.
   */
  VISION_LOCATE_LOG: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Per-step and run summary: token counts and estimated cost in the terminal. Set true to show. */
  SHOW_TOKEN_USAGE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /** Enable extended thinking/reasoning for supported providers (anthropic, gemini, openai) */
  LLM_THINKING: z.enum(['on', 'off']).default('on'),
  /**
   * Gemini 2.5: thinking token budget (0 = off, -1 = dynamic per Google).
   * Gemini 3.x: prefer LLM_GEMINI_THINKING_LEVEL; budget is not sent for 3.x to avoid odd interactions on 3 Pro.
   * Anthropic: extended thinking budget.
   */
  LLM_THINKING_BUDGET: z.coerce.number().default(128),

  /**
   * Gemini 3.x only — reasoning depth (https://ai.google.dev/gemini-api/docs/thinking).
   * Ignored for Gemini 2.5 (those use LLM_THINKING_BUDGET).
   */
  LLM_GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).default('medium'),

  /** When Gemini thinking is on, request thought summaries in the API stream (includeThoughts). */
  LLM_GEMINI_INCLUDE_THOUGHTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * If > 0, screenshots sent to the agent/planner LLM are downscaled so max(width,height) ≤ this value (aspect preserved).
   * Does not affect Stark vision or raw Appium captures — only multimodal model input. 0 = disabled.
   * Gemini bills images by resolution; try 384 (fewest image tokens) or 768 (balance).
   */
  LLM_SCREENSHOT_MAX_EDGE_PX: z.coerce.number().default(0),

  /** Episodic memory: persist successful trajectories across sessions. "on" to enable. */
  EPISODIC_MEMORY: z.enum(['on', 'off']).default('off'),

  /** Override path for episodic memory store. Empty = ~/.appclaw/trajectories.json */
  EPISODIC_MEMORY_PATH: z.string().default(''),

  /**
   * SDK locator cache: persist resolved (strategy, selector) per (app, screen,
   * label) so repeat `app.run(...)` calls skip page-source fetch + DOM scoring +
   * multi-strategy probe. DOM mode only. "on" to enable globally without
   * editing each `new AppClaw(...)` site.
   */
  LOCATOR_CACHE_ENABLED: z.enum(['on', 'off']).default('off'),

  /** Override path for the SDK locator cache. Empty = ~/.appclaw/locator-cache.json */
  LOCATOR_CACHE_PATH: z.string().default(''),

  /**
   * Namespace scoping for episodic + procedural memory. Use to isolate stores
   * across users, CI lanes, branches, or test suites so memories never bleed
   * between contexts. Default "default" preserves single-user behavior.
   */
  APPCLAW_MEMORY_NAMESPACE: z.string().default('default'),

  /**
   * Override path for procedural memory store. Empty = ~/.appclaw/procedures.json.
   * Multi-step recipes recorded from successful runs and replayed as plans.
   */
  PROCEDURAL_MEMORY_PATH: z.string().default(''),

  /**
   * Rolling run summary: compress the agent's action history every N steps to
   * keep long runs (30+ steps) within the LLM context budget. 0 disables.
   */
  RUN_SUMMARY_EVERY_N_STEPS: z.coerce.number().default(8),

  // ── Cloud provider ──────────────────────────────────────────────────────────
  // Generic remote-Appium cloud support. AppClaw builds the hub URL + auth from
  // the CLOUD_* creds below and routes the session through appium-mcp's
  // `remoteServerUrl` path. Provider-specific capability namespaces
  // (bstack:options / sauce:options / lt:options) are supplied via
  // CAPABILITIES_FILE (`--caps`) — AppClaw stays agnostic about them.

  /**
   * Cloud provider for remote device execution. Empty = local (default).
   * Known providers get a built-in hub URL; `custom` requires CLOUD_SERVER_URL.
   */
  CLOUD_PROVIDER: z.enum(['', 'browserstack', 'saucelabs', 'lambdatest', 'custom']).default(''),

  /** Cloud account username (required when CLOUD_PROVIDER is set, except `custom` with auth-in-URL). */
  CLOUD_USERNAME: z.string().default(''),

  /** Cloud access key / token (required when CLOUD_PROVIDER is set, except `custom` with auth-in-URL). */
  CLOUD_ACCESS_KEY: z.string().default(''),

  /** Cloud device name, e.g. "iPhone 14" or "Samsung Galaxy S24" (required when CLOUD_PROVIDER is set). */
  CLOUD_DEVICE_NAME: z.string().default(''),

  /** Cloud OS version, e.g. "16" or "14" (required when CLOUD_PROVIDER is set). */
  CLOUD_OS_VERSION: z.string().default(''),

  /**
   * App to install on the cloud device. Format is provider-specific:
   * BrowserStack `bs://…`, LambdaTest `lt://…`, Sauce Labs `storage:…`,
   * or an HTTP(S) URL for `custom`. Passed as `appium:app`.
   */
  CLOUD_APP: z.string().default(''),

  /**
   * Full Appium hub URL. Required when CLOUD_PROVIDER=custom (e.g. a self-hosted
   * grid). Optional override for known providers. May embed auth
   * (https://user:key@host/wd/hub); otherwise CLOUD_USERNAME/CLOUD_ACCESS_KEY are injected.
   */
  CLOUD_SERVER_URL: z.string().default(''),

  /**
   * Data-center region for providers that have regional hubs (Sauce Labs).
   * Default us-west-1. Ignored by providers without regions.
   */
  CLOUD_REGION: z.string().default('us-west-1'),

  /** Build label shown in the provider dashboard. Mapped into the provider's option namespace. */
  CLOUD_BUILD_NAME: z.string().default(''),

  /** Project label shown in the provider dashboard. Mapped into the provider's option namespace. */
  CLOUD_PROJECT_NAME: z.string().default(''),
});

export type AppClawConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides?: Record<string, string | undefined>): AppClawConfig {
  const env = overrides ? { ...process.env, ...overrides } : process.env;
  const config = envSchema.parse(env);
  if (config.CLOUD_PROVIDER) {
    // `custom` can carry auth in CLOUD_SERVER_URL, so creds aren't strictly
    // required there — but it MUST provide the hub URL. Known providers need creds.
    if (config.CLOUD_PROVIDER === 'custom') {
      if (!config.CLOUD_SERVER_URL) {
        throw new Error('CLOUD_SERVER_URL is required when CLOUD_PROVIDER=custom');
      }
    } else if (!config.CLOUD_USERNAME || !config.CLOUD_ACCESS_KEY) {
      throw new Error(
        `CLOUD_USERNAME and CLOUD_ACCESS_KEY are required when CLOUD_PROVIDER=${config.CLOUD_PROVIDER}`
      );
    }
    // Note: device / OS / app can come from CLOUD_DEVICE_NAME / CLOUD_OS_VERSION
    // / CLOUD_APP, or from inline `capabilities` (top-level appium:* or a
    // provider namespace like lt:options). We don't hard-fail here — the grid
    // itself returns a clear W3C error if the merged caps are missing platform
    // or device selectors, and requiring env vars would defeat the point of
    // "everything inline in appclaw.config.ts".
  }
  return config;
}

export const Config = loadConfig();

/**
 * Mutate the shared `Config` singleton in place so every module that imported it
 * by reference (run-yaml-flow, run-instruction, vision/locate-enabled, agent/loop, …)
 * sees `cfg`'s values.
 *
 * `Config` is computed once at import time (the line above), but config can change
 * after that: the CLI loads a `--env-file` into `process.env` at runtime, and the SDK
 * builds a per-instance config from constructor options. In-place mutation (rather than
 * reassigning the `const`) is what lets existing importers pick up the new values,
 * because they all hold the same object reference. A full `AppClawConfig` always carries
 * the complete key set (zod defaults fill any gaps), so no stale keys survive.
 */
export function applyConfig(cfg: AppClawConfig): AppClawConfig {
  return Object.assign(Config, cfg);
}

/**
 * Re-read `process.env` into the shared `Config` singleton. Used by the CLI after a
 * `--env-file` is loaded, so values like `AGENT_MODE=vision` reach the execution
 * pipeline instead of being silently ignored (which would fall back to DOM mode).
 */
export function refreshConfig(): AppClawConfig {
  return applyConfig(loadConfig());
}
