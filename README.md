<h1 align="center">AppClaw</h1>

<p align="center">AI-powered mobile automation agent for Android and iOS. Tell it what to do in plain English — it figures out what to tap, type, and swipe.</p>

<table align="center">
<tr>
<td valign="middle" align="center">

<img src="landing/public/demo.gif" alt="AppClaw demo" width="280">

</td>
<td valign="middle">

```
You: "Send a WhatsApp message to Mom
      saying good morning"

AppClaw:
  Step 1: Open WhatsApp
  Step 2: Search for Mom
  Step 3: Open chat with Mom
  Step 4: Type "good morning"
  Step 5: Tap Send
  Step 6: Done

  ✅ Goal completed in 6 steps.
```

</td>
</tr>
</table>

<p align="center">
  <strong>📖 Full guide, setup, and docs → <a href="https://appclaw.in">appclaw.in</a></strong>
</p>

## Quickstart

```bash
npm install -g @appclaw/cli
appclaw doctor   # preflight: Node, .env, LLM key, appium-mcp, devices
appclaw "open the settings app and turn on airplane mode"
```

You'll need **Node.js 22+**, a connected device / emulator / simulator, and an **LLM API key** (Anthropic, OpenAI, Google, Groq, or local Ollama). `appclaw doctor` checks all of this in seconds and prints fix hints for anything missing (`--full` also spawns appium-mcp for a real handshake). Full setup → **[appclaw.in](https://appclaw.in)**.

That last command opens **Terminal Studio**, the full-screen shell: bare `appclaw` stays resident so you can run one goal after another, and `appclaw "a goal"` runs it once and holds the finished screen until you press a key. `appclaw --tui` opens the same shell in step-recording mode instead. Add `APPCLAW_TUI=off` for an unattended run that prints to the console and exits on its own.

Terminal Studio can mirror the device inside the terminal — `^r` starts it, `^p` pauses, `^x` closes (Android only; `--stream` starts it from the command line). It looks best on a terminal that speaks the kitty graphics protocol — Ghostty, kitty, WezTerm — and falls back to half-block characters elsewhere.

## What it can do

- **Agent mode** — plain-English goals; the LLM drives the device (tap, type, swipe)
- **YAML flows** — deterministic, zero-LLM automation with [structured selectors and state assertions](docs/structured-selectors.md)
- **Terminal Studio** (`appclaw`, or `appclaw --tui`) — one shell, two modes: describe goals and watch the agent work, or record steps one at a time. Either way the device is mirrored beside it and `/export` turns what just happened into a runnable spec
- **Test runner** — vitest-style specs across real devices, run with `appclaw test`; scaffold with `appclaw init`
- **SDK** — drive AppClaw from your own vitest / jest / mocha
- **Cloud devices, record & replay, PRD explorer**, and more

Every mode is documented at **[appclaw.in](https://appclaw.in)**.

## Packages

| Install                 | Package           | For                                                            |
| ----------------------- | ----------------- | -------------------------------------------------------------- |
| `npm i -g @appclaw/cli` | `@appclaw/cli`    | the `appclaw` command — goals, flows, Terminal Studio, reports |
| via `appclaw init`      | `@appclaw/runner` | vitest-style test runner (`appclaw test`)                      |
| `npm i @appclaw/core`   | `@appclaw/core`   | the SDK / headless engine                                      |

## Local development

```bash
git clone https://github.com/appclawhq/AppClaw.git
cd AppClaw
npm install
npm run build
cp .env.example .env   # add your LLM key
```

See [`CLAUDE.md`](CLAUDE.md) for the architecture overview, and [appclaw.in](https://appclaw.in) for usage.

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE) for the full text.
