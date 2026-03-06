# iOS 实时活动 / 灵动岛 / 小组件数据面说明

## 数据管线

- 聚合入口：`src/features/system-surfaces/services/snapshotAggregator.ts`
- 快照类型：`src/features/system-surfaces/types.ts`
- 原生桥接：`src/features/system-surfaces/services/surfaceBridge.ts`
- App 根层发布：`app/_layout.tsx`（500ms debounce 订阅）
- App Group 持久化键：`system-surface:snapshot`

> Live Activity / Dynamic Island / Widget / 通知告警都应消费同一份快照，避免多份状态源漂移。

## 最新快照字段（RN -> iOS）

```json
{
  "title": "ClawLink",
  "subtitle": "Agent Alpha: searching logs...",
  "icon": "bolt.fill",
  "connection": "online",
  "activeSessions": 4,
  "activeChannels": 2,
  "pendingQueue": 1,
  "pendingMessages": 3,
  "timestamp": 1770000000000,
  "disconnectedSince": null,
  "activeAgent": {
    "agentId": "alpha",
    "agentName": "Agent Alpha",
    "currentTask": "searching logs",
    "model": "gpt-5-mini",
    "isStreaming": true
  },
  "costToday": 2.47,
  "costYesterday": 1.91,
  "requestsToday": 128,
  "tokenUsageToday": 48210,
  "errorCount": 1
}
```

## Live Activity ContentState（iOS）

`ClawLinkActivityAttributes.ContentState` 已对齐为：

- `connection`
- `activeAgentName`
- `activeTaskSummary`
- `sessionsCount`
- `channelsCount`
- `queueCount`
- `pendingMessages`
- `lastUpdated`
- `disconnectedSince`
- `costToday`
- `errorAgentCount`

`costYesterday`、`requestsToday`、`tokenUsageToday` 保留在 snapshot 层，主要供成本小组件与原生查询接口读取。

旧快照字段采用兜底策略解析，避免 Widget/Live Activity 崩溃。

## Widget 策略

- `ClawLinkStatusWidget`：状态总览（systemSmall/systemMedium + Lock Screen accessory）
- `ClawLinkCostWidget`：成本总览
  - Small：今日花费 + 与昨日对比趋势
  - Medium：今日花费 + 请求数 + Token 用量 + 昨日基线
- `ClawLinkMultiGatewayWidget`：多网关概览
  - Medium：最多 3 个网关的状态灯、名称和 Active 标记
- 所有 Widget 均直接读取 App Group 中的同一份 snapshot，避免各自拉取状态

## 原生桥接补充

- `ClawSurfaceBridge.getGatewayStatus()`：原生侧同步读取 App Group snapshot，返回状态摘要
- 该接口为 App Intents / Shortcut / 原生诊断页预留统一读取入口
- `ClawSurfaceBridge.publishMultiGatewayState()`：把多网关状态写入 App Group，供多网关 Widget 消费

## 通知 / 跳转

- 本地告警消费同一份 snapshot，并做 5 分钟去重
- 通知点击支持 deep link：
  - Agent error -> `clawlink://agents`
  - disconnect timeout / queue backlog -> `clawlink://monitor`

## Shortcuts

- `ClawGatewayStatusIntent`：返回最新网关状态摘要
- `ClawRestartAgentIntent`：把“重启 Agent”命令写入 App Group 并唤起 App 执行
- `ClawSendMessageIntent`：把“发送消息给 Agent”命令写入 App Group 并唤起 App 执行
