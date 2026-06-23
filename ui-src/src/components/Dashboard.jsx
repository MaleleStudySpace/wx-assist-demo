import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Stop, Key, Spinner, CheckCircle, XCircle, ArrowsClockwise, WarningOctagon, Clock, ChatCircle, Newspaper, Database, WechatLogo, Brain, Robot, Cube } from '@phosphor-icons/react'
import { API_BASE } from './SharedComponents'

const spring = { type: 'spring', stiffness: 100, damping: 20 }
const easeOut = [0.16, 1, 0.3, 1]

/* ── Status check tile ─── */
function StatusTile({ icon: Icon, label, ok, okText, errText, detail }) {
  return (
    <motion.div
      whileHover={{ y: -1, transition: { duration: 0.15 } }}
      className={`flex items-center gap-2.5 px-4 py-3 rounded-xl transition-colors cursor-default ${
        ok
          ? 'bg-bg-raised hover:bg-border-main/30'
          : 'bg-status-error/[0.04] dark:bg-status-error/[0.06] hover:bg-status-error/[0.08]'
      }`}
    >
      <Icon size={16} weight="fill" className={ok ? 'text-brand-green' : 'text-status-error/60'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-main font-semibold">{label}</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={ok ? 'ok' : 'err'}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ duration: 0.2, type: 'spring', stiffness: 400 }}
              className={`text-[11px] font-mono font-bold ${ok ? 'text-brand-green' : 'text-status-error'}`}
            >
              {ok ? okText : errText}
            </motion.span>
          </AnimatePresence>
        </div>
        {detail && <p className="text-[11px] text-text-muted/60 truncate mt-0.5">{detail}</p>}
      </div>
    </motion.div>
  )
}

/* ── Scheduled Task Card — neutral borders, no colored bg ─── */
const TASK_TYPE_META = {
  group_digest: {
    icon: ChatCircle,
    label: '群聊摘要',
    accent: 'text-brand-green',
    badge: 'bg-brand-green/[0.08] text-brand-green dark:bg-brand-green/[0.10]',
    leftBorder: 'border-l-brand-green/40',
  },
  oa_digest: {
    icon: Newspaper,
    label: '公众号摘要',
    accent: 'text-[#8b5cf6]',
    badge: 'bg-[#8b5cf6]/[0.08] text-[#8b5cf6] dark:bg-[#8b5cf6]/[0.10]',
    leftBorder: 'border-l-[#8b5cf6]/40',
  },
}

function TaskCard({ task, index }) {
  const meta = TASK_TYPE_META[task.type] || {
    icon: Clock, label: '定时任务',
    accent: 'text-brand-green', badge: 'bg-brand-green/[0.08] text-brand-green',
    leftBorder: 'border-l-brand-green/40',
  }
  const Icon = meta.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: task.enabled ? 1 : 0.45, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: easeOut }}
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-border-main border-l-2 ${meta.leftBorder} bg-bg-raised/50 dark:bg-bg-raised/30`}
    >
      {/* Type icon badge */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.badge}`}>
        <Icon size={15} weight="fill" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Row 1: Type + Name */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${meta.accent}`}>
            {meta.label}
          </span>
          {task.name && (
            <>
              <span className="text-text-muted/25">/</span>
              <span className="text-[13px] text-text-main font-semibold">{task.name}</span>
            </>
          )}
        </div>

        {/* Row 2: Schedule + details */}
        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px]">
          <span className="flex items-center gap-1 text-text-muted">
            <Clock size={10} weight="fill" className="text-text-muted/50" />
            {task.schedule || '手动触发'}
          </span>

          {task.type === 'group_digest' && (
            <>
              <span className="text-text-muted/25">|</span>
              <span className="text-text-muted/70">
                {task.mode === '仅未读' ? `近 ${task.lookback} 条未读` : `近 ${task.lookback} 条全部`}
              </span>
              {task.push && task.push !== '不推送' && (
                <>
                  <span className="text-text-muted/25">|</span>
                  <span className="text-brand-green/80 font-medium">{task.push}</span>
                </>
              )}
            </>
          )}

          {task.type === 'oa_digest' && (
            <>
              {task.account_count > 0 && (
                <>
                  <span className="text-text-muted/25">|</span>
                  <span className="text-text-muted/70">{task.account_count} 个公众号</span>
                </>
              )}
              <span className="text-text-muted/25">|</span>
              <span className={task.push && task.push !== '不推送' ? 'text-brand-green/80 font-medium' : 'text-text-muted/50'}>
                {task.push && task.push !== '不推送' ? task.push : '不推送'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Enabled dot */}
      <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-2.5 ${task.enabled ? 'bg-brand-green' : 'bg-text-muted/20'}`} />
    </motion.div>
  )
}

function ScheduledTasksCard() {
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/scheduled-tasks`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d.data) })
      .catch(() => {})
  }, [])

  if (!data || data.total === 0) return (
    <div className="flex items-center gap-2 py-8 justify-center">
      <Clock size={16} className="text-text-muted/30" />
      <span className="text-[13px] text-text-muted/40">暂无定时任务</span>
    </div>
  )

  const enabledCount = data.tasks.filter(t => t.enabled).length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-[13px] text-text-main font-semibold">{data.total} 个任务</span>
        {enabledCount > 0 && (
          <span className="text-[11px] font-mono font-bold text-brand-green bg-brand-green/[0.08] px-2 py-0.5 rounded-md">
            {enabledCount} 启用
          </span>
        )}
        {data.total - enabledCount > 0 && (
          <span className="text-[11px] font-mono text-text-muted/50 bg-bg-raised px-2 py-0.5 rounded-md">
            {data.total - enabledCount} 禁用
          </span>
        )}
      </div>
      {data.tasks.map((task, i) => (
        <TaskCard key={i} task={task} index={i} />
      ))}
    </div>
  )
}

const aiLabels = { deepseek: 'DeepSeek', claude: 'Claude' }

/* ═══════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════ */
export default function Dashboard({ status }) {
  const [busy, setBusy] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagResult, setDiagResult] = useState(null)

  const uptimeMin = Math.floor(status.uptime_sec / 60)
  const uptimeStr = uptimeMin < 60
    ? `${uptimeMin}m`
    : uptimeMin < 1440
      ? `${Math.floor(uptimeMin / 60)}h${uptimeMin % 60}m`
      : `${Math.floor(uptimeMin / 1440)}d${Math.floor((uptimeMin % 1440) / 60)}h`

  async function handleToggle() {
    setBusy(true)
    try {
      await fetch(`${API_BASE}${status.running ? '/api/stop' : '/api/start'}`, { method: 'POST' })
    } catch {}
    setTimeout(() => setBusy(false), 1000)
  }

  async function triggerDiagnostics() {
    setDiagnosing(true)
    setDiagResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/diagnose`)
      const d = await res.json()
      if (d.ok) {
        setDiagResult(d.diagnostics)
      } else {
        setDiagResult({ _error: d.error || '获取检查结果失败' })
      }
    } catch {
      setDiagResult({ _error: '无法连接后端' })
    }
    setTimeout(() => setDiagnosing(false), 850)
  }

  const groupCountStr = status.group_count < 0 ? '全部' : status.group_count === 0 ? '' : `${status.group_count} 群`

  return (
    <div className="relative z-10 space-y-5">

      {/* ── Error banner ─── */}
      {status.error && !status.error.includes('KEY_MISSING') && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 px-5 py-3 bg-status-error-soft border border-status-error/20 rounded-xl text-[13px] text-status-error font-medium">
          <WarningOctagon size={14} weight="fill" />
          <span>{status.error}</span>
        </motion.div>
      )}
      {status.error && status.error.includes('KEY_MISSING') && <KeyExtractionBanner />}

      {/* ── Hero service card ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, duration: 0.6 }}
        className="bg-bg-card border border-border-main rounded-2xl overflow-hidden"
      >
        {/* Top accent line */}
        <div className={`h-[2px] transition-colors duration-700 ${status.running ? 'bg-brand-green/50' : 'bg-bg-inset'}`} />
        <div className="px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Robot icon */}
            <div className={`relative w-14 h-14 rounded-2xl flex items-center justify-center transition-colors duration-500 ${
              status.running ? 'bg-brand-green/[0.08] dark:bg-brand-green/[0.06]' : 'bg-bg-inset'
            }`}>
              {status.running && (
                <motion.div
                  className="absolute inset-0 rounded-2xl border border-brand-green/15"
                  animate={{ scale: [1, 1.1, 1], opacity: [0.25, 0, 0.25] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <Robot size={26} weight="fill" className={`relative z-10 transition-colors duration-500 ${status.running ? 'text-brand-green' : 'text-text-muted/30'}`} />
            </div>

            <div>
              <AnimatePresence mode="wait">
                <motion.h2
                  key={status.running ? 'on' : 'off'}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-[17px] font-semibold text-text-main leading-tight"
                >
                  {status.running ? '助手服务运行中' : '助手服务已停止'}
                </motion.h2>
              </AnimatePresence>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {status.running && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-brand-green/[0.08] text-brand-green dark:bg-brand-green/[0.10]">
                    <Cube size={9} weight="fill" />
                    {aiLabels[status.ai_backend] || '-'}
                    {status.model_name && <span className="opacity-60 ml-0.5">{status.model_name}</span>}
                  </span>
                )}
                <span className="text-[11px] text-text-muted font-mono">
                  {status.messages_processed.toLocaleString()} 条消息
                </span>
                <span className="text-text-muted/20">|</span>
                <span className="text-[11px] text-text-muted font-mono">运行 {uptimeStr}</span>
                {groupCountStr && (
                  <>
                    <span className="text-text-muted/20">|</span>
                    <span className="text-[11px] text-text-muted font-mono">{groupCountStr}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            onClick={handleToggle} disabled={busy}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50 cursor-pointer ${
              status.running
                ? 'bg-bg-raised text-text-main border border-border-main hover:bg-status-error-soft hover:text-status-error hover:border-status-error/20'
                : 'bg-brand-green text-white hover:opacity-90'
            }`}
          >
            {status.running ? <><Stop size={14} weight="fill" /> 停止服务</> : <><Play size={14} weight="fill" /> 启动服务</>}
          </motion.button>
        </div>
      </motion.div>

      {/* ── System health ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.08, duration: 0.5 }}
        className="bg-bg-card border border-border-main rounded-2xl overflow-hidden"
      >
        <div className="h-[2px] bg-status-info/20" />
        <div className="px-6 py-4 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-text-main">系统健康</h3>
          <button
            onClick={triggerDiagnostics}
            disabled={diagnosing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-text-muted bg-bg-raised border border-border-main/50 hover:text-brand-green hover:border-brand-green/20 transition-all cursor-pointer disabled:opacity-50"
          >
            <ArrowsClockwise size={12} className={diagnosing ? 'animate-spin' : ''} />
            环境检查
          </button>
        </div>

        <div className="px-6 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusTile icon={Database} label="数据库" ok={status.db_ok} okText="正常" errText="异常" />
          <StatusTile icon={WechatLogo} label="微信" ok={status.wechat_online} okText="在线" errText="离线" />
          <StatusTile icon={Brain} label="AI 后端" ok={status.ai_ok} okText="可达" errText="未响应"
            detail={status.ai_ok ? (status.model_name || aiLabels[status.ai_backend] || '') : '未检测或未成功调用'} />
          <StatusTile icon={Robot} label="助手服务" ok={status.running} okText="运行" errText="停止"
            detail={status.running ? `已运行 ${uptimeStr}` : ''} />
        </div>

        {diagResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={{ duration: 0.3, ease: easeOut }}
            className="px-6 pb-4 pt-3 border-t border-border-main/50 space-y-1.5"
          >
            {diagResult._error ? (
              <span className="text-[13px] text-status-error font-medium">{diagResult._error}</span>
            ) : (
              Object.entries(diagResult).map(([key, item]) => (
                <div key={key} className="flex items-center gap-2">
                  {item.ok
                    ? <CheckCircle size={13} weight="fill" className="text-brand-green flex-shrink-0" />
                    : <XCircle size={13} weight="fill" className="text-status-error flex-shrink-0" />
                  }
                  <span className="text-[12px] text-text-main font-medium">{item.label || key}</span>
                  {!item.ok && item.detail && (
                    <span className="text-[11px] text-status-error/80 font-mono">{item.detail}</span>
                  )}
                </div>
              ))
            )}
          </motion.div>
        )}
      </motion.div>

      {/* ── Scheduled tasks ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.16, duration: 0.5 }}
        className="bg-bg-card border border-border-main rounded-2xl overflow-hidden"
      >
        <div className="h-[2px] bg-brand-green/15" />
        <div className="px-6 py-4 flex items-center gap-2">
          <Clock size={15} className="text-text-muted" weight="fill" />
          <h3 className="text-[14px] font-semibold text-text-main">定时任务</h3>
        </div>
        <div className="px-6 pb-5">
          <ScheduledTasksCard />
        </div>
      </motion.div>
    </div>
  )
}


// ── Key extraction banner ─────────────────────────────

const API = API_BASE
const EXTRACTION_PHASE_MAP = {
  hooking:         { label: '正在尝试直接获取...' },
  waiting_exit:    { label: '请退出微信' },
  waiting_login:   { label: '等待登录微信' },
  hooking_restart: { label: '正在安装 Hook...' },
}

function KeyExtractionBanner() {
  const [phase, setPhase] = useState('idle')
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function handleExtract() {
    setBusy(true)
    setPhase('extracting')
    setMsg('正在准备...')
    setResult(null)
    try {
      await fetch(`${API}/api/onboarding/reset`, { method: 'POST' })
      const startRes = await fetch(`${API}/api/onboarding/step1`, { method: 'POST' })
      const start = await startRes.json()
      if (!start.ok) {
        setPhase('error')
        setMsg(start.message || '启动失败，请稍后重试')
        setBusy(false)
        return
      }

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API}/api/onboarding/step1-status`)
          const s = await res.json()

          if (s.phase === 'waiting_exit' || s.phase === 'waiting_login'
              || s.phase === 'hooking' || s.phase === 'hooking_restart') {
            setPhase(s.phase)
            setMsg(s.message || '')
          } else if (s.phase === 'done' && s.result) {
            clearInterval(pollRef.current)
            pollRef.current = null
            setPhase('done')
            setMsg('')
            setResult(s.result)
            setBusy(false)
          } else if (s.phase === 'timeout' || s.phase === 'error') {
            clearInterval(pollRef.current)
            pollRef.current = null
            setPhase(s.phase)
            setMsg(s.message || (s.phase === 'timeout' ? '超时，请重试' : '提取失败'))
            setBusy(false)
          }
        } catch {}
      }, 1000)
    } catch {
      setPhase('error')
      setMsg('无法连接服务器')
      setBusy(false)
    }
  }

  const phaseMeta = EXTRACTION_PHASE_MAP[phase]
  const isDone = phase === 'done'

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col gap-3.5 p-5 rounded-xl border transition-all duration-500 ${
        isDone
          ? 'bg-brand-green/[0.06] border-brand-green/20 text-brand-green-hover dark:text-brand-green'
          : 'bg-status-error-soft border-status-error/20 text-status-error'
      }`}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        {isDone ? (
          <CheckCircle size={16} weight="fill" className="text-brand-green" />
        ) : (
          <WarningOctagon size={14} weight="fill" />
        )}
        <span>{isDone ? '密钥获取成功 - 请重启机器人' : '加密密钥缺失 - 需要重新获取才能读取微信消息'}</span>
      </div>

      {phase !== 'idle' && phase !== 'done' && phase !== 'timeout' && phase !== 'error' && phaseMeta && (
        <motion.div initial={{opacity:0}} animate={{opacity:1}}
          className="flex items-center gap-3 p-3.5 rounded-lg border border-status-info/20 bg-status-info-soft">
          <Spinner size={18} weight="bold" className="animate-spin text-status-info" />
          <div>
            <p className="text-[13px] font-semibold text-status-info">{phaseMeta.label}</p>
            <p className="text-xs text-status-info/80 mt-0.5 font-medium">{msg}</p>
          </div>
        </motion.div>
      )}

      {phase === 'done' && result && (
        <motion.div initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} className="grid grid-cols-2 gap-3">
          <div className="bg-bg-raised border border-border-main rounded-lg p-3.5">
            <p className="text-xs text-text-muted mb-1 font-medium">微信账号</p>
            <p className="text-sm font-mono text-text-main font-bold truncate">{result.wxid || '-'}</p>
          </div>
          <div className="bg-bg-raised border border-border-main rounded-lg p-3.5">
            <p className="text-xs text-text-muted mb-1 font-medium">数据路径</p>
            <p className="text-xs font-mono text-text-main font-semibold truncate">{result.db_path ? result.db_path.split('\\').slice(-2).join('\\') : '-'}</p>
          </div>
        </motion.div>
      )}

      {(phase === 'error' || phase === 'timeout') && (
        <motion.div initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}}
          className="flex items-start gap-2.5 p-3.5 bg-status-warn-soft border border-status-warn/20 rounded-lg">
          <XCircle size={18} weight="fill" className="text-status-warn shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] text-status-warn font-semibold">{phase === 'timeout' ? '获取超时' : '提取失败'}</p>
            <p className="text-xs text-status-warn/85 mt-0.5 font-medium">{msg}</p>
          </div>
        </motion.div>
      )}

      {phase !== 'done' && (
        <motion.button
          whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.02 }}
          onClick={handleExtract}
          disabled={busy}
          className="flex items-center justify-center gap-2 w-44 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 disabled:opacity-50 cursor-pointer bg-status-error hover:opacity-90 text-white"
        >
          {busy ? (
            <><Spinner size={13} weight="bold" className="animate-spin" /> 获取中...</>
          ) : phase === 'timeout' || phase === 'error' ? (
            <><Key size={13} weight="fill" /> 重试</>
          ) : (
            <><Key size={13} weight="fill" /> 重新获取密钥</>
          )}
        </motion.button>
      )}
    </motion.div>
  )
}
