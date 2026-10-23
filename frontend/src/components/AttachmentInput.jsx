import { ExternalLink, FileText, ImagePlus, Loader2, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { useUI } from '../context/UIContext.jsx'
import { request } from '../lib/api.js'
import Modal from './ui/Modal.jsx'

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf'
const MAX_MB = 10

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentViewer({ attachment, onClose }) {
  if (!attachment) return null
  const isPdf = attachment.kind === 'pdf'
  return (
    <Modal
      open
      onClose={onClose}
      title={attachment.original_name}
      subtitle={formatSize(attachment.size)}
      size="xl"
      headerRight={(
        <a href={`${attachment.url}?download=1`} className="hidden text-sm font-medium text-brand-ink hover:underline sm:block">Download</a>
      )}
    >
      {isPdf ? (
        <div className="space-y-3">
          <iframe title={attachment.original_name} src={attachment.url} className="h-[65dvh] w-full rounded-lg border border-line" />
          <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-ink">
            <ExternalLink className="size-4" /> Open PDF in new tab
          </a>
        </div>
      ) : (
        <img src={attachment.url} alt={attachment.original_name} className="mx-auto max-h-[70dvh] rounded-lg object-contain" />
      )}
    </Modal>
  )
}

export function AttachmentTiles({ attachments, onRemove, onOpen, size = 'size-20' }) {
  return attachments.map((attachment) => (
    <div key={attachment.id} className={`group relative ${size} shrink-0 overflow-hidden rounded-xl border border-line bg-muted`}>
      <button type="button" onClick={() => onOpen(attachment)} className="block size-full" aria-label={`View ${attachment.original_name}`}>
        {attachment.kind === 'pdf' ? (
          <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-ink-2">
            <FileText className="size-7 text-neg" />
            <span className="w-full truncate px-1 text-center text-[10px]">{attachment.original_name}</span>
          </span>
        ) : (
          <img src={attachment.url} alt={attachment.original_name} className="size-full object-cover" loading="lazy" />
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment)}
          aria-label={`Remove ${attachment.original_name}`}
          className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-slate-900/70 text-white"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  ))
}

/**
 * Payment proof / bill photo input. Files upload immediately and are linked to the
 * record when it is saved (send `attachment_ids`). JPG, PNG, WEBP and PDF up to 10 MB.
 *
 * `onChange` receives an updater `(list) => nextList`: uploads can finish in any order
 * while the user removes files, so each change must apply to the latest list.
 */
export default function AttachmentInput({ value = [], onChange, max = 5, label = 'Add Photo', compact = false }) {
  const { toast } = useUI()
  const inputRef = useRef(null)
  const inFlight = useRef(0)
  const [uploading, setUploading] = useState(0)
  const [viewing, setViewing] = useState(null)

  const upload = async (files) => {
    const room = max - value.length - inFlight.current
    const selected = Array.from(files).slice(0, Math.max(0, room))
    if (files.length > room) toast.info(`You can attach up to ${max} files.`)
    for (const file of selected) {
      const okType = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type) || /\.(jpe?g|png|webp|pdf)$/i.test(file.name)
      if (!okType) {
        toast.error(`${file.name}: only JPG, PNG, WEBP or PDF files are allowed.`)
        continue
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${MAX_MB} MB.`)
        continue
      }
      inFlight.current += 1
      setUploading((n) => n + 1)
      try {
        const body = new FormData()
        body.append('file', file)
        const attachment = await request('/attachments/', { method: 'POST', body })
        onChange((list) => [...list, attachment])
      } catch (error) {
        toast.error(error)
      } finally {
        inFlight.current -= 1
        setUploading((n) => n - 1)
      }
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <AttachmentTiles attachments={value} onOpen={setViewing} onRemove={(a) => onChange((list) => list.filter((x) => x.id !== a.id))} size={compact ? 'size-16' : 'size-20'} />
      {Array.from({ length: uploading }).map((_, index) => (
        <div key={`u${index}`} className={`${compact ? 'size-16' : 'size-20'} grid place-items-center rounded-xl border border-dashed border-line-strong bg-muted`}>
          <Loader2 className="size-5 animate-spin text-brand" />
        </div>
      ))}
      {value.length + uploading < max && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${compact ? 'size-16' : 'size-20'} flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong bg-card text-ink-3 transition hover:border-brand hover:text-brand-ink`}
        >
          <ImagePlus className="size-6" />
          <span className="text-[11px] font-medium">{label}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          upload(event.target.files)
          event.target.value = ''
        }}
      />
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
