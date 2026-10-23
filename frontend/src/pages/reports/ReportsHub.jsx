import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FileText } from 'lucide-react'
import { Link } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { DEFINITIONS_QUERY, reportMeta } from './reportMeta.js'

/** One report card; only the Day Book (રોજમેળ) is offered (see OFFERED_REPORTS). */
function ReportCard({ definition }) {
  const { language } = useSession()
  const meta = reportMeta(definition)
  const primary = language === 'gu' && definition.title_gu ? definition.title_gu : definition.title
  const secondary = primary === definition.title ? definition.title_gu : definition.title
  return (
    <Link
      to={`/reports/${definition.key}`}
      className="card group flex items-center gap-4 border-brand/30 bg-brand-soft p-4 transition hover:border-brand/60 sm:p-5"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white">
        <meta.icon className="size-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-bold leading-snug text-ink">{primary}</span>
          {secondary && <span className="text-sm text-ink-2">{secondary}</span>}
        </span>
        {definition.description && <span className="mt-0.5 block text-sm text-ink-2">{definition.description}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-brand-ink transition group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

export default function ReportsHub() {
  const { t } = useSession()
  const query = useQuery(DEFINITIONS_QUERY)
  const reports = query.data?.results

  return (
    <Page title={t('reports')} maxWidth="max-w-6xl">
      {query.isError ? (
        <div className="card"><ErrorState error={query.error} onRetry={query.refetch} /></div>
      ) : !reports ? (
        <Skeleton className="h-24" />
      ) : reports.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title="No reports" message="No reports are available." /></div>
      ) : (
        <div className="space-y-4">
          {reports.map((definition) => <ReportCard key={definition.key} definition={definition} />)}
        </div>
      )}
    </Page>
  )
}
