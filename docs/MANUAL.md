# ClawLink 使用说明书

## 1. 产品定位

ClawLink 是 OpenClaw Gateway 的远程控制面板，不在手机本地执行模型推理。

适用场景：

- 家庭/办公室 LAN 内部网关
- 自建 VPS 网关
- Tailscale/WireGuard 私网访问

## 2. 首次使用

### 2.1 权限引导

首次启动会先进入权限页，需允许：

- Camera
- Photos
- Microphone

允许后自动进入登录连接页。iOS 在首次连接局域网网关时还会弹出 Local Network 权限，请选择允许。

### 2.2 登录并连接网关

进入连接页后填写：

- Gateway Host：IP 或域名（不含 `http://`）
- Port：默认 `18789`（OpenClaw 默认网关端口）
- API Token：网关 Bearer Token
- TLS：开启为 `https`，关闭为 `http`

如果你不确定 Host / Port / Token，可在网关主机执行（macOS）：

```bash
HOST="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1)"; PORT="$(plutil -extract EnvironmentVariables.OPENCLAW_GATEWAY_PORT raw ~/Library/LaunchAgents/ai.openclaw.gateway.plist 2>/dev/null || echo 18789)"; TOKEN="$(plutil -extract EnvironmentVariables.OPENCLAW_GATEWAY_TOKEN raw ~/Library/LaunchAgents/ai.openclaw.gateway.plist 2>/dev/null || echo '<TOKEN_NOT_FOUND>')"; printf "Gateway Host: %s\nPort: %s\nAPI Token: %s\n" "$HOST" "$PORT" "$TOKEN"
```

Token 安全规则（必须遵守）：

- Token 等同于网关控制权限，视同密码
- 不要截图外传，不要发到群聊，不要提交到 Git
- 一旦泄露，立即在 OpenClaw 网关端轮换 Token

点击 `Login & Connect` 后会依次请求：

1. `GET /api/health`
2. `GET /api/devices`

连接成功后会保存 profile（最多 5 个）。

调试说明（内置隐藏调试用户）：

- App 会自动注入一个隐藏调试用户，默认不在 UI 展示
- 它不计入“最多 5 个 profile”限制，也不能被常规列表删除
- 仅用于 bug 复现与诊断导出，不用于真实网关连接
- 固定值为：
  - IP: `999.999.999.999`
  - Token: `ocg_debug_token__never_real__ip_999_999_999_999__for_bug_repro_only`

### 2.3 切换网关

路径：`Gateways`

- 可查看已保存 profile
- 可切换当前 active profile
- 可删除 profile（同时删除对应 token）

## 3. Dashboard

功能：

- 网关状态与在线时长
- 今日请求量 / Token 使用量 / 估算成本
- 24h 请求曲线、模型 token 分布、延迟 p50/p95/p99

刷新机制：

- 手动下拉刷新
- 自动刷新：30s / 60s / 5min / Manual

注意：

- 若网关暂时不可达，会显示最后一次可用快照

## 4. Agents & Skills

功能：

- 查看代理状态（active/idle/error/disabled）
- 启停代理
- 重启代理（生物认证）
- 强制 Kill 代理（生物认证）
- 查看最近日志
- Skill 安装安全报告（扫描流程 + 风险审阅 + 生物认证安装）

Skill 安装流程：

1. 输入 Skill 名称或 ClawHub URL
2. 执行安全扫描（metadata、关联文件抓取、规则扫描）
3. 在 Security Report 中审阅风险与上下文
4. 手动确认已审阅后再执行安装（生物认证）

建议：

- 只在代理卡死时使用 Kill
- 先看日志再操作重启/停止

## 5. Monitor

### 5.1 网关日志流

- 来源：`/api/logs/stream` WebSocket
- 支持过滤、暂停、清空、跳到底部
- 日志按级别高亮：DEBUG/INFO/WARN/ERROR

### 5.2 主机指标流

- 来源：`ws://host:<probe_port>/metrics/stream`
- 默认 probe 端口：`9100`
- 支持运行时修改端口

若提示 `System probe not detected`，请确认：

- 探针进程已在网关主机运行
- 端口可达
- 返回字段包含 CPU/MEM 指标

### 5.3 紧急控制

- Restart Gateway（生物认证）
- Clear All Sessions（生物认证）
- Kill Agent by ID（生物认证）

## 6. Chat

功能：

- 多代理聊天
- 多会话管理
- SSE 实时流式输出
- Markdown 渲染
- 图片输入（相册 / 相机）
- 语音输入（录音转写）
- 会话时间分组（Today/Yesterday/This Week/Last Week/This Month/历史月份）

离线与重连机制：

- 用户消息先本地持久化并进入 pending 队列
- 网络恢复后自动 flush
- 通过 `last-hash` 与服务端对账
- hash 不一致时补拉缺失消息
- 失败消息可手动 Retry

状态说明：

- `synced`：已与服务端一致
- `pending`：待发送
- `streaming`：正在接收流式内容
- `failed`：发送失败，可重试

## 7. 安全说明

- Token 不写入 MMKV，只存 SecureStore
- 危险操作必须通过系统生物认证
- 接口返回都经过 Zod 校验
- 应用不接入第三方分析服务
- 隐藏调试用户使用不可能 IP+Token 组合，专门用于调试链路，避免误连真实环境

## 8. 性能建议

- Monitor/Chat 不使用时切到其他 Tab（页面会卸载）
- 保持 probe 采样频率适中，避免高频消息风暴
- 遇到弱网时优先降低 Dashboard 自动刷新频率

## 9. 常见问题

### Q1: 连接成功后仍显示断连

- 检查网关是否允许移动端所在网段访问
- 检查 token 是否过期
- 检查 TLS 开关与网关部署协议是否匹配

### Q2: Chat 一直 pending

- 检查当前网关连接状态
- 检查 `/api/chat/completions` 是否支持 `stream: true`
- 查看 Monitor 的网关日志是否有报错

### Q3: 指标页无数据

- 多数是 probe 未启动或端口不匹配
- 确认字段名是否兼容（snake_case/camelCase）

## 10. 运维建议

- 给网关与探针配置反向代理或内网 ACL
- 定期轮换 API token
- 将高危控制权限限制在管理员设备
