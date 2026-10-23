// Pure-function tests for src/lib/thermalPrint.js (no DOM, no Bluetooth).
// Run: node frontend/scripts/thermalPrint.test.mjs
import assert from 'node:assert/strict'
import {
  PAPER,
  buildEscPosJob,
  isBluetoothPrintSupported,
  layoutReceipt,
  planReceipt,
  toMonochrome,
  wrapText,
} from '../src/lib/thermalPrint.js'

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}\n  ${String(error && error.stack ? error.stack : error).split('\n').slice(0, 6).join('\n  ')}`)
  }
}

/* ------------------------------------------------------------------ fixtures */

const bill = {
  doc_type: 'sale',
  title: 'TAX INVOICE',
  business: { name: 'Shreeji Traders', address: 'Station Road, Rajkot', phone: '98250 12345', email: '', gstin: '', logo_url: null },
  party_label: 'Bill To',
  party: { name: 'ઘનશ્યામભાઈ નાના', phone: '99090 11223', address: '', gstin: '' },
  meta: [
    { label: 'Invoice No.', value: 'INV-0042' },
    { label: 'Date', value: '16/09/2026' },
    { label: 'Due Date', value: '30/09/2026' },
    { label: 'Payment', value: 'Credit' },
  ],
  status: 'partial',
  status_label: 'PARTIALLY PAID',
  columns: { hsn: false, discount: true, tax: true },
  items: [
    { sno: 1, name: 'Sugar', description: '', hsn: '', qty: '2', unit: 'Kg', rate: '515.50', discount: '103.10', discount_label: '10%', tax_label: '5%', tax: '46.40', amount: '974.30' },
    { sno: 2, name: 'ખાંડ Premium Basmati Rice Long Grain 25 Kg Bag', description: 'Code: RICE25', hsn: '1006', qty: '1', unit: 'Bag', rate: '9,025.70', discount: '', discount_label: '', tax_label: '', tax: '', amount: '9,025.70' },
  ],
  total_qty: '3',
  summary: [
    { label: 'Subtotal', value: '₹10,031.00' },
    { label: 'Item Discount', value: '- ₹103.10' },
    { label: 'GST', value: '₹46.40' },
    { label: 'Round Off', value: '+ ₹25.70' },
  ],
  total: '₹10,000.00',
  paid_label: 'Received',
  paid: '₹4,000.00',
  balance_label: 'Balance Due',
  balance: '₹6,000.00',
  amount_in_words: 'Ten Thousand Rupees Only',
  payments: [],
  notes: '',
  terms: '',
  bank: null,
  show_signature: false,
  footer_note: '',
  tax_summary: [],
}

const receipt = {
  doc_type: 'payment_in',
  title: 'PAYMENT RECEIPT',
  business: { name: 'Shreeji Traders', address: '', phone: '', email: 'shop@example.com', gstin: '24ABCDE1234F1Z5', logo_url: null },
  party_label: 'Received From',
  party: { name: 'ઘનશ્યામભાઈ નાના', phone: '', address: 'Bhaktinagar,\nRajkot', gstin: '' },
  meta: [
    { label: 'Receipt No.', value: 'REC-7' },
    { label: 'Date', value: '16/09/2026' },
    { label: 'Payment Mode', value: 'Cash' },
  ],
  amount: '₹5,000.00',
  amount_in_words: 'Five Thousand Rupees Only',
  allocations: [{ number: 'INV-0042', date: '01/09/2026', bill_total: '₹10,000.00', amount: '₹4,000.00' }],
  unallocated_label: 'Advance / not linked to a bill',
  unallocated: '₹1,000.00',
  party_balance_label: 'Current Balance',
  party_balance: '₹6,000.00 (Receivable)',
  notes: 'Paid by son',
  show_signature: false,
  footer_note: '',
}

const strings = (ops) => ops.flatMap((op) => Object.values(op).filter((v) => typeof v === 'string'))
const texts = (ops) => ops.filter((op) => op.type === 'text').map((op) => op.text)
const findRow = (ops, left) => ops.find((op) => op.type === 'row' && op.left === left)

function assertCleanOps(ops) {
  assert.ok(Array.isArray(ops) && ops.length > 0, 'ops is a non-empty array')
  for (const op of ops) {
    assert.ok(['text', 'row', 'rule', 'space'].includes(op.type), `known op type: ${op.type}`)
    if (op.type === 'text') {
      assert.ok(op.text.length > 0, 'text ops are never empty')
      assert.ok(['left', 'center', 'right'].includes(op.align))
      assert.ok(['sm', 'md', 'lg'].includes(op.size))
      assert.equal(typeof op.bold, 'boolean')
    }
    if (op.type === 'row') {
      assert.ok(op.left || op.right, 'rows are never empty')
      assert.ok(['sm', 'md', 'lg'].includes(op.size))
    }
    if (op.type === 'rule') assert.ok(['dashed', 'solid'].includes(op.style))
    if (op.type === 'space') assert.ok(Number.isFinite(op.height) && op.height >= 0)
  }
  for (const value of strings(ops)) {
    assert.ok(!/undefined|null|\[object/.test(value), `no placeholder text in "${value}"`)
  }
  ops.forEach((op, i) => {
    if (i) assert.ok(!(op.type === 'rule' && ops[i - 1].type === 'rule'), `no two rules in a row (at ${i})`)
  })
}

/* ------------------------------------------------------------------ environment */

test('module imports in Node and reports no Bluetooth', () => {
  assert.equal(isBluetoothPrintSupported(), false)
  assert.deepEqual(PAPER, { '58': { dots: 384 }, '80': { dots: 576 } })
})

/* ------------------------------------------------------------------ toMonochrome */

function image(width, height, pixels) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255) // opaque white
  for (const [x, y, r, g, b, a = 255] of pixels) data.set([r, g, b, a], (y * width + x) * 4)
  return { width, height, data }
}

test('toMonochrome packs MSB first with padded rows', () => {
  const img = image(10, 2, [
    [0, 0, 0, 0, 0], [7, 0, 0, 0, 0], [8, 0, 0, 0, 0], [9, 0, 0, 0, 0],
    [9, 1, 0, 0, 0],
  ])
  const out = toMonochrome(img)
  assert.equal(out.width, 10)
  assert.equal(out.height, 2)
  assert.ok(out.bits instanceof Uint8Array)
  assert.equal(out.bits.length, 4) // 2 bytes per row
  assert.deepEqual([...out.bits], [0x81, 0xc0, 0x00, 0x40]) // padding bits (x = 10..15) stay 0
})

test('toMonochrome threshold, colour and transparency handling', () => {
  const img = image(8, 1, [
    [0, 0, 169, 169, 169], // just below threshold -> black
    [1, 0, 170, 170, 170], // at threshold -> white
    [2, 0, 0, 0, 0, 0], // fully transparent black -> white
    [3, 0, 0, 0, 0, 128], // half-transparent black over white = 127 -> black
    [4, 0, 0, 0, 0, 40], // faint black over white = 215 -> white
    [5, 0, 255, 0, 0], // red, luma 76 -> black
    [6, 0, 255, 255, 0], // yellow, luma 226 -> white
  ])
  assert.deepEqual([...toMonochrome(img).bits], [0b10010100])
  assert.deepEqual([...toMonochrome(img, { threshold: 100 }).bits], [0b00000100]) // only red (luma 76) stays black
  assert.deepEqual([...toMonochrome(image(16, 1, [[15, 0, 0, 0, 0]])).bits], [0x00, 0x01])
  assert.deepEqual([...toMonochrome(image(3, 2, [])).bits], [0, 0])
  assert.throws(() => toMonochrome({ width: 4, height: 4, data: new Uint8ClampedArray(8) }), TypeError)
})

/* ------------------------------------------------------------------ buildEscPosJob */

test('buildEscPosJob splits bands with exact GS v 0 headers', () => {
  const raster = { width: 12, height: 5, bits: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }
  const job = buildEscPosJob(raster, { bandHeight: 2 })
  assert.ok(job instanceof Uint8Array)
  assert.deepEqual([...job], [
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 1, 2, 3, 4,
    0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 5, 6, 7, 8,
    0x1d, 0x76, 0x30, 0x00, 2, 0, 1, 0, 9, 10,
    0x1b, 0x64, 3,
    0x1d, 0x56, 0x42, 0x00,
  ])
})

test('buildEscPosJob default bands of 255 rows on 58 mm paper', () => {
  const height = 600
  const job = buildEscPosJob({ width: 384, height, bits: new Uint8Array(48 * height) })
  assert.equal(job.length, 2 + 3 * 8 + 48 * height + 3 + 4)
  const headers = []
  for (let i = 0; i < job.length - 3; i += 1) {
    if (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30 && job[i + 3] === 0) headers.push([...job.subarray(i + 4, i + 8)])
  }
  assert.deepEqual(headers, [[48, 0, 255, 0], [48, 0, 255, 0], [48, 0, 90, 0]])
  assert.deepEqual([...job.subarray(-7)], [0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00])
})

test('buildEscPosJob encodes xH / yH and optional tail', () => {
  const wide = buildEscPosJob({ width: 3000, height: 300, bits: new Uint8Array(375 * 300) }, { bandHeight: 300, cut: false, feedLines: 0 })
  assert.deepEqual([...wide.subarray(0, 10)], [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 119, 1, 44, 1]) // 375 bytes, 300 rows
  assert.equal(wide.length, 2 + 8 + 375 * 300) // no feed, no cut
  const odd = buildEscPosJob({ width: 576, height: 1, bits: new Uint8Array(72) }, { feedLines: 5 })
  assert.deepEqual([...odd.subarray(2, 10)], [0x1d, 0x76, 0x30, 0x00, 72, 0, 1, 0])
  assert.deepEqual([...odd.subarray(-7, -4)], [0x1b, 0x64, 5])
  assert.deepEqual([...buildEscPosJob({ width: 384, height: 0, bits: new Uint8Array(0) })], [0x1b, 0x40, 0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00])
  assert.throws(() => buildEscPosJob({ width: 384, height: 10, bits: new Uint8Array(10) }), TypeError)
})

test('toMonochrome -> buildEscPosJob round trip keeps pixel data', () => {
  const img = image(384, 3, [[0, 0, 0, 0, 0], [383, 2, 0, 0, 0]])
  const job = buildEscPosJob(toMonochrome(img), { feedLines: 0, cut: false })
  const data = job.subarray(10)
  assert.equal(data.length, 48 * 3)
  assert.equal(data[0], 0x80)
  assert.equal(data[48 * 3 - 1], 0x01)
  assert.equal(data.reduce((sum, byte) => sum + byte, 0), 0x81)
})

/* ------------------------------------------------------------------ wrapText */

const mono = (text) => Array.from(text).length

test('wrapText wraps words, breaks long words and keeps line breaks', () => {
  assert.deepEqual(wrapText('the quick brown fox', 10, mono), ['the quick', 'brown fox'])
  assert.deepEqual(wrapText('abcdefghijklmnop', 5, mono), ['abcde', 'fghij', 'klmno', 'p'])
  assert.deepEqual(wrapText('Notes line one\n\nline  two', 40, mono), ['Notes line one', '', 'line two'])
  assert.deepEqual(wrapText('ab verylongword cd', 6, mono), ['ab', 'verylo', 'ngword', 'cd'])
})

test('wrapText never splits a Gujarati conjunct or vowel sign', () => {
  const word = 'ઘનશ્યામભાઈ'
  const pieces = wrapText(word, 3, mono)
  assert.equal(pieces.join(''), word)
  assert.deepEqual(pieces, ['ઘન', 'શ્યા', 'મભા', 'ઈ'])
  for (const piece of pieces) {
    assert.ok(!/^\p{M}/u.test(piece), `"${piece}" does not start with a combining mark`)
    assert.ok(!/્$/.test(piece), `"${piece}" does not end with a virama`)
  }
})

/* ------------------------------------------------------------------ layoutReceipt: bill */

test('layoutReceipt bill: header, party, items, totals', () => {
  const ops = layoutReceipt(bill)
  assertCleanOps(ops)
  assert.deepEqual(ops[0], { type: 'text', text: 'Shreeji Traders', align: 'center', size: 'lg', bold: true })
  const all = texts(ops)
  assert.ok(all.includes('Station Road, Rajkot'))
  assert.ok(all.includes('Phone: 98250 12345'))
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'TAX INVOICE' && op.bold && op.size === 'md' && op.align === 'center'))
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'PARTIALLY PAID' && op.invert === true))
  assert.equal(findRow(ops, 'Invoice No.').right, 'INV-0042')
  assert.equal(findRow(ops, 'Due Date').right, '30/09/2026')
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'Bill To: ઘનશ્યામભાઈ નાના' && op.bold))
  assert.ok(all.includes('Phone: 99090 11223'))

  // items
  assert.ok(ops.some((op) => op.type === 'text' && op.text === '1. Sugar' && op.bold))
  assert.deepEqual(findRow(ops, '2 Kg × 515.50'), { type: 'row', left: '2 Kg × 515.50', right: '974.30', bold: false, size: 'md' })
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'Disc 10%: 103.10 · Tax 5%: 46.40' && op.size === 'sm'))
  assert.ok(all.includes('2. ખાંડ Premium Basmati Rice Long Grain 25 Kg Bag'))
  assert.ok(all.includes('Code: RICE25'))
  assert.equal(findRow(ops, '1 Bag × 9,025.70').right, '9,025.70')
  assert.ok(!all.some((t) => t.includes('HSN')), 'HSN hidden when columns.hsn is false')

  // totals
  assert.equal(findRow(ops, 'Total Qty').right, '3')
  assert.equal(findRow(ops, 'Item Discount').right, '- ₹103.10')
  assert.deepEqual(findRow(ops, 'TOTAL'), { type: 'row', left: 'TOTAL', right: '₹10,000.00', bold: true, size: 'lg' })
  const totalIndex = ops.indexOf(findRow(ops, 'TOTAL'))
  assert.deepEqual(ops[totalIndex - 1], { type: 'rule', style: 'solid' })
  assert.deepEqual(ops[totalIndex + 1], { type: 'rule', style: 'solid' })
  assert.equal(findRow(ops, 'Received').right, '₹4,000.00')
  assert.equal(findRow(ops, 'Balance Due').bold, true)
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'Ten Thousand Rupees Only' && op.size === 'sm'))
  assert.ok(all.includes('Thank you!'))
})

test('layoutReceipt bill: empty optional fields are skipped', () => {
  const ops = layoutReceipt(bill)
  const joined = strings(ops).join('\n')
  for (const word of ['GSTIN', 'Notes', 'Terms', 'Bank Details', 'Payment History', 'Tax Summary', 'Authorised Signatory', '@']) {
    assert.ok(!joined.includes(word), `"${word}" should not be printed`)
  }
  const bare = layoutReceipt({ doc_type: 'sale', items: [], total: '₹50.00', business: {}, party: {} })
  assertCleanOps(bare)
  assert.equal(findRow(bare, 'Sale amount').right, '₹50.00')
  assert.ok(!findRow(bare, 'Total Qty'))
  for (const value of [null, undefined, 'x', 42, []]) assert.ok(Array.isArray(layoutReceipt(value)))
})

test('layoutReceipt bill: optional sections when present', () => {
  const ops = layoutReceipt({
    ...bill,
    business: { ...bill.business, gstin: '24ABCDE1234F1Z5', email: 'shop@example.com' },
    columns: { hsn: true, discount: true, tax: false },
    payments: [{ number: 'PAY-3', date: '16/09/2026', mode: 'Cash', amount: '₹4,000.00' }],
    tax_summary: [{ rate: '5%', taxable: '₹928.00', tax: '₹46.40' }],
    notes: 'Deliver after 5 pm\nCall before coming',
    terms: 'Goods once sold will not be taken back.',
    bank: { bank_name: 'HDFC Bank', account_name: '', account_number: '50100012345678', ifsc: 'HDFC0000123', branch: '', upi_id: 'shreeji@hdfcbank' },
    show_signature: true,
    footer_note: 'Thank you, visit again!',
  })
  assertCleanOps(ops)
  const all = texts(ops)
  assert.ok(all.includes('GSTIN: 24ABCDE1234F1Z5'))
  assert.ok(all.includes('shop@example.com'))
  assert.ok(all.includes('HSN: 1006'))
  assert.ok(all.includes('Disc 10%: 103.10'), 'tax extra hidden when columns.tax is false')
  assert.equal(findRow(ops, 'PAY-3 · 16/09/2026 · Cash').right, '₹4,000.00')
  assert.equal(findRow(ops, '5% on ₹928.00').right, '₹46.40')
  assert.ok(all.includes('Notes') && all.includes('Deliver after 5 pm\nCall before coming'))
  assert.ok(all.includes('Terms & Conditions'))
  assert.equal(findRow(ops, 'Account No.').right, '50100012345678')
  assert.equal(findRow(ops, 'UPI ID').right, 'shreeji@hdfcbank')
  assert.ok(!findRow(ops, 'Branch') && !findRow(ops, 'Account Name'))
  assert.ok(all.includes('For Shreeji Traders') && all.includes('Authorised Signatory'))
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'Thank you, visit again!' && op.align === 'center'))
  assert.ok(!all.includes('Thank you!'), 'no duplicate thank-you line when the footer already says it')
  const order = ['Payment History', 'Tax Summary', 'Notes', 'Bank Details'].map((t) => all.indexOf(t))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
})

/* ------------------------------------------------------------------ layoutReceipt: payment */

test('layoutReceipt payment receipt', () => {
  const ops = layoutReceipt(receipt)
  assertCleanOps(ops)
  const all = texts(ops)
  assert.equal(all[0], 'Shreeji Traders')
  assert.ok(all.includes('shop@example.com') && all.includes('GSTIN: 24ABCDE1234F1Z5'))
  assert.ok(ops.some((op) => op.type === 'text' && op.text === 'PAYMENT RECEIPT' && op.bold))
  assert.ok(!ops.some((op) => op.invert), 'receipts have no status pill')
  assert.equal(findRow(ops, 'Receipt No.').right, 'REC-7')
  assert.ok(all.includes('Received From: ઘનશ્યામભાઈ નાના'))
  assert.ok(all.includes('Bhaktinagar,\nRajkot'))
  assert.deepEqual(findRow(ops, 'Amount Received'), { type: 'row', left: 'Amount Received', right: '₹5,000.00', bold: true, size: 'lg' })
  assert.ok(all.includes('Five Thousand Rupees Only'))
  assert.equal(findRow(ops, 'INV-0042 (01/09/2026)').right, '₹4,000.00')
  assert.ok(all.includes('Bill total: ₹10,000.00'))
  assert.equal(findRow(ops, 'Advance / not linked to a bill').right, '₹1,000.00')
  assert.equal(findRow(ops, 'Current Balance').right, '₹6,000.00 (Receivable)')
  assert.ok(all.includes('Paid by son'))
  assert.ok(!findRow(ops, 'TOTAL') && !findRow(ops, 'Item'))

  const voucher = layoutReceipt({ ...receipt, doc_type: 'payment_out', allocations: [], unallocated_label: '', unallocated: '', notes: '' })
  assertCleanOps(voucher)
  assert.equal(findRow(voucher, 'Amount Paid').right, '₹5,000.00')
  assert.ok(!texts(voucher).includes('Payment applied to bills') && !findRow(voucher, 'Advance / not linked to a bill'))
})

/* ------------------------------------------------------------------ planReceipt */

const fakeMeasure = (text, font) => Array.from(text).length * font.px * (font.bold ? 0.6 : 0.55)

function assertPlanFits(plan) {
  assert.ok(plan.height > 0 && Number.isInteger(plan.height))
  const byLine = new Map()
  for (const c of plan.commands) {
    if (c.kind === 'rect') {
      assert.ok(c.x >= 0 && c.x + c.w <= plan.width && c.y >= 0 && c.y + c.h <= plan.height, 'rect inside canvas')
      continue
    }
    const w = fakeMeasure(c.text, c.font)
    assert.ok(c.x >= 0 && c.x + w <= plan.width - 3, `"${c.text}" fits across (x=${c.x}, w=${w})`)
    assert.ok(c.y > 0 && c.y < plan.height, `"${c.text}" baseline inside canvas`)
    if (!byLine.has(c.y)) byLine.set(c.y, [])
    byLine.get(c.y).push([c.x, c.x + w, c.text])
  }
  for (const spans of byLine.values()) {
    spans.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i += 1) assert.ok(spans[i - 1][1] <= spans[i][0], `"${spans[i - 1][2]}" overlaps "${spans[i][2]}"`)
  }
}

test('planReceipt fits content on 58 mm and scales x1.5 on 80 mm', () => {
  const ops = layoutReceipt(bill)
  const small = planReceipt(ops, { paper: '58', measure: fakeMeasure })
  const large = planReceipt(ops, { paper: '80', measure: fakeMeasure })
  assert.equal(small.width, 384)
  assert.equal(large.width, 576)
  assert.equal(large.scale, 1.5)
  assertPlanFits(small)
  assertPlanFits(large)
  assert.ok(Math.abs(large.height / small.height - 1.5) < 0.03, `height scales (${small.height} -> ${large.height})`)
  assert.equal(planReceipt(ops, { paper: 'thermal80', measure: fakeMeasure }).width, 576)
  assert.equal(planReceipt(ops, { paper: 58, measure: fakeMeasure }).width, 384)
  const name = '2. ખાંડ Premium Basmati Rice Long Grain 25 Kg Bag'
  assert.ok(!small.commands.some((c) => c.text === name), 'long item name wraps')
  assert.ok(small.commands.some((c) => c.kind === 'text' && name.startsWith(c.text)))
  assertPlanFits(planReceipt(layoutReceipt(receipt), { paper: '58', measure: fakeMeasure }))
  assert.throws(() => planReceipt(ops, {}), TypeError)
})

test('planReceipt positions: alignment, rows, rules, pill', () => {
  const measure = (text) => Array.from(text).length * 10
  const plan = planReceipt([
    { type: 'text', text: 'abc', align: 'center', size: 'md', bold: false },
    { type: 'row', left: 'Total', right: '₹99', size: 'md', bold: true },
    { type: 'rule', style: 'solid' },
    { type: 'rule', style: 'dashed' },
    { type: 'space', height: 10 },
    { type: 'text', text: 'PAID', align: 'center', size: 'sm', bold: true, invert: true },
    { type: 'row', left: 'Label that fits on its own line', right: 'right side value', size: 'md', bold: false },
    { type: 'row', left: 'This label is much too long to fit on one single line', right: '₹5', size: 'md', bold: false },
  ], { paper: '58', measure })
  const [title, left, right] = plan.commands
  assert.deepEqual([title.x, title.text], [6 + (372 - 30) / 2, 'abc'])
  assert.deepEqual([left.text, left.x, right.text, right.x], ['Total', 6, '₹99', 378 - 30])
  assert.equal(left.y, right.y)
  assert.ok(left.y > title.y)
  const solid = plan.commands.find((c) => c.kind === 'rect' && c.w === 372)
  assert.ok(solid && solid.h === 2)
  const dashes = plan.commands.filter((c) => c.kind === 'rect' && c.w <= 6)
  assert.ok(dashes.length >= 30 && dashes.every((d) => d.y === dashes[0].y))
  const pillIndex = plan.commands.findIndex((c) => c.kind === 'rect' && c.radius)
  const pill = plan.commands[pillIndex]
  const pillText = plan.commands[pillIndex + 1]
  assert.equal(pillText.text, 'PAID')
  assert.equal(pillText.color, 'white')
  assert.ok(pillText.x > pill.x && pillText.x + 40 < pill.x + pill.w && pillText.y > pill.y && pillText.y < pill.y + pill.h)
  const [label, value, ...longRow] = plan.commands.slice(pillIndex + 2)
  assert.deepEqual([label.text, label.x], ['Label that fits on its own line', 6])
  assert.deepEqual([value.text, value.x], ['right side value', 378 - 160]) // stacked under the label
  assert.ok(value.y > label.y)
  const pieces = longRow.filter((c) => c.x === 6)
  const amount = longRow.find((c) => c.text === '₹5')
  assert.ok(pieces.length >= 2, 'label wider than the paper wraps beside the value')
  assert.equal(amount.y, pieces[0].y)
  assert.ok(pieces.every((c) => c.x + measure(c.text) + 12 <= amount.x || c.y !== amount.y))
})

/* ------------------------------------------------------------------ summary */

console.log(`${passed}/${passed + failures.length} thermal print tests passed.`)
process.exit(failures.length ? 1 : 0)
