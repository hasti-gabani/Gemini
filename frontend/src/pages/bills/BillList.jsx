import { Plus, ReceiptText, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import Page, { Fab } from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import DateRangePicker from '../../components/ui/DateRangePicker.jsx'
import { Chips, EmptyState, ErrorState, ListSkeleton, LoadMore, SearchInput, SummaryCards } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { rangeText, todayISO } from '../../lib/dates.js'
import { useDebounced, usePagedList } from '../../lib/hooks.js'
import { formatMoney } from '../../lib/money.js'
import { BILL_KINDS, STATUS_OPTIONS } from './billConfig.js'
import { BillCardRow, BillTable, useBillActions } from './BillShared.jsx'

export default function BillList({ kind }) {
  const cfg = BILL_KINDS[kind]
  const { t } = useSession()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') || '')
  const debounced = useDebounced(search.trim(), 300)
  const status = params.get('status') || ''
  // From – To, both today when not chosen
  const from = params.get('from') || todayISO()
  const to = params.get('to') || todayISO()

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const setRange = (range) => {
    const next = new URLSearchParams(params)
    for (const key of ['from', 'to']) {
      if (range[key]) next.set(key, range[key])
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }

  const filters = { search: debounced, status, period: 'custom', date_from: from, date_to: to }
  const list = usePagedList([kind === 'sale' ? 'sales' : 'purchases'], `${cfg.api}/`, filters)
  const { menuItems, dialogs } = useBillActions(kind)
  const summary = list.summary
  const Icon = kind === 'sale' ? ReceiptText : ShoppingCart
  const filtered = Boolean(debounced || status)

  return (
    <Page
      title={t(cfg.listTitleKey)}
      subtitle={list.count ? `${list.count} bill${list.count === 1 ? '' : 's'}` : undefined}
      actions={<Button to={`${cfg.base}/new`} icon={Plus}>{cfg.newLabel}</Button>}
      mobileActions={null}
      fab={<Fab><Button to={`${cfg.base}/new`} size="lg" icon={Plus} variant={kind === 'sale' ? 'danger' : 'primary'}>{cfg.newLabel}</Button></Fab>}
    >
      <div className="space-y-4">
        <SummaryCards
          items={[
            { label: cfg.totalWord, value: formatMoney(summary?.total ?? 0, { decimals: 'auto' }), sub: `${summary?.count ?? 0} bills` },
            { label: cfg.paidWord, value: formatMoney(summary?.paid ?? 0, { decimals: 'auto' }), tone: 'text-pos' },
            { label: 'Pending', value: formatMoney(summary?.pending ?? 0, { decimals: 'auto' }), tone: 'text-neg' },
          ]}
        />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <SearchInput className="lg:max-w-sm lg:flex-1" value={search} onChange={setSearch} placeholder={`Search bill no., ${cfg.party.toLowerCase()}, mobile or item`} />
          <DateRangePicker from={params.get('from') || ''} to={params.get('to') || ''} onChange={setRange} />
        </div>
        <Chips items={STATUS_OPTIONS} value={status} onChange={(value) => setParam('status', value)} />

        <div className={`card overflow-hidden transition-opacity ${list.isFetching && !list.isFetchingNextPage && list.rows.length ? 'opacity-60' : ''}`}>
          {list.isPending ? (
            <ListSkeleton rows={8} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={list.refetch} />
          ) : list.rows.length === 0 ? (
            filtered ? (
              <EmptyState icon={Icon} title="No bills found" message="Try a different search or filter." />
            ) : (
              <EmptyState
                icon={Icon}
                title={`${kind === 'sale' ? 'No sales' : 'No purchases'} ${rangeText(from, to)}`}
                message="Change the From / To dates to see other days."
                action={<Button to={`${cfg.base}/new`} icon={Plus}>{kind === 'sale' ? 'Create New Sale' : 'Create New Purchase'}</Button>}
              />
            )
          ) : (
            <>
              <div className="divide-y divide-line lg:hidden">
                {list.rows.map((bill) => <BillCardRow key={bill.id} kind={kind} bill={bill} menuItems={menuItems} />)}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <BillTable kind={kind} rows={list.rows} menuItems={menuItems} />
              </div>
              <LoadMore list={list} />
            </>
          )}
        </div>
      </div>
      {dialogs}
    </Page>
  )
}
