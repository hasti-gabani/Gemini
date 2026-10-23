import { ArrowDownLeft, ArrowUpRight, Eye, Paperclip, Pencil, Plus, Printer, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import PrintPreviewDialog from '../../components/documents/PrintPreviewDialog.jsx'
import ShareDialog from '../../components/documents/ShareDialog.jsx'
import Button from '../../components/ui/Button.jsx'
import DayPicker from '../../components/ui/DayPicker.jsx'
import { Chips, EmptyState, ErrorState, ListSkeleton, LoadMore, SearchInput, SummaryCards } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatDateMedium, todayISO } from '../../lib/dates.js'
import { useDebounced, useInvalidateAll, usePagedList } from '../../lib/hooks.js'
import { formatMoney, isPositive } from '../../lib/money.js'
import { RowMenu } from '../bills/BillShared.jsx'
import { PAYMENT_KINDS } from './paymentConfig.js'

export function usePaymentActions(kind) {
  const cfg = PAYMENT_KINDS[kind]
  const { confirm, toast } = useUI()
  const invalidate = useInvalidateAll()
  const [dialog, setDialog] = useState(null)

  const remove = async (payment, onDone) => {
    const ok = await confirm({
      title: `Delete ${cfg.documentName.toLowerCase()} ${payment.number}?`,
      message: `${formatMoney(payment.amount)} ${kind === 'in' ? 'from' : 'to'} ${payment.party_name}. Bill pending amounts, party balance, cash/bank balance and ledger will be recalculated.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.del(`${cfg.api}/${payment.id}/`)
      invalidate()
      toast.success(`${cfg.documentName} ${payment.number} deleted.`)
      onDone?.()
    } catch (error) {
      toast.error(error)
    }
  }

  const menuItems = (payment) => [
    { label: 'Open', icon: Eye, to: `${cfg.base}/${payment.id}` },
    { label: 'Edit', icon: Pencil, to: `${cfg.base}/${payment.id}/edit` },
    { label: 'Share', icon: Share2, onClick: () => setDialog({ type: 'share', payment }) },
    { label: 'Print / PDF', icon: Printer, onClick: () => setDialog({ type: 'print', payment }) },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(payment) },
  ]

  const dialogs = (
    <>
      <ShareDialog
        open={dialog?.type === 'share'}
        onClose={() => setDialog(null)}
        basePath={dialog?.payment ? `${cfg.api}/${dialog.payment.id}` : ''}
        title={dialog?.payment ? `${cfg.documentName} ${dialog.payment.number}` : ''}
      />
      <PrintPreviewDialog
        open={dialog?.type === 'print'}
        onClose={() => setDialog(null)}
        basePath={dialog?.payment ? `${cfg.api}/${dialog.payment.id}` : ''}
        title={dialog?.payment ? `${cfg.documentName} ${dialog.payment.number}` : ''}
      />
    </>
  )
  return { menuItems, dialogs, remove }
}

/** "Bil.4, Bil.9, Bil.15, +2 more": at most three bill numbers, like the items summary of a bill. */
export function billNumbersText(numbers = []) {
  const shown = numbers.slice(0, 3)
  if (numbers.length > 3) shown.push(`+${numbers.length - 3} more`)
  return shown.join(', ')
}

export function PaymentCardRow({ kind, payment, menuItems, showParty = true }) {
  const cfg = PAYMENT_KINDS[kind]
  const Icon = kind === 'in' ? ArrowDownLeft : ArrowUpRight
  return (
    <div className="flex items-stretch">
      {/* Below 360px the amount goes under the details, so the name and date keep the full width. */}
      <Link to={`${cfg.base}/${payment.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition hover:bg-muted max-[360px]:flex-col max-[360px]:items-start max-[360px]:gap-1">
        <span className={`hidden size-10 shrink-0 place-items-center rounded-xl xs:grid ${kind === 'in' ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-[15px] font-semibold text-ink">{showParty ? payment.party_name : payment.number}</p>
          <p className="break-words text-sm text-ink-3">
            {showParty ? `${payment.number} · ` : ''}{formatDate(payment.date)} · {payment.account_kind === 'cash' ? 'Cash' : payment.account_name}
            {payment.attachment_count > 0 && <Paperclip className="ml-1 inline size-3.5" />}
          </p>
          {payment.against?.length > 0 && <p className="break-words text-xs text-ink-3">Against {billNumbersText(payment.against)}</p>}
        </div>
        <div className="shrink-0 text-right max-[360px]:flex max-[360px]:flex-wrap max-[360px]:items-baseline max-[360px]:gap-x-2 max-[360px]:text-left">
          <p className={`num text-[15px] font-semibold ${cfg.tone}`}>{formatMoney(payment.amount)}</p>
          {isPositive(payment.unallocated_amount) && <p className="num text-xs text-warn">Advance {formatMoney(payment.unallocated_amount)}</p>}
        </div>
      </Link>
      <div className="flex items-center pr-2">
        <RowMenu items={menuItems(payment)} label={`Actions for ${payment.number}`} />
      </div>
    </div>
  )
}

export function PaymentTable({ kind, rows, menuItems, showParty = true }) {
  const cfg = PAYMENT_KINDS[kind]
  const navigate = useNavigate()
  return (
    <table className="w-full min-w-[820px] text-[15px]">
      <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
        <tr>
          <th className="px-4 py-2.5">Date</th>
          <th className="px-3 py-2.5">{cfg.numberLabel}</th>
          {showParty && <th className="px-3 py-2.5">{cfg.party}</th>}
          <th className="px-3 py-2.5">Payment Type</th>
          <th className="px-3 py-2.5">Reference</th>
          <th className="px-3 py-2.5">Against Bills</th>
          <th className="px-3 py-2.5 text-right">Amount</th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((payment) => (
          <tr key={payment.id} className="cursor-pointer transition hover:bg-muted" onClick={() => navigate(`${cfg.base}/${payment.id}`)}>
            <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatDate(payment.date)}</td>
            <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-ink">
              {payment.number}
              {payment.attachment_count > 0 && <Paperclip className="ml-1 inline size-3.5 text-ink-3" aria-label="Has attachment" />}
            </td>
            {showParty && <td className="max-w-56 break-words px-3 py-3 text-ink">{payment.party_name}</td>}
            <td className="px-3 py-3 text-ink-2">{payment.account_kind === 'cash' ? 'Cash' : payment.account_name}</td>
            <td className="max-w-40 break-words px-3 py-3 text-ink-3">{payment.reference_no || '—'}</td>
            <td className="max-w-48 break-words px-3 py-3 text-sm text-ink-2">
              {payment.against?.length ? billNumbersText(payment.against) : '—'}
              {isPositive(payment.unallocated_amount) && <span className="block text-xs text-warn">Advance {formatMoney(payment.unallocated_amount)}</span>}
            </td>
            <td className={`num whitespace-nowrap px-3 py-3 text-right font-semibold ${cfg.tone}`}>{formatMoney(payment.amount)}</td>
            <td className="px-2 py-3" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems(payment)} label={`Actions for ${payment.number}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Filters + summary + list for Payment In or Payment Out (used by the list page and the Payments hub). */
export function PaymentListContent({ kind }) {
  const cfg = PAYMENT_KINDS[kind]
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') || '')
  const debounced = useDebounced(search.trim(), 300)
  const date = params.get('date') || todayISO() // one day at a time
  const accountKind = params.get('account_kind') || ''

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const list = usePagedList([`payments-${kind}`], `${cfg.api}/`, {
    search: debounced,
    period: 'custom',
    date_from: date,
    date_to: date,
    account_kind: accountKind,
  })
  const { menuItems, dialogs } = usePaymentActions(kind)
  const summary = list.summary
  const filtered = Boolean(debounced || accountKind)
  const Icon = kind === 'in' ? ArrowDownLeft : ArrowUpRight

  return (
    <div className="space-y-4">
      <SummaryCards
        items={[
          { label: `Total ${cfg.amountLabel}`, value: formatMoney(summary?.total ?? 0, { decimals: 'auto' }), tone: cfg.tone, sub: `${summary?.count ?? 0} payments` },
          { label: 'Cash', value: formatMoney(summary?.cash ?? 0, { decimals: 'auto' }) },
          { label: 'Bank', value: formatMoney(summary?.bank ?? 0, { decimals: 'auto' }) },
        ]}
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput className="lg:max-w-sm lg:flex-1" value={search} onChange={setSearch} placeholder={`Search ${cfg.numberLabel.toLowerCase()}, ${cfg.party.toLowerCase()} or reference`} />
        <DayPicker label="Payment date" value={params.get('date') || ''} onChange={(value) => setParam('date', value)} />
      </div>
      <Chips items={[{ value: '', label: 'All modes' }, { value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }]} value={accountKind} onChange={(value) => setParam('account_kind', value)} />

      <div className={`card overflow-hidden transition-opacity ${list.isFetching && !list.isFetchingNextPage && list.rows.length ? 'opacity-60' : ''}`}>
        {list.isPending ? (
          <ListSkeleton rows={8} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={Icon} title="No payments found" message="Try a different search or filter." />
          ) : (
            <EmptyState
              icon={Icon}
              title={`${kind === 'in' ? 'No payments received' : 'No payments made'} on ${formatDateMedium(date)}`}
              message="Use the arrows or the date box to see another day."
              action={<Button to={`${cfg.base}/new`} icon={Plus}>{cfg.newLabel}</Button>}
            />
          )
        ) : (
          <>
            <div className="divide-y divide-line lg:hidden">
              {list.rows.map((payment) => <PaymentCardRow key={payment.id} kind={kind} payment={payment} menuItems={menuItems} />)}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <PaymentTable kind={kind} rows={list.rows} menuItems={menuItems} />
            </div>
            <LoadMore list={list} />
          </>
        )}
      </div>
      {dialogs}
    </div>
  )
}
