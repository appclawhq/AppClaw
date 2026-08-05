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
appclaw "open the settings app and turn on airplane mode"
```

You'll need **Node.js 22+**, a connected device / emulator / simulator, and an **LLM API key** (Anthropic, OpenAI, Google, Groq, or local Ollama). Full setup → **[appclaw.in](https://appclaw.in)**.

## What it can do

- **Agent mode** — plain-English goals; the LLM drives the device (tap, type, swipe)
- **YAML flows** — deterministic, zero-LLM automation with [structured selectors and state assertions](docs/structured-selectors.md)
- **Test runner** — vitest-style specs across real devices; scaffold with `appclaw init`
- **SDK** — drive AppClaw from your own vitest / jest / mocha
- **Playground, cloud devices, record & replay, PRD explorer**, and more

Every mode is documented at **[appclaw.in](https://appclaw.in)**.

## Packages

| Install                 | Package           | For                                                       |
| ----------------------- | ----------------- | --------------------------------------------------------- |
| `npm i -g @appclaw/cli` | `@appclaw/cli`    | the `appclaw` command — goals, flows, playground, reports |
| via `appclaw init`      | `@appclaw/runner` | vitest-style test runner (`appclaw-runner`)               |
| `npm i @appclaw/core`   | `@appclaw/core`   | the SDK / headless engine                                 |

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
