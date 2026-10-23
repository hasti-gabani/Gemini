import { ArrowDownLeft, ArrowUpRight, BellRing, Eye, FileText, Pencil, Plus, ReceiptText, Trash2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import Page, { Fab } from '../../components/layout/Page.jsx'
import RemindDialog from '../../components/RemindDialog.jsx'
import Button from '../../components/ui/Button.jsx'
import { PARTY_DELETE_MESSAGE } from './partyDelete.js'
import { Checkbox, Select } from '../../components/ui/form.jsx'
import {
  Avatar, Chips, EmptyState, ErrorState, ListSkeleton, LoadMore, SearchInput, Tabs,
} from '../../components/ui/misc.jsx'
import SelectionBar from '../../components/ui/SelectionBar.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDateMedium } from '../../lib/dates.js'
import { useDebounced, useInvalidateAll, usePagedList } from '../../lib/hooks.js'
import { gujarati } from '../../lib/i18n.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'
import { RowMenu } from '../bills/BillShared.jsx'

const ORDERINGS = [
  { value: 'amount', label: 'Highest amount' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: '-balance', label: 'Highest receivable' },
  { value: 'balance', label: 'Highest payable' },
  { value: '-last_txn_date', label: 'Recent activity' },
  { value: '-created_at', label: 'Recently added' },
]

export function BalanceLabel({ balance, className = '' }) {
  const positive = isPositive(balance)
  const negative = isNegative(balance)
  return (
    <div className={`text-right ${className}`}>
      <p className={`num text-[15px] font-semibold ${positive ? 'text-pos' : negative ? 'text-neg' : 'text-ink-2'}`}>
        {formatMoney(balance, { absolute: true, decimals: 'auto' })}
      </p>
      {(positive || negative) && (
        <p className={`text-xs ${positive ? 'text-pos' : 'text-neg'}`}>{positive ? "You'll Get" : "You'll Give"}</p>
      )}
    </div>
  )
}

export default function PartyList() {
  const { t, language } = useSession()
  const { confirm, toast } = useUI()
  const invalidate = useInvalidateAll()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') || '')
  const [remindParty, setRemindParty] = useState(null)
  const debounced = useDebounced(search.trim(), 300)
  const type = params.get('type') || ''
  const filter = params.get('filter') || ''
  const ordering = params.get('ordering') || 'amount' // highest amount first by default

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const list = usePagedList(['parties'], '/parties/', { search: debounced, type, filter, ordering }, { pageSize: 40 })
  const summary = list.summary

  const remove = async (party) => {
    const ok = await confirm({ title: `Delete ${party.name}?`, message: PARTY_DELETE_MESSAGE, confirmText: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await api.del(`/parties/${party.id}/`)
      invalidate()
      toast.success(`${party.name} deleted.`)
    } catch (error) {
      toast.error(error)
    }
  }

  // Ticked parties, to delete several in one go. Ticks are cleared when the list changes underneath.
  const [picked, setPicked] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const selected = list.rows.filter((party) => picked.has(party.id))
  const toggle = (id, checked) => {
    const next = new Set(picked)
    if (checked) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  const removeSelected = async () => {
    const names = selected.slice(0, 3).map((party) => party.name).join(', ')
    const more = selected.length - 3
    const ok = await confirm({
      title: `Delete ${selected.length} ${selected.length === 1 ? 'party' : 'parties'}?`,
      message: `${names}${more > 0 ? ` and ${more} more` : ''} will be removed, together with all their bills and payments. Stock and cash/bank balances are corrected automatically. This cannot be undone.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    try {
      const result = await api.post('/parties/bulk-delete/', { ids: selected.map((party) => party.id) })
      const kept = result.kept || []
      invalidate()
      setPicked(new Set())
      if (!result.deleted) toast.error(kept[0]?.reason || 'Nothing was deleted.')
      else if (kept.length) toast.success(`${result.deleted} deleted · ${kept.length} kept: ${kept[0].reason}`)
      else toast.success(`${result.deleted} ${result.deleted === 1 ? 'party' : 'parties'} deleted.`)
    } catch (error) {
      toast.error(error)
    } finally {
      setDeleting(false)
    }
  }

  const menuItems = (party) => [
    { label: 'Open', icon: Eye, to: `/parties/${party.id}` },
    { label: 'Statement', icon: FileText, to: `/parties/${party.id}?tab=statement` },
    { label: isNegative(party.balance) ? 'Make Payment' : 'Take Payment', icon: isNegative(party.balance) ? ArrowUpRight : ArrowDownLeft, to: isNegative(party.balance) ? `/payments-out/new?party=${party.id}` : `/payments-in/new?party=${party.id}` },
    { label: 'New Sale', icon: ReceiptText, to: `/sales/new?party=${party.id}` },
    { label: 'Remind', icon: BellRing, hidden: !isPositive(party.balance), onClick: () => setRemindParty(party) },
    { label: 'Edit', icon: Pencil, to: `/parties/${party.id}/edit` },
    { divider: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(party) },
  ]

  const filtered = Boolean(debounced || filter || type)

  return (
    <Page
      title={t('parties')}
      subtitle={summary ? `${summary.count} parties` : undefined}
      actions={<Button to="/parties/new" icon={UserPlus}>{t('add_party')}</Button>}
      mobileActions={null}
      fab={<Fab><Button to="/parties/new" size="lg" icon={Plus}>New Party</Button></Fab>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setParam('filter', filter === 'receivable' ? '' : 'receivable')} className={`card flex items-center gap-3 p-3.5 text-left transition hover:border-line-strong ${filter === 'receivable' ? 'ring-2 ring-pos/40' : ''}`}>
            <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-pos-soft text-pos sm:grid"><ArrowDownLeft className="size-5" /></span>
            <span className="min-w-0">
              <span className="block text-sm text-ink-2">{t('you_will_get')}</span>
              {language === 'en' && <span className="block text-xs text-ink-3">{gujarati('you_will_get')}</span>}
              <span className="block text-lg font-bold leading-tight text-pos">{formatMoney(summary?.receivable ?? 0, { decimals: 'auto' })}</span>
            </span>
          </button>
          <button type="button" onClick={() => setParam('filter', filter === 'payable' ? '' : 'payable')} className={`card flex items-center gap-3 p-3.5 text-left transition hover:border-line-strong ${filter === 'payable' ? 'ring-2 ring-neg/40' : ''}`}>
            <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-neg-soft text-neg sm:grid"><ArrowUpRight className="size-5" /></span>
            <span className="min-w-0">
              <span className="block text-sm text-ink-2">{t('you_will_give')}</span>
              {language === 'en' && <span className="block text-xs text-ink-3">{gujarati('you_will_give')}</span>}
              <span className="block text-lg font-bold leading-tight text-neg">{formatMoney(summary?.payable ?? 0, { decimals: 'auto' })}</span>
            </span>
          </button>
        </div>

        <Tabs
          value={type}
          onChange={(value) => setParam('type', value)}
          items={[{ value: '', label: 'All' }, { value: 'customer', label: 'Customers' }, { value: 'supplier', label: 'Suppliers' }]}
        />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput className="lg:max-w-md lg:flex-1" value={search} onChange={setSearch} placeholder="Search name, mobile or bill number" />
          <Select aria-label="Sort" className="h-10 text-sm lg:w-52" value={ordering} onChange={(e) => setParam('ordering', e.target.value === 'amount' ? '' : e.target.value)} options={ORDERINGS} />
        </div>
        <Chips
          value={filter}
          onChange={(value) => setParam('filter', value)}
          items={[
            { value: '', label: 'All', count: summary?.count },
            { value: 'receivable', label: 'Receivable', count: summary?.count_receivable },
            { value: 'payable', label: 'Payable', count: summary?.count_payable },
            { value: 'zero', label: 'Zero Balance', count: summary?.count_zero },
          ]}
        />

        <div className={`card overflow-hidden transition-opacity ${list.isFetching && !list.isFetchingNextPage && list.rows.length ? 'opacity-60' : ''}`}>
          {list.isPending ? (
            <ListSkeleton rows={10} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={list.refetch} />
          ) : list.rows.length === 0 ? (
            filtered ? (
              <EmptyState icon={Users} title="No parties found" message="Try another name, mobile number or bill number." />
            ) : (
              <EmptyState icon={Users} title="No parties added yet" message="Create your first party to start billing." action={<Button to="/parties/new" icon={UserPlus}>Create your first party</Button>} />
            )
          ) : (
            <>
              <SelectionBar
                allChecked={selected.length > 0 && selected.length === list.rows.length}
                onToggleAll={(checked) => setPicked(checked ? new Set(list.rows.map((party) => party.id)) : new Set())}
                count={selected.length}
                busy={deleting}
                actions={(
                  <>
                    <Button variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                    <Button variant="danger" icon={Trash2} loading={deleting} onClick={removeSelected}>Delete ({selected.length})</Button>
                  </>
                )}
              />
              <ul className="divide-y divide-line lg:hidden">
                {list.rows.map((party) => (
                  <li key={party.id} className={`flex items-stretch ${picked.has(party.id) ? 'bg-brand-soft/40' : ''}`}>
                    <span className="flex items-center pl-4">
                      {/* the padding makes a 44px tap target around the 20px box */}
                      <Checkbox
                        checked={picked.has(party.id)}
                        onChange={(checked) => toggle(party.id, checked)}
                        ariaLabel={`Select ${party.name}`}
                        className="-m-3 p-3"
                      />
                    </span>
                    <Link to={`/parties/${party.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-3 pr-2 transition hover:bg-muted max-[360px]:flex-col max-[360px]:items-start max-[360px]:gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 break-words text-[16px] font-medium text-ink">{party.name}</p>
                        <p className="break-words text-sm text-ink-3">
                          {party.last_txn_date ? formatDateMedium(party.last_txn_date) : party.phone || (party.party_type === 'supplier' ? 'Supplier' : 'No transactions yet')}
                        </p>
                      </div>
                      <BalanceLabel balance={party.balance} className="max-[360px]:flex max-[360px]:items-baseline max-[360px]:gap-2 max-[360px]:text-left" />
                    </Link>
                    <div className="flex items-center pr-2"><RowMenu items={menuItems(party)} label={`Actions for ${party.name}`} /></div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[760px] text-[15px]">
                  <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
                    <tr>
                      <th className="w-10" />
                      <th className="px-4 py-2.5">Party Name</th>
                      <th className="px-3 py-2.5">Mobile</th>
                      <th className="px-3 py-2.5 text-right">Receivable</th>
                      <th className="px-3 py-2.5 text-right">Payable</th>
                      <th className="px-3 py-2.5">Last Transaction</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.rows.map((party) => (
                      <tr key={party.id} className={`cursor-pointer transition hover:bg-muted ${picked.has(party.id) ? 'bg-brand-soft/40' : ''}`} onClick={() => navigate(`/parties/${party.id}`)}>
                        <td className="pl-4" onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={picked.has(party.id)}
                            onChange={(checked) => toggle(party.id, checked)}
                            ariaLabel={`Select ${party.name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={party.name} className="size-9 text-xs" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink">{party.name}</p>
                              <p className="text-xs capitalize text-ink-3">{party.party_type === 'both' ? 'Customer & Supplier' : party.party_type}{party.city ? ` · ${party.city}` : ''}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-ink-2">{party.phone || '—'}</td>
                        <td className="num px-3 py-3 text-right font-semibold text-pos">{isPositive(party.receivable) ? formatMoney(party.receivable) : <span className="font-normal text-ink-3">—</span>}</td>
                        <td className="num px-3 py-3 text-right font-semibold text-neg">{isPositive(party.payable) ? formatMoney(party.payable) : <span className="font-normal text-ink-3">—</span>}</td>
                        <td className="px-3 py-3 text-ink-2">{party.last_txn_date ? formatDateMedium(party.last_txn_date) : '—'}</td>
                        <td className="px-2 py-3" onClick={(event) => event.stopPropagation()}><RowMenu items={menuItems(party)} label={`Actions for ${party.name}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <LoadMore list={list} />
            </>
          )}
        </div>
      </div>
      <RemindDialog open={Boolean(remindParty)} onClose={() => setRemindParty(null)} party={remindParty} />
    </Page>
  )
}
