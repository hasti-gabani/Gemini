import { useQuery } from '@tanstack/react-query'
import { Bluetooth, Download, ExternalLink, Printer, Share2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { downloadFile, openInNewTab, shareFile } from '../../lib/share.js'
import Button from '../ui/Button.jsx'
import Modal from '../ui/Modal.jsx'
import { Chips, ErrorState, Spinner } from '../ui/misc.jsx'
import { DocumentView, PAPER } from './InvoiceDocument.jsx'

const MM_TO_PX = 96 / 25.4

// Lazy chunk: the ESC/POS raster printer code is only downloaded when Bluetooth printing is used.
const thermalModules = import.meta.glob('../../lib/thermalPrint.js')

function waitForImages(node) {
  const images = Array.from(node.querySelectorAll('img'))
  return Promise.all(images.map((img) => (img.complete ? null : new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true })
    img.addEventListener('error', resolve, { once: true })
    setTimeout(resolve, 3000)
  }))))
}

/** Renders the document into a hidden print stage and opens the browser print dialog. */
export function useBrowserPrint() {
  const [job, setJob] = useState(null) // { doc, format }
  const stageRef = useRef(null)

  useEffect(() => {
    if (!job || !stageRef.current) return undefined
    let cancelled = false
    const style = document.createElement('style')
    const cleanup = () => {
      document.body.classList.remove('is-printing')
      style.remove()
      window.removeEventListener('afterprint', cleanup)
      if (!cancelled) setJob(null)
    }
    ;(async () => {
      await document.fonts?.ready
      await waitForImages(stageRef.current)
      if (cancelled) return
      const paper = PAPER[job.format] || PAPER.a4
      if (paper.thermal) {
        const heightMm = Math.ceil(stageRef.current.scrollHeight / MM_TO_PX) + 6
        style.textContent = `@page { size: ${paper.paperMm}mm ${heightMm}mm; margin: 0; }`
      } else {
        style.textContent = `@page { size: ${paper.pageCss}; margin: ${paper.margin}; }`
      }
      document.head.appendChild(style)
      document.body.classList.add('is-printing')
      window.addEventListener('afterprint', cleanup)
      window.print()
    })()
    return () => {
      cancelled = true
      document.body.classList.remove('is-printing')
      style.remove()
      window.removeEventListener('afterprint', cleanup)
    }
  }, [job])

  const stage = job ? createPortal(
    <div
      ref={stageRef}
      className="print-stage"
      style={{
        width: `${(PAPER[job.format] || PAPER.a4).widthMm}mm`,
        padding: (PAPER[job.format] || PAPER.a4).thermal ? '3mm 4mm' : 0,
      }}
    >
      <DocumentView doc={job.doc} format={job.format} />
    </div>,
    document.body,
  ) : null

  return { print: (doc, format) => setJob({ doc, format }), printing: Boolean(job), stage }
}

function ScaledPaper({ doc, format }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const [box, setBox] = useState({ scale: 1, height: 0 })
  const paper = PAPER[format] || PAPER.a4
  const padding = paper.thermal ? 12 : 32
  const paperPx = paper.widthMm * MM_TO_PX + padding * 2

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return undefined
    const update = () => {
      const available = outer.clientWidth - 16
      const scale = Math.min(1, available / paperPx)
      setBox({ scale, height: inner.offsetHeight * scale })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [paperPx, doc])

  return (
    <div ref={outerRef} className="rounded-xl bg-subtle p-2">
      <div style={{ height: box.height, width: paperPx * box.scale }} className="mx-auto">
        <div
          ref={innerRef}
          className="origin-top-left bg-white shadow-card"
          style={{ width: paperPx, padding, transform: `scale(${box.scale})` }}
        >
          <DocumentView doc={doc} format={format} />
        </div>
      </div>
    </div>
  )
}

/**
 * Print preview for a bill (`basePath="/sales/12"`) or payment (`/payments-in/5`).
 * Browser print in A4 / A5 / thermal sizes, PDF open/download/share, Bluetooth thermal printing.
 */
export default function PrintPreviewDialog({ open, onClose, basePath, title = 'Print preview' }) {
  const { settings } = useSession()
  const { toast } = useUI()
  const [format, setFormat] = useState(settings?.print_format || 'a4')
  const [busy, setBusy] = useState('')
  const [bluetoothSupported, setBluetoothSupported] = useState(false)
  const { print, printing, stage } = useBrowserPrint()

  useEffect(() => {
    if (open) setFormat(settings?.print_format || 'a4')
  }, [open, settings?.print_format])

  useEffect(() => {
    setBluetoothSupported(typeof navigator !== 'undefined' && Boolean(navigator.bluetooth))
  }, [])

  const documentQuery = useQuery({
    queryKey: ['document', basePath],
    queryFn: () => api.get(`${basePath}/document/`),
    enabled: open && Boolean(basePath),
  })
  const doc = documentQuery.data
  const paper = PAPER[format]

  const run = async (name, fn) => {
    setBusy(name)
    try {
      await fn()
    } catch (error) {
      if (error?.name !== 'AbortError') toast.error(error)
    } finally {
      setBusy('')
    }
  }

  // Load the printer module as soon as a thermal size is shown: Chrome only opens the
  // Bluetooth device chooser during the tap itself, so nothing slow may run before it.
  const thermalRef = useRef(null)
  useEffect(() => {
    const load = thermalModules['../../lib/thermalPrint.js']
    if (!open || !paper?.thermal || !bluetoothSupported || thermalRef.current || !load) return
    load().then((module) => { thermalRef.current = module }).catch(() => {})
  }, [open, paper?.thermal, bluetoothSupported])

  const bluetoothPrint = () => run('bluetooth', async () => {
    const load = thermalModules['../../lib/thermalPrint.js']
    if (!thermalRef.current && !load) throw new Error('Bluetooth printing is not available in this build.')
    const module = thermalRef.current || await load()
    await module.printDocumentViaBluetooth(doc, { paper: format === 'thermal58' ? '58' : '80' })
    toast.success('Sent to printer.')
  })

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        size="xl"
        fullHeight
        footer={(
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button variant="secondary" icon={ExternalLink} className="hidden sm:inline-flex" onClick={() => openInNewTab(`${basePath}/pdf/`, { format })}>Open PDF</Button>
            <Button variant="secondary" icon={Download} loading={busy === 'download'} onClick={() => run('download', () => downloadFile(`${basePath}/pdf/`, { format }))}>PDF</Button>
            <Button variant="secondary" icon={Share2} loading={busy === 'share'} onClick={() => run('share', async () => {
              const result = await shareFile(`${basePath}/pdf/`, { format }, { title })
              if (result === 'downloaded') toast.info('Sharing is not supported here, so the PDF was downloaded.')
            })}
            >
              Share
            </Button>
            <div className="flex-1" />
            {paper?.thermal && bluetoothSupported && (
              <Button variant="soft" icon={Bluetooth} loading={busy === 'bluetooth'} disabled={!doc} onClick={bluetoothPrint}>Bluetooth</Button>
            )}
            <Button icon={Printer} loading={printing} disabled={!doc} onClick={() => print(doc, format)} className="min-w-28">Print</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <Chips
            value={format}
            onChange={setFormat}
            items={Object.entries(PAPER).map(([value, p]) => ({ value, label: p.label }))}
          />
          {paper?.thermal && (
            <p className="text-sm text-ink-3">
              {bluetoothSupported
                ? 'Print to a Bluetooth receipt printer, or use Print with a thermal printer driver.'
                : 'Use Print with an installed thermal printer, or Share the PDF to your printer app (e.g. on iPhone).'}
            </p>
          )}
          {documentQuery.isPending ? (
            <div className="grid h-72 place-items-center"><Spinner className="size-7" /></div>
          ) : documentQuery.isError ? (
            <ErrorState error={documentQuery.error} onRetry={documentQuery.refetch} />
          ) : (
            <ScaledPaper doc={doc} format={format} />
          )}
        </div>
      </Modal>
      {stage}
    </>
  )
}
