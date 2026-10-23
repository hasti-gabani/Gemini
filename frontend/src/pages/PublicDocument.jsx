import { useQuery } from '@tanstack/react-query'
import { Download, FileWarning, Printer } from 'lucide-react'
import { useParams } from 'react-router'

import { DocumentView } from '../components/documents/InvoiceDocument.jsx'
import { useBrowserPrint } from '../components/documents/PrintPreviewDialog.jsx'
import Button from '../components/ui/Button.jsx'
import { PageLoader } from '../components/ui/misc.jsx'
import { api, apiUrl } from '../lib/api.js'

/** Public page opened from a shared WhatsApp / SMS link: /v/<token>. No login required. */
export default function PublicDocument() {
  const { token } = useParams()
  const { print, printing, stage } = useBrowserPrint()
  const query = useQuery({
    queryKey: ['public-document', token],
    queryFn: () => api.get(`/public/documents/${token}/`),
    retry: false,
  })

  if (query.isPending) return <div className="min-h-dvh bg-canvas"><PageLoader label="Opening document…" /></div>

  if (query.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas p-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-warn-soft text-warn">
            <FileWarning className="size-7" />
          </div>
          <h1 className="text-xl font-semibold text-ink">This link is no longer available</h1>
          <p className="mt-2 text-[15px] text-ink-3">The document may have been deleted, or the business disabled its shared links. Please ask them to share it again.</p>
        </div>
      </div>
    )
  }

  const { document: doc, pdf_url: pdfUrl, app_name: appName } = query.data
  const title = `${doc.title} · ${doc.business?.name || ''}`

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="safe-top sticky top-0 z-10 border-b border-line bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">{doc.business?.name}</p>
            <p className="truncate text-sm text-ink-3">{doc.title} {doc.meta?.[0]?.value}</p>
          </div>
          <Button variant="secondary" size="sm" icon={Printer} loading={printing} onClick={() => print(doc, 'a4')} className="hidden sm:inline-flex">Print</Button>
          <Button size="sm" icon={Download} href={`${pdfUrl}?download=1`}>PDF</Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-8">
        <article className="rounded-2xl bg-white p-4 shadow-card sm:p-8" aria-label={title}>
          <DocumentView doc={doc} format="a4" />
        </article>
        <p className="mt-4 text-center text-xs text-ink-3">
          Shared securely with {appName}. <a className="underline" href={apiUrl(`/public/documents/${token}/pdf/`)}>View as PDF</a>
        </p>
      </main>
      {stage}
    </div>
  )
}
