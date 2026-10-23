import { useQuery } from '@tanstack/react-query'
import { Bell, LogOut, Moon, Search, Settings, Store, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { addDays, formatDateMedium, todayISO } from '../../lib/dates.js'
import { formatMoney } from '../../lib/money.js'
import Modal from '../ui/Modal.jsx'
import { Avatar, Badge, Menu } from '../ui/misc.jsx'
import GlobalSearch from './GlobalSearch.jsx'

function useDueReminders() {
  const { settings } = useSession()
  const query = useQuery({
    queryKey: ['reminders', 'bell'],
    queryFn: () => api.get('/reminders/', { status: 'pending', page_size: 50 }),
    staleTime: 60_000,
  })
  const limit = addDays(todayISO(), settings?.reminder_lead_days ?? 3)
  const due = (query.data?.results || []).filter((reminder) => reminder.due_date <= limit)
  return { ...query, due }
}

export function ReminderBell({ className = '' }) {
  const [open, setOpen] = useState(false)
  const { due } = useDueReminders()
  const navigate = useNavigate()
  return (
    <>
      <button
        type="button"
        aria-label={`Payment reminders${due.length ? ` (${due.length} due)` : ''}`}
        onClick={() => setOpen(true)}
        className={`relative grid size-10 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink ${className}`}
      >
        <Bell className="size-[21px]" />
        {due.length > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-neg px-1 text-[10px] font-bold leading-4 text-white">
            {due.length > 9 ? '9+' : due.length}
          </span>
        )}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Payment Reminders"
        subtitle="Due today, overdue or coming up soon"
        size="sm"
        footer={(
          <Link to="/reminders" onClick={() => setOpen(false)} className="block w-full text-center text-[15px] font-semibold text-brand-ink">
            View all reminders
          </Link>
        )}
      >
        {due.length === 0 ? (
          <p className="py-6 text-center text-[15px] text-ink-3">No payment reminders are due. 🎉</p>
        ) : (
          <ul className="-mx-5 divide-y divide-line">
            {due.map((reminder) => {
              const overdue = reminder.due_date < todayISO()
              return (
                <li key={reminder.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      navigate(`/parties/${reminder.party}`)
                    }}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-muted"
                  >
                    <span className="hidden shrink-0 xs:block"><Avatar name={reminder.party_name} className="size-9 text-xs" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 break-words font-medium text-ink">{reminder.party_name}</span>
                      <span className="block text-sm text-ink-3">Due: {formatDateMedium(reminder.due_date)}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="num font-semibold text-neg">{formatMoney(reminder.amount)}</span>
                      {overdue && <Badge tone="neg">Overdue</Badge>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </>
  )
}

export function ProfileMenu({ compact = false }) {
  const { user, business, logout, theme, patchSession } = useSession()
  const { confirm, toast } = useUI()
  const navigate = useNavigate()
  const dark = document.documentElement.dataset.theme === 'dark'

  const toggleTheme = async () => {
    const next = dark ? 'light' : 'dark'
    patchSession({ settings: { theme: next } })
    try {
      await api.patch('/settings/', { theme: next })
    } catch (error) {
      patchSession({ settings: { theme } })
      toast.error(error)
    }
  }

  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Account menu"
          className={`flex items-center gap-2.5 rounded-full transition hover:bg-subtle ${compact ? 'p-1' : 'py-1 pl-1 pr-3'}`}
        >
          <Avatar name={business?.name || user?.name || ''} className="size-8 text-xs" />
          {!compact && (
            <span className="hidden max-w-40 text-left xl:block">
              <span className="block truncate text-sm font-semibold leading-tight text-ink">{user?.name}</span>
              <span className="block truncate text-xs text-ink-3">{business?.name}</span>
            </span>
          )}
        </button>
      )}
      items={[
        { label: 'Business Profile', icon: Store, to: '/settings/profile' },
        { label: 'Settings', icon: Settings, to: '/settings' },
        { label: dark ? 'Light theme' : 'Dark theme', icon: dark ? Sun : Moon, onClick: toggleTheme },
        { divider: true },
        {
          label: 'Log out',
          icon: LogOut,
          danger: true,
          onClick: async () => {
            const ok = await confirm({ title: 'Log out?', message: 'You will need to sign in again.', confirmText: 'Log out', tone: 'primary' })
            if (ok) {
              await logout()
              navigate('/login', { replace: true })
            }
          },
        },
      ]}
    />
  )
}

export function useSearchShortcut(setOpen) {
  useEffect(() => {
    const onKey = (event) => {
      const target = event.target
      const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])
}

export function MobileRootActions() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="Search"
        onClick={() => setSearchOpen(true)}
        className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-subtle hover:text-ink"
      >
        <Search className="size-[21px]" />
      </button>
      <ReminderBell />
      <ProfileMenu compact />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
