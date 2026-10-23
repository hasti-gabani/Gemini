import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'

import Button from '../../components/ui/Button.jsx'
import { DateInput, Field, NumberInput, Segmented, TextInput } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api, fieldError } from '../../lib/api.js'
import { todayISO } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { formatQty, fromScaled, isValidNumber, toScaled } from '../../lib/money.js'

const MODES = [
  { value: 'add', label: 'Add stock', tone: 'pos' },
  { value: 'reduce', label: 'Reduce stock', tone: 'neg' },
]

const FIELDS = ['quantity', 'date', 'note']

/** Manual stock correction: + adds, − reduces (damage, counting difference, own use…). */
export default function StockAdjustDialog({ open, onClose, item }) {
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const formId = useId()
  const [mode, setMode] = useState('add')
  const [quantity, setQuantity] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setMode('add')
    setQuantity('')
    setDate(todayISO())
    setNote('')
    setErrors({})
  }, [open])

  const save = useMutation({
    mutationFn: (body) => api.post(`/items/${item.id}/adjust-stock/`, body),
    onSuccess: (data) => {
      invalidate()
      const updated = data?.item || item
      toast.success(`Stock ${mode === 'add' ? 'added' : 'reduced'}. Current stock: ${formatQty(updated.current_stock)} ${updated.unit}.`)
      onClose()
    },
    onError: (error) => {
      const serverErrors = error.errors || {}
      setErrors(serverErrors)
      if (!FIELDS.some((field) => serverErrors[field])) toast.error(error)
    },
  })

  if (!item) return null

  const qty = isValidNumber(quantity) ? toScaled(quantity, 3) : 0n
  const current = toScaled(item.current_stock, 3)
  const next = mode === 'add' ? current + qty : current - qty

  const submit = (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (!quantity || !isValidNumber(quantity) || qty <= 0n) nextErrors.quantity = 'Enter a quantity greater than zero.'
    else if (qty >= 10n ** 14n) nextErrors.quantity = 'Quantity is too large.'
    if (!date) nextErrors.date = 'Choose a date.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    save.mutate({
      quantity: fromScaled(mode === 'add' ? qty : -qty, 3),
      date,
      note: note.trim(),
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => !save.isPending && onClose()}
      title="Adjust Stock"
      subtitle={item.name}
      size="sm"
      footer={(
        <div className="flex gap-3 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            type="submit"
            form={formId}
            variant={mode === 'add' ? 'success' : 'danger'}
            className="flex-1 sm:flex-none"
            loading={save.isPending}
          >
            {mode === 'add' ? 'Add stock' : 'Reduce stock'}
          </Button>
        </div>
      )}
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={MODES}
          className="w-full [&>button]:flex-1 [&>button]:py-2.5"
        />

        <Field
          label="Quantity"
          required
          htmlFor={`${formId}-qty`}
          error={fieldError(errors, 'quantity')}
          hint={`Current stock: ${formatQty(item.current_stock)} ${item.unit}`}
        >
          <NumberInput
            id={`${formId}-qty`}
            data-autofocus
            decimals={3}
            suffix={item.unit}
            placeholder="0"
            value={quantity}
            error={fieldError(errors, 'quantity')}
            onChange={(value) => {
              setQuantity(value)
              if (errors.quantity) setErrors({ ...errors, quantity: '' })
            }}
          />
        </Field>

        {qty > 0n && (
          <p className="rounded-xl bg-muted px-4 py-3 text-[15px] text-ink-2">
            Stock after this adjustment:{' '}
            <span className={`num font-semibold ${next <= 0n ? 'text-neg' : 'text-ink'}`}>
              {formatQty(fromScaled(next, 3))} {item.unit}
            </span>
          </p>
        )}

        <Field label="Date" required htmlFor={`${formId}-date`} error={fieldError(errors, 'date')}>
          <DateInput
            id={`${formId}-date`}
            value={date}
            error={fieldError(errors, 'date')}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>

        <Field label="Note" htmlFor={`${formId}-note`} error={fieldError(errors, 'note')} hint="Why the stock changed, e.g. damaged, counting difference, sample.">
          <TextInput
            id={`${formId}-note`}
            value={note}
            maxLength={255}
            placeholder="Reason (optional)"
            error={fieldError(errors, 'note')}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  )
}
