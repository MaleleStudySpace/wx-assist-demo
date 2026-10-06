import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Lightning, ArrowClockwise, Play, Spinner } from '@phosphor-icons/react'
import { API_BASE } from './SharedComponents'
import {
  MockPhoneFrame, ClawAvatar, TimeDivider, UserBubble, BotBubble,
  TypingIndicator, AgentStep, PushBadge, USER_AVATAR,
} from './MockPhoneFrame'

const pageTransition = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

const COMMANDS = [
  { id: 'digest', icon: '📝', label: '帮我总结一下工作群今天都说了什么' },
  { id: 'alert', icon: '🔔', label: '帮我设置 36氪 的文章实时提醒' },
  { id: 'rag',   icon: '🔍', label: '我记得之前有人讨论过用 Redis 做缓存，后来换方案了？' },
]

const TOOL_GROUPS = [
  { cat: '📖 问一问 · 信息查询', items: ['系统状态', '搜索会话', '群聊记忆', '文章搜索', '推送历史'] },
  { cat: '🛠️ 一句话 · 自动执行', items: ['生成摘要', '配置预警', '推送通知', '确认执行'] },
  { cat: '🔍 懂你意 · 语义检索', items: ['向量索引', '语义匹配', '跨源关联'] },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ── 已绑定微信时，真正推送到用户微信的内容（演示用 mock 文案） ── */
const PUSH_TEXTS = {
  digest: '📄 工作群 · 今日简报\nAI 从 186 条消息中提炼\n\n🚨 数据库死锁，所有人停止合代码；报销通道今晚 24 点关闭\n📅 发布会提前至本周五，今晚全员对齐方案\n📎 王姐发了《预算分配最终版.pdf》\n\n—— 来自 wx-assist-demo 的 Agent 演示推送',
  alert: '🔔 已为你配置完成\n公众号：36氪\n触发：有新文章发布时\n动作：即时推送 AI 速读摘要到微信\n\n—— 来自 wx-assist-demo 的 Agent 演示推送',
  rag: '🔍 帮你翻到「项目核心群」3 月 12 日的讨论\n\n张三 14:32：Redis 做缓存确实快，但咱们写多读少，命中率太低\n李芳 15:10：换成本地缓存？内存映射文件就行，部署也简单\n\n📌 结论：最终采用了本地缓存方案\n\n—— 来自 wx-assist-demo 的 Agent 演示推送',
}

/* ── Message types used in phone chat ── */
const MT = {
  TIME: 'time',
  USER: 'user',
  BOT: 'bot',
  STEPS: 'steps',
  DIGEST: 'digest',
}

/* ── Chat message components（通用手机壳与气泡见 MockPhoneFrame.jsx） ── */

function DigestCard({ bound }) {
  return (
    <div className="max-w-[78%]">
      <div className="bg-white border border-black/[0.06] rounded-[10px] overflow-hidden shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
        <div className="p-[13px_15px] text-[15px] font-bold border-b border-black/[0.06] flex items-center gap-1.5 text-[#07c160]">
          📄 工作群 · 今日简报
        </div>
        <div className="p-[13px_15px] text-sm text-[#333] space-y-1.5">
          <div className="text-xs text-[#888] pb-2 border-b border-black/[0.04]">AI 从 186 条消息中提炼</div>
          <div className="flex items-start gap-2 text-[14px]"><span className="text-[#e53935] shrink-0">🚨</span><div>老吴：数据库死锁！所有人停止合代码！<br />赵敏：报销通道今晚 24 点关闭</div></div>
          <div className="flex items-start gap-2 text-[14px]"><span className="shrink-0">📅</span><div>发布会提前至这周五，今晚全员对齐方案<br />Q2 方向锁定数据分析模块</div></div>
          <div className="flex items-start gap-2 text-[14px]"><span className="shrink-0">📎</span>王姐发了《预算分配最终版.pdf》</div>
        </div>
        <div className="p-[11px_15px] text-[13px] text-[#576b95] border-t border-dashed border-black/[0.12] text-center font-medium">已折叠 43 条闲聊</div>
      </div>
      <PushBadge bound={bound} />
    </div>
  )
}

function RagQuote({ name, time, text }) {
  return (
    <div className="mb-3">
      <span className="font-semibold">{name}</span> <span className="text-[#888]">{time}</span>
      <div className="border-l-3 border-black/[0.08] pl-2.5 text-[#888] block my-1" style={{ borderLeftWidth: '3px' }}>"{text}"</div>
    </div>
  )
}

/* ── Welcome screen ── */
function WelcomeScreen({ onDismiss }) {
  return (
    <>
      <TimeDivider text="今天 10:15" />
      <div className="flex gap-2.5 items-start">
        <ClawAvatar />
        <div>
          <div className="relative bg-white text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] max-w-[78%] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            👋 你好呀～我是摘星，你的微信智能助手！<br /><br />
            我能帮你做这些事：<br />
            📝 一句话生成群聊摘要、配置定时推送<br />
            🔔 设置公众号文章实时提醒<br />
            🔍 语义搜索——说个大概意思，帮你翻记忆<br /><br />
            点击右侧按钮试试看 👇
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Right-side control panel ── */
function ControlPanel({ ilinkBound, running, onCommand, onReset, children }) {
  return (
    <div className="flex-1 min-w-0 space-y-5">
      {children}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════ */
export default function AgentPanel() {
  const [ilinkBound, setIlinkBound] = useState(null)
  const [messages, setMessages] = useState([])
  const [typing, setTyping] = useState(false)
  const [running, setRunning] = useState(false)
  const [runningId, setRunningId] = useState(null)
  const chatRef = useRef(null)

  useEffect(() => {
    async function check() {
      try {
        // 1. sessionStorage 优先（ConfigPanel 绑定后存在这里）
        const saved = sessionStorage.getItem('ilink_account')
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed && parsed.bot_token) {
            setIlinkBound(true)
            return
          }
        }
        // 2. 回退到 API 检测
        const res = await fetch(`${API_BASE}/api/ilink/status`)
        const d = await res.json()
        setIlinkBound(d.bound === true)
      } catch {
        setIlinkBound(false)
      }
    }
    check()
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, typing])

  function add(m) {
    setMessages(prev => [...prev, m])
  }

  async function showTyping(dur) {
    setTyping(true)
    await sleep(dur)
    setTyping(false)
  }

  async function cmdDigest() {
    add({ type: MT.USER, text: '帮我总结一下工作群今天都说了什么' })
    await sleep(400)
    await showTyping(900)
    add({ type: MT.BOT, text: '🤖 收到，立即执行！' })
    add({ type: MT.STEPS, steps: [
      { label: '读取工作群消息', result: '共 186 条', done: true },
      { label: 'AI 提炼摘要', result: '已生成', done: true },
      { label: ilinkBound ? '推送到微信' : '整理输出结果', result: ilinkBound ? '✅ 已推送' : '✅ 已生成', done: true },
    ]})
    await sleep(300)
    add({ type: MT.DIGEST, bound: ilinkBound })
  }

  async function cmdAlert() {
    add({ type: MT.USER, text: '帮我设置 36氪 的文章实时提醒' })
    await sleep(400)
    await showTyping(800)
    add({ type: MT.BOT, text: '🔔 搞定！已为你配置：<br><br>公众号：<strong style="color:#07c160;">36氪</strong><br>触发：有新文章发布时<br>动作：即时推送 AI 速读摘要到微信<br><br>下次 36氪 发文，你会第一时间收到通知 ✨' })
  }

  async function cmdRag() {
    add({ type: MT.USER, text: '我记得之前群里有人讨论过用 Redis 做缓存，后来好像换方案了，是谁说的来着？' })
    await sleep(400)
    await showTyping(1000)
    add({ type: MT.BOT, text: '🔍 帮你翻了一下记忆——<br><br>在「项目核心群」<span style="color:#888;">3月12日</span>找到了：', rag: true })
  }

  // ── 已绑定微信时，把这条演示结果真的推到用户微信（同一指令只推一次，避免刷屏）──
  const pushedOnce = useRef(new Set())

  async function pushToWechat(id) {
    try {
      const raw = sessionStorage.getItem('ilink_account')
      if (!raw) return
      const account = JSON.parse(raw)
      if (!account?.bot_token) return
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      await fetch(`${API_BASE}/api/ilink/test-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...account, text: PUSH_TEXTS[id] || '' }),
        signal: controller.signal,
      })
      clearTimeout(timer)
    } catch {
      /* 推送失败不影响页面演示 */
    }
  }

  async function handleCommand(id) {
    if (running) return
    setRunning(true)
    setRunningId(id)
    try {
      if (id === 'digest') await cmdDigest()
      else if (id === 'alert') await cmdAlert()
      else if (id === 'rag') await cmdRag()
      if (ilinkBound && !pushedOnce.current.has(id)) {
        pushedOnce.current.add(id)
        pushToWechat(id) // 不阻塞界面，推送结果不影响演示流程
      }
    } catch (e) { console.error(e) }
    setRunning(false)
    setRunningId(null)
  }

  function reset() {
    if (running) return
    setMessages([])
    setTyping(false)
  }

  const hasMessages = messages.length > 0
  const inputHint = running ? 'Agent 执行中...' : (hasMessages ? '' : '给摘星发消息...')

  return (
    <motion.div {...pageTransition} className="p-4 md:p-8">
      <div className="flex flex-col lg:flex-row gap-8 items-start">

        {/* ═══ Left: iPhone ═══ */}
        <MockPhoneFrame chatRef={chatRef} inputHint={inputHint} title="摘星 Agent">
          {!hasMessages && <WelcomeScreen />}
          {messages.map((m, i) => {
            if (m.type === MT.USER) {
                    return <UserBubble key={i} text={m.text} avatar={USER_AVATAR} />
                  }
                  if (m.type === MT.BOT) {
                    return (
                      <BotBubble key={i}>
                        <span dangerouslySetInnerHTML={{ __html: m.text }} />
                        {m.rag && (
                          <div className="mt-2">
                            <RagQuote name="张三" time="14:32" text="Redis 做缓存确实快，但咱们写多读少，命中率太低" />
                            <RagQuote name="李芳" time="15:10" text="换成本地缓存？内存映射文件就行，部署也简单" />
                            <div className="pt-2 border-t border-dashed border-black/[0.06]">
                              📌 结论：最终采用了 <strong style={{ color: '#07c160' }}>本地缓存方案</strong><br />
                              <span style={{ color: '#888', fontSize: '13px' }}>不用翻聊天记录，跟我说个大概意思就能找到 👀</span>
                            </div>
                          </div>
                        )}
                      </BotBubble>
                    )
                  }
                  if (m.type === MT.STEPS) {
                    return (
                      <BotBubble key={i}>
                        <div className="space-y-2">
                          {m.steps.map((s, j) => <AgentStep key={j} {...s} />)}
                        </div>
                        <hr className="my-2 border-t border-dashed border-black/[0.08]" />
                        <span>全部完成 🙌</span>
                      </BotBubble>
                    )
                  }
                  if (m.type === MT.DIGEST) {
                    return (
                      <div key={i} className="flex gap-2.5 items-start">
                        <ClawAvatar />
                        <DigestCard bound={m.bound} />
                      </div>
                    )
                  }
                  return null
                })}
                {typing && <TypingIndicator />}
        </MockPhoneFrame>

        {/* ═══ Right: Controls ═══ */}
        <ControlPanel ilinkBound={ilinkBound} running={running} onCommand={handleCommand} onReset={reset}>

          {/* Status bar —— 未绑定时不显示任何"未绑定"提示，只在已绑定/检测中显示 */}
          {ilinkBound !== false && (
            <div className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border text-sm ${
              ilinkBound === null ? 'bg-bg-raised border-border-main/50' : 'bg-brand-green/5 border-brand-green/20'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${ilinkBound === null ? 'bg-text-muted' : 'bg-brand-green animate-pulse'}`} />
              <span className={`font-semibold ${ilinkBound === null ? 'text-text-muted' : 'text-brand-green'}`}>
                {ilinkBound === null ? '检测微信绑定状态...' : '微信已绑定 · 结果会推送到你的微信'}
              </span>
              <span className="ml-auto text-[10px] px-2.5 py-1 rounded-full bg-brand-green/10 text-brand-green font-semibold border border-brand-green/15 shrink-0">ReAct</span>
            </div>
          )}

          {/* Preset commands */}
          <div className="bg-bg-card border border-border-main rounded-2xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-[15px] font-semibold text-text-main flex items-center gap-2">
                <Lightning size={16} className="text-brand-green" weight="fill" />
                试试对 Agent 说这些
              </h3>
              <span className="hidden sm:inline text-xs text-text-muted">点一下 → 左边手机里看效果</span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {COMMANDS.map(cmd => {
                const busy = runningId === cmd.id
                const dim = running && !busy
                return (
                  <motion.button
                    key={cmd.id}
                    whileHover={dim ? undefined : { y: -2 }}
                    whileTap={dim ? undefined : { scale: 0.985 }}
                    onClick={() => handleCommand(cmd.id)}
                    disabled={running}
                    className={`group w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                      busy ? 'opacity-80 cursor-wait bg-bg-raised border-brand-green/50'
                      : dim ? 'opacity-50 cursor-not-allowed bg-bg-raised border-border-main'
                      : 'cursor-pointer bg-bg-raised border-border-main hover:border-brand-green/50 hover:bg-bg-card hover:shadow-[0_8px_24px_-10px_rgba(7,193,96,0.45)]'
                    }`}
                  >
                    <span className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 transition-colors ${dim ? 'bg-bg-raised' : 'bg-brand-green/10 group-hover:bg-brand-green/20'}`}>{cmd.icon}</span>
                    <span className="flex-1 min-w-0 text-[15px] font-medium text-text-main leading-relaxed">{cmd.label}</span>
                    <span className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center transition-colors ${busy ? 'bg-brand-green text-white' : dim ? 'bg-bg-raised text-text-muted' : 'bg-brand-green/10 text-brand-green group-hover:bg-brand-green group-hover:text-white'}`}>
                      {busy ? <Spinner size={14} className="animate-spin" /> : <Play size={12} weight="fill" />}
                    </span>
                  </motion.button>
                )
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-main/50">
              <button onClick={reset} disabled={running}
                className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-bg-raised border border-border-main text-text-muted hover:text-text-main transition-colors cursor-pointer disabled:opacity-50">
                <ArrowClockwise size={12} /> 重置对话
              </button>
              <span className="text-xs text-text-muted/60">{messages.filter(m => m.type === MT.USER).length} 条对话</span>
              {ilinkBound === false && (
                <a href="#" onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate', { detail: { tab: 'config', section: 'push' } })) }}
                  className="ml-auto text-xs font-medium text-brand-green hover:opacity-80 no-underline">
                  💡 绑定微信，结果直接推到你手机 →
                </a>
              )}
            </div>
          </div>

          {/* Tool list */}
          <div className="bg-bg-card border border-border-main rounded-2xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-4 rounded-sm bg-brand-green" />
              <span className="text-xs font-semibold text-text-muted tracking-wide">Agent 工具清单</span>
            </div>
            <div className="space-y-4">
              {TOOL_GROUPS.map((group, i) => (
                <div key={i}>
                  <div className="text-xs text-text-muted/70 font-semibold mb-2">{group.cat}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((item, j) => (
                      <span key={j} className="text-xs px-2.5 py-1 rounded-md bg-brand-green/10 text-brand-green font-medium border border-brand-green/15">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </ControlPanel>

      </div>
    </motion.div>
  )
}
