import {
  ArrowUp, BookOpen, Briefcase, ChevronDown, Clock, Download, Filter, GraduationCap, Images, Info, LayoutGrid,
  Menu, Mic, MoreHorizontal, PanelLeft, Plus, Search, Settings, SquareCheck, SquarePen, Compass, X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import './gemini.css'

/**
 * Start screen that looks like Gemini. Typing the code 0000 opens the billing app;
 * any other message shows Gemini's "Usage limits" screen (92% used).
 */

const HISTORY = [
  'Clarifying Contact for Call', 'Saffron Paagh Image Enhancement', 'Saffron Swami 3D Portrait Enhancement',
  '3D Foot Anatomy Image Enhancement', 'Face Replacement in Digital Painting', 'High-Detail Gold Jewellery Regeneration',
  '3D Hand Anatomy Correction', 'Hand Correction in 3D Render', '3D Foot and Garment Rendering',
  'Correcting Hands in 3D Render', 'Hand Anatomy Correction in 3D Render', 'Semi-Realistic 3D Image Regeneration',
]

const SUGGESTIONS = [
  { icon: Compass, text: 'Plan a road trip based on my interests' },
  { icon: Briefcase, text: 'Write a professional email format' },
  { icon: SquareCheck, text: 'Brainstorm 5 unique party themes' },
]

const NAV = [
  { icon: LayoutGrid, label: 'Library' },
  { icon: Images, label: 'Images' },
  { icon: Clock, label: 'Scheduled' },
  { icon: GraduationCap, label: 'Students' },
  { icon: MoreHorizontal, label: 'More' },
]

const USED_PERCENT = 92

const UNLOCK_CODE = '0000'

export const isOpenCommand = (text) => text.replace(/\s+/g, '') === UNLOCK_CODE

export function GeminiStar({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="gm-star" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8bff" />
          <stop offset=".5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill="url(#gm-star)" d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10z" />
    </svg>
  )
}

/** Ask box: the mic is always there; the blue send arrow appears once something is typed, as in Gemini. */
function Composer({ value, onChange, onSubmit, inputRef }) {
  return (
    <form className="gm-composer" autoComplete="off" onSubmit={(e) => { e.preventDefault(); onSubmit(value) }}>
      <button type="button" className="gm-icon" title="Add"><Plus /></button>
      <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ask Gemini" />
      <button type="button" className="gm-model"><span>Flash-Lite</span><ChevronDown /></button>
      <button type="button" className="gm-icon" title="Use microphone"><Mic /></button>
      {value.trim() && <button type="submit" className="gm-send" title="Send" aria-label="Send"><ArrowUp /></button>}
    </form>
  )
}

/** Next reset about four hours after the limit was hit, on a 10-minute mark, shown as 24-hour time. */
function resetLabel(from) {
  const reset = new Date(from.getTime() + 4 * 60 * 60 * 1000)
  reset.setMinutes(Math.ceil(reset.getMinutes() / 10) * 10, 0, 0)
  return reset.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Gemini's "Usage limits" sheet. */
function UsageLimits({ at, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="gm-limits" role="dialog" aria-modal="true" aria-labelledby="gm-limits-title">
      <button type="button" className="gm-icon gm-limits-close" onClick={onClose} aria-label="Close"><X /></button>
      <div className="gm-limits-body">
        <h2 id="gm-limits-title">Usage limits <span className="gm-pro">PRO</span></h2>
        <p className="gm-limits-text">
          Your plan&apos;s limits determine how much you can use Gemini over time. Advanced models and features can
          take up more usage. <span className="gm-limits-link">Learn more</span>
        </p>
        <p className="gm-limits-updated">Updated just now</p>
        <div className="gm-limits-card">
          <div className="gm-limits-row">
            <span className="gm-limits-label">Current usage <Info /></span>
            <span>{USED_PERCENT}% used</span>
          </div>
          <div className="gm-limits-bar"><span style={{ width: `${USED_PERCENT}%` }} /></div>
          <p className="gm-limits-reset">Resets at {resetLabel(at)}</p>
        </div>
      </div>
    </div>
  )
}

export default function GeminiHome({ onOpen }) {
  const [limitsAt, setLimitsAt] = useState(null) // when the usage limits sheet was opened
  const [text, setText] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [mode, setMode] = useState('Chat')
  const inputRef = useRef(null)

  useEffect(() => {
    const previous = document.title
    document.title = 'Gemini'
    document.documentElement.classList.add('gm-page')
    return () => {
      document.title = previous
      document.documentElement.classList.remove('gm-page')
    }
  }, [])

  useEffect(() => { if (!limitsAt) inputRef.current?.focus() }, [limitsAt])

  const send = (raw) => {
    const value = raw.trim()
    if (!value) return
    setText('')
    if (isOpenCommand(value)) { onOpen(); return }
    setLimitsAt(new Date())
  }

  const newChat = () => { setLimitsAt(null); setText(''); setDrawer(false) }

  return (
    <div className="gm">
      {drawer && <div className="gm-scrim" onClick={() => setDrawer(false)} />}
      <aside className={`gm-side${collapsed ? ' collapsed' : ''}${drawer ? ' open' : ''}`}>
        <div className="gm-side-top">
          <div className="gm-brand hide-c"><GeminiStar />Gemini</div>
          <div className="gm-row">
            <button type="button" className="gm-icon hide-c" title="Search"><Search /></button>
            <button
              type="button"
              className="gm-icon"
              title="Toggle sidebar"
              onClick={() => (window.innerWidth <= 800 ? setDrawer(false) : setCollapsed((c) => !c))}
            >
              <PanelLeft />
            </button>
          </div>
        </div>

        <div className="gm-side-scroll">
          <button type="button" className="gm-nav active" onClick={newChat}><SquarePen /><span className="hide-c">New chat</span></button>
          {NAV.map(({ icon: Icon, label }) => (
            <button type="button" key={label} className="gm-nav"><Icon /><span className="hide-c">{label}</span></button>
          ))}

          <div className="hide-c">
            <div className="gm-sec">Notebooks</div>
            <button type="button" className="gm-nav"><Plus />New notebook</button>
            <button type="button" className="gm-nav"><BookOpen />Untitled notebook</button>
            <div className="gm-sec">All <Filter size={16} /></div>
            {HISTORY.map((h) => <button type="button" key={h} className="gm-chat">{h}</button>)}
          </div>
        </div>

        <div className="gm-profile">
          <div className="gm-avatar">H</div>
          <div className="hide-c">
            <div className="gm-name">hasti gabani</div>
            <div className="gm-plan">Pro</div>
          </div>
          <button type="button" className="gm-icon hide-c" title="Settings"><Settings /></button>
        </div>
      </aside>

      <main className="gm-main">
        <div className="gm-top">
          <button type="button" className="gm-icon gm-menu" onClick={() => setDrawer(true)}><Menu /></button>
          <button type="button" className="gm-getapp"><Download size={18} />Get app</button>
          <button type="button" className="gm-icon" title="New chat" onClick={newChat}><SquarePen /></button>
        </div>

        <section className="gm-home">
          <h1>Where should we start?</h1>
          <div className="gm-wrap">
            <Composer value={text} onChange={setText} onSubmit={send} inputRef={inputRef} />
          </div>
          <div className="gm-modes">
            {['Chat', 'Task'].map((m) => (
              <button type="button" key={m} className={`gm-mode${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
          <div className="gm-suggest">
            {SUGGESTIONS.map(({ icon: Icon, text: s }) => (
              <button type="button" key={s} onClick={() => send(s)}><Icon />{s}</button>
            ))}
          </div>
        </section>
      </main>

      {limitsAt && <UsageLimits at={limitsAt} onClose={() => setLimitsAt(null)} />}
    </div>
  )
}
