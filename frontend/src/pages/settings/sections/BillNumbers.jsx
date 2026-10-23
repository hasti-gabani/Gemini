import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, ReceiptText, ShoppingCart } from 'lucide-react'
import { useMemo } from 'react'

import { Field, FormSection, TextInput } from '../../../components/ui/form.jsx'
import { Skeleton } from '../../../components/ui/misc.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { api } from '../../../lib/api.js'
import SettingsPage from '../SettingsLayout.jsx'
import { Callout, IntegerInput, useSaveSettings, useSettingsForm } from '../settingsKit.jsx'

const DOCUMENTS = [
  { type: 'sale', title: 'Sale bills', icon: ReceiptText, placeholder: 'Bil.' },
  { type: 'purchase', title: 'Purchase bills', icon: ShoppingCart, placeholder: 'PUR-' },
  { type: 'payment_in', title: 'Payment In receipts', icon: ArrowDownLeft, placeholder: 'Receipt ' },
  { type: 'payment_out', title: 'Payment Out vouchers', icon: ArrowUpRight, placeholder: 'Voucher ' },
]

const PREFIX_DIGIT_ERROR = 'Prefix should not end with a digit (e.g. use "Bil." or "INV-").'

function prefixProblem(prefix) {
  if (prefix.length > 20) return 'Prefix can be at most 20 characters.'
  if (/\d$/.test(prefix)) return PREFIX_DIGIT_ERROR
  return ''
}

function validate(values) {
  const found = {}
  for (const { type } of DOCUMENTS) {
    const problem = prefixProblem(values[`${type}_prefix`])
    if (problem) found[`${type}_prefix`] = problem
    if (!(Number(values[`${type}_start_number`]) >= 1)) found[`${type}_start_number`] = 'Starting number must be at least 1.'
  }
  return found
}

function NextNumber({ type, pending }) {
  const query = useQuery({
    queryKey: ['next-number', type],
    queryFn: ({ signal }) => api.get('/next-number/', { type }, { signal }),
  })
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ink-2" aria-live="polite">
      <span>Next number:</span>
      {query.isPending ? (
        <Skeleton className="h-4 w-16" />
      ) : query.isError ? (
        <span className="text-ink-3">not available</span>
      ) : (
        <strong className="num min-w-0 wrap-break-word font-semibold text-ink">{query.data.number}</strong>
      )}
      {pending && <span className="text-xs text-ink-3">(updates after you save)</span>}
    </div>
  )
}

export default function BillNumbers() {
  const { settings } = useSession()
  const saveSettings = useSaveSettings()
  const source = useMemo(() => Object.fromEntries(DOCUMENTS.flatMap(({ type }) => [
    [`${type}_prefix`, settings?.[`${type}_prefix`] ?? ''],
    [`${type}_start_number`, String(settings?.[`${type}_start_number`] ?? 1)],
  ])), [settings])

  const form = useSettingsForm({
    id: 'settings-numbering',
    source,
    validate,
    submit: (values) => saveSettings(Object.fromEntries(DOCUMENTS.flatMap(({ type }) => [
      [`${type}_prefix`, values[`${type}_prefix`]],
      [`${type}_start_number`, Number(values[`${type}_start_number`])],
    ]))),
  })
  const { values, errors, setField } = form

  return (
    <SettingsPage id="numbering" form={form}>
      <Callout title="Numbers are automatic and unique">
        <p>
          Every new bill gets the next number by itself, and two bills can never have the same number. You can still
          type a number on a bill — the series continues from it (after Bil.50 comes Bil.51). The starting number is used
          when it is higher than the last number already used with that prefix.
        </p>
      </Callout>

      <form {...form.formProps} className="space-y-4">
        {DOCUMENTS.map(({ type, title, icon: Icon, placeholder }) => {
          const prefixKey = `${type}_prefix`
          const startKey = `${type}_start_number`
          const prefix = values[prefixKey]
          const start = Number(values[startKey]) || 1
          const pending = prefix !== source[prefixKey] || values[startKey] !== source[startKey]
          const prefixError = errors[prefixKey] || prefixProblem(prefix)
          return (
            <FormSection
              key={type}
              title={(
                <span className="flex items-center gap-2">
                  <Icon className="size-[18px] text-ink-3" aria-hidden />
                  {title}
                </span>
              )}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Prefix" htmlFor={`prefix-${type}`} error={prefixError} hint="Letters or symbols before the number (optional)">
                  <TextInput
                    id={`prefix-${type}`}
                    maxLength={20}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={prefix}
                    error={prefixError}
                    placeholder={placeholder.trim()}
                    onChange={(event) => setField(prefixKey, event.target.value)}
                  />
                </Field>
                <Field label="Starting number" htmlFor={`start-${type}`} error={errors[startKey]}>
                  <IntegerInput
                    id={`start-${type}`}
                    maxLength={9}
                    value={values[startKey]}
                    error={errors[startKey]}
                    onChange={(value) => setField(startKey, value)}
                  />
                </Field>
              </div>
              <div className="mt-4 space-y-1 rounded-xl bg-muted px-3.5 py-2.5 text-sm">
                <p className="wrap-break-word text-ink-2">
                  Example:{' '}
                  <span className="num whitespace-pre-wrap font-medium text-ink">
                    {[0, 1, 2].map((step) => `${prefix}${start + step}`).join(', ')}
                  </span>
                </p>
                <NextNumber type={type} pending={pending} />
              </div>
            </FormSection>
          )
        })}
      </form>
    </SettingsPage>
  )
}
