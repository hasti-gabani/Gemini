import { useQuery } from '@tanstack/react-query'

import { Badge } from '../../components/ui/misc.jsx'
import { api } from '../../lib/api.js'
import { formatQty, fromScaled, toScaled } from '../../lib/money.js'

export const CATEGORIES_KEY = ['item-categories']

/** Categories are a plain array: [{ id, name, item_count }]. */
export function useCategories(options = {}) {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: ({ signal }) => api.get('/categories/', undefined, { signal }),
    staleTime: 60_000,
    ...options,
  })
}

/** "12.000" -> "12" for inputs; zero becomes an empty field. */
export function qtyInput(value) {
  return toScaled(value, 3) === 0n ? '' : formatQty(value)
}

export function moneyInput(value) {
  return toScaled(value, 2) === 0n ? '' : fromScaled(toScaled(value, 2), 2).replace(/\.00$/, '')
}

/** "+5", "−4", "0" for stock movements (true minus sign for display). */
export function signedQty(value) {
  const scaled = toScaled(value, 3)
  const abs = formatQty(fromScaled(scaled < 0n ? -scaled : scaled, 3))
  if (scaled > 0n) return `+${abs}`
  if (scaled < 0n) return `−${abs}`
  return abs
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

/** Item photo, or an initials tile when there is none. Decorative: the name is always shown next to it. */
export function ItemThumb({ item, className = 'size-11 rounded-xl text-sm' }) {
  if (item?.image_url) {
    return <img src={item.image_url} alt="" loading="lazy" className={`shrink-0 border border-line bg-muted object-cover ${className}`} />
  }
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center bg-brand-soft font-semibold text-brand-ink ${className}`}>
      {initials(item?.name)}
    </span>
  )
}

/** 'untracked' | 'out' | 'low' | 'in' */
export function stockState(item) {
  if (!item?.track_stock) return 'untracked'
  if (toScaled(item.current_stock, 3) <= 0n) return 'out'
  if (item.is_low_stock) return 'low'
  return 'in'
}

export function StockBadge({ item, className = '' }) {
  const state = stockState(item)
  if (state === 'out') return <Badge tone="neg" className={className}>Out of stock</Badge>
  if (state === 'low') return <Badge tone="warn" className={className}>Low stock</Badge>
  if (state === 'untracked') return <Badge className={className}>Not tracked</Badge>
  return <Badge tone="pos" className={className}>In stock</Badge>
}

const ICON_TONES = {
  default: 'text-ink-3 hover:text-ink',
  danger: 'text-neg',
  brand: 'text-brand-ink',
}

/** 44px icon-only button with an accessible label. */
export function IconButton({ icon: Icon, label, tone = 'default', danger = false, className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`grid size-11 shrink-0 place-items-center rounded-xl transition hover:bg-subtle disabled:pointer-events-none disabled:opacity-50 ${ICON_TONES[danger ? 'danger' : tone] || ICON_TONES.default} ${className}`}
      {...props}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  )
}
