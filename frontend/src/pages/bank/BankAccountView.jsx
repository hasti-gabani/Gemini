import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Download, EllipsisVertical, FileSpreadsheet, FileText,
  Landmark, Pencil, Printer, SearchX, Share2, Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import DateRangePicker from '../../components/ui/DateRangePicker.jsx'
import { Select } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { Badge, Chips, EmptyState, ErrorState, FitAmount, Menu, Skeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, formatDateMedium, rangeText, todayISO } from '../../lib/dates.js'
import { useInvalidateAll, useIsDesktop } from '../../lib/hooks.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'
import { downloadFile, openInNewTab, shareFile } from '../../lib/share.js'
import BankAccountDialog from './BankAccountDialog.jsx'
import { AccountIcon, IconButton, TXN_TYPE_OPTIONS, useAccounts } from './shared.jsx'
import TransferDialog from './TransferDialog.jsx'

const MINUS = '−'

const DIRECTIONS = [
  { value: '', label: 'All' },
  { value: 'in', label: 'Credit (money in)' },
  { value: 'out', label: 'Debit (money out)' },
]

const TYPE_OPTIONS = [{ value: '', label: 'All types' }, ...TXN_TYPE_OPTIONS]

function refLink(row) {
  if (row.ref_type === 'payment_in' && row.ref_id) return `/payments-in/${row.ref_id}`
  if (row.ref_type === 'payment_out' && row.ref_id) return `/payments-out/${row.ref_id}`
  return null
}

const isAdjustment = (row) => row.ref_type === 'adjustment' && Boolean(row.ref_id)
const rowAmount = (row) => (isPositive(row.amount_in) ? row.amount_in : row.amount_out)
const signedAmount = (row) => `${isPositive(row.amount_in) ? '+' : MINUS}${formatMoney(rowAmount(row))}`

function periodText(data) {
  if (!data) return ''
  if (data.start && data.end) {
    return data.start === data.end ? formatDateMedium(data.start) : `${formatDateMedium(data.start)} – ${formatDateMedium(data.end)}`
  }
  if (data.start) return `From ${formatDateMedium(data.start)}`
  if (data.end) return `Up to ${formatDateMedium(data.end)}`
  return 'All time'
}

function SummaryTile({ label, value, sub, icon: Icon, tone = 'bg-subtle text-ink-2' }) {
  const negative = isNegative(value)
  return (
    <div className="card min-w-0 p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium leading-snug text-ink-2">{label}</span>
        {Icon && (
          <span className={`hidden size-8 shrink-0 place-items-center rounded-lg xs:grid ${tone}`}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <FitAmount className={`mt-1 text-lg font-semibold tracking-tight ${negative ? 'text-neg' : 'text-ink'}`}>
        {formatMoney(value, { decimals: 'auto' })}
      </FitAmount>
      {sub && <p className="mt-0.5 break-words text-xs text-ink-3">{sub}</p>}
    </div>
  )
}

function AccountCard({ account }) {
  const isCash = account.kind === 'cash'
  const negative = isNegative(account.current_balance)
  const details = isCash
    ? [{ label: 'Opening cash', value: `${formatMoney(account.opening_balance)} · as of ${formatDateMedium(account.opening_date)}` }]
    : [
      { label: 'Account No.', value: account.account_number, num: true },
      { label: 'IFSC', value: account.ifsc },
      { label: 'Account holder', value: account.account_name },
      { label: 'Branch', value: account.branch },
      { label: 'UPI ID', value: account.upi_id },
      { label: 'Opening balance', value: `${formatMoney(account.opening_balance)} · as of ${formatDateMedium(account.opening_date)}` },
    ].filter((detail) => detail.value)
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <AccountIcon account={account} className="size-12 rounded-2xl" iconClassName="size-6" />
          <div className="min-w-0">
            <p className="text-sm text-ink-3">Current balance</p>
            <p className={`num text-2xl font-bold tracking-tight ${negative ? 'text-neg' : 'text-ink'}`}>{formatMoney(account.current_balance)}</p>
            {negative && <p className="text-xs font-medium text-neg">{isCash ? 'Negative cash balance' : 'Overdrawn'}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isCash && <Badge tone="pos">Cash in Hand</Badge>}
          {account.is_default && <Badge tone="brand">Default</Badge>}
          {account.print_on_invoice && <Badge tone="pos">On invoice</Badge>}
        </div>
      </div>
      {details.length > 0 && (
        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line pt-4 xs:grid-cols-2 lg:grid-cols-3">
          {details.map((detail) => (
            <div key={detail.label} className="min-w-0">
              <dt className="text-xs text-ink-3">{detail.label}</dt>
              <dd className={`break-words text-[15px] text-ink ${detail.num ? 'num' : ''}`}>{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {account.notes && <p className="mt-3 whitespace-pre-line text-sm text-ink-3">{account.notes}</p>}
    </section>
  )
}

function TxnCards({ data, rows, onOpenAdjustment }) {
  return (
    <ul className="divide-y divide-line">
      <li className="flex items-center justify-between gap-3 bg-muted px-4 py-2.5 text-sm">
        <span className="text-ink-2">Opening balance{data.start ? ` · ${formatDate(data.start)}` : ''}</span>
        <span className={`num font-semibold ${isNegative(data.opening_balance) ? 'text-neg' : 'text-ink'}`}>{formatMoney(data.opening_balance)}</span>
      </li>
      {rows.map((row) => {
        const credit = isPositive(row.amount_in)
        const link = refLink(row)
        const body = (
          <span className="flex items-start gap-3">
            <span className={`mt-0.5 hidden size-10 shrink-0 place-items-center rounded-xl xs:grid ${credit ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg'}`}>
              {credit ? <ArrowDownLeft className="size-5" aria-hidden /> : <ArrowUpRight className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words font-medium text-ink">
                  {row.type_label}{row.number ? ` · ${row.number}` : ''}
                </span>
                <span className={`num shrink-0 font-semibold ${credit ? 'text-pos' : 'text-neg'}`}>{signedAmount(row)}</span>
              </span>
              {row.description && <span className="mt-0.5 block break-words text-sm text-ink-2">{row.description}</span>}
              <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-ink-3">
                <span className="min-w-0 break-words">
                  {formatDate(row.date)}{row.reference_no ? ` · Ref. ${row.reference_no}` : ''}
                </span>
                <span className={`num shrink-0 ${isNegative(row.balance) ? 'text-neg' : ''}`}>Bal. {formatMoney(row.balance)}</span>
              </span>
            </span>
          </span>
        )
        const classes = 'block w-full px-4 py-3 text-left transition hover:bg-muted active:bg-subtle'
        return (
          <li key={row.id}>
            {link ? (
              <Link to={link} className={classes}>{body}</Link>
            ) : isAdjustment(row) ? (
              <button type="button" className={classes} aria-haspopup="dialog" onClick={() => onOpenAdjustment(row)}>{body}</button>
            ) : (
              <div className="px-4 py-3">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function TxnTable({ data, rows, onEdit, onDelete, busy }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-5 py-3">Date</th>
            <th scope="col" className="px-3 py-3">Type</th>
            <th scope="col" className="px-3 py-3">Description</th>
            <th scope="col" className="px-3 py-3">Reference No.</th>
            <th scope="col" className="px-3 py-3 text-right">Credit</th>
            <th scope="col" className="px-3 py-3 text-right">Debit</th>
            <th scope="col" className="px-3 py-3 text-right">Balance</th>
            <th scope="col" className="w-28 px-3 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          <tr className="bg-muted/60">
            <td className="whitespace-nowrap px-5 py-2.5 text-ink-2">{data.start ? formatDate(data.start) : '—'}</td>
            <td colSpan={5} className="px-3 py-2.5 font-medium text-ink-2">Opening balance</td>
            <td className={`num whitespace-nowrap px-3 py-2.5 text-right font-semibold ${isNegative(data.opening_balance) ? 'text-neg' : 'text-ink'}`}>
              {formatMoney(data.opening_balance)}
            </td>
            <td />
          </tr>
          {rows.map((row) => {
            const link = refLink(row)
            return (
              <tr key={row.id} className="align-top transition hover:bg-muted">
                <td className="whitespace-nowrap px-5 py-3 text-ink-2">{formatDate(row.date)}</td>
                <td className="whitespace-nowrap px-3 py-3">
                  <span className="block font-medium text-ink">{row.type_label}</span>
                  {row.number && (link ? (
                    <Link to={link} className="text-brand-ink hover:underline">{row.number}</Link>
                  ) : (
                    <span className="text-ink-3">{row.number}</span>
                  ))}
                </td>
                <td className="max-w-80 px-3 py-3 text-ink-2">
                  <span className="block break-words">{row.description || '—'}</span>
                </td>
                <td className="px-3 py-3 text-ink-2">{row.reference_no || '—'}</td>
                <td className="num whitespace-nowrap px-3 py-3 text-right text-pos">{isPositive(row.amount_in) ? formatMoney(row.amount_in) : ''}</td>
                <td className="num whitespace-nowrap px-3 py-3 text-right text-neg">{isPositive(row.amount_out) ? formatMoney(row.amount_out) : ''}</td>
                <td className={`num whitespace-nowrap px-3 py-3 text-right font-medium ${isNegative(row.balance) ? 'text-neg' : 'text-ink'}`}>
                  {formatMoney(row.balance)}
                </td>
                <td className="px-2 py-1.5">
                  {isAdjustment(row) ? (
                    <span className="flex justify-end">
                      <IconButton
                        icon={Pencil}
                        label={`Edit ${row.type_label.toLowerCase()} of ${formatMoney(rowAmount(row))}`}
                        disabled={busy === `adj-${row.ref_id}`}
                        onClick={() => onEdit(row)}
                      />
                      <IconButton
                        icon={Trash2}
                        tone="danger"
                        label={`Delete ${row.type_label.toLowerCase()} of ${formatMoney(rowAmount(row))}`}
                        onClick={() => onDelete(row)}
                      />
                    </span>
                  ) : link ? (
                    <span className="flex h-11 items-center justify-end pr-2">
                      <Link to={link} className="font-medium text-brand-ink hover:underline">View</Link>
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t border-line-strong bg-muted font-semibold">
          <tr>
            <td colSpan={4} className="px-5 py-3 text-ink-2">{data.filtered ? 'Total shown' : 'Total'}</td>
            <td className="num whitespace-nowrap px-3 py-3 text-right text-pos">{formatMoney(data.shown_in)}</td>
            <td className="num whitespace-nowrap px-3 py-3 text-right text-neg">{formatMoney(data.shown_out)}</td>
            <td className={`num whitespace-nowrap px-3 py-3 text-right ${isNegative(data.closing_balance) ? 'text-neg' : 'text-ink'}`}>
              {formatMoney(data.closing_balance)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function StatementSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  )
}

export default function BankAccountView() {
  const { id } = useParams()
  const { t } = useSession()
  const { toast, confirm } = useUI()
  const invalidate = useInvalidateAll()
  const isDesktop = useIsDesktop()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editOpen, setEditOpen] = useState(false)
  const [transfer, setTransfer] = useState(null) // {} for new, { adjustment } to edit
  const [sheet, setSheet] = useState(null) // adjustment row picked on a phone
  const [busy, setBusy] = useState('')

  // From – To, both today when not chosen
  const from = searchParams.get('from') || todayISO()
  const to = searchParams.get('to') || todayISO()
  const oneDay = from === to
  const direction = ['in', 'out'].includes(searchParams.get('direction')) ? searchParams.get('direction') : ''
  const typeParam = searchParams.get('type')
  const type = TXN_TYPE_OPTIONS.some((option) => option.value === typeParam) ? typeParam : ''

  const params = {
    period: 'custom',
    date_from: from,
    date_to: to,
    direction: direction || undefined,
    type: type || undefined,
  }

  const accountsQuery = useAccounts()
  const statement = useQuery({
    queryKey: ['bank-account-statement', id, params],
    queryFn: ({ signal }) => api.get(`/accounts/${id}/transactions/`, params, { signal }),
    placeholderData: keepPreviousData,
  })
  const data = statement.data
  const account = data?.account || accountsQuery.data?.results?.find((item) => String(item.id) === String(id))
  const isCash = account?.kind === 'cash'
  const notFound = statement.error?.status === 404
    || (accountsQuery.data && !account && !statement.isFetching && !data)

  const update = (patch) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      return next
    }, { replace: true })
  }

  const clearFilters = () => update({ direction: '', type: '' })

  const pdfPath = `/accounts/${id}/transactions/pdf/`
  const fileBase = `${account?.name || 'Account'} statement`

  const runExport = async (kind) => {
    if (kind === 'view' || kind === 'print') {
      openInNewTab(pdfPath, params)
      return
    }
    setBusy(kind)
    try {
      if (kind === 'pdf') {
        await downloadFile(pdfPath, params, `${fileBase}.pdf`)
        toast.success('PDF downloaded.')
      } else if (kind === 'xlsx') {
        await downloadFile(`/accounts/${id}/transactions/xlsx/`, params, `${fileBase}.xlsx`)
        toast.success('Excel file downloaded.')
      } else if (kind === 'share') {
        const result = await shareFile(pdfPath, params, {
          title: fileBase,
          text: `${account?.name || 'Account'} · ${periodText(data) || 'Statement'}`,
          fallbackName: `${fileBase}.pdf`,
        })
        if (result === 'downloaded') toast.info('Sharing is not available on this device, so the PDF was downloaded.')
      }
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy('')
    }
  }

  const editAdjustment = async (row) => {
    setBusy(`adj-${row.ref_id}`)
    try {
      const adjustment = await api.get(`/bank-adjustments/${row.ref_id}/`)
      setSheet(null)
      setTransfer({ adjustment })
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy('')
    }
  }

  const deleteAdjustment = async (row) => {
    setSheet(null)
    const ok = await confirm({
      title: 'Delete this entry?',
      message: `${row.type_label} of ${formatMoney(rowAmount(row))} on ${formatDate(row.date)} will be deleted. Balances of every account it affects are updated.`,
      confirmText: t('delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.del(`/bank-adjustments/${row.ref_id}/`)
      invalidate()
      toast.success('Entry deleted.')
    } catch (error) {
      toast.error(error)
    }
  }

  const exportButton = (kind, icon, label, short) => (
    <Button
      variant="secondary"
      size="sm"
      icon={icon}
      loading={busy === kind}
      disabled={Boolean(busy) && busy !== kind}
      aria-label={label}
      title={label}
      onClick={() => runExport(kind)}
    >
      <span className="hidden xl:inline">{short}</span>
    </Button>
  )

  const actions = account ? (
    <>
      {exportButton('view', FileText, 'View PDF', 'View PDF')}
      {exportButton('pdf', Download, 'Download PDF', 'PDF')}
      {exportButton('xlsx', FileSpreadsheet, 'Download Excel', 'Excel')}
      {exportButton('print', Printer, 'Print', 'Print')}
      {exportButton('share', Share2, 'Share PDF', 'Share')}
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>{t('edit')}</Button>
      <Button size="sm" icon={ArrowRightLeft} onClick={() => setTransfer({})}>Add / Reduce</Button>
    </>
  ) : null

  const mobileActions = account ? (
    <>
      <IconButton icon={Share2} label="Share statement PDF" disabled={busy === 'share'} onClick={() => runExport('share')} />
      <Menu
        trigger={({ toggle }) => <IconButton icon={EllipsisVertical} label="More actions" onClick={toggle} />}
        items={[
          { label: 'View PDF', icon: FileText, onClick: () => runExport('view') },
          { label: 'Download PDF', icon: Download, onClick: () => runExport('pdf') },
          { label: 'Download Excel', icon: FileSpreadsheet, onClick: () => runExport('xlsx') },
          { label: 'Print', icon: Printer, onClick: () => runExport('print') },
          { divider: true },
          { label: 'Add / Reduce money', icon: ArrowRightLeft, onClick: () => setTransfer({}) },
          { label: isCash ? 'Edit opening cash' : 'Edit account', icon: Pencil, onClick: () => setEditOpen(true) },
        ]}
      />
    </>
  ) : null

  const rows = data?.results || []

  let content
  if (notFound) {
    content = (
      <div className="card">
        <EmptyState
          icon={Landmark}
          title="Account not found"
          message="This account may have been deleted."
          action={<Button variant="secondary" to="/bank">Back to Bank</Button>}
        />
      </div>
    )
  } else if (!account) {
    content = accountsQuery.isError ? (
      <div className="card"><ErrorState error={accountsQuery.error} onRetry={accountsQuery.refetch} /></div>
    ) : (
      <div className="space-y-4">
        <Skeleton className="h-36 rounded-2xl" />
        <StatementSkeleton />
      </div>
    )
  } else {
    let statementBody
    if (statement.isError && !data) {
      statementBody = <div className="card"><ErrorState error={statement.error} onRetry={statement.refetch} /></div>
    } else if (!data) {
      statementBody = <StatementSkeleton />
    } else {
      statementBody = (
        <div className={`space-y-4 transition-opacity ${statement.isPlaceholderData ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <SummaryTile
              label={t('opening_balance')}
              value={data.opening_balance}
              sub={data.start ? `On ${formatDateMedium(data.start)}` : 'At account opening'}
            />
            <SummaryTile
              label="Money Received"
              value={data.total_in}
              sub={oneDay ? 'Credit on this day' : 'Credit in this period'}
              icon={ArrowDownLeft}
              tone="bg-pos-soft text-pos"
            />
            <SummaryTile
              label="Money Paid"
              value={data.total_out}
              sub={oneDay ? 'Debit on this day' : 'Debit in this period'}
              icon={ArrowUpRight}
              tone="bg-neg-soft text-neg"
            />
            <SummaryTile
              label={t('closing_balance')}
              value={data.closing_balance}
              sub={data.end ? `On ${formatDateMedium(data.end)}` : 'Up to today'}
            />
          </div>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">Transactions</h2>
                <p className="text-sm text-ink-3">
                  {periodText(data)} · {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
                </p>
              </div>
              {data.filtered && (
                <p className="text-sm text-ink-2">
                  Shown: <span className="num font-medium text-pos">+{formatMoney(data.shown_in)}</span>
                  {' / '}
                  <span className="num font-medium text-neg">{MINUS}{formatMoney(data.shown_out)}</span>
                </p>
              )}
            </div>
            {rows.length === 0 ? (
              data.filtered ? (
                <EmptyState
                  icon={SearchX}
                  title="No matching transactions"
                  message={`Nothing ${rangeText(from, to)} matches the selected type or direction.`}
                  action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
                />
              ) : (
                <EmptyState
                  icon={isCash ? ArrowRightLeft : Landmark}
                  title={`No transactions ${rangeText(from, to)}`}
                  message="Change the From / To dates to see other days, or record a deposit, withdrawal or transfer."
                  action={<Button variant="soft" icon={ArrowRightLeft} onClick={() => setTransfer({})}>Add / Reduce money</Button>}
                />
              )
            ) : isDesktop ? (
              <TxnTable data={data} rows={rows} busy={busy} onEdit={editAdjustment} onDelete={deleteAdjustment} />
            ) : (
              <TxnCards data={data} rows={rows} onOpenAdjustment={setSheet} />
            )}
          </section>
        </div>
      )
    }

    content = (
      <div className="space-y-4">
        <AccountCard account={account} />

        <div className="space-y-2 lg:flex lg:flex-wrap lg:items-end lg:gap-3 lg:space-y-0">
          <DateRangePicker from={searchParams.get('from') || ''} to={searchParams.get('to') || ''} onChange={(range) => update(range)} />
          <Select
            aria-label="Transaction type"
            value={type}
            options={TYPE_OPTIONS}
            onChange={(event) => update({ type: event.target.value })}
            className="lg:w-44"
          />
          <Chips items={DIRECTIONS} value={direction} onChange={(value) => update({ direction: value })} className="max-w-full" />
        </div>

        {statementBody}
      </div>
    )
  }

  const sheetCredit = sheet ? isPositive(sheet.amount_in) : false

  return (
    <Page
      title={account?.name || (notFound ? 'Account' : 'Bank')}
      subtitle={account ? (isCash ? 'Cash account' : account.bank_name || undefined) : undefined}
      back="/bank"
      actions={actions}
      mobileActions={mobileActions}
    >
      {content}

      {account && (
        <>
          <BankAccountDialog open={editOpen} account={account} onClose={() => setEditOpen(false)} />
          <TransferDialog
            open={Boolean(transfer)}
            adjustment={transfer?.adjustment || null}
            account={account}
            onClose={() => setTransfer(null)}
          />
        </>
      )}

      <Modal
        open={Boolean(sheet)}
        onClose={() => setSheet(null)}
        title={sheet?.type_label}
        subtitle={sheet ? formatDateMedium(sheet.date) : undefined}
        size="sm"
        footer={sheet && (
          <div className="flex gap-3">
            <Button variant="danger-soft" icon={Trash2} className="flex-1" onClick={() => deleteAdjustment(sheet)}>{t('delete')}</Button>
            <Button icon={Pencil} className="flex-1" loading={busy === `adj-${sheet.ref_id}`} onClick={() => editAdjustment(sheet)}>{t('edit')}</Button>
          </div>
        )}
      >
        {sheet && (
          <dl className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-3">{sheetCredit ? 'Money in' : 'Money out'}</dt>
              <dd className={`num text-xl font-bold ${sheetCredit ? 'text-pos' : 'text-neg'}`}>{signedAmount(sheet)}</dd>
            </div>
            {sheet.description && (
              <div>
                <dt className="text-sm text-ink-3">{t('description')}</dt>
                <dd className="text-[15px] text-ink">{sheet.description}</dd>
              </div>
            )}
            {sheet.reference_no && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-3">{t('reference_no')}</dt>
                <dd className="text-[15px] text-ink">{sheet.reference_no}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
              <dt className="text-sm text-ink-3">Balance after this entry</dt>
              <dd className={`num text-[15px] font-semibold ${isNegative(sheet.balance) ? 'text-neg' : 'text-ink'}`}>{formatMoney(sheet.balance)}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </Page>
  )
}
