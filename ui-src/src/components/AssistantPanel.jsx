import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Warning, Spinner, MagnifyingGlass, Bell, Clock, CaretDown, CaretRight, EnvelopeOpen, Archive, Lightning, X, Play, Stop, PaperPlaneTilt, FileText } from '@phosphor-icons/react'
import { SectionHeader, API_BASE } from './SharedComponents'

const pageTransition = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

// ── Cron helpers (for display only) ──────────────────────────────────

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function parseCronExpr(cronExpr) {
  if (!cronExpr) return { freqMode: 'daily', times: ['09:00'], weekdays: [1,2,3,4,5] }
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return { freqMode: 'custom', times: [], weekdays: [] }
  const [min, hour, , , dow] = fields
  const hours = hour === '*' ? [9] : hour.split(',').map(Number).filter(n => !isNaN(n))
  const mins = min === '*' ? [0] : min.split(',').map(Number).filter(n => !isNaN(n))
  const times = []
  for (const h of hours) { for (const m of mins) { times.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`) } }
  let freqMode = 'custom', weekdays = [1,2,3,4,5]
  if (dow === '*') freqMode = 'daily'
  else if (dow === '1-5') { freqMode = 'weekday'; weekdays = [1,2,3,4,5] }
  else { freqMode = 'custom'; weekdays = dow.split(',').map(Number).filter(n => !isNaN(n)) }
  return { freqMode, times, weekdays }
}

function cronToLabel(cronExpr) {
  if (!cronExpr) return ''
  const p = parseCronExpr(cronExpr)
  const timeLabel = p.times.join(' · ') || '9:00'
  if (p.freqMode === 'daily') return `每天 ${timeLabel}`
  if (p.freqMode === 'weekday') return `工作日 ${timeLabel}`
  if (p.freqMode === 'custom' && p.weekdays.length) {
    const days = p.weekdays.map(d => '周' + WEEKDAY_LABELS[d]).join(' ')
    return `${days} ${timeLabel}`
  }
  return cronExpr
}

const notificationTypes = {
  keyword_alert: '关键词提醒',
  group_digest: '定时摘要',
  oa_digest: '公众号摘要',
}

const notificationStatuses = {
  pending: '待投递',
  acked: '已投递',
  delivered: '已投递',
  ignored: '已忽略',
  failed: '失败',
}

const statusColors = {
  pending: 'var(--status-warn)',
  acked: 'var(--brand-green)',
  delivered: 'var(--brand-green)',
  ignored: 'var(--text-muted)',
  failed: 'var(--status-error)',
}

// ── Preset demo data (read-only) ─────────────────────────────────────

const PRESET_KEYWORDS = ['BUG', '线上问题', '紧急']
const PRESET_ALERT_GROUP = '技术交流群'

const PRESET_DIGEST_GROUPS = [
  { group_name: '技术交流群', schedule_label: '每天 09:00', lookback: '6 小时', unread_only: true, push_target: 'ilink' },
  { group_name: '家人群', schedule_label: '每天 12:00', lookback: '4 小时', unread_only: false, push_target: '' },
]

// ── Scenario Replay Panel ────────────────────────────────────────────

function ScenarioReplayPanel() {
  const [running, setRunning] = useState(false)
  const [lastMessage, setLastMessage] = useState(null)
  const [hitCount, setHitCount] = useState(0)
  const [pushCount, setPushCount] = useState(0)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/demo/scenario/status`)
      .then(r => r.json())
      .then(d => { if (d.ok) setRunning(d.running) })
      .catch(() => {})
  }, [])

  async function handleStart() {
    setRunning(true)
    setLastMessage(null)
    setHitCount(0)
    setPushCount(0)
    setFinished(false)
    try {
      const res = await fetch(`${API_BASE}/api/demo/scenario/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '12345678@chatroom', speed: 'fast' }),
      })
      const data = await res.json()
      if (!data.ok) {
        setRunning(false)
        return
      }
      // Frontend-side script simulation (matches backend scenario.py)
      const script = [
        { sender: '张伟', content: '早上好！有人在吗？' },
        { sender: '李芳', content: '早！昨晚那个bug看了吗' },
        { sender: '王磊', content: '看了，是并发问题，加个锁应该就行' },
        { sender: '张伟', content: '紧急BUG！线上接口超时了', hits: ['BUG', '紧急'] },
        { sender: '陈静', content: '什么接口？我看看日志' },
        { sender: '张伟', content: '用户反馈的那个，/api/report' },
        { sender: '王磊', content: '找到了，数据库连接池满了' },
        { sender: '李芳', content: '那得赶紧扩容啊' },
        { sender: '陈静', content: '线上问题已回滚，正在排查根因', hits: ['线上问题'] },
        { sender: '赵经理', content: '做个事故复盘，明天开会' },
        { sender: '张伟', content: '收到，我写文档' },
        { sender: '王磊', content: 'BUG已修复，提交了PR', hits: ['BUG'] },
      ]
      const total = script.length
      let localHits = 0
      script.forEach((msg, i) => {
        setTimeout(() => {
          const hits = msg.hits || []
          if (hits.length > 0) {
            localHits += hits.length
            setHitCount(localHits)
            // Each hit generates a notification; if iLink bound, it pushes
            setPushCount(prev => prev + hits.length)
          }
          setLastMessage({ sender: msg.sender, content: msg.content, keyword_hits: hits, index: i + 1, total })
          if (i === total - 1) {
            setTimeout(() => { setRunning(false); setFinished(true) }, 1500)
          }
        }, (i + 1) * 1000)
      })
    } catch {
      setRunning(false)
    }
  }

  async function handleStop() {
    try { await fetch(`${API_BASE}/api/demo/scenario/stop`, { method: 'POST' }) } catch {}
    setRunning(false)
    setLastMessage(null)
  }

  return (
    <div className="mt-4 p-4 rounded-xl bg-brand-green/[0.04] border border-brand-green/15">
      <p className="text-xs text-text-muted leading-relaxed mb-3">
        模拟技术交流群对话，自动触发关键词检测，命中后推送微信通知
      </p>

      {/* Big CTA button */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.01 }}
        onClick={running ? handleStop : handleStart}
        className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
          running
            ? 'bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/15'
            : 'bg-brand-green-hover text-white shadow-[0_2px_12px_rgba(24,226,153,0.25)] hover:shadow-[0_4px_20px_rgba(24,226,153,0.35)]'
        }`}
      >
        {running
          ? <><Stop size={16} weight="fill" /> 停止回放</>
          : <><Play size={16} weight="fill" /> 立即体验关键词提醒</>
        }
        {!running && <span className="text-white/70 text-xs font-normal">12 条模拟消息 · 约 15 秒</span>}
      </motion.button>

      {/* Live playback status */}
      <AnimatePresence>
        {lastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mt-3 p-3 rounded-lg bg-bg-raised/60 border border-border-main/50 space-y-1.5"
          >
            <div className="flex items-center gap-2 text-[11px] text-text-muted font-mono">
              <span>{lastMessage.index}/{lastMessage.total}</span>
              <span className="text-text-muted/25">|</span>
              <span className="text-text-main font-medium">{lastMessage.sender}</span>
            </div>
            <p className="text-xs text-text-main">{lastMessage.content}</p>
            {lastMessage.keyword_hits.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
                <span className="text-[#f59e0b]">🔔</span>
                <span className="text-[#f59e0b] font-semibold">命中:</span>
                {lastMessage.keyword_hits.map(kw => (
                  <span key={kw} className="px-1.5 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] font-medium">{kw}</span>
                ))}
                <span className="text-brand-green/70 ml-1">→ 已推送微信</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finished summary */}
      <AnimatePresence>
        {finished && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-3 p-3 rounded-lg bg-brand-green/[0.06] border border-brand-green/20 flex items-center gap-2 text-xs"
          >
            <CheckCircle size={14} className="text-brand-green shrink-0" weight="fill" />
            <span className="text-text-main font-medium">
              回放完成 · 命中 {hitCount} 次关键词 · 推送 {pushCount} 条微信通知
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Digest Preview Panel ─────────────────────────────────────────────

function DigestPreviewPanel() {
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)  // { summary, group_name, error }
  const [showFull, setShowFull] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    setResult(null)
    setShowFull(false)
    try {
      const res = await fetch(`${API_BASE}/api/demo/digest/preview`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setResult({ summary: data.summary, group_name: data.group_name || '技术交流群', error: null })
      } else {
        setResult({ summary: '', group_name: '', error: data.error || '生成失败' })
      }
    } catch {
      setResult({ summary: '', group_name: '', error: '网络错误' })
    }
    setGenerating(false)
  }

  return (
    <div className="mt-4 p-4 rounded-xl bg-brand-green/[0.04] border border-brand-green/15">
      <p className="text-xs text-text-muted leading-relaxed mb-3">
        一键生成预设群的 AI 摘要，体验定时摘要效果
      </p>

      <motion.button
        whileTap={{ scale: 0.97 }}
        whileHover={{ scale: 1.01 }}
        onClick={handleGenerate}
        disabled={generating}
        className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
          generating
            ? 'bg-brand-green/20 text-brand-green/60 cursor-wait'
            : 'bg-brand-green-hover text-white shadow-[0_2px_12px_rgba(24,226,153,0.25)] hover:shadow-[0_4px_20px_rgba(24,226,153,0.35)]'
        }`}
      >
        {generating
          ? <><Spinner size={16} className="animate-spin" /> AI 生成中...</>
          : <><FileText size={16} weight="fill" /> 立即生成摘要</>
        }
      </motion.button>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-3"
          >
            {result.error ? (
              <div className="p-3 rounded-lg bg-status-error/[0.06] border border-status-error/20 text-xs text-status-error">
                ⚠ {result.error}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-bg-raised/60 border border-border-main/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted font-medium">
                    📋 {result.group_name} · AI 摘要
                  </span>
                  <button
                    onClick={() => setShowFull(!showFull)}
                    className="text-xs text-brand-green hover:underline cursor-pointer"
                  >
                    {showFull ? '收起' : '展开查看'}
                  </button>
                </div>
                {showFull ? (
                  <div className="text-xs text-text-main leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {result.summary}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted line-clamp-2">{result.summary}</p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────

export default function AssistantPanel() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [filters, setFilters] = useState({ chat_id: '', type: '', status: '' })

  useEffect(() => {
    async function load() {
      try {
        const configRes = await fetch(`${API_BASE}/api/assistant/config`)
        const configData = await configRes.json()
        setConfig(configData.config || {})
      } catch {
        setConfig({})
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [filters.type, filters.status])

  async function loadNotifications() {
    setNotificationLoading(true)
    setNotificationError('')
    try {
      const params = new URLSearchParams()
      if (filters.type) params.set('type', filters.type)
      if (filters.status) params.set('status', filters.status)
      params.set('limit', '50')
      const res = await fetch(`${API_BASE}/api/assistant/notifications?${params.toString()}`)
      const data = await res.json()
      if (data.ok) setNotifications(data.notifications || [])
      else setNotificationError(data.error || '通知记录加载失败')
    } catch {
      setNotificationError('通知记录加载失败')
    } finally {
      setNotificationLoading(false)
    }
  }

  async function updateNotificationStatus(id, action) {
    await fetch(`${API_BASE}/api/assistant/notifications/${id}/${action}`, { method: 'POST' })
    loadNotifications()
  }

  if (loading) {
    return (
      <motion.div {...pageTransition} className="p-4 md:p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Spinner size={24} weight="bold" className="animate-spin text-brand-green mx-auto mb-3" />
          <p className="text-sm text-text-muted font-mono">加载微信助手配置...</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div {...pageTransition} className="p-4 md:p-8 space-y-10 max-w-5xl">

      {/* ── Status bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 rounded-xl border text-sm bg-brand-green/5 border-brand-green/20">
        <div className="w-2.5 h-2.5 rounded-full bg-brand-green animate-pulse" />
        <span className="font-semibold text-brand-green-hover dark:text-brand-green">微信助手已开启</span>
        <span className="text-text-muted/60">·</span>
        <span className="text-xs text-text-muted">关键词提醒 · 定时摘要 · 通知队列</span>
      </div>

      {/* ── Keyword Alerts (read-only demo) ────────────────────── */}
      <section>
        <SectionHeader
          title="关键词即时提醒"
          accent="#f59e0b"
          icon={Lightning}
          subtitle="检测到群消息中含关键词时，实时推送微信通知"
        />
        <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
          <div className="p-4 md:p-6 space-y-4">
            {/* Read-only preset display */}
            <div className="space-y-3">
              <div>
                <p className="text-xs text-text-muted mb-2">预设关键词</p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_KEYWORDS.map(kw => (
                    <span key={kw} className="text-xs px-3 py-1.5 rounded-lg bg-[#f59e0b]/10 text-[#f59e0b] font-semibold border border-[#f59e0b]/15">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">监听群</p>
                <span className="text-sm text-text-main font-medium">{PRESET_ALERT_GROUP}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <PaperPlaneTilt size={12} className="text-brand-green" />
                <span>命中后自动推送微信通知</span>
              </div>
            </div>

            {/* Embedded scenario replay */}
            <ScenarioReplayPanel />
          </div>
        </div>
      </section>

      {/* ── Timed Digests (read-only demo) ─────────────────────── */}
      <section>
        <SectionHeader
          title="定时群摘要"
          accent="var(--status-warn)"
          icon={Clock}
          subtitle="在设定时间自动生成群聊摘要，可直接推送到微信"
        />
        <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
          <div className="p-4 md:p-6 space-y-4">
            {/* Read-only preset digest groups */}
            <div className="space-y-3">
              {PRESET_DIGEST_GROUPS.map((dg, i) => (
                <div key={i} className="p-3.5 rounded-xl bg-bg-raised/40 border border-border-main/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-main font-medium">{dg.group_name}</span>
                    <div className="flex items-center gap-1.5">
                      {dg.push_target === 'ilink' && (
                        <span className="text-xs px-2 py-0.5 rounded bg-brand-green/10 text-brand-green-hover dark:text-brand-green font-medium flex items-center gap-1">
                          <PaperPlaneTilt size={10} /> 推送微信
                        </span>
                      )}
                      {dg.unread_only && (
                        <span className="text-xs px-2 py-0.5 rounded bg-status-warn-soft text-status-warn font-medium">仅未读</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="font-mono">{dg.schedule_label}</span>
                    <span className="text-text-muted/40">·</span>
                    <span>摘要范围 {dg.lookback}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Embedded digest preview */}
            <DigestPreviewPanel />
          </div>
        </div>
      </section>

      {/* ── Notification Center ────────────────────────────────── */}
      <section>
        <SectionHeader
          title="通知中心"
          accent="var(--brand-green)"
          icon={Bell}
          subtitle="查看关键词提醒与定时摘要的通知记录，外部 Agent 可通过 API 拉取"
        />
        <div className="space-y-5">
          {/* Queue info card */}
          <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-brand-green/10 text-brand-green">
                  <EnvelopeOpen size={18} />
                </div>
                <div>
                  <p className="text-sm text-text-main font-medium">通知投递队列</p>
                  <p className="text-xs text-text-muted mt-0.5">队列运行中，命中后自动推送微信</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-12">
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">通知保留时间</label>
                  <span className="text-sm text-text-main">48 小时</span>
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">外部 Agent 拉取地址</label>
                  <code className="text-xs text-text-muted bg-bg-raised border border-border-main rounded-lg px-3 py-2 block truncate font-mono">
                    GET {window.location.origin}/api/assistant/notifications/pending
                  </code>
                </div>
              </div>
            </div>
          </div>

          {/* Notification history */}
          <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-bg-raised text-text-muted">
                    <Archive size={18} />
                  </div>
                  <p className="text-sm text-text-main font-medium">通知记录</p>
                </div>
                <button onClick={loadNotifications} className="text-sm text-brand-green-hover hover:underline cursor-pointer font-medium">刷新</button>
              </div>
              {/* Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select value={filters.type} onChange={e => setFilters(prev => ({ ...prev, type: e.target.value }))} className="bg-bg-raised border border-border-main rounded-lg px-3 py-2.5 text-sm text-text-main focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all">
                  <option value="">全部类型</option>
                  <option value="keyword_alert">关键词提醒</option>
                  <option value="group_digest">定时摘要</option>
                  <option value="oa_digest">公众号摘要</option>
                </select>
                <select value={filters.status} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))} className="bg-bg-raised border border-border-main rounded-lg px-3 py-2.5 text-sm text-text-main focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all">
                  <option value="">全部状态</option>
                  <option value="pending">待投递</option>
                  <option value="acked">已投递</option>
                  <option value="delivered">已投递</option>
                  <option value="ignored">已忽略</option>
                  <option value="failed">失败</option>
                </select>
              </div>

              {notificationError && <p className="text-xs text-status-error">{notificationError}</p>}
              {notificationLoading ? (
                <div className="flex items-center gap-2 text-xs text-text-muted py-8 justify-center"><Spinner size={14} className="animate-spin" />加载中...</div>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto">
                  {notifications.map(n => (
                    <NotificationCard
                      key={n.id}
                      notification={n}
                      onAck={() => updateNotificationStatus(n.id, 'ack')}
                      onIgnore={() => updateNotificationStatus(n.id, 'ignore')}
                    />
                  ))}
                  {!notifications.length && (
                    <div className="py-10 text-center">
                      <Archive size={28} className="text-text-muted/40 mx-auto mb-2" />
                      <p className="text-xs text-text-muted">暂无通知记录</p>
                      <p className="text-xs text-text-muted/60 mt-1">点击上方"立即体验"生成通知</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </motion.div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function NotificationCard({ notification, onAck, onIgnore }) {
  const statusColor = statusColors[notification.status] || 'var(--text-muted)'
  const pushStatus = notification.push_status || 'not_pushed'
  const pushColor = pushStatus === 'delivered' ? 'var(--brand-green)' : pushStatus === 'failed' ? 'var(--status-error)' : 'var(--text-muted)'
  const pushLabel = pushStatus === 'delivered' ? '推送成功' : pushStatus === 'failed' ? '推送失败' : '未推送'
  return (
    <div className="bg-bg-raised/40 border border-border-main rounded-xl p-4 transition-all hover:border-border-main/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-brand-green/10 text-brand-green-hover dark:text-brand-green font-medium">
              {notificationTypes[notification.type] || notification.type}
            </span>
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: statusColor }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              {notificationStatuses[notification.status] || notification.status}
            </span>
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: pushColor }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pushColor }} />
              {pushLabel}
            </span>
            <span className="text-xs text-text-muted/70">{notification.create_time}</span>
          </div>
          <p className="text-sm text-text-main font-medium truncate">{notification.title || '无标题'}</p>
          <p className="text-xs text-text-muted mt-0.5">{notification.group_name || notification.chat_id || '未知群聊'}</p>
        </div>
        {notification.status === 'pending' && (
          <div className="flex gap-1.5 shrink-0">
            <button onClick={onAck} className="text-xs px-3.5 py-1.5 rounded-full bg-brand-green/10 text-brand-green-hover hover:bg-brand-green/20 transition-colors cursor-pointer font-medium">标记投递</button>
            <button onClick={onIgnore} className="text-xs px-3.5 py-1.5 rounded-full bg-bg-raised text-text-muted hover:text-status-error hover:bg-status-error-soft transition-colors cursor-pointer">忽略</button>
          </div>
        )}
      </div>
      <pre className="whitespace-pre-wrap text-sm text-text-main/75 mt-3 font-sans leading-relaxed">{notification.content}</pre>
    </div>
  )
}
