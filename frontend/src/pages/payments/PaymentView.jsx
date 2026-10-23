import { useQuery } from '@tanstack/react-query'
import { ChevronRight, EllipsisVertical, Paperclip, Pencil, Printer, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { AttachmentTiles, AttachmentViewer } from '../../components/AttachmentInput.jsx'
import { ReceiptDocument } from '../../components/documents/InvoiceDocument.jsx'
import PrintPreviewDialog from '../../components/documents/PrintPreviewDialog.jsx'
import ShareDialog from '../../components/documents/ShareDialog.jsx'
import Page from '../../components/layout/Page.jsx'
import { BalanceText } from '../../components/pickers/PartyPicker.jsx'
import Button from '../../components/ui/Button.jsx'
import { Badge, ErrorState, Menu, PageLoader, Skeleton } from '../../components/ui/misc.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatDateTime } from '../../lib/dates.js'
import { amountInWords, formatMoney, isPositive } from '../../lib/money.js'
import { PAYMENT_KINDS } from './paymentConfig.js'
import { usePaymentActions } from './PaymentShared.jsx'

export default function PaymentView({ kind }) {
  const cfg = PAYMENT_KINDS[kind]
  const { id } = useParams()
  const navigate = useNavigate()
  const [printOpen, setPrintOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const { remove } = usePaymentActions(kind)

  const query = useQuery({ queryKey: [`payment-${kind}`, Number(id)], queryFn: () => api.get(`${cfg.api}/${id}/`) })
  const basePath = `${cfg.api}/${id}`
  const documentQuery = useQuery({ queryKey: ['document', basePath], queryFn: () => api.get(`${basePath}/document/`), enabled: Boolean(query.data) })
  const payment = query.data

  if (query.isError) return <Page title={cfg.title} back={cfg.base}><ErrorState error={query.error} onRetry={query.refetch} /></Page>
  if (!payment) return <Page title={cfg.title} back={cfg.base}><PageLoader /></Page>

  const title = `${cfg.documentName} ${payment.number}`
  const onDelete = () => remove(payment, () => navigate(cfg.base, { replace: true }))

  return (
    <Page
      title={cfg.title}
      subtitle={payment.number}
      back={cfg.base}
      maxWidth="max-w-6xl"
      mobileActions={(
        <>
          <Menu
            trigger={({ toggle }) => (
              <button type="button" aria-label="More actions" onClick={toggle} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-subtle"><EllipsisVertical className="size-5" /></button>
            )}
            items={[
              { label: 'Print / PDF', icon: Printer, onClick: () => setPrintOpen(true) },
              { label: 'Edit', icon: Pencil, to: `${cfg.base}/${payment.id}/edit` },
              { divider: true },
              { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
            ]}
          />
        </>
      )}
      actions={(
        <>
          <Button variant="secondary" icon={Share2} onClick={() => setShareOpen(true)}>Share</Button>
          <Button variant="secondary" icon={Printer} onClick={() => setPrintOpen(true)}>Print / PDF</Button>
          <Button variant="secondary" icon={Pencil} to={`${cfg.base}/${payment.id}/edit`}>Edit</Button>
          <Button variant="danger-soft" size="icon" icon={Trash2} onClick={onDelete} aria-label="Delete payment" />
        </>
      )}
      footerMobileOnly
      footer={(
        <div className="flex w-full justify-evenly">
          <Button variant="danger-soft" size="icon-lg" icon={Trash2} onClick={onDelete} aria-label="Delete payment" />
          <Button variant="success" size="icon-lg" icon={Share2} onClick={() => setShareOpen(true)} aria-label="Share" />
          <Button size="icon-lg" icon={Pencil} to={`${cfg.base}/${payment.id}/edit`} aria-label="Edit" />
        </div>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
        <div className="card hidden p-8 lg:block">
          {documentQuery.data ? <ReceiptDocument doc={documentQuery.data} format="a4" /> : <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-40" /></div>}
        </div>

        <div className="min-w-0 space-y-4">
          <section className="card overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
              <div className="px-4 py-3">
                <p className="text-xs text-ink-3">{cfg.numberLabel}</p>
                <p className="text-[15px] font-semibold text-ink">{payment.number}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-ink-3">Date</p>
                <p className="text-[15px] font-semibold text-ink">{formatDate(payment.date)}</p>
              </div>
            </div>
            <div className={`px-4 py-5 text-center ${kind === 'in' ? 'bg-pos-soft' : 'bg-neg-soft'}`}>
              <p className="text-sm font-medium text-ink-2">{kind === 'in' ? 'Amount Received' : 'Amount Paid'}</p>
              <p className={`text-3xl font-bold tracking-tight ${cfg.tone}`}>{formatMoney(payment.amount)}</p>
              <p className="mt-1 text-sm text-ink-2">{amountInWords(payment.amount)}</p>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-ink-3">{cfg.party} Name</p>
                  {payment.party_detail && <BalanceText balance={payment.party_detail.balance} />}
                </div>
                {payment.party ? (
                  <Link to={`/parties/${payment.party}`} className="group flex items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-lg font-semibold text-ink group-hover:underline">{payment.party_name}</span>
                    <ChevronRight className="size-4 text-ink-3" />
                  </Link>
                ) : (
                  <p className="text-lg font-semibold text-ink">{payment.party_name || '—'}</p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-[15px]">
                <div>
                  <dt className="text-xs text-ink-3">Payment Type</dt>
                  <dd className="font-medium text-ink">{payment.account_kind === 'cash' ? 'Cash' : payment.account_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">Payment Ref No.</dt>
                  <dd className="font-medium text-ink">{payment.reference_no || '—'}</dd>
                </div>
              </dl>
              {payment.origin_bill && (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-ink-2">
                  Recorded while creating {cfg.billWord}{' '}
                  <Link className="font-medium text-brand-ink" to={`${cfg.billBase}/${payment.origin_bill.id}`}>{payment.origin_bill.number}</Link>.
                </p>
              )}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="px-4 pb-2 pt-3">
              <h2 className="text-base font-semibold text-ink">Against Bills</h2>
            </div>
            {payment.allocations.length === 0 ? (
              <p className="px-4 pb-4 text-[15px] text-ink-3">Not linked to any bill — kept against the party balance.</p>
            ) : (
              <ul className="divide-y divide-line">
                {payment.allocations.map((row) => (
                  <li key={row.bill}>
                    <Link to={`${cfg.billBase}/${row.bill}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                          {row.number}
                          <Badge tone={row.payment_status === 'paid' ? 'pos' : row.payment_status === 'partial' ? 'warn' : 'neg'}>
                            {row.payment_status === 'paid' ? 'Paid' : row.payment_status === 'partial' ? 'Partial' : 'Unpaid'}
                          </Badge>
                        </span>
                        <span className="block text-sm text-ink-3">{formatDate(row.date)} · Bill {formatMoney(row.total)} · Pending {formatMoney(row.balance_due)}</span>
                      </span>
                      <span className="num font-semibold text-ink">{formatMoney(row.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {isPositive(payment.unallocated_amount) && (
              <p className="flex justify-between border-t border-line bg-warn-soft px-4 py-2.5 text-sm">
                <span className="text-warn">Advance (not linked to a bill)</span>
                <span className="num font-semibold text-warn">{formatMoney(payment.unallocated_amount)}</span>
              </p>
            )}
          </section>

          {(payment.notes || payment.attachments.length > 0) && (
            <section className="card space-y-4 p-4">
              {payment.notes && (
                <div>
                  <h3 className="text-sm font-semibold text-ink-2">Description</h3>
                  <p className="mt-1 whitespace-pre-line text-[15px] text-ink">{payment.notes}</p>
                </div>
              )}
              {payment.attachments.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-2"><Paperclip className="size-4" /> Payment proof</h3>
                  <div className="flex flex-wrap gap-2"><AttachmentTiles attachments={payment.attachments} onOpen={setViewing} size="size-24" /></div>
                </div>
              )}
            </section>
          )}
          <p className="px-1 text-xs text-ink-3">
            Created {formatDateTime(payment.created_at)}
            {new Date(payment.updated_at) - new Date(payment.created_at) > 60_000 ? ` · updated ${formatDateTime(payment.updated_at)}` : ''}
          </p>
        </div>
      </div>

      <PrintPreviewDialog open={printOpen} onClose={() => setPrintOpen(false)} basePath={basePath} title={title} />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} basePath={basePath} title={title} />
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />
    </Page>
  )
}
