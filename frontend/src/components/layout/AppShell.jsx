import { LayoutGrid, Plus, Search } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatches } from 'react-router'

import { useSession } from '../../context/SessionContext.jsx'
import { gujarati } from '../../lib/i18n.js'
import { BOTTOM_NAV, NAV_ITEMS, QUICK_ACTIONS } from '../../lib/routes.js'
import Button from '../ui/Button.jsx'
import Modal from '../ui/Modal.jsx'
import { Menu, PageLoader } from '../ui/misc.jsx'
import GlobalSearch from './GlobalSearch.jsx'
import { ProfileMenu, ReminderBell, useSearchShortcut } from './TopBarActions.jsx'

const TONE_CLASSES = {
  brand: 'bg-brand-soft text-brand-ink',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
}

function BrandMark({ className = 'size-9' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="brand-star" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8bff" />
          <stop offset=".5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#131314" />
      <path d="M32 10c1.3 11.4 10.6 20.7 22 22-11.4 1.3-20.7 10.6-22 22-1.3-11.4-10.6-20.7-22-22 11.4-1.3 20.7-10.6 22-22z" fill="url(#brand-star)" />
    </svg>
  )
}

function Sidebar() {
  const { t, business, language } = useSession()
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-card lg:flex">
      <Link to="/" className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
        <BrandMark />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold leading-tight text-ink">{business?.name || 'Gemini'}</span>
          <span className="block text-xs text-ink-3">Gemini · Billing &amp; Accounts</span>
        </span>
      </Link>
      <nav className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 pt-4" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition ${isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink'}`}
          >
            {({ isActive }) => (
              <>
                <item.icon className={`size-5 shrink-0 ${isActive ? '' : 'text-ink-3 group-hover:text-ink-2'}`} />
                <span className="min-w-0 flex-1 truncate">{t(item.key)}</span>
                {language === 'en' && gujarati(item.key) && (
                  <span className="truncate text-xs text-ink-3 opacity-0 transition group-hover:opacity-100">{gujarati(item.key)}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

function DesktopTopBar({ onSearch }) {
  return (
    <div className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b border-line bg-card/90 px-8 backdrop-blur-md lg:flex">
      <button
        type="button"
        onClick={onSearch}
        className="flex h-10 w-full max-w-md items-center gap-3 rounded-xl border border-line bg-muted px-3.5 text-left text-[15px] text-ink-3 transition hover:border-line-strong"
      >
        <Search className="size-[18px]" />
        <span className="flex-1 truncate">Search party, mobile, bill no., item…</span>
        <kbd className="rounded-md border border-line bg-card px-1.5 py-0.5 text-xs font-medium text-ink-3">Ctrl K</kbd>
      </button>
      <div className="flex-1" />
      <Menu
        trigger={({ toggle }) => <Button size="sm" variant="soft" icon={Plus} onClick={toggle}>Create</Button>}
        items={QUICK_ACTIONS.map((action) => ({ label: action.label, icon: action.icon, to: action.to }))}
      />
      <ReminderBell />
      <ProfileMenu />
    </div>
  )
}

function MoreSheet({ open, onClose }) {
  const { t, language } = useSession()
  const groups = ['Sale', 'Purchase', 'Other']
  const secondary = NAV_ITEMS.filter((item) => !['/', '/parties', '/sales'].includes(item.to))
  return (
    <Modal open={open} onClose={onClose} title={t('more')} size="md">
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group}>
            <h3 className="mb-2 text-sm font-semibold text-ink-2">{group} Transactions</h3>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_ACTIONS.filter((action) => action.group === group).map((action) => (
                <Link
                  key={action.to}
                  to={action.to}
                  onClick={onClose}
                  className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition hover:bg-muted active:bg-subtle"
                >
                  <span className={`grid size-12 place-items-center rounded-2xl ${TONE_CLASSES[action.tone]}`}>
                    <action.icon className="size-6" />
                  </span>
                  <span className="text-xs font-medium leading-tight text-ink-2">{language === 'gu' ? action.gu : action.label}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Go to</h3>
          <div className="grid grid-cols-2 gap-2">
            {secondary.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 text-[15px] font-medium leading-snug text-ink transition hover:bg-muted"
              >
                <item.icon className="size-5 shrink-0 text-ink-3" />
                <span className="min-w-0 break-words">{t(item.key)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function BottomNav({ onMore }) {
  const { t } = useSession()
  const { pathname } = useLocation()
  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto grid h-16 max-w-xl grid-cols-5">
        {BOTTOM_NAV.map((item) => {
          const active = item.end ? pathname === item.to : (item.match || [item.to]).some((p) => pathname.startsWith(p))
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${active ? 'text-brand-ink' : 'text-ink-3'}`}
            >
              <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? 'bg-brand-soft' : ''}`}>
                <item.icon className="size-[21px]" />
              </span>
              {t(item.key)}
            </NavLink>
          )
        })}
        <button type="button" onClick={onMore} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-3">
          <span className="grid h-7 w-12 place-items-center rounded-full">
            <LayoutGrid className="size-[21px]" />
          </span>
          {t('more')}
        </button>
      </div>
    </nav>
  )
}

export default function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const matches = useMatches()
  const location = useLocation()
  const hideNav = matches.some((match) => match.handle?.hideNav)
  useSearchShortcut(setSearchOpen)

  useEffect(() => {
    setMoreOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-dvh lg:pl-64">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <DesktopTopBar onSearch={() => setSearchOpen(true)} />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* keyed by path so every screen (e.g. "Save & New") starts with fresh state */}
          <Suspense key={location.pathname} fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      {!hideNav && <BottomNav onMore={() => setMoreOpen(true)} />}
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}

export { BrandMark }
