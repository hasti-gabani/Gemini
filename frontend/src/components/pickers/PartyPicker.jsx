import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Plus, Search, UserPlus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { useDebounced, useInvalidateAll } from '../../lib/hooks.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'
import Button from '../ui/Button.jsx'
import { Field, NumberInput, Segmented, TextInput } from '../ui/form.jsx'
import Modal from '../ui/Modal.jsx'
import { Spinner } from '../ui/misc.jsx'

export function BalanceText({ balance, className = '' }) {
  if (balance === undefined || balance === null) return null
  const positive = isPositive(balance)
  const negative = isNegative(balance)
  return (
    <span className={`whitespace-nowrap text-xs ${className}`}>
      <span className="text-ink-3">Party Balance: </span>
      <span className={`num font-semibold ${positive ? 'text-pos' : negative ? 'text-neg' : 'text-ink-2'}`}>
        {formatMoney(balance, { absolute: true })}
      </span>
      {positive && <span className="hidden text-ink-3 sm:inline"> (You'll Get)</span>}
      {negative && <span className="hidden text-ink-3 sm:inline"> (You'll Give)</span>}
    </span>
  )
}

/** Quick "+ Add Party" dialog used from pickers. Calls onCreated(party). */
export function QuickPartyDialog({ open, onClose, onCreated, initialName = '', partyType = 'customer' }) {
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  useEffect(() => {
    if (open) {
      setForm({ name: initialName, phone: '', city: '', party_type: partyType, opening_balance: '', opening_balance_type: partyType === 'supplier' ? 'payable' : 'receivable' })
      setErrors({})
    }
  }, [open, initialName, partyType])
  const create = useMutation({
    mutationFn: (body) => api.post('/parties/', body),
    onSuccess: (party) => {
      invalidate()
      toast.success(`${party.name} added.`)
      onCreated(party)
    },
    onError: (error) => {
      setErrors(error.errors || {})
      if (!Object.keys(error.errors || {}).length) toast.error(error)
    },
  })
  const submit = (event) => {
    event.preventDefault()
    if (!form.name?.trim()) {
      setErrors({ name: 'Party name is required.' })
      return
    }
    create.mutate({ ...form, opening_balance: form.opening_balance || '0' })
  }
  const word = partyType === 'supplier' ? 'Supplier' : 'Party'
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${word}`}
      size="sm"
      footer={(
        <div className="flex w-full gap-3 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 sm:flex-none" loading={create.isPending} onClick={submit}>Save {word}</Button>
        </div>
      )}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={`${word} name`} required error={errors.name}>
          <TextInput data-autofocus autoFocus value={form.name || ''} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile number" error={errors.phone}>
            <TextInput type="tel" inputMode="tel" value={form.phone || ''} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="City" error={errors.city}>
            <TextInput value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
        </div>
        <Field label="Opening balance" hint="Amount pending from before you started using the app">
          <div className="flex gap-2">
            <NumberInput prefix="₹" className="flex-1" value={form.opening_balance} onChange={(value) => setForm({ ...form, opening_balance: value })} />
            <Segmented
              size="sm"
              className="shrink-0 self-center"
              value={form.opening_balance_type}
              onChange={(value) => setForm({ ...form, opening_balance_type: value })}
              options={[{ value: 'receivable', label: 'To get' }, { value: 'payable', label: 'To give' }]}
            />
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

const OTHER_ROLE = { customer: 'supplier', supplier: 'customer' }
const ROLE_LABEL = { customer: 'Customer', supplier: 'Supplier' }

/**
 * Searchable party field with party balance and inline "+ Add Party".
 * value: party object ({id, name, phone, balance, full_address|address, gstin}) or null.
 * `listAll` searches every party (bill forms) while `partyType` still decides the wording
 * and the type of a party created with "+ Add".
 */
export default function PartyPicker({
  value, onChange, label = 'Party', required = false, error, partyType = 'customer', placeholder, disabled,
  showBalance = true, listAll = false,
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()
  const search = useDebounced(text.trim(), 200)
  const filterType = listAll || partyType === 'any' ? undefined : partyType

  const results = useQuery({
    queryKey: ['party-picker', filterType || 'all', search],
    queryFn: ({ signal }) => api.get('/parties/', { search, page_size: 20, ordering: search ? 'name' : '-last_txn_date', type: filterType }, { signal }),
    enabled: open,
    staleTime: 15_000,
  })
  const rows = results.data?.results || []
  const word = partyType === 'supplier' ? 'Supplier' : 'Party'

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => setActive(0), [search])

  const choose = (party) => {
    onChange(party)
    setOpen(false)
    setText('')
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, rows.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (active < rows.length) choose(rows[active])
      else setAdding(true)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Field
        label={label}
        required={required}
        error={error}
        labelRight={showBalance && value ? <BalanceText balance={value.balance} /> : null}
      >
        {value && !open ? (
          <div className={`flex min-h-[2.875rem] items-center gap-2 rounded-xl border bg-card px-3.5 py-1 ${error ? 'border-neg' : 'border-line-strong'}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setOpen(true)
                setTimeout(() => inputRef.current?.focus(), 0)
              }}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block break-words text-base font-medium leading-snug text-ink">{value.name}</span>
            </button>
            {value.phone && <span className="hidden text-sm text-ink-3 xs:inline">{value.phone}</span>}
            {!disabled && (
              <button type="button" aria-label={`Clear ${word.toLowerCase()}`} onClick={() => onChange(null)} className="-mr-1.5 grid size-8 place-items-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
                <X className="size-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" />
            <input
              ref={inputRef}
              className="field pl-10 pr-9"
              value={text}
              disabled={disabled}
              placeholder={placeholder || `Search or add ${word.toLowerCase()}`}
              aria-invalid={error ? 'true' : undefined}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              autoComplete="off"
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setText(event.target.value)
                setOpen(true)
              }}
              onKeyDown={onKeyDown}
            />
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          </div>
        )}
      </Field>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 z-40 mt-1.5 max-h-80 animate-pop-in overflow-y-auto overscroll-contain rounded-xl border border-line bg-card py-1 shadow-pop scroll-thin"
        >
          {results.isPending && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-3"><Spinner className="size-4" /> Searching…</div>
          )}
          {!results.isPending && rows.length === 0 && (
            <p className="px-4 py-3 text-sm text-ink-3">{search ? `No ${word.toLowerCase()} named “${search}”.` : `No ${word.toLowerCase()}s yet.`}</p>
          )}
          {rows.map((party, index) => (
            <button
              key={party.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(party)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${index === active ? 'bg-brand-soft' : 'hover:bg-muted'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px] font-medium text-ink">{party.name}</span>
                  {listAll && party.party_type === OTHER_ROLE[partyType] && (
                    <span className="shrink-0 rounded bg-subtle px-1.5 text-[11px] font-medium text-ink-3">{ROLE_LABEL[party.party_type]}</span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-3">{[party.phone, party.city].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              <span className={`num text-sm font-semibold ${isPositive(party.balance) ? 'text-pos' : isNegative(party.balance) ? 'text-neg' : 'text-ink-3'}`}>
                {formatMoney(party.balance, { absolute: true, decimals: 'auto' })}
              </span>
              {value?.id === party.id && <Check className="size-4 text-brand" />}
            </button>
          ))}
          <button
            type="button"
            onMouseEnter={() => setActive(rows.length)}
            onClick={() => setAdding(true)}
            className={`flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-[15px] font-semibold text-brand-ink ${active === rows.length ? 'bg-brand-soft' : 'hover:bg-muted'}`}
          >
            {search ? <Plus className="size-4" /> : <UserPlus className="size-4" />}
            {search ? `Add “${search}” as new ${word.toLowerCase()}` : `+ Add ${word}`}
          </button>
        </div>
      )}

      <QuickPartyDialog
        open={adding}
        onClose={() => setAdding(false)}
        initialName={text}
        partyType={partyType === 'supplier' ? 'supplier' : 'customer'}
        onCreated={(party) => {
          setAdding(false)
          choose(party)
        }}
      />
    </div>
  )
}
