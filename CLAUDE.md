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

- **Goal** (default) — `appclaw` and `appclaw "a goal"` both open Terminal Studio in **goal mode**. Bare, it stays resident (device picker → goal prompt → run → back to the prompt); with a goal argument it runs once and then **holds the finished screen until a key is pressed** before exiting 0/1 — leaving the alternate screen erases the summary and the last device frame, which is the whole point of having watched. For an unattended run use `APPCLAW_TUI=off` (or any non-TTY), which takes the plain console path and exits on its own. Falls back to the plain console path (readline goal prompt + `RunScreen`) for `--record`, `--json`, non-TTY, and `APPCLAW_TUI=off`.
- **YAML Flow** (`--flow file.yaml`) — declarative automation, zero LLM cost
- **Terminal Studio** (`--tui`, or its alias `--playground`) — the same multi-screen Ink app in **record mode**: platform/device picker, slash-command palette, step recording, settings, run history, and device mirroring — `/stream` renders the screen inside the terminal (see Terminal Studio below). The old `--playground` REPL was removed and the flag now routes here. `/mode` switches between record and goal without dropping the device session.
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

- **`packages/cli/src/goal-session.ts`** — one goal, end to end: `decomposeGoal` → per-sub-goal orchestration (screen readiness, skip/rewrite) → `runAgent` → journey summary. Session-shaped things (MCP, LLM, AppResolver) are dependencies, not things it creates, so both the one-shot CLI and Terminal Studio's goal mode drive the same pipeline. It deliberately does not own device setup, Ink mounting, `--export` writing (that's `goal-export-file.ts`, shared by both callers) or process exit — those differ between a one-shot run and a resident shell. The `onPlanned` hook is where the CLI mounts Ink, between decomposition and the plan render.
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

Terminal Studio is the shell behind **both** `appclaw --tui` (alias `--playground`) and bare `appclaw` — a separate, multi-screen Ink app (distinct from the single-screen agent-run UI in `packages/cli/src/ui/ink/`) with its own observable store (`store.ts`, a small subscribe/snapshot pub-sub) and a screen router (`TuiApp.tsx`) switching between `screens/{Welcome,DevicePicker,Main,Settings,History,GoalRun}Screen.tsx`. `commands.ts` defines the `/`-prefixed command palette shown on the Main screen.

**Modes.** `store.mode` is `'record' | 'goal'` and decides what a plain (non-slash) line means. `--tui` opens in `record`: a plain line is one deterministic instruction — `runOneInstruction()` — appended to `store.steps`; that recording is what `/list`, `/yaml`, `/edit` and `/export` operate on, and a step that fails is reported but not recorded. Bare `appclaw` opens in `goal`: a plain line is a goal, run through the full planner via `runGoalSession()` (`packages/cli/src/goal-session.ts`) and rendered on the `run` screen by `GoalRunScreen`, which puts `ui/ink/RunScreen.tsx` in a column beside the device mirror. Mid-run keys: `p` pauses/resumes the mirror, `esc` asks the run to stop, ctrl+c quits. Stopping is **cooperative** — `AgentOptions.signal` is checked at each step boundary and `runGoalSession`'s between sub-goals, so it lands after the action in flight finishes, which is why the screen says "stopping…" rather than implying the keypress was instant. Nothing is recorded in goal mode, so the recorder commands are scoped out of the palette (`PaletteCommand.modes`, filtered by `commandsFor()`); typing one anyway explains the mode rather than failing as unknown. `/mode goal|record` switches, and `/goal <text>` works in both.

**The palette in goal mode** is **hidden**, not just filtered: a plain line there is a goal, not a command, so a standing list is a menu for nothing — the transcript gets its rows instead (`paletteRows`/`transcriptRows` take a `listVisible` flag; the column's total height is unchanged, which is what keeps the stream panel beside it where the frame loop expects). It reappears as soon as the line starts with `/`, where it is a live filter. A wrapped prompt then borrows its extra rows from the transcript rather than from the list — `inputLineBudget`/`inputLineCount` in `layout.ts`, called by MainScreen and CommandPalette alike so the two cannot disagree about how tall the prompt is.

**After a run.** The run screen is the only place the journey summary is drawn, so leaving it would take the sub-goal breakdown, tokens and cost with it. `summariseOutcome()` (`tui/goal-summary.ts`) writes them into the transcript as the result entry's detail block — the sub-goal results included, since what the agent _found_ is the reason the run happened. `/export` then works in **both** modes, from different material: the recorded step list in record mode, the last goal run in goal mode (`TuiActions.exportGoal` → `writeGoalExport`, the same writer `appclaw "goal" --export` uses). The resident shell is where you iterate on a goal until it does the right thing, which is exactly when you want it frozen into a deterministic spec; before this the outcome was held and unreachable. The run's platform is captured with the outcome rather than read at export time, so a `/device` switch in between cannot write an iOS spec for an Android run.

**Setup.** `collectSetupIssues(config, invalid)` (`tui/setup-check.ts`) runs before the pickers; anything it returns opens `SetupScreen` instead, which names the problem and offers to fix it — `LLM_API_KEY` is in `SETTINGS_KEYS` (masked in the list, last four characters shown) precisely so a missing key is resolvable without leaving the shell. Saving re-runs the check and calls `startAfterSetup()` when it comes back clean, so the shell continues rather than asking for a relaunch. The plain console path keeps the old `printError` + exit, having nowhere to offer a fix.

`invalid` is what zod rejected outright — a typo in `.env`. That used to be the product's worst startup failure: `Config` is built at **import time** (`config.ts`), so the throw escaped every try/catch in the CLI (there was no `main()` yet) and Node printed a raw ZodError with a stack trace. `safeLoadConfig()` reports instead of throwing, dropping only the offending keys so their schema defaults apply and the rest of the environment survives — enough to say what is wrong, never enough to run on, which is what `SetupScreen` enforces. `loadConfig()` still throws for the SDK, now with a readable message. `opensTerminalStudio(cliArgs)` in `packages/cli/src/index.ts` decides who reports: the shell can rewrite `.env`, so it gets the problem on a screen; every other path takes `printError` + exit 1 rather than running on defaults the user did not choose. `goToSettings()` shows a rejected key's **raw `.env` value** rather than the default it fell back to (the typo is the thing being corrected) and appends any offending key that `SETTINGS_KEYS` does not already list, so "press enter to edit it here" is never a dead end.

Two Ink apps cannot share stdout, so goal mode never calls `activateInk()` — it borrows only the renderer seam via `attachRunRenderer()` and mounts `RunScreen` as one of its own screens. `RunScreen` sizes its boxes from `RunWidthContext` (`ui/ink/width.ts`) rather than `stdout.columns`, which is the same thing only when the run owns the whole terminal — in a pane the summary box drew wider than its column and the pane's `overflow: hidden` sliced its border off. Device listing goes straight through `adb`/`xcrun simctl` (`@appclaw/core/device/emulator-list.ts`), not through an MCP session, so the picker works before any Appium session exists.

**Device mirroring** is Android-only, and `adb -s <serial>` is device-agnostic — the same path covers a running emulator, a physical phone and a headless emulator.

`/stream` renders the device **inside the terminal** (`packages/cli/src/tui/stream/`). Frames go to the side panel (`components/StreamPanel.tsx`), which appears on **both** the main screen and the goal-run screen — watching the phone is most useful while the agent is driving it, so the panel does not disappear for the length of a run. `frame-loop.ts` polls `adb exec-out screencap` every 200ms and does not place anything: for kitty it transmits a _virtual_ image and `<StreamPanel>` renders the U+10EEEE placeholder cells the terminal draws it into, so Ink owns placement and every repaint redraws the picture. Nothing in `stream/` knows a terminal coordinate. The panel's mount/unmount drives `setStreamPanelVisible()`, which pauses capture whenever no screen is showing it. `/stream` starts it from the prompt (and resumes a paused one), `/stream-pause` freezes it on its last frame, and `/stream-close` tears it down — pause and close are genuinely different: closing stops the loop, removes the temp dir and deletes the transmitted kitty image, so the picture disappears, whereas pausing only gates capture and leaves the frame on screen for a free resume. A finished one-shot run auto-pauses for exactly that reason. `--stream` starts it as soon as the session opens, which is the only way to get the picture during `appclaw "a goal"` — that form runs the goal on connect and never shows a prompt to type at. Because the loop cannot know which screen is mounted, MainScreen and GoalRunScreen must lay the column out from the same `layout.ts` numbers — a different split would hand the terminal an image that no longer matches its placeholder grid. `terminal-caps.ts` picks the backend from env (no capability query — Ink owns stdin in raw mode): **Kitty graphics** for Ghostty/kitty/WezTerm (`kitty.ts` sends a PNG by file path, `a=T,f=100,t=f,c=…,r=…`, so the terminal does the scaling), otherwise **24-bit ANSI half-blocks** (`halfblock.ts` downsamples the raw RGBA framebuffer from `screencap` with no `-p`, so no PNG decoder and no new dependency). `layout.ts` holds the geometry both sides agree on. Force a backend with `APPCLAW_STREAM_BACKEND=kitty|halfblock`.

`/stream-close` stops it; device switches and `quit()` tear the frame loop down the same way, via `resetStream()`.

**Stream shortcuts.** `^r` starts or resumes the stream, `^p` pauses/resumes it, `^x` closes it — bound on **both** the goal prompt and the run screen by `tui/stream-keys.ts`, which owns the chord table, the handler and the status-bar hints together so a binding cannot outlive its advertisement. Everything the stream says about itself names a chord rather than a slash command (transcript details, the idle panel's placeholder), because goal mode hides the palette: a message pointing at `/stream-pause` was pointing at something the user could no longer see. They are ctrl chords rather than bare letters because the goal prompt is a focused text input, where a bare `p` is part of the goal being typed; `^r` matters most on the run screen, which is the only way to start the mirror once the agent already owns the screen. That in turn is why the prompt uses `tui/components/PromptInput.tsx` instead of `ink-text-input`: **that component inserts any ctrl chord it does not recognise as a plain letter** (`^p` types `p`), so no screen holding a focused prompt could own a shortcut. `PromptInput` ignores every ctrl/meta chord (ctrl+c included, so TuiApp still quits), leaves the arrows, tab and page keys to the screen, and snaps the cursor to the end when the value is replaced from outside — which fixes history recall and tab completion landing the next character mid-string. The run screen keeps its bare `p` as well, having no input to compete with it.

### Configuration (`src/config.ts`)

All config is via `.env` file, validated by Zod schema — through `safeLoadConfig()`, which returns `{ config, issues }` rather than throwing (see Terminal Studio's **Setup** above for why that matters); `loadConfig()` is the throwing wrapper the SDK uses. Key vars: `LLM_PROVIDER`, `LLM_API_KEY`, `PLATFORM`, `AGENT_MODE` (dom vs vision), `MAX_STEPS`, `EXPORT_DIR` (default location for `--export` writes), `MCP_DEBUG` (verbose appium-mcp logs — function-evaluated so the SDK can flip it at runtime via the `mcpDebug` option). See README.md for the full table.

### Module Conventions

- ES2022 modules throughout (import/export)
- TypeScript strict mode
- Zod for schema validation
- No DI framework — modules import each other directly
- Constants and model pricing in `src/constants.ts`
