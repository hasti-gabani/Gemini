/**
 * Bill arithmetic — an exact mirror of backend/transactions/calc.py.
 * Uses BigInt fixed point so the live total on screen is always what the
 * server stores. Verified against Python by scripts/billCalc.test.mjs.
 */
import { divRound, fromScaled, toScaled } from './money.js'

const ZERO = 0n
const MAX_ROUND_OFF = 99n // paise

const minBig = (a, b) => (a < b ? a : b)
const maxBig = (a, b) => (a > b ? a : b)

/** All inputs are strings/numbers; results are BigInt (paise, milli, basis points). */
export function calcLineRaw({ quantity, rate, discount_percent = 0, discount_amount = 0, tax_rate = 0, tax_inclusive = false }) {
  const qty = toScaled(quantity, 3) // milli
  const ratePaise = toScaled(rate, 2)
  const discBp = toScaled(discount_percent, 2)
  const taxBp = toScaled(tax_rate, 2)

  const gross = divRound(qty * ratePaise, 1000n)
  let discount = discBp > ZERO ? divRound(gross * discBp, 10000n) : toScaled(discount_amount, 2)
  discount = gross >= ZERO ? minBig(maxBig(discount, ZERO), gross) : ZERO
  const net = gross - discount

  let taxable
  let tax
  let amount
  if (taxBp > ZERO && tax_inclusive) {
    taxable = divRound(net * 10000n, 10000n + taxBp)
    tax = net - taxable
    amount = net
  } else if (taxBp > ZERO) {
    taxable = net
    tax = divRound(net * taxBp, 10000n)
    amount = net + tax
  } else {
    taxable = net
    tax = ZERO
    amount = net
  }
  return {
    quantity: qty,
    rate: ratePaise,
    discount_percent: discBp > ZERO ? discBp : ZERO,
    discount_amount: discount,
    tax_rate: taxBp,
    tax_inclusive: Boolean(tax_inclusive) && taxBp > ZERO,
    gross,
    taxable_amount: taxable,
    tax_amount: tax,
    amount,
  }
}

export function calcBillRaw(lines, { discount_percent = 0, discount_amount = 0, charges_amount = 0, auto_round_off = true, round_off = 0, manual_total = null } = {}) {
  if (!lines.length) {
    return {
      subtotal: ZERO, item_discount: ZERO, tax_total: ZERO, items_total: ZERO, discount_percent: ZERO,
      discount_amount: ZERO, charges_amount: ZERO, round_off: ZERO, total: toScaled(manual_total || 0, 2),
      manual_total: true,
    }
  }
  const sum = (key) => lines.reduce((acc, line) => acc + line[key], ZERO)
  const subtotal = sum('gross')
  const itemDiscount = sum('discount_amount')
  const taxTotal = sum('tax_amount')
  const itemsTotal = sum('amount')

  const discBp = toScaled(discount_percent, 2)
  let discount = discBp > ZERO ? divRound(itemsTotal * discBp, 10000n) : toScaled(discount_amount, 2)
  discount = minBig(maxBig(discount, ZERO), maxBig(itemsTotal, ZERO))
  const charges = maxBig(toScaled(charges_amount, 2), ZERO)
  const preRound = itemsTotal - discount + charges
  let rounding
  if (auto_round_off) {
    rounding = divRound(preRound, 100n) * 100n - preRound
  } else {
    rounding = toScaled(round_off, 2)
    if (rounding > MAX_ROUND_OFF) rounding = MAX_ROUND_OFF
    if (rounding < -MAX_ROUND_OFF) rounding = -MAX_ROUND_OFF
  }
  return {
    subtotal,
    item_discount: itemDiscount,
    tax_total: taxTotal,
    items_total: itemsTotal,
    discount_percent: discBp > ZERO ? discBp : ZERO,
    discount_amount: discount,
    charges_amount: charges,
    round_off: rounding,
    total: preRound + rounding,
    manual_total: false,
  }
}

const money = (v) => fromScaled(v, 2)

/** String-valued helpers for the UI. */
export function calcLine(line) {
  const raw = calcLineRaw(line)
  return {
    quantity: fromScaled(raw.quantity, 3),
    rate: money(raw.rate),
    discount_percent: money(raw.discount_percent),
    discount_amount: money(raw.discount_amount),
    tax_rate: money(raw.tax_rate),
    tax_inclusive: raw.tax_inclusive,
    gross: money(raw.gross),
    taxable_amount: money(raw.taxable_amount),
    tax_amount: money(raw.tax_amount),
    amount: money(raw.amount),
  }
}

export function calcBill(lines, options = {}) {
  const rawLines = lines.map((line) => calcLineRaw(line))
  const raw = calcBillRaw(rawLines, options)
  return {
    lines: rawLines.map((l) => ({
      gross: money(l.gross), discount_amount: money(l.discount_amount), taxable_amount: money(l.taxable_amount),
      tax_amount: money(l.tax_amount), amount: money(l.amount),
    })),
    subtotal: money(raw.subtotal),
    item_discount: money(raw.item_discount),
    tax_total: money(raw.tax_total),
    items_total: money(raw.items_total),
    discount_percent: money(raw.discount_percent),
    discount_amount: money(raw.discount_amount),
    charges_amount: money(raw.charges_amount),
    round_off: money(raw.round_off),
    total: money(raw.total),
    manual_total: raw.manual_total,
  }
}
