import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, FileSpreadsheet, MessageCircle, Printer, Share2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import DateRangePicker from '../../components/ui/DateRangePicker.jsx'
import MonthPicker from '../../components/ui/MonthPicker.jsx'
import { Chips, EmptyState, ErrorState, FitAmount, Menu, Skeleton } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatDate, monthRange, rangeText, todayISO } from '../../lib/dates.js'
import { formatMoney, isNegative, isPositive } from '../../lib/money.js'
import { recordPath } from '../../lib/routes.js'
import { downloadFile, openExternal, openInNewTab, shareFile } from '../../lib/share.js'

function Balance({ value, className = '' }) {
  const positive = isPositive(value)
  const negative = isNegative(value)
  return (
    <span className={`num whitespace-nowrap ${positive ? 'text-pos' : negative ? 'text-neg' : 'text-ink-2'} ${className}`}>
      {formatMoney(value, { absolute: true })}
      <span className="ml-1 text-[0.75em] font-medium">{positive ? 'Dr' : negative ? 'Cr' : ''}</span>
    </span>
  )
}

function Tile({ label, children, sub }) {
  return (
    <div className="card min-w-0 p-3">
      <p className="text-xs leading-tight text-ink-3">{label}</p>
      <FitAmount as="div" className="mt-0.5 text-base font-semibold text-ink">{children}</FitAmount>
      {sub && <p className="break-words text-xs text-ink-3">{sub}</p>}
    </div>
  )
}

const TYPE_TONE = {
  sale: 'bg-brand-soft text-brand-ink',
  purchase: 'bg-warn-soft text-warn',
  payment_in: 'bg-pos-soft text-pos',
  payment_out: 'bg-neg-soft text-neg',
}

/** Customer / supplier ledger with opening balance, running balance and exports. */
export default function PartyStatement({ party }) {
  const navigate = useNavigate()
  const { toast } = useUI()
  // A statement is usually read one whole month at a time; From – To covers any other span.
  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState('') // '' = this month
  const [range, setRange] = useState({ from: '', to: '' }) // '' = today
  const days = monthRange(month)
  const from = mode === 'month' ? days.from : range.from || todayISO()
  const to = mode === 'month' ? days.to : range.to || todayISO()
  const params = { period: 'custom', date_from: from, date_to: to }
  const base = `/parties/${party.id}/statement`

  const query = useQuery({
    queryKey: ['statement', party.id, params],
    queryFn: () => api.get(`${base}/`, params),
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const isSupplier = party.party_type === 'supplier'

  const run = (fn) => fn().catch((error) => error?.name !== 'AbortError' && toast.error(error))
  const exportItems = [
    { label: 'View PDF', icon: ExternalLink, onClick: () => openInNewTab(`${base}/pdf/`, params) },
    { label: 'Download PDF', icon: Download, onClick: () => run(() => downloadFile(`${base}/pdf/`, params)) },
    { label: 'Download Excel', icon: FileSpreadsheet, onClick: () => run(() => downloadFile(`${base}/xlsx/`, params)) },
    { label: 'Print', icon: Printer, onClick: () => openInNewTab(`${base}/pdf/`, params) },
    { label: 'Share PDF', icon: Share2, onClick: () => run(() => shareFile(`${base}/pdf/`, params, { title: `Statement – ${party.name}` })) },
    { label: 'WhatsApp summary', icon: MessageCircle, hidden: !data?.share, onClick: () => openExternal(data.share.whatsapp_url) },
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chips
            items={[{ value: 'month', label: 'Month' }, { value: 'dates', label: 'From – To' }]}
            value={mode}
            onChange={setMode}
          />
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={Download} className="hidden sm:inline-flex" onClick={() => run(() => downloadFile(`${base}/pdf/`, params))}>PDF</Button>
            <Button size="sm" variant="secondary" icon={FileSpreadsheet} className="hidden sm:inline-flex" onClick={() => run(() => downloadFile(`${base}/xlsx/`, params))}>Excel</Button>
            <Menu trigger={({ toggle }) => <Button size="sm" variant="soft" icon={Share2} onClick={toggle}>Export</Button>} items={exportItems} />
          </div>
        </div>
        {mode === 'month'
          ? <MonthPicker value={month} onChange={setMonth} />
          : <DateRangePicker from={range.from} to={range.to} onChange={setRange} />}
      </div>

      {query.isError ? (
        <div className="card"><ErrorState error={query.error} onRetry={query.refetch} /></div>
      ) : !data ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>
      ) : (
        <div className={`space-y-4 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
          <p className="text-sm text-ink-3">{from === to ? 'Date' : 'Period'}: {data.period_label}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Tile label="Opening Balance"><Balance value={data.opening_balance} /></Tile>
            {(!isSupplier || isPositive(data.totals.sales)) && <Tile label="Total Sales">{formatMoney(data.totals.sales)}</Tile>}
            {(!isSupplier || isPositive(data.totals.payments_in)) && <Tile label="Total Payments Received"><span className="text-pos">{formatMoney(data.totals.payments_in)}</span></Tile>}
            {(isSupplier || isPositive(data.totals.purchases)) && <Tile label="Total Purchases">{formatMoney(data.totals.purchases)}</Tile>}
            {(isSupplier || isPositive(data.totals.payments_out)) && <Tile label="Total Payments Paid"><span className="text-neg">{formatMoney(data.totals.payments_out)}</span></Tile>}
            <Tile label={isNegative(data.closing_balance) ? 'Total Pending (Payable)' : 'Total Pending (Receivable)'}>
              <span className={isNegative(data.closing_balance) ? 'text-neg' : 'text-pos'}>{formatMoney(data.closing_balance, { absolute: true })}</span>
            </Tile>
            <Tile label="Closing Balance" sub={data.closing_label}><Balance value={data.closing_balance} /></Tile>
          </div>

          <div className="card overflow-hidden">
            {data.rows.length === 0 ? (
              <EmptyState
                title={`No transactions ${rangeText(from, to)}`}
                message={mode === 'month' ? 'Choose another month to see its transactions.' : 'Change the From / To dates to see other days.'}
              />
            ) : (
              <>
                {/* phones */}
                <ul className="divide-y divide-line lg:hidden">
                  <li className="flex items-center justify-between bg-muted px-4 py-2.5 text-sm">
                    <span className="font-medium text-ink-2">Opening balance</span>
                    <Balance value={data.opening_balance} className="font-semibold" />
                  </li>
                  {data.rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => row.ref_id && navigate(recordPath(row.ref_type, row.ref_id))}
                        className="w-full px-4 py-3 text-left transition hover:bg-muted"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${TYPE_TONE[row.type] || 'bg-subtle text-ink-2'}`}>{row.type_label}</span>
                          <span className="text-sm font-medium text-ink">{row.number}</span>
                          <span className="ml-auto text-sm text-ink-3">{formatDate(row.date)}</span>
                        </div>
                        {row.items && (
                          <div className="mt-1 space-y-0.5 text-sm text-ink-2">
                            {row.items.split('\n').map((name, index) => (
                              <p key={`${name}-${index}`} className="flex justify-between gap-3">
                                <span className="min-w-0 break-words">{name}</span>
                                <span className="shrink-0 text-ink-3">{row.qty.split('\n')[index] || ''}</span>
                              </p>
                            ))}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-sm">
                          <span>
                            {isPositive(row.debit) && <span className="num font-semibold text-ink">Debit {formatMoney(row.debit)}</span>}
                            {isPositive(row.credit) && <span className="num font-semibold text-ink">Credit {formatMoney(row.credit)}</span>}
                          </span>
                          <span className="text-ink-3">Bal <Balance value={row.balance} className="font-semibold" /></span>
                        </div>
                      </button>
                    </li>
                  ))}
                  <li className="flex items-center justify-between bg-muted px-4 py-3">
                    <span className="font-semibold text-ink">Closing balance</span>
                    <Balance value={data.closing_balance} className="text-lg font-bold" />
                  </li>
                </ul>

                {/* desktop */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[900px] text-[15px]">
                    <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
                      <tr>
                        <th className="px-4 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Transaction Type</th>
                        <th className="px-3 py-2.5">Bill No.</th>
                        <th className="px-3 py-2.5">Item Name</th>
                        <th className="px-3 py-2.5 text-right">Quantity</th>
                        <th className="px-3 py-2.5 text-right">Debit</th>
                        <th className="px-3 py-2.5 text-right">Credit</th>
                        <th className="px-4 py-2.5 text-right">Running Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      <tr className="bg-muted/50">
                        <td className="px-4 py-2.5 text-ink-2">{data.start ? formatDate(data.start) : '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-ink-2" colSpan={6}>Opening Balance</td>
                        <td className="px-4 py-2.5 text-right"><Balance value={data.opening_balance} className="font-semibold" /></td>
                      </tr>
                      {data.rows.map((row) => (
                        <tr key={row.id} className={`align-top transition ${row.ref_id ? 'cursor-pointer hover:bg-muted' : ''}`} onClick={() => row.ref_id && navigate(recordPath(row.ref_type, row.ref_id))}>
                          <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{formatDate(row.date)}</td>
                          <td className="px-3 py-2.5"><span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${TYPE_TONE[row.type] || 'bg-subtle text-ink-2'}`}>{row.type_label}</span></td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-brand-ink">{row.number}</td>
                          <td className="max-w-72 whitespace-pre-line px-3 py-2.5 text-sm text-ink-2">{row.items}</td>
                          <td className="whitespace-pre-line px-3 py-2.5 text-right text-sm text-ink-2">{row.qty || '—'}</td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink">{isPositive(row.debit) ? formatMoney(row.debit) : '—'}</td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink">{isPositive(row.credit) ? formatMoney(row.credit) : '—'}</td>
                          <td className="px-4 py-2.5 text-right"><Balance value={row.balance} className="font-semibold" /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-line-strong bg-muted font-semibold">
                      <tr>
                        <td className="px-4 py-3 text-ink" colSpan={5}>Total · Closing Balance</td>
                        <td className="num px-3 py-3 text-right text-ink">{formatMoney(data.totals.debit)}</td>
                        <td className="num px-3 py-3 text-right text-ink">{formatMoney(data.totals.credit)}</td>
                        <td className="px-4 py-3 text-right"><Balance value={data.closing_balance} className="text-base font-bold" /></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-ink-3">Dr = the party owes you (receivable) · Cr = you owe the party (payable).</p>
        </div>
      )}
    </div>
  )
}
