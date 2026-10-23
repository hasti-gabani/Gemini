import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Link2Off } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import Button from '../../../components/ui/Button.jsx'
import { Field, FormSection, Switch, TextInput } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { useUI } from '../../../context/UIContext.jsx'
import { api } from '../../../lib/api.js'
import SettingsPage from '../SettingsLayout.jsx'
import { pickValues, useSaveSettings, useSettingsForm } from '../settingsKit.jsx'

const DEFAULTS = {
  invoice_title: 'Invoice',
  print_format: 'a4',
  show_logo: true,
  show_gst: true,
  show_description: true,
  show_terms: true,
  show_bank_details: true,
  show_signature: true,
  show_amount_in_words: true,
  footer_note: '',
}

// Paper sizes are drawn roughly to scale: A4 and A5 are ~1:1.41, thermal rolls are 80 and 58 mm wide.
const PRINT_FORMATS = [
  { value: 'a4', label: 'A4', hint: 'Full page', paper: 'h-[52px] w-[37px] rounded-[3px]', lines: 5 },
  { value: 'a5', label: 'A5', hint: 'Half page', paper: 'h-[37px] w-[26px] rounded-[3px]', lines: 3 },
  { value: 'thermal80', label: 'Thermal 80 mm', hint: '3-inch receipt', paper: 'h-[52px] w-[22px] rounded-t-[3px] border-b-0', lines: 6 },
  { value: 'thermal58', label: 'Thermal 58 mm', hint: '2-inch receipt', paper: 'h-[52px] w-[16px] rounded-t-[3px] border-b-0', lines: 6 },
]

function PaperShape({ format, selected }) {
  return (
    <span className="flex h-14 items-end justify-center" aria-hidden>
      <span className={`flex flex-col gap-[3px] border bg-card px-[4px] pt-[5px] shadow-sm ${format.paper} ${selected ? 'border-brand' : 'border-line-strong'}`}>
        <span className={`h-[3px] w-3/5 shrink-0 rounded-full ${selected ? 'bg-brand' : 'bg-ink-3'}`} />
        {Array.from({ length: format.lines }).map((_, index) => (
          <span key={index} className={`h-[2px] shrink-0 rounded-full bg-line-strong ${index % 2 ? 'w-4/5' : 'w-full'}`} />
        ))}
      </span>
    </span>
  )
}

function ShareLinksCard() {
  const { confirm, toast } = useUI()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const reset = async () => {
    const ok = await confirm({
      title: 'Reset all shared bill links?',
      message: 'Bill and receipt links you have already sent (for example on WhatsApp) will stop opening. Sharing a bill again creates a new link.',
      confirmText: 'Reset links',
      cancelText: 'Cancel',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const result = await api.post('/business/reset-share-links/')
      queryClient.removeQueries({ queryKey: ['share'] })
      toast.success(result?.detail || 'All previously shared bill links have been disabled.')
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSection
      title="Shared links"
      description="Anyone who has a bill link you shared can open that bill. If a link reached the wrong person, reset all links."
    >
      <Button variant="danger-soft" icon={Link2Off} loading={busy} onClick={reset} className="w-full sm:w-auto">
        Reset share links
      </Button>
    </FormSection>
  )
}

export default function InvoicePrint() {
  const { settings, business } = useSession()
  const saveSettings = useSaveSettings()
  const source = useMemo(() => pickValues(settings, DEFAULTS), [settings])
  const form = useSettingsForm({
    id: 'settings-invoice',
    source,
    validate: (values) => (values.invoice_title.trim() ? {} : { invoice_title: 'Enter a bill title, for example Tax Invoice.' }),
    submit: (values) => saveSettings({
      ...values,
      invoice_title: values.invoice_title.trim(),
      footer_note: values.footer_note.trim(),
    }),
  })
  const { values, errors, setField } = form

  const showOptions = [
    {
      key: 'show_logo',
      label: 'Show logo',
      description: business?.logo_url
        ? 'Your business logo at the top of the bill.'
        : <>Your business logo at the top of the bill. <Link to="/settings/profile" className="font-medium text-brand-ink hover:underline">Upload a logo</Link></>,
    },
    { key: 'show_gst', label: 'Show GSTIN', description: 'Your GST number and the party’s GST number.' },
    { key: 'show_description', label: 'Show bill description / notes', description: 'The description or notes written on the bill.' },
    { key: 'show_terms', label: 'Show terms & conditions', description: <>The terms written on each bill. Set the default terms in <Link to="/settings/terms" className="font-medium text-brand-ink hover:underline">Terms &amp; Conditions</Link>.</> },
    {
      key: 'show_bank_details',
      label: 'Show bank details',
      description: <>Prints the bank account marked “Print on invoice” in <Link to="/bank" className="font-medium text-brand-ink hover:underline">Bank</Link> (account number, IFSC and UPI) so parties know where to pay.</>,
    },
    { key: 'show_signature', label: 'Show signature box', description: 'A space for your signature at the bottom of the bill.' },
    { key: 'show_amount_in_words', label: 'Show amount in words', description: 'For example “Twelve Thousand Five Hundred Rupees Only”.' },
  ]

  return (
    <SettingsPage id="invoice" form={form} after={<ShareLinksCard />}>
      <form {...form.formProps} className="space-y-4">
        <FormSection title="Bill title">
          <Field
            label="Invoice title"
            htmlFor="invoice-title"
            required
            error={errors.invoice_title}
            hint="Printed at the top of sale bills, e.g. Tax Invoice, Bill of Supply or Estimate."
          >
            <TextInput
              id="invoice-title"
              maxLength={40}
              value={values.invoice_title}
              error={errors.invoice_title}
              placeholder="Tax Invoice"
              onChange={(event) => setField('invoice_title', event.target.value)}
            />
          </Field>
        </FormSection>

        <FormSection
          title="Default print format"
          description="Used when you print or share a bill. You can still choose another size while printing."
        >
          <div role="radiogroup" aria-label="Default print format" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PRINT_FORMATS.map((format) => {
              const selected = values.print_format === format.value
              return (
                <button
                  key={format.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setField('print_format', format.value)}
                  className={`relative flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 pb-3 pt-2 text-center transition ${selected ? 'border-brand bg-brand-soft' : 'border-line bg-card hover:border-line-strong'}`}
                >
                  {selected && <CircleCheck className="absolute right-2 top-2 size-[18px] text-brand-ink" aria-hidden />}
                  <PaperShape format={format} selected={selected} />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${selected ? 'text-brand-ink' : 'text-ink'}`}>{format.label}</span>
                    <span className="block text-xs text-ink-3">{format.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {errors.print_format && <p className="mt-2 text-sm text-neg" role="alert">{errors.print_format}</p>}
        </FormSection>

        <FormSection title="Show on bills" description="Choose what is printed on sale bills and shared PDFs.">
          <div className="divide-y divide-line">
            {showOptions.map((option) => (
              <Switch
                key={option.key}
                className="py-3 first:pt-0 last:pb-0"
                checked={values[option.key]}
                onChange={(checked) => setField(option.key, checked)}
                label={option.label}
                description={option.description}
              />
            ))}
          </div>
        </FormSection>

        <FormSection title="Footer note">
          <Field
            label="Footer note"
            htmlFor="invoice-footer"
            error={errors.footer_note}
            hint="Printed at the bottom of every bill."
            labelRight={<span className="num text-xs text-ink-3">{values.footer_note.length}/200</span>}
          >
            <TextInput
              id="invoice-footer"
              maxLength={200}
              value={values.footer_note}
              error={errors.footer_note}
              placeholder="Thank you for your business!"
              onChange={(event) => setField('footer_note', event.target.value)}
            />
          </Field>
        </FormSection>
      </form>
    </SettingsPage>
  )
}
