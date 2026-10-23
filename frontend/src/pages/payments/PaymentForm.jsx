import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Hash, Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router'

import AttachmentInput from '../../components/AttachmentInput.jsx'
import Page from '../../components/layout/Page.jsx'
import { defaultAccountId, useAccounts } from '../../components/pickers/AccountSelect.jsx'
import PartyPicker from '../../components/pickers/PartyPicker.jsx'
import Button from '../../components/ui/Button.jsx'
import { Checkbox, Field, NumberInput, Segmented, TextArea, TextInput } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { Badge, ErrorState, PageLoader, Skeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, todayISO } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import {
  addMoney, compareMoney, formatMoney, fromPaise, isNegative, isPositive, subMoney, toScaled,
} from '../../lib/money.js'
import { PAYMENT_KINDS } from './paymentConfig.js'

const strip = (value) => {
  if (!value) return ''
  const text = String(value)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

function emptyForm() {
  return {
    number: '',
    numberEdited: false,
    date: todayISO(),
    party: null,
    amount: '',
    account: null,
    reference_no: '',
    notes: '',
    attachments: [],
    linkMode: 'auto',
    allocations: {},
  }
}

// Allocation values are kept as the text shown in the inputs ("1500", "0.5"), so
// amounts from the server or FIFO are stripped once here, never while typing.
// `keepZero` keeps bills the user chose with "0" when the amount runs out, so typing the
// amount digit by digit ("8" → "8000") does not drop the later bills from the selection.
function fifo(rows, amount, { keepZero = false } = {}) {
  let remaining = toScaled(amount, 2)
  const result = {}
  for (const row of rows) {
    const available = toScaled(row.balance_due, 2)
    const take = remaining <= 0n ? 0n : available < remaining ? available : remaining
    if (take > 0n) {
      result[row.id] = strip(fromPaise(take))
      remaining -= take
    } else if (keepZero) {
      result[row.id] = '0'
    }
  }
  return result
}

const sumAllocations = (allocations) => fromPaise(Object.values(allocations).reduce((sum, value) => sum + toScaled(value, 2), 0n))

export default function PaymentForm({ kind }) {
  const cfg = PAYMENT_KINDS[kind]
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { settings } = useSession()
  const { toast, confirm } = useUI()
  const invalidate = useInvalidateAll()
  const accounts = useAccounts()

  const [form, setForm] = useState(() => (editing ? null : emptyForm()))
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [numberOpen, setNumberOpen] = useState(false)
  const savingRef = useRef(false)

  const existing = useQuery({ queryKey: [`payment-${kind}`, id, 'edit'], queryFn: () => api.get(`${cfg.api}/${id}/`), enabled: editing, gcTime: 0 })
  const nextNumber = useQuery({ queryKey: ['next-number', cfg.numberType], queryFn: () => api.get('/next-number/', { type: cfg.numberType }), enabled: !editing, staleTime: 0 })

  useEffect(() => {
    if (!editing || !existing.data || form) return
    const p = existing.data
    setForm({
      number: p.number,
      numberEdited: false,
      date: p.date,
      party: p.party_detail,
      amount: strip(p.amount),
      account: p.account,
      reference_no: p.reference_no,
      notes: p.notes,
      attachments: p.attachments,
      linkMode: 'manual',
      allocations: Object.fromEntries(p.allocations.map((a) => [a.bill, strip(a.amount)])),
    })
  }, [editing, existing.data, form])

  useEffect(() => {
    const list = accounts.data?.results
    if (form && !form.account && list?.length) {
      setForm((current) => ({ ...current, account: defaultAccountId(list, settings) }))
    }
  }, [accounts.data, form, settings])

  // Prefill from "Take Payment": ?party=&bill=
  const prefilled = useRef(false)
  const billParam = searchParams.get('bill')
  useEffect(() => {
    if (editing || prefilled.current || !form) return
    prefilled.current = true
    const partyId = searchParams.get('party')
    if (partyId) {
      api.get(`/parties/${partyId}/`).then((party) => setForm((current) => ({ ...current, party }))).catch(() => {})
    }
  }, [editing, form, searchParams])

  const partyId = form?.party?.id
  const pending = useQuery({
    queryKey: ['pending-bills', kind, partyId, id || 'new'],
    queryFn: () => api.get(`/parties/${partyId}/pending-bills/`, { kind, payment: id }),
    enabled: Boolean(partyId),
  })
  const rows = useMemo(() => pending.data?.results || [], [pending.data])

  // When coming from a specific bill, select it with its pending amount
  const billPrefilled = useRef(false)
  useEffect(() => {
    if (editing || billPrefilled.current || !billParam || !rows.length) return
    const row = rows.find((r) => String(r.id) === billParam)
    if (!row) return
    billPrefilled.current = true
    setForm((current) => ({ ...current, linkMode: 'manual', allocations: { [row.id]: strip(row.balance_due) }, amount: strip(row.balance_due) }))
  }, [editing, billParam, rows])

  const update = useCallback((patch) => {
    setForm((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))
    setDirty(true)
  }, [])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savingRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({ title: 'Discard changes?', message: 'This payment has unsaved changes.', confirmText: 'Discard', cancelText: 'Keep editing', tone: 'danger' })
      .then((ok) => (ok ? blocker.proceed() : blocker.reset()))
  }, [blocker, confirm])

  if (editing && existing.isError) return <Page title={cfg.title} back={cfg.base}><ErrorState error={existing.error} onRetry={existing.refetch} /></Page>
  if (!form) return <Page title={cfg.title} back><PageLoader /></Page>

  const payment = existing.data
  const originBill = payment?.origin_bill
  const amount = form.amount || '0'
  const allocations = form.linkMode === 'auto' ? fifo(rows, amount) : form.allocations
  const allocatedTotal = fromPaise(Object.values(allocations).reduce((sum, value) => sum + toScaled(value, 2), 0n))
  const unallocated = subMoney(amount, allocatedTotal)
  const outstanding = pending.data?.outstanding ?? '0.00'
  const selectedAccount = (accounts.data?.results || []).find((a) => a.id === form.account)
  const displayNumber = form.numberEdited ? form.number : editing ? form.number : nextNumber.data?.number || '…'

  // party balance after saving
  let balanceAfter = null
  if (form.party) {
    let base = form.party.balance
    if (editing && payment?.party === form.party.id) {
      base = kind === 'in' ? addMoney(base, payment.amount) : subMoney(base, payment.amount)
    }
    balanceAfter = kind === 'in' ? subMoney(base, amount) : addMoney(base, amount)
  }

  const setAllocation = (billId, value) => update((current) => {
    const next = { ...current.allocations }
    if (value === null) delete next[billId]
    else next[billId] = value
    return { allocations: next, linkMode: 'manual' }
  })

  const validate = () => {
    const next = {}
    if (!form.party && !originBill) next.party = `Please select a ${cfg.party.toLowerCase()}.`
    if (compareMoney(amount, 0) <= 0) next.amount = 'Enter an amount greater than zero.'
    if (compareMoney(allocatedTotal, amount) > 0) next.allocations = `Amounts linked to bills (${formatMoney(allocatedTotal)}) are more than the payment amount.`
    for (const row of rows) {
      const value = allocations[row.id]
      if (value && compareMoney(value, row.balance_due) > 0) next.allocations = `Only ${formatMoney(row.balance_due)} is pending on ${row.number}.`
    }
    return next
  }

  const save = async (then) => {
    const clientErrors = validate()
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) {
      toast.error(Object.values(clientErrors)[0])
      return
    }
    const body = {
      number: form.numberEdited ? form.number.trim() : '',
      date: form.date,
      party: form.party?.id ?? null,
      account: form.account,
      amount,
      reference_no: selectedAccount?.kind === 'bank' ? form.reference_no : '',
      notes: form.notes,
      allocations: form.linkMode === 'auto' && !editing
        ? null
        : Object.entries(allocations).filter(([, value]) => isPositive(value)).map(([bill, value]) => ({ bill: Number(bill), amount: value })),
      auto_allocate: form.linkMode === 'auto',
      // Any amount is saved; the part not linked to a bill stays as an advance.
      allow_advance: true,
      attachment_ids: form.attachments.map((a) => a.id),
    }
    setSaving(true)
    savingRef.current = true
    try {
      const saved = editing ? await api.put(`${cfg.api}/${id}/`, body) : await api.post(`${cfg.api}/`, body)
      invalidate()
      setDirty(false)
      toast.success(`${cfg.documentName} ${saved.number} saved — ${formatMoney(saved.amount)}.`)
      if (then === 'new') {
        if (editing) navigate(`${cfg.base}/new`, { replace: true })
        else {
          setForm({ ...emptyForm(), account: form.account })
          setErrors({})
          nextNumber.refetch()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      } else {
        navigate(`${cfg.base}/${saved.id}`, { replace: true })
      }
    } catch (error) {
      setErrors(error.errors || {})
      toast.error(error)
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  return (
    <Page
      title={editing ? `Edit ${cfg.title}` : cfg.title}
      subtitle={editing ? form.number : undefined}
      back
      maxWidth="max-w-5xl"
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
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <section className="card overflow-visible">
            <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
              <button type="button" onClick={() => setNumberOpen(true)} className="px-4 py-3 text-left transition hover:bg-muted">
                <span className="block text-xs text-ink-3">{cfg.numberLabel}</span>
                <span className="flex items-center gap-1 text-[15px] font-semibold text-ink">{displayNumber} <ChevronDown className="size-4 text-ink-3" /></span>
                {errors.number && <span className="block text-xs text-neg">{errors.number}</span>}
              </button>
              <label className="block px-4 py-3">
                <span className="block text-xs text-ink-3">Date</span>
                <input type="date" value={form.date} onChange={(e) => update({ date: e.target.value || todayISO() })} className="w-full bg-transparent text-[15px] font-semibold text-ink outline-none" />
              </label>
            </div>
            <div className="space-y-4 p-4">
              {originBill ? (
                <div className="rounded-xl bg-muted px-4 py-3 text-[15px]">
                  <p className="font-semibold text-ink">{payment.party_name}</p>
                  <p className="text-sm text-ink-3">
                    Recorded with {cfg.billWord} <Link className="font-medium text-brand-ink" to={`${cfg.billBase}/${originBill.id}`}>{originBill.number}</Link>.
                    {originBill.mode === 'cash' ? ' Edit that bill to change the amount.' : ''}
                  </p>
                </div>
              ) : (
                <PartyPicker
                  label={`${cfg.party} Name`}
                  required
                  partyType="any"
                  value={form.party}
                  error={errors.party}
                  onChange={(party) => update({ party, allocations: {}, linkMode: 'auto' })}
                />
              )}

              <div className="flex items-end justify-between gap-4">
                <Field label={cfg.amountLabel} className="flex-1" error={errors.amount}>
                  <NumberInput
                    prefix="₹"
                    align="right"
                    inputClassName="h-14 text-2xl font-semibold"
                    value={form.amount}
                    error={errors.amount}
                    disabled={originBill?.mode === 'cash'}
                    onChange={(value) => update((current) => {
                      // Bills can only be re-split once the pending list has loaded; until then keep the links.
                      if (current.linkMode !== 'manual' || !pending.isSuccess) return { amount: value }
                      // keep chosen bills in step with the amount unless the user split it differently
                      const linked = sumAllocations(current.allocations)
                      if (compareMoney(linked, current.amount || '0') === 0 || compareMoney(linked, value || '0') > 0) {
                        const listed = new Set(rows.map((row) => String(row.id)))
                        const kept = Object.fromEntries(Object.entries(current.allocations).filter(([billId]) => !listed.has(billId)))
                        const room = subMoney(value || '0', sumAllocations(kept))
                        const chosen = rows.filter((row) => current.allocations[row.id] !== undefined)
                        return { amount: value, allocations: { ...kept, ...fifo(chosen, compareMoney(room, 0) > 0 ? room : '0', { keepZero: true }) } }
                      }
                      return { amount: value }
                    })}
                    aria-label={`${cfg.amountLabel} amount`}
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-pos-soft/60 px-4 py-2.5">
                <span className="font-medium text-pos">Total Amount</span>
                <span className="num text-lg font-semibold text-pos">{formatMoney(amount)}</span>
              </div>
              {form.party && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="text-ink-3">{kind === 'in' ? 'Pending from party' : 'Pending to party'}</p>
                    <p className="num font-semibold text-ink">{formatMoney(outstanding)}</p>
                  </div>
                  <div className="rounded-xl border border-line px-3 py-2">
                    <p className="text-ink-3">Balance after this</p>
                    <p className={`num font-semibold ${isPositive(balanceAfter) ? 'text-pos' : isNegative(balanceAfter) ? 'text-neg' : 'text-ink'}`}>
                      {formatMoney(balanceAfter, { absolute: true })}
                      <span className="ml-1 text-xs font-normal text-ink-3">{isPositive(balanceAfter) ? "You'll Get" : isNegative(balanceAfter) ? "You'll Give" : 'Settled'}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {form.party && !originBill && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">Against Bills</h2>
                  <p className="text-sm text-ink-3">Which {cfg.billWord}s does this payment settle?</p>
                </div>
                {rows.length > 0 && (
                  <Segmented
                    size="sm"
                    value={form.linkMode}
                    onChange={(linkMode) => update((current) => ({ linkMode, allocations: linkMode === 'manual' ? fifo(rows, current.amount || '0') : {} }))}
                    options={[{ value: 'auto', label: 'Oldest first' }, { value: 'manual', label: 'Choose bills' }]}
                  />
                )}
              </div>
              {pending.isPending ? (
                <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              ) : rows.length === 0 ? (
                <p className="px-4 py-4 text-[15px] text-ink-3">No pending {cfg.billWord}s for this {cfg.party.toLowerCase()}. The payment will be recorded against the party balance.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {rows.map((row) => {
                    const value = allocations[row.id]
                    const checked = Boolean(value) && isPositive(value)
                    return (
                      <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                        <Checkbox
                          checked={checked}
                          disabled={form.linkMode === 'auto'}
                          onChange={(on) => {
                            if (!on) return setAllocation(row.id, null)
                            const room = subMoney(amount, fromPaise(Object.entries(allocations).filter(([key]) => key !== String(row.id)).reduce((s, [, v]) => s + toScaled(v, 2), 0n)))
                            const fill = compareMoney(room, 0) > 0 ? (compareMoney(room, row.balance_due) < 0 ? room : row.balance_due) : row.balance_due
                            return setAllocation(row.id, strip(fill))
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
                            <Link to={`${cfg.billBase}/${row.id}`} className="hover:underline">{row.number}</Link>
                            {row.is_overdue && <Badge tone="neg">Overdue</Badge>}
                          </p>
                          <p className="text-sm text-ink-3">{formatDate(row.date)} · Total {formatMoney(row.total)} · Pending <span className="text-neg">{formatMoney(row.balance_due)}</span></p>
                        </div>
                        {form.linkMode === 'manual' ? (
                          <NumberInput
                            className="w-32"
                            align="right"
                            aria-label={`Amount for ${row.number}`}
                            value={value ?? ''}
                            placeholder="0"
                            onChange={(next) => setAllocation(row.id, next || null)}
                          />
                        ) : (
                          <span className={`num w-28 text-right font-semibold ${checked ? 'text-pos' : 'text-ink-3'}`}>{checked ? formatMoney(value) : '—'}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {rows.length > 0 && (
                <div className="space-y-1 border-t border-line bg-muted px-4 py-3 text-sm">
                  <div className="flex justify-between"><span className="text-ink-3">Linked to bills</span><span className="num font-medium text-ink">{formatMoney(allocatedTotal)}</span></div>
                  {compareMoney(unallocated, 0) !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-ink-3">{isNegative(unallocated) ? 'Over-linked' : 'Not linked (advance)'}</span>
                      <span className={`num font-medium ${isNegative(unallocated) ? 'text-neg' : 'text-warn'}`}>{formatMoney(unallocated, { absolute: true })}</span>
                    </div>
                  )}
                  {errors.allocations && <p className="text-neg">{errors.allocations}</p>}
                </div>
              )}
            </section>
          )}

        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-20">
          <section className="card space-y-4 p-4">
            {/* No Payment Type choice: every payment in or out goes through the bank account (B). */}
            {errors.account && <p className="text-sm text-neg">{errors.account}</p>}
            <Field label="Description">
              <TextArea rows={3} placeholder="Add Note" value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
            </Field>
            <Field label="Payment proof" hint="Bank screenshot, receipt photo or PDF (JPG, PNG, WEBP, PDF)">
              <AttachmentInput value={form.attachments} onChange={(change) => update((current) => ({ attachments: change(current.attachments) }))} />
            </Field>
          </section>
          <p className="flex gap-2 px-1 text-sm text-ink-3">
            <Info className="mt-0.5 size-4 shrink-0" />
            Saving updates the {cfg.party.toLowerCase()} balance, bill pending amounts, {selectedAccount?.kind === 'bank' ? selectedAccount.name : 'cash'} balance, ledger and reports.
          </p>
        </div>
      </div>

      <Modal
        open={numberOpen}
        onClose={() => setNumberOpen(false)}
        title={cfg.numberLabel}
        size="sm"
        footer={(
          <div className="flex w-full gap-3 sm:justify-end">
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => { update({ numberEdited: false, number: editing ? payment.number : '' }); setNumberOpen(false) }}>
              {editing ? 'Keep original' : 'Use automatic'}
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setNumberOpen(false)}>Done</Button>
          </div>
        )}
      >
        <Field label="Number" hint="Numbers are automatic. Type your own to change it — it must be unique." error={errors.number}>
          <div className="relative">
            <Hash className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <TextInput autoFocus className="pl-9" value={form.numberEdited ? form.number : displayNumber === '…' ? '' : displayNumber} onChange={(e) => update({ number: e.target.value, numberEdited: true })} />
          </div>
        </Field>
      </Modal>
    </Page>
  )
}
