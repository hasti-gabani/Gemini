import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight, Download, EllipsisVertical, Paperclip, Pencil, Phone, Printer, Share2, Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { AttachmentTiles, AttachmentViewer } from '../../components/AttachmentInput.jsx'
import { InvoiceDocument } from '../../components/documents/InvoiceDocument.jsx'
import PrintPreviewDialog from '../../components/documents/PrintPreviewDialog.jsx'
import ShareDialog from '../../components/documents/ShareDialog.jsx'
import Page from '../../components/layout/Page.jsx'
import { BalanceText } from '../../components/pickers/PartyPicker.jsx'
import Button from '../../components/ui/Button.jsx'
import { ErrorState, Menu, PageLoader, Skeleton, StatusBadge } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatDateMedium } from '../../lib/dates.js'
import { formatMoney, formatQty, isPositive, toScaled } from '../../lib/money.js'
import { downloadFile, telLink } from '../../lib/share.js'
import { BILL_KINDS } from './billConfig.js'
import { BillDeleteDialog, PayButton } from './BillShared.jsx'

function Row({ label, children, strong = false, tone = 'text-ink' }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? 'text-base font-semibold' : 'text-[15px]'}`}>
      <span className={strong ? 'text-ink' : 'text-ink-3'}>{label}</span>
      <span className={`num ${tone}`}>{children}</span>
    </div>
  )
}

function ItemCards({ bill }) {
  return (
    <div className="space-y-2">
      {bill.items.map((line, index) => (
        <div key={line.id} className="rounded-xl border border-line px-3.5 py-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 rounded-md bg-subtle px-1.5 text-xs font-semibold text-ink-3">#{index + 1}</span>
            {line.item ? (
              <Link to={`/items/${line.item}`} className="min-w-0 flex-1 font-semibold text-ink hover:underline">{line.name}</Link>
            ) : (
              <span className="min-w-0 flex-1 font-semibold text-ink">{line.name}</span>
            )}
            <span className="num font-semibold text-ink">{formatMoney(line.amount)}</span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-sm">
            <div className="flex justify-between gap-2 text-ink-2">
              <span>Item Subtotal</span>
              <span className="num">{formatQty(line.quantity)} {line.unit} × {formatMoney(line.rate, { decimals: 'auto' })} = {formatMoney(line.gross)}</span>
            </div>
            {toScaled(line.discount_amount, 2) > 0n && (
              <div className="flex justify-between gap-2 text-warn">
                <span>Discount{toScaled(line.discount_percent, 2) > 0n ? ` (${formatQty(line.discount_percent)}%)` : ''}</span>
                <span className="num">− {formatMoney(line.discount_amount)}</span>
              </div>
            )}
            {toScaled(line.tax_amount, 2) > 0n && (
              <div className="flex justify-between gap-2 text-ink-3">
                <span>Tax : {formatQty(line.tax_rate)}%{line.tax_inclusive ? ' incl.' : ''}</span>
                <span className="num">{formatMoney(line.tax_amount)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BillView({ kind }) {
  const cfg = BILL_KINDS[kind]
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { settings } = useSession()
  const { toast } = useUI()
  const [printOpen, setPrintOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [showTerms, setShowTerms] = useState(false)

  const query = useQuery({ queryKey: [kind, Number(id)], queryFn: () => api.get(`${cfg.api}/${id}/`) })
  const basePath = `${cfg.api}/${id}`
  const documentQuery = useQuery({
    queryKey: ['document', basePath],
    queryFn: () => api.get(`${basePath}/document/`),
    enabled: Boolean(query.data),
  })

  useEffect(() => {
    if (params.get('print') === '1') setPrintOpen(true)
    if (params.get('share') === '1') setShareOpen(true)
    if (params.get('print') || params.get('share')) setParams({}, { replace: true })
  }, [params, setParams])

  const bill = query.data
  if (query.isError) {
    return <Page title={cfg.title} back={cfg.base}><ErrorState error={query.error} onRetry={query.refetch} /></Page>
  }
  if (!bill) return <Page title={cfg.title} back={cfg.base}><PageLoader /></Page>

  const title = `${cfg.documentName} ${bill.number}`
  const pending = isPositive(bill.balance_due)
  const origin = bill.origin_payment

  const menu = [
    { label: 'Print', icon: Printer, onClick: () => setPrintOpen(true) },
    {
      label: 'Download PDF',
      icon: Download,
      onClick: () => downloadFile(`${basePath}/pdf/`, { format: settings?.print_format }).catch((e) => toast.error(e)),
    },
    { label: 'Edit', icon: Pencil, to: `${cfg.base}/${bill.id}/edit` },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDeleteOpen(true) },
  ]

  return (
    <Page
      title={cfg.title}
      subtitle={bill.number}
      back={cfg.base}
      maxWidth="max-w-6xl"
      mobileActions={(
        <>
          <Menu
            trigger={({ toggle }) => (
              <button type="button" aria-label="More actions" onClick={toggle} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-subtle">
                <EllipsisVertical className="size-5" />
              </button>
            )}
            items={menu}
          />
        </>
      )}
      actions={(
        <>
          <Button variant="secondary" icon={Share2} onClick={() => setShareOpen(true)}>Share</Button>
          <Button variant="secondary" icon={Printer} onClick={() => setPrintOpen(true)}>Print / PDF</Button>
          <Button variant="secondary" icon={Pencil} to={`${cfg.base}/${bill.id}/edit`}>Edit</Button>
          <Button variant="danger-soft" size="icon" icon={Trash2} onClick={() => setDeleteOpen(true)} aria-label="Delete bill" />
        </>
      )}
      footerMobileOnly
      footer={(
        <div className="flex w-full justify-evenly">
          <Button variant="danger-soft" size="icon-lg" icon={Trash2} onClick={() => setDeleteOpen(true)} aria-label="Delete bill" />
          <Button variant="success" size="icon-lg" icon={Share2} onClick={() => setShareOpen(true)} aria-label="Share" />
          <Button size="icon-lg" icon={Pencil} to={`${cfg.base}/${bill.id}/edit`} aria-label="Edit" />
        </div>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
        {/* desktop invoice preview */}
        <div className="card hidden overflow-hidden p-8 lg:block">
          {documentQuery.data ? (
            <InvoiceDocument doc={documentQuery.data} format="a4" />
          ) : (
            <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <section className="card overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
              <div className="px-4 py-3">
                <p className="text-xs text-ink-3">{cfg.numberLabel}</p>
                <p className="text-[15px] font-semibold text-ink">{bill.number}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-ink-3">Date</p>
                <p className="text-[15px] font-semibold text-ink">{formatDate(bill.date)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <div className="flex items-center gap-2">
                <StatusBadge status={bill.payment_status} overdue={bill.is_overdue} />
                <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-ink-2">{bill.mode === 'cash' ? 'Cash' : 'Credit'}</span>
              </div>
              {bill.party_detail && <BalanceText balance={bill.party_detail.balance} />}
            </div>
            <div className="px-4 pb-4 pt-2">
              <p className="text-xs text-ink-3">{cfg.party} Name</p>
              {bill.party ? (
                <Link to={`/parties/${bill.party}`} className="group flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-lg font-semibold text-ink group-hover:underline">{bill.party_name}</span>
                  <ChevronRight className="size-4 text-ink-3" />
                </Link>
              ) : (
                <p className="text-lg font-semibold text-ink">{bill.party_name}</p>
              )}
              {bill.party_phone && (
                <a href={telLink(bill.party_phone)} className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-brand-ink">
                  <Phone className="size-3.5" /> {bill.party_phone}
                </a>
              )}
              {bill.party_address && <p className="whitespace-pre-line text-sm text-ink-3">{bill.party_address}</p>}
              {bill.due_date && pending && (
                <p className={`mt-1 text-sm ${bill.is_overdue ? 'text-neg' : 'text-ink-2'}`}>Due date: {formatDateMedium(bill.due_date)}{bill.is_overdue ? ' (overdue)' : ''}</p>
              )}
            </div>
          </section>

          {bill.items.length > 0 && (
            <section className="card overflow-hidden lg:hidden">
              <div className="bg-brand-soft px-4 py-2.5 text-sm font-semibold text-brand-ink">Billed Items · {bill.items.length}</div>
              <div className="p-3"><ItemCards bill={bill} /></div>
            </section>
          )}

          <section className="card space-y-2 p-4">
            {bill.items.length > 0 && (
              <>
                <Row label="Subtotal">{formatMoney(bill.subtotal)}</Row>
                {isPositive(bill.item_discount) && <Row label="Item discount" tone="text-warn">− {formatMoney(bill.item_discount)}</Row>}
                {isPositive(bill.tax_total) && <Row label={settings?.tax_label || 'Tax'}>{formatMoney(bill.tax_total)}</Row>}
                {isPositive(bill.discount_amount) && <Row label="Discount" tone="text-warn">− {formatMoney(bill.discount_amount)}</Row>}
                {isPositive(bill.charges_amount) && <Row label={bill.charges_label || 'Other charges'}>+ {formatMoney(bill.charges_amount)}</Row>}
                {toScaled(bill.round_off, 2) !== 0n && <Row label="Round off">{formatMoney(bill.round_off, { signed: true })}</Row>}
              </>
            )}
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="text-base font-semibold text-pos">Total Amount</span>
              <span className="num text-2xl font-bold text-ink">{formatMoney(bill.total)}</span>
            </div>
            <Row label={cfg.paidWord} tone="text-pos">{formatMoney(bill.paid_amount)}</Row>
            <Row label="Balance Due" strong tone={pending ? 'text-neg' : 'text-pos'}>{formatMoney(bill.balance_due)}</Row>
            {origin && (
              <Row label="Payment Type">{origin.account_kind === 'cash' ? 'Cash' : origin.account_name}{origin.reference_no ? ` · ${origin.reference_no}` : ''}</Row>
            )}
            {pending && bill.party && (
              <div className="hidden pt-2 lg:block"><PayButton kind={kind} bill={bill} className="w-full" /></div>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <h2 className="text-base font-semibold text-ink">Payment history</h2>
              <span className="text-sm text-ink-3">{bill.payments.length} payment{bill.payments.length === 1 ? '' : 's'}</span>
            </div>
            {bill.payments.length === 0 ? (
              <p className="px-4 pb-4 text-[15px] text-ink-3">No payment {kind === 'sale' ? 'received' : 'made'} yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {bill.payments.map((payment, index) => (
                  <li key={payment.id}>
                    <Link to={`${cfg.paymentBase}/${payment.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-pos-soft text-sm font-bold text-pos">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-ink">Payment {index + 1} · {payment.number}</span>
                        <span className="block break-words text-sm text-ink-3">
                          {formatDate(payment.date)} · {payment.account_kind === 'cash' ? 'Cash' : payment.account_name}
                          {payment.is_origin ? ' · with bill' : ''}
                          {payment.reference_no ? ` · ${payment.reference_no}` : ''}
                        </span>
                      </span>
                      <span className="num font-semibold text-pos">{formatMoney(payment.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(bill.notes || bill.terms || bill.attachments.length > 0) && (
            <section className="card space-y-4 p-4">
              {bill.notes && (
                <div>
                  <h3 className="text-sm font-semibold text-ink-2">Bill Description / Notes</h3>
                  <p className="mt-1 whitespace-pre-line text-[15px] text-ink">{bill.notes}</p>
                </div>
              )}
              {bill.attachments.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-2"><Paperclip className="size-4" /> Attachments</h3>
                  <div className="flex flex-wrap gap-2"><AttachmentTiles attachments={bill.attachments} onOpen={setViewing} /></div>
                </div>
              )}
              {bill.terms && (
                <div>
                  <button type="button" className="text-sm font-semibold text-brand-ink" onClick={() => setShowTerms((v) => !v)} aria-expanded={showTerms}>
                    {showTerms ? 'Hide' : 'Show'} terms &amp; conditions
                  </button>
                  {showTerms && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{bill.terms}</p>}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <PrintPreviewDialog open={printOpen} onClose={() => setPrintOpen(false)} basePath={basePath} title={title} />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} basePath={basePath} title={title} />
      {deleteOpen && <BillDeleteDialog kind={kind} bill={bill} onClose={() => setDeleteOpen(false)} onDeleted={() => navigate(cfg.base, { replace: true })} />}
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />
    </Page>
  )
}
