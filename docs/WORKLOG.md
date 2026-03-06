# ClawLink 开发日志

## 2026-03-06

### Epic 0（系统表面统一数据管线）

- 扩展 `SystemSurfaceSnapshot`：新增 `pendingMessages`、`disconnectedSince`、`activeAgent`、`costToday`、`errorCount`
- 新建 `snapshotAggregator`：统一聚合 connection/chat/dashboard/agent runtime/agent activity 数据，并提供 500ms debounce 订阅
- Root 层改为订阅式自动推送：`app/_layout.tsx` 使用 `subscribeSnapshotChanges` 自动发布 Live Activity/Widget 数据
- 新增 Agent 运行态缓存：`agentsRuntimeStore` 保存最近 agent 状态（用于 errorCount 与 agentName 映射）
- 新增 Agent 活动态缓存：`agentActivityStore` 从流式会话提取实时任务摘要（用于灵动岛/锁屏活动态展示）
- Chat streaming 增强：SSE/WS 分支都提取 tool_call 与文本摘要，流结束自动清空活动态
- iOS `ContentState` 已升级为新结构（connection/activeAgentName/activeTaskSummary/pendingMessages/disconnectedSince/costToday/errorAgentCount）
- Connection Store 的 `disconnectedSince` 采用状态迁移规则维护（connected -> 非 connected 时起算，恢复 connected 清空）
- 系统快照新增 `costYesterday`、`requestsToday`、`tokenUsageToday`，供 Widget / App Intent 共享读取
- 新增 `ClawLinkCostWidget`：展示今日花费、昨日对比、请求数与 Token 用量
- 新增 `ClawLinkMultiGatewayWidget`：展示最多 3 个网关的在线/重连/离线状态
- 原生桥接新增 `getGatewayStatus`：直接从 App Group 读取 snapshot，为 Shortcut / 原生侧查询预留入口
- 根层新增前台 surface 数据刷新：定时同步 Dashboard + Agents 运行态，降低灵动岛 / 通知依赖页面驻留的程度
- 本地告警支持 deep link：Agent 异常跳转 `agents`，断连 / 队列积压跳转 `monitor`
- 新增 App Intents / Shortcuts：查询网关状态、重启指定 Agent、向指定 Agent 发送消息（通过 App Group 命令交给 RN 执行）
- `connectionStore` 新增多网关后台健康状态缓存，并在 Dashboard 顶部展示“全局网关状态”
- Settings 新增 `Health Bridge` 页面：M1 阶段包含权限申请 UI、指标开关和本地 mock 数据预览

## 2026-03-02

### 阶段 1（基础架构）

- 建立 Expo Router 四大主模块路由结构
- 完成连接管理：profile CRUD、健康检查、设备握手、心跳保活
- 实现 API 基础层：axios 拦截器、自动鉴权、重试机制
- 完成 Zod schema 基础定义
- 完成 Dashboard 初版（含图表与本地快照）
- 实现 Skill 安全扫描核心工具（regex + 上下文输出）

### 阶段 2（遥控器能力增强）

- Dashboard 切换到真实 stats 接口（requests/tokens/latency/health）
- 新增本地模型价格配置与成本估算
- Agents 页面接入控制动作：enable/disable/restart/kill/logs
- Monitor 接入双通道 WebSocket：日志流 + 主机指标流
- 增加紧急控制入口：restart gateway / purge sessions / kill agent
- Chat 接入多代理、多会话、SSE 流式、离线队列、断线重放与增量同步

### 阶段 3（技能安装与聊天体验打磨）

- Agents 接入 Skill 安装安全报告全流程：metadata 获取 -> 文件收集 -> scanner 扫描 -> 报告审批 -> 生物认证安装
- Skill 安全报告新增风险等级、扫描源统计、阻断外链统计与扫描目标列表
- Chat 图片输入支持相册/相机双入口，增加附件容量守卫与超限提示
- Chat 语音输入新增录音时长显示与转写状态提示
- Chat 会话分组升级为 Today / Yesterday / This Week / Last Week / This Month / 历史月份分组
- 会话列表新增每个会话消息数与图片数统计，便于快速定位上下文
- Chat 图片上传改为单通道传输（默认 attachments），并在网关不兼容时自动回退 legacy `image_url`，减少重复 payload

## 性能与内存治理记录

- 为日志、指标、消息引入 ring buffer 限制，防止无上限增长
- 使用 `FlatList` 虚拟化列表渲染，降低长列表开销
- 聊天流式 token 合并（50ms 批刷新），减少高频 setState
- Tab 启用 `freezeOnBlur`，高开销页面开启 `unmountOnBlur`
- 所有 WS/SSE 在卸载时关闭连接并清理回调，避免泄露
- 前后台切换时暂停无意义刷新，恢复后按需拉取

## 安全变更记录

- Token 仅进入 `SecureStore`，MMKV 不落明文 token
- 高危动作统一生物认证门禁
- API 响应均经过 Zod 校验后落库/渲染

## 已知限制（待后续迭代）

- Monitor 指标图目前以文本/条形为主，可升级为更细实时曲线
- Chat 语音输入目前默认走网关转写接口，离线语音转写仍待补充

## 下阶段计划

1. 完成 Skill 安装双确认 UI 与扫描报告呈现
2. 打磨 Chat 上下文 token 统计、模型切换与消息搜索
3. 增强 Monitor 可观测性（时间窗、聚合统计、导出）
