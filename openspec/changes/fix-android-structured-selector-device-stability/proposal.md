# 变更提案：修复 Android 结构化选择器与页面树稳定性

## 背景

Android 应用的无障碍树中，部分可交互区域由父级或手势层处理点击，因此节点本身可能同时满足：

- 有稳定的 `resource-id`
- 没有 `text` / `content-desc`
- `clickable=false`

当前 Android parser 会丢弃这类节点，导致 YAML 结构化 selector 即使拿到了真实 ID，也无法解析目标。在快手首页中，底部“问 AI”入口的 `merchant_ai_container` 就属于这种节点。

另外，appium-mcp 将 UiAutomator2 的 `waitForIdleTimeout`、`waitForSelectorTimeout` 等设置放进 session capabilities。当前 UiAutomator2 6.x 不识别这些 capability，动态页面上的 `getPageSource` 仍可能等待应用空闲并超时。

## 目标

1. Android parser 保留具有有效 `resource-id` 和有效 bounds 的节点，即使它没有文案且 `clickable=false`。
2. 不扩大到所有无内容容器：没有 ID、没有内容、不可交互的节点仍不进入可选择元素集合。
3. Android session 创建成功后，通过 Appium driver settings API 设置：
   - `actionAcknowledgmentTimeout: 0`
   - `waitForIdleTimeout: 0`
   - `waitForSelectorTimeout: 0`
4. settings 更新失败时终止 session 初始化，避免以“看似成功、实际仍会卡住”的配置继续执行。
5. 用快手 Android 真机验证：从首页通过结构化 ID 点击“问 AI”，并在落地页完成结构化断言；连续执行两次以覆盖重复 page-source 读取。

## 非目标

- 不改变结构化 selector 的“动作必须唯一匹配”语义。
- 不为该入口添加快手专用 selector 或坐标特例。
- 不改变 iOS session settings。
- 不引入 vision/LLM fallback。

## 验收标准

- parser 单测覆盖 ID-only、`clickable=false` 节点被保留。
- parser 单测覆盖无 ID 的空容器仍被过滤。
- runtime 单测证明该节点可被结构化 ID 解析并以中心坐标点击。
- session 单测证明 Android settings 在屏幕探测前更新，iOS 不更新。
- 类型检查、构建和相关测试通过。
- 快手真机“首页 → 问 AI”结构化 flow 连续两次通过。
