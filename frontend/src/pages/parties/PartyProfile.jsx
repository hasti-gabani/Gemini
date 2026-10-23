import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft, ArrowUpRight, BellRing, EllipsisVertical, FileText, MapPin, MessageCircle, Pencil, Phone, ReceiptText,
  Share2, ShoppingCart, Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import { whatsappUrl } from '../../components/RemindDialog.jsx'
import RemindDialog from '../../components/RemindDialog.jsx'
import Button from '../../components/ui/Button.jsx'
import { PARTY_DELETE_MESSAGE } from './partyDelete.js'
import { Avatar, Badge, ErrorState, KeyValue, Menu, PageLoader, Tabs } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatDateMedium, formatDateTime } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'
import { openExternal, telLink } from '../../lib/share.js'
import PartyStatement from './PartyStatement.jsx'
import PartyTransactions, { TRANSACTION_FILTERS } from './PartyTransactions.jsx'

function DetailsTab({ party }) {
  const opening = isPositive(party.opening_balance)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card px-4 py-2">
        <dl className="divide-y divide-line">
          <KeyValue label="Party Name">{party.name}</KeyValue>
          <KeyValue label="Party type"><span className="capitalize">{party.party_type === 'both' ? 'Customer & Supplier' : party.party_type}</span></KeyValue>
          <KeyValue label="Mobile Number">{party.phone ? <a className="text-brand-ink" href={telLink(party.phone)}>{party.phone}</a> : '—'}</KeyValue>
          <KeyValue label="Alternate Mobile">{party.phone_alt ? <a className="text-brand-ink" href={telLink(party.phone_alt)}>{party.phone_alt}</a> : '—'}</KeyValue>
          <KeyValue label="Email">{party.email || '—'}</KeyValue>
          <KeyValue label="GST Number">{party.gstin || '—'}</KeyValue>
        </dl>
      </section>
      <section className="card px-4 py-2">
        <dl className="divide-y divide-line">
          <KeyValue label="Address"><span className="whitespace-pre-line">{party.address || '—'}</span></KeyValue>
          <KeyValue label="City">{party.city || '—'}</KeyValue>
          <KeyValue label="State">{party.state || '—'}</KeyValue>
          <KeyValue label="Pincode">{party.pincode || '—'}</KeyValue>
          <KeyValue label="Opening Balance">
            {opening ? (
              <span className={party.opening_balance_type === 'receivable' ? 'text-pos' : 'text-neg'}>
                {formatMoney(party.opening_balance)} · {party.opening_balance_type === 'receivable' ? 'Receivable' : 'Payable'} · {formatDate(party.opening_balance_date)}
              </span>
            ) : '—'}
          </KeyValue>
          <KeyValue label="Added on">{formatDateTime(party.created_at)}</KeyValue>
        </dl>
      </section>
      {party.notes && (
        <section className="card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-ink-2">Party Detail / Notes</h3>
          <p className="mt-1 whitespace-pre-line text-[15px] text-ink">{party.notes}</p>
        </section>
      )}
    </div>
  )
}

export default function PartyProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { confirm, toast } = useUI()
  const invalidate = useInvalidateAll()
  const [remindOpen, setRemindOpen] = useState(false)
  // Bills and payments share one "Transactions" tab; old ?tab=bills / ?tab=payments links open it
  // with the matching filter.
  const rawTab = params.get('tab') || 'transactions'
  const legacyFilter = rawTab === 'bills' || rawTab === 'payments' ? rawTab : null
  const tab = legacyFilter ? 'transactions' : rawTab
  const txnFilter = TRANSACTION_FILTERS.some((f) => f.value === params.get('filter')) ? params.get('filter') : legacyFilter || 'all'
  const txnStatus = txnFilter === 'bills' ? params.get('status') || '' : ''
  const query = useQuery({ queryKey: ['party', Number(id)], queryFn: () => api.get(`/parties/${id}/`) })
  const party = query.data

  if (query.isError) return <Page title="Party" back="/parties"><ErrorState error={query.error} onRetry={query.refetch} /></Page>
  if (!party) return <Page title="Party" back="/parties"><PageLoader /></Page>

  const receivable = isPositive(party.balance)
  const payable = isNegative(party.balance)
  const stats = party.stats
  const isSupplier = party.party_type === 'supplier'

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${party.name}?`, message: PARTY_DELETE_MESSAGE, confirmText: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await api.del(`/parties/${party.id}/`)
      invalidate()
      toast.success(`${party.name} deleted.`)
      navigate('/parties', { replace: true })
    } catch (error) {
      toast.error(error)
    }
  }

  const shareText = `${party.name}\n${receivable ? `Pending: ${formatMoney(party.balance)} (you owe us)` : payable ? `We owe: ${formatMoney(party.balance, { absolute: true })}` : 'Account settled'}`
  const menu = [
    { label: 'Edit', icon: Pencil, to: `/parties/${party.id}/edit` },
    { label: 'Statement', icon: FileText, onClick: () => setParams({ tab: 'statement' }, { replace: true }) },
    { label: 'Remind', icon: BellRing, onClick: () => setRemindOpen(true), hidden: !receivable },
    { label: 'Share on WhatsApp', icon: Share2, onClick: () => openExternal(whatsappUrl(party.phone, shareText)) },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: remove },
  ]

  return (
    <Page
      title={party.name}
      subtitle={party.phone || undefined}
      back="/parties"
      maxWidth="max-w-6xl"
      mobileActions={(
        <Menu
          trigger={({ toggle }) => (
            <button type="button" aria-label="More actions" onClick={toggle} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-subtle"><EllipsisVertical className="size-5" /></button>
          )}
          items={menu}
        />
      )}
      actions={(
        <>
          <Button variant="secondary" icon={Pencil} to={`/parties/${party.id}/edit`}>Edit</Button>
          <Menu trigger={({ toggle }) => <Button variant="secondary" size="icon" aria-label="More actions" onClick={toggle} icon={EllipsisVertical} />} items={menu} />
        </>
      )}
    >
      <div className="space-y-4">
        <section className="card p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <Avatar name={party.name} className="size-14 text-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-xl font-bold tracking-tight text-ink">{party.name}</h2>
                <Badge tone="neutral">{party.party_type === 'both' ? 'Customer & Supplier' : isSupplier ? 'Supplier' : 'Customer'}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-ink-2">
                {party.phone && <a href={telLink(party.phone)} className="inline-flex items-center gap-1.5 text-brand-ink"><Phone className="size-4" /> {party.phone}</a>}
                {party.full_address && <span className="inline-flex min-w-0 items-start gap-1.5"><MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" /> <span className="whitespace-pre-line">{party.full_address.replace('\n', ', ')}</span></span>}
              </div>
              {party.gstin && <p className="mt-0.5 text-sm text-ink-3">GSTIN: {party.gstin}</p>}
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 sm:gap-3">
            <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 sm:block ${receivable ? 'bg-pos-soft' : 'bg-muted'}`}>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">You will receive</p>
                <p className="text-xs text-ink-3">મારે લેવાના</p>
              </div>
              <p className={`num shrink-0 whitespace-nowrap text-lg font-bold xs:text-xl sm:mt-1 sm:truncate sm:text-2xl ${receivable ? 'text-pos' : 'text-ink-3'}`}>{formatMoney(receivable ? party.balance : 0)}</p>
            </div>
            <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 sm:block ${payable ? 'bg-neg-soft' : 'bg-muted'}`}>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">You will pay</p>
                <p className="text-xs text-ink-3">મારે આપવાના</p>
              </div>
              <p className={`num shrink-0 whitespace-nowrap text-lg font-bold xs:text-xl sm:mt-1 sm:truncate sm:text-2xl ${payable ? 'text-neg' : 'text-ink-3'}`}>{formatMoney(payable ? party.balance : 0, { absolute: true })}</p>
            </div>
          </div>

          {(isPositive(stats.sales_overdue) || stats.next_reminder) && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {isPositive(stats.sales_overdue) && <Badge tone="neg">{formatMoney(stats.sales_overdue)} overdue</Badge>}
              {stats.next_reminder && <Badge tone="warn">Reminder due {formatDateMedium(stats.next_reminder.due_date)}</Badge>}
            </div>
          )}

          {/* Statement lives in its tab and the more-actions menu. Customers (and Customer & Supplier)
              get "Pay Out" right after New Sale; only pure suppliers keep "Make Payment". */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {!isSupplier && <Button size="tile" to={`/payments-in/new?party=${party.id}`} variant="success" icon={ArrowDownLeft}>Take Payment</Button>}
            {!isSupplier && <Button size="tile" to={`/sales/new?party=${party.id}`} icon={ReceiptText}>New Sale</Button>}
            {!isSupplier && <Button size="tile" to={`/payments-out/new?party=${party.id}`} variant="secondary" icon={ArrowUpRight}>Pay Out</Button>}
            {party.party_type !== 'customer' && <Button size="tile" to={`/purchases/new?party=${party.id}`} variant={isSupplier ? 'primary' : 'secondary'} icon={ShoppingCart}>New Purchase</Button>}
            {isSupplier && <Button size="tile" to={`/payments-out/new?party=${party.id}`} variant="danger" icon={ArrowUpRight}>Make Payment</Button>}
            {receivable && <Button size="tile" variant="soft" icon={BellRing} onClick={() => setRemindOpen(true)}>Remind Party</Button>}
            {party.phone && <Button size="tile" variant="secondary" icon={MessageCircle} onClick={() => openExternal(whatsappUrl(party.phone, `Hello ${party.name},`))} className="sm:hidden">WhatsApp</Button>}
          </div>
        </section>

        <Tabs
          value={tab}
          onChange={(value) => setParams(value === 'transactions' ? {} : { tab: value }, { replace: true })}
          items={[
            {
              value: 'transactions',
              label: 'Transactions',
              count: stats.sales_count + stats.purchases_count + stats.payments_in_count + stats.payments_out_count,
            },
            { value: 'statement', label: 'Statement' },
            { value: 'details', label: 'Details' },
          ]}
        />

        {tab === 'transactions' && (
          <PartyTransactions
            party={party}
            filter={txnFilter}
            status={txnStatus}
            onFilterChange={(filter, status) => {
              const next = {}
              if (filter !== 'all') next.filter = filter
              if (filter === 'bills' && status) next.status = status
              setParams(next, { replace: true })
            }}
          />
        )}
        {tab === 'statement' && <PartyStatement party={party} />}
        {tab === 'details' && <DetailsTab party={party} />}

        <p className="text-center text-xs text-ink-3">
          Last transaction: {party.last_txn_date ? formatDateMedium(party.last_txn_date) : 'none'}
        </p>
      </div>
      <RemindDialog open={remindOpen} onClose={() => setRemindOpen(false)} party={party} />
    </Page>
  )
}
