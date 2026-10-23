import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BarChart3, BellRing, Home, Landmark, LayoutDashboard, Package,
  PackagePlus, ReceiptText, Settings, ShoppingCart, UserPlus, Users, Wallet,
} from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', key: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/parties', key: 'parties', icon: Users },
  { to: '/items', key: 'items', icon: Package },
  { to: '/sales', key: 'sales', icon: ReceiptText },
  { to: '/purchases', key: 'purchase', icon: ShoppingCart },
  { to: '/payments-in', key: 'payment_in', icon: ArrowDownLeft },
  { to: '/payments-out', key: 'payment_out', icon: ArrowUpRight },
  { to: '/bank', key: 'bank', icon: Landmark },
  { to: '/reports', key: 'reports', icon: BarChart3 },
  { to: '/reminders', key: 'reminders', icon: BellRing },
  { to: '/settings', key: 'settings', icon: Settings },
]

export const BOTTOM_NAV = [
  { to: '/', key: 'home', icon: Home, end: true },
  { to: '/parties', key: 'parties', icon: Users },
  { to: '/sales', key: 'sales', icon: ReceiptText },
  { to: '/payments', key: 'payments', icon: Wallet, match: ['/payments', '/payments-in', '/payments-out'] },
]

export const QUICK_ACTIONS = [
  { group: 'Sale', to: '/sales/new', label: 'New Sale', gu: 'નવું વેચાણ', icon: ReceiptText, tone: 'brand' },
  { group: 'Sale', to: '/payments-in/new', label: 'Payment In', gu: 'પેમેન્ટ ઇન', icon: ArrowDownLeft, tone: 'pos' },
  { group: 'Purchase', to: '/purchases/new', label: 'New Purchase', gu: 'નવી ખરીદી', icon: ShoppingCart, tone: 'brand' },
  { group: 'Purchase', to: '/payments-out/new', label: 'Payment Out', gu: 'પેમેન્ટ આઉટ', icon: ArrowUpRight, tone: 'neg' },
  { group: 'Other', to: '/parties/new', label: 'Add Party', gu: 'પાર્ટી ઉમેરો', icon: UserPlus, tone: 'brand' },
  { group: 'Other', to: '/items/new', label: 'Add Item', gu: 'વસ્તુ ઉમેરો', icon: PackagePlus, tone: 'brand' },
  { group: 'Other', to: '/bank?transfer=1', label: 'Add / Reduce money', gu: 'પૈસા ઉમેરો / ઘટાડો', icon: ArrowRightLeft, tone: 'brand' },
  { group: 'Other', to: '/reminders?new=1', label: 'Reminder', gu: 'રિમાઇન્ડર', icon: BellRing, tone: 'warn' },
]

export function recordPath(type, id) {
  switch (type) {
    case 'party': return `/parties/${id}`
    case 'item': return `/items/${id}`
    case 'sale': return `/sales/${id}`
    case 'purchase': return `/purchases/${id}`
    case 'payment_in': return `/payments-in/${id}`
    case 'payment_out': return `/payments-out/${id}`
    case 'bank_account': return `/bank/${id}`
    default: return null
  }
}

export const RECORD_LABELS = {
  party: 'Party',
  item: 'Item',
  sale: 'Sale',
  purchase: 'Purchase',
  payment_in: 'Payment In',
  payment_out: 'Payment Out',
  bank_account: 'Bank',
}
