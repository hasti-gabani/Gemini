import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, ChevronUp, EllipsisVertical, Hash, Minus, Plus, Printer, Share2, Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router'

import AttachmentInput from '../../components/AttachmentInput.jsx'
import Page from '../../components/layout/Page.jsx'
import { defaultAccountId, useAccounts } from '../../components/pickers/AccountSelect.jsx'
import PartyPicker from '../../components/pickers/PartyPicker.jsx'
import Button from '../../components/ui/Button.jsx'
import {
  Checkbox, Field, NumberInput, Segmented, Select, Switch, TextArea, TextInput,
} from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { ErrorState, Menu, PageLoader } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api, fieldError } from '../../lib/api.js'
import { calcBill, calcLine } from '../../lib/billCalc.js'
import { todayISO } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import {
  compareMoney, formatMoney, formatQty, fromPaise, fromScaled, isPositive, subMoney, toScaled,
} from '../../lib/money.js'
import AddItemSheet from './AddItemSheet.jsx'
import { BILL_KINDS } from './billConfig.js'

let lineSeq = 0
const newKey = () => `line-${++lineSeq}`

const strip = (value) => {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

// Bills are made without GST or per-item discount: a new line is always Qty × Rate, even when
// the item itself has a tax rate. Lines of older bills keep whatever they were saved with.
function lineFromItem(item, kind, quantity = '1') {
  return {
    key: newKey(),
    item: item.id,
    name: item.name,
    code: item.code || '',
    unit: item.unit || '',
    hsn: item.hsn || '',
    quantity: String(quantity),
    rate: strip(kind === 'sale' ? item.sale_price : item.purchase_price),
    discountMode: 'percent',
    discount_percent: '',
    discount_amount: '',
    tax_rate: '0',
    tax_inclusive: false,
  }
}

function lineFromBill(line) {
  const percent = toScaled(line.discount_percent, 2) > 0n
  return {
    key: newKey(),
    item: line.item,
    name: line.name,
    code: line.code,
    unit: line.unit,
    hsn: line.hsn,
    quantity: formatQty(line.quantity),
    rate: strip(line.rate),
    discountMode: percent ? 'percent' : 'amount',
    discount_percent: percent ? strip(line.discount_percent) : '',
    discount_amount: !percent && toScaled(line.discount_amount, 2) > 0n ? strip(line.discount_amount) : '',
    tax_rate: strip(line.tax_rate) || '0',
    tax_inclusive: line.tax_inclusive,
  }
}

/** Add ±1 to a quantity string, never going below 1 when decreasing. */
function stepQty(quantity, delta) {
  const current = toScaled(quantity, 3)
  const next = current + BigInt(delta) * 1000n
  return formatQty(fromScaled(delta < 0 && next < 1000n ? current : next, 3))
}

const calcInput = (line) => ({
  quantity: line.quantity || 0,
  rate: line.rate || 0,
  discount_percent: line.discountMode === 'percent' ? line.discount_percent || 0 : 0,
  discount_amount: line.discountMode === 'amount' ? line.discount_amount || 0 : 0,
  tax_rate: line.tax_rate || 0,
  tax_inclusive: line.tax_inclusive,
})

const hasSavedExtras = (computed) => toScaled(computed.discount_amount, 2) > 0n || toScaled(computed.tax_amount, 2) > 0n

function emptyForm(settings) {
  return {
    number: '',
    numberEdited: false,
    date: todayISO(),
    party: null,
    walkin_name: '',
    walkin_phone: '',
    items: [],
    manual_total: '',
    discountMode: 'percent',
    discount_percent: '',
    discount_amount: '',
    charges_label: '',
    charges_amount: '',
    auto_round_off: true,
    round_off: '',
    // A new bill starts fully received / paid, with or without a party (see withParty).
    receivedChecked: true,
    receivedAuto: true,
    receivedTouched: false,
    received: '',
    payment_account: null,
    payment_reference: '',
    notes: settings?.default_notes || '',
    terms: settings?.default_terms || '',
    attachments: [],
    showAdjustments: false,
    showTerms: false,
  }
}

function formFromBill(bill) {
  const percent = toScaled(bill.discount_percent, 2) > 0n
  const origin = bill.origin_payment
  const otherPaid = bill.payments.filter((p) => !p.is_origin).reduce((sum, p) => sum + toScaled(p.amount, 2), 0n)
  // Fully received at billing: keep following the total while the bill is edited.
  const fullyReceived = Boolean(origin) && toScaled(origin.amount, 2) === toScaled(bill.total, 2) - otherPaid
  return {
    number: bill.number,
    numberEdited: false,
    date: bill.date,
    party: bill.party_detail,
    walkin_name: bill.party ? '' : bill.party_name,
    walkin_phone: bill.party ? '' : bill.party_phone,
    items: bill.items.map(lineFromBill),
    manual_total: bill.items.length ? '' : strip(bill.total),
    discountMode: percent ? 'percent' : 'amount',
    discount_percent: percent ? strip(bill.discount_percent) : '',
    discount_amount: !percent && toScaled(bill.discount_amount, 2) > 0n ? strip(bill.discount_amount) : '',
    charges_label: bill.charges_label,
    charges_amount: toScaled(bill.charges_amount, 2) > 0n ? strip(bill.charges_amount) : '',
    auto_round_off: bill.auto_round_off,
    round_off: bill.auto_round_off ? '' : strip(bill.round_off),
    receivedChecked: Boolean(origin),
    receivedAuto: fullyReceived,
    received: origin ? strip(origin.amount) : '',
    payment_account: origin?.account ?? null,
    payment_reference: origin?.reference_no || '',
    notes: bill.notes,
    terms: bill.terms,
    attachments: bill.attachments,
    showAdjustments: toScaled(bill.discount_amount, 2) > 0n || toScaled(bill.charges_amount, 2) > 0n || !bill.auto_round_off,
    showTerms: false,
  }
}

/* ------------------------------------------------------------------ line editor */

function LineEditor({ line, onChange, onRemove, onClose, settings, errors, index }) {
  const [draft, setDraft] = useState(line)
  useEffect(() => setDraft(line), [line])
  if (!line) return null
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const computed = calcLine(calcInput(draft))
  const units = Array.from(new Set([...(settings?.units || []), draft.unit].filter(Boolean)))
  return (
    <Modal
      open
      onClose={onClose}
      title={draft.name || 'Item'}
      size="md"
      footer={(
        <div className="flex w-full gap-3">
          <Button variant="danger-soft" icon={Trash2} onClick={onRemove}>Remove</Button>
          <div className="flex-1" />
          <Button
            className="min-w-28"
            onClick={() => {
              onChange(draft)
              onClose()
            }}
          >
            Done
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <Field label="Item name" required error={fieldError(errors, `items.${index}.name`)}>
          <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" required error={fieldError(errors, `items.${index}.quantity`)}>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Decrease quantity" className="grid size-11 shrink-0 place-items-center rounded-xl border border-line-strong text-ink-2" onClick={() => set({ quantity: stepQty(draft.quantity, -1) })}>
                <Minus className="size-4" />
              </button>
              <NumberInput data-autofocus decimals={3} value={draft.quantity} onChange={(value) => set({ quantity: value })} align="right" />
              <button type="button" aria-label="Increase quantity" className="grid size-11 shrink-0 place-items-center rounded-xl border border-line-strong text-brand-ink" onClick={() => set({ quantity: stepQty(draft.quantity, 1) })}>
                <Plus className="size-4" />
              </button>
            </div>
          </Field>
          <Field label="Unit">
            <Select value={draft.unit} onChange={(e) => set({ unit: e.target.value })} options={units.map((u) => ({ value: u, label: u }))} placeholder="—" />
          </Field>
        </div>
        <Field label="Rate (price per unit)" error={fieldError(errors, `items.${index}.rate`)}>
          <NumberInput prefix="₹" value={draft.rate} onChange={(value) => set({ rate: value })} />
        </Field>
        <dl className="space-y-1.5 rounded-xl bg-muted p-3 text-sm">
          <div className="flex justify-between gap-2"><dt className="text-ink-3">Qty × Rate</dt><dd className="num text-ink">{formatQty(draft.quantity || 0)} × {formatMoney(draft.rate || 0)} = {formatMoney(computed.gross)}</dd></div>
          {/* Only lines saved on older bills can carry a discount or GST; they are kept as they were. */}
          {toScaled(computed.discount_amount, 2) > 0n && (
            <div className="flex justify-between gap-2"><dt className="text-ink-3">Saved discount</dt><dd className="num text-warn">− {formatMoney(computed.discount_amount)}</dd></div>
          )}
          {toScaled(computed.tax_amount, 2) > 0n && (
            <div className="flex justify-between gap-2"><dt className="text-ink-3">Saved {settings?.tax_label || 'GST'} ({strip(draft.tax_rate)}%{draft.tax_inclusive ? ' incl.' : ''})</dt><dd className="num text-ink">{formatMoney(computed.tax_amount)}</dd></div>
          )}
          <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt className="text-ink">Amount</dt><dd className="num text-ink">{formatMoney(computed.amount)}</dd></div>
        </dl>
        {hasSavedExtras(computed) && (
          <p className="text-sm text-ink-3">This line was saved with a discount or GST on an older bill. It is kept as it was.</p>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ billed items */

function LineCard({ line, index, onOpen, error }) {
  const computed = calcLine(calcInput(line))
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-xl border bg-card px-3.5 py-3 text-left transition hover:border-line-strong ${error ? 'border-neg' : 'border-line'}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-md bg-subtle px-1.5 text-xs font-semibold text-ink-3">#{index + 1}</span>
        <span className="min-w-0 flex-1 break-words font-semibold text-ink">{line.name || 'Unnamed item'}</span>
        <span className="num font-semibold text-ink">{formatMoney(computed.amount)}</span>
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-sm text-ink-2">
        <span>Qty × Rate</span>
        <span className="num text-right">{formatQty(line.quantity || 0)} {line.unit} × {formatMoney(line.rate || 0, { decimals: 'auto' })}</span>
      </div>
      {error && <p className="mt-1 text-sm text-neg">{error}</p>}
    </button>
  )
}

function LineRow({ line, index, onChange, onRemove, onOpen, errors }) {
  const computed = calcLine(calcInput(line))
  const set = (patch) => onChange({ ...line, ...patch })
  const small = 'field h-10 px-2.5 text-[15px]'
  return (
    <tr className="align-top">
      <td className="px-2 py-2 pt-4 text-sm text-ink-3">{index + 1}</td>
      <td className="px-2 py-2">
        <input className={small} value={line.name} aria-label={`Item ${index + 1} name`} aria-invalid={fieldError(errors, `items.${index}.name`) ? 'true' : undefined} onChange={(e) => set({ name: e.target.value })} />
        <button type="button" onClick={onOpen} className="mt-1 text-xs font-medium text-brand-ink hover:underline">More options</button>
        {fieldError(errors, `items.${index}`) && <p className="mt-0.5 text-xs text-neg">{fieldError(errors, `items.${index}`)}</p>}
      </td>
      <td className="w-28 px-2 py-2">
        <NumberInput decimals={3} inputClassName={small} align="right" aria-label="Quantity" value={line.quantity} error={fieldError(errors, `items.${index}.quantity`)} onChange={(value) => set({ quantity: value })} />
        <p className="mt-1 text-right text-xs text-ink-3">{line.unit}</p>
      </td>
      <td className="w-36 px-2 py-2">
        <NumberInput inputClassName={small} align="right" aria-label="Rate" value={line.rate} onChange={(value) => set({ rate: value })} />
      </td>
      <td className="w-36 px-2 py-2 pt-4 text-right">
        <span className="num font-semibold text-ink">{formatMoney(computed.amount)}</span>
      </td>
      <td className="w-10 px-1 py-2 pt-3">
        <button type="button" aria-label={`Remove ${line.name || 'item'}`} onClick={onRemove} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-neg-soft hover:text-neg">
          <Trash2 className="size-4" />
        </button>
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ page */

export default function BillForm({ kind }) {
  const cfg = BILL_KINDS[kind]
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { settings } = useSession()
  const { toast, confirm } = useUI()
  const invalidate = useInvalidateAll()
  const accounts = useAccounts()

  const [form, setForm] = useState(() => (editing ? null : emptyForm(settings)))
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [numberOpen, setNumberOpen] = useState(false)
  const savingRef = useRef(false)
  const numberRef = useRef(null)

  const existing = useQuery({
    queryKey: [kind, id, 'edit'],
    queryFn: () => api.get(`${cfg.api}/${id}/`),
    enabled: editing,
    gcTime: 0,
  })
  const nextNumber = useQuery({
    queryKey: ['next-number', cfg.numberType],
    queryFn: () => api.get('/next-number/', { type: cfg.numberType }),
    enabled: !editing,
    staleTime: 0,
  })

  useEffect(() => {
    if (editing && existing.data && !form) setForm(formFromBill(existing.data))
  }, [editing, existing.data, form])

  // default payment account once accounts load
  useEffect(() => {
    const list = accounts.data?.results
    if (form && !form.payment_account && list?.length) {
      setForm((current) => ({ ...current, payment_account: defaultAccountId(list, settings) }))
    }
  }, [accounts.data, form, settings])

  // prefill ?party= and ?item= on new bills
  const prefilled = useRef(false)
  useEffect(() => {
    if (editing || prefilled.current || !form) return
    prefilled.current = true
    const partyId = searchParams.get('party')
    const itemId = searchParams.get('item')
    if (partyId) {
      api.get(`/parties/${partyId}/`).then((party) => setForm((current) => ({ ...current, ...withParty(current, party) }))).catch(() => {})
    }
    if (itemId) {
      api.get(`/items/${itemId}/`).then((item) => setForm((current) => ({ ...current, items: [...current.items, lineFromItem(item, kind)] }))).catch(() => {})
    }
  }, [editing, form, searchParams, kind])

  const update = useCallback((patch) => {
    setForm((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))
    setDirty(true)
  }, [])

  // Choosing a party keeps Received / Paid as it is (ticked for the full amount on a new bill);
  // untick it for a credit (udhaar) bill.
  const withParty = useCallback((current, party) => ({ party }), [])

  // leave-page guard
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savingRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({ title: 'Discard changes?', message: 'This bill has unsaved changes.', confirmText: 'Discard', cancelText: 'Keep editing', tone: 'danger' })
      .then((ok) => (ok ? blocker.proceed() : blocker.reset()))
  }, [blocker, confirm])
  useEffect(() => {
    if (!dirty) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const totals = useMemo(() => (form ? calcBill(form.items.map(calcInput), {
    discount_percent: form.discountMode === 'percent' ? form.discount_percent || 0 : 0,
    discount_amount: form.discountMode === 'amount' ? form.discount_amount || 0 : 0,
    charges_amount: form.charges_amount || 0,
    auto_round_off: form.auto_round_off,
    round_off: form.round_off || 0,
    manual_total: form.manual_total || 0,
  }) : null), [form])

  if (editing && existing.isError) {
    return <Page title={`Edit ${cfg.title}`} back={cfg.base}><ErrorState error={existing.error} onRetry={existing.refetch} /></Page>
  }
  if (!form || !totals) return <Page title={editing ? `Edit ${cfg.title}` : cfg.title} back><PageLoader /></Page>

  const bill = existing.data
  const otherPaid = bill ? fromPaise(bill.payments.filter((p) => !p.is_origin).reduce((sum, p) => sum + toScaled(p.amount, 2), 0n)) : '0.00'
  const maxReceivable = compareMoney(subMoney(totals.total, otherPaid), 0) > 0 ? subMoney(totals.total, otherPaid) : '0.00'
  const receivedValue = form.receivedChecked ? (form.receivedAuto ? maxReceivable : (form.received || '0')) : '0'
  const balanceDue = subMoney(maxReceivable, receivedValue)
  // Anything left due makes this a credit bill, which needs a customer/supplier.
  const needsParty = compareMoney(balanceDue, 0) > 0
  const selectedAccount = (accounts.data?.results || []).find((a) => a.id === form.payment_account)
  const displayNumber = form.numberEdited ? form.number : editing ? form.number : nextNumber.data?.number || '…'
  const hasItems = form.items.length > 0
  const receivedTooHigh = compareMoney(receivedValue, maxReceivable) > 0
  const partyWord = cfg.party.toLowerCase()

  // One line from the "Add Items to Sale" screen: the saved item with the quantity, unit and rate typed there.
  const addLine = ({ item, name, quantity, unit, rate }) => {
    const line = { ...lineFromItem(item, kind, quantity), name, unit, rate: String(rate) }
    update((current) => ({ items: [...current.items, line], manual_total: '' }))
  }

  const validate = () => {
    const next = {}
    if (needsParty && !form.party) {
      next.party = `Please select a ${partyWord}. A bill without a ${partyWord} must be fully ${cfg.paidWord.toLowerCase()}.`
    }
    form.items.forEach((line, index) => {
      if (!line.name.trim()) next[`items.${index}.name`] = 'Item name is required.'
      if (toScaled(line.quantity, 3) <= 0n) next[`items.${index}.quantity`] = 'Quantity must be greater than 0.'
    })
    if (compareMoney(totals.total, 0) <= 0) next.total = hasItems ? 'Bill total must be greater than zero.' : 'Add items or enter the total amount.'
    if (receivedTooHigh) next.received_amount = `${cfg.paidWord} amount cannot be more than ${formatMoney(maxReceivable)}.`
    return next
  }

  // No mode or due date is sent: the server marks the bill cash when it is fully received
  // (walk-in allowed) and credit otherwise, and keeps the due date of older bills.
  const buildBody = () => ({
    number: form.numberEdited ? form.number.trim() : '',
    date: form.date,
    party: form.party?.id ?? null,
    party_name: form.party ? '' : form.walkin_name.trim(),
    party_phone: form.party ? '' : form.walkin_phone.trim(),
    items: form.items.map((line) => ({
      item: line.item,
      name: line.name.trim(),
      code: line.code,
      unit: line.unit,
      hsn: line.hsn,
      quantity: line.quantity || '0',
      rate: line.rate || '0',
      discount_percent: line.discountMode === 'percent' ? line.discount_percent || '0' : '0',
      discount_amount: line.discountMode === 'amount' ? line.discount_amount || '0' : '0',
      tax_rate: line.tax_rate || '0',
      tax_inclusive: line.tax_inclusive,
    })),
    discount_percent: form.discountMode === 'percent' ? form.discount_percent || '0' : '0',
    discount_amount: form.discountMode === 'amount' ? form.discount_amount || '0' : '0',
    charges_label: form.charges_label.trim(),
    charges_amount: form.charges_amount || '0',
    auto_round_off: form.auto_round_off,
    round_off: form.round_off || '0',
    total: hasItems ? null : form.manual_total || '0',
    received_amount: receivedValue,
    payment_account: form.payment_account,
    payment_reference: selectedAccount?.kind === 'bank' ? form.payment_reference.trim() : '',
    notes: form.notes,
    terms: form.terms,
    attachment_ids: form.attachments.map((a) => a.id),
  })

  const save = async (then) => {
    const clientErrors = validate()
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) {
      toast.error(Object.values(clientErrors)[0])
      return
    }
    setSaving(true)
    savingRef.current = true
    try {
      const saved = editing
        ? await api.put(`${cfg.api}/${id}/`, buildBody())
        : await api.post(`${cfg.api}/`, buildBody())
      invalidate()
      setDirty(false)
      if (then === 'new') {
        toast.success(`${cfg.title} ${saved.number} saved.`)
        if (editing) {
          navigate(`${cfg.base}/new`, { replace: true })
        } else {
          setForm({ ...emptyForm(settings), payment_account: form.payment_account })
          setErrors({})
          nextNumber.refetch()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      } else {
        toast.success(`${cfg.title} ${saved.number} ${editing ? 'updated' : 'saved'}.`)
        const suffix = then === 'print' ? '?print=1' : then === 'share' ? '?share=1' : ''
        navigate(`${cfg.base}/${saved.id}${suffix}`, { replace: true })
      }
    } catch (error) {
      setErrors(error.errors || {})
      toast.error(error)
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  const editingLine = editingIndex !== null ? form.items[editingIndex] : null

  return (
    <Page
      title={editing ? `Edit ${cfg.title}` : cfg.title}
      subtitle={editing ? form.number : undefined}
      back
      maxWidth="max-w-6xl"
      footer={(
        <>
          <Button
            variant="ghost"
            className="hidden lg:inline-flex"
            onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate(cfg.base))}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button variant="secondary" className="flex-1 lg:flex-none" onClick={() => save('new')} disabled={saving}>Save &amp; New</Button>
          <div className="hidden flex-1 lg:block" />
          <Button className="flex-[1.4] lg:min-w-40 lg:flex-none" loading={saving} onClick={() => save('view')}>Save</Button>
          <Menu
            trigger={({ toggle }) => (
              <Button variant="ghost" size="icon" aria-label="More save options" onClick={toggle} disabled={saving}>
                <EllipsisVertical className="size-5" />
              </Button>
            )}
            items={[
              { label: 'Save & Print', icon: Printer, onClick: () => save('print') },
              { label: 'Save & Share', icon: Share2, onClick: () => save('share') },
            ]}
          />
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        {/* number, date, party */}
        <section className="card min-w-0 overflow-visible lg:col-start-1">
          <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
            <button type="button" onClick={() => { setNumberOpen(true); setTimeout(() => numberRef.current?.focus(), 50) }} className="min-w-0 px-4 py-3 text-left transition hover:bg-muted">
              <span className="block text-xs text-ink-3">{cfg.numberLabel}</span>
              <span className="flex min-w-0 items-center gap-1 text-[15px] font-semibold text-ink">
                <span className="truncate">{displayNumber}</span> <ChevronDown className="size-4 shrink-0 text-ink-3" />
              </span>
              {errors.number && <span className="block text-xs text-neg">{errors.number}</span>}
            </button>
            <label className="block min-w-0 px-4 py-3">
              <span className="block text-xs text-ink-3">Date</span>
              <input
                type="date"
                value={form.date}
                max="9999-12-31"
                onChange={(e) => update({ date: e.target.value || todayISO() })}
                className="w-full min-w-0 bg-transparent text-[15px] font-semibold text-ink outline-none"
              />
            </label>
          </div>
          <div className="space-y-3 p-4">
            <PartyPicker
              label={cfg.party}
              required={needsParty}
              partyType={cfg.partyType}
              listAll
              value={form.party}
              error={errors.party}
              onChange={(party) => update((current) => withParty(current, party))}
            />
            {!form.party && !needsParty && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Billing name (optional)">
                  <TextInput value={form.walkin_name} placeholder={kind === 'sale' ? 'Cash Sale' : 'Cash Purchase'} onChange={(e) => update({ walkin_name: e.target.value })} />
                </Field>
                <Field label="Mobile (optional)" error={errors.party_phone}>
                  <TextInput type="tel" inputMode="tel" value={form.walkin_phone} onChange={(e) => update({ walkin_phone: e.target.value })} />
                </Field>
              </div>
            )}
          </div>
        </section>

        {/* items */}
        <section className="card min-w-0 overflow-hidden lg:col-start-1">
          {hasItems ? (
            <>
              <div className="flex items-center justify-between gap-3 bg-brand-soft px-4 py-2.5">
                <p className="text-sm font-semibold text-brand-ink">Billed Items · {form.items.length}</p>
                <Button size="sm" variant="primary" icon={Plus} onClick={() => setPickerOpen(true)}>Add Items</Button>
              </div>
              <div className="space-y-2 p-3 lg:hidden">
                {form.items.map((line, index) => (
                  <LineCard
                    key={line.key}
                    line={line}
                    index={index}
                    error={fieldError(errors, `items.${index}`)}
                    onOpen={() => setEditingIndex(index)}
                  />
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[560px]">
                  <thead className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
                    <tr>
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">Item</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Rate (₹)</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {form.items.map((line, index) => (
                      <LineRow
                        key={line.key}
                        line={line}
                        index={index}
                        errors={errors}
                        onOpen={() => setEditingIndex(index)}
                        onChange={(next) => update((current) => ({ items: current.items.map((l, i) => (i === index ? next : l)) }))}
                        onRemove={() => update((current) => ({ items: current.items.filter((_, i) => i !== index) }))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-3">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong text-[15px] font-semibold text-brand-ink transition hover:border-brand hover:bg-brand-soft"
              >
                <Plus className="size-5" /> Add Items <span className="font-normal text-ink-3">(Optional)</span>
              </button>
            </div>
          )}
        </section>

        {/* totals & payment */}
        <section className="card min-w-0 space-y-3 p-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          {hasItems && (
            <dl className="space-y-1.5 text-[15px]">
              <div className="flex justify-between"><dt className="text-ink-3">Subtotal</dt><dd className="num text-ink">{formatMoney(totals.subtotal)}</dd></div>
              {toScaled(totals.item_discount, 2) > 0n && <div className="flex justify-between"><dt className="text-ink-3">Item discount</dt><dd className="num text-warn">− {formatMoney(totals.item_discount)}</dd></div>}
              {toScaled(totals.tax_total, 2) > 0n && <div className="flex justify-between"><dt className="text-ink-3">{settings?.tax_label || 'Tax'}</dt><dd className="num text-ink">{formatMoney(totals.tax_total)}</dd></div>}
              {toScaled(totals.discount_amount, 2) > 0n && <div className="flex justify-between"><dt className="text-ink-3">Discount</dt><dd className="num text-warn">− {formatMoney(totals.discount_amount)}</dd></div>}
              {toScaled(totals.charges_amount, 2) > 0n && <div className="flex justify-between"><dt className="text-ink-3">{form.charges_label || 'Other charges'}</dt><dd className="num text-ink">+ {formatMoney(totals.charges_amount)}</dd></div>}
              {toScaled(totals.round_off, 2) !== 0n && <div className="flex justify-between"><dt className="text-ink-3">Round off</dt><dd className="num text-ink">{isPositive(totals.round_off) ? '+ ' : '− '}{formatMoney(totals.round_off, { absolute: true })}</dd></div>}
            </dl>
          )}

          {hasItems && (
            <div className="rounded-xl bg-muted">
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, showAdjustments: !current.showAdjustments }))}
                className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-brand-ink"
                aria-expanded={form.showAdjustments}
              >
                <span>− Discount &amp; + Add amount</span>
                {form.showAdjustments ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
              {form.showAdjustments && (
                <div className="space-y-3 px-3 pb-3">
                  <Field
                    label="Discount on bill"
                    labelRight={<Segmented size="sm" value={form.discountMode} onChange={(value) => update({ discountMode: value })} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: '₹' }]} />}
                  >
                    {form.discountMode === 'percent'
                      ? <NumberInput suffix="%" value={form.discount_percent} onChange={(value) => update({ discount_percent: value })} />
                      : <NumberInput prefix="₹" value={form.discount_amount} onChange={(value) => update({ discount_amount: value })} />}
                  </Field>
                  <div className="grid grid-cols-[1fr_8rem] gap-2">
                    <Field label="Add amount for">
                      <TextInput placeholder="e.g. Transport" value={form.charges_label} onChange={(e) => update({ charges_label: e.target.value })} />
                    </Field>
                    <Field label="Amount">
                      <NumberInput prefix="₹" value={form.charges_amount} onChange={(value) => update({ charges_amount: value })} />
                    </Field>
                  </div>
                  <Switch checked={form.auto_round_off} onChange={(value) => update({ auto_round_off: value })} label="Round off to nearest rupee" />
                  {!form.auto_round_off && (
                    <Field label="Round off (±0.99)">
                      <NumberInput allowNegative value={form.round_off} onChange={(value) => update({ round_off: value })} />
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}

          <div className={`flex items-center justify-between gap-3 ${hasItems ? 'border-t border-line pt-3' : ''}`}>
            <span className="text-base font-semibold text-pos">Total Amount</span>
            {hasItems ? (
              <span className="num text-2xl font-bold text-ink">{formatMoney(totals.total)}</span>
            ) : (
              <NumberInput
                prefix="₹"
                align="right"
                className="w-40 xs:w-44"
                inputClassName="text-lg font-semibold"
                aria-label="Total amount"
                value={form.manual_total}
                error={errors.total}
                onChange={(value) => update({ manual_total: value })}
              />
            )}
          </div>
          {errors.total && <p className="text-sm text-neg">{errors.total}</p>}

          <div className="bill-edge -mx-4" aria-hidden />

          {compareMoney(otherPaid, 0) > 0 && (
            <p className="rounded-lg bg-pos-soft px-3 py-2 text-sm text-pos">
              {formatMoney(otherPaid)} already {kind === 'sale' ? 'received' : 'paid'} through separate payments.
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <Checkbox
              checked={form.receivedChecked}
              onChange={(checked) => update({ receivedChecked: checked, receivedAuto: true, receivedTouched: true, received: checked ? maxReceivable : '' })}
              label={<span className="text-base font-medium">{cfg.paidWord}</span>}
            />
            <NumberInput
              prefix="₹"
              align="right"
              className="w-40 xs:w-44"
              aria-label={`${cfg.paidWord} amount`}
              disabled={!form.receivedChecked}
              value={form.receivedChecked ? (form.receivedAuto ? maxReceivable : form.received) : ''}
              error={errors.received_amount || (receivedTooHigh ? 'too high' : '')}
              onChange={(value) => update({ received: value, receivedAuto: false, receivedTouched: true })}
            />
          </div>
          {(errors.received_amount || receivedTooHigh) && (
            <p className="text-sm text-neg">{errors.received_amount || `${cfg.paidWord} amount cannot be more than ${formatMoney(maxReceivable)}.`}</p>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-base font-semibold text-ink">Balance Due</span>
            <span className={`num text-xl font-bold ${compareMoney(balanceDue, 0) > 0 ? 'text-neg' : 'text-pos'}`}>{formatMoney(balanceDue)}</span>
          </div>

          {/* No Payment Type choice: money received or paid with a bill always goes to the bank account (B). */}
          {errors.payment_account && <p className="text-sm text-neg">{errors.payment_account}</p>}
        </section>

        {/* notes, photo, terms */}
        <section className="card min-w-0 space-y-4 p-4 lg:col-start-1">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Bill Description / Notes" hint="Payment terms, delivery details or special instructions — printed on the bill.">
              <TextArea rows={3} placeholder="Add note" value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
            </Field>
            <Field label="Photo / PDF">
              <AttachmentInput value={form.attachments} onChange={(change) => update((current) => ({ attachments: change(current.attachments) }))} max={5} />
            </Field>
          </div>
          <div className="rounded-xl border border-line">
            <button
              type="button"
              aria-expanded={form.showTerms}
              onClick={() => setForm((current) => ({ ...current, showTerms: !current.showTerms }))}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span>
                <span className="block text-[15px] font-medium text-ink">Bill Terms &amp; Conditions</span>
                <span className="block text-sm text-ink-3">{form.terms ? `${form.terms.split('\n').length} line(s)` : 'None'}</span>
              </span>
              {form.showTerms ? <ChevronUp className="size-4 text-ink-3" /> : <ChevronDown className="size-4 text-ink-3" />}
            </button>
            {form.showTerms && (
              <div className="space-y-2 px-4 pb-4">
                <TextArea rows={4} value={form.terms} onChange={(e) => update({ terms: e.target.value })} />
                {settings?.default_terms && form.terms !== settings.default_terms && (
                  <button type="button" className="text-sm font-medium text-brand-ink" onClick={() => update({ terms: settings.default_terms })}>Use default terms</button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <AddItemSheet open={pickerOpen} onClose={() => setPickerOpen(false)} onAdd={addLine} kind={kind} />

      {editingLine && (
        <LineEditor
          line={editingLine}
          index={editingIndex}
          errors={errors}
          settings={settings}
          onClose={() => setEditingIndex(null)}
          onChange={(next) => update((current) => ({ items: current.items.map((l, i) => (i === editingIndex ? next : l)) }))}
          onRemove={() => {
            update((current) => ({ items: current.items.filter((_, i) => i !== editingIndex) }))
            setEditingIndex(null)
          }}
        />
      )}

      <Modal
        open={numberOpen}
        onClose={() => setNumberOpen(false)}
        title={cfg.numberLabel}
        size="sm"
        footer={(
          <div className="flex w-full gap-3 sm:justify-end">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => { update({ numberEdited: false, number: editing ? bill.number : '' }); setNumberOpen(false) }}>
              {editing ? 'Keep original' : 'Use automatic'}
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setNumberOpen(false)}>Done</Button>
          </div>
        )}
      >
        <Field label="Number" hint={`Numbers are automatic (${nextNumber.data?.number || bill?.number || 'e.g. Bil.1'}). Type your own to change it — it must be unique.`} error={errors.number}>
          <div className="relative">
            <Hash className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <TextInput
              ref={numberRef}
              className="pl-9"
              value={form.numberEdited ? form.number : displayNumber === '…' ? '' : displayNumber}
              onChange={(e) => update({ number: e.target.value, numberEdited: true })}
            />
          </div>
        </Field>
      </Modal>
    </Page>
  )
}
