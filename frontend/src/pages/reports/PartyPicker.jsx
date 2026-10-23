import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import Modal from '../../components/ui/Modal.jsx'
import { Avatar, ErrorState, ListSkeleton, SearchInput, Spinner } from '../../components/ui/misc.jsx'
import { api } from '../../lib/api.js'
import { useDebounced } from '../../lib/hooks.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'

const PAGE_SIZE = 20

function BalanceLabel({ balance }) {
  if (isPositive(balance)) {
    return (
      <span className="flex flex-col items-end">
        <span className="num text-sm font-semibold text-pos">{formatMoney(balance)}</span>
        <span className="text-xs text-ink-3">Receivable</span>
      </span>
    )
  }
  if (isNegative(balance)) {
    return (
      <span className="flex flex-col items-end">
        <span className="num text-sm font-semibold text-neg">{formatMoney(balance, { absolute: true })}</span>
        <span className="text-xs text-ink-3">Payable</span>
      </span>
    )
  }
  return <span className="text-xs text-ink-3">Settled</span>
}

/**
 * Searchable party list in a bottom sheet (phones) / dialog (desktop).
 * `params` narrows the list, e.g. { type: 'customer' } or { filter: 'receivable' }.
 * `allLabel` adds a first "All parties" row that selects `null`.
 */
export default function PartyPickerModal({
  open, onClose, onSelect, title = 'Choose party', params, selectedId, allLabel, searchPlaceholder = 'Search name, mobile or city',
  emptyMessage = 'No parties found.',
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  const query = useQuery({
    queryKey: ['party-picker', params, debounced],
    queryFn: ({ signal }) => api.get('/parties/', { ...params, search: debounced, page_size: PAGE_SIZE }, { signal }),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const parties = query.data?.results || []
  const count = query.data?.count ?? 0
  const stale = query.isPlaceholderData

  const choose = (party) => {
    onSelect(party)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="md" fullHeight bodyClassName="pt-0">
      <form
        role="search"
        className="sticky top-0 z-10 -mx-5 bg-card px-5 pb-3 pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!stale && parties.length > 0) choose(parties[0])
        }}
      >
        <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} autoFocus />
      </form>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !query.data ? (
        <div className="-mx-5"><ListSkeleton rows={6} /></div>
      ) : (
        <ul className={`-mx-5 divide-y divide-line transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={query.isFetching || undefined}>
          {allLabel && !debounced && (
            <li>
              <button
                type="button"
                onClick={() => choose(null)}
                className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-muted active:bg-subtle"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-ink-2">
                  <Users className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1 font-medium text-ink">{allLabel}</span>
                {!selectedId && <Check className="size-5 shrink-0 text-brand" aria-label="Selected" />}
              </button>
            </li>
          )}
          {parties.map((party) => {
            const selected = String(party.id) === String(selectedId)
            const meta = [party.phone, party.city].filter(Boolean).join(' · ')
            return (
              <li key={party.id}>
                <button
                  type="button"
                  onClick={() => choose(party)}
                  aria-current={selected || undefined}
                  className={`flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-muted active:bg-subtle ${selected ? 'bg-brand-soft' : ''}`}
                >
                  <Avatar name={party.name} className="size-9 text-xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{party.name}</span>
                    {meta && <span className="block truncate text-sm text-ink-3">{meta}</span>}
                  </span>
                  <BalanceLabel balance={party.balance} />
                  {selected && <Check className="size-5 shrink-0 text-brand" aria-label="Selected" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {query.data && parties.length === 0 && !stale && (
        <p className="px-2 py-10 text-center text-[15px] text-ink-3">
          {debounced ? `No results for “${debounced}”.` : emptyMessage}
        </p>
      )}
      {query.data && count > parties.length && (
        <p className="flex items-center justify-center gap-2 py-4 text-center text-sm text-ink-3">
          {query.isFetching && <Spinner className="size-4" />}
          Showing {parties.length} of {count} — type to narrow down.
        </p>
      )}
    </Modal>
  )
}
