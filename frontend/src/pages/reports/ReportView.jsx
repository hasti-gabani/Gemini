import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, CalendarRange, Download, EllipsisVertical, FileSearch, FileSpreadsheet, FileText, Info, Printer, SearchX,
  Share2,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { EmptyState, ErrorState, ListSkeleton, Menu, Skeleton, Spinner } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { formatMoney, formatQty } from '../../lib/money.js'
import { downloadFile, openInNewTab, shareFile, telLink } from '../../lib/share.js'
import ReportFilters from './ReportFilters.jsx'
import { balanceInfo } from './reportFormat.jsx'
import {
  DEFINITIONS_QUERY, customRangeError, filterParamNames, hasActiveFilters, reportApiParams,
} from './reportMeta.js'
import ReportTable from './ReportTable.jsx'

// ---------------------------------------------------------------------------- header + summary

/** PDF / Excel downloads, always visible at the top of every report (phones included). */
function ExportBar({ exports, disabled }) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="secondary" size="sm" icon={Download} onClick={exports.downloadPdf} loading={exports.busy === 'pdf'} disabled={disabled}>
        PDF
      </Button>
      <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={exports.downloadExcel} loading={exports.busy === 'xlsx'} disabled={disabled}>
        Excel
      </Button>
    </div>
  )
}

function ReportMeta({ report, partyId, exports, exportDisabled }) {
  const info = report.info || []
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink-2">{report.subtitle}</p>
          <p className="text-xs text-ink-3">
            {report.business?.name ? `${report.business.name} · ` : ''}Generated {report.generated_at}
          </p>
        </div>
        <ExportBar exports={exports} disabled={exportDisabled} />
      </div>
      {info.length > 0 && (
        <dl className="card grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {info.map((item) => {
            let value = item.value
            if (item.label === 'Mobile' && item.value) {
              value = <a href={telLink(item.value)} className="text-brand-ink hover:underline">{item.value}</a>
            } else if (item.label === 'Party' && partyId) {
              value = <Link to={`/parties/${partyId}`} className="font-medium text-brand-ink hover:underline">{item.value}</Link>
            }
            return (
              <div key={item.label} className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{item.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line break-words text-[15px] text-ink">{value}</dd>
              </div>
            )
          })}
        </dl>
      )}
    </>
  )
}

const TONE_CARD = {
  pos: { card: 'border-pos/25 bg-pos-soft', value: 'text-pos' },
  neg: { card: 'border-neg/25 bg-neg-soft', value: 'text-neg' },
}

/** Big amounts get a smaller font so they stay on one line in a half-width card at 320px. */
function valueSize(text) {
  const length = String(text).length
  if (length <= 9) return 'text-lg sm:text-xl'
  if (length <= 11) return 'text-base sm:text-lg'
  if (length <= 13) return 'text-[15px] sm:text-base'
  return 'text-sm'
}

function SummaryTile({ item, className = '' }) {
  let value = item.value
  let sub = ''
  let tone = TONE_CARD[item.tone]?.value || 'text-ink'
  if (item.type === 'money') {
    value = formatMoney(item.value, { decimals: 'auto' })
  } else if (item.type === 'balance') {
    const info = balanceInfo(item.value)
    value = formatMoney(item.value, { absolute: true, decimals: 'auto' })
    tone = info.tone
    sub = info.side ? `${info.word} · ${info.side}` : info.word
  } else if (item.type === 'qty') {
    value = formatQty(item.value)
  } else if (item.type === 'number') {
    value = Number(item.value || 0).toLocaleString('en-IN')
  } else {
    value = item.value || '—'
  }
  return (
    <div className={`card min-w-0 p-3.5 sm:p-4 ${TONE_CARD[item.tone]?.card || ''} ${className}`}>
      <p className="line-clamp-2 text-sm font-medium leading-snug text-ink-2">{item.label}</p>
      <p className={`num mt-1 whitespace-nowrap font-bold leading-tight tracking-tight ${valueSize(value)} ${tone}`}>{value}</p>
      {sub && <p className={`text-xs font-medium ${tone}`}>{sub}</p>}
    </div>
  )
}

const SUMMARY_GRID = {
  1: 'sm:grid-cols-2',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 xl:grid-cols-5',
  6: 'sm:grid-cols-3',
}

function SummaryTiles({ summary }) {
  if (!summary?.length) return null
  const odd = summary.length % 2 === 1
  return (
    <div className={`grid grid-cols-2 gap-3 ${SUMMARY_GRID[summary.length] || 'sm:grid-cols-3 xl:grid-cols-4'}`}>
      {summary.map((item, index) => (
        <SummaryTile key={`${item.label}-${index}`} item={item} className={odd && index === 0 ? 'col-span-2 sm:col-span-1' : ''} />
      ))}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-5 w-3/5 max-w-sm" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[84px]" />)}
      </div>
      <div className="card overflow-hidden"><ListSkeleton rows={8} /></div>
    </div>
  )
}

// ---------------------------------------------------------------------------- exports

function useExports(key, params, title) {
  const { toast } = useUI()
  const [busy, setBusy] = useState(null)
  const pdf = `/reports/${key}/pdf/`
  const xlsx = `/reports/${key}/xlsx/`

  const run = async (kind, task) => {
    if (busy) return
    setBusy(kind)
    try {
      await task()
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(null)
    }
  }

  return {
    busy,
    viewPdf: () => openInNewTab(pdf, params),
    print: () => {
      openInNewTab(pdf, params)
      toast.info('Opening the PDF — print it from the new tab.')
    },
    downloadPdf: () => run('pdf', async () => {
      const name = await downloadFile(pdf, params, `${title}.pdf`)
      toast.success(`Downloaded ${name}`)
    }),
    downloadExcel: () => run('xlsx', async () => {
      const name = await downloadFile(xlsx, params, `${title}.xlsx`)
      toast.success(`Downloaded ${name}`)
    }),
    share: () => run('share', async () => {
      const result = await shareFile(pdf, params, { title, text: title, fallbackName: `${title}.pdf` })
      if (result === 'downloaded') toast.info('Sharing is not available on this device, so the PDF was downloaded.')
    }),
  }
}

function DesktopExportActions({ exports, disabled }) {
  return (
    <>
      <Button variant="soft" size="sm" icon={FileText} onClick={exports.viewPdf} disabled={disabled}>View PDF</Button>
      <Button variant="secondary" size="sm" icon={Printer} onClick={exports.print} disabled={disabled}>Print</Button>
      <Button variant="secondary" size="sm" icon={Share2} onClick={exports.share} loading={exports.busy === 'share'} disabled={disabled}>Share</Button>
    </>
  )
}

function MobileExportMenu({ exports, disabled }) {
  return (
    <Menu
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-label="Export, print or share"
          aria-haspopup="menu"
          aria-expanded={open}
          className="grid size-11 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink disabled:opacity-50"
        >
          {exports.busy ? <Spinner className="size-5" /> : <EllipsisVertical className="size-[21px]" />}
        </button>
      )}
      items={[
        { label: 'View PDF', icon: FileText, onClick: exports.viewPdf },
        { label: 'Print', icon: Printer, onClick: exports.print },
        { label: 'Share PDF', icon: Share2, onClick: exports.share },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------- screen

export default function ReportView() {
  const { key } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const definitionsQuery = useQuery(DEFINITIONS_QUERY)
  const listed = definitionsQuery.data?.results?.find((definition) => definition.key === key)
  const unknownKey = Boolean(definitionsQuery.data) && !listed

  const apiParams = useMemo(() => reportApiParams(searchParams, listed), [searchParams, listed])
  const rangeError = customRangeError(apiParams)

  const reportQuery = useQuery({
    queryKey: ['report', key, apiParams],
    queryFn: ({ signal }) => api.get(`/reports/${key}/`, apiParams, { signal }),
    placeholderData: keepPreviousData,
    enabled: !unknownKey && !rangeError,
  })
  const report = reportQuery.data
  const definition = listed || report?.definition || null
  const notFound = unknownKey
    || (!definition && reportQuery.error?.status === 404 && /report not found/i.test(reportQuery.error.message))

  const title = report?.title || definition?.title || 'Report'
  const exports = useExports(key, apiParams, title)

  const updateParams = useCallback((updates) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const [name, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(name)
        else next.set(name, value)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const filtersActive = hasActiveFilters(searchParams, definition)
  const clearFilters = () => updateParams(Object.fromEntries(filterParamNames(definition).map((name) => [name, null])))

  if (notFound) {
    return (
      <Page title="Report not found" back="/reports">
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="Report not found"
            message="This report does not exist or the link is incomplete. Choose a report from the list."
            action={<Button to="/reports" icon={ArrowLeft}>All Reports</Button>}
          />
        </div>
      </Page>
    )
  }

  const exportDisabled = Boolean(rangeError) || !report
  let body
  if (reportQuery.isError && !report) {
    body = (
      <div className="card">
        <ErrorState error={reportQuery.error} onRetry={reportQuery.refetch} />
        {filtersActive && (
          <div className="-mt-8 flex justify-center pb-8">
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
          </div>
        )}
      </div>
    )
  } else if (!report && rangeError) {
    body = (
      <div className="card">
        <EmptyState icon={CalendarRange} title="Choose a date range" message={rangeError} />
      </div>
    )
  } else if (!report) {
    body = <ReportSkeleton />
  } else {
    const rows = report.rows || []
    body = (
      <div
        className={`space-y-4 transition-opacity ${reportQuery.isPlaceholderData ? 'opacity-60' : ''}`}
        aria-busy={reportQuery.isFetching || undefined}
      >
        <ReportMeta report={report} partyId={apiParams.party} exports={exports} exportDisabled={exportDisabled} />
        <SummaryTiles summary={report.summary} />
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={FileSearch}
              title="No records for the selected filters"
              message="Try a different period or clear the filters."
              action={filtersActive ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : null}
            />
          </div>
        ) : (
          <ReportTable
            key={JSON.stringify(apiParams)}
            report={report}
            onDownloadExcel={exports.downloadExcel}
            excelBusy={exports.busy === 'xlsx'}
          />
        )}
        {report.notes?.length > 0 && (
          <ul className="space-y-1.5 text-sm text-ink-3">
            {report.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <Page
      title={title}
      subtitle={definition?.title_gu}
      back="/reports"
      actions={<DesktopExportActions exports={exports} disabled={exportDisabled} />}
      mobileActions={<MobileExportMenu exports={exports} disabled={exportDisabled} />}
    >
      <div className="space-y-4">
        {definition ? (
          <ReportFilters
            definition={definition}
            searchParams={searchParams}
            onChange={updateParams}
            onClear={clearFilters}
            rangeError={report ? rangeError : ''}
            busy={reportQuery.isFetching && Boolean(report)}
          />
        ) : definitionsQuery.isError && reportQuery.isError ? null : (
          <Skeleton className="h-11 w-full max-w-xl" />
        )}
        {body}
      </div>
    </Page>
  )
}
