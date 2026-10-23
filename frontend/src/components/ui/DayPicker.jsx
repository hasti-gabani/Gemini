import { ChevronLeft, ChevronRight } from 'lucide-react'

import { addDays, todayISO } from '../../lib/dates.js'
import Button from './Button.jsx'
import { DateInput } from './form.jsx'

/**
 * The app's only date filter: lists, statements and reports show one day at a time.
 * `value` is an ISO date, or '' for today; `onChange` gets '' when the day is today
 * (so URLs stay clean) and an ISO date otherwise. Clearing the box also means today.
 */
export default function DayPicker({ value, onChange, label = 'Date', max, className = '' }) {
  const today = todayISO()
  const date = value || today
  const set = (next) => onChange(!next || next === today ? '' : next)
  return (
    <div className={`flex w-full flex-wrap items-center gap-2 sm:w-auto ${className}`}>
      <Button variant="secondary" size="icon" icon={ChevronLeft} aria-label="Previous day" onClick={() => set(addDays(date, -1))} />
      <DateInput
        aria-label={label}
        value={date}
        max={max}
        onChange={(event) => set(event.target.value)}
        className="h-10 min-w-[9.5rem] flex-1 sm:w-44 sm:flex-none"
      />
      <Button
        variant="secondary"
        size="icon"
        icon={ChevronRight}
        aria-label="Next day"
        disabled={Boolean(max) && date >= max}
        onClick={() => set(addDays(date, 1))}
      />
      {date !== today && <Button variant="ghost" size="sm" onClick={() => set(today)}>Today</Button>}
    </div>
  )
}
