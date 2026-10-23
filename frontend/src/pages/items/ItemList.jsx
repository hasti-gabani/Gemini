import { IndianRupee, Package, PackageX, Plus, SearchX, Tags, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import Page, { Fab } from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { Select } from '../../components/ui/form.jsx'
import { Badge, Chips, EmptyState, ErrorState, FitAmount, ListSkeleton, LoadMore, SearchInput, Skeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useDebounced, useIsDesktop, usePagedList } from '../../lib/hooks.js'
import { formatMoney, formatQty } from '../../lib/money.js'
import CategoryManager from './CategoryManager.jsx'
import { ItemThumb, StockBadge, stockState, useCategories } from './shared.jsx'

const STOCK_FILTERS = [
  { value: '', label: 'All' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
]

const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: '-current_stock', label: 'Stock: high to low' },
  { value: 'current_stock', label: 'Stock: low to high' },
  { value: '-sold_qty', label: 'Most sold' },
  { value: '-sale_price', label: 'Sale price: high to low' },
  { value: '-created_at', label: 'Newest first' },
]

const TILE_TONES = {
  brand: 'bg-brand-soft text-brand-ink',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  neg: 'bg-neg-soft text-neg',
}

function SummaryTile({ label, value, icon: Icon, tone, loading, active, onClick, title }) {
  const body = (
    <>
      <span className={`hidden size-10 shrink-0 place-items-center rounded-xl xs:grid ${TILE_TONES[tone]}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-2">{label}</span>
        {loading ? (
          <Skeleton className="mt-1 h-6 w-16" />
        ) : (
          <span title={title}><FitAmount as="span" className="text-lg font-semibold tracking-tight text-ink">{value}</FitAmount></span>
        )}
      </span>
    </>
  )
  const classes = `card flex min-w-0 items-center gap-3 p-3.5 text-left transition sm:p-4 ${active ? 'border-brand ring-2 ring-[var(--ring)]' : ''}`
  if (!onClick) return <div className={classes}>{body}</div>
  return (
    <button type="button" aria-pressed={Boolean(active)} onClick={onClick} className={`${classes} hover:border-line-strong`}>
      {body}
    </button>
  )
}

function StockLine({ item }) {
  const state = stockState(item)
  if (state === 'untracked') return <span className="text-xs text-ink-3">Stock not tracked</span>
  return (
    <span className="flex items-center gap-1.5">
      <span className={`num text-sm ${state === 'out' ? 'font-semibold text-neg' : 'text-ink-2'}`}>
        {formatQty(item.current_stock)} {item.unit}
      </span>
      {state === 'out' && <Badge tone="neg">Out</Badge>}
      {state === 'low' && <Badge tone="warn">Low</Badge>}
    </span>
  )
}

function ItemCards({ rows }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((item) => (
        <li key={item.id}>
          {/* Below 360px the price and stock go on a second line, under the name. */}
          <Link to={`/items/${item.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted active:bg-subtle max-[360px]:flex-wrap max-[360px]:gap-y-1">
            <ItemThumb item={item} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="line-clamp-2 break-words font-medium text-ink">{item.name}</span>
                {!item.is_active && <Badge className="shrink-0">Inactive</Badge>}
              </span>
              <span className="block break-words text-sm text-ink-3">
                {[item.code, item.category_name || 'Uncategorized'].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 max-[360px]:basis-full max-[360px]:flex-row max-[360px]:items-center max-[360px]:gap-2 max-[360px]:pl-14">
              <span className="num font-semibold text-ink">{formatMoney(item.sale_price, { decimals: 'auto' })}</span>
              <StockLine item={item} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function ItemTable({ rows }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-sm">
        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-3">Item</th>
            <th scope="col" className="px-3 py-3">Code</th>
            <th scope="col" className="px-3 py-3">Category</th>
            <th scope="col" className="px-3 py-3 text-right">Sale Price</th>
            <th scope="col" className="px-3 py-3 text-right">Purchase Price</th>
            <th scope="col" className="px-3 py-3 text-right">Current Stock</th>
            <th scope="col" className="px-3 py-3 text-right">Sold</th>
            <th scope="col" className="px-3 py-3 text-right">Purchased</th>
            <th scope="col" className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((item) => {
            const state = stockState(item)
            return (
              <tr key={item.id} onClick={() => navigate(`/items/${item.id}`)} className="cursor-pointer transition hover:bg-muted">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/items/${item.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="flex min-w-0 items-center gap-3 font-medium text-ink hover:text-brand-ink"
                  >
                    <ItemThumb item={item} className="size-9 rounded-lg text-xs" />
                    <span className="min-w-0 max-w-64 break-words">{item.name}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-ink-2">{item.code || '—'}</td>
                <td className="px-3 py-2.5 text-ink-2">{item.category_name || <span className="text-ink-3">Uncategorized</span>}</td>
                <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink">{formatMoney(item.sale_price)}</td>
                <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{formatMoney(item.purchase_price)}</td>
                <td className={`num whitespace-nowrap px-3 py-2.5 text-right ${state === 'out' ? 'font-semibold text-neg' : state === 'low' ? 'font-semibold text-warn' : 'text-ink'}`}>
                  {state === 'untracked' ? <span className="font-normal text-ink-3">—</span> : `${formatQty(item.current_stock)} ${item.unit}`}
                </td>
                <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{formatQty(item.sold_qty)}</td>
                <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{formatQty(item.purchased_qty)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    <StockBadge item={item} />
                    {!item.is_active && <Badge>Inactive</Badge>}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ItemList() {
  const { t } = useSession()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const debouncedSearch = useDebounced(search.trim(), 300)
  const categories = useCategories()

  const rawCategory = searchParams.get('category') || ''
  const categoryKnown = rawCategory === 'none' || !categories.data || categories.data.some((c) => String(c.id) === rawCategory)
  const category = categoryKnown ? rawCategory : ''
  const stock = STOCK_FILTERS.some((f) => f.value === searchParams.get('stock')) ? searchParams.get('stock') : ''
  const ordering = SORT_OPTIONS.some((o) => o.value === searchParams.get('ordering')) ? searchParams.get('ordering') : 'name'

  const setParam = (key, value) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const list = usePagedList(['item-list'], '/items/', { search: debouncedSearch, category, stock, ordering }, { pageSize: 30 })
  const summary = list.summary
  const rows = list.rows
  const filtered = Boolean(debouncedSearch || category || stock)

  const clearFilters = () => {
    setSearch('')
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('category')
      next.delete('stock')
      return next
    }, { replace: true })
  }

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(categories.data || []).map((c) => ({ value: String(c.id), label: `${c.name} (${c.item_count})` })),
    ...(categories.isPending && category && category !== 'none' ? [{ value: category, label: 'Category…' }] : []),
    { value: 'none', label: 'Uncategorized' },
  ]

  const count = summary?.count ?? 0

  return (
    <Page
      title={t('items')}
      subtitle={summary ? `${count} item${count === 1 ? '' : 's'}` : undefined}
      actions={(
        <>
          <Button variant="secondary" icon={Tags} onClick={() => setManageOpen(true)}>Manage categories</Button>
          <Button icon={Plus} to="/items/new">{t('add_item')}</Button>
        </>
      )}
      mobileActions={(
        <button
          type="button"
          aria-label="Manage categories"
          onClick={() => setManageOpen(true)}
          className="grid size-11 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink"
        >
          <Tags className="size-[21px]" />
        </button>
      )}
      fab={<Fab><Button icon={Plus} to="/items/new" size="lg">{t('add_item')}</Button></Fab>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <SummaryTile
          label={t('items')}
          value={count}
          icon={Package}
          tone="brand"
          loading={!summary}
          active={false}
          onClick={stock ? () => setParam('stock', '') : undefined}
        />
        <SummaryTile
          label="Stock Value"
          value={formatMoney(summary?.stock_value, { decimals: 'auto' })}
          title="Current stock × purchase price"
          icon={IndianRupee}
          tone="pos"
          loading={!summary}
        />
        <SummaryTile
          label={t('low_stock')}
          value={summary?.low_stock ?? 0}
          icon={TriangleAlert}
          tone="warn"
          loading={!summary}
          active={stock === 'low'}
          onClick={() => setParam('stock', stock === 'low' ? '' : 'low')}
        />
        <SummaryTile
          label="Out of Stock"
          value={summary?.out_of_stock ?? 0}
          icon={PackageX}
          tone="neg"
          loading={!summary}
          active={stock === 'out'}
          onClick={() => setParam('stock', stock === 'out' ? '' : 'out')}
        />
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by name, code or HSN"
            className="lg:max-w-md lg:flex-1"
          />
          <div className="grid grid-cols-2 gap-2 lg:flex lg:gap-3">
            <Select
              aria-label="Filter by category"
              value={category}
              onChange={(event) => setParam('category', event.target.value)}
              options={categoryOptions}
              className="lg:w-52"
            />
            <Select
              aria-label="Sort items"
              value={ordering}
              onChange={(event) => setParam('ordering', event.target.value === 'name' ? '' : event.target.value)}
              options={SORT_OPTIONS}
              className="lg:w-56"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Chips items={STOCK_FILTERS} value={stock} onChange={(value) => setParam('stock', value)} className="max-w-full" />
          {filtered && !list.isPending && (
            <p className="text-sm text-ink-3">
              {list.count} match{list.count === 1 ? '' : 'es'} ·{' '}
              <button type="button" onClick={clearFilters} className="font-medium text-brand-ink hover:underline">Clear filters</button>
            </p>
          )}
        </div>
      </div>

      <section className={`card mt-3 overflow-hidden transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={list.isFetching || undefined}>
        {list.isPending ? (
          <ListSkeleton rows={8} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : rows.length === 0 ? (
          filtered || count > 0 ? (
            <EmptyState
              icon={SearchX}
              title="No items found"
              message="Try a different name, code, category or stock filter."
              action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No items added yet"
              message="Add the products and services you sell to use them in bills and keep track of stock."
              action={<Button icon={Plus} to="/items/new">Add your first item</Button>}
            />
          )
        ) : isDesktop ? (
          <ItemTable rows={rows} />
        ) : (
          <ItemCards rows={rows} />
        )}
      </section>
      <LoadMore list={list} />

      <CategoryManager open={manageOpen} onClose={() => setManageOpen(false)} />
    </Page>
  )
}
