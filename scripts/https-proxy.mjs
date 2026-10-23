// Secure (https) address for phones on the same Wi-Fi: https://<this PC's Wi-Fi address>:3443.
// It passes everything to the app on :3100. Phones need a secure address to share files, so with it
// Share → WhatsApp sends the bill PDF itself. The certificate is made by scripts/runner.py (.certs/).
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.HTTPS_PORT || 3443)
const TARGET = { host: '127.0.0.1', port: Number(process.env.APP_PORT || 3100) }

const tls = {
  key: fs.readFileSync(path.join(ROOT, '.certs', 'gemini-key.pem')),
  cert: fs.readFileSync(path.join(ROOT, '.certs', 'gemini-cert.pem')),
}

// The app behind it speaks plain http, so the browser's https Origin is passed on as http
// (the sign-in / CSRF check compares it with the address the app sees).
function forwardHeaders(req) {
  const headers = { ...req.headers }
  if (headers.origin) headers.origin = headers.origin.replace(/^https:/, 'http:')
  if (headers.referer) headers.referer = headers.referer.replace(/^https:/, 'http:')
  return headers
}

const server = https.createServer(tls, (req, res) => {
  const upstream = http.request({ ...TARGET, method: req.method, path: req.url, headers: forwardHeaders(req) }, (reply) => {
    res.writeHead(reply.statusCode || 502, reply.headers)
    reply.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Gemini is starting. Try again in a moment.')
  })
  req.pipe(upstream)
})

// Live-reload connection of the app (websocket): pass the raw connection through.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(TARGET.port, TARGET.host, () => {
    const headers = forwardHeaders(req)
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', '']
    upstream.write(lines.join('\r\n'))
    if (head?.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PORT, '0.0.0.0', () => console.log(`Secure address ready on port ${PORT} -> app on ${TARGET.port}`))
