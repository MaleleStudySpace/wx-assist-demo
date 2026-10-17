import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Microphone, PhoneDisconnect, SpeakerHigh, SpeakerSlash, ArrowCounterClockwise,
  CheckCircle, Lightning, Waveform, Play, Check,
} from '@phosphor-icons/react'

/* ─────────────────────────────────────────────────────────────────────
   VoiceTab — 「语音对话」功能演示（纯本地演绎）

   - 真实语音：全部由千问 TTS 预生成（助手 Cherry 女声 / 用户 Ethan 男声），
     随静态资源打包，运行时只播放，不暴露任何 Key。
   - 三段对话，覆盖：多轮对话 · 随时打断 · 工具调用（群摘要 / 收藏检索 / 创建提醒）· 结果推微信。
   - 通话界面参照主项目 VoiceCall：通道名牌 / 阶段状态 / 实时转写 / 工具调用 / 挂断。
   ───────────────────────────────────────────────────────────────────── */

const CLIP = {
  greeting: '/audio/ai_cherry_greeting.mp3',
  askGroup: '/audio/user_ethan_ask_group.mp3',
  ansGroup: '/audio/ai_cherry_answer_group.mp3',
  askFav: '/audio/user_ethan_ask_fav.mp3',
  ansFav: '/audio/ai_cherry_answer_fav.mp3',
  askRemind: '/audio/user_ethan_ask_remind.mp3',
  ansRemind: '/audio/ai_cherry_answer_remind.mp3',
}

const SUB = {
  greeting: 'Hi，我是摘星，你的个人微信助手。我能帮你总结群聊、翻收藏、盯公众号，还能设提醒、把结果推到微信。需要我做什么？',
  askGroup: '帮我看看工作群今天都聊了啥？',
  ansGroup: '今天工作群 186 条消息，重点有 3 条：① 数据库死锁，已通知全员停止合码；② 客户发布会提前到周五，今晚全员对齐方案；③ 报销通道今晚 24 点关闭。',
  askFav: '等等，先帮我找一下收藏里关于财报的资料。',
  ansFav: '在你的收藏里找到 3 条财报相关的：一份季度财务分析、一篇财报解读，还有一段群里的营收讨论。要我把这几条一起推给你吗？',
  askRemind: '再帮我设个提醒，明天上午十点提醒我看财报。',
  ansRemind: '好的，已经设好提醒：明天上午十点，看财报。会推送到你的微信，到时提醒你。',
}

const CHANNEL_BADGE = {
  text: '实时双工 · 火山豆包',
  cls: 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30',
}

const PHASE_TEXT = {
  connecting: '正在接通…',
  listening: '聆听中，随时可以开口',
  thinking: '思考中…',
  speaking: '正在回答',
  ended: '通话已结束',
}

const CAPS = [
  { id: 'multi', label: '多轮对话' },
  { id: 'barge', label: '随时打断' },
  { id: 'tool', label: '工具调用' },
  { id: 'push', label: '结果推微信' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── 声波律动条 ── */
function LevelBars({ active, count = 30 }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-14">
      {Array.from({ length: count }).map((_, i) => (
        <motion.span key={i}
          className={`w-[3px] rounded-full ${active ? 'bg-emerald-400' : 'bg-white/20'}`}
          animate={active ? { height: [6, 10 + ((i * 37) % 34), 6] } : { height: 6 }}
          transition={active
            ? { duration: 0.7 + (i % 5) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: (i % 7) * 0.06 }
            : { duration: 0.35 }} />
      ))}
    </div>
  )
}

/* ── 手机通话界面 ── */
function CallScreen({
  phase, seconds, lines, toolsDone, pushed, muted, ended, interrupted, onEnd, onMute, onReplay,
}) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const speaking = phase === 'speaking'
  const listening = phase === 'listening'
  const visible = lines.slice(-5)

  return (
    <div className="w-full max-w-[360px] mx-auto shrink-0 order-first lg:order-none lg:ml-auto lg:mr-0">
      <div className="h-[640px] rounded-[44px] relative flex flex-col overflow-hidden border-[5px] border-[#1a1a1a]"
        style={{
          background: 'radial-gradient(120% 80% at 50% 0%, #123a2e 0%, #0b1411 45%, #070a09 100%)',
          boxShadow: '0 30px 70px -10px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.08)',
        }}>
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[110px] h-[30px] bg-black rounded-[16px] z-[100]" />

        <div className="h-12 px-7 pt-4 flex justify-between text-white/90 text-[15px] font-semibold shrink-0 z-50">
          <span>{mm}:{ss}</span>
          <span className="text-xs flex items-center gap-1.5">
            <svg width="14" height="10" viewBox="0 0 14 10">
              <rect x="0.5" y="6" width="2.5" height="3.5" rx="0.6" fill="currentColor" />
              <rect x="3.5" y="4" width="2.5" height="5.5" rx="0.6" fill="currentColor" />
              <rect x="6.5" y="2" width="2.5" height="7.5" rx="0.6" fill="currentColor" />
              <rect x="9.5" y="0" width="2.5" height="9.5" rx="0.6" fill="currentColor" opacity="0.35" />
            </svg>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>5G</span>
            <svg width="20" height="11" viewBox="0 0 20 11">
              <rect x="0.5" y="1" width="15" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="2" y="2.5" width="12" height="5.5" rx="1" fill="currentColor" />
              <path d="M16.5 3.5 L18.5 3.5 L18.5 7.5 L16.5 7.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <div className="flex justify-center shrink-0">
          <span className={`text-[11px] font-semibold px-3 py-1 rounded-full backdrop-blur ${CHANNEL_BADGE.cls}`}>
            {CHANNEL_BADGE.text}
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
          <div className="relative mb-3">
            <div className="w-[76px] h-[76px] rounded-full bg-[#07c160]/12 ring-1 ring-[#07c160]/30 flex items-center justify-center">
              <Waveform size={32} weight="fill" className="text-emerald-400" />
            </div>
            {(speaking || listening) && (
              <>
                <motion.span className="absolute inset-0 rounded-full ring-2 ring-emerald-400/40"
                  animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />
                <motion.span className="absolute inset-0 rounded-full ring-2 ring-emerald-400/30"
                  animate={{ scale: [1, 1.75], opacity: [0.4, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: 0.6 }} />
              </>
            )}
          </div>

          <div className="text-white text-[16px] font-semibold mb-0.5">摘星</div>
          <div className="text-white/50 text-[12px] mb-2">{PHASE_TEXT[phase] || ''}</div>

          <LevelBars active={speaking || listening} />
        </div>

        <div className="px-4 min-h-0">
          <div className="h-[160px] flex flex-col justify-end gap-1.5 overflow-hidden"
            style={{ WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 24px)', maskImage: 'linear-gradient(to bottom, transparent 0, #000 24px)' }}>
            <AnimatePresence initial={false}>
              {visible.map((l) => (
                <motion.div key={`${l.role}-${l.id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={`max-w-[88%] px-3 py-1.5 rounded-2xl text-[12px] leading-relaxed ${
                    l.role === 'user'
                      ? 'self-end rounded-br-md bg-white/10 text-white/90'
                      : 'self-start rounded-bl-md bg-[#07c160]/15 ring-1 ring-[#07c160]/25 text-white/95'
                  }`}>
                  {l.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* 打断提示 */}
          <div className="h-[24px] flex items-center">
            <AnimatePresence>
              {interrupted && (
                <motion.div key="barge" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/15 ring-1 ring-amber-400/30 text-[10.5px] text-amber-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  你插话了 · 已停止播报，重新聆听
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 工具调用（累计，最多显示 3 条） */}
          <div className="flex flex-wrap gap-1.5 min-h-[30px]">
            <AnimatePresence>
              {toolsDone.slice(-3).map((t) => (
                <motion.div key={t.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/30 ring-1 ring-white/10">
                  <Lightning size={11} weight="fill" className="text-emerald-400 shrink-0" />
                  <span className="text-[10.5px] text-white/80">{t.label}</span>
                  <span className="text-[10px] text-emerald-400 font-semibold">{t.hint}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="px-8 pb-4 pt-1.5 shrink-0">
          <div className="flex items-center justify-center gap-5">
            <button onClick={onMute}
              className={`w-13 h-13 rounded-full flex items-center justify-center backdrop-blur transition ${muted ? 'bg-white/20 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'}`}
              style={{ width: 52, height: 52 }}>
              {muted ? <SpeakerSlash size={20} weight="fill" /> : <SpeakerHigh size={20} weight="fill" />}
            </button>

            {ended ? (
              <button onClick={onReplay}
                className="h-[52px] px-6 rounded-full flex items-center justify-center gap-2 bg-emerald-500 text-black font-semibold text-[14px] hover:opacity-90 transition">
                <ArrowCounterClockwise size={19} weight="bold" /> 重新演示
              </button>
            ) : (
              <button onClick={onEnd}
                className="rounded-full flex items-center justify-center bg-[#ff4d4f] text-white hover:opacity-90 transition"
                style={{ width: 52, height: 52 }} title="挂断">
                <PhoneDisconnect size={22} weight="fill" />
              </button>
            )}
          </div>

          {pushed && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-emerald-300">
              <CheckCircle size={13} weight="fill" /> 结果已推送到微信
            </motion.div>
          )}
        </div>

        <div className="h-[20px] flex justify-center items-end pb-1.5 shrink-0">
          <div className="w-[130px] h-[5px] bg-white/70 rounded-[100px]" />
        </div>
      </div>
    </div>
  )
}

/* ── 主组件 ── */
export default function VoiceTab() {
  const [runId, setRunId] = useState(0)
  const [phase, setPhase] = useState('connecting')
  const [seconds, setSeconds] = useState(0)
  const [lines, setLines] = useState([])
  const [toolsDone, setToolsDone] = useState([])
  const [pushed, setPushed] = useState(false)
  const [muted, setMuted] = useState(false)
  const [ended, setEnded] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const [usedCaps, setUsedCaps] = useState([])
  const [soundBlocked, setSoundBlocked] = useState(false)

  const linesRef = useRef([])
  const idRef = useRef(0)
  const mutedRef = useRef(false)
  const audioRef = useRef(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    mutedRef.current = muted
    if (audioRef.current) audioRef.current.muted = muted
  }, [muted])

  useEffect(() => {
    if (ended) return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [ended, runId])

  // 播放一段真实语音（maxMs 用于"打断"提前收尾）
  async function playClip(src, fallbackMs, maxMs = 0) {
    if (mutedRef.current) { await sleep(maxMs || fallbackMs); return }
    return new Promise((resolve) => {
      const a = new Audio(src)
      a.muted = mutedRef.current
      audioRef.current = a
      let done = false
      const finish = () => {
        if (done) return
        done = true
        try { a.pause() } catch { /* noop */ }
        audioRef.current = null
        resolve()
      }
      a.onended = finish
      a.onerror = finish
      a.play().then(() => {
        setTimeout(finish, maxMs || 30000)
      }).catch(() => { setSoundBlocked(true); setTimeout(finish, maxMs || fallbackMs) })
      if (maxMs) setTimeout(finish, maxMs + 60)
    })
  }

  async function typeLine(role, full, perChar = 38) {
    linesRef.current = [...linesRef.current, { role, text: '', id: ++idRef.current }]
    setLines(linesRef.current)
    for (let i = 1; i <= full.length; i++) {
      if (!aliveRef.current) return
      const idx = linesRef.current.length - 1
      const arr = [...linesRef.current]
      arr[idx] = { ...arr[idx], text: full.slice(0, i) }
      linesRef.current = arr
      setLines(arr)
      await sleep(perChar)
    }
  }

  const markCap = (id) => setUsedCaps((prev) => (prev.includes(id) ? prev : [...prev, id]))

  // 自动演绎脚本
  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    const alive = () => !cancelled && aliveRef.current

    async function run() {
      linesRef.current = []; idRef.current = 0
      setLines([]); setToolsDone([]); setPushed(false); setEnded(false); setSeconds(0)
      setInterrupted(false); setUsedCaps([])

      setPhase('connecting'); await sleep(1400); if (!alive()) return

      // ① 问候
      setPhase('speaking')
      await Promise.all([typeLine('ai', SUB.greeting, 34), playClip(CLIP.greeting, 8000)]); if (!alive()) return
      await sleep(300); if (!alive()) return

      // ② 第一轮：群聊摘要
      markCap('multi')
      setPhase('listening'); await sleep(250); if (!alive()) return
      await Promise.all([typeLine('user', SUB.askGroup, 50), playClip(CLIP.askGroup, 2600)]); if (!alive()) return
      await sleep(350); if (!alive()) return

      setPhase('thinking'); await sleep(900); if (!alive()) return
      markCap('tool'); setToolsDone([{ label: '翻看工作群消息', hint: '186 条' }])
      await sleep(900); if (!alive()) return
      setToolsDone([{ label: '翻看工作群消息', hint: '186 条' }, { label: 'AI 提炼群聊摘要', hint: '已生成' }])
      await sleep(800); if (!alive()) return

      // ③ 播报中被打断
      setPhase('speaking')
      await Promise.all([typeLine('ai', SUB.ansGroup, 30), playClip(CLIP.ansGroup, 9000, 4200)]); if (!alive()) return
      setInterrupted(true); markCap('barge')
      await sleep(700); if (!alive()) return

      // ④ 第二轮：收藏检索
      setPhase('listening'); await sleep(200); if (!alive()) return
      await Promise.all([typeLine('user', SUB.askFav, 50), playClip(CLIP.askFav, 3200)]); if (!alive()) return
      await sleep(250); if (!alive()) return
      setInterrupted(false)

      setPhase('thinking'); await sleep(800); if (!alive()) return
      setToolsDone([{ label: '搜索收藏内容', hint: '47 条 → 3 条命中' }])
      await sleep(900); if (!alive()) return

      setPhase('speaking')
      await Promise.all([typeLine('ai', SUB.ansFav, 30), playClip(CLIP.ansFav, 7000)]); if (!alive()) return
      await sleep(300); if (!alive()) return

      // ⑤ 第三轮：创建提醒
      setPhase('listening'); await sleep(200); if (!alive()) return
      await Promise.all([typeLine('user', SUB.askRemind, 50), playClip(CLIP.askRemind, 2800)]); if (!alive()) return
      await sleep(250); if (!alive()) return

      setPhase('thinking'); await sleep(800); if (!alive()) return
      setToolsDone([{ label: '创建微信提醒', hint: '明天 10:00 · 已设置' }])
      await sleep(900); if (!alive()) return

      setPhase('speaking')
      await Promise.all([typeLine('ai', SUB.ansRemind, 30), playClip(CLIP.ansRemind, 6000)]); if (!alive()) return
      await sleep(300); if (!alive()) return
      setPushed(true); markCap('push')
      await sleep(1600); if (!alive()) return
      setPhase('listening')
    }

    run()
    return () => {
      cancelled = true
      if (audioRef.current) { try { audioRef.current.pause() } catch { /* noop */ } }
    }
  }, [runId])

  const handleEnd = () => {
    aliveRef.current = false; setEnded(true); setPhase('ended')
    if (audioRef.current) { try { audioRef.current.pause() } catch { /* noop */ } }
  }
  const handleMute = () => setMuted((m) => !m)
  const handleReplay = () => { setSoundBlocked(false); setRunId((v) => v + 1) }

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 items-start lg:items-center p-1 lg:px-10 lg:py-4 justify-start">
      {/* 左栏 */}
      <div className="flex flex-col gap-3 w-full lg:w-[300px] shrink-0 lg:max-w-[300px]">
        {/* 介绍 */}
        <div className="bg-bg-card border border-border-main rounded-[16px] p-4">
          <div className="text-[13.5px] font-bold mb-1.5 flex items-center gap-1.5">
            <Microphone size={15} className="text-brand-green" weight="fill" />
            像打电话一样，和微信数据对话
          </div>
          <p className="text-[11.5px] text-text-muted leading-relaxed">
            说完就答、随时打断；语音里也能让它查聊天记录、收藏、公众号，还能设提醒，结果直接推到微信。
          </p>
        </div>

        {/* 演示内容 */}
        <div className="bg-bg-card border border-border-main rounded-[16px] p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[13px] font-semibold text-text-main">本次演示覆盖</span>
            <button onClick={handleReplay}
              className={`inline-flex items-center gap-1 text-[10.5px] px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                soundBlocked
                  ? 'bg-emerald-500 text-black font-semibold hover:opacity-90'
                  : 'bg-bg-raised border border-border-main text-text-muted hover:text-text-main'
              }`}>
              {soundBlocked ? <><Play size={11} weight="fill" /> 开启声音</> : <><ArrowCounterClockwise size={11} /> 重播</>}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CAPS.map((c) => {
              const on = usedCaps.includes(c.id)
              return (
                <span key={c.id}
                  className={`inline-flex items-center gap-1 text-[10.5px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    on ? 'bg-brand-green-light border-brand-green/30 text-brand-green'
                       : 'bg-bg-raised border-border-main text-text-muted'
                  }`}>
                  {on && <Check size={11} weight="bold" />}
                  {c.label}
                </span>
              )
            })}
          </div>

          <div className="mt-2.5 text-[10.5px] text-text-muted leading-relaxed">
            三段对话依次演示：群聊摘要 → 收藏检索 → 创建提醒；其中第一段播报中会被<strong className="text-text-main">随时打断</strong>。
          </div>
        </div>

        {/* 音色 */}
        <div className="bg-bg-card border border-border-main rounded-[16px] p-3.5 space-y-1.5">
          <div className="text-[13px] font-semibold text-text-main mb-0.5">音色</div>
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-text-muted">助手（女声）</span>
            <span className="text-text-main font-medium">千问 · Cherry</span>
          </div>
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-text-muted">用户（男声）</span>
            <span className="text-text-main font-medium">千问 · Ethan</span>
          </div>
        </div>

        {/* 通道 */}
        <div className="bg-bg-card border border-border-main rounded-[16px] p-3.5 space-y-2.5">
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-600 dark:text-emerald-300 border border-emerald-400/25 shrink-0">B 档</span>
            <div>
              <div className="text-[12.5px] font-semibold text-text-main">实时双工 <span className="text-text-muted font-normal">· 边听边说 / 可打断</span></div>
              <div className="text-[10.5px] text-text-muted">火山豆包 Seeduplex · 千问 Realtime</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-400/15 text-sky-600 dark:text-sky-300 border border-sky-400/25 shrink-0">A 档</span>
            <div>
              <div className="text-[12.5px] font-semibold text-text-main">标准模式 <span className="text-text-muted font-normal">· 识别 + LLM + 合成</span></div>
              <div className="text-[10.5px] text-text-muted">浏览器识别 · 云端识别 · 兼容任意模型</div>
            </div>
          </div>
        </div>
      </div>

      {/* 右栏：手机 */}
      <CallScreen
        phase={phase} seconds={seconds} lines={lines} toolsDone={toolsDone}
        pushed={pushed} muted={muted} ended={ended} interrupted={interrupted}
        onEnd={handleEnd} onMute={handleMute} onReplay={handleReplay}
      />
    </div>
  )
}
