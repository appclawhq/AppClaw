## [2.4.1](https://github.com/appclawhq/AppClaw/compare/v2.4.0...v2.4.1) (2026-08-24)

### Bug Fixes

* **agent:** repair broken Anthropic goal execution and missing result output ([#59](https://github.com/appclawhq/AppClaw/issues/59)) ([282441a](https://github.com/appclawhq/AppClaw/commit/282441a4663034c8f81d3462331efcef817f6492))

## [2.4.0](https://github.com/appclawhq/AppClaw/compare/v2.3.0...v2.4.0) (2026-08-17)

### Features

* **cli:** add appclaw doctor environment preflight ([#58](https://github.com/appclawhq/AppClaw/issues/58)) ([3805170](https://github.com/appclawhq/AppClaw/commit/3805170c2c93928e6b505920c47d936137ad7a60))

## [2.3.0](https://github.com/appclawhq/AppClaw/compare/v2.2.0...v2.3.0) (2026-08-15)

### Features

* **flow:** add structured YAML selectors and property assertions ([#56](https://github.com/appclawhq/AppClaw/issues/56)) ([10363cd](https://github.com/appclawhq/AppClaw/commit/10363cdde36e16b19ca147ff5d23af84f067793b))

## [2.2.0](https://github.com/appclawhq/AppClaw/compare/v2.1.0...v2.2.0) (2026-08-07)

### Features

* Feat/anchored scroll assert ([#55](https://github.com/appclawhq/AppClaw/issues/55)) ([0607bb6](https://github.com/appclawhq/AppClaw/commit/0607bb6cc5226fbe08a0f0515fe91c36bcd5e470))

## [2.1.0](https://github.com/appclawhq/AppClaw/compare/v2.0.3...v2.1.0) (2026-08-04)

### Features

* **flow:** first-class double-tap support across all surfaces ([#53](https://github.com/appclawhq/AppClaw/issues/53)) ([f9ff850](https://github.com/appclawhq/AppClaw/commit/f9ff850285497ab01ca8dcb19bfd489d851adcdd))

## [2.0.3](https://github.com/appclawhq/AppClaw/compare/v2.0.2...v2.0.3) (2026-08-04)

### Bug Fixes

* use ESM readline in iOS device prompt ([#50](https://github.com/appclawhq/AppClaw/issues/50)) ([aee7c4d](https://github.com/appclawhq/AppClaw/commit/aee7c4de93a40273b9e971d6ea2c491527a7af64))

## [2.0.2](https://github.com/appclawhq/AppClaw/compare/v2.0.1...v2.0.2) (2026-08-03)

### Bug Fixes

* overhaul spatial locator resolution for list-row screens ([#52](https://github.com/appclawhq/AppClaw/issues/52)) ([b442987](https://github.com/appclawhq/AppClaw/commit/b4429870029cca908ca512be40818823ee830253))

## [2.0.1](https://github.com/appclawhq/AppClaw/compare/v2.0.0...v2.0.1) (2026-07-31)

### Bug Fixes

* detect iOS TextView as editable ([#51](https://github.com/appclawhq/AppClaw/issues/51)) ([7215eef](https://github.com/appclawhq/AppClaw/commit/7215eef711efaa30d69ec943ee5df09b5236ef98))

## [2.0.0](https://github.com/appclawhq/AppClaw/compare/v1.9.3...v2.0.0) (2026-07-09)

### ⚠ BREAKING CHANGES

* the `appclaw` npm package is replaced by scoped `@appclaw/*`
packages. Install `@appclaw/cli` for the CLI and `@appclaw/runner` for the
test runner. The `appclaw` and `appclaw-agent` package names are deprecated.

Co-authored-by: Srinivasan Sekar <srinivasan.sekar1990@gmail.com>

### Features

* split appclaw into scoped @appclaw/* packages ([#48](https://github.com/appclawhq/AppClaw/issues/48)) ([dd6d5c4](https://github.com/appclawhq/AppClaw/commit/dd6d5c44888af28b6537cbb14774b86142328cb1))

### Bug Fixes

* Add testing publish step to sample.yaml ([#46](https://github.com/appclawhq/AppClaw/issues/46)) ([d260fb5](https://github.com/appclawhq/AppClaw/commit/d260fb54cbe4add4c7cab6200eb497917c0ffed9))

## [1.9.3](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.9.2...v1.9.3) (2026-07-06)

### Bug Fixes

* bigger dashboard view — analytics, anime.js, filter bar & more ([#45](https://github.com/AppiumTestDistribution/AppClaw/issues/45)) ([4c302cb](https://github.com/AppiumTestDistribution/AppClaw/commit/4c302cbd669711e80d5988062851112adb491b1c))

## [1.9.2](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.9.1...v1.9.2) (2026-07-05)

### Bug Fixes

* cloud execution ([#44](https://github.com/AppiumTestDistribution/AppClaw/issues/44)) ([1e2c96c](https://github.com/AppiumTestDistribution/AppClaw/commit/1e2c96ce1ead143921e7bd6f473c54860abf5d76)), closes [#25](https://github.com/AppiumTestDistribution/AppClaw/issues/25)

## [1.9.1](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.9.0...v1.9.1) (2026-07-01)

### Bug Fixes

* add support for remote mcp ([#43](https://github.com/AppiumTestDistribution/AppClaw/issues/43)) ([f74ff8c](https://github.com/AppiumTestDistribution/AppClaw/commit/f74ff8c79178b146a7481c9bb6fd43510d994fa8))

## [1.9.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.8.0...v1.9.0) (2026-06-29)

### Features

* add support for appclaw runner ([#42](https://github.com/AppiumTestDistribution/AppClaw/issues/42)) ([edbe9c7](https://github.com/AppiumTestDistribution/AppClaw/commit/edbe9c74a769ec39ed603c315ffac47bc4f59f5a))

## [1.8.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.7.0...v1.8.0) (2026-06-24)

### Features

* proximity selectors for dom ([#40](https://github.com/AppiumTestDistribution/AppClaw/issues/40)) ([9eff1c6](https://github.com/AppiumTestDistribution/AppClaw/commit/9eff1c67638bb24646b10950e360525de1cfa60e))

## [1.7.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.6.0...v1.7.0) (2026-06-22)

### Features

* add locator cache for dom mode ([#39](https://github.com/AppiumTestDistribution/AppClaw/issues/39)) ([cff9cb1](https://github.com/AppiumTestDistribution/AppClaw/commit/cff9cb13b0d0dccb812bbb8ff4d41e00d20b2368))

## [1.6.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.6...v1.6.0) (2026-06-20)

### Features

* **session:** merge a capabilities JSON file into create_session ([0bc3b7b](https://github.com/AppiumTestDistribution/AppClaw/commit/0bc3b7b2ef9afc6809213e8a2f154af2dc61e368))

## [1.5.6](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.5...v1.5.6) (2026-06-20)

### Bug Fixes

* **vision:** locate input field by kind when a type target label can't be matched ([e5f58a6](https://github.com/AppiumTestDistribution/AppClaw/commit/e5f58a6e0c0536875598d4bafdbce66f7ebc1be6))

## [1.5.5](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.4...v1.5.5) (2026-06-20)

### Bug Fixes

* **playground:** correct misleading "Appium server" error; sync npx appium-mcp version ([82788c0](https://github.com/AppiumTestDistribution/AppClaw/commit/82788c0b438df5f4406ff19e313724321355810f))

## [1.5.4](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.3...v1.5.4) (2026-06-20)

### Bug Fixes

* Fix/env file vision mode ([#34](https://github.com/AppiumTestDistribution/AppClaw/issues/34)) ([1a292ac](https://github.com/AppiumTestDistribution/AppClaw/commit/1a292ac6b57f8b761a3e3328113fc1129e7c1aae))

## [1.5.3](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.2...v1.5.3) (2026-06-20)

### Bug Fixes

* update the CLI ([#33](https://github.com/AppiumTestDistribution/AppClaw/issues/33)) ([06492b7](https://github.com/AppiumTestDistribution/AppClaw/commit/06492b7f3fafb95908e3940a9fa337419b7f1fa9))

## [1.5.2](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.1...v1.5.2) (2026-06-19)

### Bug Fixes

* finding elements in dom mode ([#32](https://github.com/AppiumTestDistribution/AppClaw/issues/32)) ([37f3928](https://github.com/AppiumTestDistribution/AppClaw/commit/37f3928c062417b2c9bc8850b3c9398e714feade))

## [1.5.1](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.5.0...v1.5.1) (2026-06-18)

### Bug Fixes

* publish appclaw-agent in the unified release (use cd, not --prefix) ([#31](https://github.com/AppiumTestDistribution/AppClaw/issues/31)) ([fdf8a33](https://github.com/AppiumTestDistribution/AppClaw/commit/fdf8a3307e3ac2e10fa2f8a1090e1b4b528364ff))

## [1.5.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.4.0...v1.5.0) (2026-06-18)

### Features

* unify appclaw + appclaw-agent releases and make self-test manual ([#30](https://github.com/AppiumTestDistribution/AppClaw/issues/30)) ([5a56a4e](https://github.com/AppiumTestDistribution/AppClaw/commit/5a56a4efde08daba81c95789631a0e2fa8fb631a))

### Bug Fixes

* procedural memory matching ([6fdb812](https://github.com/AppiumTestDistribution/AppClaw/commit/6fdb812e0c6a7a737cd7c77b4e5829b3db58ac86))
* SDK to make proper typings and add auto wait ([#29](https://github.com/AppiumTestDistribution/AppClaw/issues/29)) ([2b08148](https://github.com/AppiumTestDistribution/AppClaw/commit/2b081484fb62ac773e23e7b1a91d0c4cd0484eda))

## [1.4.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.3.4...v1.4.0) (2026-06-10)

### Features

- agent cli ([#28](https://github.com/AppiumTestDistribution/AppClaw/issues/28)) ([76be5dc](https://github.com/AppiumTestDistribution/AppClaw/commit/76be5dc3a0746e2772676e644200b30df5e1693d))

## [1.3.4](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.3.3...v1.3.4) (2026-05-15)

### Bug Fixes

- improve locator scoring logic ([ba6ef85](https://github.com/AppiumTestDistribution/AppClaw/commit/ba6ef85a709288331621dceb2b86b91b5422a520))
- improve locator scoring logic ([855f9d6](https://github.com/AppiumTestDistribution/AppClaw/commit/855f9d6097c6418c0d5223868aa1545754406bc7))

## [1.3.3](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.3.2...v1.3.3) (2026-05-06)

### Bug Fixes

- update appium-mcp tool calls and fix vscode webview buttons ([4c95d8c](https://github.com/AppiumTestDistribution/AppClaw/commit/4c95d8c2f77cea1c47f93bd5ac0ffee629627de5))

## [1.3.2](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.3.1...v1.3.2) (2026-05-06)

### Bug Fixes

- ios taps for vision ([3828711](https://github.com/AppiumTestDistribution/AppClaw/commit/3828711930df50e68fa3a43bb9b5a5738cf4568d))

## [1.3.1](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.3.0...v1.3.1) (2026-05-03)

### Bug Fixes

- ci ([#24](https://github.com/AppiumTestDistribution/AppClaw/issues/24)) ([18df11e](https://github.com/AppiumTestDistribution/AppClaw/commit/18df11e9de978cec4ccd9c02f980773acce7d26b))
- zoom in a specific area ([5bee03d](https://github.com/AppiumTestDistribution/AppClaw/commit/5bee03d0b18b0fbf4f12f87c831049c3566af0b2))

## [1.3.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.2.1...v1.3.0) (2026-04-26)

### Features

- add zoom in and out support ([#23](https://github.com/AppiumTestDistribution/AppClaw/issues/23)) ([0e98ec3](https://github.com/AppiumTestDistribution/AppClaw/commit/0e98ec3e5eec4ba3b58460dd67e856f61b4ac717))

## [1.2.1](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.2.0...v1.2.1) (2026-04-24)

### Bug Fixes

- update docs ([d55a5e3](https://github.com/AppiumTestDistribution/AppClaw/commit/d55a5e3117b9628a065fe48c5392ed1be739424d))

## [1.2.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.1.0...v1.2.0) (2026-04-24)

### Features

- Appguide support ([#22](https://github.com/AppiumTestDistribution/AppClaw/issues/22)) ([63e366f](https://github.com/AppiumTestDistribution/AppClaw/commit/63e366feeb1f36c22643fff8d015f5b3b1253f6c))

## [1.1.0](https://github.com/AppiumTestDistribution/AppClaw/compare/v1.0.0...v1.1.0) (2026-04-17)

### Features

- add action.yml at repo root for GitHub Marketplace publishing ([#20](https://github.com/AppiumTestDistribution/AppClaw/issues/20)) ([c007399](https://github.com/AppiumTestDistribution/AppClaw/commit/c007399fa670273058cd51e65f0fd68323ccb3be))

## 1.0.0 (2026-04-16)

### Features

- integrate ai-sdk-ollama for LLM support and update configuration ([#9](https://github.com/AppiumTestDistribution/AppClaw/issues/9)) ([c6794d7](https://github.com/AppiumTestDistribution/AppClaw/commit/c6794d718a37ef690c09f5fb006c8994c78e361b))
- parallel testing support and screen recording for SDK ([#16](https://github.com/AppiumTestDistribution/AppClaw/issues/16)) ([7d14e7b](https://github.com/AppiumTestDistribution/AppClaw/commit/7d14e7b760c41783c61f1227c037e1b28d184a5c))
- strict playground tap matching, waitUntil pre-check, faster vision assert ([59b8c29](https://github.com/AppiumTestDistribution/AppClaw/commit/59b8c299bf20c9232d89bbbb4d93a9ef600cca2b))
- vision improvements — drag support, screenshot optimization, an… ([#7](https://github.com/AppiumTestDistribution/AppClaw/issues/7)) ([8cfbcb4](https://github.com/AppiumTestDistribution/AppClaw/commit/8cfbcb483fce0dec531ad8c21c8cd93d5743d62f))

### Bug Fixes

- add semantic-release for automated versioning and npm publishing ([#19](https://github.com/AppiumTestDistribution/AppClaw/issues/19)) ([66c73a6](https://github.com/AppiumTestDistribution/AppClaw/commit/66c73a677e763112c4fab80dd29301f3d2071532))
- ci ([#10](https://github.com/AppiumTestDistribution/AppClaw/issues/10)) ([dfcd62f](https://github.com/AppiumTestDistribution/AppClaw/commit/dfcd62fa083d673c98fc0c381820c7dd58d36818))
- DOM locator resolution, vision assert parsing, and appium-mcp coordinate scaling ([9272c36](https://github.com/AppiumTestDistribution/AppClaw/commit/9272c36b65e7bd996b730bb6d67d0fa6fee9518a))
- read CLI version from package.json instead of hardcoded string ([#14](https://github.com/AppiumTestDistribution/AppClaw/issues/14)) ([fcb3a64](https://github.com/AppiumTestDistribution/AppClaw/commit/fcb3a6417ddc48d72d246bc9fd5dd1438020635d))
- screenshot parsing ([e449a23](https://github.com/AppiumTestDistribution/AppClaw/commit/e449a2341fc67e193f1519bae16d4cace878bcfc))
- scroll-aware stuck detection, press_enter tool, and post-done verification ([c03bbe4](https://github.com/AppiumTestDistribution/AppClaw/commit/c03bbe4222ce7fd7bba6867f7d1e59ac5ef3c8ee))
- terminal UI ([294a780](https://github.com/AppiumTestDistribution/AppClaw/commit/294a780113d8afdb99b80cf57b47db5b3fe12dc2))
- terminal view ([42c0e75](https://github.com/AppiumTestDistribution/AppClaw/commit/42c0e75e2d8a28c569b6511891628c1b98380cc3))
