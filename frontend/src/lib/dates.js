const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayISO() {
  return toISODate(new Date())
}

export function parseISO(iso) {
  if (!iso) return null
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** 16/09/2026 */
export function formatDate(iso) {
  const date = parseISO(iso)
  return date ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : ''
}

/** 16 Sep 2026 */
export function formatDateMedium(iso) {
  const date = parseISO(iso)
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : ''
}

/** 16 Sep */
export function formatDateShort(iso) {
  const date = parseISO(iso)
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()]}` : ''
}

export function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  let hours = date.getHours()
  const suffix = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${pad(date.getMinutes())} ${suffix}`
}

export function addDays(iso, days) {
  const date = parseISO(iso) || new Date()
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

export function daysBetween(fromIso, toIso) {
  const a = parseISO(fromIso)
  const b = parseISO(toIso)
  if (!a || !b) return 0
  return Math.round((b - a) / 86400000)
}

/** This month, as 'YYYY-MM'. */
export function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** The month 'YYYY-MM' as { from, to }: its first and last day. */
export function monthRange(month) {
  const [y, m] = String(month).split('-').map(Number)
  if (!y || !m) return monthRange(currentMonth())
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` }
}

/** The month `count` months before (negative) or after 'YYYY-MM'. */
export function shiftMonth(month, count) {
  const [y, m] = String(month).split('-').map(Number)
  if (!y || !m) return currentMonth()
  const date = new Date(y, m - 1 + count, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function relativeDay(iso) {
  const diff = daysBetween(iso, todayISO())
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff === -1) return 'Tomorrow'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  if (diff < -1 && diff > -7) return `In ${-diff} days`
  return formatDateMedium(iso)
}

/** "on 18 Sep 2026" or "from 1 Sep 2026 to 18 Sep 2026", for messages about a date range. */
export function rangeText(from, to) {
  return from === to ? `on ${formatDateMedium(from)}` : `from ${formatDateMedium(from)} to ${formatDateMedium(to)}`
}

export function longToday() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
