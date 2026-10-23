import { useQuery } from '@tanstack/react-query'
import { Download, FileText, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { deviceSender } from '../../lib/whatsappDevice.js'
import { downloadFile, fetchFile, openExternal, saveBlob } from '../../lib/share.js'
import Modal from '../ui/Modal.jsx'
import { ErrorState, Spinner } from '../ui/misc.jsx'
import PrintPreviewDialog from './PrintPreviewDialog.jsx'

function Option({ icon: Icon, label, hint, tone = 'bg-subtle text-ink-2', onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-2 rounded-xl p-3 text-center transition hover:bg-muted active:bg-subtle disabled:opacity-60"
    >
      <span className={`grid size-12 place-items-center rounded-2xl ${tone}`}>
        {busy ? <Spinner className="size-5" /> : <Icon className="size-6" />}
      </span>
      <span className="text-sm font-medium leading-tight text-ink">{label}</span>
      {hint && <span className="-mt-1.5 text-xs text-ink-3">{hint}</span>}
    </button>
  )
}

/**
 * Share a bill or payment: WhatsApp (the PDF sent straight to the party's number when the WhatsApp
 * Business API is set up, otherwise the PDF is saved and the party's WhatsApp chat opens), PDF to any
 * app, download. Inside the Gemini Android app, WhatsApp opens this phone's WhatsApp straight in the
 * party's chat with the PDF attached (android/: window.GeminiAndroid).
 */
const androidApp = () => (typeof window !== 'undefined' ? window.GeminiAndroid : undefined)

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export default function ShareDialog({ open, onClose, basePath, title }) {
  const { settings } = useSession()
  const { toast } = useUI()
  const [busy, setBusy] = useState('')
  const [viewing, setViewing] = useState(false) // the PDF view, shown on screen without downloading
  const info = useQuery({
    queryKey: ['share', basePath],
    queryFn: () => api.get(`${basePath}/share/`),
    enabled: open && Boolean(basePath),
    staleTime: 5 * 60_000,
  })
  const data = info.data
  const format = settings?.print_format || 'a4'
  // Sent straight to the party by Gemini, from this device's linked WhatsApp (or the main one). In the
  // Android app without its own linked number, the phone's WhatsApp opens with the PDF instead.
  const sender = deviceSender()
  const sendsDirect = Boolean(data?.whatsapp_api) && (Boolean(sender) || !androidApp())
  // Without the WhatsApp Business API the PDF is prepared as soon as Share opens, so a single tap can
  // share it (phones allow sharing only during the tap itself).
  const pdf = useQuery({
    queryKey: ['share-pdf', basePath, format],
    queryFn: () => fetchFile(`${basePath}/pdf/`, { format, download: 1 }, `${title || 'document'}.pdf`),
    enabled: open && Boolean(basePath) && Boolean(data) && (!sendsDirect || Boolean(androidApp())),
    staleTime: 60_000,
    gcTime: 60_000,
  })
  // The party's number as WhatsApp wants it (with country code), taken from the wa.me link the server made.
  const partyNumber = () => ((data?.whatsapp_url || '').match(/wa\.me\/(\d+)/) || [])[1] || ''

  const appShare = (whatsapp) => run(whatsapp ? 'whatsapp' : 'download', async () => {
    if (!pdf.data) {
      if (pdf.isError) throw pdf.error
      return
    }
    const base64 = await blobToBase64(pdf.data.blob)
    if (whatsapp) androidApp().sharePdf(base64, pdf.data.filename, partyNumber())
    else androidApp().sharePdfToApps(base64, pdf.data.filename)
  })

  const whatsappPdf = () => {
    if (!pdf.data) {
      if (pdf.isError) toast.error(pdf.error)
      return
    }
    // Share the PDF file itself (the phone's share menu: WhatsApp → the party). Browsers allow this only
    // on a secure address; elsewhere the PDF is saved and the party's WhatsApp chat is opened instead.
    const file = new File([pdf.data.blob], pdf.data.filename, { type: 'application/pdf' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title }).catch((error) => {
        if (error?.name !== 'AbortError') toast.error(error)
      })
      return
    }
    saveBlob(pdf.data.blob, pdf.data.filename)
    openExternal(data.whatsapp_url.split('?')[0]) // the party's chat, without the link message
    toast.info(window.isSecureContext
      ? 'This browser cannot share files, so the PDF was saved. Open Gemini in Chrome to send it straight to WhatsApp.'
      : 'Chrome shares files only on a secure address, so the PDF was saved. Turn on the Chrome setting for this address to send it straight to WhatsApp.',
    { duration: 10000 })
  }

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

  return (
    <>
      <Modal open={open} onClose={onClose} title="Share" subtitle={title} size="md">
        {info.isPending ? (
          <div className="grid h-40 place-items-center"><Spinner className="size-6" /></div>
        ) : info.isError ? (
          <ErrorState error={info.error} onRetry={info.refetch} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-1">
              {sendsDirect ? (
                <Option
                  icon={MessageCircle}
                  label="WhatsApp"
                  hint="Send PDF"
                  tone="bg-pos-soft text-pos"
                  busy={busy === 'whatsapp'}
                  onClick={() => run('whatsapp', async () => {
                    const result = await api.post(`${basePath}/whatsapp/`, { format, account: sender })
                    toast.success(result?.detail || 'PDF sent on WhatsApp.')
                    onClose()
                  })}
                />
              ) : androidApp() ? (
                <Option icon={MessageCircle} label="WhatsApp" hint="PDF" tone="bg-pos-soft text-pos" busy={pdf.isPending || busy === 'whatsapp'} onClick={() => appShare(true)} />
              ) : (
                <Option icon={MessageCircle} label="WhatsApp" hint="PDF" tone="bg-pos-soft text-pos" busy={pdf.isPending} onClick={whatsappPdf} />
              )}
              <Option
                icon={FileText}
                label="PDF"
                hint="View"
                tone="bg-brand-soft text-brand-ink"
                onClick={() => { onClose(); setViewing(true) }}
              />
              {androidApp() ? (
                <Option icon={Download} label="Save / Other" hint="PDF" busy={pdf.isPending || busy === 'download'} onClick={() => appShare(false)} />
              ) : (
                <Option icon={Download} label="Download" hint="PDF" busy={busy === 'download'} onClick={() => run('download', () => downloadFile(`${basePath}/pdf/`, { format }))} />
              )}
            </div>
            {!data.whatsapp_api && !androidApp() && (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-ink-2">
                To send the PDF straight to the party&apos;s number with one tap, link your WhatsApp once in{' '}
                <Link to="/settings/whatsapp" onClick={onClose} className="font-semibold text-brand-ink underline">Settings → WhatsApp</Link>.
              </p>
            )}
          </div>
        )}
      </Modal>
      <PrintPreviewDialog open={viewing} onClose={() => setViewing(false)} basePath={basePath} title={title} />
    </>
  )
}
