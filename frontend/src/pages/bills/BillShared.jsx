import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft, EllipsisVertical, Eye, Pencil, Printer, Share2, Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import PrintPreviewDialog from '../../components/documents/PrintPreviewDialog.jsx'
import ShareDialog from '../../components/documents/ShareDialog.jsx'
import Button from '../../components/ui/Button.jsx'
import { Checkbox } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { Menu, Spinner, StatusBadge } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { formatMoney, isPositive } from '../../lib/money.js'
import { BILL_KINDS } from './billConfig.js'

/** Delete a bill; offers to also delete payments that were linked to it. */
export function BillDeleteDialog({ kind, bill, onClose, onDeleted }) {
  const cfg = BILL_KINDS[kind]
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const [withPayments, setWithPayments] = useState(false)
  const [busy, setBusy] = useState(false)
  const preview = useQuery({
    queryKey: [kind, bill?.id, 'delete-preview'],
    queryFn: () => api.get(`${cfg.api}/${bill.id}/delete-preview/`),
    enabled: Boolean(bill),
    gcTime: 0,
  })
  if (!bill) return null
  const linked = preview.data?.linked_payments || []
  const receivedWithBill = preview.data?.received_with_bill

  const remove = async () => {
    setBusy(true)
    try {
      await api.del(`${cfg.api}/${bill.id}/`, { delete_linked_payments: withPayments ? 1 : 0 })
      invalidate()
      toast.success(`${cfg.title} ${bill.number} deleted.`)
      onDeleted?.()
      onClose()
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${cfg.title.toLowerCase()} ${bill.number}?`}
      size="sm"
      footer={(
        <div className="flex w-full gap-3 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" className="flex-1 sm:flex-none" loading={busy} disabled={preview.isPending} onClick={remove}>Delete</Button>
        </div>
      )}
    >
      {preview.isPending ? (
        <div className="grid h-24 place-items-center"><Spinner /></div>
      ) : (
        <div className="space-y-3 text-[15px] text-ink-2">
          <p>
            This removes the bill of <strong className="text-ink">{formatMoney(bill.total)}</strong>
            {bill.party_name ? <> for <strong className="text-ink">{bill.party_name}</strong></> : null}.
            Stock, {cfg.party.toLowerCase()} balance, cash/bank balance, ledger and reports are recalculated automatically.
          </p>
          {receivedWithBill && isPositive(receivedWithBill) && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              The {formatMoney(receivedWithBill)} {kind === 'sale' ? 'received' : 'paid'} while creating this bill is deleted with it.
            </p>
          )}
          {linked.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <Checkbox
                checked={withPayments}
                onChange={setWithPayments}
                label={`Also delete ${linked.length} linked payment${linked.length > 1 ? 's' : ''}`}
                description={linked.map((p) => `${p.number} (${formatMoney(p.amount)})`).join(', ')}
              />
              {!withPayments && (
                <p className="mt-2 text-sm text-ink-3">If kept, these payments stay as advance payments for the {cfg.party.toLowerCase()}.</p>
              )}
            </div>
          )}
          <p className="text-sm text-neg">This cannot be undone.</p>
        </div>
      )}
    </Modal>
  )
}

/** Row actions + dialogs shared by bill lists (sales page, customer profile). */
export function useBillActions(kind) {
  const cfg = BILL_KINDS[kind]
  const navigate = useNavigate()
  const [dialog, setDialog] = useState(null) // {type, bill}

  const menuItems = (bill) => [
    { label: 'Open', icon: Eye, to: `${cfg.base}/${bill.id}` },
    { label: 'Edit', icon: Pencil, to: `${cfg.base}/${bill.id}/edit` },
    {
      label: cfg.paymentAction,
      icon: ArrowDownLeft,
      hidden: !isPositive(bill.balance_due) || !bill.party,
      onClick: () => navigate(`${cfg.paymentBase}/new?party=${bill.party}&bill=${bill.id}`),
    },
    { label: 'Share', icon: Share2, onClick: () => setDialog({ type: 'share', bill }) },
    { label: 'Print / PDF', icon: Printer, onClick: () => setDialog({ type: 'print', bill }) },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDialog({ type: 'delete', bill }) },
  ]

  const dialogs = (
    <>
      <ShareDialog
        open={dialog?.type === 'share'}
        onClose={() => setDialog(null)}
        basePath={dialog?.bill ? `${cfg.api}/${dialog.bill.id}` : ''}
        title={dialog?.bill ? `${cfg.documentName} ${dialog.bill.number}` : ''}
      />
      <PrintPreviewDialog
        open={dialog?.type === 'print'}
        onClose={() => setDialog(null)}
        basePath={dialog?.bill ? `${cfg.api}/${dialog.bill.id}` : ''}
        title={dialog?.bill ? `${cfg.documentName} ${dialog.bill.number}` : ''}
      />
      {dialog?.type === 'delete' && <BillDeleteDialog kind={kind} bill={dialog.bill} onClose={() => setDialog(null)} />}
    </>
  )

  return { menuItems, dialogs }
}

export function RowMenu({ items, label = 'Actions' }) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type="button"
          aria-label={label}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            toggle()
          }}
          className="grid size-9 place-items-center rounded-lg text-ink-3 transition hover:bg-subtle hover:text-ink"
        >
          <EllipsisVertical className="size-[18px]" />
        </button>
      )}
      items={items}
    />
  )
}

/** Phone card row for a bill (list or customer profile). */
export function BillCardRow({ kind, bill, menuItems, showParty = true }) {
  const cfg = BILL_KINDS[kind]
  return (
    <div className="flex items-stretch">
      {/* Below 360px the amounts go under the bill details, so the name and date keep the full width. */}
      <Link to={`${cfg.base}/${bill.id}`} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 transition hover:bg-muted max-[360px]:flex-col max-[360px]:gap-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="line-clamp-2 break-words text-[15px] font-semibold text-ink">{showParty ? bill.party_name || cfg.party : bill.number}</p>
            <span className="hidden shrink-0 xs:inline-flex"><StatusBadge status={bill.payment_status} overdue={bill.is_overdue} /></span>
          </div>
          <p className="break-words text-sm text-ink-3">
            {showParty ? `${bill.number} · ` : ''}{formatDate(bill.date)}{bill.total_qty && bill.item_count ? ` · Qty ${bill.total_qty}` : ''}
            {/* Small phones: the badge moves under the name so the name has room. */}
            <span className="ml-1.5 inline-flex align-middle xs:hidden"><StatusBadge status={bill.payment_status} overdue={bill.is_overdue} /></span>
          </p>
          {bill.items_summary && <p className="break-words text-sm text-ink-2">{bill.items_summary}</p>}
        </div>
        <div className="shrink-0 text-right max-[360px]:flex max-[360px]:flex-wrap max-[360px]:items-baseline max-[360px]:gap-x-2 max-[360px]:text-left">
          <p className="num text-[15px] font-semibold text-ink">{formatMoney(bill.total)}</p>
          {isPositive(bill.balance_due) ? (
            <>
              {isPositive(bill.paid_amount) && <p className="num text-xs text-pos">{cfg.paidWord} {formatMoney(bill.paid_amount)}</p>}
              <p className="num text-sm text-neg">Due {formatMoney(bill.balance_due)}</p>
            </>
          ) : (
            <p className="text-sm text-pos">Paid</p>
          )}
        </div>
      </Link>
      <div className="flex items-center pr-2">
        <RowMenu items={menuItems(bill)} label={`Actions for ${bill.number}`} />
      </div>
    </div>
  )
}

/** Desktop table of bills. */
export function BillTable({ kind, rows, menuItems, showParty = true }) {
  const cfg = BILL_KINDS[kind]
  const navigate = useNavigate()
  return (
    <table className="w-full min-w-[860px] text-[15px]">
      {/* Not sticky: inside the sideways-scrolling wrapper a sticky header cannot follow the page
          and was only pushed down over the first rows. */}
      <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
        <tr>
          <th className="px-4 py-2.5">Date</th>
          <th className="px-3 py-2.5">{cfg.numberLabel}</th>
          {showParty && <th className="px-3 py-2.5">{cfg.party}</th>}
          <th className="px-3 py-2.5">Items</th>
          <th className="px-3 py-2.5 text-right">Total</th>
          <th className="px-3 py-2.5 text-right">{cfg.paidWord}</th>
          <th className="px-3 py-2.5 text-right">Pending</th>
          <th className="px-3 py-2.5">Status</th>
          <th className="w-12" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((bill) => (
          <tr key={bill.id} className="cursor-pointer transition hover:bg-muted" onClick={() => navigate(`${cfg.base}/${bill.id}`)}>
            <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatDate(bill.date)}</td>
            <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-ink">{bill.number}</td>
            {showParty && <td className="max-w-56 break-words px-3 py-3 text-ink">{bill.party_name}</td>}
            <td className="max-w-64 px-3 py-3 text-sm text-ink-2">
              <span className="block break-words">{bill.items_summary || '—'}</span>
              {bill.item_count > 0 && <span className="text-xs text-ink-3">Qty {bill.total_qty}</span>}
            </td>
            <td className="num whitespace-nowrap px-3 py-3 text-right font-semibold text-ink">{formatMoney(bill.total)}</td>
            <td className="num whitespace-nowrap px-3 py-3 text-right text-pos">{formatMoney(bill.paid_amount)}</td>
            <td className={`num whitespace-nowrap px-3 py-3 text-right ${isPositive(bill.balance_due) ? 'text-neg' : 'text-ink-3'}`}>{formatMoney(bill.balance_due)}</td>
            <td className="px-3 py-3"><StatusBadge status={bill.payment_status} overdue={bill.is_overdue} /></td>
            <td className="px-2 py-3" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems(bill)} label={`Actions for ${bill.number}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PayButton({ kind, bill, size = 'md', className = '' }) {
  const cfg = BILL_KINDS[kind]
  if (!bill.party || !isPositive(bill.balance_due)) return null
  return (
    <Button
      to={`${cfg.paymentBase}/new?party=${bill.party}&bill=${bill.id}`}
      variant="success"
      size={size}
      icon={ArrowDownLeft}
      className={className}
    >
      {cfg.paymentAction}
    </Button>
  )
}
