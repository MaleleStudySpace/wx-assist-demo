import { CheckCircle } from '@phosphor-icons/react'

/* ───────────────────────────────────────────────
   MockPhoneFrame — 公共「模拟 iPhone + 微信聊天窗口」骨架
   被 AgentPanel / SkillLibrary 等板块复用，改一处即可全局生效。
   ─────────────────────────────────────────────── */

export const USER_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80'

/* ── ClawBot 头像 ── */
export function ClawAvatar() {
  return (
    <div className="w-[42px] h-[42px] rounded-lg bg-[#ef4545] shrink-0 flex items-center justify-center gap-1 shadow-[0_2px_6px_rgba(239,69,68,0.25)]">
      <div className="w-[9px] h-[9px] bg-white rounded-full" />
      <div className="w-[9px] h-[9px] bg-white rounded-full" />
    </div>
  )
}

/* ── 手机壳（状态栏 / 导航栏 / 消息区 / 输入栏 / Home 条） ── */
export function MockPhoneFrame({
  chatRef,
  children,
  inputHint,
  title = '摘星 Agent',
  time = '15:42',
  height = 'h-[640px]',
}) {
  return (
    <div className="w-full max-w-[360px] mx-auto lg:mx-0 shrink-0">
      <div className={`${height} bg-[#ededed] rounded-[44px] relative flex flex-col overflow-hidden border-[5px] border-[#1a1a1a]`} style={{ boxShadow: '0 30px 70px -10px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.08)' }}>
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[110px] h-[30px] bg-black rounded-[16px] z-[100]" />
        <div className="h-12 px-7 pt-4 flex justify-between text-[#1a1a1a] text-[15px] font-semibold shrink-0 z-50">
          <span>{time}</span>
          <span className="text-xs flex items-center gap-1.5">
            <svg width="14" height="10" viewBox="0 0 14 10">
              <rect x="0.5" y="6" width="2.5" height="3.5" rx="0.6" fill="#1a1a1a"/>
              <rect x="3.5" y="4" width="2.5" height="5.5" rx="0.6" fill="#1a1a1a"/>
              <rect x="6.5" y="2" width="2.5" height="7.5" rx="0.6" fill="#1a1a1a"/>
              <rect x="9.5" y="0" width="2.5" height="9.5" rx="0.6" fill="#1a1a1a" opacity="0.2"/>
            </svg>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>5G</span>
            <svg width="20" height="11" viewBox="0 0 20 11">
              <rect x="0.5" y="1" width="15" height="8.5" rx="2" fill="none" stroke="#1a1a1a" strokeWidth="1"/>
              <rect x="2" y="2.5" width="12" height="5.5" rx="1" fill="#1a1a1a"/>
              <path d="M16.5 3.5 L18.5 3.5 L18.5 7.5 L16.5 7.5" fill="none" stroke="#1a1a1a" strokeWidth="1" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
        <div className="h-[52px] flex items-center justify-between px-4 border-b border-black/[0.08] shrink-0 bg-[#ededed]">
          <span className="text-[26px] text-black font-light leading-none">‹</span>
          <div className="text-[17px] font-semibold text-[#1a1a1a] flex items-center gap-1.5 tracking-[0.3px]">
            {title}
            <span className="bg-[#d5d5d5] text-[#555] text-[11px] font-bold py-0.5 px-1.5 rounded">AI</span>
          </div>
          <div className="flex gap-1 items-center px-1 py-2.5">
            <div className="w-[5px] h-[5px] rounded-full bg-black" />
            <div className="w-[5px] h-[5px] rounded-full bg-black" />
            <div className="w-[5px] h-[5px] rounded-full bg-black" />
          </div>
        </div>
        <div ref={chatRef} className="flex-1 overflow-y-auto p-[18px_14px] flex flex-col gap-3.5 bg-[#ededed] text-[15px]" style={{ scrollbarWidth: 'none' }}>
          {children}
        </div>
        <div className="h-14 bg-[#f7f7f7] border-t border-black/[0.06] flex items-center px-3 gap-2.5 shrink-0">
          <svg viewBox="0 0 24 24" width="26" height="26" stroke="#1a1a1a" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
          <div className="flex-1 h-10 bg-white rounded-md flex items-center px-3 text-[#1a1a1a] text-[15px] border border-black/[0.08] overflow-hidden whitespace-nowrap">
            {inputHint || '给摘星发消息...'}
          </div>
          <svg viewBox="0 0 256 256" width="24" height="24" fill="none" stroke="#1a1a1a" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="128" cy="128" r="40" /><path d="M128 80v-8M128 184v-8M80 128h-8M184 128h-8" /></svg>
          <div className="w-[30px] h-[30px] rounded-full border-[1.5px] border-[#1a1a1a] flex items-center justify-center text-[#1a1a1a] font-bold text-base shrink-0">＋</div>
        </div>
        <div className="h-[22px] bg-[#f7f7f7] flex justify-center items-end pb-1.5 shrink-0">
          <div className="w-[130px] h-[5px] bg-black rounded-[100px]" />
        </div>
      </div>
    </div>
  )
}

/* ── 聊天气泡 ── */
export function TimeDivider({ text }) {
  return <div className="text-center text-xs text-[#888] my-1 tracking-[0.3px]">{text}</div>
}

export function UserBubble({ text, avatar = USER_AVATAR }) {
  return (
    <div className="flex gap-2.5 items-start flex-row-reverse">
      <img className="w-[42px] h-[42px] rounded-lg shrink-0 object-cover" src={avatar} alt="" />
      <div>
        <div className="relative bg-[#95ec69] text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] shadow-[0_1px_2px_rgba(0,0,0,0.06)] max-w-[78%]">{text}</div>
      </div>
    </div>
  )
}

export function BotBubble({ children }) {
  return (
    <div className="flex gap-2.5 items-start">
      <ClawAvatar />
      <div>
        <div className="relative bg-white text-[#1a1a1a] text-[15px] p-[13px_15px] rounded-lg leading-[1.55] max-w-[78%] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          {children}
        </div>
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-start">
      <ClawAvatar />
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
  )
}

export function AgentStep({ check, label, result }) {
  return (
    <div className="flex items-start gap-2 text-[14px]">
      <div className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold border ${
        check ? 'bg-[#07c160]/15 border-[#07c160]/30 text-[#07c160]' : 'bg-white/50 border-black/10 text-[#aaa]'
      }`}>
        {check ? '✓' : '○'}
      </div>
      <div>
        <div className="font-semibold">{label}</div>
        {result && <div className="text-[#07c160] text-[13px]">{result}</div>}
      </div>
    </div>
  )
}

/* ── 「已推送到微信」徽章；未绑定时不渲染任何提示 ── */
export function PushBadge({ bound }) {
  if (!bound) return null
  return (
    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold mt-1.5 bg-[#07c160]/10 text-[#07c160]">
      <CheckCircle size={12} weight="fill" /> 已推送到微信
    </div>
  )
}
