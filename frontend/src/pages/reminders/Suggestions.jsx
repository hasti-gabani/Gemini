import { useQuery } from '@tanstack/react-query'
import { BellPlus, MessageCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { Checkbox } from '../../components/ui/form.jsx'
import { Avatar, Badge, ErrorState, ListSkeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { api } from '../../lib/api.js'
import { relativeDay } from '../../lib/dates.js'
import { addMoney, formatMoney } from '../../lib/money.js'

const INITIAL = 6

/** "today" / "3 days ago" / "on 16 Aug 2026" */
function lastActivity(iso) {
  const text = relativeDay(iso)
  return /^\d/.test(text) && !/ago$/.test(text) ? `on ${text}` : text.toLowerCase()
}

function matches(suggestion, text) {
  const needle = text.toLowerCase()
  const digits = text.replace(/\D/g, '')
  return suggestion.party_name.toLowerCase().includes(needle)
    || (digits.length >= 3 && (suggestion.party_phone || '').replace(/\D/g, '').includes(digits))
}

/**
 * Parties who owe money but have no open reminder yet. With `onRemindMany`, several can be
 * ticked and reminded in one go: that sets their reminders and opens the messages together.
 */
export default function Suggestions({ search, onSetReminder, onRemindMany, busy = false }) {
  const { t } = useSession()
  const [expanded, setExpanded] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const query = useQuery({
    queryKey: ['reminders', 'suggestions'],
    queryFn: ({ signal }) => api.get('/reminders/suggestions/', undefined, { signal }),
  })

  const text = search.trim()
  const all = query.data?.results
  const rows = useMemo(() => (text ? (all || []).filter((row) => matches(row, text)) : all || []), [all, text])
  const total = useMemo(() => addMoney(...rows.map((row) => row.amount)), [rows])

  if (query.isSuccess && rows.length === 0) return null
  const visible = expanded ? rows : rows.slice(0, INITIAL)
  const selected = rows.filter((row) => picked.has(row.party))
  const toggle = (id, checked) => {
    const next = new Set(picked)
    if (checked) next.add(id)
    else next.delete(id)
    setPicked(next)
  }
  const ticking = Boolean(onRemindMany) && rows.length > 0

  return (
    <section className="card" aria-labelledby="reminder-suggestions">
      <div className="px-4 pb-2 pt-4 sm:px-5">
        <h2 id="reminder-suggestions" className="text-base font-semibold text-ink">Parties with pending payments</h2>
        <p className="text-sm text-ink-3">
          {query.isSuccess
            ? `No reminder set yet · ${rows.length} ${rows.length === 1 ? 'party' : 'parties'} · ${formatMoney(total, { decimals: 'auto' })} to collect`
            : 'Parties who owe you money and have no reminder yet'}
        </p>
        {ticking && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Checkbox
              checked={selected.length === rows.length}
              onChange={(checked) => setPicked(checked ? new Set(rows.map((row) => row.party)) : new Set())}
              label={t('select_all')}
              className="min-h-11 items-center"
            />
            {selected.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                <Button icon={MessageCircle} loading={busy} onClick={() => onRemindMany(selected)}>
                  {t('remind')} ({selected.length})
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.isPending ? (
        <ListSkeleton rows={3} />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {visible.map((row) => {
            const meta = [row.party_phone, row.last_txn_date && `Last activity ${lastActivity(row.last_txn_date)}`]
              .filter(Boolean).join(' · ')
            return (
              <li key={row.party} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5 ${picked.has(row.party) ? 'bg-brand-soft/40' : ''}`}>
                {ticking && (
                  // the padding makes a 44px tap target around the 20px box
                  <Checkbox
                    checked={picked.has(row.party)}
                    onChange={(checked) => toggle(row.party, checked)}
                    ariaLabel={`Select ${row.party_name}`}
                    className="-m-3 p-3"
                  />
                )}
                <span className="hidden sm:block">
                  <Avatar name={row.party_name} className="size-10 text-sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link to={`/parties/${row.party}`} className="line-clamp-2 break-words font-medium text-ink hover:text-brand-ink hover:underline">
                    {row.party_name}
                  </Link>
                  {meta && <p className="break-words text-sm text-ink-3">{meta}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num font-semibold text-neg">{formatMoney(row.amount)}</span>
                  {row.has_overdue ? <Badge tone="neg">Overdue</Badge> : <span className="text-xs text-ink-3">Pending</span>}
                </div>
                <div className="flex w-full justify-end sm:w-auto">
                  <Button
                    size="sm"
                    variant="soft"
                    icon={BellPlus}
                    onClick={() => onSetReminder({ id: row.party, name: row.party_name, phone: row.party_phone, balance: row.amount })}
                  >
                    Set reminder
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {rows.length > INITIAL && (
        <div className="flex justify-center border-t border-line px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show fewer' : `Show all ${rows.length}`}
          </Button>
        </div>
      )}
    </section>
  )
}
