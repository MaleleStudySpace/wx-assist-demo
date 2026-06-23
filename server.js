/**
 * wx-assist demo mock server.
 *
 * Serves the built frontend (dist/) and mocks all API endpoints + WebSocket
 * with realistic Chinese WeChat data. No real WeChat connection.
 *
 * Usage: node server.js [--port 7327]
 */

const express = require('express')
const { WebSocketServer } = require('ws')
const path = require('path')
const fs = require('fs')

// ── Config ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 7327
const MOCK_DIR = path.join(__dirname, 'mock')
const DIST_DIR = path.join(__dirname, 'dist')

// ── Load mock data ──────────────────────────────────────────────────
function loadMock(name) {
  const filePath = path.join(MOCK_DIR, `${name}.json`)
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (e) {
    console.warn(`Mock file not found: ${filePath}`)
    return null
  }
}

const mockData = {
  status: loadMock('status'),
  config: loadMock('config'),
  scheduledTasks: loadMock('scheduled-tasks'),
  chatSessions: loadMock('chat-sessions'),
  chatMessages: loadMock('chat-messages'),
  favorites: loadMock('favorites'),
  favTags: loadMock('fav-tags'),
  moments: loadMock('moments'),
  oaAccounts: loadMock('oa-accounts'),
  oaGroups: loadMock('oa-groups'),
  assistantConfig: loadMock('assistant-config'),
  notifications: loadMock('notifications'),
  logs: loadMock('logs'),
  nicknameGroups: loadMock('nickname-groups'),
  aiResponses: loadMock('ai-responses'),
}

// ── SVG placeholder ──────────────────────────────────────────────────
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect fill="#e8e8e8" width="200" height="200" rx="8"/>
  <text x="100" y="100" text-anchor="middle" dominant-baseline="central"
        font-family="sans-serif" font-size="16" fill="#777">[Demo]</text>
</svg>`

// ── Express app ──────────────────────────────────────────────────────
const app = express()
app.use(express.json())

// ── API routes ──────────────────────────────────────────────────────

// Helper: JSON response
function json(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.send(JSON.stringify(data))
}

function ok(res, data = {}) {
  json(res, { ok: true, ...data })
}

function okOnly(res) {
  json(res, { ok: true })
}

// ── Onboarding ──────────────────────────────────────────────────────
app.get('/api/onboarding/status', (req, res) => {
  json(res, { ok: true, onboarding_done: true, steps: { step1: true, step2: true, step3: true, step4: true } })
})
app.get('/api/onboarding/diagnose', (req, res) => {
  json(res, { ok: true, diagnostics: {
    python: { ok: true, value: 'Python 3.13.0', error: null, label: 'Python 版本' },
    requirements: { ok: true, value: '所有依赖已安装', missing: [], label: '依赖包' },
    wechat: { ok: true, value: '微信运行中 (PID 12345)', error: null, label: '微信进程' },
    env: { ok: true, value: '配置文件已存在', error: null, label: '配置文件' },
    db: { ok: true, value: '数据库读写权限正常', error: null, label: '数据库权限' },
  }})
})
app.post('/api/onboarding/step1', (req, res) => okOnly(res))
app.get('/api/onboarding/step1-status', (req, res) => {
  json(res, { running: false, phase: 'done', message: '密钥获取成功', result: { key: 'abc123...', wxid: 'wxid_demo', db_path: 'C:\\...' } })
})
app.post('/api/onboarding/step2', (req, res) => okOnly(res))
app.post('/api/onboarding/step3', (req, res) => okOnly(res))
app.post('/api/onboarding/step4', (req, res) => okOnly(res))
app.post('/api/onboarding/reset', (req, res) => okOnly(res))

// ── Bot control ──────────────────────────────────────────────────────
app.post('/api/start', (req, res) => ok(res, { already_running: true }))
app.post('/api/stop', (req, res) => okOnly(res))
app.get('/api/status', (req, res) => {
  const s = { ...mockData.status, uptime_sec: process.uptime() | 0, timestamp: new Date().toISOString() }
  json(res, s)
})

// ── Dashboard ────────────────────────────────────────────────────────
app.get('/api/scheduled-tasks', (req, res) => json(res, mockData.scheduledTasks))

// ── Config ────────────────────────────────────────────────────────────
app.get('/api/load-config', (req, res) => json(res, mockData.config))
app.post('/api/config', (req, res) => ok(res, { saved: [], requires_restart: true }))
app.get('/api/config/export', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="wx-assist-config-demo.json"')
  res.send(JSON.stringify(mockData.config.config))
})
app.post('/api/config/import', (req, res) => ok(res, { imported: [], requires_restart: true }))
app.post('/api/assistant/ai/detect', (req, res) => {
  json(res, { ok: true, provider_type: 'openai', available_models: ['deepseek-v4-flash', 'deepseek-chat'] })
})
app.post('/api/sandbox/test', (req, res) => {
  ok(res, { reply: '这是一条模拟回复。Demo 模式下 AI 不可用，但你可以体验完整的前端界面交互。' })
})
app.get('/api/browse', (req, res) => ok(res, { entries: [], current_path: 'C:\\' }))
app.post('/api/wechat-data-dir/detect', (req, res) => ok(res, { found: true, accounts: [{ wxid: 'wxid_demo', has_session_db: true }], message: '找到 1 个微信账号' }))

// ── iLink ──────────────────────────────────────────────────────────────
app.get('/api/ilink/status', (req, res) => ok(res, { bound: false }))
app.get('/api/ilink/qrcode', (req, res) => ok(res, { error: 'Demo 模式不支持 iLink 绑定' }))
app.get('/api/ilink/qrcode-status', (req, res) => json(res, { status: 'error', error: 'Demo' }))
app.post('/api/ilink/bind', (req, res) => ok(res, { error: 'Demo mode' }))
app.post('/api/ilink/unbind', (req, res) => okOnly(res))
app.post('/api/ilink/test-push', (req, res) => ok(res, { error: 'Demo mode' }))

// ── Chat ──────────────────────────────────────────────────────────────
app.get('/api/chat/sessions', (req, res) => {
  // Mock data already has the full structure: { ok, data, myWxid, oaSessions, foldedSessions }
  json(res, mockData.chatSessions)
})

app.get('/api/chat/messages', (req, res) => {
  const talker = req.query.talker || ''
  const msgs = mockData.chatMessages[talker] || []
  json(res, { ok: true, data: msgs, total: msgs.length, myWxid: 'wxid_demo_user' })
})

app.get('/api/chat/members', (req, res) => {
  json(res, { ok: true, data: [
    { wxid: 'wxid_abc123def456', display_name: '张伟', group_nickname: '', is_friend: true },
    { wxid: 'wxid_mno345pqr678', display_name: '王磊', group_nickname: '', is_friend: true },
    { wxid: 'wxid_ghi789jkl012', display_name: '李芳', group_nickname: '', is_friend: true },
  ], total: 3 })
})

app.get('/api/chat/common-groups', (req, res) => json(res, { ok: true, data: [], total: 0 }))
app.post('/api/chat/export', (req, res) => ok(res, { error: 'Demo 模式不支持导出' }))

// ── Favorites ──────────────────────────────────────────────────────────
app.get('/api/fav/list', (req, res) => json(res, mockData.favorites))
app.get('/api/fav/tags', (req, res) => json(res, mockData.favTags))
app.post('/api/fav/export', (req, res) => ok(res, { error: 'Demo 模式不支持导出' }))

// ── SNS / Moments ──────────────────────────────────────────────────────
app.get('/api/sns/timeline', (req, res) => json(res, mockData.moments))
app.get('/api/sns/search', (req, res) => json(res, mockData.moments))
app.get('/api/sns/protect/status', (req, res) => ok(res, { installed: false }))
app.post('/api/sns/protect/install', (req, res) => ok(res, { error: 'Demo mode' }))
app.post('/api/sns/protect/uninstall', (req, res) => okOnly(res))
app.post('/api/sns/export', (req, res) => ok(res, { error: 'Demo 模式不支持导出' }))

// ── OA ──────────────────────────────────────────────────────────────────
app.get('/api/oa/accounts', (req, res) => json(res, mockData.oaAccounts))
app.get('/api/oa/groups', (req, res) => json(res, mockData.oaGroups))
app.post('/api/oa/groups/create', (req, res) => ok(res, { data: { id: 'demo-new-group' } }))
app.put('/api/oa/groups/:id', (req, res) => okOnly(res))
app.delete('/api/oa/groups/:id', (req, res) => okOnly(res))
app.post('/api/oa/digest/run/:id', (req, res) => ok(res, { message: '已触发摘要生成', articles_count: 5 }))
app.get('/api/oa/search', (req, res) => json(res, { ok: true, data: [], total: 0 }))
app.get('/api/oa/articles', (req, res) => json(res, { ok: true, data: [], total: 0 }))

// ── Assistant ──────────────────────────────────────────────────────────
app.get('/api/assistant/config', (req, res) => json(res, mockData.assistantConfig))
app.post('/api/assistant/config', (req, res) => okOnly(res))
app.put('/api/assistant/config', (req, res) => okOnly(res))
app.get('/api/assistant/notifications', (req, res) => json(res, mockData.notifications))
app.post('/api/assistant/notifications/test', (req, res) => ok(res, { id: 99 }))
app.post('/api/assistant/notifications/pending', (req, res) => {
  const pending = mockData.notifications.notifications.filter(n => n.status === 'pending')
  json(res, { ok: true, notifications: pending })
})
app.post('/api/assistant/notifications/:id/ack', (req, res) => okOnly(res))
app.post('/api/assistant/notifications/:id/ignore', (req, res) => okOnly(res))
app.post('/api/assistant/digest/run', (req, res) => ok(res, { message: '已触发摘要生成' }))

// ── AI Chat ──────────────────────────────────────────────────────────────
let sessionIdCounter = 0

app.post('/api/ai/chat/start', (req, res) => {
  const id = `demo-session-${++sessionIdCounter}`
  const sourceType = req.body.source_type || 'favorites'
  const sourceName = sourceType === 'favorites' ? '微信收藏'
    : sourceType === 'group_chat' ? '技术交流群'
    : '张伟'
  ok(res, {
    session_id: id,
    source_name: sourceName,
    context_summary: sourceType === 'favorites' ? '已加载 6 条收藏内容（文字、链接、聊天记录）' : '已加载 5 条聊天记录',
    token_usage: { used: 0, budget: 100000 },
    history: []
  })
})

// SSE streaming for AI chat messages
app.post('/api/ai/chat/message', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const responses = mockData.aiResponses
  const reply = responses[Math.floor(Math.random() * responses.length)]
  let tokenUsed = 0

  // Stream characters one by one
  let idx = 0
  const streamInterval = setInterval(() => {
    if (idx < reply.length) {
      // Send a chunk (1-3 characters at a time for speed)
      const chunkSize = Math.min(3, reply.length - idx)
      const chunk = reply.substring(idx, idx + chunkSize)
      idx += chunkSize
      tokenUsed += chunkSize
      res.write(`event: token\ndata: ${JSON.stringify({ content: chunk })}\n\n`)
    } else {
      clearInterval(streamInterval)
      res.write(`event: done\ndata: ${JSON.stringify({ token_usage: { used: tokenUsed, budget: 100000 }, auto_compressed: false })}\n\n`)
      res.end()
    }
  }, 30)

  // Clean up on client disconnect
  req.on('close', () => clearInterval(streamInterval))
})

app.post('/api/ai/chat/compress', (req, res) => ok(res, { compressed_from: 5, compressed_to: 3, token_usage: { used: 500, budget: 100000 } }))
app.get('/api/ai/chat/history', (req, res) => ok(res, { history: [], token_usage: { used: 0, budget: 100000 } }))
app.post('/api/ai/chat/destroy', (req, res) => okOnly(res))

// ── Nicknames ──────────────────────────────────────────────────────────
app.get('/api/nicknames/groups', (req, res) => json(res, mockData.nicknameGroups))
app.get('/api/nicknames', (req, res) => json(res, { ok: true, members: [] }))
app.post('/api/nicknames', (req, res) => okOnly(res))

// ── Logs ────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  // Add dynamic timestamp to make logs feel "alive"
  const logs = mockData.logs.logs.map(l => ({
    ...l,
    ts: l.ts // keep original timestamps for stability
  }))
  json(res, { ok: true, logs })
})

// ── Scheduler ──────────────────────────────────────────────────────────
app.get('/api/scheduler/tasks', (req, res) => ok(res, { data: [] }))
app.post('/api/scheduler/tasks', (req, res) => ok(res, { data: { id: 'demo-task' } }))
app.put('/api/scheduler/tasks/:id', (req, res) => okOnly(res))
app.delete('/api/scheduler/tasks/:id', (req, res) => okOnly(res))

// ── Other ──────────────────────────────────────────────────────────────
app.get('/api/lots', (req, res) => ok(res, { config: {} }))
app.post('/api/lots', (req, res) => okOnly(res))
app.get('/api/macos/diagnose', (req, res) => ok(res, { skipped: true }))
app.post('/api/export/open-folder', (req, res) => ok(res, { path: '/demo' }))

// ── Media placeholders ──────────────────────────────────────────────────
// All image/audio/video endpoints return placeholder SVG or 404
app.get('/api/image/proxy', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(PLACEHOLDER_SVG)
})
app.get('/api/chat/image', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml')
  res.send(PLACEHOLDER_SVG)
})
app.get('/api/fav/image', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml')
  res.send(PLACEHOLDER_SVG)
})
app.get('/api/voice', (req, res) => res.status(404).send('Demo mode'))
app.get('/api/fav/voice', (req, res) => res.status(404).send('Demo mode'))
app.get('/api/fav/voice/record', (req, res) => res.status(404).send('Demo mode'))
app.get('/api/fav/voice/download', (req, res) => res.status(404).send('Demo mode'))
app.get('/api/sns/video/download', (req, res) => res.status(404).send('Demo mode'))

// ── OPTIONS (CORS preflight) ────────────────────────────────────────────
app.options('/api/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.sendStatus(204)
})

// ── Static files + SPA fallback ──────────────────────────────────────
// Must be AFTER all API routes so /api/* doesn't hit static

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))

  // SPA fallback: any GET that didn't match API or a static file → index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  app.get('*', (req, res) => {
    res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h1>wx-assist Demo</h1>
        <p>前端尚未构建。请先运行 <code>node build.js</code></p>
      </body></html>
    `)
  })
}

// ── WebSocket server ──────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`✅ wx-assist demo server running on http://localhost:${PORT}`)
  console.log(`   Frontend: dist/ directory`)
  console.log(`   Mock API: /api/* endpoints`)
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`)
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('WebSocket client connected')

  // Send initial status
  const initialStatus = { ...mockData.status, uptime_sec: process.uptime() | 0, timestamp: new Date().toISOString() }
  ws.send(JSON.stringify(initialStatus))

  // Broadcast status every 5 seconds
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      const status = {
        ...mockData.status,
        uptime_sec: process.uptime() | 0,
        messages_processed: 1247 + Math.floor(Math.random() * 5), // slight variation
        last_api_call_sec_ago: Math.floor(Math.random() * 10),
        timestamp: new Date().toISOString(),
      }
      ws.send(JSON.stringify(status))
    }
  }, 5000)

  ws.on('close', () => {
    clearInterval(interval)
    console.log('WebSocket client disconnected')
  })

  ws.on('error', () => {
    clearInterval(interval)
  })
})
