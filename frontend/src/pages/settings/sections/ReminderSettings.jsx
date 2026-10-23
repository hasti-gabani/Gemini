import { RotateCcw } from 'lucide-react'
import { useMemo, useRef } from 'react'

import { Field, FormSection, TextArea } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { addDays, formatDate, formatDateMedium, todayISO } from '../../../lib/dates.js'
import { formatMoney } from '../../../lib/money.js'
import SettingsPage from '../SettingsLayout.jsx'
import { IntegerInput, useSaveSettings, useSettingsForm } from '../settingsKit.jsx'

// Same as the server default (accounts/models.py DEFAULT_REMINDER_TEMPLATE).
const DEFAULT_TEMPLATE = 'નમસ્તે {name},\n'
  + 'આપની ₹{amount} ની ચુકવણી બાકી છે. કૃપા કરી {due_date} સુધીમાં ચુકવણી કરશો.\n\n'
  + 'Dear {name}, a payment of ₹{amount} is pending with us. Kindly pay by {due_date}.\n\n'
  + '– {business} {phone}'

const PLACEHOLDERS = [
  { token: '{name}', label: 'Party name' },
  { token: '{amount}', label: 'Amount' },
  { token: '{due_date}', label: 'Due date' },
  { token: '{business}', label: 'Business name' },
  { token: '{phone}', label: 'Business mobile' },
]

function renderTemplate(template, values) {
  return (template || '').replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match)).trim()
}

export default function ReminderSettings() {
  const { settings, business } = useSession()
  const saveSettings = useSaveSettings()
  const textarea = useRef(null)
  const selection = useRef(null)

  const source = useMemo(() => ({
    reminder_template: settings?.reminder_template ?? '',
    reminder_lead_days: String(settings?.reminder_lead_days ?? 3),
  }), [settings])

  const form = useSettingsForm({
    id: 'settings-reminders',
    source,
    submit: (values) => saveSettings({
      reminder_template: values.reminder_template,
      reminder_lead_days: Number(values.reminder_lead_days) || 0,
    }),
  })
  const { values, errors, setField } = form
  const leadDays = Number(values.reminder_lead_days) || 0

  const rememberSelection = (event) => {
    selection.current = { start: event.target.selectionStart, end: event.target.selectionEnd }
  }

  const insert = (token) => {
    const text = values.reminder_template
    const { start, end } = selection.current ?? { start: text.length, end: text.length }
    const next = text.slice(0, start) + token + text.slice(end)
    const caret = start + token.length
    setField('reminder_template', next)
    selection.current = { start: caret, end: caret }
    requestAnimationFrame(() => {
      const element = textarea.current
      if (!element) return
      element.focus({ preventScroll: true })
      element.setSelectionRange(caret, caret)
    })
  }

  const preview = renderTemplate(values.reminder_template, {
    name: 'Ramesh Patel',
    amount: formatMoney('12500', { symbol: '' }),
    due_date: formatDate(addDays(todayISO(), 7)),
    business: business?.name || 'Your business',
    phone: business?.phone || '',
  })

  return (
    <SettingsPage id="reminders" form={form}>
      <form {...form.formProps} className="space-y-4">
        <FormSection title="Reminder message" description="Sent on WhatsApp or SMS when you remind a party about a pending payment.">
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-sm font-medium text-ink-2" id="reminder-insert-label">Insert details</p>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="reminder-insert-label">
                {PLACEHOLDERS.map((placeholder) => (
                  <button
                    key={placeholder.token}
                    type="button"
                    onClick={() => insert(placeholder.token)}
                    aria-label={`Insert ${placeholder.label} (${placeholder.token})`}
                    className="flex h-11 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-sm font-medium text-ink-2 transition hover:border-brand hover:text-brand-ink lg:h-9"
                  >
                    <span className="text-brand-ink" aria-hidden>+</span>
                    {placeholder.label}
                  </button>
                ))}
              </div>
            </div>
            <Field
              label="Message"
              htmlFor="reminder-template"
              error={errors.reminder_template}
              hint="Words in {curly brackets} are replaced with the real party name, amount and due date when you send a reminder."
              labelRight={values.reminder_template !== DEFAULT_TEMPLATE && (
                <button
                  type="button"
                  onClick={() => {
                    setField('reminder_template', DEFAULT_TEMPLATE)
                    selection.current = null
                  }}
                  className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-ink hover:underline"
                >
                  <RotateCcw className="size-3.5" aria-hidden /> Use default message
                </button>
              )}
            >
              <TextArea
                ref={textarea}
                id="reminder-template"
                rows={8}
                value={values.reminder_template}
                error={errors.reminder_template}
                onChange={(event) => {
                  setField('reminder_template', event.target.value)
                  rememberSelection(event)
                }}
                onSelect={rememberSelection}
                onBlur={rememberSelection}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Preview" description="With a sample party and amount.">
          <div className="rounded-2xl bg-subtle p-3 sm:p-4">
            {preview ? (
              <div className="max-w-md whitespace-pre-wrap wrap-break-word rounded-2xl rounded-tl-md bg-pos-soft px-4 py-3 text-[15px] leading-relaxed text-ink shadow-sm">
                {preview}
              </div>
            ) : (
              <p className="px-1 py-2 text-sm text-ink-3">The message is empty.</p>
            )}
          </div>
        </FormSection>

        <FormSection title="Dashboard reminders">
          <Field
            label="Show reminders before the due date"
            htmlFor="reminder-lead-days"
            error={errors.reminder_lead_days}
            hint={leadDays > 0
              ? `A payment due on ${formatDateMedium(addDays(todayISO(), leadDays))} shows on the dashboard and in the bell from today.`
              : '0 = reminders show only on or after the due date.'}
          >
            <IntegerInput
              id="reminder-lead-days"
              suffix="days"
              maxLength={3}
              className="sm:max-w-56"
              value={values.reminder_lead_days}
              error={errors.reminder_lead_days}
              onChange={(value) => setField('reminder_lead_days', value)}
              onBlur={() => !values.reminder_lead_days && setField('reminder_lead_days', '0')}
            />
          </Field>
        </FormSection>
      </form>
    </SettingsPage>
  )
}
