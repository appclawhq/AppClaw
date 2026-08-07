# Android 结构化自动化增量规范

## ADDED Requirements

### Requirement: 具有 resource-id 的 Android 节点必须可被结构化选择器观察

系统 MUST（必须）把具有非空 `resource-id` 和有效 bounds 的 Android 无障碍节点暴露给结构化 selector，即使该节点没有文本、没有 content description 且声明为不可点击。

#### Scenario: ID-only 容器可被点击

- **GIVEN** 页面树包含一个具有唯一 `resource-id`、有效 bounds、`clickable=false` 且无文案的节点
- **WHEN** YAML flow 使用该完整 ID 作为结构化 tap selector
- **THEN** selector 必须唯一解析该节点
- **AND** tap 必须落在该节点 bounds 的中心坐标

#### Scenario: 纯布局节点仍被过滤

- **GIVEN** 页面树包含一个没有 ID、没有文案、不可交互的布局节点
- **WHEN** Android parser 构建可选择元素集合
- **THEN** 该节点不得进入集合

### Requirement: Android driver 等待设置必须在 session 创建后生效

系统 MUST（必须）在 Android session 创建成功后、任何设备探测或页面树读取前，通过 Appium driver settings API 将 action acknowledgment、idle 和 selector wait timeout 设置为零。

#### Scenario: Android session 配置成功

- **WHEN** Android Appium session 创建成功
- **THEN** 系统必须以该 sessionId 更新三项 driver settings
- **AND** 更新完成后才可开始屏幕尺寸探测

#### Scenario: settings 更新失败

- **WHEN** driver settings API 返回失败
- **THEN** session 初始化必须失败并暴露原始错误信息

#### Scenario: iOS session 不受影响

- **WHEN** iOS Appium session 创建成功
- **THEN** 系统不得写入 Android 专属 driver settings
