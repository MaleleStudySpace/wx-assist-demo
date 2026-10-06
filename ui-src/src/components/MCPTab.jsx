import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PuzzlePiece, Plus, WarningCircle, Lightning } from '@phosphor-icons/react'

const easeOut = [0.16, 1, 0.3, 1]

/* ── Mock MCP servers ── */
const MOCK_SERVERS = [
  {
    name: '文件系统', description: '本地文件读写操作', transport: 'stdio', timeout: 30,
    tools: [
      { name: 'read_text_file', desc: '读取文本文件内容', params: { path: 'string' }, required: ['path'] },
      { name: 'write_text_file', desc: '写入文本文件', params: { path: 'string', content: 'string' }, required: ['path', 'content'] },
      { name: 'list_directory', desc: '列出目录内容', params: { path: 'string' }, required: ['path'] },
    ],
  },
  {
    name: '资讯订阅', description: 'RSS 订阅源聚合', transport: 'stdio', timeout: 30,
    tools: [
      { name: 'fetch_rss', desc: '抓取 RSS 最新文章', params: { url: 'string', limit: 'number' }, required: ['url'] },
      { name: 'list_subscriptions', desc: '列出所有订阅源', params: {} },
    ],
  },
  {
    name: '网页搜索', description: '网络搜索', transport: 'stdio', timeout: 30,
    tools: [
      { name: 'web_search', desc: '执行网页搜索', params: { query: 'string', count: 'number' }, required: ['query'] },
    ],
  },
]

/* ── MCP 服务器图标 ── */
const SERVER_ICONS = {
  '文件系统': '🗂️',
  '资讯订阅': '📡',
  '网页搜索': '🔍',
}

/* ── Scene data ── */
const SCENES = [
  {
    id: 'file', label: '读取文件', hint: '读取桌面上的会议记录文件',
    userMsg: '读取桌面上的会议记录文件',
    result: (
      <div>
        <div className="text-[#07c160] font-semibold text-[13px] mb-1">✅ 已读取会议记录文件</div>
        <div className="bg-[#f7f7f7] rounded-lg p-2.5 text-[12px] border border-black/[0.04]">
          <div className="font-semibold text-[#1a1a1a]">会议纪要 · 项目周会</div>
          <div className="text-[#888] text-[11px]">参与人：张三、李四、王五</div>
          <div className="mt-1.5 text-[#555]">· Q3 产品路线图确认<br />· 8 月中旬上线<br />· 预算方案通过</div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-[#07c160]/10 text-[#07c160] font-bold font-mono">📁 文件系统</span>
          <span className="text-black/[0.15]">→</span>
          <span className="px-1.5 py-0.5 rounded bg-black/[0.04] text-[#555] font-mono">read_text_file</span>
        </div>
      </div>
    ),
  },
  {
    id: 'rss', label: '订阅资讯', hint: '订阅 AI 行业的最新资讯',
    userMsg: '订阅 AI 行业的最新资讯',
    result: (
      <div>
        <div className="text-[#07c160] font-semibold text-[13px] mb-1">✅ 已获取最新 AI 资讯</div>
        <div className="space-y-1.5 text-[12px]">
          <div className="bg-[#f7f7f7] rounded-lg p-2 border border-black/[0.04]">
            <div className="font-semibold text-[#1a1a1a]">英伟达发布 Blackwell Ultra GPU</div>
            <div className="text-[#888] text-[10px]">训练性能提升 40%，Q3 量产</div>
          </div>
          <div className="bg-[#f7f7f7] rounded-lg p-2 border border-black/[0.04]">
            <div className="font-semibold text-[#1a1a1a]">AI Agent 赛道融资升温</div>
            <div className="text-[#888] text-[10px]">3 家企业获超 10 亿融资</div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-[#07c160]/10 text-[#07c160] font-bold font-mono">📡 资讯订阅</span>
          <span className="text-black/[0.15]">→</span>
          <span className="px-1.5 py-0.5 rounded bg-black/[0.04] text-[#555] font-mono">fetch_rss</span>
        </div>
      </div>
    ),
  },
  {
    id: 'search', label: '网页搜索', hint: '搜一下 MCP 协议最近的更新',
    userMsg: '搜一下 MCP 协议最近的更新',
    result: (
      <div>
        <div className="text-[#07c160] font-semibold text-[13px] mb-1">✅ 已搜索到 3 条结果</div>
        <div className="space-y-1.5 text-[12px]">
          <div className="bg-[#f7f7f7] rounded-lg p-2 border border-black/[0.04]">
            <div className="font-semibold text-[#1a1a1a]">MCP 规范新增「工具分组」</div>
            <div className="text-[#888] text-[10px]">一次握手暴露多组工具，减少上下文占用</div>
          </div>
          <div className="bg-[#f7f7f7] rounded-lg p-2 border border-black/[0.04]">
            <div className="font-semibold text-[#1a1a1a]">流式工具调用成为主流支持项</div>
            <div className="text-[#888] text-[10px]">工具结果可增量返回，长任务体验更好</div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
          <span className="px-1.5 py-0.5 rounded bg-[#07c160]/10 text-[#07c160] font-bold font-mono">🔍 网页搜索</span>
          <span className="text-black/[0.15]">→</span>
          <span className="px-1.5 py-0.5 rounded bg-black/[0.04] text-[#555] font-mono">web_search</span>
        </div>
      </div>
    ),
  },
]

/* ── Phone preview (interactive iPhone mockup, same as FeatureGuide) ── */
function PhonePreview() {
  const [scene, setScene] = useState(null)
  const [typing, setTyping] = useState(false)
  const chatRef = useRef(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [scene, typing])

  const sleep = ms => new Promise(r => setTimeout(r, ms))

  async function handleClick(id) {
    setScene(id)
    setTyping(true)
    await sleep(1200)
    setTyping(false)
  }

  function reset() { setScene(null); setTyping(false) }

  const btnClass = (id) =>
    `flex items-center gap-2.5 p-3 bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/[0.04] text-sm text-[#333] cursor-pointer hover:bg-[#f7f7f7] transition-all ${scene === id ? 'ring-2 ring-[#07c160] ring-offset-1' : ''}`

  const s = SCENES.find(x => x.id === scene)

  return (
    <div className="w-full max-w-[320px] mx-auto">
      <div className="bg-[#ededed] rounded-[44px] border-[5px] border-[#1a1a1a] overflow-hidden shadow-[0_30px_70px_-10px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.08)]">
        {/* Dynamic Island */}
        <div className="relative h-[30px]">
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[100px] h-[26px] bg-black rounded-[16px] z-[100]" />
        </div>
        {/* Status Bar */}
        <div className="h-10 px-7 flex justify-between text-[#1a1a1a] text-[14px] font-semibold -mt-1">
          <span>15:42</span>
          <div className="flex items-center gap-1.5 text-xs">
            <svg width="14" height="10" viewBox="0 0 14 10"><rect x="0.5" y="6" width="2.5" height="3.5" rx="0.6" fill="#1a1a1a"/><rect x="3.5" y="4" width="2.5" height="5.5" rx="0.6" fill="#1a1a1a"/><rect x="6.5" y="2" width="2.5" height="7.5" rx="0.6" fill="#1a1a1a"/><rect x="9.5" y="0" width="2.5" height="9.5" rx="0.6" fill="#1a1a1a" opacity="0.2"/></svg>
            <span style={{fontSize:'11px',fontWeight:600}}>5G</span>
            <svg width="18" height="10" viewBox="0 0 20 11"><rect x="0.5" y="1" width="15" height="8.5" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1"/><rect x="2" y="2.5" width="12" height="5.5" rx="1" fill="#1a1a1a"/><path d="M16.5 3.5 L18.5 3.5 L18.5 7.5 L16.5 7.5" fill="none" stroke="#1a1a1a" strokeWidth="1" strokeLinejoin="round"/></svg>
          </div>
        </div>
        {/* Nav */}
        <div className="h-[50px] flex items-center justify-between px-4 border-b border-black/[0.08] bg-[#ededed]">
          <span className="text-[26px] text-black font-light leading-none">{'\u{2039}'}</span>
          <div className="text-[17px] font-semibold text-[#1a1a1a] flex items-center gap-1.5 tracking-[0.3px]">
            摘星 Agent
            <div className="bg-[#07c160] text-white text-[10px] font-bold py-0.5 px-1.5 rounded">MCP</div>
          </div>
          <div className="flex gap-1 items-center px-1 py-2.5">
            <div className="w-[5px] h-[5px] rounded-full bg-black" />
            <div className="w-[5px] h-[5px] rounded-full bg-black" />
            <div className="w-[5px] h-[5px] rounded-full bg-black" />
          </div>
        </div>
        {/* Chat */}
        <div ref={chatRef} className="h-[380px] overflow-y-auto p-[18px_14px] flex flex-col gap-3.5 bg-[#ededed] text-[15px]" style={{ scrollbarWidth: 'none' }}>
          {/* Default: welcome + command buttons inside the phone */}
          {!scene && !typing && (
            <>
              <div className="text-center text-xs text-[#888] my-1 tracking-[0.3px]">今天 15:42</div>
              <div className="flex gap-2.5 items-start">
                <div className="w-[42px] h-[42px] rounded-lg bg-[#ef4545] shrink-0 flex items-center justify-center gap-1 shadow-[0_2px_6px_rgba(239,69,68,0.25)]">
                  <div className="w-[9px] h-[9px] bg-white rounded-full" />
                  <div className="w-[9px] h-[9px] bg-white rounded-full" />
                </div>
                <div>
                  <div className="relative bg-white text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] max-w-[78%] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                    你好～我是摘星，MCP 工具已就绪。<br /><br />试试下面对话 👇
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 mt-2 px-1">
                <button onClick={() => handleClick('file')} className={btnClass('file')}>
                  <span style={{fontSize:'11px',fontWeight:700,color:'#07c160'}}>文件</span>
                  <span>读取桌面上的会议记录文件</span>
                </button>
                <button onClick={() => handleClick('rss')} className={btnClass('rss')}>
                  <span style={{fontSize:'11px',fontWeight:700,color:'#07c160'}}>订阅</span>
                  <span>订阅 AI 行业的最新资讯</span>
                </button>
                <button onClick={() => handleClick('search')} className={btnClass('search')}>
                  <span style={{fontSize:'12px',fontWeight:700,color:'#07c160'}}>搜索</span>
                  <span>搜一下 MCP 协议最近的更新</span>
                </button>
              </div>
            </>
          )}

          {/* Typing indicator */}
          {typing && (
            <>
              <div className="flex gap-2.5 items-start flex-row-reverse self-end max-w-[85%]">
                <div className="w-[42px] h-[42px] rounded-lg shrink-0 bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center text-[12px] font-bold text-white">我</div>
                <div>
                  <div className="relative bg-[#95ec69] text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                    {s?.userMsg}
                  </div>
                </div>
              </div>
              <div className="flex gap-2.5 items-start">
                <div className="w-[42px] h-[42px] rounded-lg bg-[#ef4545] shrink-0 flex items-center justify-center gap-1 shadow-[0_2px_6px_rgba(239,69,68,0.25)]">
                  <div className="w-[9px] h-[9px] bg-white rounded-full" />
                  <div className="w-[9px] h-[9px] bg-white rounded-full" />
                </div>
                <div>
                  <div className="relative bg-white text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                    <div className="flex gap-1.5 items-center">
                      <span className="w-[7px] h-[7px] rounded-full bg-[#aaa] animate-typingBounce" />
                      <span className="w-[7px] h-[7px] rounded-full bg-[#aaa] animate-typingBounce" style={{ animationDelay: '0.15s' }} />
                      <span className="w-[7px] h-[7px] rounded-full bg-[#aaa] animate-typingBounce" style={{ animationDelay: '0.3s' }} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Result */}
          {scene && !typing && (
            <div className="flex gap-2.5 items-start">
              <div className="w-[42px] h-[42px] rounded-lg bg-[#ef4545] shrink-0 flex items-center justify-center gap-1 shadow-[0_2px_6px_rgba(239,69,68,0.25)]">
                <div className="w-[9px] h-[9px] bg-white rounded-full" />
                <div className="w-[9px] h-[9px] bg-white rounded-full" />
              </div>
              <div className="max-w-[82%]">
                <div className="relative bg-white text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                  {s?.result}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Bottom bar */}
        <div className="h-14 bg-[#f7f7f7] border-t border-black/[0.06] flex items-center px-3 gap-2.5 shrink-0">
          {(scene || typing) && (
            <button onClick={reset}
              className="text-[10px] px-2.5 py-1 rounded-full bg-white border border-black/[0.08] text-[#555] hover:bg-[#f0f0f0] transition-colors cursor-pointer shrink-0">
              {'\u{27F2}'} 重置
            </button>
          )}
          <span className="flex-1 text-center text-xs text-[#aaa] tracking-[0.3px]">
            {!scene && !typing ? '试试看上面的话题' : ''}
          </span>
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="#1a1a1a" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div className="h-[22px] bg-[#f7f7f7] flex justify-center items-end pb-1.5 shrink-0">
          <div className="w-[130px] h-[5px] bg-black rounded-[100px]" />
        </div>
      </div>
    </div>
  )
}

/* ── Main ── */
export default function MCPTab() {
  const [selected, setSelected] = useState('文件系统')
  const [safetyDismissed, setSafetyDismissed] = useState(false)
  const selectedServer = MOCK_SERVERS.find(s => s.name === selected)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: easeOut }} className="p-4 md:p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PuzzlePiece size={22} weight="fill" className="text-brand-green" />
          <h1 className="text-lg font-semibold text-text-main">MCP 工具</h1>
          <span className="text-[12px] font-mono text-text-muted/70 bg-bg-raised px-2.5 py-1 rounded-full border border-border-main">3/3 在线</span>
        </div>
      </div>

      <AnimatePresence>
        {!safetyDismissed && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-status-warn/[0.06] border border-status-warn/[0.12]">
            <WarningCircle size={18} weight="fill" className="text-status-warn shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-sm text-text-secondary leading-relaxed">
              <strong className="text-text-main">安全须知</strong> — MCP 服务器是独立运行的程序，仅添加<strong className="text-text-main">可信来源</strong>。
            </div>
            <button onClick={() => setSafetyDismissed(true)} className="shrink-0 p-1 rounded-md text-text-muted hover:text-text-main transition-colors cursor-pointer"><span className="text-lg leading-none">×</span></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left: servers */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-brand-green-hover dark:bg-brand-green text-white cursor-pointer"><Plus size={16} weight="bold" /> 添加服务器</button>
            <span className="text-xs text-text-muted ml-2">点一下卡片 → 右边手机里看效果</span>
          </div>
          {MOCK_SERVERS.map(s => {
            const active = selected === s.name
            return (
            <motion.div key={s.name} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelected(s.name)}
              className={`group border rounded-2xl p-4 transition-all cursor-pointer ${active ? 'bg-bg-card border-brand-green/50 shadow-[0_8px_24px_-12px_rgba(7,193,96,0.5)]' : 'bg-bg-raised border-border-main hover:border-brand-green/40 hover:bg-bg-card hover:shadow-[0_8px_24px_-12px_rgba(7,193,96,0.45)]'}`}>
              <div className="flex items-center gap-3">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 transition-colors ${active ? 'bg-brand-green/20' : 'bg-brand-green/10 group-hover:bg-brand-green/20'}`}>{SERVER_ICONS[s.name] || '🔌'}</span>
                <span className="flex-1 min-w-0 text-[15px] font-semibold text-text-main truncate">{s.name}</span>
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-green"><span className="w-1.5 h-1.5 rounded-full bg-brand-green" />运行中</span>
                <span className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-brand-green text-white' : 'bg-brand-green/10 text-brand-green group-hover:bg-brand-green group-hover:text-white'}`}>
                  {active ? '工具列表' : '查看工具'}
                </span>
              </div>
              <div className="text-[13px] text-text-muted mt-2.5">{s.description}</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-text-muted">
                <span>{s.tools.length} 个工具</span>
                <span className="opacity-40">·</span>
                <span>{s.transport}</span>
                <span className="opacity-40">·</span>
                <span>{s.timeout}s 超时</span>
              </div>
              {active && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 pt-3 border-t border-border-main/50">
                  {s.tools.map(t => (
                    <div key={t.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-lg hover:bg-bg-raised/50 transition-colors">
                      <div className="w-4 h-4 rounded-full border-2 border-brand-green bg-brand-green flex-shrink-0" />
                      <span className="font-mono text-sm font-semibold text-brand-green">{t.name}</span>
                      <span className="text-xs text-text-muted w-full sm:w-auto sm:flex-1">{t.desc}</span>
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(t.params).map(p => (
                          <span key={p} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted">
                            {p}{t.required.includes(p) && <span className="text-status-error ml-0.5">*</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </motion.div>
            )
          })}
        </div>

        {/* Right: phone */}
        <div className="w-full md:w-[340px] shrink-0">
          <div className="text-[11px] font-semibold text-text-muted/50 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse" /> 效果预览
          </div>
          <PhonePreview />
        </div>
      </div>
    </motion.div>
  )
}
