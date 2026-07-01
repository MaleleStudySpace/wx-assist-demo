import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Sun, Moon, Sparkle, ArrowRight, ArrowLeft, Eye, EyeSlash } from '@phosphor-icons/react'

const pageTransition = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

// Demo mode: 2 steps — welcome + AI setup guide
const STEPS = [
  { id: 1, label: '欢迎使用', desc: '了解 Demo 功能' },
  { id: 2, label: '配置 AI', desc: '3 分钟搞定' },
]

const features = [
  { icon: '🤖', title: 'AI 对话', desc: '群聊上下文智能问答' },
  { icon: '📋', title: '群聊摘要', desc: 'AI 自动总结聊天要点' },
  { icon: '🔔', title: '关键词提醒', desc: '关键消息实时推送微信' },
  { icon: '⏰', title: '定时摘要', desc: 'Cron 调度 + 可推送微信' },
  { icon: '📰', title: '公众号摘要', desc: '按分组定时汇总' },
  { icon: '⭐', title: '收藏导出', desc: '标签筛选 + 全文搜索 + 一键导出' },
]

const PROVIDER_CONFIG = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', label: 'DeepSeek', url: 'platform.deepseek.com/api_keys', color: 'brand-green' },
  openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o', label: 'OpenAI', url: 'platform.openai.com/api-keys', color: 'status-info' },
  custom: { baseUrl: '', model: '', label: '其他平台', url: '你的 AI 平台控制台', color: 'status-warn' },
}

export default function Onboarding({ onComplete }) {
  const [activeStep, setActiveStep] = useState(1)
  const [stepDone, setStepDone] = useState({ 1: false, 2: false })
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  // AI setup state
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [showKey, setShowKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detectStatus, setDetectStatus] = useState(null) // null | 'success' | 'error'
  const [detectedModel, setDetectedModel] = useState('')

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  function handleStart() {
    // Mark step 1 done, go to step 2
    setStepDone(prev => ({ ...prev, 1: true }))
    setActiveStep(2)
  }

  function handleSkipAI() {
    onComplete()
  }

  function handleAIReady() {
    setStepDone(prev => ({ ...prev, 2: true }))
    onComplete()
  }

  async function handleDetect() {
    const key = apiKey.trim()
    const isCustom = selectedProvider === 'custom'
    const url = isCustom ? baseUrl.trim() : PROVIDER_CONFIG[selectedProvider]?.baseUrl
    if (!key || (isCustom && !url)) return

    setDetecting(true)
    setDetectStatus(null)
    setDetectedModel('')

    // Simulate detection
    setTimeout(() => {
      const isValid = key.startsWith('sk-') && key.length > 20
      if (isValid) {
        setDetectStatus('success')
        setDetectedModel(PROVIDER_CONFIG[selectedProvider]?.model || 'auto-detected')
      } else {
        setDetectStatus('error')
      }
      setDetecting(false)
    }, 1500)
  }

  return (
    <div className="min-h-[100dvh] bg-bg-main text-text-main font-sans transition-colors duration-200 relative overflow-hidden">
      {/* Sidebar */}
      <div className="hidden md:block fixed left-0 top-0 h-full w-56 bg-bg-main border-r border-border-main z-40">
        <div className="p-5 flex flex-col h-full justify-between">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="relative">
                <img src="/logo-128.png" alt="wx-assist" className="w-9 h-9 rounded-full border border-border-main" />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-bg-main bg-brand-green animate-pulse" />
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight text-text-main">微信助手</h1>
                <p className="text-[11px] text-text-muted font-mono font-medium tracking-wider uppercase">DEMO 模式</p>
              </div>
            </div>

            <nav className="space-y-1">
              {STEPS.map(({ id, label, desc }) => {
                const active = activeStep === id
                const done = stepDone[id]
                return (
                  <div key={id}>
                    <div
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-[14px] transition-all duration-200 text-left relative ${
                        active
                          ? 'text-brand-green-hover dark:text-brand-green font-semibold'
                          : 'text-text-muted font-medium'
                      }`}
                    >
                      {active && (
                        <motion.div
                          layoutId="activeOnboardingStep"
                          className="absolute inset-0 bg-brand-green-light rounded-full -z-10"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      )}
                      <div className="flex items-center z-10">
                        {done ? (
                          <CheckCircle size={18} weight="fill" className="text-brand-green-hover dark:text-brand-green shrink-0" />
                        ) : (
                          <div className="w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center shrink-0 border-brand-green-hover dark:border-brand-green">
                            <div className="w-2 h-2 rounded-full bg-brand-green-hover dark:text-brand-green" />
                          </div>
                        )}
                      </div>
                      <div className="z-10">
                        <p className="text-xs font-semibold">{label}</p>
                        <p className="text-xs text-text-muted font-mono tracking-tight">{desc}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </nav>
          </div>

          <div className="border-t border-border-main pt-4 mt-auto space-y-3">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-bg-main border border-border-main text-text-muted hover:text-text-main hover:border-text-muted/30 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <><Sun size={14} /> 正常模式</> : <><Moon size={14} /> 夜航控制台</>}
            </button>

            <div className="flex items-center gap-2.5 px-4 py-2 bg-bg-raised/80 rounded-full border border-border-main">
              <div className="w-2 h-2 rounded-full relative bg-brand-green">
                <span className="absolute inset-0 rounded-full bg-brand-green animate-ping opacity-75" />
              </div>
              <span className="text-[10px] text-text-muted font-semibold font-mono tracking-wider uppercase">
                AI READY
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="md:ml-56 flex items-center justify-center min-h-[100dvh] px-4 md:px-8 py-8 md:py-12 relative z-10">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] pointer-events-none opacity-60 blur-3xl"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(24, 226, 153, 0.12) 0%, rgba(24, 226, 153, 0) 70%)' }}
        />

        <div className="w-full max-w-2xl bg-bg-card border border-border-main rounded-2xl p-5 md:p-8 shadow-[rgba(0,0,0,0.03)_0px_2px_4px] dark:shadow-none relative z-20">
          <AnimatePresence mode="wait">
            {/* ──── Step 1: Welcome ──── */}
            {activeStep === 1 && (
              <motion.div key="step1" variants={pageTransition} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.18 }}>
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1.5 h-4.5 rounded-full bg-brand-green" />
                  <h3 className="text-base font-semibold tracking-tight text-text-main">欢迎使用微信助手 Demo</h3>
                </div>

                <div className="space-y-5 mt-4">
                  <p className="text-[14px] text-text-muted leading-relaxed">
                    这是一个<strong className="text-text-main">公开体验版</strong>，所有访客共享同一套演示数据。
                    关闭浏览器标签页后，所有改动自动恢复默认（无需注册）。
                    <span className="text-brand-green/70"> 🛡️ 你的个人配置仅存于当前浏览器，不会上传至服务器。</span>
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    {features.map((f, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 * i }}
                        className="bg-bg-raised border border-border-main rounded-2xl p-4 hover:border-brand-green/30 transition-colors"
                      >
                        <p className="text-sm font-semibold text-text-main mb-1">
                          <span className="mr-1.5">{f.icon}</span>{f.title}
                        </p>
                        <p className="text-xs text-text-muted">{f.desc}</p>
                      </motion.div>
                    ))}
                  </div>

                  <div className="bg-brand-green-light/30 border border-brand-green/20 rounded-2xl p-4 flex items-start gap-3">
                    <Sparkle size={20} className="text-brand-green flex-shrink-0 mt-0.5" weight="fill" />
                    <div>
                      <p className="text-sm font-semibold text-brand-green-hover dark:text-brand-green">推荐体验路径</p>
                      <p className="text-xs text-text-muted mt-1">
                        群聊助手 → 剧本回放（▶ 开始回放）→ 观察关键词命中 → 通知中心查看记录
                      </p>
                    </div>
                  </div>

                  <div className="pt-4">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={handleStart}
                      className="w-56 py-2.5 rounded-full text-[14px] font-semibold tracking-wide transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer bg-brand-green-hover text-white hover:opacity-90"
                    >
                      <ArrowRight size={18} /> 配置 AI，开始体验
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ──── Step 2: AI Setup Guide ──── */}
            {activeStep === 2 && (
              <motion.div key="step2" variants={pageTransition} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.18 }}>
                {/* Badge */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-brand-green-light border border-brand-green/20 text-brand-green mb-5">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse" />
                  3 分钟配置 AI
                </div>

                <h3 className="text-xl md:text-2xl font-bold tracking-tight text-text-main mb-2">
                  选一个 AI 平台，填入 Key 即可
                </h3>
                <p className="text-sm text-text-muted leading-relaxed mb-6">
                  摘星的所有 AI 功能都需要一个 AI 大脑。选一个平台，注册拿 Key——就这么简单。
                </p>

                {/* Provider cards */}
                <div className="flex flex-col gap-3 mb-5">
                  {[
                    { id: 'deepseek', icon: 'D', iconBg: 'bg-brand-green-light text-brand-green border-brand-green/20', name: 'DeepSeek', tag: '推荐', tagClass: 'bg-brand-green-light text-brand-green border-brand-green/20', sub: '中文最强 · 价格最低 · 注册最简单\n新用户送 500 万 tokens（约 1000 次摘要）' },
                    { id: 'openai', icon: 'O', iconBg: 'bg-status-info-soft text-status-info border-status-info/20', name: 'OpenAI', tag: 'GPT', tagClass: 'bg-status-info-soft text-status-info border-status-info/20', sub: 'GPT-4o 等模型 · 需海外信用卡\n适合已有 OpenAI 账号的用户' },
                    { id: 'custom', icon: '+', iconBg: 'bg-status-warn-soft text-status-warn border-status-warn/20', name: '其他 OpenAI 兼容平台', tag: '', tagClass: '', sub: '硅基流动、月之暗面、通义千问等\n只要兼容 OpenAI 格式即可使用' },
                  ].map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProvider(p.id); setDetectStatus(null); setDetectedModel(''); }}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left cursor-pointer ${
                        selectedProvider === p.id
                          ? 'border-brand-green bg-bg-raised'
                          : 'border-border-main bg-bg-card hover:border-border-strong hover:bg-bg-raised/50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border ${p.iconBg}`}>{p.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold flex items-center gap-2">
                          {p.name}
                          {p.tag && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${p.tagClass}`}>{p.tag}</span>}
                        </div>
                        <div className="text-[11px] text-text-muted leading-relaxed mt-0.5 whitespace-pre-line">{p.sub}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                        selectedProvider === p.id ? 'border-brand-green bg-brand-green' : 'border-border-strong'
                      }`}>
                        {selectedProvider === p.id && <span className="text-[10px] text-black font-bold">✓</span>}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Cost tip */}
                <div className="flex gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/15 mb-5">
                  <span className="text-base leading-none">💰</span>
                  <p className="text-[11px] text-text-muted leading-relaxed"><b className="text-amber-500">费用说明</b>：摘星本身免费。AI 平台按用量计费，生成一次群摘要约 <b className="text-amber-500">0.01 元</b>，月均不超 3 元。DeepSeek 新用户免费额度够用几个月。</p>
                </div>

                {/* Guide panel */}
                {selectedProvider && selectedProvider !== 'custom' && (
                  <div className="rounded-xl bg-bg-raised border border-border-main overflow-hidden mb-5">
                    <div className="px-4 py-3 border-b border-border-main flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${PROVIDER_CONFIG[selectedProvider]?.color === 'brand-green' ? 'bg-brand-green-light text-brand-green' : 'bg-status-info-soft text-status-info'}`}>
                        {selectedProvider === 'deepseek' ? 'D' : 'O'}
                      </div>
                      <span className="text-xs font-semibold">{PROVIDER_CONFIG[selectedProvider]?.label} 注册 + 获取 Key</span>
                    </div>
                    <div className="p-4 space-y-0 divide-y divide-border-main">
                      {[
                        { n: '1', t: <>打开 <b>{PROVIDER_CONFIG[selectedProvider]?.url.split('/')[0]}</b>，点击右上角「注册」<br />用手机号注册即可，<b>不需要海外手机</b></> },
                        { n: '2', t: <>登录后，进入左侧菜单 <b>「API Keys」</b><br />点击「创建 API Key」，复制生成的 <span className="text-brand-green font-mono text-[11px] bg-brand-green-light px-1 py-0.5 rounded">sk-xxxxxxxx</span></> },
                        { n: '3', t: <>把复制的 Key 粘贴到下方输入框中<br /><b>只粘贴一次，后面不会再看</b></> },
                      ].map(s => (
                        <div key={s.n} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="w-6 h-6 rounded-full bg-brand-green-light border border-brand-green/20 flex items-center justify-center text-[11px] font-bold text-brand-green shrink-0">{s.n}</div>
                          <div className="text-[12px] text-text-muted leading-relaxed">{s.t}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Screenshot mock */}
                {selectedProvider && selectedProvider !== 'custom' && (
                  <div className="rounded-xl bg-bg-inset border border-border-main overflow-hidden mb-5">
                    <div className="h-8 bg-bg-raised border-b border-border-main flex items-center px-3.5 gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                      <div className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                      <div className="w-2 h-2 rounded-full bg-[#27c93f]" />
                      <div className="flex-1 h-5 bg-bg-inset rounded-md flex items-center px-2.5 text-[9px] text-text-muted font-mono">{PROVIDER_CONFIG[selectedProvider]?.url}</div>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-text-muted w-16 shrink-0">Key 名称</span>
                        <div className="flex-1 h-7 bg-bg-raised border border-border-main rounded-md flex items-center px-3 text-[11px] text-text-muted">摘星助手</div>
                      </div>
                      <div className="flex items-center gap-3 relative">
                        <span className="text-[11px] text-text-muted w-16 shrink-0">API Key</span>
                        <div className="flex-1 h-7 bg-bg-raised border border-brand-green/30 rounded-md flex items-center px-3 text-[11px] text-text-muted ring-1 ring-brand-green/20">sk-1a2b3c4d5e6f7g8h9i0j...</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-text-muted w-16 shrink-0">余额</span>
                        <div className="flex-1 h-7 bg-bg-raised border border-border-main rounded-md flex items-center px-3 text-[11px] text-brand-green font-semibold">¥ 10.00（新用户赠金）</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Custom platform hint */}
                {selectedProvider === 'custom' && (
                  <div className="rounded-xl bg-bg-raised border border-border-main overflow-hidden mb-5">
                    <div className="px-4 py-3 border-b border-border-main flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold bg-status-warn-soft text-status-warn">+</div>
                      <span className="text-xs font-semibold">其他兼容平台</span>
                    </div>
                    <div className="p-4 space-y-0 divide-y divide-border-main">
                      {[
                        { n: '1', t: <>在你使用的 AI 平台上注册并获取 <b>API Key</b><br />平台需支持 OpenAI 兼容的 Chat Completions 接口</> },
                        { n: '2', t: <>记录两个信息：<b>API 站点地址</b>和 <b>API Key</b><br />站点地址格式如 <span className="text-brand-green font-mono text-[11px] bg-brand-green-light px-1 py-0.5 rounded">https://api.example.com</span></> },
                      ].map(s => (
                        <div key={s.n} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="w-6 h-6 rounded-full bg-brand-green-light border border-brand-green/20 flex items-center justify-center text-[11px] font-bold text-brand-green shrink-0">{s.n}</div>
                          <div className="text-[12px] text-text-muted leading-relaxed">{s.t}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Security tip */}
                {selectedProvider && (
                  <div className="flex gap-3 p-3 rounded-xl bg-status-info-soft border border-status-info/15 mb-5">
                    <span className="text-base leading-none">🔒</span>
                    <p className="text-[11px] text-text-muted leading-relaxed"><b className="text-status-info">安全提示</b>：API Key 只在你自己的电脑上使用，不会发送到第三方。摘星是本地运行的，所有数据只属于你。如果 Key 泄露，去平台重新生成即可。</p>
                  </div>
                )}

                {/* Input section */}
                {selectedProvider && (
                  <div className="bg-bg-raised border border-border-main rounded-xl p-5 space-y-5">
                    {/* Base URL (custom only) */}
                    {selectedProvider === 'custom' && (
                      <div>
                        <label className="text-[11px] font-semibold text-text-muted flex items-center gap-1.5 mb-2">
                          <span className="w-4 h-4 rounded bg-brand-green-light flex items-center justify-center text-[8px] text-brand-green font-bold">🔗</span>
                          API 站点地址
                        </label>
                        <input
                          className="w-full h-10 bg-bg-inset border border-border-main rounded-lg px-3 text-[13px] font-mono text-text-main outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15"
                          placeholder="https://api.example.com"
                          value={baseUrl}
                          onChange={e => setBaseUrl(e.target.value)}
                          spellCheck={false}
                        />
                        <p className="text-[10px] text-text-muted mt-1.5">填写平台提供的 API 地址，不要以斜杠结尾</p>
                      </div>
                    )}

                    {/* API Key */}
                    <div>
                      <label className="text-[11px] font-semibold text-text-muted flex items-center gap-1.5 mb-2">
                        <span className="w-4 h-4 rounded bg-brand-green-light flex items-center justify-center text-[8px] text-brand-green font-bold">🔑</span>
                        API Key
                      </label>
                      <div className="flex gap-2.5 items-center">
                        <div className="relative flex-1">
                          <input
                            className="w-full h-10 bg-bg-inset border border-border-main rounded-lg px-3 pr-9 text-[13px] font-mono text-text-main outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15"
                            type={showKey ? 'text' : 'password'}
                            placeholder="sk-xxxxxxxxxxxxxxxx"
                            value={apiKey}
                            onChange={e => { setApiKey(e.target.value); setDetectStatus(null) }}
                            spellCheck={false}
                            autoComplete="off"
                          />
                          <button
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors cursor-pointer"
                          >
                            {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={handleDetect}
                          disabled={detecting || !apiKey.trim() || (selectedProvider === 'custom' && !baseUrl.trim())}
                          className={`h-10 px-5 rounded-lg text-[12px] font-semibold flex items-center gap-2 cursor-pointer transition-all shrink-0 ${
                            detecting || !apiKey.trim()
                              ? 'bg-bg-inset border border-border-main text-text-muted cursor-not-allowed'
                              : 'bg-brand-green-hover text-white hover:opacity-90'
                          }`}
                        >
                          {detecting ? (
                            <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />检测中</>
                          ) : (
                            '检测连通'
                          )}
                        </motion.button>
                      </div>
                      <p className="text-[10px] text-text-muted mt-1.5">
                        以 <span className="font-mono text-brand-green">sk-</span> 开头的一串字符，粘贴即可
                      </p>

                      {/* Detection status */}
                      {detectStatus === 'success' && (
                        <div className="mt-2.5 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-brand-green-light text-brand-green border border-brand-green/20">
                          ✓ 连通成功！检测到可用模型
                        </div>
                      )}
                      {detectStatus === 'error' && (
                        <div className="mt-2.5 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                          ✗ 连通失败 — 请检查 Key 是否正确。Key 通常以 sk- 开头，长度约 40 位。
                        </div>
                      )}
                    </div>

                    {/* Detected model */}
                    {detectStatus === 'success' && detectedModel && (
                      <div>
                        <label className="text-[11px] font-semibold text-text-muted flex items-center gap-1.5 mb-2">
                          <span className="w-4 h-4 rounded bg-brand-green-light flex items-center justify-center text-[8px] text-brand-green font-bold">🤖</span>
                          AI 模型
                        </label>
                        <div className="h-10 bg-bg-inset border border-brand-green/30 rounded-lg px-3 flex items-center text-[13px] font-mono text-text-main ring-1 ring-brand-green/20">
                          {detectedModel}
                        </div>
                        <p className="text-[10px] text-text-muted mt-1.5">✅ 自动检测到可用模型，默认已选最优</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-3 mt-6">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setActiveStep(1)}
                    className="px-5 py-2.5 rounded-full text-[13px] font-medium text-text-muted border border-border-main hover:text-text-main hover:border-border-strong transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <ArrowLeft size={14} /> 返回
                  </motion.button>

                  {detectStatus === 'success' ? (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={handleAIReady}
                      className="flex-1 py-2.5 rounded-full text-[14px] font-semibold tracking-wide flex items-center justify-center gap-2 cursor-pointer bg-brand-green text-black hover:opacity-90"
                    >
                      <Sparkle size={16} weight="fill" /> 配置完成，开始使用
                    </motion.button>
                  ) : (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={handleAIReady}
                      disabled={!selectedProvider || !apiKey.trim() || detectStatus === 'error'}
                      className={`flex-1 py-2.5 rounded-full text-[14px] font-semibold tracking-wide flex items-center justify-center gap-2 cursor-pointer transition-all ${
                        selectedProvider && apiKey.trim() && detectStatus !== 'error'
                          ? 'bg-brand-green-hover text-white hover:opacity-90'
                          : 'bg-bg-inset border border-border-main text-text-muted cursor-not-allowed'
                      }`}
                    >
                      配置完成 <ArrowRight size={16} />
                    </motion.button>
                  )}
                </div>

                {/* Skip */}
                <div className="text-center mt-4 pt-4 border-t border-border-main">
                  <button
                    onClick={handleSkipAI}
                    className="text-[11px] text-text-muted hover:text-text-main transition-colors cursor-pointer"
                  >
                    跳过，稍后在系统配置中设置
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
