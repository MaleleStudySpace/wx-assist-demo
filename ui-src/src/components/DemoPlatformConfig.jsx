import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle, QrCode, SignOut, TestTube, WarningCircle, Spinner } from '@phosphor-icons/react'
import { QRCodeSVG } from 'qrcode.react'
import { loadDemoPlatforms, getDemoPlatforms, subscribeSession, updateDemoPlatform } from '../utils/demoSessionStore'

const LABELS = { qqbot: 'QQ', feishu: '飞书' }

export function DemoPlatformConfig({ platform, onBack, onUpdated }) {
  const label = LABELS[platform] || platform
  const [config, setConfig] = useState(() => getDemoPlatforms().find(p => p.name === platform) || null)
  const [phase, setPhase] = useState('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    loadDemoPlatforms().then(items => {
      if (active) setConfig(items.find(p => p.name === platform) || null)
    })
    return subscribeSession('platforms', items => {
      if (items) setConfig(items.find(p => p.name === platform) || null)
    })
  }, [platform])

  const bound = Boolean(config?.config?.bound)

  function bindDemo() {
    setBusy(true); setError(''); setMessage('')
    setPhase('waiting')
    window.setTimeout(() => setPhase('scanned'), 900)
    window.setTimeout(() => {
      const next = updateDemoPlatform(platform, p => ({
        config: { ...p.config, bound: true, demo_user: platform === 'qqbot' ? 'demo_qq_user' : 'demo_feishu_user' },
        status: { state: 'ok', ok: true, detail: 'Demo 已连接' },
      }))
      setConfig(next.find(p => p.name === platform))
      setPhase('confirmed'); setBusy(false)
      setMessage(`${label} Demo 绑定成功，仅对当前浏览器有效`)
      onUpdated?.()
    }, 1900)
  }

  function unbind() {
    const next = updateDemoPlatform(platform, p => ({
      config: { ...p.config, bound: false, demo_user: '' },
      status: { state: 'unconfigured', ok: false, detail: '尚未绑定' },
    }))
    setConfig(next.find(p => p.name === platform)); setPhase('idle'); setMessage(`${label} Demo 已解除绑定`); onUpdated?.()
  }

  function testPush() {
    if (!bound) { setError(`请先绑定 ${label} Demo`); return }
    setBusy(true); setError(''); setMessage('正在模拟发送测试消息...')
    window.setTimeout(() => { setBusy(false); setMessage(`测试消息已发送到 ${label} Demo 客户端`) }, 800)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack} className="mt-0.5 rounded-lg p-1.5 text-text-muted hover:bg-bg-raised hover:text-text-main cursor-pointer"><ArrowLeft size={18} /></button>
        <div><h4 className="text-[15px] font-semibold text-text-main">{label}绑定</h4><p className="mt-1 text-xs text-text-muted">这是 Demo 模拟绑定，不会连接真实 {label} 账号。</p></div>
      </div>
      {bound && phase === 'idle' ? (
        <div className="space-y-4 rounded-xl border border-border-main bg-bg-raised p-5">
          <div className="flex items-start gap-3 rounded-xl border border-brand-green/20 bg-brand-green-light/30 px-4 py-3"><CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-green" /><div><p className="text-sm font-semibold text-text-main">已连接 Demo</p><p className="mt-1 text-xs text-text-muted">当前浏览器会话已绑定 {label} 模拟账号。</p></div></div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={testPush} className="inline-flex items-center gap-1.5 rounded-full bg-brand-green-hover px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><TestTube size={14} />发送测试消息</button><button type="button" disabled={busy} onClick={unbind} className="inline-flex items-center gap-1.5 rounded-full border border-border-main px-4 py-2 text-xs font-semibold text-text-muted hover:text-status-error disabled:opacity-50"><SignOut size={14} />解除绑定</button></div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-border-main bg-bg-raised p-5 text-center">
          <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-lg border border-border-main bg-white p-3"><QRCodeSVG value={`wx-assist-demo://${platform}/bind/demo-${platform}`} size={180} level="M" includeMargin fgColor="#111827" /></div>
          <p className="text-sm text-text-main">{phase === 'waiting' ? '等待扫码授权...' : phase === 'scanned' ? '已扫码，请确认绑定' : phase === 'confirmed' ? '绑定成功' : `使用${label}扫码绑定`}</p>
          {phase === 'idle' || phase === 'confirmed' ? <button type="button" disabled={busy} onClick={bindDemo} className="rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover disabled:opacity-50"><QrCode size={15} className="inline mr-1.5" />{phase === 'confirmed' ? '再次绑定' : '开始模拟绑定'}</button> : <button type="button" onClick={() => { setPhase('idle'); setBusy(false) }} className="rounded-lg border border-border-main px-4 py-2 text-sm text-text-muted">取消</button>}
        </div>
      )}
      {(message || error) && <div className={`flex items-center gap-2 text-xs ${error ? 'text-status-error' : 'text-brand-green'}`}>{error ? <WarningCircle size={16} /> : <CheckCircle size={16} weight="fill" />}{error || message}</div>}
    </div>
  )
}

export function DemoPushPlatformView({ wechatContent }) {
  const [tab, setTab] = useState('overview')
  const [platforms, setPlatforms] = useState([])
  const reload = () => loadDemoPlatforms().then(setPlatforms)
  useEffect(() => { reload(); return subscribeSession('platforms', items => items && setPlatforms(items)) }, [])
  return <div>
    <div className="flex items-center gap-1 border-b border-border-main mb-6 overflow-x-auto">
      {['overview', 'qqbot', 'feishu'].map(id => <button key={id} type="button" onClick={() => setTab(id)} className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${tab === id ? 'border-brand-green text-brand-green-hover font-semibold' : 'border-transparent text-text-muted hover:text-text-main'}`}>{id === 'overview' ? '多平台调度' : LABELS[id]}</button>)}
    </div>
    {tab === 'overview' ? <div className="space-y-5"><div><h4 className="text-[15px] font-semibold text-text-main">多平台调度</h4><p className="text-xs text-text-muted mt-1">绑定哪些平台，Demo 就展示哪些推送结果。所有绑定均为当前浏览器模拟状态。</p></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4">{platforms.map(p => <button key={p.name} type="button" onClick={() => p.name !== 'wechat' && setTab(p.name)} className="text-left rounded-xl border border-border-main p-4 hover:border-brand-green/50 transition-all cursor-pointer"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-text-main">{p.label}</span><span className={`w-2.5 h-2.5 rounded-full ${p.name === 'wechat' ? 'bg-text-muted/40' : p.status?.state === 'ok' ? 'bg-status-ok' : 'bg-text-muted/40'}`} /></div><p className="text-xs mt-2 text-text-muted">{p.name === 'wechat' ? '微信 iLink 可在下方绑定' : p.status?.state === 'ok' ? '已连接 Demo' : '未绑定'}</p><p className="text-xs text-brand-green-hover mt-4">{p.name === 'wechat' ? '绑定微信' : '进入 Demo 配置 →'}</p></button>)}</div><div className="border-t border-border-main pt-5"><p className="text-xs text-text-muted mb-3">微信 iLink Bot</p>{wechatContent}</div></div> : <DemoPlatformConfig platform={tab} onBack={() => setTab('overview')} onUpdated={reload} />}
  </div>
}
