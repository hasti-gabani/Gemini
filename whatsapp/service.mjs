// Sends bill PDFs from the owners' own WhatsApp numbers. Each number is linked once, like WhatsApp Web:
// by QR code, or without a scanner by an 8-character code typed into that phone's WhatsApp
// (Linked devices → Link a device → Link with phone number instead). Several numbers can be linked, so every
// phone that uses Gemini sends from its own WhatsApp. Listens only on this computer (127.0.0.1:8200);
// Gemini's server calls it. Unofficial WhatsApp connection (Baileys): many messages can get a number blocked.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAIN = 'main' // the number linked by QR code, kept in .auth
const authDir = (id) => path.join(HERE, id === MAIN ? '.auth' : `.auth-${id}`) // delete it to unlink
const PORT = Number(process.env.WHATSAPP_PORT || 8200)
const logger = pino({ level: 'warn' })

/** id -> { id, status: starting | qr | code | connected | offline, qr, code, phone, pairWith, sock, timer } */
const sessions = new Map()
const digits = (value) => String(value || '').replace(/\D/g, '')

function publicView(s) {
  return { id: s.id, status: s.status, qr: s.qr, code: s.code, phone: s.phone, error: s.error || null }
}

async function start(id, pairWith = null) {
  const s = sessions.get(id) || { id, status: 'starting', qr: null, code: null, phone: null, pairWith }
  if (pairWith) s.pairWith = pairWith
  sessions.set(id, s)
  clearTimeout(s.timer)
  Object.assign(s, { status: 'starting', qr: null, code: null, error: null })
  try {
    const { state: auth, saveCreds } = await useMultiFileAuthState(authDir(id))
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
    const sock = makeWASocket({ version, auth, logger, browser: Browsers.windows('Gemini'), markOnlineOnConnect: false, syncFullHistory: false })
    s.sock = sock
    sock.ev.on('creds.update', saveCreds)
    let codeAsked = false
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (s.sock !== sock) return // an older connection of this number
      if (qr && !auth.creds.registered) {
        if (s.pairWith) {
          // Link without a scanner: WhatsApp gives a code to type on the phone that has this number.
          if (!codeAsked) {
            codeAsked = true
            try {
              const code = await sock.requestPairingCode(s.pairWith)
              s.code = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
              s.status = 'code'
            } catch (error) {
              s.error = `Could not get a code for +${s.pairWith}. Check the number and try again.`
              s.status = 'offline'
            }
          }
        } else {
          s.status = 'qr'
          s.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
        }
      }
      if (connection === 'open') {
        Object.assign(s, { status: 'connected', qr: null, code: null, error: null, pairWith: null })
        s.phone = digits((sock.user?.id || '').split(':')[0].split('@')[0]) || null
        console.log(`WhatsApp linked (${id}): +${s.phone}`)
      }
      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode
        s.phone = null
        if (reason === DisconnectReason.loggedOut) {
          // Unlinked from the phone (or here): forget this link.
          fs.rmSync(authDir(id), { recursive: true, force: true })
          console.log(`WhatsApp unlinked (${id}).`)
          if (id !== MAIN) { sessions.delete(id); return } // a code-linked number is linked again from Settings
        }
        if (s.status === 'code' && !auth.creds.registered) {
          Object.assign(s, { status: 'expired', code: null }) // not typed in time; "Get a new code" starts again
          return
        }
        s.status = 'offline'
        s.timer = setTimeout(() => start(id), reason === DisconnectReason.loggedOut ? 500 : 3000)
      }
    })
  } catch (error) {
    s.status = 'offline'
    s.error = String(error?.message || error)
    s.timer = setTimeout(() => start(id), 5000)
  }
}

function stop(id, { forget = false } = {}) {
  const s = sessions.get(id)
  if (s) {
    clearTimeout(s.timer)
    const sock = s.sock
    s.sock = null
    try { sock?.end?.(undefined) } catch { /* already closed */ }
  }
  if (forget) {
    fs.rmSync(authDir(id), { recursive: true, force: true })
    sessions.delete(id)
  }
}

/** Link another number without a scanner: returns its id; the code appears in /status a moment later. */
function link(phone) {
  const number = digits(phone)
  if (number.length < 11) throw Object.assign(new Error('Enter the WhatsApp number with the country code, e.g. 919876543210.'), { code: 400 })
  const id = number
  stop(id, { forget: true }) // a fresh link, with a fresh code
  start(id, number)
  return id
}

function pickSession(account) {
  const linked = [...sessions.values()].filter((s) => s.status === 'connected' && s.sock)
  const wanted = digits(account)
  if (wanted) {
    const own = linked.find((s) => s.id === wanted || s.phone === wanted)
    if (own) return own
    throw Object.assign(new Error(`The WhatsApp +${wanted} chosen on this device is not linked any more. Open Settings → WhatsApp.`), { code: 409 })
  }
  return linked.find((s) => s.id === MAIN) || linked[0]
}

async function send({ account, phone, filename, caption, pdf_base64: pdf, thumbnail_base64: thumb, thumbnail_width, thumbnail_height, page_count }) {
  const s = pickSession(account)
  if (!s) throw Object.assign(new Error('WhatsApp is not linked. Open Settings → WhatsApp and link your number.'), { code: 409 })
  const number = digits(phone)
  if (number.length < 10) throw Object.assign(new Error('This party has no mobile number.'), { code: 400 })
  const [found] = (await s.sock.onWhatsApp(number)) || []
  if (!found?.exists) throw Object.assign(new Error(`+${number} is not on WhatsApp.`), { code: 400 })
  await s.sock.sendMessage(found.jid, {
    document: Buffer.from(pdf, 'base64'),
    mimetype: 'application/pdf',
    fileName: filename || 'bill.pdf',
    caption: caption || undefined,
    // First-page preview shown above the file, with "1 page · PDF" (made by Gemini's server)
    ...(thumb ? {
      jpegThumbnail: Buffer.from(thumb, 'base64'),
      thumbnailWidth: thumbnail_width,
      thumbnailHeight: thumbnail_height,
    } : {}),
    ...(page_count ? { pageCount: page_count } : {}),
  })
  return { number, from: s.phone }
}

// Gemini may be open on several devices (PC, phones): their sends wait their turn, one PDF at a time.
let queue = Promise.resolve()
function oneAtATime(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 25 * 1024 * 1024) { reject(Object.assign(new Error('File too large.'), { code: 413 })); req.destroy() } else chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(Object.assign(new Error('Bad request.'), { code: 400 })) }
    })
    req.on('error', reject)
  })
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/status') {
      // The QR-linked number at the top level (as before), and every linked number in `accounts`.
      const main = sessions.get(MAIN) || { id: MAIN, status: 'starting' }
      return reply(res, 200, { ...publicView(main), accounts: [...sessions.values()].map(publicView) })
    }
    if (req.method === 'POST' && req.url === '/link') {
      const { phone } = await readJson(req)
      return reply(res, 200, { ok: true, id: link(phone) })
    }
    if (req.method === 'POST' && req.url === '/send') {
      const body = await readJson(req)
      const result = await oneAtATime(() => send(body))
      return reply(res, 200, { ok: true, ...result })
    }
    if (req.method === 'POST' && req.url === '/logout') {
      const { id = MAIN } = await readJson(req)
      const s = sessions.get(id)
      if (s?.sock && s.status === 'connected') await s.sock.logout().catch(() => {})
      if (id === MAIN) {
        stop(MAIN, { forget: true })
        start(MAIN) // a fresh QR code
      } else {
        stop(id, { forget: true })
      }
      return reply(res, 200, { ok: true })
    }
    return reply(res, 404, { error: 'Not found.' })
  } catch (error) {
    return reply(res, error.code && error.code >= 400 && error.code < 600 ? error.code : 500, { error: String(error.message || error) })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Gemini WhatsApp service on http://127.0.0.1:${PORT}`)
  start(MAIN)
  // Numbers linked earlier by code stay linked after a restart.
  for (const name of fs.readdirSync(HERE)) {
    const match = /^\.auth-(\d+)$/.exec(name)
    if (match) start(match[1])
  }
})
