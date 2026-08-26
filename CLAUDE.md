# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is AppClaw?

AppClaw is an agentic AI layer for mobile automation (Android & iOS). Users describe goals in plain English and AppClaw orchestrates device interactions through appium-mcp (Model Context Protocol). It supports multiple LLM providers (Anthropic, OpenAI, Google Gemini, Groq, Ollama) via the Vercel AI SDK.

## Build & Run Commands

```bash
npm run build          # TypeScript compilation (tsc) → dist/
npm run typecheck      # Type-check without emitting
npm start              # Run via tsx (dev mode)
npm start "goal"       # Run with a goal argument
npm run dev            # Run with file watching
npx tsx tests/verify-parsing.ts  # Run parsing verification tests
```

No formal test framework (Jest/Vitest) is configured. Tests are ad-hoc scripts in `tests/`.

## Architecture

### Entry Point & CLI Modes (`src/index.ts`)

The CLI routes to 6 modes based on flags:

- **Interactive** (default) — prompts for platform/device/goal, runs agent loop
- **YAML Flow** (`--flow file.yaml`) — declarative automation, zero LLM cost
- **Terminal Studio** (`--tui`, or its alias `--playground`) — multi-screen Ink app: platform/device picker, slash-command palette, step recording, `/goal` agent runs, settings, run history, and device mirroring — `/stream` renders the screen inside the terminal (see Terminal Studio below). This is the interactive mode; the old `--playground` REPL was removed and the flag now routes here.
- **Explorer** (`--explore`) — PRD → YAML test flow generation
- **Record/Replay** (`--record`, `--replay`) — capture and replay sessions
- **Report** (`--report`) — Express server serving HTML reports from `.appclaw/runs/`

The interactive and goal-direct paths also accept `--export [path]` (optionally `--export-dir <dir>`) to write a replayable `@appclaw/runner` spec when the goal completes. Path resolution: empty → `EXPORT_DIR/<goal-slug>.test.ts` (EXPORT_DIR defaults to `tests`, the runner's own testDir, so an export is runnable where it lands); bare filename → `EXPORT_DIR/<name>`; anything with a directory hint → used verbatim. Implementation in `src/sdk/goal-export.ts` (translator + renderer) called from `src/index.ts` after the agent loop.

### SDK (`src/sdk/`)

Public TypeScript API consumed by external tests (vitest/jest/mocha). Single entry: `import { AppClaw } from '@appclaw/core'`. Surface:

- `app.run(instruction, options?)` — one natural-language step, non-throwing, returns `{ success, action, message }`. `options` (`RunOptions`) applies per-command overrides for this call only: `waitTimeout`/`waitInterval` (implicit-wait poll budget) and `scrollMode`/`scrollTimes` (scroll/swipe distance + count). Instance-wide defaults for all four live on `AppClawOptions`; per-call values win. Implicit wait: every element-bearing action polls its target until present (DOM re-reads page source, vision re-captures the screenshot) or the budget is exhausted — `WAIT_TIMEOUT`/`WAIT_INTERVAL` env, default 10s/300ms
- `app.verify(claim)` — assertion. Throws `AppClawAssertionError` on failure (includes `claim`, `result`, and `screenContents` from DOM page-source in DOM mode — in vision mode the LLM's reason is already in `result.message`)
- `app.runFlow(path)` — wraps the YAML flow engine
- `app.runGoal(goal, { exportPath?, exportConfig? })` — wraps the agent loop. When `exportPath` is set, the trajectory is filtered with `keepOnlyFinalAttempt()` (drops the branch before any rejected `done`) then rendered as an `@appclaw/runner` spec via `generateSdkTest()`
- `app.teardown()` — finalize report, close MCP

Helpers in `src/sdk/goal-export.ts`: `keepOnlyFinalAttempt`, `instructionsFromHistory`, `decisionToInstruction`, `generateSdkTest`, `generateSdkTestFromInstructions` (the last is used by the step recorders' `/export *.test.ts` — see `packages/cli/src/step-recorder/`).

### Core Agent Loop (`src/agent/loop.ts`)

The main Perception→Reasoning→Action loop:

1. **Perceive** — get screen state (DOM XML or screenshot) via `src/perception/`
2. **Reason** — send trimmed DOM + goal + history to LLM via `src/llm/`
3. **Act** — execute action (tap, type, swipe) via appium-mcp through `src/mcp/`
4. **Feedback** — check for stuck state (`src/agent/stuck.ts`), adapt if needed
5. **Loop** until goal complete or max steps reached

Supporting agent modules: planner (goal decomposition), recovery (checkpointing), human-in-the-loop (OTP/CAPTCHA pauses), episodic memory (trajectory reuse).

### Key Module Responsibilities

- **`src/sdk/`** — Public TypeScript API for external tests. `index.ts` is the `AppClaw` class; `goal-export.ts` translates agent histories back to natural-language `app.run(...)` calls and renders `@appclaw/runner` specs; `step-runner.ts` adapts the YAML flow engine to single-instruction calls; `screen-snapshot.ts` captures visible DOM text for assertion-error context.
- **`src/llm/`** — Multi-provider LLM integration. `provider.ts` is the factory; `prompts.ts` builds system/user messages; `schemas.ts` defines action schemas. Tools from appium-mcp are dynamically converted to Vercel AI SDK format.
- **`src/mcp/`** — Appium MCP client wrapper. Connects via stdio (subprocess) or SSE. Handles tool calling, element finding, screenshots, keyboard input.
- **`src/perception/`** — Screen parsing. Android (`android-parser.ts`) and iOS (`ios-parser.ts`) XML parsers. `dom-trimmer.ts` compacts DOM for LLM token efficiency.
- **`src/vision/`** — AI vision element location using df-vision + Gemini (Stark) or appium-mcp server-side vision. Returns normalized coordinates.
- **`src/flow/`** — YAML flow execution. `parse-yaml-flow.ts` parses declarative steps; `run-yaml-flow.ts` executes them. Supports natural language steps, phased execution, variable interpolation from `.appclaw/env/`.
- **`src/device/`** — Device setup pipeline: platform selection → device picking → iOS-specific setup → Appium session creation.
- **`src/memory/`** — Episodic memory. Records successful trajectories to `~/.appclaw/trajectories.json`, retrieves relevant past experiences via fingerprinting.
- **`src/report/`** — Execution reporting. `writer.ts` collects artifacts; `renderer.ts` generates HTML reports; `server.ts` serves them.
- **`src/ui/terminal.ts`** — Rich terminal output (spinners, boxes, gradient headers, markdown rendering). JSON output mode for IDE integration (`json-emitter.ts`).
- **`packages/cli/src/step-recorder/`** — Shared by every step-recording surface. `flow-builder.ts` renders a recorded `FlowStep[]` as YAML or an `@appclaw/runner` spec and resolves `/export` paths; `screen-info.ts` answers "what's on screen?" via one vision call; `memory-inspect.ts` backs `/memory`. `json-bridge.ts` is the headless NDJSON-over-stdio recorder behind `appclaw --json --playground`, which the VS Code / Cursor extension spawns — its wire protocol is a shipped contract (see `vscode-extension/src/bridge.ts`).

### Terminal Studio (`packages/cli/src/tui/`)

`appclaw --tui` (and its alias `appclaw --playground`) is a separate, multi-screen Ink app (distinct from the single-screen agent-run UI in `packages/cli/src/ui/ink/`) with its own observable store (`store.ts`, a small subscribe/snapshot pub-sub) and a screen router (`TuiApp.tsx`) switching between `screens/{Welcome,DevicePicker,Main,Settings,History}Screen.tsx`. `commands.ts` defines the `/`-prefixed command palette shown on the Main screen. Anything NOT starting with `/` is one deterministic instruction — `runOneInstruction()` — appended to `store.steps`; that recording is what `/list`, `/yaml`, `/edit` and `/export` operate on, and a step that fails is reported but not recorded. `/goal <text>` is the opt-in to the autonomous loop (a single flat `runAgent()` call, no multi-sub-goal planner — that stays on the plain `appclaw "goal"` path) and records nothing. Device listing goes straight through `adb`/`xcrun simctl` (`@appclaw/core/device/emulator-list.ts`), not through an MCP session, so the picker works before any Appium session exists.

**Device mirroring** is Android-only, and `adb -s <serial>` is device-agnostic — the same path covers a running emulator, a physical phone and a headless emulator.

`/stream` renders the device **inside the terminal** (`packages/cli/src/tui/stream/`). Frames go to the side panel on the main screen (`components/StreamPanel.tsx`), which draws only chrome and leaves a blank region so the command palette and prompt stay live alongside it; `frame-loop.ts` polls `adb exec-out screencap` every 200ms and paints that region with direct `process.stdout.write`s — never from React, since Ink rewrites its whole frame on every state change. `terminal-caps.ts` picks the backend from env (no capability query — Ink owns stdin in raw mode): **Kitty graphics** for Ghostty/kitty/WezTerm (`kitty.ts` sends a PNG by file path, `a=T,f=100,t=f,c=…,r=…`, so the terminal does the scaling), otherwise **24-bit ANSI half-blocks** (`halfblock.ts` downsamples the raw RGBA framebuffer from `screencap` with no `-p`, so no PNG decoder and no new dependency). `layout.ts` holds the geometry both sides agree on. Force a backend with `APPCLAW_STREAM_BACKEND=kitty|halfblock`.

`/stream-close` stops it; device switches and `quit()` tear the frame loop down the same way, via `resetStream()`.

### Configuration (`src/config.ts`)

All config is via `.env` file, validated by Zod schema. Key vars: `LLM_PROVIDER`, `LLM_API_KEY`, `PLATFORM`, `AGENT_MODE` (dom vs vision), `MAX_STEPS`, `EXPORT_DIR` (default location for `--export` writes), `MCP_DEBUG` (verbose appium-mcp logs — function-evaluated so the SDK can flip it at runtime via the `mcpDebug` option). See README.md for the full table.

### Module Conventions

- ES2022 modules throughout (import/export)
- TypeScript strict mode
- Zod for schema validation
- No DI framework — modules import each other directly
- Constants and model pricing in `src/constants.ts`
