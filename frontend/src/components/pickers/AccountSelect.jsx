import { useQuery } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'
import { useEffect } from 'react'

import { api } from '../../lib/api.js'
import { Field, useFieldProps } from '../ui/form.jsx'

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get('/accounts/'), staleTime: 30_000 })
}

/** Bills and payments are always received / paid through the bank account (B); Cash is not offered. */
const bankAccounts = (accounts) => (accounts || []).filter((a) => a.kind === 'bank')

/** Default account id for new payments: the bank account (B). */
export function defaultAccountId(accounts) {
  const banks = bankAccounts(accounts)
  return (banks.find((a) => a.is_default) || banks[0])?.id ?? null
}

/**
 * "Payment Type" selector: only the bank account (B). value = account id.
 * Account balances are deliberately not shown here (bills are made in front of customers);
 * they appear only on the Bank pages.
 */
export default function AccountSelect({ value, onChange, label = 'Payment Type', error, className = '' }) {
  const accounts = useAccounts()
  const list = bankAccounts(accounts.data?.results)
  const props = useFieldProps({})
  const known = list.some((a) => a.id === Number(value))

  // An older bill or payment made in Cash moves to the bank when it is edited.
  useEffect(() => {
    if (list.length && !known) onChange(defaultAccountId(list))
  }, [list.length, known]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
      <Field label={label} error={error}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            <Landmark className="size-[18px]" />
          </span>
          <select
            {...props}
            className="field pl-10"
            value={known ? value : ''}
            aria-invalid={error ? 'true' : undefined}
            onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
          >
            {!list.length && <option value="">Loading…</option>}
            {list.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </div>
      </Field>
    </div>
  )
}
