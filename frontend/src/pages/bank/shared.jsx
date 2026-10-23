import { useQuery } from '@tanstack/react-query'
import { CircleMinus, CirclePlus, Landmark, Wallet } from 'lucide-react'

import { api } from '../../lib/api.js'
import { fromScaled, toScaled } from '../../lib/money.js'

export const ACCOUNTS_KEY = ['bank-accounts']

/** GET /accounts/ → { results: [account], summary: { cash_balance, bank_balance, total_balance } } */
export function useAccounts(options = {}) {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: ({ signal }) => api.get('/accounts/', undefined, { signal }),
    ...options,
  })
}

/** BankTransaction.txn_type values (statement filter). */
export const TXN_TYPE_OPTIONS = [
  { value: 'payment_in', label: 'Payment In' },
  { value: 'payment_out', label: 'Payment Out' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdraw', label: 'Withdrawal' },
  { value: 'transfer_in', label: 'Transfer In' },
  { value: 'transfer_out', label: 'Transfer Out' },
  { value: 'add', label: 'Money Added' },
  { value: 'reduce', label: 'Money Reduced' },
]

/** BankAdjustment.txn_type values offered (manual money movements). Money is kept only in the
 * bank account (B), so there are no cash deposits / withdrawals and no transfers. */
export const ADJUSTMENT_TYPES = [
  {
    value: 'add', label: 'Add money', short: 'Add money', icon: CirclePlus,
    hint: 'Increase a balance, e.g. owner capital or interest received.',
  },
  {
    value: 'reduce', label: 'Reduce money', short: 'Reduce money', icon: CircleMinus,
    hint: 'Decrease a balance, e.g. bank charges or owner withdrawals.',
  },
]

export const adjustmentType = (value) => ADJUSTMENT_TYPES.find((type) => type.value === value) || ADJUSTMENT_TYPES[0]

/** Same rule the server uses when the display name is left blank: "HDFC Bank ••4521". */
export function autoAccountName(bankName, accountNumber) {
  const bank = (bankName || '').trim()
  const number = (accountNumber || '').replace(/\s+/g, '').toUpperCase()
  if (!bank) return ''
  return number ? `${bank} ••${number.slice(-4)}` : bank
}

export function moneyInput(value) {
  return toScaled(value, 2) === 0n ? '' : fromScaled(toScaled(value, 2), 2).replace(/\.00$/, '')
}

export function AccountIcon({ account, className = 'size-10 rounded-xl', iconClassName = 'size-5' }) {
  const cash = account?.kind === 'cash'
  const Icon = cash ? Wallet : Landmark
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${cash ? 'bg-pos-soft text-pos' : 'bg-brand-soft text-brand-ink'} ${className}`}>
      <Icon className={iconClassName} />
    </span>
  )
}

const ICON_TONES = {
  default: 'text-ink-3 hover:text-ink',
  danger: 'text-neg',
  brand: 'text-brand-ink',
}

/** 44px icon-only button with an accessible label. */
export function IconButton({ icon: Icon, label, tone = 'default', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`grid size-11 shrink-0 place-items-center rounded-xl transition hover:bg-subtle disabled:pointer-events-none disabled:opacity-50 ${ICON_TONES[tone] || ICON_TONES.default} ${className}`}
      {...props}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  )
}
