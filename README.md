# ClawLink

ClawLink 是一个面向 OpenClaw Gateway 的移动遥控器，主战场是 iOS。它不在手机本地运行模型，而是负责连接网关、远程控制 Agent、查看状态、处理告警，并把关键状态同步到 iPhone 的系统级入口。

仓库目录目前仍叫 `ClawChat`，但产品名、URL Scheme、iOS target 和原生扩展都已经统一到 `ClawLink`。

## 这不是一个什么项目

- 不是本地模型运行容器
- 不是 OpenClaw Gateway 服务端
- 不是纯 WebView 壳子
- 不是只有 4 个 Expo 页面的小 demo

这是一个包含 Expo 应用层、状态聚合层、通知链路、Shortcuts / App Intents、WidgetKit / ActivityKit 和原生桥接的移动遥控端。

## 当前产品范围

### 1. 首次启动与连接

- 首次进入先走权限引导，再进入连接页
- 权限页会请求 Camera / Photos / Microphone，并在 iOS 上做本地网络权限预触发
- 实际路由门禁当前以 Camera + Microphone 为必需，Photos 用于发图但不是强制条件
- 连接页支持手填 Host / Port / Token / TLS / Profile Name
- 支持三类快速导入：
  - 粘贴终端输出的 `Gateway Host / Port / API Token`
  - `clawlink://connect?...` 深链
  - JSON / URL 导入
- 连接握手会验证 `/api/health` 和 `/api/devices`
- 网络失败时会尝试协议修正和 WebSocket 兜底，减少“明明网关活着但连不上”的假阴性
- 可保存最多 5 个用户可见网关 profile，并支持随时切换

### 2. Dashboard

- 展示网关健康、在线状态、请求量、Token 用量、估算成本
- 支持 24h 请求量、模型 Token 分布、延迟信息、Session / Channel 概览
- 支持 30s / 60s / 5min / Manual 刷新策略
- 带多网关后台健康状态条，便于同时看本地网关和远端节点
- 显示 Token 过期提醒、是否支持自动续期
- 首页卡片顺序可在 Settings 中重排
- 顶部成本卡和部分历史成本在网关缺字段时会回退到本地价格表估算，不应被当作账单级精度

### 3. Agents & Skills

- 查看 Agent 列表、状态、模型、最近活动
- 创建 Agent
- 启用 / 禁用 / 重启 / Kill Agent
- 查看最近 100 行 Agent 日志
- Skill 安装不是直接一键下发，而是完整安全流：
  - 拉取 metadata
  - 收集关联文件
  - 规则扫描
  - 生成 Security Report
  - 人工批准
  - 生物认证后执行安装
- 支持卸载 Skill，并把高风险操作写入本地审计日志
- 当前扫描流程是有边界的：
  - 只跟随安全 HTTPS 引用
  - 会阻断私网 / 本地地址
  - 扫描文件数量和单文件大小都有上限

### 4. Monitor

- 通过 WebSocket 订阅网关日志流
- 通过 probe WebSocket 订阅主机指标流
- 支持日志过滤、暂停、清空、自动滚动
- 展示 CPU / Memory / Network 等时序趋势
- 提供紧急操作：
  - Restart Gateway
  - Purge Sessions
  - Kill Agent by ID
- 危险操作统一走生物认证
- 完整主机指标依赖额外 probe，默认路径是 `ws(s)://<host>:9100/metrics/stream`
- 没有 probe 时，Monitor 会退化为日志流和有限的 gateway telemetry

### 5. Chat

- 多 Agent、多 Session 聊天
- SSE 流式为主，必要时走 WebSocket 回退
- 支持 Markdown 渲染和代码块高亮
- 支持 reasoning effort 选择
- 支持图片输入：
  - 相册
  - 相机
  - 最多 3 个附件
- 支持语音输入与转写
- 支持消息搜索、Session 导出、本地会话分组
- 断网时消息先进本地持久化队列，恢复后自动 flush
- 通过 `last-hash` 与增量拉取机制做重连对账
- 失败消息可重试，队列状态会反映到系统表面和通知
- 当前聊天缓存与队列也有明确上限：
  - 最多保留 40 个 session
  - 每个 session 最多保留 500 条本地消息
  - 最多保留 100 条待发送消息
- 搜索、导出和 `Clear Context` 面向的是本地已加载消息，不是远端完整历史
- 本地语音转写回退目前是 iOS 优先路径

### 6. Settings、诊断与审计

- 中英文切换
- 主题模式与强调色切换
- Dashboard 板块排序
- 网关切换与管理入口
- Live Activity / Dynamic Island / Widget 开关和手动刷新
- Health Bridge 入口
- 诊断快照导出
  - 会脱敏 token 样式字段
  - 会遮罩 profile / agent / session 标识
  - 仍然包含本地状态与审计信息，分享前应自行复核
- 本地审计日志查看与清空
- 版本 / 构建 / runtime 信息展示

### 7. iOS 系统表面

系统表面不是独立拼出来的几块 UI，而是消费同一份聚合 snapshot：

- Live Activity
- Dynamic Island
- Status Widget
- Cost Widget
- Multi-Gateway Widget
- 本地告警通知
- Spotlight 索引
- App Intents / Shortcuts 读取状态

当前 snapshot 已覆盖：

- 连接状态
- 活跃 Session / Channel 数
- Pending Queue / Pending Messages
- 断连起始时间
- 活跃 Agent 与任务摘要
- 今日 / 昨日成本
- 今日请求数
- 今日 Token 用量
- 异常 Agent 数

同时已经接通：

- Focus Filter 策略
- 本地告警去重
- 深链跳转 `chat` / `monitor` / `agents` / `dashboard`
- 后台 surface refresh
- App Group 共享状态

### 8. Shortcuts / App Intents

当前原生侧已经定义了这些快捷指令入口：

- 查询当前网关状态
- 重启指定 Agent
- 向指定 Agent 发送消息

其中：

- `Gateway Status` 是已接通的状态读取链路
- `Restart Agent` / `Send Message` 已经落到原生 App Intent 层，但当前仓库里的 React Native 消费路径还需要继续对齐，不应当把它们当成已经完成真机闭环验证的生产能力

整体设计仍然是把命令写入 App Group，再由 App 消费并执行，避免系统入口和应用内状态出现两套实现。

### 9. Health Bridge（M1）

Health Bridge 目前是 M1 阶段：

- 有独立设置页
- 可请求 HealthKit 读取权限
- 可按指标单独开关
- 支持读取 / 预览摘要
- 支持本地 mock 载荷预览

当前范围仍然是“本地权限流 + 预览 + 桥接准备”，还不是持续后台同步到 Gateway 的完整版本。

## 技术栈

- Expo 55
- React Native 0.83
- React 19
- `expo-router`
- TypeScript strict
- Zustand + MMKV
- `expo-secure-store`
- Axios
- WebSocket
- SSE
- Zod
- `expo-notifications`
- `expo-background-fetch`
- `expo-audio`
- `expo-local-authentication`
- `expo-sharing`

iOS 原生部分包含：

- Swift 原生桥 `ClawSurfaceBridge`
- WidgetKit
- ActivityKit
- App Intents / App Shortcuts
- Core Spotlight
- HealthKit 读取桥接

## 仓库结构

```text
.
├── app/                      Expo Router 页面入口
├── src/
│   ├── components/           通用 UI 组件
│   ├── constants/            存储键等常量
│   ├── features/             按业务域拆分
│   │   ├── agents/
│   │   ├── chat/
│   │   ├── connection/
│   │   ├── dashboard/
│   │   ├── health-bridge/
│   │   ├── monitor/
│   │   ├── notifications/
│   │   ├── onboarding/
│   │   ├── settings/
│   │   └── system-surfaces/
│   ├── lib/                  API、schema、安全、存储、工具
│   └── theme/                自适应主题
├── ios/
│   ├── ClawLink/             App target 与原生桥接
│   └── ClawLinkWidgets/      Widget / Live Activity 扩展
├── docs/                     手册、开发日志、iOS 数据面文档
├── scripts/                  lint / test / patch 脚本
└── README.md
```

## 开发环境

建议按下面的假设启动：

- Node.js 20+
- npm 10+
- Xcode 16+ 和 iOS Simulator
- CocoaPods
- 一台可访问 OpenClaw Gateway 的真机或模拟器

如果你要验证以下能力，基本都应优先使用真机：

- Live Activity
- Dynamic Island
- Widget
- Push / 本地通知交互
- HealthKit
- App Intents / Shortcuts

当前 iOS 版本门槛也要看清楚：

- App target: iOS 15.1+
- Widget / Live Activity extension: iOS 16.1+
- App Intents / Focus Filter: iOS 16+
- iOS 18 control widget 路径只在 iOS 18+ 生效

如果你要 fork 或重命名这个项目，不能只改显示名称，还要同步检查这些原生常量和签名项是否一致：

- bundle identifier
- widget bundle identifier
- App Group（当前为 `group.com.fadmediagroup.clawlink`）
- entitlements
- Xcode project 中的 deployment target 和签名配置

## 快速开始

### 1. 安装依赖

```bash
npm install
```

`postinstall` 会自动运行 `scripts/apply-local-patches.mjs`，对 `expo-notifications` 的 iOS 权限模块打一个本地补丁。这个步骤不是可选装饰，当前仓库依赖它保持通知权限返回结构稳定。

### 2. 安装 iOS Pods

```bash
cd ios
pod install
cd ..
```

### 3. 启动开发环境

```bash
npm run ios
```

或先起 Metro：

```bash
npm start
```

### 4. 连接网关

在 App 中完成：

1. 权限引导
2. 填写或导入网关连接信息
3. 保存 profile 并进入 Dashboard

LAN 场景请确保：

- 网关绑定的不是 `127.0.0.1`
- 手机和网关在同一网络，或通过 Tailscale / WireGuard 可达
- VPN / 代理没有劫持局域网流量

## 网关端能力假设

ClawLink 当前默认假设网关侧具备这些接口或等价能力：

- `GET /api/health`
- `GET /api/devices`
- `GET /api/stats/dashboard`
- `GET /api/stats/requests`
- `GET /api/stats/tokens`
- `GET /api/stats/latency`
- `GET /api/agents`
- `GET /api/skills`
- `GET /api/sessions`
- `GET /api/channels`
- `POST /api/agents/:id/restart`
- `POST /api/agents/:id/kill`
- `POST /api/system/restart`
- `POST /api/sessions/purge`

另外还依赖：

- 日志 WebSocket 流
- 会话消息同步能力
- Chat completion 流式能力
- 可选的主机指标 probe（默认端口 `9100`）
- 可选的 push token 注册接口；如果网关不支持，客户端会退回本地通知模式

## 常用脚本

```bash
npm start
npm run ios
npm run android
npm run lint
npm run test
npm run typecheck
npm run verify
```

含义：

- `lint`: 扫描 `console.log/debugger` 等明显脏点
- `test`: 编译并执行仓库内 `.test.ts`
- `typecheck`: TypeScript 无输出检查
- `verify`: `lint + test + typecheck`

## 安全与隐私

- Gateway token 只进 `SecureStore`，不落 MMKV 明文
- 危险操作统一走生物认证
- API 返回经 Zod 校验后再落状态
- 诊断导出会自动脱敏 token 样式内容
- 仓库当前未接第三方分析埋点

开发者还需要知道两件事：

- 连接层会注入一个隐藏调试 profile，用于稳定复现连接类问题；它不属于用户可见 profile 配额
- 通知、Widget、Live Activity、Shortcuts 和 Health Bridge 共用同一条系统快照链路，改任一处时要先看 `src/features/system-surfaces/`

## 当前限制

- iOS 系统表面是当前一等公民，Android / Web 没有同等完整度
- Health Bridge 还是 M1，不是持续健康数据同步产品
- Health Bridge 当前是 iOS-only、read-only、Settings-only 入口，没有上传或自动化同步链路
- Live Activity / Dynamic Island / HealthKit / Shortcuts 在模拟器上的验证价值有限
- Widget 需要用户至少手动添加到主屏幕一次，之后系统刷新才更稳定
- 多网关 Widget 最多展示 3 个可见 profile，而且新鲜度主要依赖前台轮询，不是完整后台采集
- Push 通知当前是 local-first；只有网关支持 `/api/devices/push-token` 时才会升级到远端注册
- 指标流依赖额外 probe；没启动 probe 时 Monitor 会退化为日志视图和基础控制
- 仓库里同时存在 Expo 层和原生 iOS 层，改配置时不能只改 `app.json`

## 参考文档

- `docs/MANUAL.md`: 面向使用者的操作手册
- `docs/WORKLOG.md`: 最近阶段的开发记录
- `docs/IOS_SURFACES.md`: Live Activity / Widget / Shortcuts 数据面说明
- `docs/APPLE_HEALTH_ACTIVITY_GATEWAY_PLAN.md`: Health Bridge 规划草案
