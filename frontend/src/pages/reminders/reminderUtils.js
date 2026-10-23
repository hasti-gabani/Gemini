import { daysBetween, formatDateMedium, formatDateTime, todayISO } from '../../lib/dates.js'

export const DUE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming' },
]

/** "Overdue by 3 days" (red) / "Due today" / "Due in 2 days". */
export function dueInfo(dueDate, done = false) {
  if (done) return { label: `Was due ${formatDateMedium(dueDate)}`, tone: 'text-ink-3', overdue: false }
  const days = daysBetween(todayISO(), dueDate)
  if (days < 0) return { label: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, tone: 'text-neg', overdue: true }
  if (days === 0) return { label: 'Due today', tone: 'text-warn', overdue: false }
  if (days === 1) return { label: 'Due tomorrow', tone: 'text-ink-2', overdue: false }
  return { label: `Due in ${days} days`, tone: 'text-ink-2', overdue: false }
}

/** "16 Sep, 5:42 PM" (year only when it is not the current year). */
export function shortDateTime(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const text = formatDateTime(value)
  return date.getFullYear() === new Date().getFullYear() ? text.replace(` ${date.getFullYear()},`, ',') : text
}

/** "Sent 2× · last 16 Sep, 5:42 PM" */
export function sentText(reminder) {
  if (!reminder.sent_count) return 'Not sent yet'
  const when = shortDateTime(reminder.last_sent_at)
  return `Sent ${reminder.sent_count}×${when ? ` · last ${when}` : ''}`
}
