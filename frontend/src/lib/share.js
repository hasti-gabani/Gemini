import { ApiError, apiUrl, request } from './api.js'

function filenameFromResponse(res, fallback) {
  const header = res.headers.get('Content-Disposition') || ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : fallback
}

export async function fetchFile(path, params, fallbackName = 'download') {
  const res = await request(path, { params, raw: true })
  const blob = await res.blob()
  return { blob, filename: filenameFromResponse(res, fallbackName) }
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function downloadFile(path, params, fallbackName) {
  const { blob, filename } = await fetchFile(path, { ...params, download: 1 }, fallbackName)
  saveBlob(blob, filename)
  return filename
}

/** Open a PDF (or image) in a new tab. Returns false if the browser blocked the pop-up. */
export function openInNewTab(path, params) {
  return openUrlInNewTab(apiUrl(path, params))
}

function openUrlInNewTab(url) {
  // `noopener` in the features string makes window.open return null, so detach manually.
  const win = window.open(url, '_blank')
  if (win) {
    win.opener = null
    return true
  }
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return false
}

export function canShareFiles() {
  try {
    const probe = new File(['x'], 'probe.pdf', { type: 'application/pdf' })
    return Boolean(navigator.canShare && navigator.canShare({ files: [probe] }))
  } catch {
    return false
  }
}

/** Share a server-generated file through the phone's share sheet (WhatsApp, Gmail, ...). */
export async function shareFile(path, params, { title, text, fallbackName } = {}) {
  const { blob, filename } = await fetchFile(path, params, fallbackName)
  const file = new File([blob], filename, { type: blob.type || 'application/pdf' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
      throw error
    }
  }
  saveBlob(blob, filename)
  return 'downloaded'
}

export async function shareText({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
    }
  }
  await copyText([text, url].filter(Boolean).join('\n'))
  return 'copied'
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    if (!ok) throw new ApiError(0, 'Could not copy to clipboard.')
    return true
  }
}

/** Open WhatsApp / a share link in a new tab without navigating the app away. */
export function openExternal(url) {
  openUrlInNewTab(url)
}

export function telLink(phone) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined
}
