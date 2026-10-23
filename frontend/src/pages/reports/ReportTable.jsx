import { ChevronRight, FileSpreadsheet, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { Badge } from '../../components/ui/misc.jsx'
import { useIsDesktop } from '../../lib/hooks.js'
import { isZeroMoney } from '../../lib/money.js'
import { recordPath } from '../../lib/routes.js'
import {
  CellValue, amountTextSize, balanceInfo, formatValue, isEmptyValue, isNumericColumn, shortLabel, statusTone,
} from './reportFormat.jsx'

const STEP = 200

const linkPath = (row) => (row?._link ? recordPath(row._link.type, row._link.id) : null)
const count = (value) => Number(value || 0).toLocaleString('en-IN')

// ---------------------------------------------------------------------------- column roles

const LINK_KEYS = ['number', 'reference_no', 'name', 'party']
const PRIMARY_KEYS = ['party', 'name', 'description', 'account', 'type', 'period', 'number']
const SECONDARY_KEYS = ['type', 'number', 'reference_no']
const PAIRS = [['amount_in', 'amount_out'], ['debit', 'credit']]
// Money that came in is green; money that went out, or is still due, is red (only when not zero).
const POSITIVE_KEYS = new Set(['money_in', 'amount_in'])
const NEGATIVE_KEYS = new Set(['money_out', 'amount_out', 'pending', 'overdue'])
const REPORT_TONES = {
  receivables: { balance: 'text-pos' },
  payables: { balance: 'text-neg' },
}

function useColumnRoles(columns, reportKey) {
  return useMemo(() => {
    const byKey = Object.fromEntries(columns.map((column) => [column.key, column]))
    const textColumns = columns.filter((column) => column.type === 'text' || column.type === 'multiline')
    const pairKeys = PAIRS.find(([a, b]) => byKey[a] && byKey[b])
    return {
      byKey,
      linkCandidates: [...LINK_KEYS.map((key) => byKey[key]).filter(Boolean), ...textColumns],
      primaryCandidates: [...PRIMARY_KEYS.map((key) => byKey[key]).filter(Boolean), ...textColumns, ...columns],
      date: columns.find((column) => column.type === 'date'),
      pair: pairKeys ? pairKeys.map((key) => byKey[key]) : null,
      status: byKey.status?.type === 'text' ? byKey.status : null,
      tones: REPORT_TONES[reportKey] || {},
    }
  }, [columns, reportKey])
}

/** Text colour for an amount cell (money in/out, pending, balances). */
export function amountTone(column, value, roles) {
  if (isEmptyValue(value) || !isNumericColumn(column)) return ''
  if (column.type === 'balance') return balanceInfo(value).tone
  if (isZeroMoney(value)) return ''
  if (roles?.tones?.[column.key]) return roles.tones[column.key]
  if (POSITIVE_KEYS.has(column.key)) return 'text-pos'
  if (NEGATIVE_KEYS.has(column.key)) return 'text-neg'
  return ''
}

function firstFilled(candidates, row) {
  return candidates.find((column) => !isEmptyValue(row[column.key]))
}

/** Label for the totals row plus which column originally carried it. */
function totalsLabel(columns, totals) {
  const labelColumn = columns.find((column) => !isNumericColumn(column) && typeof totals?.[column.key] === 'string' && totals[column.key])
  return { text: labelColumn ? totals[labelColumn.key] : 'Total', key: labelColumn?.key }
}

// ---------------------------------------------------------------------------- desktop table

function DesktopTable({ columns, rows, totals, roles }) {
  const navigate = useNavigate()
  const label = totals ? totalsLabel(columns, totals) : null

  return (
    <div className="scroll-thin max-h-[75dvh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`border-b border-line bg-muted px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3 first:pl-5 last:pr-5 ${isNumericColumn(column) ? 'text-right' : 'text-left'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const path = linkPath(row)
            const linkColumn = path ? firstFilled(roles.linkCandidates, row) : null
            return (
              <tr
                key={index}
                onClick={path ? (event) => {
                  if (event.target.closest('a, button') || window.getSelection()?.toString()) return
                  if (event.ctrlKey || event.metaKey) window.open(path, '_blank', 'noopener')
                  else navigate(path)
                } : undefined}
                className={`align-top transition-colors even:bg-muted ${path ? 'cursor-pointer hover:bg-brand-soft' : 'hover:bg-subtle'}`}
              >
                {columns.map((column) => {
                  const numeric = isNumericColumn(column)
                  const text = column.type === 'text' || column.type === 'multiline'
                  // ledger style: leave the unused side of a debit/credit pair blank instead of ₹0.00
                  const value = roles.pair?.includes(column) && isZeroMoney(row[column.key]) ? null : row[column.key]
                  return (
                    <td
                      key={column.key}
                      style={text && column.width ? { minWidth: `${Math.round(column.width * 64)}px` } : undefined}
                      className={`border-b border-line px-3 py-2.5 first:pl-5 last:pr-5 ${numeric ? `num text-right ${amountTone(column, value, roles) || 'text-ink'}` : 'text-ink-2'} ${column.type === 'date' ? 'whitespace-nowrap' : ''}`}
                    >
                      {linkColumn === column ? (
                        <Link to={path} className="font-medium text-brand-ink hover:underline">
                          <CellValue column={column} value={value} />
                        </Link>
                      ) : (
                        <CellValue column={column} value={value} />
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        {totals && (
          <tfoot className="sticky bottom-0 z-10">
            <tr>
              {columns.map((column, index) => {
                const numeric = isNumericColumn(column)
                let content = null
                if (index === 0) content = label.text
                else if (column.key !== label.key) content = <CellValue column={column} value={totals[column.key]} />
                return (
                  <td
                    key={column.key}
                    className={`border-t border-line-strong bg-subtle px-3 py-3 font-semibold first:pl-5 last:pr-5 ${numeric ? `num whitespace-nowrap text-right ${amountTone(column, totals[column.key], roles) || 'text-ink'}` : 'text-ink'}`}
                  >
                    {content}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------- phone cards

/** Amounts of a row as label/value pairs; the unused side of a debit/credit pair is left out. */
function cardAmounts(row, columns, roles, used) {
  return columns.filter((column) => {
    if (used.has(column.key) || !isNumericColumn(column) || isEmptyValue(row[column.key])) return false
    return !(roles.pair?.includes(column) && isZeroMoney(row[column.key]))
  })
}

function AmountGrid({ items, row, roles }) {
  if (!items.length) return null
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-muted px-3 py-2.5 xs:grid-cols-3">
      {items.map((column) => {
        const text = formatValue(row[column.key], column.type)
        return (
          <div key={column.key} className="min-w-0">
            <dt className="truncate text-xs text-ink-3">{shortLabel(column.label)}</dt>
            <dd className={`num whitespace-nowrap font-semibold leading-snug ${amountTextSize(text)} ${amountTone(column, row[column.key], roles) || 'text-ink'}`}>
              {text}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function ReportCard({ row, columns, roles }) {
  const path = linkPath(row)
  const primary = firstFilled(roles.primaryCandidates, row)
  const used = new Set([primary?.key])
  const secondary = []
  if (roles.date && roles.date !== primary && !isEmptyValue(row[roles.date.key])) {
    secondary.push(formatValue(row[roles.date.key], 'date'))
    used.add(roles.date.key)
  }
  for (const key of SECONDARY_KEYS) {
    const column = roles.byKey[key]
    if (column && column !== primary && column.type === 'text' && !isEmptyValue(row[key])) {
      secondary.push(row[key])
      used.add(key)
    }
  }
  if (roles.status) used.add(roles.status.key)
  const amounts = cardAmounts(row, columns, roles, used)
  for (const column of amounts) used.add(column.key)
  const lines = columns.filter((column) => !used.has(column.key) && !isNumericColumn(column) && !isEmptyValue(row[column.key]))
  const status = roles.status && !isEmptyValue(row[roles.status.key]) ? row[roles.status.key] : ''

  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`break-words font-semibold text-ink ${primary?.type === 'multiline' ? 'line-clamp-3 whitespace-pre-line' : 'line-clamp-2'}`}>
            {primary ? formatValue(row[primary.key], primary.type) : '—'}
          </p>
          {secondary.length > 0 && <p className="break-words text-sm text-ink-3">{secondary.join(' · ')}</p>}
        </div>
        {status && <Badge tone={statusTone(status)} className="mt-0.5 shrink-0">{status}</Badge>}
        {path && <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />}
      </div>
      <AmountGrid items={amounts} row={row} roles={roles} />
      {lines.length > 0 && (
        <dl className="mt-2.5 space-y-1 text-sm">
          {lines.map((column) => (column.type === 'multiline' ? (
            <div key={column.key}>
              <dt className="text-ink-3">{shortLabel(column.label)}</dt>
              <dd className="whitespace-pre-line break-words text-ink-2">{row[column.key]}</dd>
            </div>
          ) : (
            <div key={column.key} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-ink-3">{shortLabel(column.label)}</dt>
              <dd className="min-w-0 break-words text-right text-ink-2"><CellValue column={column} value={row[column.key]} /></dd>
            </div>
          )))}
        </dl>
      )}
    </>
  )

  const classes = 'card block p-3.5 transition hover:border-line-strong active:bg-subtle'
  return <li>{path ? <Link to={path} className={classes}>{body}</Link> : <div className={classes}>{body}</div>}</li>
}

function TotalsCard({ columns, totals, roles }) {
  const label = totalsLabel(columns, totals)
  const lines = columns.filter((column) => column.key !== label.key && isNumericColumn(column) && !isEmptyValue(totals[column.key]))
  if (!lines.length) return null
  return (
    <section className="card p-3.5" aria-label="Totals">
      <h3 className="text-base font-semibold text-ink">{label.text}</h3>
      <AmountGrid items={lines} row={totals} roles={roles} />
    </section>
  )
}

// ---------------------------------------------------------------------------- wrapper

/** Rows render progressively (200 at a time) — reports can return up to 5,000 rows. */
export default function ReportTable({ report, onDownloadExcel, excelBusy }) {
  const isDesktop = useIsDesktop()
  const [limit, setLimit] = useState(STEP)
  const { columns = [], rows = [], totals } = report
  const roles = useColumnRoles(columns, report.key)
  const visible = rows.length > limit ? rows.slice(0, limit) : rows
  const remaining = rows.length - visible.length

  const more = remaining > 0 && (
    <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line px-4 py-3 text-sm text-ink-3">
      <span>Showing {count(visible.length)} of {count(rows.length)} rows</span>
      <Button variant="secondary" size="sm" onClick={() => setLimit((value) => value + STEP)}>
        Show {count(Math.min(STEP, remaining))} more
      </Button>
    </div>
  )

  return (
    <div className="space-y-3">
      {report.truncated && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 font-medium">
            Showing the first {count(rows.length)} of {count(report.row_count)} rows — download Excel for all rows.
          </p>
          {onDownloadExcel && (
            <Button variant="secondary" size="sm" icon={FileSpreadsheet} loading={excelBusy} onClick={onDownloadExcel}>
              Download Excel
            </Button>
          )}
        </div>
      )}

      {isDesktop ? (
        <div className="card overflow-hidden">
          <DesktopTable columns={columns} rows={visible} totals={totals} roles={roles} />
          {more}
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {visible.map((row, index) => (
              <ReportCard key={index} row={row} columns={columns} roles={roles} />
            ))}
          </ul>
          {more && <div className="card overflow-hidden">{more}</div>}
          {totals && <TotalsCard columns={columns} totals={totals} roles={roles} />}
        </>
      )}
    </div>
  )
}
