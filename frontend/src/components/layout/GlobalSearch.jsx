import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft, ArrowUpRight, CornerDownLeft, Package, ReceiptText, Search, ShoppingCart, User, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { api } from '../../lib/api.js'
import { useDebounced } from '../../lib/hooks.js'
import { formatMoney } from '../../lib/money.js'
import { RECORD_LABELS, recordPath } from '../../lib/routes.js'
import { Badge, Spinner } from '../ui/misc.jsx'

const ICONS = {
  party: User, item: Package, sale: ReceiptText, purchase: ShoppingCart, payment_in: ArrowDownLeft,
  payment_out: ArrowUpRight,
}
const GROUP_ORDER = ['party', 'sale', 'payment_in', 'item', 'purchase', 'payment_out']
const GROUP_LABELS = {
  party: 'Parties', sale: 'Sale Bills', purchase: 'Purchase Bills', item: 'Items',
  payment_in: 'Payments In', payment_out: 'Payments Out',
}

/** Search parties, mobile numbers, bill/receipt numbers and items; Enter opens the record. */
export default function GlobalSearch({ open, onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const debounced = useDebounced(query.trim(), 250)

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => api.get('/search/', { q: debounced }, { signal }),
    enabled: open && debounced.length > 0,
    staleTime: 30_000,
  })

  const results = useMemo(() => {
    const list = search.data?.results || []
    return [...list].sort((a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type))
  }, [search.data])

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    setActive(0)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => {
      clearTimeout(timer)
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => setActive(0), [debounced])

  if (!open) return null

  const go = (result) => {
    const path = recordPath(result.type, result.id)
    if (path) {
      onClose()
      navigate(path)
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault()
      go(results[active])
    }
  }

  let lastGroup = null
  return createPortal(
    <div className="fixed inset-0 z-[75] flex justify-center sm:items-start sm:p-4 sm:pt-[10vh]" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 animate-fade-in bg-slate-950/45" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative flex h-full w-full animate-pop-in flex-col overflow-hidden bg-card shadow-pop sm:h-auto sm:max-h-[75vh] sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="safe-top flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <Search className="size-5 shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search party, mobile, bill no., item, receipt…"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            enterKeyHint="search"
            autoComplete="off"
            aria-autocomplete="list"
          />
          {search.isFetching && <Spinner className="size-4" />}
          <button type="button" onClick={onClose} aria-label="Close search" className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-thin" role="listbox">
          {!debounced && (
            <div className="px-5 py-10 text-center text-[15px] text-ink-3">
              Type a name, mobile number, bill number (e.g. <span className="font-medium text-ink-2">Bil.12</span>),
              purchase number, receipt number or item.
            </div>
          )}
          {debounced && !search.isFetching && results.length === 0 && (
            <div className="px-5 py-10 text-center text-[15px] text-ink-3">No results for “{debounced}”.</div>
          )}
          {results.map((result, index) => {
            const Icon = ICONS[result.type] || Search
            const header = result.type !== lastGroup ? GROUP_LABELS[result.type] : null
            lastGroup = result.type
            return (
              <div key={`${result.type}-${result.id}`}>
                {header && (
                  <div className="sticky top-0 bg-muted px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{header}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(result)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${index === active ? 'bg-brand-soft' : 'hover:bg-muted'}`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-ink-2">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{result.title}</span>
                    <span className="block truncate text-sm text-ink-3">{result.subtitle || RECORD_LABELS[result.type]}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {result.type !== 'payment_in' && result.type !== 'payment_out' && result.badge && (
                      <Badge tone={/paid$/i.test(result.badge) && !/unpaid/i.test(result.badge) ? 'pos' : /receivable|unpaid|low/i.test(result.badge) ? 'neg' : 'neutral'}>{result.badge}</Badge>
                    )}
                    <span className="num text-sm text-ink-2">{formatMoney(result.amount)}</span>
                  </span>
                  {index === active && <CornerDownLeft className="hidden size-4 text-ink-3 sm:block" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
