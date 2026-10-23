import { AlertCircle, ChevronRight, Loader2, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'

import { useOnVisible } from '../../lib/hooks.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'
import Button from './Button.jsx'

export function Spinner({ className = 'size-5' }) {
  return <Loader2 className={`animate-spin text-brand ${className}`} aria-label="Loading" />
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status">
      <div className="flex flex-col items-center gap-3 text-sm text-ink-3">
        <Spinner className="size-7" />
        {label}
      </div>
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-subtle ${className}`} aria-hidden />
}

export function ListSkeleton({ rows = 6 }) {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry, className = '' }) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`} role="alert">
      <div className="grid size-12 place-items-center rounded-full bg-neg-soft text-neg">
        <AlertCircle className="size-6" />
      </div>
      <p className="max-w-sm text-[15px] text-ink-2">{error?.message || 'Something went wrong.'}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, message, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      {Icon && (
        <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand-ink">
          <Icon className="size-8" strokeWidth={1.75} />
        </div>
      )}
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-[15px] text-ink-3">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

const BADGE_TONES = {
  neutral: 'bg-subtle text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
}

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ status, overdue, className = '' }) {
  if (overdue && status !== 'paid') return <Badge tone="neg" className={className}>Overdue</Badge>
  if (status === 'paid') return <Badge tone="pos" className={className}>Paid</Badge>
  if (status === 'partial') return <Badge tone="warn" className={className}>Partial</Badge>
  return <Badge tone="neg" className={className}>Unpaid</Badge>
}

/**
 * Formatted amount. tone: 'auto' = green when positive (receivable), red when negative (payable).
 */
export function Amount({ value, tone = 'none', absolute = false, decimals = 2, className = '', symbol = '₹' }) {
  let color = ''
  if (tone === 'auto') color = isPositive(value) ? 'text-pos' : isNegative(value) ? 'text-neg' : 'text-ink'
  else if (tone === 'pos') color = 'text-pos'
  else if (tone === 'neg') color = 'text-neg'
  else if (tone === 'muted') color = 'text-ink-3'
  return <span className={`num whitespace-nowrap ${color} ${className}`}>{formatMoney(value ?? 0, { absolute, decimals, symbol })}</span>
}

/** One-line amount that gets a smaller font instead of being cut off when its card is narrow. */
export function FitAmount({ children, className = '', minSize = 11, as: Tag = 'p' }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let width = -1
    let active = true
    const fit = (force) => {
      if (!active || (!force && el.clientWidth === width)) return
      width = el.clientWidth
      el.style.fontSize = ''
      if (!width || el.scrollWidth <= width) return
      let size = parseFloat(getComputedStyle(el).fontSize)
      size = Math.max(minSize, Math.floor((size * width * 10) / el.scrollWidth) / 10)
      el.style.fontSize = `${size}px`
      while (el.scrollWidth > width && size > minSize) {
        size = Math.max(minSize, size - 0.5)
        el.style.fontSize = `${size}px`
      }
    }
    fit(true)
    const observer = new ResizeObserver(() => fit(false))
    observer.observe(el)
    document.fonts?.ready.then(() => fit(true))
    return () => {
      active = false
      observer.disconnect()
    }
  }, [children, minSize])
  return <Tag ref={ref} className={`num block overflow-hidden whitespace-nowrap ${className}`}>{children}</Tag>
}

/** Total cards above a list. On phones the first card is full width and the others sit two in a row. */
export function SummaryCards({ items }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item, index) => (
        <div key={item.label} className={`card min-w-0 p-3.5 ${index === 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
          <p className="truncate text-sm text-ink-3">{item.label}</p>
          <FitAmount className={`mt-0.5 text-lg font-semibold tracking-tight ${item.tone || 'text-ink'}`}>{item.value}</FitAmount>
          {item.sub && <p className="truncate text-xs text-ink-3">{item.sub}</p>}
        </div>
      ))}
    </div>
  )
}

export function Tabs({ items, value, onChange, className = '' }) {
  return (
    <div className={`no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 ${className}`} role="tablist">
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={`relative flex shrink-0 items-center gap-1.5 px-2 pb-2.5 pt-2 text-sm font-medium transition xs:px-3 xs:text-[15px] ${selected ? 'text-brand-ink' : 'text-ink-3 hover:text-ink'}`}
          >
            {item.icon && <item.icon className="size-4" />}
            {item.label}
            {item.count !== undefined && item.count !== null && (
              <span className={`rounded-full px-1.5 text-xs ${selected ? 'bg-brand-soft' : 'bg-subtle'}`}>{item.count}</span>
            )}
            {selected && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand" />}
          </button>
        )
      })}
    </div>
  )
}

/** Filter chips (horizontally scrollable on phones). */
export function Chips({ items, value, onChange, className = '' }) {
  return (
    <div className={`no-scrollbar flex gap-2 overflow-x-auto ${className}`}>
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(item.value)}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition ${selected ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-card text-ink-2 hover:border-line-strong'}`}
          >
            {item.label}
            {item.count !== undefined && <span className="text-xs opacity-75">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search', className = '', autoFocus, inputRef }) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" />
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="field pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/**
 * Dropdown menu. items: [{label, icon, onClick, to, danger, hidden, divider}]
 * Rendered in a portal with fixed positioning so it is never clipped by scrolling or
 * `overflow-hidden` containers (cards, tables, dialogs); flips upwards near the bottom.
 */
export function Menu({ trigger, items, align = 'right', className = '' }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const anchorRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (anchorRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return undefined
    }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      const menu = menuRef.current
      if (!anchor || !menu) return
      const width = menu.offsetWidth
      const height = menu.offsetHeight
      let left = align === 'right' ? anchor.right - width : anchor.left
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      let top = anchor.bottom + 6
      if (top + height > window.innerHeight - 8 && anchor.top - height - 6 > 8) top = anchor.top - height - 6
      setPosition({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  const visible = items.filter((item) => item && !item.hidden)
  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
          className="z-[90] min-w-52 max-w-[calc(100vw-16px)] animate-pop-in overflow-hidden rounded-xl border border-line bg-card py-1.5 shadow-pop"
        >
          {visible.map((item, index) => {
            if (item.divider) return <div key={`d${index}`} className="my-1.5 border-t border-line" />
            const classes = `flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[15px] transition hover:bg-subtle ${item.danger ? 'text-neg' : 'text-ink'}`
            const content = (
              <>
                {item.icon && <item.icon className={`size-[18px] ${item.danger ? '' : 'text-ink-3'}`} />}
                <span className="flex-1">{item.label}</span>
              </>
            )
            if (item.to) {
              return <Link key={item.label} to={item.to} role="menuitem" className={classes} onClick={() => setOpen(false)}>{content}</Link>
            }
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={classes}
                onClick={() => {
                  setOpen(false)
                  item.onClick?.()
                }}
              >
                {content}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Infinite-list footer: auto-loads when visible, with a manual button as fallback. */
export function LoadMore({ list }) {
  const ref = useOnVisible(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage()
  }, Boolean(list.hasNextPage))
  if (!list.hasNextPage) return null
  return (
    <div ref={ref} className="flex justify-center py-4">
      <Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
        Load more
      </Button>
    </div>
  )
}

export function SectionHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink sm:text-lg">{title}</h2>
        {subtitle && <p className="text-sm text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function LinkRow({ to, onClick, children, className = '', chevron = true }) {
  const classes = `flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-muted active:bg-subtle ${className}`
  const body = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      {chevron && <ChevronRight className="size-4 shrink-0 text-ink-3" />}
    </>
  )
  if (to) return <Link to={to} className={classes}>{body}</Link>
  return <button type="button" onClick={onClick} className={classes}>{body}</button>
}

export function KeyValue({ label, children, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-2 ${className}`}>
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] text-ink">{children}</dd>
    </div>
  )
}

export function Avatar({ name = '', className = 'size-10 text-sm' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{ backgroundColor: `hsl(${hash} 55% 45%)` }}
      aria-hidden
    >
      {initials}
    </div>
  )
}
