/**
 * Exact decimal helpers using BigInt fixed-point integers.
 * Amounts are handled in paise (2 places), quantities in milli-units (3 places),
 * percentages in basis points (2 places). Rounding is HALF_UP (away from zero),
 * identical to Python's Decimal ROUND_HALF_UP used by the server.
 */

const TEN = 10n

export function pow10(places) {
  return TEN ** BigInt(places)
}

/** Rounded integer division, half away from zero. `d` must be positive. */
export function divRound(n, d) {
  const negative = n < 0n
  const a = negative ? -n : n
  const q = (a * 2n + d) / (2n * d)
  return negative ? -q : q
}

export function cleanNumber(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[,\s₹]/g, '').trim()
}

/** Parse a decimal string/number to a BigInt scaled by 10^places (HALF_UP). Invalid input -> 0n. */
export function toScaled(value, places = 2) {
  let text = cleanNumber(value)
  if (typeof value === 'number' && Number.isFinite(value)) text = value.toFixed(Math.min(places + 4, 12))
  if (!text || text === '-' || text === '.' || text === '-.') return 0n
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match) return 0n
  const [, sign, whole = '', frac = ''] = match
  const padded = (frac + '0'.repeat(places + 1)).slice(0, places + 1)
  let scaled = BigInt((whole || '0') + padded.slice(0, places))
  if (Number(padded[places]) >= 5) scaled += 1n
  return sign ? -scaled : scaled
}

export function isValidNumber(value) {
  const text = cleanNumber(value)
  return text !== '' && /^-?(\d+\.?\d*|\.\d+)$/.test(text)
}

/** BigInt scaled value -> plain decimal string ("1234.50"). */
export function fromScaled(scaled, places = 2) {
  const negative = scaled < 0n
  const abs = negative ? -scaled : scaled
  const base = pow10(places)
  const whole = abs / base
  const frac = (abs % base).toString().padStart(places, '0')
  return `${negative && abs !== 0n ? '-' : ''}${whole}${places ? `.${frac}` : ''}`
}

export const paise = (value) => toScaled(value, 2)
export const milli = (value) => toScaled(value, 3)
export const fromPaise = (value) => fromScaled(value, 2)

function groupIndian(digits) {
  if (digits.length <= 3) return digits
  const last3 = digits.slice(-3)
  let head = digits.slice(0, -3)
  const groups = []
  while (head.length > 2) {
    groups.unshift(head.slice(-2))
    head = head.slice(0, -2)
  }
  if (head) groups.unshift(head)
  return `${groups.join(',')},${last3}`
}

/** "₹12,34,567.50" (Indian grouping). `decimals: 'auto'` hides .00 */
export function formatMoney(value, { symbol = '₹', decimals = 2, signed = false, absolute = false } = {}) {
  let scaled = toScaled(value, 2)
  if (absolute && scaled < 0n) scaled = -scaled
  const negative = scaled < 0n
  const text = fromScaled(negative ? -scaled : scaled, 2)
  let [whole, frac] = text.split('.')
  whole = groupIndian(whole)
  const showFrac = decimals === 'auto' ? frac !== '00' : decimals > 0
  const sign = negative ? '-' : signed && scaled > 0n ? '+' : ''
  return `${sign}${symbol}${whole}${showFrac ? `.${frac}` : ''}`
}

/** Compact form for charts and small tiles: ₹950, ₹12.5K, ₹3.4L, ₹1.2Cr */
export function formatCompact(value, symbol = '₹') {
  const number = Number(cleanNumber(value)) || 0
  const abs = Math.abs(number)
  const sign = number < 0 ? '-' : ''
  const fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')
  if (abs >= 1e7) return `${sign}${symbol}${fmt(abs / 1e7)}Cr`
  if (abs >= 1e5) return `${sign}${symbol}${fmt(abs / 1e5)}L`
  if (abs >= 1e3) return `${sign}${symbol}${fmt(abs / 1e3)}K`
  return `${sign}${symbol}${Math.round(abs)}`
}

export function formatQty(value) {
  const text = fromScaled(toScaled(value, 3), 3)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

export function formatPercent(value) {
  const text = fromScaled(toScaled(value, 2), 2)
  return `${text.replace(/\.?0+$/, '')}%`
}

export function compareMoney(a, b) {
  const x = toScaled(a, 2)
  const y = toScaled(b, 2)
  return x === y ? 0 : x > y ? 1 : -1
}

export const isPositive = (value) => toScaled(value, 2) > 0n
export const isNegative = (value) => toScaled(value, 2) < 0n
export const isZeroMoney = (value) => toScaled(value, 2) === 0n

export function addMoney(...values) {
  return fromPaise(values.reduce((sum, v) => sum + toScaled(v, 2), 0n))
}

export function subMoney(a, b) {
  return fromPaise(toScaled(a, 2) - toScaled(b, 2))
}

export function absMoney(value) {
  const scaled = toScaled(value, 2)
  return fromPaise(scaled < 0n ? -scaled : scaled)
}

export function minMoney(a, b) {
  return compareMoney(a, b) <= 0 ? fromPaise(toScaled(a, 2)) : fromPaise(toScaled(b, 2))
}

/** Keep only characters valid while typing an amount/quantity. */
export function sanitizeNumberInput(text, { decimals = 2, allowNegative = false } = {}) {
  let value = String(text ?? '').replace(/[^\d.\-]/g, '')
  if (!allowNegative) value = value.replace(/-/g, '')
  else value = value.replace(/(?!^)-/g, '')
  const firstDot = value.indexOf('.')
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '')
    const [whole, frac] = value.split('.')
    value = `${whole}.${frac.slice(0, decimals)}`
  }
  return value
}

/** Amount in words, Indian system: "Ten Thousand Five Hundred Rupees Only" */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n) {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

function threeDigits(n) {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ')
}

export function amountInWords(value) {
  const scaled = toScaled(value, 2)
  const abs = scaled < 0n ? -scaled : scaled
  let rupees = Number(abs / 100n)
  const paiseValue = Number(abs % 100n)
  if (!rupees && !paiseValue) return 'Zero Rupees Only'
  const parts = []
  const crore = Math.floor(rupees / 1e7)
  rupees %= 1e7
  const lakh = Math.floor(rupees / 1e5)
  rupees %= 1e5
  const thousand = Math.floor(rupees / 1e3)
  rupees %= 1e3
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore).replace(' Rupees Only', '') : threeDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rupees) parts.push(threeDigits(rupees))
  let text = parts.length ? `${parts.join(' ')} Rupees` : ''
  if (paiseValue) text = text ? `${text} and ${twoDigits(paiseValue)} Paise` : `${twoDigits(paiseValue)} Paise`
  return `${text} Only`
}
