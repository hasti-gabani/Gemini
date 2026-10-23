import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, User, X } from 'lucide-react'
import { useState } from 'react'

import Button from '../../components/ui/Button.jsx'
import DayPicker from '../../components/ui/DayPicker.jsx'
import { Segmented, Select } from '../../components/ui/form.jsx'
import { Spinner } from '../../components/ui/misc.jsx'
import { api } from '../../lib/api.js'
import { todayISO } from '../../lib/dates.js'
import PartyPickerModal from './PartyPicker.jsx'
import {
  DIRECTION_OPTIONS, GROUP_OPTIONS, STATUS_OPTIONS, STOCK_OPTIONS, VIEW_OPTIONS, hasActiveFilters,
} from './reportMeta.js'

// half width on phones (grows to fill a line when alone), fixed width on desktop
const HALF = 'h-11 min-w-0 grow basis-[calc(50%-0.25rem)] lg:grow-0 lg:basis-auto'

/** Every report shows one day (the `date` URL param, today when absent). */
function DayFilter({ searchParams, onChange }) {
  return (
    <DayPicker
      label="Report date"
      value={searchParams.get('date') || ''}
      max={todayISO()}
      onChange={(value) => onChange({ date: value || null })}
    />
  )
}

function PartyFilter({ kind, value, onChange }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const word = kind === 'supplier' ? 'supplier' : 'party'
  const party = useQuery({
    queryKey: ['report-party', value],
    queryFn: ({ signal }) => api.get(`/parties/${value}/`, undefined, { signal }),
    select: (data) => data?.name || '',
    enabled: Boolean(value),
    staleTime: 5 * 60_000,
  })
  const allLabel = kind === 'supplier' ? 'All suppliers' : 'All parties'
  const label = !value ? allLabel : party.data || (party.isError ? `Unknown ${word}` : 'Loading…')

  return (
    <div className="relative w-full lg:w-64">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={value ? `${kind === 'supplier' ? 'Supplier' : 'Party'}: ${label}. Change` : `Filter by ${word}`}
        className={`field flex h-11 items-center gap-2 text-left ${value ? 'pr-12' : ''}`}
      >
        <User className="size-[18px] shrink-0 text-ink-3" aria-hidden />
        <span className={`min-w-0 flex-1 truncate ${value ? 'font-medium text-ink' : 'text-ink-2'}`}>{label}</span>
        {!value && <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />}
      </button>
      {value && (
        <button
          type="button"
          aria-label={`Clear ${word}`}
          onClick={() => onChange({ party: null })}
          className="absolute right-0.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition hover:bg-subtle hover:text-ink"
        >
          <X className="size-4" />
        </button>
      )}
      <PartyPickerModal
        open={open}
        onClose={() => setOpen(false)}
        title={`Choose ${word}`}
        params={{ type: kind }}
        selectedId={value}
        allLabel={allLabel}
        emptyMessage={kind === 'supplier' ? 'No suppliers yet.' : 'No parties yet.'}
        onSelect={(picked) => {
          if (picked) queryClient.setQueryData(['report-party', String(picked.id)], { id: picked.id, name: picked.name })
          onChange({ party: picked ? String(picked.id) : null })
        }}
      />
    </div>
  )
}

function withCurrent(options, value, loading) {
  if (!value || options.some((option) => option.value === value)) return options
  return [...options, { value, label: loading ? 'Loading…' : 'Not found' }]
}

function AccountFilter({ bankOnly, value, onChange }) {
  const accounts = useQuery({
    queryKey: ['report-accounts'],
    queryFn: ({ signal }) => api.get('/accounts/', undefined, { signal }),
    staleTime: 60_000,
  })
  const options = (accounts.data?.results || [])
    .filter((account) => !bankOnly || account.kind === 'bank')
    .map((account) => ({ value: String(account.id), label: account.name }))
  return (
    <Select
      aria-label={bankOnly ? 'Bank account' : 'Cash or bank account'}
      placeholder={bankOnly ? 'All bank accounts' : 'All accounts'}
      options={withCurrent(options, value, accounts.isPending)}
      value={value}
      onChange={(event) => onChange({ account: event.target.value || null })}
      className={`${HALF} lg:w-56`}
    />
  )
}

function CategoryFilter({ value, onChange }) {
  const categories = useQuery({
    queryKey: ['report-categories'],
    queryFn: ({ signal }) => api.get('/categories/', undefined, { signal }),
    staleTime: 60_000,
  })
  const rows = Array.isArray(categories.data) ? categories.data : categories.data?.results || []
  const options = rows.map((category) => ({ value: String(category.id), label: category.name }))
  return (
    <Select
      aria-label="Item category"
      placeholder="All categories"
      options={withCurrent(options, value, categories.isPending)}
      value={value}
      onChange={(event) => onChange({ category: event.target.value || null })}
      className={`${HALF} lg:w-52`}
    />
  )
}

function FilterControl({ name, searchParams, onChange }) {
  const value = (param) => searchParams.get(param) || ''
  switch (name) {
    case 'period':
    case 'date':
      return <DayFilter searchParams={searchParams} onChange={onChange} />
    case 'customer':
    case 'supplier':
      return <PartyFilter kind={name} value={value('party')} onChange={onChange} />
    case 'account':
    case 'bank_account':
      return <AccountFilter bankOnly={name === 'bank_account'} value={value('account')} onChange={onChange} />
    case 'category':
      return <CategoryFilter value={value('category')} onChange={onChange} />
    case 'status':
      return (
        <Select
          aria-label="Payment status"
          placeholder="All bills"
          options={STATUS_OPTIONS}
          value={value('status')}
          onChange={(event) => onChange({ status: event.target.value || null })}
          className={`${HALF} lg:w-60`}
        />
      )
    case 'group':
      return (
        <Segmented
          options={GROUP_OPTIONS}
          value={value('group') === 'day' ? 'day' : 'month'}
          onChange={(next) => onChange({ group: next === 'day' ? 'day' : null })}
        />
      )
    case 'view':
      return (
        <Segmented
          options={VIEW_OPTIONS}
          value={value('view') === 'bill' ? 'bill' : 'party'}
          onChange={(next) => onChange({ view: next === 'bill' ? 'bill' : null })}
        />
      )
    case 'direction':
      return <Segmented options={DIRECTION_OPTIONS} value={value('direction')} onChange={(next) => onChange({ direction: next || null })} />
    case 'stock':
      return <Segmented options={STOCK_OPTIONS} value={value('stock')} onChange={(next) => onChange({ stock: next || null })} />
    default:
      return null
  }
}

const FIRST = ['period', 'date']

/** One wrapping row of filters built from the report definition; values live in the URL. */
export default function ReportFilters({ definition, searchParams, onChange, onClear, rangeError, busy }) {
  const filters = [...(definition.filters || [])].sort((a, b) => Number(!FIRST.includes(a)) - Number(!FIRST.includes(b)))
  if (!filters.length) return null
  const active = hasActiveFilters(searchParams, definition)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((name) => (
          <FilterControl key={name} name={name} searchParams={searchParams} onChange={onChange} />
        ))}
        {active && (
          <Button variant="ghost" size="sm" icon={X} onClick={onClear}>Clear filters</Button>
        )}
        {busy && <Spinner className="size-4" />}
      </div>
      {rangeError && <p className="text-sm text-neg" role="alert">{rangeError}</p>}
    </div>
  )
}
