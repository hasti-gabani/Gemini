import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft, ArrowUpRight, BellRing, ChevronRight, Plus, ReceiptText, ShoppingCart,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import Page from '../components/layout/Page.jsx'
import RemindDialog from '../components/RemindDialog.jsx'
import Button from '../components/ui/Button.jsx'
import Modal from '../components/ui/Modal.jsx'
import { Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from '../components/ui/misc.jsx'
import { useSession } from '../context/SessionContext.jsx'
import { api } from '../lib/api.js'
import { formatDateMedium, relativeDay } from '../lib/dates.js'
import { gujarati } from '../lib/i18n.js'
import { formatMoney } from '../lib/money.js'
import { QUICK_ACTIONS, recordPath } from '../lib/routes.js'

function BiLabel({ k, className = '' }) {
  const { t, language } = useSession()
  const secondary = language === 'en' ? gujarati(k) : ''
  return (
    <span className={`block min-w-0 ${className}`}>
      <span className="block text-sm font-medium leading-snug text-ink-2">{t(k)}</span>
      {secondary && <span className="block truncate text-xs text-ink-3">{secondary}</span>}
    </span>
  )
}

function BalanceCard({ kind, amount, count, loading }) {
  const receivable = kind === 'receivable'
  const Icon = receivable ? ArrowDownLeft : ArrowUpRight
  return (
    <Link
      to={`/parties?filter=${kind}`}
      className={`card group relative flex min-w-0 flex-col gap-2 overflow-hidden p-3.5 transition hover:border-line-strong sm:flex-row sm:items-center sm:gap-4 sm:p-5 ${receivable ? 'border-t-4 border-t-pos' : 'border-t-4 border-t-neg'} sm:border-t sm:border-t-line`}
    >
      <span className="flex items-center justify-between gap-2 sm:contents">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl sm:size-12 sm:rounded-2xl ${receivable ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'}`}>
          <Icon className="size-5 sm:size-6" />
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3 sm:hidden" />
      </span>
      <span className="min-w-0 flex-1">
        <BiLabel k={receivable ? 'receivable' : 'payable'} />
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-24 sm:h-8 sm:w-36" />
        ) : (
          <span className={`num mt-0.5 block truncate text-[clamp(1.1rem,5.4vw,1.5rem)] font-bold tracking-tight sm:text-[28px] ${receivable ? 'text-pos' : 'text-neg'}`}>
            {formatMoney(amount, { decimals: 'auto' })}
          </span>
        )}
        <span className="block text-xs text-ink-3">
          {loading ? ' ' : `${count} ${count === 1 ? 'party' : 'parties'}`}
        </span>
      </span>
      <ChevronRight className="hidden size-5 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 sm:block" />
    </Link>
  )
}

function Reminders({ summary }) {
  const { t } = useSession()
  const [remind, setRemind] = useState(null)
  const reminders = summary?.reminders || []
  const overdue = (summary?.overdue_parties || []).filter((row) => !reminders.some((r) => r.party === row.party))
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <BellRing className="size-[18px] text-warn" /> {t('payment_reminders')}
        </h2>
        <Link to="/reminders" className="text-sm font-medium text-brand-ink hover:underline">View all</Link>
      </div>
      {!summary ? (
        <div className="space-y-3 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : reminders.length === 0 && overdue.length === 0 ? (
        <p className="px-4 pb-5 pt-2 text-[15px] text-ink-3">No payments are due soon.</p>
      ) : (
        // In the narrow desktop side column and on very small phones the badge and Remind button
        // go under the name, so the name is not squeezed.
        <ul className="divide-y divide-line">
          {reminders.map((reminder) => (
            <li key={`r${reminder.id}`} className="flex items-center gap-3 px-4 py-3 max-[360px]:flex-wrap max-[360px]:gap-y-2 lg:flex-wrap lg:gap-y-2">
              <Link to={`/parties/${reminder.party}`} className="min-w-0 flex-1 max-[360px]:basis-full lg:basis-full">
                <span className="line-clamp-2 break-words font-medium text-ink">{reminder.party_name}</span>
                <span className="block text-sm text-ink-3">
                  Pending <span className="num font-medium text-neg">{formatMoney(reminder.amount)}</span>
                  {' · '}Due: {formatDateMedium(reminder.due_date)}
                </span>
              </Link>
              {reminder.is_overdue && <Badge tone="neg">Overdue</Badge>}
              <Button size="sm" variant="soft" onClick={() => setRemind({ reminder: { ...reminder, message: '' } })}>{t('remind')}</Button>
            </li>
          ))}
          {overdue.map((row) => (
            <li key={`o${row.party}`} className="flex items-center gap-3 px-4 py-3 max-[360px]:flex-wrap max-[360px]:gap-y-2 lg:flex-wrap lg:gap-y-2">
              <Link to={`/parties/${row.party}`} className="min-w-0 flex-1 max-[360px]:basis-full lg:basis-full">
                <span className="line-clamp-2 break-words font-medium text-ink">{row.party_name}</span>
                <span className="block text-sm text-ink-3">
                  Overdue <span className="num font-medium text-neg">{formatMoney(row.amount)}</span> · {row.bills} bill{row.bills === 1 ? '' : 's'}
                </span>
              </Link>
              <Button size="sm" variant="soft" onClick={() => setRemind({ party: { id: row.party, name: row.party_name, phone: row.party_phone, balance: row.amount } })}>{t('remind')}</Button>
            </li>
          ))}
        </ul>
      )}
      <RemindDialog open={Boolean(remind)} onClose={() => setRemind(null)} party={remind?.party} reminder={remind?.reminder} />
    </section>
  )
}

const CREATE_TONES = {
  brand: 'bg-brand-soft text-brand-ink',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
}

/**
 * Phones: Take Payment | + | Add Sale floating above the bottom navigation, as in Vyapar.
 * The + opens New Sale, New Purchase, Payment In and Payment Out.
 */
function ActionBar() {
  const { t, language } = useSession()
  const [open, setOpen] = useState(false)
  const actions = QUICK_ACTIONS.filter((action) => action.group === 'Sale' || action.group === 'Purchase')
  return (
    <>
      <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center gap-2 xs:inset-x-4 xs:gap-3 lg:hidden">
        <Button to="/payments-in/new" size="fab" className="min-w-0 flex-1 shadow-pop max-[359px]:px-2 max-[359px]:text-sm">
          {t('take_payment')}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="More: sale, purchase, payment in, payment out"
          aria-haspopup="dialog"
          className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-brand bg-card text-brand shadow-pop transition active:scale-95"
        >
          <Plus className="size-7" strokeWidth={2.25} />
        </button>
        <Button to="/sales/new" size="fab" variant="danger" className="min-w-0 flex-1 shadow-pop max-[359px]:px-2 max-[359px]:text-sm">
          {t('add_sale')}
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Create" size="sm">
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl border border-line p-3 transition hover:bg-muted active:bg-subtle"
            >
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${CREATE_TONES[action.tone]}`}>
                <action.icon className="size-5" />
              </span>
              <span className="min-w-0 text-[15px] font-semibold leading-tight text-ink">
                {language === 'gu' ? action.gu : action.label}
                {language !== 'gu' && <span className="block text-xs font-normal text-ink-3">{action.gu}</span>}
              </span>
            </Link>
          ))}
        </div>
      </Modal>
    </>
  )
}

const TXN_META = {
  sale: { label: 'Sale', icon: ReceiptText, tone: 'bg-brand-soft text-brand-ink' },
  purchase: { label: 'Purchase', icon: ShoppingCart, tone: 'bg-warn-soft text-warn' },
  payment_in: { label: 'Payment In', icon: ArrowDownLeft, tone: 'bg-pos-soft text-pos' },
  payment_out: { label: 'Payment Out', icon: ArrowUpRight, tone: 'bg-neg-soft text-neg' },
}

function RecentTransactions({ summary }) {
  const { t } = useSession()
  const rows = summary?.recent || []
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-5">
        <h2 className="text-base font-semibold text-ink">{t('recent_transactions')}</h2>
        <Link to="/sales" className="text-sm font-medium text-brand-ink hover:underline">All sales</Link>
      </div>
      {!summary ? (
        <div className="space-y-3 p-4"><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No transactions yet" message="Create your first sale bill to see it here." action={<Button to="/sales/new">{t('new_sale')}</Button>} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const meta = TXN_META[row.type]
            return (
              <li key={`${row.type}-${row.id}`}>
                <Link to={recordPath(row.type, row.id)} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted sm:px-5">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl sm:size-10 ${meta.tone}`}>
                    <meta.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-words font-medium text-ink">{row.party_name || meta.label}</span>
                    <span className="block break-words text-[13px] text-ink-3 sm:text-sm">{meta.label} · {row.number} · {relativeDay(row.date)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num font-semibold text-ink">{formatMoney(row.amount)}</span>
                    {row.payment_status && <StatusBadge status={row.payment_status} />}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function Dashboard() {
  const { t } = useSession()
  const summaryQuery = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/dashboard/') })
  const summary = summaryQuery.data
  const loading = !summary

  return (
    <Page
      title={t('dashboard')}
      root
      desktopTitle={false}
      maxWidth="max-w-[1400px]"
      fab={<ActionBar />}
    >
      <div className="mb-4 hidden justify-end lg:mb-6 sm:flex">
        <div className="flex gap-2">
          <Button to="/payments-in/new" variant="secondary" icon={ArrowDownLeft}>{t('take_payment')}</Button>
          <Button to="/payments-out/new" variant="secondary" icon={ArrowUpRight}>{t('pay_out')}</Button>
          <Button to="/sales/new" icon={ReceiptText}>{t('new_sale')}</Button>
        </div>
      </div>

      {summaryQuery.isError && (
        <div className="card mb-4"><ErrorState error={summaryQuery.error} onRetry={summaryQuery.refetch} /></div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:gap-4">
        <BalanceCard kind="receivable" amount={summary?.receivable} count={summary?.receivable_count} loading={loading} />
        <BalanceCard kind="payable" amount={summary?.payable} count={summary?.payable_count} loading={loading} />
      </div>

      <div className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-3 lg:gap-5">
        <div className="min-w-0 lg:col-span-2">
          <RecentTransactions summary={summary} />
        </div>
        <div className="min-w-0 space-y-4">
          <Reminders summary={summary} />
        </div>
      </div>
    </Page>
  )
}
