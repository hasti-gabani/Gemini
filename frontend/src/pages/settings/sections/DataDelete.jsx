import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Eye, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'

import Button from '../../../components/ui/Button.jsx'
import { Checkbox, FormSection, Switch } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { useUI } from '../../../context/UIContext.jsx'
import { api } from '../../../lib/api.js'
import { formatDate, toISODate } from '../../../lib/dates.js'
import { useInvalidateAll } from '../../../lib/hooks.js'
import { formatMoney, isNegative, isZeroMoney } from '../../../lib/money.js'
import SettingsPage from '../SettingsLayout.jsx'
import { Callout, OwnerOnlyNotice } from '../settingsKit.jsx'

const PERIODS = [
  { value: '1m', label: '1 month', months: 1 },
  { value: '2m', label: '2 months', months: 2 },
  { value: '3m', label: '3 months', months: 3 },
  { value: '6m', label: '6 months', months: 6 },
  { value: '1y', label: '1 year', months: 12 },
]

const CATEGORIES = [
  { key: 'sales', label: 'Sales bills', description: 'Payments received with these bills go too.' },
  { key: 'purchases', label: 'Purchase bills', description: 'Payments made with these bills go too.' },
  { key: 'payments_in', label: 'Payment In', description: 'Not deleted while linked to a bill you keep.' },
  { key: 'payments_out', label: 'Payment Out', description: 'Not deleted while linked to a bill you keep.' },
  { key: 'bank_adjustments', label: 'Cash & bank transfers', description: 'Deposits, withdrawals and adjustments' },
  { key: 'stock_adjustments', label: 'Stock adjustments' },
  { key: 'reminders', label: 'Completed reminders' },
]

const MASTERS = [
  { key: 'parties', label: 'Parties with no remaining transactions and zero balance' },
  { key: 'items', label: 'Items with no remaining transactions and zero stock' },
]

const DEFAULT_OPTIONS = {
  older_than: '1y',
  include: ['sales', 'purchases', 'payments_in', 'payments_out'],
  masters: [],
  carry_forward: true,
}

/** Same rule as the server: same day N months ago, clamped to the end of that month. */
function cutoffFor(months) {
  const now = new Date()
  const index = now.getFullYear() * 12 + now.getMonth() - months
  const year = Math.floor(index / 12)
  const month = index % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  return toISODate(new Date(year, month, Math.min(now.getDate(), lastDay)))
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

function describeChange(value) {
  if (isZeroMoney(value)) return 'No change'
  return `${isNegative(value) ? 'Goes down by' : 'Goes up by'} ${formatMoney(value, { absolute: true })}`
}

function PreviewResult({ preview }) {
  const { options, result } = preview
  const counts = result.counts || {}
  const origin = result.origin_payments || {}
  const derived = result.derived || {}
  const masters = result.masters || {}
  const impact = result.balance_impact

  if (!result.total) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-muted px-4 py-6 text-center" role="status">
        <CircleCheck className="size-8 text-pos" aria-hidden />
        <p className="text-base font-semibold text-ink">Nothing to delete</p>
        <p className="max-w-sm text-sm text-ink-3">No records match these options. Choose a shorter period or select more types of data.</p>
      </div>
    )
  }

  const rows = [
    { key: 'sales', label: 'Sales bills', count: counts.sales, note: counts.sale_items ? plural(counts.sale_items, 'item line', 'item lines') : '' },
    { key: 'purchases', label: 'Purchase bills', count: counts.purchases, note: counts.purchase_items ? plural(counts.purchase_items, 'item line', 'item lines') : '' },
    { key: 'payments_in', label: 'Payments In', count: counts.payments_in, note: origin.payments_in ? `${origin.payments_in} received together with deleted sales bills` : '' },
    { key: 'payments_out', label: 'Payments Out', count: counts.payments_out, note: origin.payments_out ? `${origin.payments_out} paid together with deleted purchase bills` : '' },
    { key: 'bank_adjustments', label: 'Cash & bank transfers', count: counts.bank_adjustments },
    { key: 'stock_adjustments', label: 'Stock adjustments', count: counts.stock_adjustments },
    { key: 'reminders', label: 'Completed reminders', count: counts.reminders },
    { key: 'parties', label: 'Parties', count: masters.parties, master: true },
    { key: 'items', label: 'Items', count: masters.items, master: true },
  ].filter((row) => (row.count || 0) > 0 || (row.master ? options.masters : options.include).includes(row.key))

  const derivedRows = [
    { key: 'ledger_entries', label: 'Ledger entries', count: derived.ledger_entries || 0 },
    { key: 'bank_transactions', label: 'Cash & bank entries', count: derived.bank_transactions || 0 },
    { key: 'attachments', label: 'Attachments (bill photos & PDFs)', count: derived.attachments || 0 },
  ]
  const balancesChange = impact && (!isZeroMoney(impact.party_balance_change) || !isZeroMoney(impact.cash_bank_change))

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="border-b border-line bg-muted px-4 py-2.5">
          <p className="text-[15px] font-semibold text-ink">What will be deleted</p>
          <p className="text-sm text-ink-2">Everything dated before <strong className="num font-semibold text-ink">{formatDate(result.cutoff)}</strong></p>
        </div>
        <table className="w-full text-left">
          <caption className="sr-only">Exact number of records that will be deleted</caption>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="px-4 py-2.5 font-normal">
                  <span className="block text-[15px] text-ink">{row.label}</span>
                  {row.note && <span className="block text-sm text-ink-3">{row.note}</span>}
                </th>
                <td className="num px-4 py-2.5 text-right align-top text-[15px] font-semibold text-ink">{row.count || 0}</td>
              </tr>
            ))}
          </tbody>
          <tbody className="border-t-2 border-line-strong">
            <tr>
              <th scope="row" className="px-4 py-3 text-[15px] font-semibold text-ink">Total records to delete</th>
              <td className="num px-4 py-3 text-right text-lg font-bold text-neg">{result.total}</td>
            </tr>
          </tbody>
          <tbody className="divide-y divide-line border-t border-line bg-muted text-ink-3">
            <tr>
              <th scope="rowgroup" colSpan={2} className="px-4 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide">
                Also removed automatically with them
              </th>
            </tr>
            {derivedRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="px-4 py-2 text-sm font-normal">{row.label}</th>
                <td className="num px-4 py-2 text-right text-sm">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {impact && !result.carry_forward && (balancesChange ? (
        <Callout tone="warn" title="Balances will change">
          <p>“Keep current balances” is off, so removing these records changes your totals:</p>
          <dl className="mt-1.5 space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt>Party balances (receivable − payable)</dt>
              <dd className="num font-semibold text-ink">{describeChange(impact.party_balance_change)}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt>Cash &amp; bank balance</dt>
              <dd className="num font-semibold text-ink">{describeChange(impact.cash_bank_change)}</dd>
            </div>
          </dl>
        </Callout>
      ) : (
        <Callout tone="neutral"><p>Your balances do not change.</p></Callout>
      ))}
    </div>
  )
}

function CleanupCard({ isOwner }) {
  const { confirm, toast } = useUI()
  const queryClient = useQueryClient()
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const version = useRef(0)
  const resultRef = useRef(null)

  const change = (patch) => {
    version.current += 1
    setOptions((current) => ({ ...current, ...patch }))
    setPreview(null)
    setOptionsError('')
  }

  const toggle = (listKey, all, key, checked) => {
    change({ [listKey]: all.map((entry) => entry.key).filter((entry) => (entry === key ? checked : options[listKey].includes(entry))) })
  }

  const showResult = () => requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))

  const runPreview = async () => {
    if (!options.include.length && !options.masters.length) {
      setOptionsError('Select at least one type of data to delete.')
      return
    }
    const requested = version.current
    const used = options
    setPreviewing(true)
    try {
      const result = await api.post('/data/cleanup/preview/', used)
      if (requested !== version.current) return
      setPreview({ options: used, result })
      showResult()
    } catch (error) {
      if (requested === version.current) toast.error(error)
    } finally {
      setPreviewing(false)
    }
  }

  const runDelete = async () => {
    if (!preview?.result.total) return
    const { options: used, result } = preview
    const period = PERIODS.find((entry) => entry.value === used.older_than)
    const ok = await confirm({
      title: `Delete all selected data older than ${period?.label || used.older_than}?`,
      message: `${plural(result.total, 'record', 'records')} will be permanently deleted. A safety backup is saved on this computer first.`,
      confirmText: 'Delete Permanently',
      cancelText: 'Cancel',
      tone: 'danger',
      typeToConfirm: 'DELETE',
    })
    if (!ok) return
    const requested = version.current
    setDeleting(true)
    try {
      const response = await api.post('/data/cleanup/', { ...used, expected_total: result.total, create_backup: true })
      setPreview(null)
      toast.success(response?.detail || 'Old data deleted.')
      await queryClient.invalidateQueries()
    } catch (error) {
      if (error?.status === 409 && error.data?.preview) {
        if (requested === version.current) {
          setPreview({ options: used, result: error.data.preview })
          showResult()
        }
        toast.error('Data changed — please review again')
      } else {
        toast.error(error)
      }
    } finally {
      setDeleting(false)
    }
  }

  const canDelete = isOwner && Boolean(preview?.result.total) && !previewing

  return (
    <FormSection
      title="Delete old transactions"
      description="Free up space by removing old records. Nothing is deleted until you preview and confirm."
    >
      <div className="space-y-5">
        {/* options are locked while a deletion is running */}
        <fieldset disabled={deleting} className="min-w-0 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-2">Delete data older than</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {PERIODS.map((period) => {
                const selected = options.older_than === period.value
                return (
                  <label
                    key={period.value}
                    className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2.5 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[var(--ring)] ${selected ? 'border-brand bg-brand-soft' : 'border-line bg-card hover:border-line-strong'}`}
                  >
                    <input
                      type="radio"
                      name="cleanup-older-than"
                      value={period.value}
                      checked={selected}
                      onChange={() => change({ older_than: period.value })}
                      className="sr-only"
                    />
                    <span className={`text-[15px] font-semibold ${selected ? 'text-brand-ink' : 'text-ink'}`}>{period.label}</span>
                    <span className="num text-xs text-ink-3">Before {formatDate(cutoffFor(period.months))}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-2">What to delete</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((category) => (
                <Checkbox
                  key={category.key}
                  className="rounded-xl border border-line p-3"
                  checked={options.include.includes(category.key)}
                  onChange={(checked) => toggle('include', CATEGORIES, category.key, checked)}
                  label={category.label}
                  description={category.description}
                />
              ))}
            </div>
            {optionsError && <p className="mt-2 text-sm text-neg" role="alert">{optionsError}</p>}
          </fieldset>

          <Callout tone="neutral">
            <p>Ledger entries and report data are removed automatically together with their transactions.</p>
          </Callout>

          <Switch
            checked={options.carry_forward}
            onChange={(checked) => change({ carry_forward: checked })}
            label="Keep current balances"
            description="Party, cash, bank and stock balances stay exactly the same — the deleted amounts are carried into opening balances."
          />

          <fieldset className="rounded-xl border border-dashed border-line-strong p-4">
            <legend className="px-1 text-sm font-medium text-ink-2">Also delete unused master data (optional)</legend>
            <p className="mb-3 text-sm text-ink-3">
              Removes records that have nothing left after this cleanup, even recently added ones. Parties
              and items are never deleted unless you tick them here.
            </p>
            <div className="space-y-3">
              {MASTERS.map((master) => (
                <Checkbox
                  key={master.key}
                  checked={options.masters.includes(master.key)}
                  onChange={(checked) => toggle('masters', MASTERS, master.key, checked)}
                  label={master.label}
                />
              ))}
            </div>
          </fieldset>
        </fieldset>

        <div className="space-y-3 border-t border-line pt-5">
          {/* no icon on phones: the full label must fit a 320px screen */}
          <Button variant="secondary" loading={previewing} onClick={runPreview} className="w-full sm:w-auto">
            {!previewing && <Eye className="hidden size-[18px] shrink-0 sm:block" aria-hidden />}
            Preview what will be deleted
          </Button>

          <div ref={resultRef} className="scroll-mt-24">
            {preview ? (
              <PreviewResult preview={preview} />
            ) : (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-4 text-center text-sm text-ink-3">
                Preview first — the exact number of records is shown here before anything is deleted.
              </p>
            )}
          </div>

          <Button
            variant="danger"
            icon={Trash2}
            loading={deleting}
            disabled={!canDelete}
            onClick={runDelete}
            className="w-full sm:w-auto"
          >
            Delete permanently
          </Button>
        </div>
      </div>
    </FormSection>
  )
}

function RebuildCard() {
  const { confirm, toast } = useUI()
  const invalidate = useInvalidateAll()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    const ok = await confirm({
      title: 'Recalculate all balances?',
      message: 'Party balances, cash and bank balances, item stock and ledgers are worked out again from your bills and payments. No data is deleted.',
      confirmText: 'Recalculate',
      cancelText: 'Cancel',
      tone: 'primary',
    })
    if (!ok) return
    setBusy(true)
    try {
      const result = await api.post('/data/rebuild/')
      invalidate()
      toast.success(result?.detail || 'All balances were recalculated.')
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSection
      title="Recalculate balances"
      description="If a balance or stock figure looks wrong, recalculate everything from your bills and payments. Your data is not changed."
    >
      <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={run} className="w-full sm:w-auto">
        {busy ? 'Recalculating…' : 'Recalculate balances'}
      </Button>
    </FormSection>
  )
}

const RESET_OPTIONS = [
  {
    scope: 'transactions',
    title: 'Delete all transactions',
    button: 'Delete transactions',
    description: 'Deletes every bill, payment, cash & bank transfer and stock adjustment. Keeps parties, items and bank accounts.',
    confirmTitle: 'Delete all transactions?',
    confirmMessage: 'All sales and purchase bills, payments, cash & bank transfers and stock adjustments will be permanently deleted. Parties, items and bank accounts are kept with their opening balances.',
  },
  {
    scope: 'everything',
    title: 'Delete everything',
    button: 'Delete everything',
    description: 'Also deletes parties, items and bank accounts. Only the business profile and settings are kept.',
    confirmTitle: 'Delete everything?',
    confirmMessage: 'All transactions, parties, items, categories, reminders and bank accounts will be permanently deleted. Only your business profile and settings are kept.',
  },
]

function DangerZone({ isOwner, onDeleted }) {
  const { confirm, toast } = useUI()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState('')

  const reset = async (option) => {
    const ok = await confirm({
      title: option.confirmTitle,
      message: option.confirmMessage,
      details: (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm text-ink-2">A safety backup is saved on this computer before anything is deleted.</p>
      ),
      confirmText: 'Delete Permanently',
      cancelText: 'Cancel',
      tone: 'danger',
      typeToConfirm: 'DELETE',
    })
    if (!ok) return
    setBusy(option.scope)
    try {
      const result = await api.post('/data/reset/', { confirm: 'DELETE', scope: option.scope })
      toast.success(result?.detail || 'Data deleted.')
      onDeleted?.()
      await queryClient.invalidateQueries()
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card border-neg/40 p-4 sm:p-5" aria-labelledby="danger-zone-title">
      <h3 id="danger-zone-title" className="flex items-center gap-2 text-base font-semibold text-neg">
        <TriangleAlert className="size-5" aria-hidden /> Danger zone
      </h3>
      <p className="mt-0.5 text-sm text-ink-3">
        These delete data of every date, not only old data.
      </p>
      <div className="mt-4 divide-y divide-line rounded-xl border border-line">
        {RESET_OPTIONS.map((option) => (
          <div key={option.scope} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink">{option.title}</p>
              <p className="text-sm text-ink-3">{option.description}</p>
            </div>
            <Button
              variant="danger-soft"
              icon={Trash2}
              loading={busy === option.scope}
              disabled={!isOwner || Boolean(busy)}
              onClick={() => reset(option)}
              className="w-full sm:w-auto"
            >
              {option.button}
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function DataDelete() {
  const { user } = useSession()
  const isOwner = user?.role === 'owner'
  // Bumped after any deletion so the cleanup card starts fresh (old previews are no longer valid).
  const [generation, setGeneration] = useState(0)
  const refresh = () => setGeneration((value) => value + 1)

  return (
    <SettingsPage id="data">
      {!isOwner && (
        <OwnerOnlyNotice>Deleting data is limited to the business owner. You can still preview old data and recalculate balances.</OwnerOnlyNotice>
      )}
      <CleanupCard key={generation} isOwner={isOwner} />
      <RebuildCard />
      <DangerZone isOwner={isOwner} onDeleted={refresh} />
    </SettingsPage>
  )
}
