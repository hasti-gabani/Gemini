/**
 * Bluetooth thermal receipt printing (ESC/POS raster images over Web Bluetooth).
 *
 * Cheap 58/80 mm printers cannot print Gujarati or ₹ in text mode, so the receipt is drawn on a
 * <canvas> with the app's own fonts, converted to 1 bit per pixel and sent as `GS v 0` raster bands.
 * Anything the browser can render prints correctly.
 *
 *   layoutReceipt(doc)          document JSON (backend/transactions/documents.py) -> drawing ops (pure)
 *   planReceipt(ops, {measure}) ops -> positioned draw commands for a paper width (pure)
 *   renderReceiptCanvas(doc)    -> <canvas>;  toMonochrome(imageData) -> packed bits
 *   buildEscPosJob(raster)      -> printer bytes;  printDocumentViaBluetooth(doc) does it all
 *
 * Call printDocumentViaBluetooth() straight from a tap/click handler with the document JSON already
 * loaded: the browser only opens the printer chooser during a fresh user gesture.
 * Browser globals are touched only inside functions, so this module imports cleanly in Node.
 */

export const PAPER = { '58': { dots: 384 }, '80': { dots: 576 } }

const BASE_DOTS = 384
const FONT_STACK = '"Inter Variable", "Noto Sans Gujarati Variable", system-ui, sans-serif'
const FONT_FAMILIES = ['Inter Variable', 'Noto Sans Gujarati Variable']
// Pixel sizes at 384 dots (58 mm). Everything is scaled by dots / 384, i.e. x1.5 on 80 mm paper.
const SIZES = {
  sm: { font: 17, line: 22 },
  md: { font: 20, line: 26 },
  lg: { font: 26, line: 34 },
}
const WEIGHT_REGULAR = 500 // slightly heavier than 400 so thin strokes survive the 1-bit conversion
const WEIGHT_BOLD = 700
const PAD_X = 6
const PAD_TOP = 6
const PAD_BOTTOM = 10
const RULE_HEIGHT = 14
const RULE_THICKNESS = 2
const DASH_ON = 6
const DASH_OFF = 4
const ROW_GAP = 12
const PILL_PAD_X = 10
const PILL_PAD_Y = 3
const MAX_CANVAS_HEIGHT = 32000

/* ------------------------------------------------------------------------------------------------ */
/* Text helpers                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const isObject = (value) => Boolean(value) && typeof value === 'object'

/** Single-line text: '' for null/undefined/objects, whitespace collapsed. */
function line(value) {
  if (value === null || value === undefined || typeof value === 'object') return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Multi-line text: keeps line breaks (at most one blank line in a row), trims every line. */
function para(value) {
  if (value === null || value === undefined || typeof value === 'object') return ''
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function pairs(entries) {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => {
      if (Array.isArray(entry)) return [line(entry[0]), line(entry[1])]
      return isObject(entry) ? [line(entry.label), line(entry.value)] : ['', '']
    })
    .filter(([label, value]) => label || value)
}

function isZeroAmount(value) {
  const text = line(value).replace(/[₹,\s+-]/g, '')
  return /^(\d+\.?\d*|\.\d+)$/.test(text) && Number(text) === 0
}

const BANK_FIELDS = [
  ['bank_name', 'Bank Name'],
  ['account_name', 'Account Name'],
  ['account_number', 'Account No.'],
  ['ifsc', 'IFSC Code'],
  ['branch', 'Branch'],
  ['upi_id', 'UPI ID'],
]

let segmenter = null

/** Grapheme clusters, never splitting a Gujarati/Devanagari conjunct, vowel sign or ZWJ sequence. */
function graphemes(text) {
  let parts
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    segmenter ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    parts = Array.from(segmenter.segment(text), (item) => item.segment)
  } else {
    parts = Array.from(text)
  }
  const out = []
  for (const part of parts) {
    const prev = out[out.length - 1]
    if (prev !== undefined && (/^[\p{M}‌‍]/u.test(part) || /[्્‍]$/.test(prev))) {
      out[out.length - 1] = prev + part
    } else {
      out.push(part)
    }
  }
  return out
}

/**
 * Word-wrap `text` to `maxWidth` using `measure(text) -> width`. Honours line breaks (blank lines
 * become ''), and words wider than a line are broken between grapheme clusters.
 */
export function wrapText(text, maxWidth, measure) {
  const lines = []
  const source = text === null || text === undefined ? '' : String(text)
  for (const paragraph of source.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = ''
      if (measure(word) <= maxWidth) {
        current = word
        continue
      }
      for (const piece of graphemes(word)) {
        if (current && measure(current + piece) > maxWidth) {
          lines.push(current)
          current = piece
        } else {
          current += piece
        }
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

/* ------------------------------------------------------------------------------------------------ */
/* Layout: document JSON -> ops                                                                     */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Document JSON -> flat list of drawing ops (pure, no DOM):
 *   { type: 'text', text, align: 'left'|'center'|'right', size: 'sm'|'md'|'lg', bold, invert? }
 *   { type: 'row', left, right, bold, size }   left wraps, right is right-aligned
 *   { type: 'rule', style: 'dashed'|'solid' }
 *   { type: 'space', height }                  pixels at 58 mm
 * Empty fields are skipped; text never contains 'undefined'/'null'.
 */
export function layoutReceipt(doc) {
  const d = isObject(doc) ? doc : {}
  const ops = []

  const addText = (value, { align = 'left', size = 'md', bold = false, invert = false, multiline = false } = {}) => {
    const content = multiline ? para(value) : line(value)
    if (!content) return
    const op = { type: 'text', text: content, align, size, bold }
    if (invert) op.invert = true
    ops.push(op)
  }
  const addRow = (left, right, { size = 'md', bold = false } = {}) => {
    const l = line(left)
    const r = line(right)
    if (l || r) ops.push({ type: 'row', left: l, right: r, bold, size })
  }
  const addRule = (style = 'dashed') => {
    if (!ops.some((op) => op.type === 'text' || op.type === 'row')) return // nothing to separate yet
    const last = ops[ops.length - 1]
    if (last && last.type === 'rule') last.style = style // never two rules in a row
    else ops.push({ type: 'rule', style })
  }
  const addSpace = (height) => ops.push({ type: 'space', height })
  const addBlock = (title, value) => {
    if (!para(value)) return
    addText(title, { size: 'sm', bold: true })
    addText(value, { size: 'sm', multiline: true })
  }
  const list = (value) => (Array.isArray(value) ? value.filter(isObject) : [])

  const docType = line(d.doc_type)
  const isReceipt = docType === 'payment_in' || docType === 'payment_out'
    || (!docType && Array.isArray(d.allocations) && !Array.isArray(d.items))
  const business = isObject(d.business) ? d.business : {}
  const businessName = line(business.name)

  // Header
  addText(businessName, { align: 'center', size: 'lg', bold: true })
  addText(business.address, { align: 'center', size: 'sm', multiline: true })
  if (line(business.phone)) addText(`Phone: ${line(business.phone)}`, { align: 'center', size: 'sm' })
  addText(business.email, { align: 'center', size: 'sm' })
  if (line(business.gstin)) addText(`GSTIN: ${line(business.gstin)}`, { align: 'center', size: 'sm' })
  if (ops.length) addRule()
  addText(d.title, { align: 'center', size: 'md', bold: true })
  if (!isReceipt && line(d.status_label)) {
    addSpace(4)
    addText(d.status_label, { align: 'center', size: 'sm', bold: true, invert: true })
  }
  addSpace(6)

  // Meta + party
  for (const [label, value] of pairs(d.meta)) addRow(label, value)
  const party = isObject(d.party) ? d.party : {}
  const partyName = line(party.name)
  const partyLabel = line(d.party_label)
  const partyStart = ops.length
  if (partyName) addText(partyLabel ? `${partyLabel}: ${partyName}` : partyName, { bold: true })
  if (line(party.phone)) addText(`Phone: ${line(party.phone)}`, { size: 'sm' })
  addText(party.address, { size: 'sm', multiline: true })
  if (line(party.gstin)) addText(`GSTIN: ${line(party.gstin)}`, { size: 'sm' })
  if (ops.length > partyStart) ops.splice(partyStart, 0, { type: 'space', height: 6 })
  addRule()

  if (isReceipt) {
    const amountLabel = docType === 'payment_out' ? 'Amount Paid' : 'Amount Received'
    addRow(line(d.amount) ? amountLabel : '', d.amount, { size: 'lg', bold: true })
    if (line(d.amount_in_words)) addText(d.amount_in_words, { size: 'sm' })

    const allocations = list(d.allocations)
    if (allocations.length) {
      addRule()
      addText('Payment applied to bills', { size: 'sm', bold: true })
      for (const item of allocations) {
        const date = line(item.date)
        addRow([line(item.number), date && `(${date})`].filter(Boolean).join(' '), item.amount)
        if (line(item.bill_total)) addText(`Bill total: ${line(item.bill_total)}`, { size: 'sm' })
      }
    }
    const hasUnallocated = line(d.unallocated_label) || line(d.unallocated)
    const hasBalance = line(d.party_balance_label) || line(d.party_balance)
    if (hasUnallocated || hasBalance) {
      addRule()
      addRow(d.unallocated_label, d.unallocated)
      addRow(d.party_balance_label, d.party_balance)
    }
    if (para(d.notes)) {
      addRule()
      addBlock('Notes', d.notes)
    }
  } else {
    const items = list(d.items)
    const columns = isObject(d.columns) ? d.columns : {}
    const showColumn = (key) => columns[key] !== false
    if (items.length) {
      addRow('Item', 'Amount', { size: 'sm', bold: true })
      addRule()
      items.forEach((item, index) => {
        if (index) addSpace(6)
        const sno = line(item.sno) || String(index + 1)
        addText(`${sno}. ${line(item.name)}`.trim(), { bold: true })
        addText(item.description, { size: 'sm' })
        const qty = [line(item.qty), line(item.unit)].filter(Boolean).join(' ')
        const rate = line(item.rate)
        addRow(qty && rate ? `${qty} × ${rate}` : qty || rate, item.amount)
        const extras = []
        if (showColumn('hsn') && line(item.hsn)) extras.push(`HSN: ${line(item.hsn)}`)
        for (const [key, word] of [['discount', 'Disc'], ['tax', 'Tax']]) {
          if (!showColumn(key) || !line(item[key]) || isZeroAmount(item[key])) continue
          const label = line(item[`${key}_label`])
          extras.push(`${word}${label ? ` ${label}` : ''}: ${line(item[key])}`)
        }
        if (extras.length) addText(extras.join(' · '), { size: 'sm' })
      })
    } else if (line(d.total)) {
      addRow(docType === 'purchase' ? 'Purchase amount' : 'Sale amount', d.total)
    }
    addRule()

    if (items.length && line(d.total_qty)) addRow('Total Qty', d.total_qty)
    for (const [label, value] of pairs(d.summary)) addRow(label, value)
    if (line(d.total)) {
      addRule('solid')
      addRow('TOTAL', d.total, { size: 'lg', bold: true })
      addRule('solid')
    }
    addRow(d.paid_label, d.paid)
    const partyBalances = pairs(d.party_balances)
    addRow(d.balance_label, d.balance, { bold: !partyBalances.length })
    if (partyBalances.length) {
      addRule()
      partyBalances.forEach(([label, value], index) => addRow(label, value, { bold: index === partyBalances.length - 1 }))
    }
    if (line(d.amount_in_words)) {
      addSpace(4)
      addText(d.amount_in_words, { size: 'sm' })
    }

    const payments = list(d.payments)
    if (payments.length) {
      addRule()
      addText('Payment History', { size: 'sm', bold: true })
      for (const p of payments) {
        addRow([line(p.number), line(p.date), line(p.mode)].filter(Boolean).join(' · '), p.amount, { size: 'sm' })
      }
    }
    const taxRows = list(d.tax_summary)
    if (taxRows.length) {
      addRule()
      addText('Tax Summary', { size: 'sm', bold: true })
      for (const t of taxRows) {
        const taxable = line(t.taxable)
        addRow([line(t.rate), taxable && `on ${taxable}`].filter(Boolean).join(' '), t.tax, { size: 'sm' })
      }
    }
    if (para(d.notes) || para(d.terms)) {
      addRule()
      addBlock('Notes', d.notes)
      if (para(d.notes) && para(d.terms)) addSpace(4)
      addBlock('Terms & Conditions', d.terms)
    }
    const bank = isObject(d.bank) ? BANK_FIELDS.filter(([key]) => line(d.bank[key])) : []
    if (bank.length) {
      addRule()
      addText('Bank Details', { size: 'sm', bold: true })
      for (const [key, label] of bank) addRow(label, d.bank[key], { size: 'sm' })
    }
  }

  // Tail
  if (d.show_signature) {
    addSpace(10)
    if (businessName) addText(`For ${businessName}`, { align: 'center', size: 'sm', bold: true })
    addSpace(44)
    addRule('solid')
    addText('Authorised Signatory', { align: 'center', size: 'sm' })
  }
  const footer = para(d.footer_note)
  if (footer) {
    addRule()
    addText(footer, { align: 'center', bold: true, multiline: true })
  }
  if (!/thank|આભાર|ધન્યવાદ/i.test(footer)) {
    addSpace(6)
    addText('Thank you!', { align: 'center', size: 'sm' })
  }
  addSpace(12)
  return ops
}

/* ------------------------------------------------------------------------------------------------ */
/* Plan: ops -> positioned commands                                                                 */
/* ------------------------------------------------------------------------------------------------ */

function paperSpec(paper) {
  const key = String(paper ?? '').replace(/\D/g, '') // accepts 58, '80', '80mm', 'thermal58'
  return PAPER[key] || PAPER['58']
}

/**
 * Positions ops for a paper width (pure). `measure(text, font)` returns the width in device pixels,
 * where font = { size: 'sm'|'md'|'lg', bold, px }. Returns { width, height, scale, commands } with
 * commands { kind: 'text', text, x, y (alphabetic baseline), font, color? } and
 * { kind: 'rect', x, y, w, h, radius? } (filled black).
 */
export function planReceipt(ops, { paper = '58', measure } = {}) {
  if (typeof measure !== 'function') throw new TypeError('planReceipt needs a measure(text, font) function.')
  const { dots } = paperSpec(paper)
  const scale = dots / BASE_DOTS
  const px = (value) => Math.round(value * scale)
  const left = px(PAD_X)
  const right = dots - left
  const inner = right - left
  const commands = []
  let y = px(PAD_TOP)

  const metricsFor = (op) => {
    const size = SIZES[op.size] ? op.size : 'md'
    const font = { size, bold: Boolean(op.bold), px: px(SIZES[size].font) }
    const lineHeight = px(SIZES[size].line)
    return {
      font,
      lineHeight,
      width: (text) => measure(text, font),
      baseline: (top) => top + Math.round((lineHeight - font.px) / 2 + font.px * 0.8),
    }
  }
  const pushText = (text, x, top, m, color) => {
    const command = { kind: 'text', text, x: Math.max(0, Math.round(x)), y: m.baseline(top), font: m.font }
    if (color) command.color = color
    commands.push(command)
  }

  const planText = (op) => {
    const text = para(op.text)
    if (!text) return
    const m = metricsFor(op)
    const align = op.align === 'center' || op.align === 'right' ? op.align : 'left'
    const xFor = (width) => (align === 'center' ? left + (inner - width) / 2 : align === 'right' ? right - width : left)
    if (op.invert) {
      const padX = px(PILL_PAD_X)
      const padY = px(PILL_PAD_Y)
      for (const piece of wrapText(text, inner - 2 * padX, m.width)) {
        if (!piece) continue
        const boxWidth = Math.ceil(m.width(piece)) + 2 * padX
        const x = Math.max(0, Math.round(xFor(boxWidth)))
        commands.push({ kind: 'rect', x, y, w: boxWidth, h: m.lineHeight + 2 * padY, radius: px(4) })
        pushText(piece, x + padX, y + padY, m, 'white')
        y += m.lineHeight + 2 * padY
      }
      return
    }
    for (const piece of wrapText(text, inner, m.width)) {
      if (piece) pushText(piece, xFor(m.width(piece)), y, m)
      y += m.lineHeight
    }
  }

  const planRow = (op) => {
    const leftText = para(op.left)
    const rightText = line(op.right)
    if (!leftText && !rightText) return
    const m = metricsFor(op)
    const gap = px(ROW_GAP)
    let leftLines = []
    let rightLines = []
    let stacked = false
    if (!rightText) {
      leftLines = wrapText(leftText, inner, m.width)
    } else if (!leftText) {
      rightLines = wrapText(rightText, inner, m.width)
    } else {
      const rightWidth = m.width(rightText)
      const leftWidth = Math.max(...leftText.split('\n').map(m.width))
      if (leftWidth + gap + rightWidth <= inner) {
        leftLines = leftText.split('\n')
        rightLines = [rightText]
      } else if (rightWidth <= inner * 0.6) {
        leftLines = wrapText(leftText, inner - gap - rightWidth, m.width)
        rightLines = [rightText]
        // "Current Balance" + value on the next line reads better than "Current <value> / Balance"
        stacked = leftLines.length > 1 && !leftText.includes('\n') && leftWidth <= inner
        if (stacked) leftLines = [leftText]
      } else if (!leftText.includes('\n') && leftWidth <= inner * 0.4) {
        leftLines = [leftText]
        rightLines = wrapText(rightText, inner - gap - leftWidth, m.width)
      } else {
        leftLines = wrapText(leftText, inner, m.width)
        rightLines = wrapText(rightText, inner, m.width)
        stacked = true
      }
    }
    if (stacked) {
      for (const piece of leftLines) {
        if (piece) pushText(piece, left, y, m)
        y += m.lineHeight
      }
      for (const piece of rightLines) {
        if (piece) pushText(piece, right - m.width(piece), y, m)
        y += m.lineHeight
      }
      return
    }
    const count = Math.max(leftLines.length, rightLines.length)
    for (let i = 0; i < count; i += 1) {
      if (leftLines[i]) pushText(leftLines[i], left, y, m)
      if (rightLines[i]) pushText(rightLines[i], right - m.width(rightLines[i]), y, m)
      y += m.lineHeight
    }
  }

  for (const op of Array.isArray(ops) ? ops : []) {
    if (!isObject(op)) continue
    if (op.type === 'text') {
      planText(op)
    } else if (op.type === 'row') {
      planRow(op)
    } else if (op.type === 'space') {
      y += Math.max(0, px(Number(op.height) || 0))
    } else if (op.type === 'rule') {
      const thickness = Math.max(1, px(RULE_THICKNESS))
      const top = y + Math.floor((px(RULE_HEIGHT) - thickness) / 2)
      if (op.style === 'solid') {
        commands.push({ kind: 'rect', x: left, y: top, w: inner, h: thickness })
      } else {
        const on = px(DASH_ON)
        for (let x = left; x < right; x += on + px(DASH_OFF)) {
          commands.push({ kind: 'rect', x, y: top, w: Math.min(on, right - x), h: thickness })
        }
      }
      y += px(RULE_HEIGHT)
    }
  }
  return { width: dots, height: y + px(PAD_BOTTOM), scale, commands }
}

/* ------------------------------------------------------------------------------------------------ */
/* Canvas rendering (browser only)                                                                  */
/* ------------------------------------------------------------------------------------------------ */

const FONT_TIMEOUT = 4000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fontCss(font) {
  return `${font.bold ? WEIGHT_BOLD : WEIGHT_REGULAR} ${font.px}px ${FONT_STACK}`
}

/** Canvas text silently falls back to system fonts while a web font is still loading, so load first. */
async function loadFonts(ops) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null
  if (!fonts) return
  const chars = new Set()
  for (const op of ops) {
    for (const value of [op.text, op.left, op.right]) {
      if (typeof value === 'string') for (const ch of value) chars.add(ch)
    }
  }
  const sample = [...chars].join('')
  const requests = []
  if (sample && typeof fonts.load === 'function') {
    // Passing the text makes the browser fetch every unicode-range subset it needs (Gujarati, ₹ ...).
    for (const family of FONT_FAMILIES) {
      for (const weight of [WEIGHT_REGULAR, WEIGHT_BOLD]) {
        requests.push(fonts.load(`${weight} 20px "${family}"`, sample).catch(() => []))
      }
    }
  }
  const settled = Promise.all(requests).then(() => fonts.ready).catch(() => {})
  await Promise.race([settled, sleep(FONT_TIMEOUT)])
}

function drawPlan(ctx, plan) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, plan.width, plan.height)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const command of plan.commands) {
    ctx.fillStyle = command.color === 'white' ? '#ffffff' : '#000000'
    if (command.kind === 'rect') {
      if (command.radius && typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(command.x, command.y, command.w, command.h, command.radius)
        ctx.fill()
      } else {
        ctx.fillRect(command.x, command.y, command.w, command.h)
      }
    } else if (command.kind === 'text') {
      ctx.font = fontCss(command.font)
      ctx.fillText(command.text, command.x, command.y)
    }
  }
}

/** Draws the receipt on a white canvas exactly `PAPER[paper].dots` wide and as tall as the content. */
export async function renderReceiptCanvas(doc, { paper = '58' } = {}) {
  if (typeof document === 'undefined') throw new Error('Receipt images can only be drawn in a browser.')
  const ops = layoutReceipt(doc)
  await loadFonts(ops)
  const canvas = document.createElement('canvas')
  canvas.width = paperSpec(paper).dots
  canvas.height = 1
  // willReadFrequently keeps the canvas in memory: faster getImageData and no GPU size limits.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not prepare the receipt image.')
  let currentFont = ''
  const measure = (text, font) => {
    const css = fontCss(font)
    if (css !== currentFont) {
      ctx.font = css
      currentFont = css
    }
    return ctx.measureText(text).width
  }
  const plan = planReceipt(ops, { paper, measure }) // pass 1: measure
  if (plan.height > MAX_CANVAS_HEIGHT) {
    throw new Error('This document is too long for a receipt printer. Print or share it as a PDF instead.')
  }
  canvas.height = plan.height // resets the context state
  drawPlan(ctx, plan) // pass 2: draw
  return canvas
}

/* ------------------------------------------------------------------------------------------------ */
/* 1-bit raster + ESC/POS                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/**
 * RGBA pixels -> { width, height, bits } packed 1 bpp, MSB first, each row padded to whole bytes,
 * 1 = black. A pixel is black when its luminance (composited over white, so transparent = white)
 * is below `threshold`.
 */
export function toMonochrome(imageData, { threshold = 170 } = {}) {
  const { width, height, data } = imageData || {}
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0
    || !data || data.length < width * height * 4) {
    throw new TypeError('toMonochrome expects { width, height, data } with RGBA pixel data.')
  }
  const rowBytes = (width + 7) >> 3
  const bits = new Uint8Array(rowBytes * height)
  // luminance' = 255 - alpha/255 * (255 - luma) < threshold, in integers (luma scaled by 1000)
  const limit = (255 - Number(threshold)) * 255 * 1000
  for (let y = 0, i = 0; y < height; y += 1) {
    const row = y * rowBytes
    for (let x = 0; x < width; x += 1, i += 4) {
      const alpha = data[i + 3]
      if (!alpha) continue
      const luma = data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114
      if (alpha * (255000 - luma) > limit) bits[row + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return { width, height, bits }
}

/**
 * Raster -> printer bytes: ESC @, then `GS v 0 0 xL xH yL yH <data>` per band of <= bandHeight rows
 * (x = bytes per row, y = rows), then ESC d feedLines and optionally GS V 66 0 (partial cut).
 */
export function buildEscPosJob(raster, { feedLines = 3, cut = true, bandHeight = 255 } = {}) {
  const { width, height } = raster || {}
  const rowBytes = (width + 7) >> 3
  if (!Number.isInteger(width) || width <= 0 || rowBytes > 0xffff || !Number.isInteger(height) || height < 0
    || !raster.bits || raster.bits.length < rowBytes * height) {
    throw new TypeError('buildEscPosJob expects { width, height, bits } from toMonochrome().')
  }
  const bits = raster.bits instanceof Uint8Array ? raster.bits : Uint8Array.from(raster.bits)
  const band = Math.min(0xffff, Math.max(1, Math.floor(Number(bandHeight)) || 255))
  const feed = Math.min(255, Math.max(0, Math.floor(Number(feedLines)) || 0))
  const bands = Math.ceil(height / band)
  const job = new Uint8Array(2 + bands * 8 + rowBytes * height + (feed ? 3 : 0) + (cut ? 4 : 0))
  let offset = 0
  const put = (...bytes) => {
    job.set(bytes, offset)
    offset += bytes.length
  }
  put(0x1b, 0x40) // ESC @ initialise
  for (let top = 0; top < height; top += band) {
    const rows = Math.min(band, height - top)
    put(0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8) // GS v 0 m=0
    job.set(bits.subarray(top * rowBytes, (top + rows) * rowBytes), offset)
    offset += rows * rowBytes
  }
  if (feed) put(0x1b, 0x64, feed) // ESC d n: print and feed n lines
  if (cut) put(0x1d, 0x56, 0x42, 0x00) // GS V 66 0: feed to cutter and partial cut (ignored without one)
  return job
}

/* ------------------------------------------------------------------------------------------------ */
/* Web Bluetooth                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
]
// Known data characteristic for services that expose more than one writable characteristic.
const PREFERRED_CHARACTERISTICS = {
  '000018f0-0000-1000-8000-00805f9b34fb': '00002af1-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2': 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455': '49535343-8841-43f4-a8d4-ecbe34729bb3',
  '0000ae30-0000-1000-8000-00805f9b34fb': '0000ae01-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb': '0000ffe1-0000-1000-8000-00805f9b34fb',
}

const MESSAGES = {
  unsupported: 'Bluetooth printing needs Chrome or Edge on Android, Windows, macOS or ChromeOS. On iPhone use Share → a printer app, or print from a computer.',
  insecure: 'Bluetooth printing only works when the app is opened over a secure (https://) address.',
  cancelled: 'Printer selection was cancelled.',
  notPrinter: 'This Bluetooth device does not look like a supported receipt printer.',
  connect: 'Could not connect to the printer. Make sure it is on, paired and not connected to another phone.',
  bluetoothOff: 'Bluetooth is off or not available on this device. Turn on Bluetooth and try again.',
  permission: 'Bluetooth access is blocked for this browser. Allow Bluetooth (Nearby devices) permission and try again.',
  gesture: 'Could not open the printer list. Tap Print again.',
  busy: 'A receipt is already printing. Please wait for it to finish.',
  interrupted: 'Printing stopped because the printer disconnected. Check the printer and try again.',
  sendFailed: 'The printer did not accept the receipt. Turn the printer off and on, then try again.',
}

const CHUNK_SIZE = 180
const SMALL_CHUNK = 20
const CHUNK_DELAY = 20
const CONNECT_TIMEOUT = 15000

const printer = { device: null, characteristic: null }
let printing = false

function friendlyError(message, cause, name) {
  const error = new Error(message, cause ? { cause } : undefined)
  if (name) error.name = name
  return error
}

export function isBluetoothPrintSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth)
}

function unsupportedError() {
  // Chrome hides navigator.bluetooth on plain http:// (e.g. testing from a phone on the LAN).
  const insecure = typeof window !== 'undefined' && window.isSecureContext === false
    && typeof navigator !== 'undefined' && /\bChrom(e|ium)\//.test(navigator.userAgent || '')
  return friendlyError(insecure ? MESSAGES.insecure : MESSAGES.unsupported)
}

function onDisconnected() {
  printer.characteristic = null // keep the device: the next print reconnects without the chooser
}

function forgetPrinter() {
  const { device } = printer
  printer.device = null
  printer.characteristic = null
  if (!device) return
  try {
    device.removeEventListener('gattserverdisconnected', onDisconnected)
    if (device.gatt && device.gatt.connected) device.gatt.disconnect()
  } catch {
    /* already gone */
  }
}

export function disconnectPrinter() {
  forgetPrinter()
}

async function choosePrinter() {
  try {
    return await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES })
  } catch (error) {
    const message = String((error && error.message) || '')
    const name = error && error.name
    if (name === 'NotFoundError') {
      if (/adapter|bluetooth is (off|unavailable)|not available/i.test(message)) throw friendlyError(MESSAGES.bluetoothOff, error)
      if (/permission|denied|disabled|blocked/i.test(message)) throw friendlyError(MESSAGES.permission, error)
      throw friendlyError(MESSAGES.cancelled, error, 'AbortError')
    }
    if (name === 'SecurityError' || name === 'NotAllowedError') {
      throw friendlyError(/gesture|activation/i.test(message) ? MESSAGES.gesture : MESSAGES.permission, error)
    }
    throw friendlyError(MESSAGES.connect, error)
  }
}

function withTimeout(promise, ms, onTimeout) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout()
      } catch {
        /* ignore */
      }
      reject(new Error('Timed out'))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function writableCharacteristic(service) {
  let characteristics = []
  try {
    characteristics = await service.getCharacteristics()
  } catch {
    return null
  }
  const writable = characteristics.filter((c) => c.properties && (c.properties.writeWithoutResponse || c.properties.write))
  const preferred = PREFERRED_CHARACTERISTICS[service.uuid]
  return writable.find((c) => c.uuid === preferred) || writable[0] || null
}

async function findWritableCharacteristic(server) {
  const seen = new Set()
  for (const uuid of PRINTER_SERVICES) {
    let service = null
    try {
      service = await server.getPrimaryService(uuid)
    } catch {
      continue // not on this device
    }
    seen.add(service.uuid)
    const found = await writableCharacteristic(service)
    if (found) return found
  }
  let services = []
  try {
    services = await server.getPrimaryServices()
  } catch {
    /* nothing else accessible */
  }
  for (const service of services) {
    if (seen.has(service.uuid)) continue
    const found = await writableCharacteristic(service)
    if (found) return found
  }
  if (!server.connected) throw new Error('GATT server disconnected during discovery')
  return null
}

async function connectPrinter() {
  if (!printer.device) {
    const device = await choosePrinter()
    device.addEventListener('gattserverdisconnected', onDisconnected)
    printer.device = device
  }
  const { device } = printer
  if (device.gatt && device.gatt.connected && printer.characteristic) return printer
  let characteristic = null
  try {
    if (!device.gatt) throw new Error('Device has no GATT server')
    const server = device.gatt.connected
      ? device.gatt
      : await withTimeout(device.gatt.connect(), CONNECT_TIMEOUT, () => device.gatt.disconnect())
    characteristic = await findWritableCharacteristic(server)
  } catch (error) {
    forgetPrinter() // lets the user pick again next time (maybe the wrong device was chosen)
    throw friendlyError(MESSAGES.connect, error)
  }
  if (!characteristic) {
    forgetPrinter()
    throw friendlyError(MESSAGES.notPrinter)
  }
  printer.characteristic = characteristic
  return printer
}

function reportProgress(onProgress, sent, total) {
  if (typeof onProgress !== 'function') return
  try {
    onProgress({ sent, total })
  } catch {
    /* a UI callback error must not stop printing */
  }
}

async function sendBytes(characteristic, bytes, { chunkSize, chunkDelay, onProgress }) {
  const withoutResponse = Boolean(characteristic.properties && characteristic.properties.writeWithoutResponse
    && typeof characteristic.writeValueWithoutResponse === 'function')
  const write = (chunk) => {
    if (withoutResponse) return characteristic.writeValueWithoutResponse(chunk)
    if (typeof characteristic.writeValueWithResponse === 'function') return characteristic.writeValueWithResponse(chunk)
    return characteristic.writeValue(chunk)
  }
  const total = bytes.length
  const initialSize = Math.max(1, Math.floor(Number(chunkSize)) || CHUNK_SIZE)
  let size = initialSize
  let sent = 0
  let failures = 0
  reportProgress(onProgress, 0, total)
  while (sent < total) {
    const chunk = bytes.slice(sent, sent + size)
    try {
      await write(chunk)
    } catch (error) {
      failures += 1
      const gatt = characteristic.service && characteristic.service.device && characteristic.service.device.gatt
      if ((gatt && !gatt.connected) || failures > 3) throw error
      size = Math.min(size, SMALL_CHUNK) // some printers only accept 20-byte packets (default BLE MTU)
      await sleep(150 * failures)
      continue
    }
    failures = 0
    sent += chunk.length
    reportProgress(onProgress, sent, total)
    const delay = Math.round((Math.max(0, Number(chunkDelay) || 0) * size) / initialSize)
    if (sent < total && delay) await sleep(delay) // pacing so cheap printers do not overflow
  }
}

/**
 * Renders `doc` and prints it on a Bluetooth (BLE) ESC/POS receipt printer. Opens the browser's
 * device chooser the first time; later prints reuse (and reconnect to) the same printer.
 * Resolves { printer: name, bytes }. Errors carry friendly messages; a cancelled chooser rejects
 * with name 'AbortError'.
 */
export async function printDocumentViaBluetooth(doc, { paper = '58', onProgress, chunkSize = CHUNK_SIZE, chunkDelay = CHUNK_DELAY } = {}) {
  if (!isBluetoothPrintSupported()) throw unsupportedError()
  if (printing) throw friendlyError(MESSAGES.busy)
  printing = true
  try {
    // Connect before rendering: the chooser only opens while the user's tap is still fresh.
    const { device, characteristic } = await connectPrinter()
    const canvas = await renderReceiptCanvas(doc, { paper })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const job = buildEscPosJob(toMonochrome(ctx.getImageData(0, 0, canvas.width, canvas.height)))
    try {
      await sendBytes(characteristic, job, { chunkSize, chunkDelay, onProgress })
    } catch (error) {
      const stillConnected = Boolean(device.gatt && device.gatt.connected)
      if (stillConnected) forgetPrinter() // writes refused on a live link: let the user pick again
      else printer.characteristic = null // printer went away: reconnect to it next time
      throw friendlyError(stillConnected ? MESSAGES.sendFailed : MESSAGES.interrupted, error)
    }
    return { printer: device.name || 'Bluetooth printer', bytes: job.length }
  } finally {
    printing = false
  }
}
