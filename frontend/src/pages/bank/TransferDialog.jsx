import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'

import Button from '../../components/ui/Button.jsx'
import { DateInput, Field, NumberInput, Select, TextInput } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { ErrorState, Skeleton } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api, fieldError } from '../../lib/api.js'
import { todayISO } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { compareMoney, formatMoney, fromScaled, isValidNumber, toScaled } from '../../lib/money.js'
import { ADJUSTMENT_TYPES, adjustmentType, moneyInput, useAccounts } from './shared.jsx'

const FIELDS = ['txn_type', 'date', 'amount', 'from_account', 'to_account', 'description', 'reference_no']
const TOO_LARGE = 10n ** 14n

const EMPTY = { txn_type: 'add', from_account: '', to_account: '', amount: '', date: '', description: '', reference_no: '' }

/** Which sides each type uses, their labels and the message when one is missing. */
const SIDES = {
  transfer: {
    from: { label: 'From account', missing: 'Choose the account to transfer from.' },
    to: { label: 'To account', missing: 'Choose the account to transfer to.' },
  },
  deposit: {
    from: { label: 'From', missing: 'Deposits move money from Cash in Hand.' },
    to: { label: 'Deposit to bank', missing: 'Choose the bank account receiving the deposit.' },
  },
  withdraw: {
    from: { label: 'Withdraw from bank', missing: 'Choose the bank account to withdraw from.' },
    to: { label: 'To', missing: 'Withdrawals move money into Cash in Hand.' },
  },
  add: {
    to: { label: 'Add money to', missing: 'Choose the account to add money to.' },
  },
  reduce: {
    from: { label: 'Reduce money from', missing: 'Choose the account to reduce money from.' },
  },
}

const SUCCESS = {
  transfer: 'Transfer saved.',
  deposit: 'Cash deposit saved.',
  withdraw: 'Cash withdrawal saved.',
  add: 'Money added.',
  reduce: 'Money reduced.',
}

/** Accounts allowed on each side (mirrors banking.services.validate_adjustment_accounts). */
function allowedAccounts(type, accounts, fromId) {
  const cash = accounts.filter((account) => account.kind === 'cash')
  const banks = accounts.filter((account) => account.kind === 'bank')
  switch (type) {
    case 'deposit': return { from: cash, to: banks }
    case 'withdraw': return { from: banks, to: cash }
    case 'transfer': return { from: accounts, to: accounts.filter((account) => String(account.id) !== fromId) }
    case 'add': return { from: [], to: banks }
    case 'reduce': return { from: banks, to: [] }
    default: return { from: [], to: [] }
  }
}

/** Sensible from/to for a type: the account the dialog was opened from, then the current choice, then defaults. */
function pickAccounts(type, accounts, context, current = {}) {
  const ids = (list) => list.map((account) => String(account.id))
  const contextId = context ? String(context.id) : ''
  const bank = accounts.find((account) => account.kind === 'bank' && account.is_default) || accounts.find((account) => account.kind === 'bank')
  const bankId = bank ? String(bank.id) : ''
  const cash = accounts.find((account) => account.kind === 'cash')
  const cashId = cash ? String(cash.id) : ''
  const choose = (allowed, ...candidates) => candidates.find((id) => id && allowed.includes(id)) || (allowed.length === 1 ? allowed[0] : '')

  const sides = SIDES[type] || {}
  let from = ''
  let to = ''
  const fromAllowed = ids(allowedAccounts(type, accounts, '').from)
  if (type === 'deposit') {
    from = choose(fromAllowed)
    to = choose(ids(allowedAccounts(type, accounts, from).to), contextId, current.to_account, current.from_account, bankId)
  } else if (type === 'withdraw') {
    from = choose(fromAllowed, contextId, current.from_account, current.to_account, bankId)
    to = choose(ids(allowedAccounts(type, accounts, from).to))
  } else if (type === 'transfer') {
    from = choose(fromAllowed, contextId, current.from_account, bankId, cashId)
    to = choose(ids(allowedAccounts(type, accounts, from).to), current.to_account)
  } else if (type === 'add') {
    to = choose(ids(allowedAccounts(type, accounts, '').to), contextId, current.to_account, current.from_account, cashId)
  } else if (type === 'reduce') {
    from = choose(fromAllowed, contextId, current.from_account, current.to_account, cashId)
  }
  return { from_account: sides.from ? from : '', to_account: sides.to ? to : '' }
}

function validate(form) {
  const errors = {}
  const sides = SIDES[form.txn_type] || {}
  if (!isValidNumber(form.amount) || toScaled(form.amount, 2) <= 0n) errors.amount = 'Enter an amount greater than zero.'
  else if (toScaled(form.amount, 2) >= TOO_LARGE) errors.amount = 'Amount is too large.'
  if (!form.date) errors.date = 'Choose a date.'
  if (sides.from && !form.from_account) errors.from_account = sides.from.missing
  if (sides.to && !form.to_account) errors.to_account = sides.to.missing
  if (form.txn_type === 'transfer' && form.from_account && form.from_account === form.to_account) {
    errors.to_account = 'Choose two different accounts.'
  }
  return errors
}

/**
 * Manual money movement between Cash in Hand and bank accounts: transfer, deposit, withdrawal,
 * add or reduce. Pass `adjustment` (from GET /bank-adjustments/:id/) to edit, `account` to preselect.
 */
export default function TransferDialog({ open, onClose, adjustment = null, account = null, initialType }) {
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const uid = useId()
  const formId = `${uid}form`
  const editing = Boolean(adjustment)
  const accountsQuery = useAccounts({ enabled: open })
  const accounts = accountsQuery.data?.results || []
  const hasBanks = accounts.some((item) => item.kind === 'bank')
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) {
      setReady(false)
      return
    }
    if (ready || !accountsQuery.data) return
    const list = accountsQuery.data.results || []
    if (adjustment) {
      setForm({
        txn_type: adjustment.txn_type,
        from_account: adjustment.from_account ? String(adjustment.from_account) : '',
        to_account: adjustment.to_account ? String(adjustment.to_account) : '',
        amount: moneyInput(adjustment.amount),
        date: adjustment.date || todayISO(),
        description: adjustment.description || '',
        reference_no: adjustment.reference_no || '',
      })
    } else {
      const banksExist = list.some((item) => item.kind === 'bank')
      const wanted = ADJUSTMENT_TYPES.find((type) => type.value === initialType)
      const type = wanted && (banksExist || !wanted.needsBank) ? wanted.value : 'add'
      setForm({ ...EMPTY, txn_type: type, ...pickAccounts(type, list, account), date: todayISO() })
    }
    setErrors({})
    setReady(true)
  }, [open, ready, accountsQuery.data, adjustment, account, initialType])

  const save = useMutation({
    mutationFn: (body) => (editing ? api.patch(`/bank-adjustments/${adjustment.id}/`, body) : api.post('/bank-adjustments/', body)),
    onSuccess: (saved) => {
      invalidate()
      toast.success(editing ? 'Entry updated.' : SUCCESS[saved?.txn_type] || 'Saved.')
      onClose()
    },
    onError: (error) => {
      const serverErrors = error.errors || {}
      setErrors(serverErrors)
      if (!FIELDS.some((field) => serverErrors[field])) toast.error(error)
    },
  })

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => (current[key] ? { ...current, [key]: '' } : current))
  }

  const changeType = (type) => {
    setForm((current) => ({ ...current, txn_type: type, ...pickAccounts(type, accounts, account, current) }))
    setErrors({})
  }

  const changeFrom = (value) => {
    setForm((current) => ({
      ...current,
      from_account: value,
      to_account: current.txn_type === 'transfer' && current.to_account === value ? '' : current.to_account,
    }))
    setErrors((current) => ({ ...current, from_account: '', to_account: '' }))
  }

  const submit = (event) => {
    event.preventDefault()
    if (!ready || save.isPending) return
    const clientErrors = validate(form)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) return
    const sides = SIDES[form.txn_type]
    save.mutate({
      txn_type: form.txn_type,
      date: form.date,
      amount: fromScaled(toScaled(form.amount, 2), 2),
      from_account: sides.from ? Number(form.from_account) : null,
      to_account: sides.to ? Number(form.to_account) : null,
      description: form.description.trim(),
      reference_no: form.reference_no.trim(),
    })
  }

  const err = (key) => fieldError(errors, key)
  const type = adjustmentType(form.txn_type)
  const sides = SIDES[form.txn_type] || {}
  const allowed = allowedAccounts(form.txn_type, accounts, form.from_account)
  const toOption = (item) => ({ value: String(item.id), label: item.name })
  const findAccount = (id) => accounts.find((item) => String(item.id) === id)
  const fromAccount = findAccount(form.from_account)
  const toAccount = findAccount(form.to_account)
  const overBalance = !editing && sides.from && fromAccount && isValidNumber(form.amount)
    && toScaled(form.amount, 2) > 0n && compareMoney(form.amount, fromAccount.current_balance) > 0
  const single = !(sides.from && sides.to)

  let body
  if (accountsQuery.isError) {
    body = <ErrorState error={accountsQuery.error} onRetry={accountsQuery.refetch} />
  } else if (!ready) {
    body = (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-20" />
        <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      </div>
    )
  } else {
    body = (
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <div>
          <p id={`${uid}type`} className="mb-2 text-sm font-medium text-ink-2">Type</p>
          <div role="radiogroup" aria-labelledby={`${uid}type`} className="flex flex-wrap gap-2">
            {ADJUSTMENT_TYPES.map((option) => {
              const selected = option.value === form.txn_type
              const disabled = Boolean(option.needsBank) && !hasBanks
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  title={option.label}
                  onClick={() => changeType(option.value)}
                  className={`flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-card text-ink-2 hover:border-line-strong hover:text-ink'}`}
                >
                  <option.icon className="size-4 shrink-0" aria-hidden />
                  {option.short}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-sm text-ink-3">
            <span className="font-medium text-ink-2">{type.label}.</span> {type.hint}
          </p>
          {!hasBanks && (
            <p className="mt-1 text-sm text-ink-3">Add a bank account to transfer, deposit or withdraw cash.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {sides.from && (
            <Field
              label={sides.from.label}
              required
              htmlFor={`${uid}from`}
              error={err('from_account')}
              hint={fromAccount ? `Balance ${formatMoney(fromAccount.current_balance)}` : undefined}
              className={single ? 'sm:col-span-2' : ''}
            >
              <Select
                id={`${uid}from`}
                value={form.from_account}
                placeholder={allowed.from.length === 1 ? undefined : 'Select account'}
                options={allowed.from.map(toOption)}
                disabled={form.txn_type === 'deposit'}
                error={err('from_account')}
                onChange={(event) => changeFrom(event.target.value)}
              />
            </Field>
          )}
          {sides.to && (
            <Field
              label={sides.to.label}
              required
              htmlFor={`${uid}to`}
              error={err('to_account')}
              hint={toAccount ? `Balance ${formatMoney(toAccount.current_balance)}` : undefined}
              className={single ? 'sm:col-span-2' : ''}
            >
              <Select
                id={`${uid}to`}
                value={form.to_account}
                placeholder={allowed.to.length === 1 ? undefined : 'Select account'}
                options={allowed.to.map(toOption)}
                disabled={form.txn_type === 'withdraw'}
                error={err('to_account')}
                onChange={(event) => set('to_account', event.target.value)}
              />
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" required htmlFor={`${uid}amount`} error={err('amount')}>
            <NumberInput
              id={`${uid}amount`}
              data-autofocus
              prefix="₹"
              placeholder="0.00"
              value={form.amount}
              error={err('amount')}
              onChange={(value) => set('amount', value)}
            />
            {overBalance && !err('amount') && (
              <p className="text-sm leading-snug text-warn">More than the {fromAccount.name} balance.</p>
            )}
          </Field>
          <Field label="Date" required htmlFor={`${uid}date`} error={err('date')}>
            <DateInput
              id={`${uid}date`}
              value={form.date}
              error={err('date')}
              onChange={(event) => set('date', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Description" htmlFor={`${uid}description`} error={err('description')}>
          <TextInput
            id={`${uid}description`}
            maxLength={255}
            placeholder="e.g. Cash deposited at branch"
            value={form.description}
            error={err('description')}
            onChange={(event) => set('description', event.target.value)}
          />
        </Field>
        <Field label="Reference No." htmlFor={`${uid}reference`} error={err('reference_no')} hint="UTR, cheque or deposit slip number (optional)">
          <TextInput
            id={`${uid}reference`}
            maxLength={80}
            autoComplete="off"
            value={form.reference_no}
            error={err('reference_no')}
            onChange={(event) => set('reference_no', event.target.value)}
          />
        </Field>
      </form>
    )
  }

  return (
    <Modal
      open={open}
      onClose={() => !save.isPending && onClose()}
      title={editing ? 'Edit entry' : 'Add / Reduce money'}
      subtitle={editing ? adjustmentType(adjustment.txn_type).label : account ? account.name : 'Add or reduce money in the bank'}
      size="md"
      footer={(
        <div className="flex gap-3 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form={formId} className="flex-1 sm:min-w-28 sm:flex-none" loading={save.isPending} disabled={!ready}>
            {editing ? 'Save changes' : 'Save'}
          </Button>
        </div>
      )}
    >
      {body}
    </Modal>
  )
}
