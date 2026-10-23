import { ChevronLeft, ChevronRight } from 'lucide-react'

import { currentMonth, shiftMonth } from '../../lib/dates.js'
import Button from './Button.jsx'
import { MonthInput } from './form.jsx'

/**
 * One whole month, for monthly statements: ‹ month ›, plus "This month" while another month is shown.
 * `value` is 'YYYY-MM' ('' means this month); `onChange` gets 'YYYY-MM'. Months after this one are
 * out of reach, as they have no transactions yet.
 */
export default function MonthPicker({ value, onChange, label = 'Month', className = '' }) {
  const thisMonth = currentMonth()
  const month = value || thisMonth
  return (
    <div className={`flex w-full flex-wrap items-center gap-2 sm:w-auto ${className}`}>
      <Button variant="secondary" size="icon" icon={ChevronLeft} aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))} />
      <MonthInput
        aria-label={label}
        value={month}
        max={thisMonth}
        onChange={(event) => onChange(event.target.value || thisMonth)}
        className="h-10 min-w-[9.5rem] flex-1 sm:w-44 sm:flex-none"
      />
      <Button
        variant="secondary"
        size="icon"
        icon={ChevronRight}
        aria-label="Next month"
        disabled={month >= thisMonth}
        onClick={() => onChange(shiftMonth(month, 1))}
      />
      {month !== thisMonth && <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>This month</Button>}
    </div>
  )
}
