import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, Boxes, CalendarDays, CalendarRange, Coins, FileText,
  HandCoins, Landmark, Package, PackageOpen, ReceiptText, ShoppingCart, Truck, UserRound, Users, Wallet,
} from 'lucide-react'

import { api } from '../../lib/api.js'
import { todayISO } from '../../lib/dates.js'

/**
 * Reports offered in the app. The owner asked to keep only the Day Book (રોજમેળ); the server still
 * has the other reports, so one can be brought back by adding its key here.
 */
export const OFFERED_REPORTS = ['day_book']

/** Report definitions never change while the app is open. Shared by the hub and the report screen. */
export const DEFINITIONS_QUERY = {
  queryKey: ['report-definitions'],
  queryFn: ({ signal }) => api.get('/reports/', undefined, { signal }),
  select: (data) => ({ ...data, results: (data?.results || []).filter((definition) => OFFERED_REPORTS.includes(definition.key)) }),
  staleTime: Infinity,
}

const TONES = {
  brand: 'bg-brand-soft text-brand-ink',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-subtle text-ink-2',
}

const GROUP_META = {
  'Day Book': { icon: BookOpen, tone: 'brand', gu: 'રોજમેળ' },
  Sales: { icon: ReceiptText, tone: 'brand', gu: 'વેચાણ' },
  Purchase: { icon: ShoppingCart, tone: 'warn', gu: 'ખરીદી' },
  Payments: { icon: Wallet, tone: 'pos', gu: 'પેમેન્ટ' },
  'Cash & Bank': { icon: Landmark, tone: 'neutral', gu: 'રોકડ અને બેંક' },
  Parties: { icon: Users, tone: 'brand', gu: 'પાર્ટી' },
  Items: { icon: Package, tone: 'warn', gu: 'વસ્તુઓ' },
}

const REPORT_META = {
  day_book: { icon: BookOpen },
  sales: { icon: ReceiptText },
  daily_sales: { icon: CalendarDays },
  monthly_sales: { icon: CalendarRange },
  purchases: { icon: ShoppingCart },
  monthly_purchases: { icon: CalendarRange },
  payments_in: { icon: ArrowDownLeft, tone: 'pos' },
  payments_out: { icon: ArrowUpRight, tone: 'neg' },
  bank: { icon: Landmark },
  cash: { icon: Wallet },
  bank_transactions: { icon: ArrowLeftRight },
  customer_statement: { icon: UserRound },
  supplier_statement: { icon: Truck },
  receivables: { icon: HandCoins, tone: 'pos' },
  payables: { icon: Coins, tone: 'neg' },
  item_sales: { icon: Package },
  item_purchases: { icon: PackageOpen },
  stock_summary: { icon: Boxes },
}

export function groupMeta(group) {
  const meta = GROUP_META[group] || { icon: FileText, tone: 'neutral', gu: '' }
  return { ...meta, toneClass: TONES[meta.tone] }
}

/** Icon + colour for a report tile; falls back to its group so new backend reports still look right. */
export function reportMeta(definition) {
  const group = groupMeta(definition?.group)
  const own = REPORT_META[definition?.key] || {}
  return { icon: own.icon || group.icon, toneClass: TONES[own.tone || group.tone] || TONES.neutral }
}

// --------------------------------------------------------------------------- filters <-> URL params

/** Definition filter name -> query params it controls. Reports that take a period show one day too. */
export const FILTER_PARAMS = {
  period: ['date'],
  date: ['date'],
  customer: ['party'],
  supplier: ['party'],
  account: ['account'],
  bank_account: ['account'],
  status: ['status'],
  group: ['group'],
  direction: ['direction'],
  category: ['category'],
  stock: ['stock'],
  view: ['view'],
}

const ALL_PARAMS = [...new Set(Object.values(FILTER_PARAMS).flat())]

export function filterParamNames(definition) {
  if (!definition) return ALL_PARAMS
  return [...new Set((definition.filters || []).flatMap((name) => FILTER_PARAMS[name] || []))]
}

/**
 * API params for the report from the URL. A report with a period filter is asked for one day:
 * the chosen date (today when none), sent as a custom range from that day to that day.
 */
export function reportApiParams(searchParams, definition) {
  const params = {}
  for (const name of filterParamNames(definition)) {
    const value = searchParams.get(name)
    if (value) params[name] = value
  }
  if (definition?.filters?.includes('period')) {
    const day = params.date || todayISO()
    delete params.date
    Object.assign(params, { period: 'custom', date_from: day, date_to: day })
  }
  return params
}

export function hasActiveFilters(searchParams, definition) {
  return filterParamNames(definition).some((name) => searchParams.get(name))
}

export function customRangeError(params) {
  if (params.period !== 'custom') return ''
  if (!params.date_from || !params.date_to) return 'Choose both dates to see the report.'
  if (params.date_from > params.date_to) return 'The end date must be on or after the start date.'
  return ''
}

export const STATUS_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'pending', label: 'Pending (unpaid + partial)' },
]

export const GROUP_OPTIONS = [
  { value: 'month', label: 'Month-wise' },
  { value: 'day', label: 'Day-wise' },
]

export const DIRECTION_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'in', label: 'Money In' },
  { value: 'out', label: 'Money Out' },
]

export const STOCK_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
]

export const VIEW_OPTIONS = [
  { value: 'party', label: 'Party-wise' },
  { value: 'bill', label: 'Bill-wise' },
]
