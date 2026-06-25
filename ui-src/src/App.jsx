import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gear, ChartLine, Scroll, Spinner, Sun, Moon, ChatCircleDots, Star, Eye, Newspaper, Chats, PaperPlaneTilt, List, X } from '@phosphor-icons/react'
import { API_BASE } from './components/SharedComponents'
import Dashboard from './components/Dashboard'
import ConfigPanel from './components/ConfigPanel'
import AssistantPanel from './components/AssistantPanel'
import LogViewer from './components/LogViewer'
import Onboarding from './components/Onboarding'
import FavoritesTab from './components/FavoritesTab'
import MomentsTab from './components/MomentsTab'
import OATab from './components/OATab'
import ChatTab from './components/ChatTab'
import FeatureGuide from './components/FeatureGuide'
import { AmbientWaveBackground } from './components/AmbientBackground'

const iconVariants = {
  hover: { y: -1.5, scale: 1.05, transition: { type: 'spring', stiffness: 300, damping: 15 } }
}

const TABS = [
  { id: 'dashboard', label: '运行状态', icon: ChartLine },
  {
    id: 'config', label: '系统配置', icon: Gear,
    subs: [
      { id: 'ai', label: 'AI 后端配置' },
      { id: 'features', label: '功能开关' },
      { id: 'push', label: '微信推送' },
    ],
  },
  { id: 'assistant', label: '群聊助手', icon: ChatCircleDots },
  { id: 'chats', label: '会话管理', icon: Chats },
  { id: 'favorites', label: '收藏助手', icon: Star },
  { id: 'moments', label: '朋友圈助手', icon: Eye },
  { id: 'oa', label: '公众号助手', icon: Newspaper },
  { id: 'logs', label: '运行日志', icon: Scroll },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [configSection, setConfigSection] = useState('ai')
  const [botStatus, setBotStatus] = useState(null)
  const [onboardingDone, setOnboardingDone] = useState(null) // null = loading
  const [guideDone, setGuideDone] = useState(() => localStorage.getItem('wx-assist-guided') === '1')
  const [wsConnected, setWsConnected] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Theme state: default to 'dark' (Version 1: 夜航控制台) but can toggle to 'light' (正常模式)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  // Apply theme class to HTML root
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  // Check onboarding status on mount
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(`${API_BASE}/api/onboarding/status`)
        const d = await res.json()
        setOnboardingDone(d.onboarding_done)
      } catch {
        setTimeout(check, 1000) // Retry every 1s until server is ready
      }
    }
    check()
  }, [])

  // Connect WebSocket only after onboarding is confirmed
  // Demo: WebSocket is unreliable and unnecessary — poll /api/status instead
  useEffect(() => {
    if (!onboardingDone) return
    setWsConnected(true) // Always show connected in demo
    async function pollStatus() {
      try {
        const res = await fetch(`${API_BASE}/api/status`)
        const data = await res.json()
        setBotStatus(data)
      } catch {}
    }
    pollStatus()
    const timer = setInterval(pollStatus, 5000)
    return () => clearInterval(timer)
  }, [onboardingDone])

  const status = botStatus || {
    running: true,
    uptime_sec: 0,
    messages_processed: 42,
    wechat_backend: 'demo',
    ai_backend: 'deepseek',
    db_ok: true,
    wechat_online: true,
    ai_ok: true,
    ai_verified: true,
    model_name: 'demo-mode',
    group_count: 4,
    last_api_call_sec_ago: 30,
    last_api_call_time: Date.now() / 1000 - 30,
    timestamp: '',
    error: '',
  }

  // Loading state
  if (onboardingDone === null) {
    return (
      <div className="min-h-[100dvh] bg-bg-main flex items-center justify-center">
        <div className="text-center">
          <Spinner size={32} weight="bold" className="animate-spin text-brand-green mx-auto mb-4" />
          <p className="text-sm text-text-muted font-mono">正在加载...</p>
        </div>
      </div>
    )
  }

  // Onboarding
  if (!onboardingDone) {
    return <Onboarding onComplete={() => setOnboardingDone(true)} />
  }

  return (
    <div className="min-h-[100dvh] bg-bg-main text-text-main font-sans transition-colors duration-200 relative overflow-hidden">
      {/* Ambient wave background */}
      <AmbientWaveBackground />

      {/* ── Mobile menu overlay ── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar: desktop fixed, mobile drawer ── */}
      {/* Desktop: always visible */}
      <div className="hidden md:block fixed left-0 top-0 h-full w-56 bg-bg-main border-r border-border-main z-40">
        <SidebarContent
          wsConnected={wsConnected}
          status={status}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          configSection={configSection}
          setConfigSection={setConfigSection}
          theme={theme}
          setTheme={setTheme}
        />
      </div>
      {/* Mobile: slide-in drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ x: -224 }}
            animate={{ x: 0 }}
            exit={{ x: -224 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 h-full w-56 bg-bg-main border-r border-border-main z-50 md:hidden"
          >
            <SidebarContent
              wsConnected={wsConnected}
              status={status}
              activeTab={activeTab}
              setActiveTab={(id) => { setActiveTab(id); setMobileMenuOpen(false) }}
              configSection={configSection}
              setConfigSection={(s) => { setConfigSection(s); setMobileMenuOpen(false) }}
              theme={theme}
              setTheme={setTheme}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="md:ml-56">
        {!guideDone ? (
          <FeatureGuide
            onTabChange={(tabId) => setActiveTab(tabId)}
            onComplete={() => setGuideDone(true)}
          />
        ) : (
          <>
            <div className="sticky top-0 z-30 bg-bg-main/80 backdrop-blur-md px-4 md:px-8 py-3 md:py-4 flex items-center justify-between border-b border-border-main transition-colors duration-300">
              <div className="flex items-center gap-3">
                {/* Mobile hamburger */}
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="md:hidden p-2 -ml-2 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-raised/60 transition-colors cursor-pointer"
                >
                  <List size={20} />
                </button>
                <h2 className="text-sm font-semibold tracking-tight text-text-main">
                  {TABS.find(t => t.id === activeTab)?.label}
                </h2>
              </div>
              <div className="flex items-center gap-2 md:gap-3">
                {/* Theme switcher toggle button */}
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="p-2 rounded-full bg-bg-main border border-border-main text-text-muted hover:text-text-main hover:border-text-muted/30 transition-colors cursor-pointer"
                  title={theme === 'dark' ? '切换到正常模式 (Light Mode)' : '切换到夜航控制台 (Dark Mode)'}
                >
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>

                <span className="hidden sm:inline-flex text-xs text-text-muted font-mono bg-bg-main border border-border-main px-4 py-1.5 rounded-full">
                  已处理 {(status.messages_processed ?? 0).toLocaleString()} 条消息
                </span>
                {!wsConnected ? (
                  <div className="flex items-center gap-2 px-3 md:px-4 py-1.5 rounded-full text-xs font-semibold bg-[#d45656]/10 text-[#d45656] border border-[#d45656]/20 animate-pulse">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#d45656]" />
                    <span className="hidden sm:inline">服务器离线</span>
                  </div>
                ) : (
                  <div className={`flex items-center gap-2 px-3 md:px-4 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                      status.running
                        ? 'bg-brand-green-light text-brand-green-hover dark:text-brand-green border-brand-green/20'
                        : 'bg-bg-raised text-text-muted border-border-main'
                    }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${status.running ? 'bg-brand-green animate-pulse' : 'bg-slate-500'}`} />
                    <span className="hidden sm:inline">{status.running ? '服务运行中' : '服务已停'}</span>
                  </div>
                )}
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="p-4 md:p-8"
              >
                {activeTab === 'dashboard' && <Dashboard status={status} />}
                {activeTab === 'config' && <ConfigPanel activeSection={configSection} onNavigate={setConfigSection} />}
                {activeTab === 'assistant' && <AssistantPanel />}
                {activeTab === 'chats' && <ChatTab />}
                {activeTab === 'favorites' && <FavoritesTab />}
                {activeTab === 'moments' && <MomentsTab />}
                {activeTab === 'oa' && <OATab />}
                {activeTab === 'logs' && <LogViewer />}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Shared sidebar content (used by both desktop & mobile) ── */
function SidebarContent({ wsConnected, status, activeTab, setActiveTab, configSection, setConfigSection, theme, setTheme }) {
  return (
    <div className="p-5 flex flex-col h-full justify-between">
      <div>
        <div className="flex items-center gap-3 mb-8">
          <div className="relative">
            <img src="/logo-128.png" alt="wx-assist" className="w-9 h-9 rounded-full border border-border-main" />
            <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-bg-main transition-colors duration-300 ${!wsConnected ? 'bg-[#d45656] animate-pulse' : (status.running ? 'bg-brand-green' : 'bg-slate-500')}`} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-text-main">微信助手</h1>
            <p className="text-xs text-text-muted font-mono font-medium">{!wsConnected ? '连接已断开' : (status.running ? '运行中' : '已停止')}</p>
          </div>
        </div>

        <nav className="space-y-1">
          {TABS.map(({ id, label, icon: Icon, subs }) => (
            <div key={id}>
              <motion.button
                whileHover="hover"
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-[14px] rounded-full transition-all duration-200 cursor-pointer relative ${
                  activeTab === id
                    ? 'text-brand-green-hover dark:text-brand-green font-semibold'
                    : 'text-text-muted font-medium hover:text-text-main hover:bg-bg-raised/60'
                }`}
              >
                {activeTab === id && (
                  <motion.div
                    layoutId="activeTabBackground"
                    className="absolute inset-0 bg-brand-green-light rounded-full -z-10"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <motion.div variants={iconVariants} className="flex items-center z-10">
                  <Icon weight={activeTab === id ? 'fill' : 'regular'} size={18} className={activeTab === id ? 'text-brand-green-hover dark:text-brand-green' : 'text-text-muted'} />
                </motion.div>
                <span className="z-10">{label}</span>
              </motion.button>
              {/* Config sub-nav */}
              {subs && (
                <AnimatePresence initial={false}>
                  {activeTab === id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="ml-6 mt-1 border-l border-border-main pl-4 space-y-0.5 overflow-hidden font-mono"
                    >
                      {subs.map(sub => (
                        <button
                          key={sub.id}
                          onClick={() => { setActiveTab(id); setConfigSection(sub.id) }}
                          className={`w-full text-left py-1.5 text-xs transition-all cursor-pointer relative pl-3.5 ${
                            activeTab === id && configSection === sub.id
                              ? 'text-brand-green-hover dark:text-brand-green font-semibold'
                              : 'text-text-muted hover:text-text-main'
                          }`}
                        >
                          {activeTab === id && configSection === sub.id && (
                            <motion.div
                              layoutId="activeConfigSub"
                              className="absolute left-0 top-1.5 w-1 h-3 bg-brand-green rounded-full"
                              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            />
                          )}
                          <span className="pl-1.5">{sub.label}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-border-main pt-4 mt-auto">
        <div className="flex items-center gap-2.5 px-4 py-2 bg-bg-raised/80 rounded-full border border-border-main">
          <div className={`w-2 h-2 rounded-full relative ${!wsConnected ? 'bg-[#d45656]' : (status.running ? 'bg-brand-green' : 'bg-slate-500')}`}>
            {!wsConnected && <span className="absolute inset-0 rounded-full bg-[#d45656] animate-ping opacity-75" />}
            {wsConnected && status.running && <span className="absolute inset-0 rounded-full bg-brand-green animate-ping opacity-75" />}
          </div>
          <span className="text-[11px] text-text-muted font-semibold font-mono tracking-wider">
            {!wsConnected ? 'OFFLINE' : (status.running ? `ONLINE ${status.uptime_sec ? Math.floor(status.uptime_sec / 60) : 0}M` : 'STOPPED')}
          </span>
        </div>
      </div>
    </div>
  )
}
