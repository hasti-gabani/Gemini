import { Badge } from '../../components/ui/misc.jsx'
import { formatDate } from '../../lib/dates.js'
import { formatMoney, formatQty, isNegative, isPositive } from '../../lib/money.js'

export const NUMERIC_TYPES = new Set(['money', 'balance', 'qty', 'number'])

export const isNumericColumn = (column) => NUMERIC_TYPES.has(column?.type)

export function isEmptyValue(value) {
  return value === null || value === undefined || value === ''
}

/** Font size that keeps an amount on one line in a half-width phone card (320px screens). */
export function amountTextSize(text) {
  const length = String(text ?? '').length
  if (length <= 12) return 'text-[15px]'
  if (length <= 14) return 'text-sm'
  return 'text-[13px]'
}

/** "Total (₹)" -> "Total" for compact labels on cards. */
export function shortLabel(label = '') {
  return label.replace(/\s*\(₹\)\s*$/, '').trim()
}

/** Signed balance: positive = receivable (Dr), negative = payable (Cr). */
export function balanceInfo(value) {
  if (isPositive(value)) return { side: 'Dr', word: 'Receivable', tone: 'text-pos' }
  if (isNegative(value)) return { side: 'Cr', word: 'Payable', tone: 'text-neg' }
  return { side: '', word: 'Settled', tone: 'text-ink' }
}

export function formatBalance(value, options = {}) {
  if (isEmptyValue(value)) return ''
  const { side } = balanceInfo(value)
  return `${formatMoney(value, { absolute: true, ...options })}${side ? ` ${side}` : ''}`
}

/** Plain-text value for a column type (used for cards, titles and totals). */
export function formatValue(value, type) {
  if (isEmptyValue(value)) return ''
  switch (type) {
    case 'date':
      return formatDate(value)
    case 'money':
      return formatMoney(value)
    case 'balance':
      return formatBalance(value)
    case 'qty':
      return formatQty(value)
    case 'number':
      return Number(value).toLocaleString('en-IN')
    default:
      return String(value)
  }
}

const STATUS_TONES = {
  paid: 'pos',
  partial: 'warn',
  unpaid: 'neg',
  'low stock': 'warn',
  'out of stock': 'neg',
}

export function statusTone(value) {
  return STATUS_TONES[String(value || '').trim().toLowerCase()] || 'neutral'
}

/** Rendered table cell content. */
export function CellValue({ column, value }) {
  if (isEmptyValue(value)) return null
  if (column.type === 'balance') {
    const { side, tone } = balanceInfo(value)
    return (
      <span className={`whitespace-nowrap ${tone}`}>
        {formatMoney(value, { absolute: true })}
        {side && <span className="ml-1 text-xs font-semibold">{side}</span>}
      </span>
    )
  }
  if (column.key === 'status' && column.type === 'text') {
    return <Badge tone={statusTone(value)}>{value}</Badge>
  }
  if (column.type === 'multiline') {
    return <span className="whitespace-pre-line">{value}</span>
  }
  const text = formatValue(value, column.type)
  return isNumericColumn(column) || column.type === 'date' ? <span className="whitespace-nowrap">{text}</span> : text
}
