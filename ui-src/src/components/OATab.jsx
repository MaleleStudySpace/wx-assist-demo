import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Newspaper, MagnifyingGlass, Clock, Plus, Trash, Pencil, FileText, Play, Folder, X, Export, Globe, ArrowsClockwise, Sparkle, Info, CaretDown, CaretUp, NotePencil, CodeBlock, FilmStrip, ChartBar, NewspaperClipping } from '@phosphor-icons/react'
import { Toggle, Input, API_BASE } from './SharedComponents'

// ── Preset cron schedules for easy selection ──
const CRON_PRESETS = [
  { label: '每天早上 9 点', cron: '0 9 * * *', desc: '每日早报' },
  { label: '每天中午 12 点', cron: '0 12 * * *', desc: '午间速览' },
  { label: '每天晚上 8 点', cron: '0 20 * * *', desc: '晚间汇总' },
  { label: '工作日早上 9 点', cron: '0 9 * * 1-5', desc: '工作日早报' },
  { label: '每天早 + 晚', cron: '0 9,20 * * *', desc: '一天两次' },
  { label: '手动触发', cron: '', desc: '不自动执行，手动点击生成' },
]

// ── Digest templates with clear descriptions ──
const TEMPLATES = [
  { value: 'default', label: '默认摘要', desc: '标准格式，适合日常阅读', PhosphorIcon: FileText,
    preview: '按公众号分组，每个公众号列出 3-5 条要点，附原文链接' },
  { value: 'tech', label: '技术详尽', desc: '技术内容深度分析', PhosphorIcon: CodeBlock,
    preview: '提取代码片段、技术方案、性能数据，保留技术细节' },
  { value: 'entertainment', label: '娱乐简报', desc: '一句话速览', PhosphorIcon: FilmStrip,
    preview: '每篇文章用一句话概括，快速浏览' },
  { value: 'business', label: '商业要点', desc: '财经重点提炼', PhosphorIcon: ChartBar,
    preview: '聚焦数据、趋势、投资信号，忽略情绪化内容' },
  { value: 'news', label: '新闻摘要', desc: '新闻五要素速览', PhosphorIcon: NewspaperClipping,
    preview: '谁 + 什么事 + 何时 + 何地 + 为何，结构化呈现' },
  { value: 'custom', label: '自定义提示词', desc: '编写你自己的摘要指令', PhosphorIcon: NotePencil,
    preview: '使用你自定义的提示词生成摘要' },
]

function GroupCard({ group, onEdit, onDelete, onRunDigest, digestRunning, accounts, lastDigest }) {
  const [expanded, setExpanded] = useState(false)
  const [showDigest, setShowDigest] = useState(false)
  const isRunning = digestRunning === group.id
  const digest = lastDigest?.groupId === group.id ? lastDigest : null

  // Resolve account nicknames, filter out accounts not in current list (e.g. removed service accounts)
  const accountNames = (group.accounts || [])
    .filter(gh => accounts?.some(a => a.username === gh))
    .map(gh => {
      const acc = accounts?.find(a => a.username === gh)
      return acc ? acc.nickname : gh
    })

  const scheduleLabel = (() => {
    const s = Array.isArray(group.schedule) ? group.schedule.join(', ') : group.schedule || ''
    if (!s) return '手动触发'
    const preset = CRON_PRESETS.find(p => p.cron === s)
    return preset ? preset.label : s
  })()

  const templateInfo = TEMPLATES.find(t => t.value === (group.digest_template || 'default'))

  return (
    <div className={`border rounded-xl overflow-hidden bg-bg-card transition-colors
      ${isRunning ? 'border-brand-green/40 shadow-[0_0_12px_rgba(24,226,153,0.08)]' : 'border-border-main hover:border-text-muted/20'}`}>
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-bg-raised/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-9 h-9 rounded-lg bg-brand-green-light/30 flex items-center justify-center text-brand-green">
          {templateInfo?.PhosphorIcon ? <templateInfo.PhosphorIcon size={18} /> : <Folder size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-main">{group.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-text-muted">{accountNames.length} 个公众号</span>
            <span className="text-xs text-text-muted/60">·</span>
            <span className="text-xs text-text-muted">{scheduleLabel}</span>
            {templateInfo && (
              <>
                <span className="text-xs text-text-muted/60">·</span>
                <span className="text-xs text-brand-green/70">{templateInfo.label}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="flex items-center gap-1.5 text-brand-green text-xs">
              <div className="w-3.5 h-3.5 border-2 border-brand-green/30 border-t-brand-green rounded-full animate-spin" />
              <span className="text-xs">生成中</span>
            </div>
          )}
          {expanded ? <CaretUp size={14} className="text-text-muted" /> : <CaretDown size={14} className="text-text-muted" />}
        </div>
      </div>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="px-4 pb-4"
        >
          <div className="pt-3 border-t border-border-main">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">摘要模板</span>
                <span className="text-text-main">
                  {templateInfo?.PhosphorIcon ? <templateInfo.PhosphorIcon size={14} className="inline text-brand-green" /> : null} {templateInfo?.label || group.digest_template || 'default'}
                  {group.custom_prompt && group.digest_template === 'custom' && (
                    <span className="text-text-muted ml-1 truncate max-w-[120px] inline-block align-bottom">
                      {group.custom_prompt.slice(0, 30)}...
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">执行时间</span>
                <span className="text-text-main">{scheduleLabel}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">回溯时间</span>
                <span className="text-text-main">
                  {group.lookback_mode === 'auto' ? '智能回溯' : `手动: ${group.lookback_hours || 24} 小时`}
                </span>
              </div>
              {group.push_target && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">推送目标</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-brand-green/10 text-brand-green-hover dark:text-brand-green font-medium">
                    微信推送
                  </span>
                </div>
              )}
            </div>

            {/* Digest preview */}
            {digest && digest.text && (
              <div className="mt-3 pt-3 border-t border-border-main">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-text-muted font-medium">最近摘要</p>
                  <button
                    onClick={() => setShowDigest(!showDigest)}
                    className="text-xs text-brand-green hover:underline cursor-pointer"
                  >
                    {showDigest ? '收起' : '展开查看'}
                  </button>
                </div>
                {showDigest && (
                  <div className="p-3 rounded-lg bg-bg-raised border border-border-main text-xs text-text-main leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {digest.text}
                  </div>
                )}
                {!showDigest && (
                  <p className="text-xs text-text-muted line-clamp-2">{digest.text}</p>
                )}
              </div>
            )}

            {accountNames.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border-main">
                <p className="text-xs text-text-muted mb-2">包含公众号</p>
                <div className="flex flex-wrap gap-1.5">
                  {accountNames.map((name, i) => (
                    <span
                      key={i}
                      className="text-xs px-2.5 py-1 rounded-full bg-brand-green-light/20 text-brand-green/80 border border-brand-green/10"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Action bar — read-only demo, only generate */}
            <div className="mt-3 pt-3 border-t border-border-main flex items-center gap-4">
              <button
                onClick={(e) => { e.stopPropagation(); onRunDigest(group.id) }}
                disabled={isRunning}
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer
                  ${isRunning
                    ? 'text-brand-green/50 cursor-wait'
                    : 'text-brand-green hover:text-brand-green-hover'
                  }`}
              >
                <Play size={13} weight="fill" />
                {isRunning ? '生成中...' : '生成摘要'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}

function GroupEditor({ group, accounts, onSave, onCancel }) {
  const [name, setName] = useState(group?.name || '')
  const [schedule, setSchedule] = useState(
    Array.isArray(group?.schedule) ? group.schedule.join(', ') : group?.schedule || ''
  )
  const [template, setTemplate] = useState(group?.digest_template || 'default')
  const [customPrompt, setCustomPrompt] = useState(group?.custom_prompt || '')
  const [lookback, setLookback] = useState(group?.lookback_hours || 24)
  const [lookbackMode, setLookbackMode] = useState(group?.lookback_mode || 'auto')
  const [pushTarget, setPushTarget] = useState(group?.push_target === 'ilink')
  const [selectedAccounts, setSelectedAccounts] = useState(group?.accounts || [])
  const [accountSearch, setAccountSearch] = useState('')
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const s = Array.isArray(group?.schedule) ? group.schedule.join(', ') : group?.schedule || ''
    const idx = CRON_PRESETS.findIndex(p => p.cron === s)
    return idx >= 0 ? idx : -1
  })
  const [showTemplatePreview, setShowTemplatePreview] = useState(null)

  // ── Account picker logic ──────────────────────────────────────────────
  const filteredAccounts = accounts.filter(acc => {
    if (!accountSearch) return true
    const q = accountSearch.toLowerCase()
    return (acc.nickname || '').toLowerCase().includes(q) || (acc.username || '').toLowerCase().includes(q)
  })

  // Sort: selected first, then alphabetically
  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    const aSel = selectedAccounts.includes(a.username) ? 0 : 1
    const bSel = selectedAccounts.includes(b.username) ? 0 : 1
    if (aSel !== bSel) return aSel - bSel
    return (a.nickname || a.username).localeCompare(b.nickname || b.username)
  })

  function toggleAccount(username) {
    setSelectedAccounts(prev =>
      prev.includes(username) ? prev.filter(a => a !== username) : [...prev, username]
    )
  }

  function removeAccount(username) {
    setSelectedAccounts(prev => prev.filter(a => a !== username))
  }

  // ── Cron / lookback logic ─────────────────────────────────────────────
  function handlePresetSelect(idx) {
    setSelectedPreset(idx)
    if (idx >= 0) {
      setSchedule(CRON_PRESETS[idx].cron)
    }
  }

  // Estimate lookback from schedule for auto mode preview
  function estimateAutoLookback() {
    if (!schedule) return 24
    const parts = schedule.trim().split(/\s+/)
    if (parts.length < 2) return 24
    const hourPart = parts[1]
    const hours = new Set()
    for (const h of hourPart.split(',')) {
      const n = parseInt(h, 10)
      if (!isNaN(n)) hours.add(n)
    }
    if (hours.size >= 2) {
      const sorted = [...hours].sort((a, b) => a - b)
      const gaps = []
      for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1])
      gaps.push(24 - sorted[sorted.length - 1] + sorted[0])
      return Math.min(...gaps) + 1
    } else if (hours.size === 1) {
      return 25
    }
    return 24
  }

  const autoLookbackEstimate = estimateAutoLookback()

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="border border-border-main rounded-xl bg-bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-main">{group ? '编辑分组' : '新建分组'}</h4>
        <button onClick={onCancel} className="text-text-muted hover:text-text-main cursor-pointer">
          <X size={16} />
        </button>
      </div>

      {/* Step 1: Name */}
      <div>
        <label className="block text-xs text-text-muted mb-1.5">
          分组名称 <span className="text-brand-green">*</span>
        </label>
        <Input value={name} onChange={setName} placeholder="例如：科技资讯、每日必读" />
        <p className="text-xs text-text-muted/60 mt-1">给这组公众号起个名字，方便管理</p>
      </div>

      {/* Step 2: Accounts — searchable checkbox picker */}
      <div>
        <label className="block text-xs text-text-muted mb-1.5">
          公众号列表 <span className="text-brand-green">*</span>
        </label>

        {/* Selected accounts as removable tags */}
        {selectedAccounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selectedAccounts.map(gh => {
              const acc = accounts?.find(a => a.username === gh)
              return (
                <span
                  key={gh}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-brand-green-light/30 border border-brand-green/20 text-brand-green"
                >
                  {acc?.nickname || gh}
                  <button
                    onClick={() => removeAccount(gh)}
                    className="hover:text-brand-green-hover cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Search + scrollable checkbox list */}
        <div className="border border-border-main rounded-lg overflow-hidden">
          <div className="relative border-b border-border-main bg-bg-raised">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="搜索公众号..."
              className="w-full bg-transparent pl-9 pr-3 py-2 text-xs text-text-main
                placeholder:text-text-muted/60 focus:outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {sortedAccounts.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">
                {accountSearch ? '没有匹配的公众号' : '暂无公众号数据'}
              </p>
            ) : (
              sortedAccounts.map(acc => {
                const isSelected = selectedAccounts.includes(acc.username)
                return (
                  <button
                    key={acc.username}
                    onClick={() => toggleAccount(acc.username)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer
                      ${isSelected ? 'bg-brand-green-light/10' : 'hover:bg-bg-raised/60'}`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                      ${isSelected ? 'bg-brand-green border-brand-green' : 'border-border-main'}`}>
                      {isSelected && (
                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-bg-main" fill="currentColor">
                          <path d="M10.28 2.28L4.5 8.06 1.72 5.28l-.72.72L4.5 9.5l6.5-6.5z"/>
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-main truncate">{acc.nickname || acc.username}</p>
                      <p className="text-xs text-text-muted font-mono truncate">{acc.username}</p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
        <p className="text-xs text-text-muted/60 mt-1">已选 {selectedAccounts.length} 个公众号</p>
      </div>

      {/* Step 3: Schedule */}
      <div>
        <label className="block text-xs text-text-muted mb-2">执行时间</label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {CRON_PRESETS.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => handlePresetSelect(idx)}
              className={`text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
                ${selectedPreset === idx
                  ? 'border-brand-green/40 bg-brand-green-light/15 text-brand-green'
                  : 'border-border-main bg-bg-raised text-text-muted hover:border-text-muted/30 hover:text-text-main'
                }`}
            >
              <p className="text-xs font-medium">{preset.label}</p>
              <p className="text-xs opacity-60 mt-0.5">{preset.desc}</p>
            </button>
          ))}
        </div>
        <div>
          <p className="text-xs text-text-muted/60 mb-1">或自定义 Cron 表达式（分钟 小时 日 月 周）</p>
          <Input
            value={schedule}
            onChange={(v) => { setSchedule(v); setSelectedPreset(-1); }}
            placeholder="0 9 * * *"
          />
        </div>
      </div>

      {/* Step 4: Template + custom prompt */}
      <div>
        <label className="block text-xs text-text-muted mb-2">摘要模板</label>
        <div className="space-y-2">
          {TEMPLATES.map(t => (
            <button
              key={t.value}
              onClick={() => setTemplate(t.value)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
                ${template === t.value
                  ? 'border-brand-green/40 bg-brand-green-light/15'
                  : 'border-border-main bg-bg-raised hover:border-text-muted/30'
                }`}
            >
              <div className="flex items-center gap-2">
                {t.PhosphorIcon ? <t.PhosphorIcon size={16} className="text-brand-green" /> : null}
                <span className={`text-xs font-medium ${template === t.value ? 'text-brand-green' : 'text-text-main'}`}>
                  {t.label}
                </span>
                <span className="text-xs text-text-muted ml-1">{t.desc}</span>
                {t.value !== 'custom' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowTemplatePreview(showTemplatePreview === t.value ? null : t.value) }}
                    className="ml-auto p-1 rounded text-text-muted hover:text-text-main"
                  >
                    <Info size={12} />
                  </button>
                )}
              </div>
              <AnimatePresence>
                {showTemplatePreview === t.value && (
                  <motion.p
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="text-xs text-text-muted mt-1.5 pt-1.5 border-t border-border-main/50 overflow-hidden"
                  >
                    {t.preview}
                  </motion.p>
                )}
              </AnimatePresence>
            </button>
          ))}
        </div>

        {/* Custom prompt textarea */}
        <AnimatePresence>
          {template === 'custom' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="输入自定义摘要提示词，例如：请用表格形式总结每篇文章的核心要点..."
                rows={4}
                className="mt-2 w-full bg-bg-raised border border-border-main rounded-xl px-4 py-2.5 text-sm text-text-main
                  placeholder:text-text-muted/65 resize-none
                  focus:outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15"
              />
              <p className="text-xs text-text-muted/60 mt-1">自定义提示词将替代预设模板，用于 AI 生成摘要</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Step 5: Lookback mode */}
      <div>
        <label className="block text-xs text-text-muted mb-2">回溯时间</label>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setLookbackMode('auto')}
            className={`flex-1 text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
              ${lookbackMode === 'auto'
                ? 'border-brand-green/40 bg-brand-green-light/15 text-brand-green'
                : 'border-border-main bg-bg-raised text-text-muted hover:border-text-muted/30 hover:text-text-main'
              }`}
          >
            <p className="text-xs font-medium">智能回溯</p>
            <p className="text-xs opacity-60 mt-0.5">
              自动根据定时间隔计算（约 {autoLookbackEstimate} 小时）
            </p>
          </button>
          <button
            onClick={() => setLookbackMode('manual')}
            className={`flex-1 text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
              ${lookbackMode === 'manual'
                ? 'border-brand-green/40 bg-brand-green-light/15 text-brand-green'
                : 'border-border-main bg-bg-raised text-text-muted hover:border-text-muted/30 hover:text-text-main'
              }`}
          >
            <p className="text-xs font-medium">手动指定</p>
            <p className="text-xs opacity-60 mt-0.5">自定义回溯小时数</p>
          </button>
        </div>

        {lookbackMode === 'manual' && (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="72"
              value={lookback}
              onChange={(e) => setLookback(parseInt(e.target.value))}
              className="flex-1 accent-brand-green"
            />
            <span className="text-xs font-medium text-text-main w-16 text-right">
              {lookback} 小时
            </span>
          </div>
        )}
        <p className="text-xs text-text-muted/60 mt-1">
          {lookbackMode === 'auto'
            ? `定时间隔 + 1h 缓冲，自动适配执行周期`
            : '生成摘要时，回溯多长时间内的文章'}
        </p>
      </div>

      {/* Step 6: Push to WeChat */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">推送到微信</p>
          <p className="text-xs text-text-muted/60 mt-0.5">开启后摘要结果自动推送到微信私聊（需先绑定 iLink Bot）</p>
        </div>
        <Toggle enabled={pushTarget} onChange={setPushTarget} />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onSave({
            name,
            schedule: schedule.split(',').map(s => s.trim()).filter(Boolean),
            digest_template: template,
            custom_prompt: template === 'custom' ? customPrompt : '',
            lookback_hours: lookback,
            lookback_mode: lookbackMode,
            push_target: pushTarget ? 'ilink' : '',
            accounts: selectedAccounts,
          })}
          disabled={!name.trim() || selectedAccounts.length === 0 || (template === 'custom' && !customPrompt.trim())}
          className="flex-1 py-2.5 rounded-full bg-brand-green-hover text-white text-sm font-semibold
            hover:bg-brand-green-hover transition-colors cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          保存分组
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-full bg-bg-raised text-text-muted text-sm font-semibold
            hover:bg-bg-raised/80 transition-colors cursor-pointer"
        >
          取消
        </button>
      </div>
    </div>
  )
}

function ArticleCard({ article }) {
  const timeStr = article.create_time
    ? new Date(article.create_time * 1000).toLocaleDateString('zh-CN')
    : article.pub_time
      ? new Date(article.pub_time * 1000).toLocaleDateString('zh-CN')
      : ''

  return (
    <div className="border border-border-main rounded-xl overflow-hidden bg-bg-card hover:border-text-muted/20 transition-colors">
      <div className="p-4">
        <div className="flex items-start gap-3">
          {article.cover ? (
            <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-bg-raised border border-border-main">
              <img src={article.cover} alt="" className="w-full h-full object-cover"
                onError={(e) => { e.target.style.display = 'none' }} />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-lg bg-bg-raised flex items-center justify-center text-text-muted shrink-0 border border-border-main">
              <FileText size={20} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-text-main hover:text-brand-green transition-colors line-clamp-2"
            >
              {article.title}
            </a>
            <p className="text-xs text-text-muted mt-1 line-clamp-2">
              {article.digest || ''}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              {article.source_name && (
                <span className="text-xs text-brand-green/80 flex items-center gap-0.5">
                  <Globe size={8} /> {article.source_name}
                </span>
              )}
              {timeStr && (
                <span className="text-xs text-text-muted font-mono">{timeStr}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OATab() {
  const [accounts, setAccounts] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [digestRunning, setDigestRunning] = useState('')
  const [digestProgress, setDigestProgress] = useState('')  // Step 13: progress feedback
  const [lastDigest, setLastDigest] = useState(null)  // { groupId, text, articlesCount }
  const [selectedAccount, setSelectedAccount] = useState(null)  // 点击查看历史文章的公众号
  const [accountArticles, setAccountArticles] = useState([])
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [accountFilter, setAccountFilter] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  // WebSocket for digest completion (addEventListener to avoid listener accumulation)
  useEffect(() => {
    const handleMessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'oa_digest_progress') {
          if (data.status === 'completed' || data.status === 'error') {
            setDigestRunning('')
          }
          if (data.progress) {
            setDigestProgress(data.progress)
          }
        }
        if (data.type === 'oa_digest_push_result') {
          // Show push result as digest progress message
          const pushMsg = data.success
            ? `✓ 推送成功: ${data.group_name}`
            : `⚠ 推送失败: ${data.group_name} — ${data.error || '未知错误'}`
          setDigestProgress(pushMsg)
          setTimeout(() => setDigestProgress(''), 3000)
        }
      } catch {}
    }
    let ws = window.__oa_ws
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${wsProtocol}//${API_BASE.replace(/^https?:\/\//, '')}/ws`)
      window.__oa_ws = ws
    }
    ws.addEventListener('message', handleMessage)
    return () => { ws.removeEventListener('message', handleMessage) }
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [accRes, groupRes] = await Promise.all([
        fetch(`${API_BASE}/api/oa/accounts`),
        fetch(`${API_BASE}/api/oa/groups`),
      ])
      const accData = await accRes.json()
      const groupData = await groupRes.json()
      if (accData.ok) setAccounts(accData.data || [])
      if (groupData.ok) setGroups(groupData.data || [])
    } catch {
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveGroup(data) {
    try {
      const method = editingGroup ? 'PUT' : 'POST'
      const url = editingGroup
        ? `${API_BASE}/api/oa/groups/${editingGroup.id}`
        : `${API_BASE}/api/oa/groups/create`

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await res.json()
      if (result.ok) {
        setShowEditor(false)
        setEditingGroup(null)
        loadData()
      }
    } catch {}
  }

  async function handleDeleteGroup(id) {
    if (!confirm('确定删除此分组？')) return
    try {
      const res = await fetch(`${API_BASE}/api/oa/groups/${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.ok) loadData()
    } catch {}
  }

  async function handleRunDigest(groupId) {
    setDigestRunning(groupId)
    setDigestProgress('开始生成...')
    try {
      const res = await fetch(`${API_BASE}/api/oa/digest/run/${groupId}`, { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.summary) {
        setLastDigest({ groupId, text: data.summary, articlesCount: data.articles_count || 0 })
        setDigestProgress('')
      } else if (data.ok && !data.summary) {
        setDigestProgress('AI 返回了空结果')
      } else {
        setDigestProgress(data.error || '生成失败')
      }
    } catch (e) {
      setDigestProgress('网络错误')
    }
    setDigestRunning('')
    setTimeout(() => setDigestProgress(''), 3000)
  }

  async function handleSearch() {
    if (!search.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`${API_BASE}/api/oa/search?q=${encodeURIComponent(search)}`)
      const data = await res.json()
      if (data.ok) setSearchResults(data.data || [])
    } catch {}
    setSearching(false)
  }

  async function handleViewAccount(ghId, nickname) {
    // Toggle: click same account again to close
    if (selectedAccount?.username === ghId) {
      setSelectedAccount(null)
      setAccountArticles([])
      return
    }
    setSelectedAccount({ username: ghId, nickname })
    setLoadingArticles(true)
    setAccountArticles([])
    try {
      const res = await fetch(`${API_BASE}/api/oa/articles?gh_id=${encodeURIComponent(ghId)}&limit=50`)
      const data = await res.json()
      if (data.ok) setAccountArticles(data.data || [])
    } catch {}
    setLoadingArticles(false)
  }

  function clearSearch() {
    setSearch('')
    setSearchResults([])
  }

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-1.5 h-4.5 rounded-full shadow-sm" style={{ backgroundColor: '#F59E0B' }} />
          <h3 className="text-sm font-semibold tracking-tight text-text-main">公众号</h3>
          <Newspaper size={16} className="text-text-muted" />
        </div>
        <p className="text-xs text-text-muted leading-relaxed pl-4">将公众号按主题分组，AI 定时生成摘要并推送微信通知</p>
      </div>

      {/* Refresh button */}
      <div className="mb-3 flex items-center justify-end">
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-text-muted hover:text-text-main hover:bg-bg-raised transition-colors cursor-pointer"
          title="刷新公众号列表（需先在微信中打开公众号历史消息）"
        >
          <ArrowsClockwise size={12} />
          刷新数据
        </button>
      </div>

      {/* Account overview */}
      {accounts.length > 0 && (
        <div className="mb-5 p-4 rounded-xl border border-border-main bg-bg-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-text-muted font-medium">已关注公众号 ({accounts.length})</p>
            <p className="text-xs text-text-muted/70">点击查看历史文章，再次点击关闭</p>
          </div>
          {accounts.length > 10 && (
            <div className="relative mb-2">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                placeholder="搜索公众号..."
                className="w-full bg-bg-raised border border-border-main rounded-full pl-9 pr-3 py-1.5 text-xs text-text-main
                  placeholder:text-text-muted/60 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/15"
              />
              {accountFilter && (
                <button
                  onClick={() => setAccountFilter('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {accounts
              .filter(acc => !accountFilter || (acc.nickname || acc.username).toLowerCase().includes(accountFilter.toLowerCase()))
              .map(acc => (
                <button
                  key={acc.username}
                  onClick={() => handleViewAccount(acc.username, acc.nickname)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer
                    ${selectedAccount?.username === acc.username
                      ? 'bg-brand-green-light/30 border-brand-green/30 text-brand-green'
                      : 'bg-bg-raised text-text-main border-border-main hover:border-brand-green/30 hover:text-brand-green'
                    }`}
                >
                  {acc.nickname || acc.username}
                </button>
              ))}
            {accountFilter && accounts.filter(acc => (acc.nickname || acc.username).toLowerCase().includes(accountFilter.toLowerCase())).length === 0 && (
              <p className="text-xs text-text-muted py-1">没有匹配的公众号</p>
            )}
          </div>
        </div>
      )}

      {/* Selected account articles panel */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-5 overflow-hidden"
          >
            <div className="p-4 rounded-xl border border-brand-green/20 bg-bg-card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-brand-green" />
                  <span className="text-sm font-medium text-text-main">{selectedAccount.nickname || selectedAccount.username}</span>
                  <span className="text-xs text-text-muted">的历史文章</span>
                </div>
                <button
                  onClick={() => { setSelectedAccount(null); setAccountArticles([]) }}
                  className="p-1.5 rounded-full text-text-muted hover:text-text-main hover:bg-bg-raised transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              {loadingArticles ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-brand-green/30 border-t-brand-green rounded-full animate-spin" />
                </div>
              ) : accountArticles.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-xs">
                  <FileText size={24} className="mx-auto mb-2 opacity-30" />
                  <p>暂无文章</p>
                  <p className="text-xs mt-1">请在微信中打开该公众号的历史消息后刷新</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {accountArticles.map((article, i) => (
                    <ArticleCard key={i} article={article} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="mb-5">
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <MagnifyingGlass size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索公众号文章..."
              className="w-full bg-bg-raised border border-border-main rounded-full pl-10 pr-10 py-2.5 text-sm text-text-main
                placeholder:text-text-muted/65 font-mono
                focus:outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/15
                transition-all"
            />
            {search && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !search.trim()}
            className="px-4 py-2.5 rounded-full text-xs font-medium bg-bg-raised border border-border-main
              text-text-muted hover:text-text-main hover:border-text-muted/30 transition-all
              disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </div>

        {/* Search results */}
        <AnimatePresence>
          {searchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-4"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-text-muted">搜索结果 ({searchResults.length})</p>
                <button onClick={() => setSearchResults([])} className="text-xs text-text-muted hover:text-text-main cursor-pointer">
                  清除
                </button>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {searchResults.map((article, i) => (
                  <ArticleCard key={i} article={article} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Group Editor */}
      <AnimatePresence>
        {showEditor && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="mb-6"
          >
            <GroupEditor
              group={editingGroup}
              accounts={accounts}
              onSave={handleSaveGroup}
              onCancel={() => { setShowEditor(false); setEditingGroup(null) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Groups */}
      <div className="mb-2">
        <p className="text-xs text-text-muted font-medium">
          AI 摘要分组 ({groups.length})
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-green/30 border-t-brand-green rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border-main rounded-xl bg-bg-raised/30">
          <Sparkle size={32} className="mx-auto mb-3 text-brand-green/30" />
          <p className="text-sm text-text-muted">暂无摘要分组</p>
          <div className="mt-3 space-y-1.5 text-xs text-text-muted/60 max-w-xs mx-auto">
            <p><span className="text-brand-green/80">1.</span> 将公众号按主题分组（如"科技资讯"）</p>
            <p><span className="text-brand-green/80">2.</span> 选择摘要模板和执行时间</p>
            <p><span className="text-brand-green/80">3.</span> AI 按时生成该分组所有公众号的内容摘要</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => (
            <GroupCard
              key={group.id}
              group={group}
              accounts={accounts}
              onEdit={(g) => { setEditingGroup(g); setShowEditor(true) }}
              onDelete={handleDeleteGroup}
              onRunDigest={handleRunDigest}
              digestRunning={digestRunning}
              lastDigest={lastDigest}
            />
          ))}
        </div>
      )}

      {/* Running digest indicator (kept for when user scrolls away from the group card) */}
      {digestRunning && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 right-6 px-4 py-3 rounded-xl bg-brand-green-light border border-brand-green/30 text-brand-green text-sm font-medium flex items-center gap-2 shadow-lg"
        >
          <div className="w-4 h-4 border-2 border-brand-green/30 border-t-brand-green rounded-full animate-spin" />
          {digestProgress || '生成摘要中...'}
        </motion.div>
      )}
    </motion.div>
  )
}
