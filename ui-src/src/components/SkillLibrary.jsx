import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Play, Spinner, ArrowsClockwise, Lightning, X } from '@phosphor-icons/react'
import {
  MockPhoneFrame, BotBubble, UserBubble, TypingIndicator, AgentStep, PushBadge,
} from './MockPhoneFrame'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ── 预设可选项：点一下，就在右侧手机里播完整链路 ── */
const PRESET_COMMANDS = [
  { skill: 'aihot_daily', icon: '📰', label: '把今天的 AI 日报发我' },
  { skill: 'daily_github_trending', icon: '🚀', label: '看看 GitHub 今天有什么热门项目' },
  { skill: 'rss_watch', icon: '🔕', label: '盯着 RSS，有新文章再通知我' },
  { skill: 'skill-designer', icon: '🧩', label: '帮我做一个每天提醒喝水的 skill' },
]

/* ── Skill 开发指南卡片（内容与本体 ui/src/components/SkillLibrary.jsx 对齐） ── */
function SkillGuideCard({ embedded }) {
  const content = (
    <div className="text-sm leading-relaxed text-text-muted">

      {/* 目录结构 */}
      <div className="mb-6">
        <p className="text-text-main font-semibold mb-3 text-sm">目录结构</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto">
{`data/skills/{skill-name}/
├── SKILL.md         ← 元数据（YAML frontmatter）
├── scripts/         ← script 类型脚本目录（仅 .py）
└── examples/        ← 可选：使用示例`}
        </div>
      </div>

      {/* 类型速览 */}
      <div className="mb-6">
        <p className="text-text-main font-semibold mb-3 text-sm">两种类型</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="shrink-0 mt-0.5 px-2.5 py-1 rounded bg-brand-green/15 text-brand-green font-mono text-[12px] font-semibold">script</span>
            <span className="text-sm leading-relaxed">子进程跑 Python 脚本。<code className="font-mono px-1.5 py-0.5 rounded bg-white/10 text-sm">--key value</code> 传参，stdout 出结果。</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="shrink-0 mt-0.5 px-2.5 py-1 rounded bg-[#a78bfa]/20 text-[#a78bfa] font-mono text-[12px] font-semibold">prompt</span>
            <span className="text-sm leading-relaxed">单次 prompt 喂给 LLM 出结果，不开子进程、不保留对话历史。</span>
          </div>
        </div>
        <div className="bg-[#d45656]/10 border border-[#d45656]/40 rounded-xl px-4 py-3 mt-3">
          <p className="text-sm font-semibold text-[#d45656]">⚠️ script 类型 skill 只支持 Python</p>
        </div>
      </div>

      {/* 使用场景 */}
      <div className="mb-6">
        <p className="text-text-main font-semibold mb-3 text-sm">使用场景</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 space-y-3">
          <p className="flex items-center gap-3 text-sm">
            <span className="text-lg shrink-0">🕐</span>
            <span>定时调度 — CronScheduler 按 cron 表达式触发，结果自动推微信</span>
          </p>
          <p className="flex items-center gap-3 text-sm">
            <span className="text-lg shrink-0">🤖</span>
            <span>AI 助手 — 用户在对话中让 Agent 调用，立即执行</span>
          </p>
        </div>
      </div>

      {/* ─── script 类型教程 ──────────────────────────────── */}
      <div className="mb-6 pt-2">
        <div className="flex items-center gap-3 mb-3">
          <span className="px-3 py-1 rounded bg-brand-green/15 text-brand-green font-mono text-[13px] font-semibold">script</span>
          <p className="text-text-main font-semibold text-sm">类型教程：跑 Python 脚本</p>
        </div>

        <p className="text-xs text-text-muted mb-2">目录骨架：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`data/skills/{skill-name}/
├── SKILL.md              ← 元数据
└── scripts/              ← 放 Python 脚本
    └── myscript.py`}
        </div>

        <p className="text-xs text-text-muted mb-2">SKILL.md 模板：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`---
name: my-skill            # 唯一标识
type: script              # ← 写 script
description: 做什么用的
command: myscript.py      # ← 相对 scripts/ 的脚本名
timeout: 30               # 超时秒，默认 30
args:
  keyword:
    type: string
    required: true
    description: 查询关键词
  limit:
    type: integer
    default: 5
---`}
        </div>

        <p className="text-xs text-text-muted mb-2">参数 → CLI 映射：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`# SKILL.md 写 args = {keyword: "AI Agent", limit: 3, verbose: true}
# 引擎拼成:
python scripts/myscript.py --keyword "AI Agent" --limit 3 --verbose

# 规则:
#   string/integer/number → --key <值>
#   True (boolean)         → --key（只传开关，无值）
#   False (boolean)        → 整个 --key 不传
#   数组/对象              → str() 后传（JSON 字符串，脚本自己 parse）`}
        </div>

        <p className="text-xs text-text-muted mb-2">Python 脚本里这样接（推荐 argparse）：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`import argparse, sys

p = argparse.ArgumentParser()
p.add_argument("--keyword", required=True)
p.add_argument("--limit", type=int, default=5)
p.add_argument("--verbose", action="store_true")
args = p.parse_args()

print(f"[{args.keyword}] 抓到 {args.limit} 条结果（verbose={args.verbose}）")
sys.exit(0)

# 若本次无新内容可推送，请输出 [SILENT]，调度器将跳过本轮推送`}
        </div>

        <p className="text-xs text-text-muted mb-2">适用：拉数据 / 调外部 API / 跑本地计算 / 系统命令封装</p>
      </div>

      {/* ─── prompt 类型教程 ──────────────────────────────── */}
      <div className="mb-6 pt-2">
        <div className="flex items-center gap-3 mb-3">
          <span className="px-3 py-1 rounded bg-[#a78bfa]/20 text-[#a78bfa] font-mono text-[13px] font-semibold">prompt</span>
          <p className="text-text-main font-semibold text-sm">类型教程：单次 prompt 驱动 LLM</p>
        </div>

        <p className="text-xs text-text-muted mb-2">目录骨架（不需要 scripts/）：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`data/skills/{skill-name}/
└── SKILL.md              ← prompt 写在 SKILL.md 里`}
        </div>

        <p className="text-xs text-text-muted mb-2">SKILL.md 模板：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`---
name: my-skill            # 唯一标识
type: prompt              # ← 写 prompt
description: 做什么用的
timeout: 60               # 留给 LLM 的思考时间（默认 60）
args:
  topic:
    type: string
    required: true
    description: 话题
  style:
    type: string
    default: 幽默
    description: 风格
prompt: |
  你是 XXX 助手。用户会给你一个话题（topic 参数）和风格（style 参数）。

  请按以下步骤执行：
  1. 先复述话题，确认理解
  2. 按 style 风格输出 3 条候选
  3. 每条 1-2 句话，不超过 80 字

  若话题不合适处理，输出 [SILENT]。
---`}
        </div>

        <p className="text-xs text-text-muted mb-2">参数注入方式：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 font-mono text-sm leading-loose whitespace-pre overflow-x-auto mb-4">
{`# 调用时传 args = {topic: "AI", style: "严肃"}
# 引擎会自动在 prompt 末尾追加:

## 参数
{
  "topic": "AI",
  "style": "严肃"
}

# prompt 里直接引用 topic / style 即可，引擎会把 args 字典
# 转成 JSON 块喂给 LLM（ensure_ascii=False 中文可读）`}
        </div>

        <p className="text-xs text-text-muted mb-2">prompt 写法要点：</p>
        <div className="bg-[#0a0a0e] text-[#d7d7e0] border border-border-main rounded-xl p-5 text-sm leading-relaxed space-y-2">
          <p>• <strong className="text-white">写步骤</strong>：让 LLM 按 1/2/3 走，比笼统指令稳定</p>
          <p>• <strong className="text-white">指明输出格式</strong>：Markdown / 列表 / 字数限制，避免自由发挥</p>
          <p>• <strong className="text-white">给反例</strong>：&ldquo;不要&rdquo;比 &ldquo;应该&rdquo;管用</p>
          <p>• <strong className="text-white">无内容就 [SILENT]</strong>：监控类任务让 LLM 输出 <code className="font-mono px-1 py-0.5 rounded bg-white/10 text-xs">[SILENT]</code> 跳过推送</p>
        </div>

        <p className="text-xs text-text-muted mt-3 mb-2">适用：内容生成 / 文案润色 / 数据分析 / 分类汇总 / 翻译总结</p>
      </div>

      <p className="text-text-muted/60 text-xs pt-2 border-t border-border-main/50">创建/修改 SKILL.md 后下次执行立即生效，无需重启 bot。</p>
    </div>
  )

  if (embedded) {
    return (
      <div className="text-left border border-brand-green/25 rounded-xl bg-bg-card p-6 max-h-[80vh] overflow-y-auto w-full">
        {content}
      </div>
    )
  }
  return content
}

/* ═══════════════════════════════════════════════
   Skill 库：左列表 + 中间详情 + 右侧模拟 iPhone
   ═══════════════════════════════════════════════ */
export default function SkillLibrary({ skills: providedSkills }) {
  const [fetched, setFetched] = useState([])
  const [loading, setLoading] = useState(!providedSkills?.length)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [messages, setMessages] = useState([])
  const [typing, setTyping] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ilinkBound, setIlinkBound] = useState(false)
  const chatRef = useRef(null)
  const pushedOnce = useRef(new Set())

  /* 已绑定微信时，把 skill 的演示结果真的推到用户微信（同一 skill 只推一次） */
  async function pushToWechat(name, text) {
    if (!text) return
    try {
      const raw = sessionStorage.getItem('ilink_account')
      if (!raw) return
      const account = JSON.parse(raw)
      if (!account?.bot_token) return
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6000)
      await fetch('/api/ilink/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...account, text: `${text}\n\n—— 来自 wx-assist-demo 的 Skill 演示推送` }),
        signal: controller.signal,
      })
      clearTimeout(timer)
    } catch { /* 推送失败不影响页面演示 */ }
  }

  const skills = providedSkills?.length ? providedSkills : fetched

  async function load() {
    try {
      const res = await fetch('/api/skills')
      const d = await res.json()
      setFetched(d.skills || [])
    } catch { /* 保持空列表 */ } finally { setLoading(false) }
  }

  useEffect(() => { if (!providedSkills?.length) load() }, [providedSkills?.length])

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ilink_account')
      setIlinkBound(!!(saved && JSON.parse(saved)?.bot_token))
    } catch { setIlinkBound(false) }
  }, [])

  useEffect(() => {
    if (!selected && skills.length) setSelected(skills[0].name)
  }, [skills, selected])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, typing])

  const filtered = skills.filter(item =>
    !search || `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
  const skill = skills.find(item => item.name === selected) || filtered[0]

  async function play(name, cmdOverride) {
    if (playing) return
    const target = skills.find(s => s.name === name)
    if (!target) return
    setSelected(name)
    setPlaying(true)
    setMessages([])
    await sleep(180)
    setMessages([{ type: 'user', text: cmdOverride || target.demo_cmd || `执行 ${target.name}` }])
    await sleep(350)
    setTyping(true)
    await sleep(900)
    setTyping(false)
    setMessages(prev => [...prev, { type: 'bot', text: `🤖 收到，调用 ${target.type === 'script' ? '脚本' : 'AI'} 能力执行「${target.name}」` }])
    await sleep(250)
    setMessages(prev => [...prev, { type: 'steps', steps: target.demo_steps || [] }])
    await sleep(400)
    setMessages(prev => [...prev, { type: 'result', text: target.demo_output || '', bound: ilinkBound }])
    if (ilinkBound && !pushedOnce.current.has(name)) {
      pushedOnce.current.add(name)
      pushToWechat(name, target.demo_output) // 不阻塞界面
    }
    setPlaying(false)
  }

  const inputHint = playing ? 'Agent 执行中...' : '给摘星发消息...'

  return (
    <div className="space-y-5">
      {/* 顶部说明 */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-green-light/20 flex items-center justify-center text-brand-green shrink-0"><Lightning size={16} weight="fill" /></div>
        <div>
          <h3 className="text-base font-semibold text-text-main flex items-center gap-2">
            Skill 库
            <span className="text-xs text-text-muted font-normal">· {skills.length} 个能力单元</span>
          </h3>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            每个 Skill 都是 <code className="font-mono text-brand-green/80">data/skills/&#123;name&#125;/SKILL.md</code> 里的一个能力单元，
            既能被 AI Agent 在对话中调用，也能挂到 cron 定时任务上自动推送。点下面的指令，看它在微信里的真实效果。
          </p>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-6 items-start">

        {/* ═══ 右侧（桌面） / 顶部（手机）：模拟 iPhone ═══ */}
        <div className="w-full xl:order-2 xl:w-[360px] shrink-0">
          <MockPhoneFrame chatRef={chatRef} inputHint={inputHint} title="摘星 Agent" height="h-[560px] md:h-[640px]">
            {messages.length === 0 && (
              <>
                <div className="text-center text-xs text-[#888] my-1">今天 15:42</div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-[42px] h-[42px] rounded-lg bg-[#ef4545] shrink-0 flex items-center justify-center gap-1 shadow-[0_2px_6px_rgba(239,69,68,0.25)]">
                    <div className="w-[9px] h-[9px] bg-white rounded-full" />
                    <div className="w-[9px] h-[9px] bg-white rounded-full" />
                  </div>
                  <div>
                    <div className="relative bg-white text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] max-w-[78%] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                      🧩 这里是 Skill 库。<br /><br />
                      左边每个能力都能在微信里直接使唤我，点「在手机上看效果」或下方预设指令试试 👇
                    </div>
                  </div>
                </div>
              </>
            )}
            {messages.map((m, i) => {
              if (m.type === 'user') return <UserBubble key={i} text={m.text} />
              if (m.type === 'bot') return <BotBubble key={i}><span>{m.text}</span></BotBubble>
              if (m.type === 'steps') {
                return (
                  <BotBubble key={i}>
                    <div className="space-y-2">
                      {m.steps.map((s, j) => <AgentStep key={j} check label={s.label} result={s.result} />)}
                    </div>
                    <hr className="my-2 border-t border-dashed border-black/[0.08]" />
                    <span>执行完成 🙌</span>
                  </BotBubble>
                )
              }
              if (m.type === 'result') {
                return (
                  <BotBubble key={i}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    <PushBadge bound={m.bound} />
                  </BotBubble>
                )
              }
              return null
            })}
            {typing && <TypingIndicator />}
          </MockPhoneFrame>
        </div>

        {/* ═══ 左侧：预设指令 + Skill 列表 + 详情 ═══ */}
        <div className="flex-1 min-w-0 w-full xl:order-1 space-y-5">

          {/* 预设可选项 */}
          <div className="bg-bg-card border border-border-main rounded-2xl p-4 md:p-5">
            <h4 className="text-sm font-semibold text-text-main mb-3 flex items-center gap-2">
              <Lightning size={15} className="text-brand-green" weight="fill" />
              试试这些指令
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESET_COMMANDS.map(cmd => {
                const target = skills.find(s => s.name === cmd.skill)
                return (
                  <motion.button
                    key={cmd.skill}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => play(cmd.skill, cmd.label)}
                    disabled={playing || !target}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      playing ? 'opacity-50 cursor-wait bg-bg-raised border-border-main'
                      : 'bg-bg-raised/60 border-border-main hover:border-brand-green/30 hover:bg-brand-green/[0.02]'
                    }`}
                  >
                    <span className="text-lg shrink-0">{cmd.icon}</span>
                    <span className="text-sm text-text-main leading-relaxed">{cmd.label}</span>
                  </motion.button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-border-main/50">
              <button onClick={() => setShowGuide(v => !v)}
                className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-bg-raised border border-border-main text-text-muted hover:text-text-main transition-colors cursor-pointer">
                <BookOpen size={12} /> Skill 开发指南
              </button>
              <button onClick={() => { setMessages([]); setTyping(false) }} disabled={playing}
                className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-bg-raised border border-border-main text-text-muted hover:text-text-main transition-colors cursor-pointer disabled:opacity-50">
                <ArrowsClockwise size={12} /> 清空对话
              </button>
              <span className="text-xs text-text-muted/60 ml-auto">
                {ilinkBound ? '微信已绑定 · 演示结果会同步推到你手机' : '演示模式 · 绑定微信后结果会推到你手机'}
              </span>
            </div>
          </div>

          {/* 开发指南 */}
          <AnimatePresence>
            {showGuide && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-text-main flex items-center gap-2"><BookOpen size={15} className="text-brand-green" /> Skill 开发指南</h4>
                  <button onClick={() => setShowGuide(false)} className="p-1 rounded-full text-text-muted hover:text-text-main cursor-pointer"><X size={15} /></button>
                </div>
                <SkillGuideCard embedded />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 列表 + 详情 */}
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
            <div className="border border-border-main rounded-xl bg-bg-card overflow-hidden">
              <div className="p-3 border-b border-border-main">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索 Skill..."
                  className="w-full bg-bg-raised border border-border-main rounded-lg px-3 py-2 text-sm text-text-main" />
              </div>
              <div className="p-2 max-h-[420px] overflow-y-auto">
                {loading && <div className="py-8 text-center text-xs text-text-muted"><Spinner size={16} className="animate-spin inline mr-2" />加载中...</div>}
                {!loading && filtered.map(item => (
                  <button key={item.name} onClick={() => setSelected(item.name)}
                    className={`w-full text-left p-3 rounded-lg mb-1 cursor-pointer ${skill?.name === item.name ? 'bg-brand-green-light/15 border border-brand-green/30' : 'hover:bg-bg-raised border border-transparent'}`}>
                    <div className="text-sm font-semibold text-text-main">
                      {item.name}
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${item.type === 'script' ? 'bg-brand-green/15 text-brand-green' : 'bg-purple-400/15 text-purple-300'}`}>{item.type}</span>
                    </div>
                    <p className="text-xs text-text-muted mt-1 line-clamp-2">{item.description}</p>
                  </button>
                ))}
                {!loading && !filtered.length && <div className="py-8 text-center text-xs text-text-muted">没有匹配的 Skill</div>}
              </div>
            </div>

            <div className="border border-border-main rounded-xl bg-bg-card p-5">
              {skill ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-text-main flex items-center gap-2">
                        {skill.name}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${skill.type === 'script' ? 'bg-brand-green/15 text-brand-green' : 'bg-purple-400/15 text-purple-300'}`}>{skill.type}</span>
                      </h3>
                      <p className="text-sm text-text-muted mt-1 leading-relaxed">{skill.description}</p>
                      {skill.path && <p className="text-xs text-text-muted/70 mt-2 font-mono">{skill.path}</p>}
                    </div>
                    <button onClick={() => play(skill.name)} disabled={playing}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-brand-green text-white text-xs font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 shrink-0">
                      {playing ? <Spinner size={12} className="animate-spin" /> : <Play size={12} weight="fill" />}在手机上看效果
                    </button>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-text-muted mb-2">参数说明</p>
                    <div className="bg-bg-raised/60 border border-border-main rounded-lg overflow-hidden">
                      {Object.entries(skill.args || {}).map(([name, def]) => (
                        <div key={name} className="px-3 py-2.5 border-b border-border-main/50 last:border-b-0">
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-sm text-brand-green">{name}</code>
                            <span className="text-xs text-text-muted">{def.type}</span>
                            {def.required && <span className="text-[10px] text-status-error">必填</span>}
                          </div>
                          <p className="text-xs text-text-muted mt-1">{def.description}{def.default !== undefined ? `，默认 ${def.default}` : ''}</p>
                        </div>
                      ))}
                      {!Object.keys(skill.args || {}).length && <div className="px-3 py-2.5 text-xs text-text-muted">该 Skill 无需参数</div>}
                    </div>
                  </div>

                  {!!skill.demo_steps?.length && (
                    <div>
                      <p className="text-xs font-medium text-text-muted mb-2">执行过程</p>
                      <div className="flex flex-wrap gap-1.5">
                        {skill.demo_steps.map((s, i) => (
                          <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-brand-green/10 text-brand-green font-medium border border-brand-green/15">
                            {i + 1}. {s.label}{s.result ? ` · ${s.result}` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-text-muted mb-2">推送结果示例</p>
                    <pre className="bg-bg-raised/60 border border-border-main rounded-lg p-3 text-xs text-text-secondary whitespace-pre-wrap font-sans">{skill.demo_output}</pre>
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center text-sm text-text-muted">选择一个 Skill 查看详情</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
