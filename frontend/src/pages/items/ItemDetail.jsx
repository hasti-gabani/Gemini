import { useQuery } from '@tanstack/react-query'
import {
  EllipsisVertical, Package, PackageX, Pencil, ReceiptText, ShoppingCart, SlidersHorizontal, Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { Badge, EmptyState, ErrorState, FitAmount, Menu, Skeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatDateMedium } from '../../lib/dates.js'
import { useInvalidateAll, useIsDesktop } from '../../lib/hooks.js'
import { formatMoney, formatQty, toScaled } from '../../lib/money.js'
import { IconButton, ItemThumb, signedQty, stockState } from './shared.jsx'
import StockAdjustDialog from './StockAdjustDialog.jsx'

const MOVEMENTS = {
  sale: { label: 'Sale', icon: ReceiptText, tile: 'bg-brand-soft text-brand-ink', badge: 'brand' },
  purchase: { label: 'Purchase', icon: ShoppingCart, tile: 'bg-warn-soft text-warn', badge: 'warn' },
  adjustment: { label: 'Adjustment', icon: SlidersHorizontal, tile: 'bg-subtle text-ink-2', badge: 'neutral' },
  opening: { label: 'Opening stock', icon: Package, tile: 'bg-subtle text-ink-2', badge: 'neutral' },
}

function movementLink(row) {
  if (row.type === 'sale' && row.ref_id) return `/sales/${row.ref_id}`
  if (row.type === 'purchase' && row.ref_id) return `/purchases/${row.ref_id}`
  return null
}

function qtyTone(row) {
  if (row.type === 'opening') return 'text-ink'
  const scaled = toScaled(row.quantity, 3)
  return scaled > 0n ? 'text-pos' : scaled < 0n ? 'text-neg' : 'text-ink'
}

function Stat({ label, value, sub, tone = 'text-ink', badge }) {
  return (
    <div className="card min-w-0 p-3.5 sm:p-4">
      <p className="break-words text-sm font-medium text-ink-2">{label}</p>
      <FitAmount className={`mt-1 text-lg font-semibold tracking-tight ${tone}`}>{value}</FitAmount>
      {badge && <div className="mt-1">{badge}</div>}
      {sub && <p className="mt-0.5 break-words text-xs text-ink-3">{sub}</p>}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="card flex gap-4 p-5">
          <Skeleton className="size-20 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
        </div>
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  )
}

function QuickAction({ icon: Icon, label, to, onClick }) {
  const classes = 'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl bg-muted px-1 py-2.5 text-center text-xs font-medium leading-tight text-ink-2 transition hover:bg-subtle active:bg-subtle'
  const body = (
    <>
      <Icon className="size-5 text-brand-ink" aria-hidden />
      {label}
    </>
  )
  if (to) return <Link to={to} className={classes}>{body}</Link>
  return <button type="button" onClick={onClick} className={classes}>{body}</button>
}

function HistoryCards({ rows, unit, onDeleteAdjustment }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row, index) => {
        const meta = MOVEMENTS[row.type] || MOVEMENTS.adjustment
        const link = movementLink(row)
        const title = row.type === 'adjustment' ? row.party || 'Stock adjustment' : row.party || meta.label
        const body = (
          <>
            <span className={`hidden size-10 shrink-0 place-items-center rounded-xl xs:grid ${meta.tile}`}>
              <meta.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 break-words font-medium text-ink">{title}</span>
              <span className="block break-words text-sm text-ink-3">
                {[meta.label, row.number, formatDateMedium(row.date)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className={`num font-semibold ${qtyTone(row)}`}>
                {row.type === 'opening' ? formatQty(row.quantity) : signedQty(row.quantity)}{' '}
                <span className="text-xs font-normal text-ink-3">{unit}</span>
              </span>
              <span className="num text-xs text-ink-3">Stock {formatQty(row.stock)}</span>
            </span>
          </>
        )
        const classes = 'flex min-w-0 flex-1 items-center gap-3 py-3 pl-4'
        return (
          <li key={`${row.type}-${row.ref_id ?? 'opening'}-${index}`} className="flex items-center">
            {link ? (
              <Link to={link} className={`${classes} pr-4 transition hover:bg-muted active:bg-subtle`}>{body}</Link>
            ) : (
              <div className={`${classes} ${row.type === 'adjustment' ? 'pr-1' : 'pr-4'}`}>{body}</div>
            )}
            {row.type === 'adjustment' && (
              <IconButton icon={Trash2} label="Delete this stock adjustment" danger className="mr-2" onClick={() => onDeleteAdjustment(row)} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function HistoryTable({ rows, unit, onDeleteAdjustment }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[580px] text-sm">
        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-5 py-3">Date</th>
            <th scope="col" className="px-3 py-3">Type</th>
            <th scope="col" className="px-3 py-3">Number</th>
            <th scope="col" className="px-3 py-3">Party / Note</th>
            <th scope="col" className="px-3 py-3 text-right">Qty</th>
            <th scope="col" className="px-3 py-3 text-right">Stock</th>
            <th scope="col" className="w-14 px-3 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, index) => {
            const meta = MOVEMENTS[row.type] || MOVEMENTS.adjustment
            const link = movementLink(row)
            return (
              <tr key={`${row.type}-${row.ref_id ?? 'opening'}-${index}`} className="transition hover:bg-muted">
                <td className="whitespace-nowrap px-5 py-2.5 text-ink-2">{formatDate(row.date)}</td>
                <td className="px-3 py-2.5"><Badge tone={meta.badge}>{row.type_label || meta.label}</Badge></td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {link ? (
                    <Link to={link} className="font-medium text-brand-ink hover:underline">{row.number || 'View'}</Link>
                  ) : (
                    <span className="text-ink-3">{row.number || '—'}</span>
                  )}
                  {row.rate && <span className="num block text-xs text-ink-3">@ {formatMoney(row.rate)}</span>}
                </td>
                <td className="max-w-64 px-3 py-2.5 text-ink-2"><span className="block break-words">{row.party || '—'}</span></td>
                <td className={`num whitespace-nowrap px-3 py-2.5 text-right font-semibold ${qtyTone(row)}`}>
                  {row.type === 'opening' ? formatQty(row.quantity) : signedQty(row.quantity)} <span className="text-xs font-normal text-ink-3">{unit}</span>
                </td>
                <td className="num whitespace-nowrap px-3 py-2.5 text-right font-medium text-ink">{formatQty(row.stock)}</td>
                <td className="px-2 py-1 text-right">
                  {row.type === 'adjustment' && (
                    <IconButton icon={Trash2} label="Delete this stock adjustment" danger onClick={() => onDeleteAdjustment(row)} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ItemDetail() {
  const { id } = useParams()
  const { t } = useSession()
  const { toast, confirm } = useUI()
  const navigate = useNavigate()
  const invalidate = useInvalidateAll()
  const isDesktop = useIsDesktop()
  const [deleted, setDeleted] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)

  const query = useQuery({
    queryKey: ['item-history', id],
    queryFn: ({ signal }) => api.get(`/items/${id}/history/`, undefined, { signal }),
    enabled: !deleted,
  })
  const data = query.data
  const item = data?.item

  const deleteItem = async () => {
    const ok = await confirm({
      title: 'Delete item?',
      message: `"${item.name}" will be deleted permanently.`,
      confirmText: t('delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.del(`/items/${item.id}/`)
    } catch (error) {
      if (error.errors?.requires_force !== 'true') {
        toast.error(error)
        return
      }
      const again = await confirm({
        title: 'This item is used in bills',
        message: error.message,
        confirmText: 'Delete anyway',
        tone: 'danger',
      })
      if (!again) return
      try {
        await api.del(`/items/${item.id}/`, { force: 1 })
      } catch (forceError) {
        toast.error(forceError)
        return
      }
    }
    // stop this page from refetching a record that no longer exists
    flushSync(() => setDeleted(true))
    invalidate()
    toast.success(`"${item.name}" deleted.`)
    navigate('/items', { replace: true })
  }

  const deleteAdjustment = async (row) => {
    const ok = await confirm({
      title: 'Delete stock adjustment?',
      message: `The adjustment of ${signedQty(row.quantity)} ${item.unit} on ${formatDate(row.date)} will be removed and the stock recalculated.`,
      confirmText: t('delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.del(`/stock-adjustments/${row.ref_id}/`)
      invalidate()
      toast.success('Stock adjustment deleted.')
    } catch (error) {
      toast.error(error)
    }
  }

  const saleLink = item ? `/sales/new?item=${item.id}` : ''
  const purchaseLink = item ? `/purchases/new?item=${item.id}` : ''

  const actions = item ? (
    <>
      <Button variant="danger-soft" size="icon" icon={Trash2} aria-label="Delete item" title="Delete item" onClick={deleteItem} />
      <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setAdjustOpen(true)}>Adjust Stock</Button>
      <Button variant="secondary" icon={Pencil} to={`/items/${item.id}/edit`}>{t('edit')}</Button>
      <Button variant="secondary" icon={ShoppingCart} to={purchaseLink}>{t('new_purchase')}</Button>
      <Button icon={ReceiptText} to={saleLink}>{t('new_sale')}</Button>
    </>
  ) : null

  const mobileActions = item ? (
    <>
      <Link
        to={`/items/${item.id}/edit`}
        aria-label="Edit item"
        className="grid size-11 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink"
      >
        <Pencil className="size-5" />
      </Link>
      <Menu
        trigger={({ toggle }) => (
          <button
            type="button"
            aria-label="More actions"
            onClick={toggle}
            className="grid size-11 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink"
          >
            <EllipsisVertical className="size-5" />
          </button>
        )}
        items={[
          { label: 'Adjust Stock', icon: SlidersHorizontal, onClick: () => setAdjustOpen(true) },
          { label: 'New Sale with this item', icon: ReceiptText, to: saleLink },
          { label: 'New Purchase with this item', icon: ShoppingCart, to: purchaseLink },
          { divider: true },
          { label: 'Delete item', icon: Trash2, danger: true, onClick: deleteItem },
        ]}
      />
    </>
  ) : null

  let content
  if (query.isPending) {
    content = <DetailSkeleton />
  } else if (query.isError) {
    content = (
      <div className="card">
        {query.error?.status === 404 ? (
          <EmptyState
            icon={PackageX}
            title="Item not found"
            message="This item may have been deleted."
            action={<Button variant="secondary" to="/items">Back to items</Button>}
          />
        ) : (
          <ErrorState error={query.error} onRetry={query.refetch} />
        )}
      </div>
    )
  } else {
    const state = stockState(item)
    const unit = item.unit
    const totals = data.totals || {}
    const rows = data.results || []
    const hasLimit = toScaled(item.low_stock_limit, 3) > 0n

    content = (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:items-start xl:gap-5">
        <div className="min-w-0 space-y-4">
          <section className="card p-4 sm:p-5">
            <div className="flex items-start gap-4">
              <ItemThumb item={item} className="size-20 rounded-2xl text-xl" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold leading-snug text-ink lg:hidden">{item.name}</h2>
                <p className="text-sm text-ink-3 lg:text-[15px] lg:text-ink-2">
                  {item.code ? `Code ${item.code}` : 'No item code'}
                </p>
                <p className="text-sm text-ink-3">{item.category_name || 'Uncategorized'}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.is_active ? <Badge tone="pos">Active</Badge> : <Badge>Inactive</Badge>}
                  <Badge>{unit}</Badge>
                  {item.hsn && <Badge>HSN {item.hsn}</Badge>}
                  {!item.track_stock && <Badge>Stock not tracked</Badge>}
                </div>
              </div>
            </div>
            {item.description && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{item.description}</p>}
            <div className="mt-4 grid grid-cols-3 gap-2 lg:hidden">
              <QuickAction icon={SlidersHorizontal} label="Adjust Stock" onClick={() => setAdjustOpen(true)} />
              <QuickAction icon={ReceiptText} label={t('new_sale')} to={saleLink} />
              <QuickAction icon={ShoppingCart} label={t('new_purchase')} to={purchaseLink} />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
            <Stat
              label="Current Stock"
              value={state === 'untracked' ? 'Not tracked' : `${formatQty(item.current_stock)} ${unit}`}
              tone={state === 'out' ? 'text-neg' : state === 'low' ? 'text-warn' : 'text-ink'}
              badge={state === 'out' ? <Badge tone="neg">Out of stock</Badge> : state === 'low' ? <Badge tone="warn">Low Stock Alert</Badge> : null}
              sub={state === 'untracked' ? 'Stock is not counted' : hasLimit ? `Alert at ${formatQty(item.low_stock_limit)} ${unit}` : 'No low stock alert set'}
            />
            <Stat
              label="Sold Qty"
              value={`${formatQty(item.sold_qty)} ${unit}`}
              sub={`Sales ${formatMoney(totals.sales_amount, { decimals: 'auto' })}`}
            />
            <Stat
              label="Purchased Qty"
              value={`${formatQty(item.purchased_qty)} ${unit}`}
              sub={`Purchases ${formatMoney(totals.purchase_amount, { decimals: 'auto' })}`}
            />
            <Stat
              label="Stock Value"
              value={item.track_stock ? formatMoney(item.stock_value, { decimals: 'auto' }) : '—'}
              sub="At purchase price"
            />
            <Stat label="Sale Price" value={formatMoney(item.sale_price, { decimals: 'auto' })} sub={`Per ${unit}`} />
            <Stat label="Purchase Price" value={formatMoney(item.purchase_price, { decimals: 'auto' })} sub={`Per ${unit}`} />
          </div>
        </div>

        <section className="card min-w-0 overflow-hidden">
          <div className="px-4 pb-3 pt-4 sm:px-5">
            <h2 className="text-base font-semibold text-ink">Stock History</h2>
            <p className="text-sm text-ink-3">
              {rows.length > 1 ? `${rows.length - 1} movement${rows.length === 2 ? '' : 's'} · newest first` : 'Sales, purchases and adjustments appear here'}
            </p>
          </div>
          <div className="border-t border-line">
            {isDesktop ? (
              <HistoryTable rows={rows} unit={unit} onDeleteAdjustment={deleteAdjustment} />
            ) : (
              <HistoryCards rows={rows} unit={unit} onDeleteAdjustment={deleteAdjustment} />
            )}
          </div>
          {rows.length <= 1 && (
            <p className="border-t border-line px-5 py-6 text-center text-[15px] text-ink-3">
              No sales, purchases or stock adjustments yet.
            </p>
          )}
        </section>
      </div>
    )
  }

  return (
    <Page
      title={item?.name || t('item')}
      back="/items"
      actions={actions}
      mobileActions={mobileActions}
    >
      {content}
      <StockAdjustDialog open={adjustOpen && Boolean(item)} onClose={() => setAdjustOpen(false)} item={item} />
    </Page>
  )
}
