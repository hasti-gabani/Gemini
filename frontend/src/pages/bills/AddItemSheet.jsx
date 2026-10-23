import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import Button from '../../components/ui/Button.jsx'
import { Field, NumberInput, Select, TextInput } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { calcLine } from '../../lib/billCalc.js'
import { useDebounced } from '../../lib/hooks.js'
import { formatMoney, toScaled } from '../../lib/money.js'

const strip = (value) => {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/**
 * "Add Items to Sale" in one screen, as in Vyapar: type the item name (saved items are suggested),
 * quantity, unit and rate, then Save (back to the bill) or Save & New (the next item).
 * A name that is not saved yet becomes a new item, so it is suggested next time.
 * onAdd({ item, name, quantity, unit, rate }) — item is the saved item.
 */
export default function AddItemSheet({ open, onClose, onAdd, kind = 'sale' }) {
  const { settings } = useSession()
  const { toast } = useUI()
  const defaultUnit = settings?.units?.[0] || 'PCS'
  const empty = { name: '', item: null, quantity: '', unit: defaultUnit, rate: '' }
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [suggest, setSuggest] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef(null)
  const qtyRef = useRef(null)
  const debounced = useDebounced(form.name.trim(), 150)

  useEffect(() => {
    if (open) {
      setForm(empty)
      setError('')
      setSuggest(true)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useQuery({
    queryKey: ['item-picker', debounced],
    queryFn: ({ signal }) => api.get('/items/', { view: 'lookup', search: debounced, page_size: 8, include_inactive: 0 }, { signal }),
    enabled: open && !form.item,
    staleTime: 15_000,
  })
  const rows = items.data?.results || []
  const exact = rows.find((row) => row.name.trim().toLowerCase() === form.name.trim().toLowerCase())

  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  const priceOf = (item) => strip(kind === 'sale' ? item.sale_price : item.purchase_price)
  const pick = (item) => {
    set({ item, name: item.name, unit: item.unit || defaultUnit, rate: priceOf(item) })
    setSuggest(false)
    setError('')
    qtyRef.current?.focus() // straight to Quantity: the next keys typed go there
  }

  const quantity = toScaled(form.quantity, 3) > 0n ? form.quantity : '1' // empty quantity counts as 1
  const amount = calcLine({ quantity, rate: form.rate || 0, discount_percent: 0, discount_amount: 0, tax_rate: 0, tax_inclusive: false }).amount
  const units = Array.from(new Set([...(settings?.units || []), form.unit].filter(Boolean)))

  const save = async (andNew) => {
    const name = form.name.trim()
    if (!name) {
      setError('Enter the item name.')
      nameRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      // A typed name: use the saved item with that name, or save it as a new item.
      let item = form.item || exact
      if (!item) {
        item = await api.post('/items/', {
          name, unit: form.unit, opening_stock: '0',
          sale_price: kind === 'sale' ? form.rate || '0' : '0',
          purchase_price: kind === 'purchase' ? form.rate || '0' : '0',
        })
      }
      onAdd({ item, name, quantity, unit: form.unit, rate: form.rate || priceOf(item) || '0' })
      if (andNew) {
        toast.success(`${name} added.`)
        setForm(empty)
        setError('')
        setSuggest(true)
        nameRef.current?.focus()
      } else {
        onClose()
      }
    } catch (failure) {
      setError(failure?.errors?.name || failure?.message || 'Could not add the item.')
    } finally {
      setSaving(false)
    }
  }

  const showSuggestions = suggest && !form.item && rows.length > 0 && !(exact && rows.length === 1)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'sale' ? 'Add Items to Sale' : 'Add Items to Purchase'}
      size="md"
      fullHeight
      footer={(
        <div className="flex w-full gap-3">
          <Button variant="secondary" className="flex-1" disabled={saving} onClick={() => save(true)}>Save &amp; New</Button>
          <Button variant="danger" className="flex-1" loading={saving} onClick={() => save(false)}>Save</Button>
        </div>
      )}
    >
      <form
        className="space-y-4"
        autoComplete="off"
        onSubmit={(event) => { event.preventDefault(); save(false) }}
      >
        <div className="relative">
          <Field label="Item Name" required error={error}>
            <TextInput
              ref={nameRef}
              data-autofocus
              autoFocus
              placeholder="Type or choose an item"
              value={form.name}
              error={error}
              onFocus={() => setSuggest(true)}
              onChange={(e) => { set({ name: e.target.value, item: null }); setSuggest(true); setError('') }}
            />
          </Field>
          {showSuggestions && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-card shadow-lg">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(row)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted"
                  >
                    <span className="min-w-0 truncate text-[15px] text-ink">{row.name}</span>
                    <span className="num shrink-0 text-sm text-ink-3">{formatMoney(priceOf(row) || 0)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {form.name.trim() && !form.item && !exact && !showSuggestions && !items.isFetching && (
            <p className="mt-1 text-xs text-ink-3">New item: it will be saved for future bills.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <NumberInput
              ref={qtyRef}
              decimals={3}
              placeholder="1"
              value={form.quantity}
              onFocus={() => setSuggest(false)}
              onChange={(value) => set({ quantity: value })}
            />
          </Field>
          <Field label="Unit">
            <Select value={form.unit} onChange={(e) => set({ unit: e.target.value })} options={units.map((u) => ({ value: u, label: u }))} />
          </Field>
        </div>

        <Field label="Rate (Price/Unit)">
          <NumberInput prefix="₹" value={form.rate} onFocus={() => setSuggest(false)} onChange={(value) => set({ rate: value })} />
        </Field>

        <section className="rounded-xl bg-muted p-4">
          <h3 className="mb-2 text-[15px] font-semibold text-ink">Totals</h3>
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-2 text-[15px]">
              <dt className="text-ink-2">Subtotal <span className="text-sm text-ink-3">(Rate x Qty)</span></dt>
              <dd className="num text-ink">{formatMoney(amount)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-line pt-2 text-lg font-semibold">
              <dt className="text-ink">Total Amount</dt>
              <dd className="num text-ink">{formatMoney(amount)}</dd>
            </div>
          </dl>
        </section>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
