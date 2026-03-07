import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

import wsModule from 'ws';

const WebSocketServer = wsModule.WebSocketServer ?? wsModule.Server;

const HOST = '127.0.0.1';
const API_PORT = 18789;
const PROBE_PORT = 9100;
const DEBUG_TOKEN = 'ocg_debug_token__never_real__ip_999_999_999_999__for_bug_repro_only';
const STARTED_AT = Date.now() - 5 * 24 * 60 * 60 * 1000 - 14 * 60 * 60 * 1000 - 27 * 60 * 1000;

const nowIso = () => new Date().toISOString();

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const state = {
  agents: [
    {
      id: 'agent_codex_ops',
      name: 'Codex Ops',
      model: 'gpt-5.3-codex',
      status: 'active',
      lastActiveAt: hoursAgo(0.3),
      conversationCount: 18,
    },
    {
      id: 'agent_release_watch',
      name: 'Release Watch',
      model: 'gpt-5-mini',
      status: 'idle',
      lastActiveAt: hoursAgo(1.2),
      conversationCount: 42,
    },
    {
      id: 'agent_growth_brief',
      name: 'Growth Brief',
      model: 'gpt-4.1',
      status: 'error',
      lastActiveAt: hoursAgo(2.1),
      conversationCount: 7,
    },
  ],
  skills: [
    {
      name: 'openai-docs',
      version: 'bundled',
      description: 'Official OpenAI docs lookup.',
      installedAt: daysAgo(12),
      trusted: true,
    },
    {
      name: 'playwright',
      version: 'workspace',
      description: 'Browser automation and UI verification.',
      installedAt: daysAgo(9),
      trusted: true,
    },
    {
      name: 'screenshot',
      version: 'workspace',
      description: 'OS-level screenshot capture.',
      installedAt: daysAgo(5),
      trusted: true,
    },
  ],
  channels: [
    {
      id: 'slack',
      name: 'Slack',
      status: 'healthy',
      sessionCount: 12,
      lastEventAt: hoursAgo(0.2),
      description: 'Team inbox flowing normally.',
    },
    {
      id: 'discord',
      name: 'Discord',
      status: 'degraded',
      sessionCount: 5,
      lastEventAt: hoursAgo(0.7),
      description: 'Gateway retrying after one transient 429 burst.',
    },
    {
      id: 'mail',
      name: 'Email',
      status: 'offline',
      sessionCount: 0,
      lastEventAt: hoursAgo(3.5),
      description: 'SMTP worker paused for maintenance.',
    },
  ],
  sessions: [
    {
      id: 'sess_launch_plan',
      title: 'Launch Plan',
      agentId: 'agent_growth_brief',
      channelId: 'slack',
      model: 'gpt-4.1',
      status: 'active',
      updatedAt: hoursAgo(0.15),
      messageCount: 14,
      contextTokens: 18240,
      contextCount: 18240,
    },
    {
      id: 'sess_incident',
      title: 'Incident Triage',
      agentId: 'agent_codex_ops',
      channelId: 'discord',
      model: 'gpt-5.3-codex',
      status: 'active',
      updatedAt: hoursAgo(0.8),
      messageCount: 22,
      contextTokens: 28410,
      contextCount: 28410,
    },
    {
      id: 'sess_daily_summary',
      title: 'Daily Summary',
      agentId: 'agent_release_watch',
      channelId: 'mail',
      model: 'gpt-5-mini',
      status: 'idle',
      updatedAt: hoursAgo(5.2),
      messageCount: 9,
      contextTokens: 9620,
      contextCount: 9620,
    },
  ],
  messagesBySession: {
    sess_launch_plan: [
      {
        id: id('msg'),
        sessionId: 'sess_launch_plan',
        role: 'user',
        content: '给我一个适合小红书发布的 ClawLink 产品定位文案，重点突出远程控制、状态总览和聊天工作流。',
        createdAt: hoursAgo(0.5),
      },
      {
        id: id('msg'),
        sessionId: 'sess_launch_plan',
        role: 'assistant',
        content:
          '可以走“把 OpenClaw Gateway 装进口袋”这个角度：一句话讲远程控制，第二屏讲 Dashboard + Monitor，第三屏用 Chat 展示从告警到处理闭环。',
        createdAt: hoursAgo(0.48),
        model: 'gpt-4.1',
      },
      {
        id: id('msg'),
        sessionId: 'sess_launch_plan',
        role: 'user',
        content: '再给我 3 个封面标题，语气克制一点，不要太像广告。',
        createdAt: hoursAgo(0.18),
      },
      {
        id: id('msg'),
        sessionId: 'sess_launch_plan',
        role: 'assistant',
        content:
          '1. ClawLink，把 OpenClaw Gateway 带到手机上\n2. 不打开电脑，也能看住你的 Gateway\n3. 从状态面板到对话控制，一部手机处理日常运维',
        createdAt: hoursAgo(0.16),
        model: 'gpt-4.1',
      },
    ],
    sess_incident: [
      {
        id: id('msg'),
        sessionId: 'sess_incident',
        role: 'user',
        content: 'Monitor 刚收到 Discord 渠道 429，先帮我判断要不要立即重启。',
        createdAt: hoursAgo(1.1),
      },
      {
        id: id('msg'),
        sessionId: 'sess_incident',
        role: 'assistant',
        content:
          '先不要重启。429 更像上游限流，优先看重试队列和最近 5 分钟请求峰值；如果错误持续 10 分钟以上，再考虑重启该 agent。',
        createdAt: hoursAgo(1.05),
        model: 'gpt-5.3-codex',
      },
      {
        id: id('msg'),
        sessionId: 'sess_incident',
        role: 'assistant',
        content:
          '我已经把排查步骤拆成三项：检查限流窗口、验证 webhook 回执、必要时切换备份 channel。',
        createdAt: hoursAgo(1.02),
        model: 'gpt-5.3-codex',
      },
    ],
    sess_daily_summary: [
      {
        id: id('msg'),
        sessionId: 'sess_daily_summary',
        role: 'assistant',
        content: '今日汇总：请求 982 次，异常 agent 1 个，估算成本 $13.72。',
        createdAt: hoursAgo(5.2),
        model: 'gpt-5-mini',
      },
    ],
  },
  logs: [],
  requestPoints24h: [],
  requestPoints7d: [],
  costHistory: [],
};

function initMetrics() {
  const now = Date.now();

  state.requestPoints24h = Array.from({ length: 24 }, (_, index) => {
    const hour = 23 - index;
    const timestamp = new Date(now - hour * 60 * 60 * 1000);
    const base = [18, 22, 19, 17, 21, 28, 35, 41, 57, 63, 70, 76, 84, 92, 88, 79, 68, 61, 56, 54, 48, 44, 39, 33][
      index
    ];
    return {
      timestamp: timestamp.toISOString(),
      count: base,
    };
  });

  state.requestPoints7d = Array.from({ length: 7 * 24 }, (_, index) => {
    const hour = 7 * 24 - 1 - index;
    const timestamp = new Date(now - hour * 60 * 60 * 1000);
    const base = 14 + ((index * 17) % 61) + (index % 24 >= 9 && index % 24 <= 18 ? 18 : 0);
    return {
      timestamp: timestamp.toISOString(),
      count: base,
    };
  });

  state.costHistory = Array.from({ length: 30 }, (_, index) => {
    const day = 29 - index;
    const date = new Date(now - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return {
      date,
      tokens: 1_100_000 + index * 28_500,
      cost: Number((7.9 + index * 0.19).toFixed(2)),
      requests: 680 + index * 9,
      updatedAt: now,
    };
  });

  const templates = [
    ['INFO', 'gateway', 'Gateway heartbeat OK; latency 412ms'],
    ['DEBUG', 'probe', 'metrics stream sample cpu=31 mem=58 up=4.2 down=8.1'],
    ['INFO', 'agent_codex_ops', 'agent handled incident triage follow-up'],
    ['WARN', 'discord', 'rate limit bucket at 82%, backing off'],
    ['INFO', 'dashboard', 'surface snapshot published to widgets'],
    ['ERROR', 'agent_growth_brief', 'brief generation failed once, retry queued'],
  ];

  state.logs = Array.from({ length: 80 }, (_, index) => {
    const [level, scope, message] = templates[index % templates.length];
    return JSON.stringify({
      timestamp: new Date(now - (80 - index) * 45_000).toISOString(),
      level,
      message: `[${scope}] ${message}`,
    });
  });
}

initMetrics();

function isAuthorized(req) {
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${DEBUG_TOKEN}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendUnauthorized(res) {
  sendJson(res, 401, {
    error: 'unauthorized',
    message: 'Missing or invalid bearer token.',
    statusCode: 401,
  });
}

function sendNotFound(res) {
  sendJson(res, 404, {
    error: 'not_found',
    message: 'Endpoint not found.',
    statusCode: 404,
  });
}

function summarizeRequests(points) {
  return points.reduce((sum, item) => sum + item.count, 0);
}

function latestHashForSession(sessionId) {
  const messages = state.messagesBySession[sessionId] ?? [];
  const last = messages[messages.length - 1];
  return last ? `${last.id}:${last.createdAt}` : `${sessionId}:empty`;
}

function pushLog(level, scope, message) {
  state.logs.push(
    JSON.stringify({
      timestamp: nowIso(),
      level,
      message: `[${scope}] ${message}`,
    }),
  );
  state.logs = state.logs.slice(-400);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function buildAssistantReply(prompt, sessionId) {
  const title = state.sessions.find((item) => item.id === sessionId)?.title ?? '当前会话';
  return [
    `已收到，${title} 这条我建议这样处理：`,
    '1. 先确认当前 Gateway 在线、请求量和异常 Agent 数。',
    '2. 如果要发对外内容，重点写“远程控制 + 状态面板 + 对话闭环”。',
    `3. 你刚才这句“${prompt.slice(0, 24)}${prompt.length > 24 ? '…' : ''}”更适合压成三屏图文。`,
  ].join('\n');
}

function writeSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function handleStream(req, res, body) {
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : state.sessions[0].id;
  const agentId = typeof body.agentId === 'string' && body.agentId ? body.agentId : state.sessions[0].agentId;
  const inputMessage = Array.isArray(body.messages)
    ? body.messages.find((item) => item && item.role === 'user')
    : null;
  const prompt =
    typeof inputMessage?.content === 'string'
      ? inputMessage.content
      : Array.isArray(inputMessage?.content)
        ? '请帮我整理这组素材'
        : '继续';
  const reply = buildAssistantReply(prompt, sessionId);
  const userMessage = {
    id: id('msg'),
    sessionId,
    role: 'user',
    content: prompt,
    createdAt: nowIso(),
  };
  const assistantMessage = {
    id: id('msg'),
    sessionId,
    role: 'assistant',
    content: reply,
    createdAt: new Date(Date.now() + 1200).toISOString(),
    model: typeof body.model === 'string' && body.model ? body.model : 'gpt-5.3-codex',
  };

  const messages = state.messagesBySession[sessionId] ?? [];
  messages.push(userMessage);
  state.messagesBySession[sessionId] = messages;

  const session = state.sessions.find((item) => item.id === sessionId);
  if (session) {
    session.updatedAt = nowIso();
    session.messageCount += 2;
    session.contextTokens += 1600;
    session.contextCount = session.contextTokens;
    session.agentId = agentId ?? session.agentId;
  }

  pushLog('INFO', agentId ?? 'chat', `stream started for ${sessionId}`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const chunks = [
    '已收到，',
    '我建议把这组内容拆成三屏：',
    '封面讲“把 Gateway 装进口袋”，',
    '第二屏给 Dashboard/Monitor，',
    '第三屏放 Chat 的真实工作流。',
  ];

  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length) {
      writeSse(res, { delta: chunks[index] });
      index += 1;
      return;
    }

    clearInterval(timer);
    state.messagesBySession[sessionId].push(assistantMessage);
    pushLog('INFO', agentId ?? 'chat', `stream completed for ${sessionId}`);
    writeSse(res, {
      usage: {
        promptTokens: 221,
        completionTokens: 143,
        totalTokens: 364,
      },
    });
    writeSse(res, { done: true });
    res.write('data: [DONE]\n\n');
    res.end();
  }, 220);

  req.on('close', () => {
    clearInterval(timer);
  });
}

const apiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${API_PORT}`}`);
  const pathname = url.pathname;

  if (!isAuthorized(req)) {
    sendUnauthorized(res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      version: 'openclaw-gateway-demo',
      timestamp: nowIso(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/devices') {
    sendJson(res, 200, {
      devices: [
        {
          id: 'iphone-demo',
          name: 'ClawLink Demo Simulator',
          type: 'ios-simulator',
          status: 'online',
          lastSeenAt: nowIso(),
        },
      ],
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stats/requests') {
    const period = url.searchParams.get('period') ?? '24h';
    const points = period === '7d' ? state.requestPoints7d : state.requestPoints24h;
    sendJson(res, 200, {
      period,
      total: summarizeRequests(points),
      trend: {
        direction: 'up',
        percentage: 12.4,
      },
      points,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stats/tokens') {
    sendJson(res, 200, {
      total: 2_184_304,
      byModel: [
        { model: 'gpt-5.3-codex', tokens: 1_582_200 },
        { model: 'gpt-5-mini', tokens: 382_004 },
        { model: 'gpt-4.1', tokens: 220_100 },
      ],
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stats/latency') {
    sendJson(res, 200, {
      unit: 'ms',
      p50: 420,
      p95: 1040,
      p99: 1910,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stats/cost-history') {
    const days = Math.max(1, Math.min(120, Number(url.searchParams.get('days') ?? '30')));
    sendJson(res, 200, state.costHistory.slice(-days));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/agents') {
    sendJson(res, 200, {
      agents: state.agents,
    });
    return;
  }

  if (req.method === 'GET' && /^\/api\/agents\/[^/]+\/logs$/.test(pathname)) {
    const agentId = decodeURIComponent(pathname.split('/')[3] ?? '');
    const scoped = state.logs
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed.message?.toLowerCase().includes(agentId.toLowerCase()) ? line : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    sendJson(res, 200, {
      agentId,
      logs: scoped.length > 0 ? scoped.slice(-100) : state.logs.slice(-24),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/agents') {
    const body = await readBody(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `Agent ${state.agents.length + 1}`;
    const next = {
      id: id('agent'),
      name,
      model: typeof body.model === 'string' && body.model ? body.model : 'gpt-5-mini',
      status: 'idle',
      lastActiveAt: nowIso(),
      conversationCount: 0,
    };
    state.agents.unshift(next);
    pushLog('INFO', next.id, `created agent ${name}`);
    sendJson(res, 200, {
      success: true,
      message: 'Agent created successfully.',
      agent: next,
    });
    return;
  }

  if (req.method === 'POST' && /^\/api\/agents\/[^/]+\/(restart|enable|disable|kill)$/.test(pathname)) {
    const [, , , agentId, action] = pathname.split('/');
    const target = state.agents.find((item) => item.id === decodeURIComponent(agentId));
    if (target) {
      if (action === 'enable') {
        target.status = 'idle';
      } else if (action === 'disable') {
        target.status = 'disabled';
      } else if (action === 'kill') {
        target.status = 'error';
      } else {
        target.status = 'active';
      }
      target.lastActiveAt = nowIso();
      pushLog('WARN', target.id, `${action} issued from mobile console`);
    }
    sendJson(res, 200, {
      success: true,
      message: `${action} queued`,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/skills') {
    sendJson(res, 200, {
      skills: state.skills,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/skills/install') {
    const body = await readBody(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'unknown-skill';
    state.skills.unshift({
      name,
      version: typeof body.version === 'string' && body.version ? body.version : 'workspace',
      description: 'Installed from demo gateway.',
      installedAt: nowIso(),
      trusted: true,
    });
    sendJson(res, 200, {
      success: true,
      message: `Installed ${name}.`,
    });
    return;
  }

  if (req.method === 'POST' && /^\/api\/skills\/[^/]+\/uninstall$/.test(pathname)) {
    const name = decodeURIComponent(pathname.split('/')[3] ?? '');
    state.skills = state.skills.filter((item) => item.name !== name);
    sendJson(res, 200, {
      success: true,
      message: `Removed ${name}.`,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/channels') {
    sendJson(res, 200, {
      channels: state.channels,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    sendJson(res, 200, {
      sessions: state.sessions,
    });
    return;
  }

  if (req.method === 'GET' && /^\/api\/sessions\/[^/]+\/messages$/.test(pathname)) {
    const sessionId = decodeURIComponent(pathname.split('/')[3] ?? '');
    sendJson(res, 200, {
      sessionId,
      messages: state.messagesBySession[sessionId] ?? [],
    });
    return;
  }

  if (req.method === 'GET' && /^\/api\/sessions\/[^/]+\/last-hash$/.test(pathname)) {
    const sessionId = decodeURIComponent(pathname.split('/')[3] ?? '');
    sendJson(res, 200, {
      sessionId,
      hash: latestHashForSession(sessionId),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/sessions/purge') {
    pushLog('WARN', 'sessions', 'session purge simulated');
    sendJson(res, 200, {
      success: true,
      message: 'All sessions purged.',
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/usage') {
    sendJson(res, 200, {
      providers: [
        {
          id: 'openai:monthly',
          name: 'OpenAI',
          plan: 'Production',
          period: 'Monthly',
          remainingPercent: 61,
          resetAt: daysAgo(-5),
          used: 39,
          limit: 100,
        },
        {
          id: 'anthropic:weekly',
          name: 'Anthropic',
          plan: 'Team',
          period: 'Weekly',
          remainingPercent: 74,
          resetAt: daysAgo(-2),
          used: 26,
          limit: 100,
        },
      ],
      fetchedAt: nowIso(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/models') {
    sendJson(res, 200, {
      models: [
        {
          id: 'gpt-5.3-codex',
          name: 'GPT-5.3 Codex',
          provider: 'OpenAI',
          supportsReasoning: true,
          reasoningOptions: ['minimal', 'low', 'medium', 'high'],
          contextWindow: 128000,
          maxContextTokens: 128000,
        },
        {
          id: 'gpt-5-mini',
          name: 'GPT-5 mini',
          provider: 'OpenAI',
          supportsReasoning: true,
          reasoningOptions: ['low', 'medium', 'high'],
          contextWindow: 128000,
          maxContextTokens: 128000,
        },
        {
          id: 'gpt-4.1',
          name: 'GPT-4.1',
          provider: 'OpenAI',
          supportsReasoning: false,
          reasoningOptions: [],
          contextWindow: 128000,
          maxContextTokens: 128000,
        },
      ],
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/system/restart') {
    pushLog('WARN', 'gateway', 'restart simulated from monitor');
    sendJson(res, 200, {
      success: true,
      message: 'Gateway restart queued.',
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat/completions') {
    const body = await readBody(req);
    handleStream(req, res, body);
    return;
  }

  sendNotFound(res);
});

const gatewayWsServer = new WebSocketServer({ noServer: true });

function wsResponse(ws, id, payload, ok = true) {
  ws.send(
    JSON.stringify({
      type: 'res',
      id,
      ok,
      payload,
      ...(ok ? {} : { error: { code: 'bad_request', message: String(payload?.message ?? payload ?? 'request failed') } }),
    }),
  );
}

function buildHealthWsPayload() {
  return {
    ok: true,
    ts: nowIso(),
    durationMs: 412,
    channels: {
      slack: { running: true, configured: true, sessionCount: 12, lastConnectedAt: hoursAgo(0.2) },
      discord: { running: false, configured: true, sessionCount: 5, lastProbeAt: hoursAgo(0.5), lastError: 'HTTP 429 retrying' },
      mail: { running: false, configured: false, sessionCount: 0 },
    },
    sessions: {
      count: state.sessions.length,
    },
  };
}

gatewayWsServer.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      type: 'event',
      event: 'connect.challenge',
      payload: {
        protocol: 3,
      },
    }),
  );

  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (frame.type !== 'req' || typeof frame.id !== 'string') {
      return;
    }

    if (frame.method === 'connect') {
      wsResponse(ws, frame.id, {
        connected: true,
        role: 'operator',
      });
      return;
    }

    if (frame.method === 'logs.tail') {
      wsResponse(ws, frame.id, {
        cursor: state.logs.length,
        lines: state.logs.slice(-80),
      });
      return;
    }

    if (frame.method === 'health') {
      wsResponse(ws, frame.id, buildHealthWsPayload());
      return;
    }

    if (frame.method === 'agents.list') {
      wsResponse(ws, frame.id, {
        agents: state.agents,
      });
      return;
    }

    if (frame.method === 'sessions.list') {
      wsResponse(ws, frame.id, {
        sessions: state.sessions,
      });
      return;
    }

    if (frame.method === 'channels.status') {
      wsResponse(ws, frame.id, {
        channelOrder: state.channels.map((item) => item.id),
        channelLabels: Object.fromEntries(state.channels.map((item) => [item.id, item.name])),
        channels: {
          slack: { running: true, configured: true, sessionCount: 12, lastConnectedAt: hoursAgo(0.2) },
          discord: { running: false, configured: true, sessionCount: 5, lastProbeAt: hoursAgo(0.5), lastError: 'HTTP 429 retrying' },
          mail: { running: false, configured: false, sessionCount: 0 },
        },
      });
      return;
    }

    if (frame.method === 'usage.status') {
      wsResponse(ws, frame.id, {
        providers: [
          {
            provider: 'openai',
            displayName: 'OpenAI',
            plan: 'Production',
            windows: [
              {
                label: 'Monthly',
                usedPercent: 39,
                resetAt: daysAgo(-5),
              },
            ],
          },
        ],
      });
      return;
    }

    if (frame.method === 'models.list') {
      wsResponse(ws, frame.id, {
        models: [
          { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', provider: 'OpenAI', reasoning: true, contextWindow: 128000 },
          { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', reasoning: true, contextWindow: 128000 },
          { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', reasoning: false, contextWindow: 128000 },
        ],
      });
      return;
    }

    wsResponse(ws, frame.id, { message: `Unsupported method ${frame.method}` }, false);
  });
});

apiServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/') {
    socket.destroy();
    return;
  }

  gatewayWsServer.handleUpgrade(req, socket, head, (ws) => {
    gatewayWsServer.emit('connection', ws, req);
  });
});

const probeServer = http.createServer();
const probeWsServer = new WebSocketServer({ noServer: true });

probeWsServer.on('connection', (ws) => {
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const payload = {
      timestamp: nowIso(),
      cpuPercent: 28 + (tick % 7) * 4,
      memPercent: 54 + (tick % 5) * 3,
      diskIo: 14 + (tick % 4) * 6,
      gpuTemp: 64 + (tick % 6),
      netIo: {
        up: 2.4 + (tick % 5) * 0.7,
        down: 5.8 + (tick % 6) * 0.9,
      },
    };
    ws.send(JSON.stringify(payload));
  }, 900);

  ws.on('close', () => {
    clearInterval(timer);
  });
});

probeServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/metrics/stream') {
    socket.destroy();
    return;
  }

  probeWsServer.handleUpgrade(req, socket, head, (ws) => {
    probeWsServer.emit('connection', ws, req);
  });
});

apiServer.listen(API_PORT, HOST, () => {
  console.log(`mock-gateway http/ws listening on http://${HOST}:${API_PORT}`);
  console.log(`accepted bearer token: ${DEBUG_TOKEN}`);
});

probeServer.listen(PROBE_PORT, HOST, () => {
  console.log(`mock-probe ws listening on ws://${HOST}:${PROBE_PORT}/metrics/stream`);
});
