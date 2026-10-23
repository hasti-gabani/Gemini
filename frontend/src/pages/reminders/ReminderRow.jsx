import {
  CalendarClock, CircleCheck, EllipsisVertical, MessageCircle, Pencil, RotateCcw, Send, Trash2,
} from 'lucide-react'
import { Link } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { Checkbox } from '../../components/ui/form.jsx'
import { Avatar, Menu } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { formatDateMedium } from '../../lib/dates.js'
import { formatMoney } from '../../lib/money.js'
import { telLink } from '../../lib/share.js'
import { dueInfo, sentText, shortDateTime } from './reminderUtils.js'

/**
 * One payment reminder. Phones: card with Remind + an actions menu.
 * Desktop: roomy row with inline buttons. With `onSelect` it has a tick box, for reminding several at once.
 */
export default function ReminderRow({
  reminder, busyAction, selected = false, onSelect, onRemind, onEdit, onComplete, onReopen, onDelete,
}) {
  const { t } = useSession()
  const done = reminder.status === 'done'
  const due = dueInfo(reminder.due_date, done)
  const busy = Boolean(busyAction)
  const name = reminder.party_name

  const menuItems = done
    ? [{ label: 'Delete', icon: Trash2, danger: true, onClick: onDelete }]
    : [
      { label: 'Mark as done', icon: CircleCheck, onClick: onComplete },
      { label: 'Edit reminder', icon: Pencil, onClick: onEdit },
      { divider: true },
      { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
    ]

  return (
    <li className={`flex items-start gap-3 px-4 py-3.5 sm:px-5 lg:items-center lg:gap-4 ${selected ? 'bg-brand-soft/40' : ''}`}>
      {onSelect && (
        // the padding makes a 44px tap target around the 20px box
        <Checkbox checked={selected} onChange={onSelect} ariaLabel={`Select ${name}`} className="-m-3 p-3" />
      )}
      <span className="mt-0.5 hidden sm:block lg:mt-0">
        <Avatar name={name} className="size-10 text-sm" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/parties/${reminder.party}`} className="line-clamp-2 break-words font-medium text-ink hover:text-brand-ink hover:underline">
              {name}
            </Link>
            {reminder.party_phone ? (
              <a href={telLink(reminder.party_phone)} className="text-sm text-ink-3 hover:text-ink">{reminder.party_phone}</a>
            ) : (
              <span className="text-sm text-ink-3">No mobile number</span>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className={`num font-semibold ${done ? 'text-ink' : 'text-neg'}`}>{formatMoney(reminder.amount)}</p>
            <p className="text-xs text-ink-3">{done ? 'Reminder amount' : 'Pending'}</p>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className={`inline-flex items-center gap-1.5 font-medium ${due.tone}`}>
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            {due.label}
          </span>
          {!done && <span className="text-ink-3">{formatDateMedium(reminder.due_date)}</span>}
          <span className={`inline-flex items-center gap-1.5 ${reminder.sent_count ? 'text-ink-2' : 'text-ink-3'}`}>
            <Send className="size-3.5 shrink-0" aria-hidden />
            {sentText(reminder)}
          </span>
          {done && reminder.updated_at && (
            <span className="text-ink-3">Marked done {shortDateTime(reminder.updated_at)}</span>
          )}
        </div>

        {/* phones: primary action + menu */}
        <div className="mt-3 flex items-center justify-end gap-2 lg:hidden">
          {done ? (
            <Button size="sm" variant="secondary" icon={RotateCcw} loading={busyAction === 'reopen'} disabled={busy} onClick={onReopen}>
              Reopen
            </Button>
          ) : (
            <Button size="sm" variant="soft" icon={MessageCircle} disabled={busy} onClick={onRemind}>{t('remind')}</Button>
          )}
          <Menu
            items={menuItems}
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                disabled={busy}
                aria-label={`More actions for ${name}`}
                aria-haspopup="menu"
                aria-expanded={open}
                className="grid size-11 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink disabled:opacity-50"
              >
                <EllipsisVertical className="size-5" />
              </button>
            )}
          />
        </div>
      </div>

      {/* desktop: inline actions */}
      <div className="hidden shrink-0 items-center gap-2 lg:flex">
        {done ? (
          <Button size="sm" variant="secondary" icon={RotateCcw} loading={busyAction === 'reopen'} disabled={busy} onClick={onReopen}>
            Reopen
          </Button>
        ) : (
          <>
            <Button size="sm" variant="soft" icon={MessageCircle} disabled={busy} onClick={onRemind}>{t('remind')}</Button>
            <Button size="sm" variant="secondary" icon={CircleCheck} loading={busyAction === 'complete'} disabled={busy} onClick={onComplete}>
              Mark done
            </Button>
            <Button size="icon-sm" variant="ghost" icon={Pencil} disabled={busy} onClick={onEdit} aria-label={`Edit reminder for ${name}`} title="Edit" />
          </>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          icon={Trash2}
          loading={busyAction === 'delete'}
          disabled={busy}
          onClick={onDelete}
          aria-label={`Delete reminder for ${name}`}
          title="Delete"
        />
      </div>
    </li>
  )
}
