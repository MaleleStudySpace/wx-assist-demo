import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Sun, Moon, Sparkle, ArrowRight } from '@phosphor-icons/react'

const pageTransition = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

// Online-demo mode: single welcome step (AI is pre-configured server-side)
const STEPS = [
  { id: 1, label: '欢迎使用', desc: '了解 Demo 功能' },
]

const features = [
  { icon: '🤖', title: 'AI 对话', desc: '群聊上下文智能问答' },
  { icon: '📋', title: '群聊摘要', desc: 'AI 自动总结聊天要点' },
  { icon: '🔔', title: '关键词告警', desc: '关键消息实时推送' },
  { icon: '⏰', title: '定时摘要', desc: 'Cron 调度 + AI 生成' },
  { icon: '📰', title: '公众号摘要', desc: '按分组定时汇总' },
  { icon: '🎭', title: '剧本回放', desc: '一键体验关键词检测' },
]

export default function Onboarding({ onComplete }) {
  const [activeStep] = useState(1)
  const [stepDone] = useState({ 1: false })

  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  function handleStart() {
    onComplete()
  }

  return (
    <div className="min-h-[100dvh] bg-bg-main text-text-main font-sans transition-colors duration-200 relative overflow-hidden">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-56 bg-bg-main border-r border-border-main z-40">
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
                        {stepDone[id] ? (
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
      <div className="ml-56 flex items-center justify-center min-h-[100dvh] px-8 py-12 relative z-10">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] pointer-events-none opacity-60 blur-3xl"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(24, 226, 153, 0.12) 0%, rgba(24, 226, 153, 0) 70%)' }}
        />

        <div className="w-full max-w-2xl bg-bg-card border border-border-main rounded-2xl p-8 shadow-[rgba(0,0,0,0.03)_0px_2px_4px] dark:shadow-none relative z-20">
          <AnimatePresence mode="wait">
            <motion.div key={activeStep} variants={pageTransition} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.18 }}>
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1.5 h-4.5 rounded-full bg-brand-green" />
                  <h3 className="text-base font-semibold tracking-tight text-text-main">欢迎使用微信助手 Demo</h3>
                </div>

                <div className="space-y-5 mt-4">
                  <p className="text-[14px] text-text-muted leading-relaxed">
                    这是一个<strong className="text-text-main">公开体验版</strong>，所有访客共享同一套演示数据。
                    关闭浏览器标签页后，所有改动自动恢复默认（无需注册）。
	                  <span className="text-brand-green/70">🛡️ 你的个人配置仅存于当前浏览器，不会上传至服务器。</span>
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
                      className="w-56 py-2.5 rounded-full text-[14px] font-semibold tracking-wide transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer bg-brand-green-hover text-white hover:opacity-90 animate-pulse"
                    >
                      <ArrowRight size={18} /> 开始体验
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
