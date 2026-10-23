import { todayISO } from '../../lib/dates.js'
import Button from './Button.jsx'
import { DateInput } from './form.jsx'

/**
 * From – To dates for Sales, Purchase, party statements and bank statements (both today by default).
 * `from` / `to` are ISO dates, or '' for today; `onChange({ from, to })` also gets '' for today so
 * URLs stay clean. Moving From past To (or To before From) moves the other date along, so the range
 * is never back to front.
 */
export default function DateRangePicker({ from, to, onChange, className = '' }) {
  const today = todayISO()
  const start = from || today
  const end = to || today
  const emit = (nextFrom, nextTo) => onChange({ from: nextFrom === today ? '' : nextFrom, to: nextTo === today ? '' : nextTo })
  const setFrom = (value) => {
    const next = value || today
    emit(next, next > end ? next : end)
  }
  const setTo = (value) => {
    const next = value || today
    emit(next < start ? next : start, next)
  }
  // Two date boxes share one row even at 320px; "Today" wraps below them when there is no room.
  // Slightly smaller text and padding than other fields so the whole year fits next to the
  // calendar icon in a 132px box.
  const box = 'min-w-0 flex-1 basis-[7.5rem] sm:flex-none sm:basis-auto'
  const input = 'h-10 w-full px-2.5 text-sm sm:w-40'
  return (
    <div className={`flex w-full flex-wrap items-end gap-2 sm:w-auto ${className}`}>
      <label className={box}>
        <span className="mb-1 block text-xs font-medium text-ink-3">From</span>
        <DateInput value={start} max={end} onChange={(event) => setFrom(event.target.value)} className={input} />
      </label>
      <span className="pb-2.5 text-ink-3" aria-hidden>–</span>
      <label className={box}>
        <span className="mb-1 block text-xs font-medium text-ink-3">To</span>
        <DateInput value={end} min={start} onChange={(event) => setTo(event.target.value)} className={input} />
      </label>
      {(start !== today || end !== today) && (
        <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => emit(today, today)}>Today</Button>
      )}
    </div>
  )
}
