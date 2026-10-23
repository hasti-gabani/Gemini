import { ArrowDownLeft, ArrowUpRight, Paperclip, ReceiptText, ShoppingCart, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { Checkbox } from '../../components/ui/form.jsx'
import { Chips, EmptyState, ErrorState, ListSkeleton, LoadMore, StatusBadge } from '../../components/ui/misc.jsx'
import SelectionBar from '../../components/ui/SelectionBar.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate } from '../../lib/dates.js'
import { useInvalidateAll, usePagedList } from '../../lib/hooks.js'
import { formatMoney, isPositive } from '../../lib/money.js'
import { BILL_KINDS, STATUS_OPTIONS } from '../bills/billConfig.js'
import { RowMenu, useBillActions } from '../bills/BillShared.jsx'
import { billNumbersText, usePaymentActions } from '../payments/PaymentShared.jsx'

/** Every row type of the merged list, with the bill/payment kind used by the shared actions. */
const TYPES = {
  sale: { label: 'Sale', icon: ReceiptText, tone: 'bg-brand-soft text-brand-ink', path: '/sales', bill: 'sale', amountTone: 'text-ink' },
  purchase: { label: 'Purchase', icon: ShoppingCart, tone: 'bg-warn-soft text-warn', path: '/purchases', bill: 'purchase', amountTone: 'text-ink' },
  payment_in: { label: 'Payment In', icon: ArrowDownLeft, tone: 'bg-pos-soft text-pos', path: '/payments-in', payment: 'in', amountTone: 'text-pos' },
  payment_out: { label: 'Payment Out', icon: ArrowUpRight, tone: 'bg-neg-soft text-neg', path: '/payments-out', payment: 'out', amountTone: 'text-neg' },
}

export const TRANSACTION_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'bills', label: 'Bills' },
  { value: 'payments', label: 'Payments' },
]

const isBill = (row) => Boolean(TYPES[row.type]?.bill)
const amountOf = (row) => (isBill(row) ? row.total : row.amount)

function detailText(row) {
  if (isBill(row)) return [row.items_summary, row.item_count > 0 ? `Qty ${row.total_qty}` : ''].filter(Boolean).join(' · ')
  const account = row.account_kind === 'cash' ? 'Cash' : row.account_name
  return [account, row.against?.length ? `Against ${billNumbersText(row.against)}` : ''].filter(Boolean).join(' · ')
}

function paidWord(row) {
  return BILL_KINDS[TYPES[row.type].bill].paidWord
}

function TransactionCard({ row, menu, selected, onSelect }) {
  const meta = TYPES[row.type]
  const detail = detailText(row)
  // On 320px phones the type and the date sit on separate lines and the amounts go under the details,
  // so nothing is cut.
  return (
    <div className={`flex items-stretch ${selected ? 'bg-brand-soft/40' : ''}`}>
      <span className="flex items-center pl-3 xs:pl-4">
        {/* the padding makes a 44px tap target around the 20px box */}
        <Checkbox checked={selected} onChange={onSelect} ariaLabel={`Select ${row.number}`} className="-m-3 p-3" />
      </span>
      <Link to={`${meta.path}/${row.id}`} className="flex min-w-0 flex-1 items-start gap-2.5 py-3 pl-2.5 pr-1 transition hover:bg-muted xs:gap-3 max-[360px]:flex-col max-[360px]:gap-1">
        <span className={`mt-0.5 hidden size-10 shrink-0 place-items-center rounded-xl xs:grid ${meta.tone}`}>
          <meta.icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 break-words text-[15px] font-semibold text-ink">{row.number}</span>
            {row.attachment_count > 0 && <Paperclip className="size-3.5 shrink-0 text-ink-3" aria-label="Has attachment" />}
          </span>
          <span className="block text-sm">
            <span className="font-medium text-ink-2">{meta.label}</span>
            <span className="hidden text-ink-3 xs:inline"> · </span>
            <span className="block text-ink-3 xs:inline">{formatDate(row.date)}</span>
          </span>
          {detail && <span className="block break-words text-sm text-ink-2">{detail}</span>}
          {isBill(row) && <StatusBadge className="mt-1" status={row.payment_status} overdue={row.is_overdue} />}
        </span>
        <span className="shrink-0 text-right max-[360px]:flex max-[360px]:flex-wrap max-[360px]:items-baseline max-[360px]:gap-x-2 max-[360px]:text-left">
          <span className={`num block text-[15px] font-semibold ${meta.amountTone}`}>{formatMoney(amountOf(row))}</span>
          {isBill(row) && isPositive(row.paid_amount) && (
            <span className="num block text-xs text-pos">{paidWord(row)} {formatMoney(row.paid_amount)}</span>
          )}
          {isBill(row) && isPositive(row.balance_due) && <span className="num block text-sm text-neg">Due {formatMoney(row.balance_due)}</span>}
          {!isBill(row) && isPositive(row.unallocated_amount) && (
            <span className="num block text-xs text-warn">Advance {formatMoney(row.unallocated_amount)}</span>
          )}
        </span>
      </Link>
      <div className="flex items-center pr-2">
        <RowMenu items={menu(row)} label={`Actions for ${row.number}`} />
      </div>
    </div>
  )
}

function TransactionTable({ rows, menu, isSelected, onSelect }) {
  const navigate = useNavigate()
  return (
    <table className="w-full min-w-[920px] text-[15px]">
      <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
        <tr>
          <th className="w-10" />
          <th className="px-4 py-2.5">Date</th>
          <th className="px-3 py-2.5">Type</th>
          <th className="px-3 py-2.5">Number</th>
          <th className="px-3 py-2.5">Details</th>
          <th className="px-3 py-2.5 text-right">Amount</th>
          <th className="px-3 py-2.5 text-right">Received / Paid</th>
          <th className="px-3 py-2.5 text-right">Pending</th>
          <th className="px-3 py-2.5">Status</th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => {
          const meta = TYPES[row.type]
          const bill = isBill(row)
          return (
            <tr key={`${row.type}-${row.id}`} className={`cursor-pointer transition hover:bg-muted ${isSelected(row) ? 'bg-brand-soft/40' : ''}`} onClick={() => navigate(`${meta.path}/${row.id}`)}>
              <td className="pl-4" onClick={(event) => event.stopPropagation()}>
                <Checkbox checked={isSelected(row)} onChange={(checked) => onSelect(row, checked)} ariaLabel={`Select ${row.number}`} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatDate(row.date)}</td>
              <td className="whitespace-nowrap px-3 py-3">
                <span className="inline-flex items-center gap-2 text-ink">
                  <span className={`grid size-7 place-items-center rounded-lg ${meta.tone}`}><meta.icon className="size-4" /></span>
                  {meta.label}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-ink">
                {row.number}
                {row.attachment_count > 0 && <Paperclip className="ml-1 inline size-3.5 text-ink-3" aria-label="Has attachment" />}
              </td>
              <td className="max-w-72 px-3 py-3 text-sm text-ink-2">
                <span className="block break-words">{detailText(row) || '—'}</span>
                {!bill && isPositive(row.unallocated_amount) && <span className="block text-xs text-warn">Advance {formatMoney(row.unallocated_amount)}</span>}
              </td>
              <td className={`num whitespace-nowrap px-3 py-3 text-right font-semibold ${meta.amountTone}`}>{formatMoney(amountOf(row))}</td>
              <td className="num whitespace-nowrap px-3 py-3 text-right text-pos">{bill ? formatMoney(row.paid_amount) : <span className="text-ink-3">—</span>}</td>
              <td className={`num whitespace-nowrap px-3 py-3 text-right ${bill && isPositive(row.balance_due) ? 'text-neg' : 'text-ink-3'}`}>{bill ? formatMoney(row.balance_due) : '—'}</td>
              <td className="px-3 py-3">{bill ? <StatusBadge status={row.payment_status} overdue={row.is_overdue} /> : null}</td>
              <td className="px-2 py-3" onClick={(event) => event.stopPropagation()}>
                <RowMenu items={menu(row)} label={`Actions for ${row.number}`} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * Customer page: bills (sales, purchases) and payments (in, out) in one date-sorted list.
 * `filter` is all | bills | payments; `status` narrows bills (unpaid, partial, paid, overdue).
 */
export default function PartyTransactions({ party, filter, status, onFilterChange }) {
  const list = usePagedList(['party-transactions', party.id], `/parties/${party.id}/transactions/`, {
    filter,
    status: filter === 'bills' ? status : undefined,
  })
  const sales = useBillActions('sale')
  const purchases = useBillActions('purchase')
  const paymentsIn = usePaymentActions('in')
  const paymentsOut = usePaymentActions('out')
  const menus = { sale: sales.menuItems, purchase: purchases.menuItems, payment_in: paymentsIn.menuItems, payment_out: paymentsOut.menuItems }
  const menu = (row) => menus[row.type](row)

  // Ticked bills and payments, to delete several in one go. A row is held by type and id, because
  // a sale and a payment can share an id.
  const { confirm, toast } = useUI()
  const invalidate = useInvalidateAll()
  const [picked, setPicked] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const keyOf = (row) => `${row.type}-${row.id}`
  const isSelected = (row) => picked.has(keyOf(row))
  const selected = list.rows.filter(isSelected)
  const onSelect = (row, checked) => {
    const next = new Set(picked)
    if (checked) next.add(keyOf(row))
    else next.delete(keyOf(row))
    setPicked(next)
  }

  const removeSelected = async () => {
    const numbers = selected.slice(0, 3).map((row) => row.number).join(', ')
    const more = selected.length - 3
    const ok = await confirm({
      title: `Delete ${selected.length} ${selected.length === 1 ? 'transaction' : 'transactions'}?`,
      message: `${numbers}${more > 0 ? ` and ${more} more` : ''} will be deleted. Balances and stock are corrected automatically, and payments made against a deleted bill stay as advances. This cannot be undone.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    try {
      const result = await api.post('/transactions/bulk-delete/', {
        items: selected.map((row) => ({ type: row.type, id: row.id })),
      })
      const kept = result.kept || []
      invalidate()
      setPicked(new Set())
      if (!result.deleted) toast.error(kept[0]?.reason || 'Nothing was deleted.')
      else if (kept.length) toast.success(`${result.deleted} deleted · ${kept.length} kept: ${kept[0].reason}`)
      else toast.success(`${result.deleted} ${result.deleted === 1 ? 'transaction' : 'transactions'} deleted.`)
    } catch (error) {
      toast.error(error)
    } finally {
      setDeleting(false)
    }
  }

  const isSupplier = party.party_type === 'supplier'
  const filtered = filter !== 'all' || Boolean(status)
  let emptyTitle = 'No transactions yet'
  if (filter === 'bills') emptyTitle = status ? 'No bills match this filter' : 'No bills yet'
  if (filter === 'payments') emptyTitle = 'No payments yet'

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Chips items={TRANSACTION_FILTERS} value={filter} onChange={(value) => onFilterChange(value, '')} />
        {filter === 'bills' && (
          <Chips items={STATUS_OPTIONS} value={status} onChange={(value) => onFilterChange('bills', value)} />
        )}
      </div>
      <div className={`card overflow-hidden transition-opacity ${list.isFetching && !list.isFetchingNextPage && list.rows.length ? 'opacity-60' : ''}`}>
        {list.isPending ? (
          <ListSkeleton rows={6} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <EmptyState
            icon={isSupplier ? ShoppingCart : ReceiptText}
            title={emptyTitle}
            message={filtered ? 'Try another filter.' : 'Bills and payments of this party will appear here, newest first.'}
            action={!filtered && (
              <Button to={`${isSupplier ? '/purchases' : '/sales'}/new?party=${party.id}`}>
                {isSupplier ? 'Create New Purchase' : 'Create New Sale'}
              </Button>
            )}
          />
        ) : (
          <>
            <SelectionBar
              allChecked={selected.length > 0 && selected.length === list.rows.length}
              onToggleAll={(checked) => setPicked(checked ? new Set(list.rows.map(keyOf)) : new Set())}
              count={selected.length}
              busy={deleting}
              actions={(
                <>
                  <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                  <Button variant="danger" icon={Trash2} loading={deleting} onClick={removeSelected}>Delete ({selected.length})</Button>
                </>
              )}
            />
            <div className="divide-y divide-line lg:hidden">
              {list.rows.map((row) => (
                <TransactionCard
                  key={`${row.type}-${row.id}`}
                  row={row}
                  menu={menu}
                  selected={isSelected(row)}
                  onSelect={(checked) => onSelect(row, checked)}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <TransactionTable rows={list.rows} menu={menu} isSelected={isSelected} onSelect={onSelect} />
            </div>
            <LoadMore list={list} />
          </>
        )}
      </div>
      {sales.dialogs}
      {purchases.dialogs}
      {paymentsIn.dialogs}
      {paymentsOut.dialogs}
    </div>
  )
}
