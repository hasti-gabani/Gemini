import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'

import Button from '../../components/ui/Button.jsx'
import { DateInput, Field, NumberInput, Switch, TextArea, TextInput } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api, fieldError } from '../../lib/api.js'
import { todayISO } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { fromScaled, isValidNumber, toScaled } from '../../lib/money.js'
import { autoAccountName, moneyInput } from './shared.jsx'

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_NUMBER_RE = /^[A-Za-z0-9]{4,30}$/
const UPI_RE = /^[\w.-]{2,}@[a-zA-Z][a-zA-Z0-9]+$/
const TOO_LARGE = 10n ** 14n

const BANK_FIELDS = ['bank_name', 'account_name', 'account_number', 'ifsc', 'branch', 'upi_id', 'opening_balance', 'opening_date', 'notes', 'name', 'is_default', 'print_on_invoice']
const CASH_FIELDS = ['opening_balance', 'opening_date', 'notes']

const COMMON_BANKS = [
  'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Bank of Baroda',
  'Punjab National Bank', 'Union Bank of India', 'Canara Bank', 'Bank of India', 'Central Bank of India', 'Indian Bank',
  'IDBI Bank', 'IDFC FIRST Bank', 'IndusInd Bank', 'Yes Bank', 'Federal Bank', 'AU Small Finance Bank',
  'Kalupur Commercial Co-operative Bank', 'Rajkot Nagarik Sahakari Bank',
]

function bankForm(account, business, isFirstBank) {
  if (!account) {
    return {
      bank_name: '', account_name: business?.name || '', account_number: '', ifsc: '', branch: '', upi_id: '',
      opening_balance: '', opening_date: todayISO(), notes: '', name: '',
      is_default: isFirstBank, print_on_invoice: isFirstBank,
    }
  }
  const auto = autoAccountName(account.bank_name, account.account_number)
  return {
    bank_name: account.bank_name || '',
    account_name: account.account_name || '',
    account_number: account.account_number || '',
    ifsc: account.ifsc || '',
    branch: account.branch || '',
    upi_id: account.upi_id || '',
    opening_balance: moneyInput(account.opening_balance),
    opening_date: account.opening_date || todayISO(),
    notes: account.notes || '',
    // keep the name blank while it is the automatic one, so it follows bank / number changes
    name: account.name === auto ? '' : account.name || '',
    is_default: Boolean(account.is_default),
    print_on_invoice: Boolean(account.print_on_invoice),
  }
}

/** Same shape as the bank form so inputs always stay controlled. */
function cashForm(account) {
  return {
    ...bankForm(null, null, false),
    opening_balance: moneyInput(account?.opening_balance),
    opening_date: account?.opening_date || todayISO(),
    notes: account?.notes || '',
  }
}

function validateOpening(form, errors) {
  if (form.opening_balance !== '') {
    if (!isValidNumber(form.opening_balance)) errors.opening_balance = 'Enter a valid amount.'
    else {
      const scaled = toScaled(form.opening_balance, 2)
      if ((scaled < 0n ? -scaled : scaled) >= TOO_LARGE) errors.opening_balance = 'Amount is too large.'
    }
  }
  if (!form.opening_date) errors.opening_date = 'Choose the date of this balance.'
  return errors
}

function validateBank(form) {
  const errors = {}
  if (!form.bank_name.trim()) errors.bank_name = 'Bank name is required.'
  const number = form.account_number.replace(/\s+/g, '')
  if (number && !ACCOUNT_NUMBER_RE.test(number)) errors.account_number = 'Enter a valid account number (4 to 30 letters or digits).'
  if (form.ifsc && !IFSC_RE.test(form.ifsc)) errors.ifsc = 'Enter a valid 11-character IFSC code (e.g. HDFC0001234).'
  if (form.upi_id.trim() && !UPI_RE.test(form.upi_id.trim())) errors.upi_id = 'Enter a valid UPI ID (e.g. business@okhdfcbank).'
  return validateOpening(form, errors)
}

const amount = (value) => (isValidNumber(value) ? fromScaled(toScaled(value, 2), 2) : '0.00')

/** Add / edit a bank account. For the Cash in Hand account it edits the opening cash only. */
export default function BankAccountDialog({ open, onClose, account = null, isFirstBank = false, onSaved }) {
  const isCash = account?.kind === 'cash'
  const editing = Boolean(account)
  const { business } = useSession()
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const uid = useId()
  const formId = `${uid}form`
  const [form, setForm] = useState(() => (isCash ? cashForm(account) : bankForm(account, business, isFirstBank)))
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setForm(isCash ? cashForm(account) : bankForm(account, business, isFirstBank))
    setErrors({})
    // reset only when the dialog opens or switches account, never on background refetches
  }, [open, account?.id])

  const save = useMutation({
    mutationFn: (body) => (editing ? api.patch(`/accounts/${account.id}/`, body) : api.post('/accounts/', body)),
    onSuccess: (saved) => {
      invalidate()
      toast.success(isCash ? 'Opening cash updated.' : editing ? 'Bank account updated.' : `${saved.name} added.`)
      onSaved?.(saved)
      onClose()
    },
    onError: (error) => {
      const serverErrors = error.errors || {}
      setErrors(serverErrors)
      if (!(isCash ? CASH_FIELDS : BANK_FIELDS).some((field) => serverErrors[field])) toast.error(error)
    },
  })

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => (current[key] ? { ...current, [key]: '' } : current))
  }
  const err = (key) => fieldError(errors, key)

  const submit = (event) => {
    event.preventDefault()
    if (save.isPending) return
    const clientErrors = isCash ? validateOpening(form, {}) : validateBank(form)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) return
    if (isCash) {
      save.mutate({ opening_balance: amount(form.opening_balance), opening_date: form.opening_date, notes: form.notes.trim() })
      return
    }
    save.mutate({
      bank_name: form.bank_name.trim(),
      account_name: form.account_name.trim(),
      account_number: form.account_number.replace(/\s+/g, '').toUpperCase(),
      ifsc: form.ifsc.trim().toUpperCase(),
      branch: form.branch.trim(),
      upi_id: form.upi_id.trim(),
      opening_balance: amount(form.opening_balance),
      opening_date: form.opening_date,
      notes: form.notes.trim(),
      name: form.name.trim(),
      is_default: form.is_default,
      print_on_invoice: form.print_on_invoice,
    })
  }

  const title = isCash ? 'Edit opening cash' : editing ? 'Edit bank account' : 'Add bank account'
  const subtitle = isCash ? account.name : editing ? account.name : 'Receive and make payments by bank or UPI'

  return (
    <Modal
      open={open}
      onClose={() => !save.isPending && onClose()}
      title={title}
      subtitle={subtitle}
      size={isCash ? 'sm' : 'lg'}
      footer={(
        <div className="flex gap-3 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form={formId} className="flex-1 sm:min-w-28 sm:flex-none" loading={save.isPending}>
            {editing ? 'Save' : 'Add account'}
          </Button>
        </div>
      )}
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-5">
        {isCash ? (
          <div className="space-y-4">
            <Field
              label="Opening cash"
              htmlFor={`${uid}opening`}
              error={err('opening_balance')}
              hint="Cash you had on the date below. The current balance is recalculated from it."
            >
              <NumberInput
                id={`${uid}opening`}
                data-autofocus
                prefix="₹"
                placeholder="0.00"
                value={form.opening_balance}
                error={err('opening_balance')}
                onChange={(value) => set('opening_balance', value)}
              />
            </Field>
            <Field label="As of date" required htmlFor={`${uid}date`} error={err('opening_date')}>
              <DateInput
                id={`${uid}date`}
                value={form.opening_date}
                error={err('opening_date')}
                onChange={(event) => set('opening_date', event.target.value)}
              />
            </Field>
            <Field label="Notes" htmlFor={`${uid}notes`} error={err('notes')}>
              <TextArea
                id={`${uid}notes`}
                rows={2}
                maxLength={2000}
                value={form.notes}
                error={err('notes')}
                onChange={(event) => set('notes', event.target.value)}
              />
            </Field>
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Bank details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bank Name" required htmlFor={`${uid}bank`} error={err('bank_name')} className="sm:col-span-2">
                  <TextInput
                    id={`${uid}bank`}
                    list={`${uid}banks`}
                    data-autofocus
                    maxLength={120}
                    autoComplete="off"
                    placeholder="e.g. HDFC Bank"
                    value={form.bank_name}
                    error={err('bank_name')}
                    onChange={(event) => set('bank_name', event.target.value)}
                  />
                  <datalist id={`${uid}banks`}>
                    {COMMON_BANKS.map((bank) => <option key={bank} value={bank} />)}
                  </datalist>
                </Field>
                <Field label="Account Holder Name" htmlFor={`${uid}holder`} error={err('account_name')} className="sm:col-span-2">
                  <TextInput
                    id={`${uid}holder`}
                    maxLength={120}
                    autoComplete="off"
                    value={form.account_name}
                    error={err('account_name')}
                    onChange={(event) => set('account_name', event.target.value)}
                  />
                </Field>
                <Field label="Account Number" htmlFor={`${uid}number`} error={err('account_number')}>
                  <TextInput
                    id={`${uid}number`}
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. 50200012345678"
                    value={form.account_number}
                    error={err('account_number')}
                    onChange={(event) => set('account_number', event.target.value)}
                  />
                </Field>
                <Field label="IFSC Code" htmlFor={`${uid}ifsc`} error={err('ifsc')}>
                  <TextInput
                    id={`${uid}ifsc`}
                    maxLength={11}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="e.g. HDFC0001234"
                    value={form.ifsc}
                    error={err('ifsc')}
                    onChange={(event) => set('ifsc', event.target.value.toUpperCase().replace(/\s+/g, ''))}
                  />
                </Field>
                <Field label="Branch" htmlFor={`${uid}branch`} error={err('branch')}>
                  <TextInput
                    id={`${uid}branch`}
                    maxLength={120}
                    value={form.branch}
                    error={err('branch')}
                    onChange={(event) => set('branch', event.target.value)}
                  />
                </Field>
                <Field label="UPI ID" htmlFor={`${uid}upi`} error={err('upi_id')}>
                  <TextInput
                    id={`${uid}upi`}
                    maxLength={80}
                    inputMode="email"
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. business@okhdfcbank"
                    value={form.upi_id}
                    error={err('upi_id')}
                    onChange={(event) => set('upi_id', event.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Opening balance</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Opening Balance"
                  htmlFor={`${uid}opening`}
                  error={err('opening_balance')}
                  hint="Use a minus sign for an overdraft (OD/CC) balance."
                >
                  <NumberInput
                    id={`${uid}opening`}
                    prefix="₹"
                    allowNegative
                    placeholder="0.00"
                    value={form.opening_balance}
                    error={err('opening_balance')}
                    onChange={(value) => set('opening_balance', value)}
                  />
                </Field>
                <Field label="As of date" required htmlFor={`${uid}date`} error={err('opening_date')}>
                  <DateInput
                    id={`${uid}date`}
                    value={form.opening_date}
                    error={err('opening_date')}
                    onChange={(event) => set('opening_date', event.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Invoices</h3>
              <Field label="Notes" htmlFor={`${uid}notes`} error={err('notes')}>
                <TextArea
                  id={`${uid}notes`}
                  rows={2}
                  maxLength={2000}
                  value={form.notes}
                  error={err('notes')}
                  onChange={(event) => set('notes', event.target.value)}
                />
              </Field>
              <div className="divide-y divide-line rounded-xl border border-line">
                <Switch
                  className="px-4 py-3"
                  checked={form.is_default}
                  onChange={(value) => set('is_default', value)}
                  label="Default account for bank payments"
                  description="Selected first when money is received or paid by bank."
                />
                <Switch
                  className="px-4 py-3"
                  checked={form.print_on_invoice}
                  onChange={(value) => set('print_on_invoice', value)}
                  label="Print bank details on invoices"
                  description="Account number, IFSC and UPI ID appear on your bills. If several accounts are marked, the default one is printed."
                />
              </div>
            </section>
          </>
        )}
      </form>
    </Modal>
  )
}
