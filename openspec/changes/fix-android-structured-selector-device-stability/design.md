# 设计：Android ID-only 节点与 session settings

## 调用链

### 结构化点击

`appium_get_page_source` → `parseAndroidPageSource` → `resolveStructuredActionTarget` → `tapBySelector` → `appium_gesture(action=tap, x, y)`

失败点位于 parser：`tapBySelector` 已支持对解析结果执行中心坐标点击，并不要求节点的 `clickable=true`。因此只需让 parser 保留可稳定寻址的 ID-only 节点，不需要改变执行器。

### 页面树超时

`createPlatformSession` → `appium_session_management(action=create)` → `SessionScopedMCPClient` → 页面树读取

UiAutomator2 的三项等待参数是 session settings，而不是当前驱动接受的 W3C capabilities。session 创建后，使用带 sessionId 的 `appium_driver_settings(action=update)` 才能实际生效。settings 必须在 `detectScreenSize` 以及后续 page-source 调用之前写入。

## 方案

### Parser 纳入条件

节点在 bounds 合法时，满足以下任一条件即可进入 `UIElement[]`：

- 可交互：clickable / editable / long-clickable / scrollable
- 有可读内容：text / content-desc
- 有稳定标识：resource-id

仍然过滤无标识、无内容、不可交互的纯布局节点，控制 DOM 元素量。

### Android driver settings

新增一个小型 helper，接收 session-scoped MCP client：

1. 调用 `appium_driver_settings` 更新三项等待设置。
2. 检查 MCP 返回文本；包含 error/failed 时抛错。
3. 仅 Android 调用；iOS 保持现状。
4. 本地与 cloud Android session 使用同一 helper，保证行为一致。

选择 fail-fast 是因为静默降级会重新引入动态页面长时间挂起，而且当前依赖的 appium-mcp 已提供该工具。

## 风险与控制

- **元素数量增加**：仅增加带 `resource-id` 的节点，不纳入普通空布局节点。
- **ID-only 节点并非自身 clickable**：结构化动作仍要求唯一且可见，点击使用其 bounds 中心；这与现有结构化坐标执行路径一致。
- **旧版 MCP 不支持 settings 工具**：初始化明确失败并带上工具错误，避免难以定位的后续 page-source 超时。
- **云设备差异**：Appium settings 是 session 级接口；若云厂商不支持，将在初始化阶段明确暴露，而不是产生间歇性执行失败。
