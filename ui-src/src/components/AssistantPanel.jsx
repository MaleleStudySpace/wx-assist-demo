import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FloppyDisk, CheckCircle, Warning, Spinner, MagnifyingGlass, Bell, Clock, ChatCircle, CaretDown, CaretRight, EnvelopeOpen, Archive, Lightning, Trash, X } from '@phosphor-icons/react'
import { Toggle, SectionHeader, TagInput, API_BASE } from './SharedComponents'

const pageTransition = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

const PRESET_TIMES = ['09:00', '12:00', '14:00', '18:00', '21:00', '23:00']

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// ── Cron helpers ─────────────────────────────────────────────────────

function buildCronExpr(times, freqMode, weekdays) {
  const parsed = times.map(t => {
    const [h, m] = t.split(':').map(Number)
    return { hour: h, minute: m || 0 }
  }).sort((a, b) => a.hour - b.hour || a.minute - b.minute)
  const hourStr = [...new Set(parsed.map(p => p.hour))].sort((a,b)=>a-b).join(',')
  const minStr = [...new Set(parsed.map(p => p.minute))].sort((a,b)=>a-b).join(',')

  if (freqMode === 'daily') {
    return `${minStr || 0} ${hourStr || 9} * * *`
  }
  if (freqMode === 'weekday') {
    return `${minStr || 0} ${hourStr || 9} * * 1-5`
  }
  // custom
  const dow = [...weekdays].sort((a,b)=>a-b).join(',')
  return `${minStr || 0} ${hourStr || 9} * * ${dow || '*'}`

}

function parseCronExpr(cronExpr) {
  if (!cronExpr) return { freqMode: 'daily', times: ['09:00'], weekdays: [1,2,3,4,5] }
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return { freqMode: 'custom', times: [], weekdays: [] }

  const [min, hour, , , dow] = fields

  // 解析时间
  const hours = hour === '*' ? [9] : hour.split(',').map(Number).filter(n => !isNaN(n))
  const mins = min === '*' ? [0] : min.split(',').map(Number).filter(n => !isNaN(n))
  const times = []
  for (const h of hours) {
    for (const m of mins) {
      times.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
    }
  }

  // 解析频率
  let freqMode = 'custom'
  let weekdays = [1,2,3,4,5]
  if (dow === '*') {
    freqMode = 'daily'
  } else if (dow === '1-5') {
    freqMode = 'weekday'
    weekdays = [1,2,3,4,5]
  } else {
    freqMode = 'custom'
    weekdays = dow.split(',').map(Number).filter(n => !isNaN(n))
  }

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
}

const notificationStatuses = {
  pending: '待投递',
  delivered: '已投递',
  ignored: '已忽略',
  failed: '失败',
}

const statusColors = {
  pending: 'var(--status-warn)',
  delivered: 'var(--brand-green)',
  ignored: 'var(--text-muted)',
  failed: 'var(--status-error)',
}

// ── Main component ──────────────────────────────────────────────────

export default function AssistantPanel() {
  const [config, setConfig] = useState(null)
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notificationLoading, setNotificationLoading] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [filters, setFilters] = useState({ chat_id: '', type: '', status: '' })
  // Track which alert/digest items are expanded
  const [expandedAlerts, setExpandedAlerts] = useState({})
  const [expandedDigests, setExpandedDigests] = useState({})
  const [expandedProfiles, setExpandedProfiles] = useState({})
  // Inline editors
  const [showAlertEditor, setShowAlertEditor] = useState(false)
  const [showDigestEditor, setShowDigestEditor] = useState(false)
  const [alertDraft, setAlertDraft] = useState({ chat_id: '', group_name: '', keywords: [], enabled: true })
  const [digestDraft, setDigestDraft] = useState({
    chat_id: '', group_name: '', schedule: [], cron_expr: '', lookback_hours: 6, enabled: true,
    unread_only: false, push_target: '', profile: { purpose: '', description: '', focus: [], ignore: [], style: '', custom_prompt: '' },
  })
  const [editorError, setEditorError] = useState('')
  // Push result toast (auto-disappears after 3s)
  const [pushToast, setPushToast] = useState(null)  // { group_name, success, error }

  // WebSocket for digest push results
  useEffect(() => {
    const handleMessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'digest_push_result') {
          setPushToast(data)
          setTimeout(() => setPushToast(null), 3000)
        }
      } catch {}
    }
    let ws = window.__assistant_ws
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      ws = new WebSocket(`ws://${API_BASE.replace(/^https?:\/\//, '')}/ws`)
      window.__assistant_ws = ws
    }
    ws.addEventListener('message', handleMessage)
    return () => { ws.removeEventListener('message', handleMessage) }
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const [configRes, groupsRes] = await Promise.all([
          fetch(`${API_BASE}/api/assistant/config`),
          fetch(`${API_BASE}/api/nicknames/groups`),
        ])
        const configData = await configRes.json()
        const groupsData = await groupsRes.json()
        setConfig(normalizeConfig(configData.config || defaultConfig()))
        if (groupsData.ok) setGroups(groupsData.groups || [])
      } catch {
        setConfig(defaultConfig())
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [filters.chat_id, filters.type, filters.status])

  function defaultConfig() {
    return {
      version: 1,
      assistant_enabled: false,
      allow_wechat_send: false,
      alert_groups: [],
      digest_groups: [],
      notification_queue: { enabled: true, retention_hours: 24 },
      outbox_retention_hours: 24,
    }
  }

  function normalizeConfig(raw) {
    const queue = raw.notification_queue || {
      enabled: (raw.notify_channels || []).some(ch => ch.enabled !== false) || true,
      retention_hours: raw.outbox_retention_hours || 24,
    }
    return {
      ...defaultConfig(),
      ...raw,
      notification_queue: queue,
      alert_groups: (raw.alert_groups || []).map(item => ({ chat_id: '', ...item })),
      digest_groups: (raw.digest_groups || []).map(item => ({ chat_id: '', ...item })),
    }
  }

  function update(field, value) {
    setDirty(true)
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  function updateQueue(patch) {
    setDirty(true)
    setConfig(prev => ({
      ...prev,
      notification_queue: { ...(prev.notification_queue || {}), ...patch },
      outbox_retention_hours: patch.retention_hours ?? prev.outbox_retention_hours,
    }))
  }

  function findGroup(chatId) {
    return groups.find(g => g.chat_id === chatId)
  }

  function applyGroupToAlert(index, chatId) {
    const selected = findGroup(chatId)
    const next = [...(config.alert_groups || [])]
    next[index] = {
      ...next[index],
      chat_id: chatId,
      group_name: selected?.group_name || next[index].group_name || '',
    }
    update('alert_groups', next)
  }

  function applyGroupToDigest(index, chatId) {
    const selected = findGroup(chatId)
    const next = [...(config.digest_groups || [])]
    next[index] = {
      ...next[index],
      chat_id: chatId,
      group_name: selected?.group_name || next[index].group_name || '',
    }
    update('digest_groups', next)
  }

  async function save() {
    try {
      const res = await fetch(`${API_BASE}/api/assistant/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const d = await res.json()
      if (d.ok) {
        setSaved(true)
        setSaveError('')
        setDirty(false)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setSaveError(d.error || '保存失败')
      }
    } catch (e) {
      setSaveError(e.message || '保存失败')
    }
  }

  async function loadNotifications() {
    setNotificationLoading(true)
    setNotificationError('')
    try {
      const params = new URLSearchParams()
      if (filters.chat_id) params.set('chat_id', filters.chat_id)
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

  async function createTestNotification() {
    await fetch(`${API_BASE}/api/assistant/notifications/test`, { method: 'POST' })
    loadNotifications()
  }

  async function updateNotificationStatus(id, action) {
    await fetch(`${API_BASE}/api/assistant/notifications/${id}/${action}`, { method: 'POST' })
    loadNotifications()
  }

  if (loading) {
    return (
      <motion.div {...pageTransition} className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Spinner size={24} weight="bold" className="animate-spin text-brand-green mx-auto mb-3" />
          <p className="text-sm text-text-muted font-mono">加载微信助手配置...</p>
        </div>
      </motion.div>
    )
  }

  if (!config) return null

  const assistantOn = config.assistant_enabled
  const alertCount = (config.alert_groups || []).filter(g => g.enabled).length
  const digestCount = (config.digest_groups || []).filter(g => g.enabled).length

  return (
    <motion.div {...pageTransition} className="p-8 space-y-10 max-w-5xl">
      {/* Push result toast */}
      {pushToast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-all ${
          pushToast.success
            ? 'bg-brand-green/90 text-white'
            : 'bg-status-error/90 text-white'
        }`}>
          {pushToast.success
            ? `✓ 推送成功: ${pushToast.group_name}`
            : `⚠ 推送失败: ${pushToast.group_name}`}
        </div>
      )}

      {/* ── Unsaved changes floating banner ─────────────────────────── */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div
              className="flex items-center gap-4 px-6 py-3 rounded-2xl
                bg-amber-50/95 dark:bg-zinc-800/95 border border-amber-300/50 dark:border-amber-500/25
                backdrop-blur-xl shadow-lg shadow-amber-500/10 dark:shadow-amber-500/5
                whitespace-nowrap"
            >
              <div className="flex items-center gap-2.5">
                <Warning size={18} weight="fill" className="text-amber-500 dark:text-amber-400" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  有未保存的更改
                </span>
              </div>
              <motion.button
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: 1.03 }}
                onClick={save}
                className="flex items-center gap-2 px-5 py-2 rounded-full
                  bg-brand-green-hover text-white text-sm font-semibold
                  hover:bg-brand-green-hover shadow-md shadow-brand-green/20
                  cursor-pointer transition-all"
              >
                <FloppyDisk size={14} /> 保存
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Status bar ─────────────────────────────────────────── */}
      <div className={`flex items-center gap-3 px-5 py-3 rounded-xl border text-sm transition-all duration-300 ${
        assistantOn
          ? 'bg-brand-green/5 border-brand-green/20'
          : 'bg-bg-raised/60 border-border-main'
      }`}>
        <div className={`w-2.5 h-2.5 rounded-full ${assistantOn ? 'bg-brand-green animate-pulse' : 'bg-text-muted'}`} />
        <span className={`font-semibold ${assistantOn ? 'text-brand-green-hover dark:text-brand-green' : 'text-text-muted'}`}>
          {assistantOn ? '微信助手已开启' : '微信助手已关闭'}
        </span>
        <span className="text-text-muted/60">·</span>
        <span className="text-xs text-text-muted">
          {alertCount > 0 && `${alertCount} 个提醒群 · `}
          {digestCount > 0 && `${digestCount} 个摘要群 · `}
          {config.notification_queue?.enabled !== false ? '通知队列开启' : '通知队列关闭'}
        </span>
      </div>

      {/* ── Basic Settings ─────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="基础设置"
          accent="var(--status-info)"
          subtitle="开启后可配置关键词提醒与定时摘要，关闭后所有助手功能暂停"
        />
        <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
          {/* 主开关 */}
          <div className="p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-text-main font-semibold">启用微信助手</p>
              <p className="text-xs text-text-muted mt-0.5">关键词提醒 & 定时摘要</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-semibold uppercase tracking-wider ${assistantOn ? 'text-brand-green' : 'text-text-muted'}`}>
                {assistantOn ? 'ON' : 'OFF'}
              </span>
              <Toggle enabled={config.assistant_enabled} onChange={v => update('assistant_enabled', v)} />
            </div>
          </div>
          {/* 依赖子选项：允许发送 — 仅在助手开启时可见，视觉弱化 */}
          <AnimatePresence>
            {config.assistant_enabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-4 pt-3 border-t border-border-main/40 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-text-muted">允许发送微信消息</p>
                    <p className="text-xs text-text-muted/60 mt-0.5">自动通过微信窗口投递通知/摘要</p>
                  </div>
                  <Toggle enabled={config.allow_wechat_send} onChange={v => update('allow_wechat_send', v)} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Keyword Alerts ─────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="关键词即时提醒"
          accent="#f59e0b"
          icon={Lightning}
          subtitle="检测到群消息中含关键词时生成提醒通知，外部 Agent 可通过通知 API 拉取"
        />
        <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
          <div className="p-6 space-y-3">
            {/* 已有群列表 */}
            <AnimatePresence>
              {(config.alert_groups || []).map((ag, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <AlertGroupCard
                    ag={ag}
                    index={i}
                    groups={groups}
                    expanded={!!expandedAlerts[i]}
                    onToggleExpand={() => setExpandedAlerts(prev => ({ ...prev, [i]: !prev[i] }))}
                    onToggleEnabled={v => {
                      const next = [...config.alert_groups]
                      next[i] = { ...next[i], enabled: v }
                      update('alert_groups', next)
                    }}
                    onDelete={() => update('alert_groups', config.alert_groups.filter((_, idx) => idx !== i))}
                    onSelectGroup={chatId => applyGroupToAlert(i, chatId)}
                    onKeywordsChange={keywords => {
                      const next = [...config.alert_groups]
                      next[i] = { ...next[i], keywords }
                      update('alert_groups', next)
                    }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* 空状态 */}
            {!config.alert_groups?.length && !showAlertEditor && (
              <div className="py-10 text-center">
                <Lightning size={32} className="text-text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-text-muted">添加群聊以配置关键词提醒</p>
                <button
                  onClick={() => { setShowAlertEditor(true); setAlertDraft({ chat_id: '', group_name: '', keywords: [], enabled: true }); setEditorError('') }}
                  className="mt-4 text-sm text-brand-green-hover hover:underline cursor-pointer font-medium"
                >+ 添加提醒群</button>
              </div>
            )}

            {/* Inline 编辑器 */}
            <AnimatePresence>
              {showAlertEditor && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <AlertGroupEditor
                    draft={alertDraft}
                    groups={groups}
                    error={editorError}
                    onDraftChange={setAlertDraft}
                    onSave={() => {
                      if (!alertDraft.chat_id) { setEditorError('请先选择群聊'); return }
                      const selected = findGroup(alertDraft.chat_id)
                      update('alert_groups', [...(config.alert_groups || []), {
                        ...alertDraft,
                        group_name: selected?.group_name || alertDraft.group_name || '',
                      }])
                      setShowAlertEditor(false)
                      setEditorError('')
                    }}
                    onCancel={() => { setShowAlertEditor(false); setEditorError('') }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 有群时的添加按钮 */}
            {(config.alert_groups?.length > 0 || showAlertEditor) && !showAlertEditor && (
              <button
                onClick={() => { setShowAlertEditor(true); setAlertDraft({ chat_id: '', group_name: '', keywords: [], enabled: true }); setEditorError('') }}
                className="w-full py-3.5 text-sm text-text-muted hover:text-brand-green border border-dashed border-border-main hover:border-brand-green/40 rounded-xl transition-all duration-200 cursor-pointer bg-bg-raised/30 hover:bg-brand-green/5"
              >
                + 添加提醒群
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Timed Digests ──────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="定时群摘要"
          accent="var(--status-warn)"
          icon={Clock}
          subtitle="在设定时间自动生成群聊摘要，推送到通知队列供外部 Agent 投递"
        />
        <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
          <div className="p-6 space-y-3">
            {/* 已有群列表 */}
            <AnimatePresence>
              {(config.digest_groups || []).map((dg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <DigestGroupCard
                    dg={dg}
                    index={i}
                    groups={groups}
                    expanded={!!expandedDigests[i]}
                    profileExpanded={!!expandedProfiles[i]}
                    onToggleExpand={() => setExpandedDigests(prev => ({ ...prev, [i]: !prev[i] }))}
                    onToggleProfile={() => setExpandedProfiles(prev => ({ ...prev, [i]: !prev[i] }))}
                    onToggleEnabled={v => {
                      const next = [...config.digest_groups]
                      next[i] = { ...next[i], enabled: v }
                      update('digest_groups', next)
                    }}
                    onDelete={() => update('digest_groups', config.digest_groups.filter((_, idx) => idx !== i))}
                    onSelectGroup={chatId => applyGroupToDigest(i, chatId)}
                    onScheduleChange={schedule => {
                      const next = [...config.digest_groups]
                      next[i] = { ...next[i], schedule }
                      update('digest_groups', next)
                    }}
                    onCronExprChange={cron_expr => {
                      const next = [...config.digest_groups]
                      next[i] = { ...next[i], cron_expr }
                      update('digest_groups', next)
                    }}
                    onLookbackChange={lookback_hours => {
                      const next = [...config.digest_groups]
                      next[i] = { ...next[i], lookback_hours }
                      update('digest_groups', next)
                    }}
                    onProfileChange={patch => {
                      const next = [...config.digest_groups]
                      const profile = next[i].profile || {}
                      next[i] = { ...next[i], profile: { ...profile, ...patch } }
                      update('digest_groups', next)
                    }}
                    onUnreadOnlyChange={v => {
                      const next = [...config.digest_groups]
                      next[i] = { ...next[i], unread_only: v }
                      update('digest_groups', next)
                    }}
                    onPushTargetChange={v => {
                      const next = [...config.digest_groups]
                      next[i] = { ...next[i], push_target: v }
                      update('digest_groups', next)
                    }}
                    
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* 空状态 */}
            {!config.digest_groups?.length && !showDigestEditor && (
              <div className="py-10 text-center">
                <Clock size={32} className="text-text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-text-muted">添加群聊以配置定时摘要</p>
                <button
                  onClick={() => { setShowDigestEditor(true); setDigestDraft({ chat_id: '', group_name: '', schedule: [], cron_expr: '', lookback_hours: 6, enabled: true, unread_only: false, push_target: '', profile: { purpose: '', description: '', focus: [], ignore: [], style: '' } }); setEditorError('') }}
                  className="mt-4 text-sm text-brand-green-hover hover:underline cursor-pointer font-medium"
                >+ 添加摘要群</button>
              </div>
            )}

            {/* Inline 编辑器 */}
            <AnimatePresence>
              {showDigestEditor && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <DigestGroupEditor
                    draft={digestDraft}
                    groups={groups}
                    error={editorError}
                    onDraftChange={setDigestDraft}
                    onSave={() => {
                      if (!digestDraft.chat_id) { setEditorError('请先选择群聊'); return }
                      const selected = findGroup(digestDraft.chat_id)
                      // Auto-fill default schedule if user didn't configure one
                      const schedule = digestDraft.schedule?.length ? digestDraft.schedule : ['09:00']
                      const cron_expr = digestDraft.cron_expr || '0 9 * * *'
                      update('digest_groups', [...(config.digest_groups || []), {
                        ...digestDraft,
                        schedule,
                        cron_expr,
                        group_name: selected?.group_name || digestDraft.group_name || '',
                      }])
                      setShowDigestEditor(false)
                      setEditorError('')
                    }}
                    onCancel={() => { setShowDigestEditor(false); setEditorError('') }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 有群时的添加按钮 */}
            {(config.digest_groups?.length > 0 || showDigestEditor) && !showDigestEditor && (
              <button
                onClick={() => { setShowDigestEditor(true); setDigestDraft({ chat_id: '', group_name: '', schedule: [], cron_expr: '', lookback_hours: 6, enabled: true, unread_only: false, push_target: '', profile: { purpose: '', description: '', focus: [], ignore: [], style: '' } }); setEditorError('') }}
                className="w-full py-3.5 text-sm text-text-muted hover:text-brand-green border border-dashed border-border-main hover:border-brand-green/40 rounded-xl transition-all duration-200 cursor-pointer bg-bg-raised/30 hover:bg-brand-green/5"
              >
                + 添加摘要群
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Notification Center ────────────────────────────────── */}
      <section>
        <SectionHeader
          title="通知中心"
          accent="var(--brand-green)"
          icon={Bell}
          subtitle="管理通知投递队列与历史记录，外部 Agent 通过本地 API 拉取待投递通知"
        />
        <div className="space-y-5">
          {/* Queue status card */}
          <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    config.notification_queue?.enabled !== false
                      ? 'bg-brand-green/10 text-brand-green'
                      : 'bg-bg-raised text-text-muted'
                  }`}>
                    <EnvelopeOpen size={18} />
                  </div>
                  <div>
                    <p className="text-sm text-text-main font-medium">通知投递队列</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {config.notification_queue?.enabled !== false ? '队列运行中，等待外部 Agent 拉取' : '队列已暂停'}
                    </p>
                  </div>
                </div>
                <Toggle enabled={config.notification_queue?.enabled !== false} onChange={v => updateQueue({ enabled: v })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-12">
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">通知保留时间</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={168} value={config.notification_queue?.retention_hours || 24}
                      onChange={e => updateQueue({ retention_hours: parseInt(e.target.value) || 24 })}
                      className="w-20 bg-bg-raised border border-border-main rounded-lg px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all"
                    />
                    <span className="text-xs text-text-muted">小时</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">外部 Agent 拉取地址</label>
                  <code className="text-xs text-text-muted bg-bg-raised border border-border-main rounded-lg px-3 py-2 block truncate font-mono">
                    GET {window.location.origin}/api/assistant/notifications/pending
                  </code>
                </div>
              </div>
              <div className="pl-12">
                <button
                  onClick={createTestNotification}
                  className="text-sm text-brand-green-hover hover:underline cursor-pointer font-medium"
                >+ 写入一条测试通知</button>
              </div>
            </div>
          </div>

          {/* Notification history */}
          <div className="bg-bg-card rounded-2xl border border-border-main shadow-sm overflow-hidden">
            <div className="p-6 space-y-4">
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <SearchableGroupSelect
                  groups={groups}
                  value={filters.chat_id}
                  onChange={chatId => setFilters(prev => ({ ...prev, chat_id: chatId }))}
                  placeholder="全部群聊"
                  allowClear
                />
                <select value={filters.type} onChange={e => setFilters(prev => ({ ...prev, type: e.target.value }))} className="bg-bg-raised border border-border-main rounded-lg px-3 py-2.5 text-sm text-text-main focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all">
                  <option value="">全部类型</option>
                  <option value="keyword_alert">关键词提醒</option>
                  <option value="group_digest">定时摘要</option>
                </select>
                <select value={filters.status} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))} className="bg-bg-raised border border-border-main rounded-lg px-3 py-2.5 text-sm text-text-main focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all">
                  <option value="">全部状态</option>
                  <option value="pending">待投递</option>
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
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Save bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pt-4 border-t border-border-main">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={save}
          className={`flex items-center gap-2 px-7 py-3 rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer ${
            saved
              ? 'bg-brand-green/15 text-brand-green-hover border border-brand-green/40'
              : dirty
                ? 'bg-brand-green-hover text-white hover:bg-brand-green-hover shadow-md shadow-brand-green/20'
                : 'bg-bg-raised text-text-muted border border-border-main hover:border-brand-green'
          }`}
        >
          {saved ? (
            <><CheckCircle size={16} weight="fill" /> 已保存</>
          ) : (
            <><FloppyDisk size={16} /> {dirty ? '保存微信助手配置' : '保存'}</>
          )}
        </motion.button>
        {saveError && <span className="text-xs text-status-error font-mono">{saveError}</span>}
        {saved && <span className="text-xs text-brand-green-hover dark:text-brand-green font-mono">配置已保存，无需重启</span>}
      </div>
    </motion.div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function AlertGroupCard({ ag, index, groups, expanded, onToggleExpand, onToggleEnabled, onDelete, onSelectGroup, onKeywordsChange }) {
  return (
    <div className="border border-border-main rounded-xl overflow-hidden transition-all duration-200 hover:border-border-main/80">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-bg-raised/30 transition-colors"
        onClick={onToggleExpand}
      >
        <Toggle enabled={ag.enabled} onChange={onToggleEnabled} />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-text-main font-medium truncate block">
            {ag.group_name || `提醒群 #${index + 1}`}
          </span>
          {(ag.keywords || []).length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {(ag.keywords || []).slice(0, 3).map((kw, ki) => (
                <span key={ki} className="text-xs px-2 py-0.5 rounded bg-brand-green/10 text-brand-green-hover dark:text-brand-green font-medium">{kw}</span>
              ))}
              {(ag.keywords || []).length > 3 && (
                <span className="text-xs text-text-muted">+{ag.keywords.length - 3}</span>
              )}
            </div>
          )}
        </div>
        <DeleteButton onDelete={onDelete} />
        <div className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <CaretDown size={16} className="text-text-muted" />
        </div>
      </div>
      {/* Body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border-main/50 pt-4 mx-4">
              <div>
                <label className="text-xs text-text-muted block mb-1.5">选择群聊</label>
                <SearchableGroupSelect
                  groups={groups}
                  value={ag.chat_id || ''}
                  onChange={onSelectGroup}
                  placeholder="搜索群聊..."
                />
                {!ag.chat_id && ag.group_name && (
                  <p className="text-xs text-status-warn mt-1">历史群名：{ag.group_name}，请从下拉重新绑定</p>
                )}
              </div>
              <div>
                <label className="text-xs text-text-muted block mb-1.5">关键词</label>
                <TagInput
                  tags={ag.keywords || []}
                  onChange={onKeywordsChange}
                  placeholder="输入关键词后按回车添加"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── ScheduleConfig — 摘要时间配置（频率+时间+星期+高阶cron）──

function ScheduleConfig({ schedule = [], cronExpr = '', onScheduleChange, onCronExprChange }) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [customTimeInput, setCustomTimeInput] = useState('')
  const customTimeRef = useRef(null)

  // 从 cron_expr 解析基础模式；无 cron 时从 schedule 推断
  const parsed = cronExpr
    ? parseCronExpr(cronExpr)
    : { freqMode: 'daily', times: schedule.length ? schedule : ['09:00'], weekdays: [1,2,3,4,5] }

  const freqMode = parsed.freqMode
  const times = parsed.times
  const weekdays = parsed.weekdays

  function syncCron(newTimes, newFreq, newWeekdays) {
    const cron = buildCronExpr(newTimes, newFreq, newWeekdays)
    onScheduleChange(newTimes)
    onCronExprChange(cron)
  }

  function handleFreqChange(mode) {
    const wds = mode === 'weekday' ? [1,2,3,4,5] : mode === 'daily' ? [] : weekdays
    syncCron(times, mode, wds)
  }

  function handleTimeToggle(time) {
    const next = times.includes(time) ? times.filter(t => t !== time) : [...times, time].sort()
    if (!next.length) next.push('09:00')
    syncCron(next, freqMode, weekdays)
  }

  function addCustomTime() {
    // 支持逗号分隔多个时间
    const parts = customTimeInput.split(/[,;，；]/).map(s => s.trim()).filter(Boolean)
    const valid = parts.filter(p => /^\d{1,2}:\d{2}$/.test(p))
    if (!valid.length) return
    const next = [...new Set([...times, ...valid])].sort()
    syncCron(next, freqMode, weekdays)
    setCustomTimeInput('')
  }

  function removeCustomTime(time) {
    const next = times.filter(t => t !== time)
    if (!next.length) next.push('09:00')
    syncCron(next, freqMode, weekdays)
  }

  function handleWeekdayToggle(day) {
    const next = weekdays.includes(day) ? weekdays.filter(d => d !== day) : [...weekdays, day].sort((a,b)=>a-b)
    if (!next.length) return // 至少选一天
    syncCron(times, 'custom', next)
  }

  return (
    <div className="space-y-3">
      <label className="text-xs text-text-muted block">摘要时间</label>

      {/* 频率选择 */}
      <div className="flex gap-1.5">
        {[
          { key: 'daily', label: '每天' },
          { key: 'weekday', label: '工作日' },
          { key: 'custom', label: '自定义' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => handleFreqChange(f.key)}
            className={`text-sm px-3.5 py-2 rounded-lg font-medium transition-all duration-150 cursor-pointer ${
              freqMode === f.key
                ? 'bg-brand-green-hover text-white shadow-sm'
                : 'bg-bg-raised border border-border-main text-text-muted hover:border-brand-green/40 hover:text-text-main'
            }`}
          >{f.label}</button>
        ))}
      </div>

      {/* 时间 chips（预设 + 用户自定义的都显示为可点选 chip） */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_TIMES.map(t => {
          const active = times.includes(t)
          return (
            <button
              key={t}
              onClick={() => handleTimeToggle(t)}
              className={`text-xs px-3 py-2 rounded-lg font-mono font-medium transition-all duration-150 cursor-pointer ${
                active
                  ? 'bg-brand-green-hover text-white shadow-sm'
                  : 'bg-bg-raised border border-border-main text-text-muted hover:border-brand-green/40 hover:text-text-main'
              }`}
            >{t}</button>
          )
        })}
        {/* 用户添加的自定义时间也显示为 chip，可点击删除 */}
        {times.filter(t => !PRESET_TIMES.includes(t)).map(t => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-lg font-mono font-medium bg-brand-green-hover text-white shadow-sm"
          >
            {t}
            <button
              onClick={() => removeCustomTime(t)}
              className="text-bg-main/60 hover:text-bg-main transition-colors cursor-pointer"
            >
              <X size={10} weight="bold" />
            </button>
          </span>
        ))}
      </div>

      {/* 添加自定义时间 — 回车确认 */}
      <div className="flex items-center gap-2">
        <input
          ref={customTimeRef}
          type="text"
          value={customTimeInput}
          onChange={e => setCustomTimeInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTime() } }}
          placeholder="添加时间，如 07:30，按回车确认"
          className="flex-1 bg-bg-raised border border-border-main rounded-lg px-3.5 py-2 text-sm text-text-main placeholder:text-text-muted/65 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all"
        />
      </div>

      {/* 星期勾选 — 仅自定义模式 */}
      {freqMode === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted shrink-0">星期</span>
          {WEEKDAY_LABELS.map((label, i) => {
            const dayNum = i // 0=日, 1=一, ..., 6=六
            const active = weekdays.includes(dayNum)
            return (
              <button
                key={i}
                onClick={() => handleWeekdayToggle(dayNum)}
                className={`text-xs w-9 h-9 rounded-lg font-medium transition-all duration-150 cursor-pointer ${
                  active
                    ? 'bg-brand-green-hover text-white shadow-sm'
                    : 'bg-bg-raised border border-border-main text-text-muted hover:border-brand-green/40'
                }`}
              >{label}</button>
            )
          })}
        </div>
      )}

      {/* 高阶 Cron 设置 */}
      <div>
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main transition-colors cursor-pointer"
        >
          {advancedOpen ? <CaretDown size={10} /> : <CaretRight size={10} />}
          高阶 Cron 设置
        </button>
        <AnimatePresence>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-2 pl-2">
                <input
                  type="text"
                  value={cronExpr}
                  onChange={e => onCronExprChange(e.target.value)}
                  placeholder="0 9,18 * * 1-5"
                  className="w-full bg-bg-raised border border-border-main rounded-lg px-3.5 py-2 text-sm text-text-main font-mono placeholder:text-text-muted/65 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all"
                />
                <p className="text-xs text-text-muted/70">
                  5字段: 分 时 日 月 周。如 <code className="text-text-muted/70">0 9,18 * * 1-5</code> = 工作日9/18点
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DigestGroupCard({ dg, index, groups, expanded, profileExpanded, onToggleExpand, onToggleProfile, onToggleEnabled, onDelete, onSelectGroup, onScheduleChange, onCronExprChange, onLookbackChange, onProfileChange, onUnreadOnlyChange, onPushTargetChange }) {
  // 解析 cron/schedule 为 header 展示用
  const headerSchedule = dg.cron_expr
    ? cronToLabel(dg.cron_expr)
    : (dg.schedule || []).length > 0
      ? dg.schedule.join(' · ')
      : ''

  return (
    <div className="border border-border-main rounded-xl overflow-hidden transition-all duration-200 hover:border-border-main/80">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-bg-raised/30 transition-colors"
        onClick={onToggleExpand}
      >
        <Toggle enabled={dg.enabled} onChange={onToggleEnabled} />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-text-main font-medium truncate block">
            {dg.group_name || `摘要群 #${index + 1}`}
          </span>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {headerSchedule ? (
              <span className="text-xs px-1.5 py-0.5 rounded bg-brand-green/10 text-brand-green-hover dark:text-brand-green font-mono">{headerSchedule}</span>
            ) : (
              <span className="text-xs text-status-warn">未设置时间</span>
            )}
            {dg.lookback_hours && dg.lookback_hours !== 6 && (
              <span className="text-xs text-text-muted">{dg.lookback_hours}h</span>
            )}
            {dg.unread_only && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-status-warn-soft text-status-warn font-medium">未读</span>
            )}
            {dg.push_target === 'ilink' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-brand-green/10 text-brand-green-hover dark:text-brand-green font-medium">推送</span>
            )}
          </div>
        </div>
        <DeleteButton onDelete={onDelete} />
        <div className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <CaretDown size={16} className="text-text-muted" />
        </div>
      </div>
      {/* Body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-border-main/50 pt-4 mx-4">
              {/* Group select */}
              <div>
                <label className="text-xs text-text-muted block mb-1.5">选择群聊</label>
                <SearchableGroupSelect
                  groups={groups}
                  value={dg.chat_id || ''}
                  onChange={onSelectGroup}
                  placeholder="搜索群聊..."
                />
                {!dg.chat_id && dg.group_name && (
                  <p className="text-xs text-status-warn mt-1">历史群名：{dg.group_name}，请从下拉重新绑定</p>
                )}
              </div>
              {/* Schedule config */}
              <ScheduleConfig
                schedule={dg.schedule || []}
                cronExpr={dg.cron_expr || ''}
                onScheduleChange={onScheduleChange}
                onCronExprChange={onCronExprChange}
              />
              {/* Lookback */}
              <div>
                <label className="text-xs text-text-muted block mb-1.5">回溯时长</label>
                <div className="flex items-center gap-2">
                  {[3, 6, 12, 24].map(h => (
                    <button
                      key={h}
                      onClick={() => onLookbackChange(h)}
                      className={`text-xs px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                        dg.lookback_hours === h
                          ? 'bg-brand-green-hover text-white shadow-sm'
                          : 'bg-bg-raised border border-border-main text-text-muted hover:border-brand-green/40'
                      }`}
                    >{h}h</button>
                  ))}
                </div>
                {dg.unread_only && (
                  <p className="text-xs text-status-warn/80 mt-1">仅摘要该时间窗口内的未读消息</p>
                )}
              </div>
              {/* Unread only toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-text-muted">仅摘要未读</p>
                  <p className="text-xs text-text-muted/60 mt-0.5">开启后只在时间窗口内摘要未读消息，无未读则跳过</p>
                </div>
                <Toggle
                  enabled={dg.unread_only || false}
                  onChange={onUnreadOnlyChange}
                />
              </div>
              {/* Push to WeChat toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-text-muted">推送到微信</p>
                  <p className="text-xs text-text-muted/60 mt-0.5">开启后摘要结果自动推送到微信私聊（需先绑定 iLink Bot）</p>
                </div>
                <Toggle
                  enabled={dg.push_target === 'ilink'}
                  onChange={v => onPushTargetChange?.(v ? 'ilink' : '')}
                />
              </div>
              {/* Group profile */}
              <div>
                <button
                  onClick={onToggleProfile}
                  className="flex items-center gap-2 text-sm text-text-muted hover:text-text-main transition-colors cursor-pointer"
                >
                  {profileExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                  群档案 Profile
                  {dg.profile && (dg.profile.purpose || dg.profile.focus?.length || dg.profile.custom_prompt) ? (
                    <span className="text-xs text-brand-green">· 已填写</span>
                  ) : (
                    <span className="text-xs text-text-muted/60">· 可选</span>
                  )}
                </button>
                <AnimatePresence>
                  {profileExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 space-y-2.5 pl-4">
                        <ProfileInput label="群用途" value={dg.profile?.purpose || ''} placeholder="抢单群 / 客户群 / 行业交流群" onChange={v => onProfileChange({ purpose: v })} />
                        <ProfileInput label="群说明" value={dg.profile?.description || ''} placeholder="这个群主要聊什么" onChange={v => onProfileChange({ description: v })} />
                        <ProfileInput label="关注点（逗号分隔）" value={(dg.profile?.focus || []).join(', ')} placeholder="新需求, 报价, 截止时间" onChange={v => onProfileChange({ focus: v.split(',').map(s => s.trim()).filter(Boolean) })} />
                        <ProfileInput label="忽略内容（逗号分隔）" value={(dg.profile?.ignore || []).join(', ')} placeholder="闲聊, 表情, 广告" onChange={v => onProfileChange({ ignore: v.split(',').map(s => s.trim()).filter(Boolean) })} />
                        <ProfileInput label="摘要风格" value={dg.profile?.style || ''} placeholder="偏行动项 / 偏完整复盘 / 偏极简" onChange={v => onProfileChange({ style: v })} />
                        {/* Custom digest instruction */}
                        <div>
                          <label className="text-xs text-text-muted font-medium mb-1.5">自定义摘要指令</label>
                          <textarea
                            value={dg.profile?.custom_prompt || ''}
                            onChange={e => onProfileChange({ custom_prompt: e.target.value })}
                            placeholder="追加到摘要指令的额外要求。例如：用 Markdown 表格总结每个话题 / 只输出行动项 / 不要群聊气象小结..."
                            rows={3}
                            className="w-full bg-bg-main border border-border-main rounded-xl px-4 py-2.5 text-sm text-text-main
                              placeholder:text-text-muted/65 resize-none
                              focus:outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15"
                          />
                          <p className="text-xs text-text-muted/60 mt-1">填写后作为额外指令追加到摘要提示词中，不会替代默认模板</p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AlertGroupEditor({ draft, groups, error, onDraftChange, onSave, onCancel }) {
  return (
    <div className="border border-brand-green/30 rounded-xl p-4 space-y-3 bg-brand-green/[0.02]">
      <p className="text-sm text-brand-green font-semibold mb-1">新增提醒群</p>
      {error && <p className="text-xs text-status-error">{error}</p>}
      <div>
        <label className="text-xs text-text-muted block mb-1.5">选择群聊 <span className="text-status-error">*</span></label>
        <SearchableGroupSelect
          groups={groups}
          value={draft.chat_id || ''}
          onChange={chatId => {
            const selected = groups.find(g => g.chat_id === chatId)
            onDraftChange({ ...draft, chat_id: chatId, group_name: selected?.group_name || '' })
          }}
          placeholder="搜索群聊..."
        />
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1.5">关键词</label>
        <TagInput
          tags={draft.keywords || []}
          onChange={keywords => onDraftChange({ ...draft, keywords })}
          placeholder="输入关键词后按回车添加"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          className="text-sm px-5 py-2 rounded-lg bg-brand-green-hover text-white font-semibold hover:bg-brand-green-hover transition-colors cursor-pointer"
        >保存</button>
        <button
          onClick={onCancel}
          className="text-sm px-5 py-2 rounded-lg bg-bg-raised border border-border-main text-text-muted hover:text-text-main transition-colors cursor-pointer"
        >取消</button>
      </div>
    </div>
  )
}

function DigestGroupEditor({ draft, groups, error, onDraftChange, onSave, onCancel }) {
  const [profileOpen, setProfileOpen] = useState(false)
  return (
    <div className="border border-brand-green/30 rounded-xl p-4 space-y-3 bg-brand-green/[0.02]">
      <p className="text-sm text-brand-green font-semibold mb-1">新增摘要群</p>
      {error && <p className="text-xs text-status-error">{error}</p>}
      <div>
        <label className="text-xs text-text-muted block mb-1.5">选择群聊 <span className="text-status-error">*</span></label>
        <SearchableGroupSelect
          groups={groups}
          value={draft.chat_id || ''}
          onChange={chatId => {
            const selected = groups.find(g => g.chat_id === chatId)
            onDraftChange({ ...draft, chat_id: chatId, group_name: selected?.group_name || '' })
          }}
          placeholder="搜索群聊..."
        />
      </div>
      {/* Schedule config */}
      <ScheduleConfig
        schedule={draft.schedule || []}
        cronExpr={draft.cron_expr || ''}
        onScheduleChange={schedule => onDraftChange({ ...draft, schedule })}
        onCronExprChange={cron_expr => onDraftChange({ ...draft, cron_expr })}
      />
      {/* 回溯时长 */}
      <div>
        <label className="text-xs text-text-muted block mb-1.5">回溯时长</label>
        <div className="flex items-center gap-2">
          {[3, 6, 12, 24].map(h => (
            <button
              key={h}
              onClick={() => onDraftChange({ ...draft, lookback_hours: h })}
              className={`text-xs px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer ${
                draft.lookback_hours === h ? 'bg-brand-green-hover text-white shadow-sm' : 'bg-bg-raised border border-border-main text-text-muted hover:border-brand-green/40'
              }`}
            >{h}h</button>
          ))}
        </div>
      </div>
      {/* 仅摘要未读 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">仅摘要未读</p>
          <p className="text-xs text-text-muted/60 mt-0.5">开启后只在时间窗口内摘要未读消息，无未读则跳过</p>
        </div>
        <Toggle enabled={draft.unread_only || false} onChange={v => onDraftChange({ ...draft, unread_only: v })} />
      </div>
      {/* 推送到微信 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">推送到微信</p>
          <p className="text-xs text-text-muted/60 mt-0.5">开启后摘要结果自动推送到微信私聊（需先绑定 iLink Bot）</p>
        </div>
        <Toggle enabled={draft.push_target === 'ilink'} onChange={v => onDraftChange({ ...draft, push_target: v ? 'ilink' : '' })} />
      </div>
      {/* Profile */}
      <div>
        <button
          onClick={() => setProfileOpen(!profileOpen)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-main transition-colors cursor-pointer"
        >
          {profileOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
          群档案 Profile
          <span className="text-xs text-text-muted/60">· 可选</span>
        </button>
        <AnimatePresence>
          {profileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-2.5 pl-4">
                <ProfileInput label="群用途" value={draft.profile?.purpose || ''} placeholder="抢单群 / 客户群 / 行业交流群" onChange={v => onDraftChange({ ...draft, profile: { ...draft.profile, purpose: v } })} />
                <ProfileInput label="群说明" value={draft.profile?.description || ''} placeholder="这个群主要聊什么" onChange={v => onDraftChange({ ...draft, profile: { ...draft.profile, description: v } })} />
                <ProfileInput label="关注点（逗号分隔）" value={(draft.profile?.focus || []).join(', ')} placeholder="新需求, 报价, 截止时间" onChange={v => onDraftChange({ ...draft, profile: { ...draft.profile, focus: v.split(',').map(s => s.trim()).filter(Boolean) } })} />
                <ProfileInput label="忽略内容（逗号分隔）" value={(draft.profile?.ignore || []).join(', ')} placeholder="闲聊, 表情, 广告" onChange={v => onDraftChange({ ...draft, profile: { ...draft.profile, ignore: v.split(',').map(s => s.trim()).filter(Boolean) } })} />
                <ProfileInput label="摘要风格" value={draft.profile?.style || ''} placeholder="偏行动项 / 偏完整复盘 / 偏极简" onChange={v => onDraftChange({ ...draft, profile: { ...draft.profile, style: v } })} />
                {/* Custom digest instruction */}
                <div>
                  <label className="text-xs text-text-muted font-medium mb-1.5">自定义摘要指令</label>
                  <textarea
                    value={draft.profile?.custom_prompt || ''}
                    onChange={e => onDraftChange({ ...draft, profile: { ...draft.profile, custom_prompt: e.target.value } })}
                    placeholder="追加到摘要指令的额外要求。例如：用 Markdown 表格总结每个话题 / 只输出行动项 / 不要群聊气象小结..."
                    rows={3}
                    className="w-full bg-bg-main border border-border-main rounded-xl px-4 py-2.5 text-sm text-text-main
                      placeholder:text-text-muted/65 resize-none
                      focus:outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15"
                  />
                  <p className="text-xs text-text-muted/60 mt-1">填写后作为额外指令追加到摘要提示词中，不会替代默认模板</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          className="text-sm px-5 py-2 rounded-lg bg-brand-green-hover text-white font-semibold hover:bg-brand-green-hover transition-colors cursor-pointer"
        >保存</button>
        <button
          onClick={onCancel}
          className="text-sm px-5 py-2 rounded-lg bg-bg-raised border border-border-main text-text-muted hover:text-text-main transition-colors cursor-pointer"
        >取消</button>
      </div>
    </div>
  )
}

function DeleteButton({ onDelete }) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-status-error font-medium">确认?</span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); setConfirming(false) }}
          className="text-xs px-2.5 py-1 rounded bg-status-error text-bg-main font-medium cursor-pointer"
        >是</button>
        <button
          onClick={e => { e.stopPropagation(); setConfirming(false) }}
          className="text-xs px-2.5 py-1 rounded bg-bg-raised border border-border-main text-text-muted font-medium cursor-pointer"
        >否</button>
      </div>
    )
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setConfirming(true) }}
      className="text-sm text-text-muted hover:text-status-error shrink-0 px-2 py-1.5 transition-colors cursor-pointer"
    >
      <Trash size={16} />
    </button>
  )
}

function ProfileInput({ label, value, placeholder, onChange }) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg-raised border border-border-main rounded-lg px-3.5 py-2 text-sm text-text-main placeholder:text-text-muted/60 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all"
      />
    </div>
  )
}

function NotificationCard({ notification, onAck, onIgnore }) {
  const statusColor = statusColors[notification.status] || '#a0aec0'
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
            <span className="text-xs text-text-muted/70">{notification.created_at}</span>
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

function SearchableGroupSelect({ groups, value, onChange, placeholder, allowClear }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = groups.find(g => g.chat_id === value)
  const filtered = query
    ? groups.filter(g => g.group_name.toLowerCase().includes(query.toLowerCase()))
    : groups

  const displayText = open ? query : (selected ? `${selected.group_name}（${selected.member_count} 人）` : '')

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={displayText}
          placeholder={placeholder || '搜索群聊...'}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          className="w-full bg-bg-raised border border-border-main rounded-lg pl-9 pr-4 py-2 text-[14px] text-text-main placeholder:text-text-muted/65 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15 transition-all"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-bg-card border border-border-main rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {allowClear && value && (
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm text-text-muted hover:bg-bg-raised transition-colors border-b border-border-main/50"
              onClick={() => { onChange(''); setQuery(''); setOpen(false) }}
            >全部群聊</button>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-text-muted text-center">无匹配群聊</p>
          ) : (
            filtered.map(g => (
              <button
                key={g.chat_id}
                type="button"
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-bg-raised transition-colors flex items-center justify-between gap-2 ${
                  g.chat_id === value ? 'bg-brand-green/10 text-brand-green-hover' : 'text-text-main'
                }`}
                onClick={() => { onChange(g.chat_id); setQuery(''); setOpen(false) }}
              >
                <span className="truncate">{g.group_name}</span>
                <span className="text-xs text-text-muted shrink-0">{g.member_count} 人</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
