import { useMemo } from 'react'
import { Link } from 'react-router'

import { Field, FormSection, TextArea } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import SettingsPage from '../SettingsLayout.jsx'
import { Callout, pickValues, useSaveSettings, useSettingsForm } from '../settingsKit.jsx'

const DEFAULTS = { default_terms: '', default_notes: '' }

export default function TermsSettings() {
  const { settings, t } = useSession()
  const saveSettings = useSaveSettings()
  const source = useMemo(() => pickValues(settings, DEFAULTS), [settings])
  const form = useSettingsForm({
    id: 'settings-terms',
    source,
    submit: (values) => saveSettings({
      default_terms: values.default_terms.trim(),
      default_notes: values.default_notes.trim(),
    }),
  })
  const { values, errors, setField } = form

  return (
    <SettingsPage id="terms" form={form}>
      <form {...form.formProps} className="space-y-4">
        <FormSection title={t('terms')} description="Filled in automatically on every new bill. You can still change them on each bill.">
          <Field label="Default terms & conditions" htmlFor="default-terms" error={errors.default_terms}>
            <TextArea
              id="default-terms"
              rows={6}
              value={values.default_terms}
              error={errors.default_terms}
              placeholder={'1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.'}
              onChange={(event) => setField('default_terms', event.target.value)}
            />
          </Field>
        </FormSection>

        <FormSection title="Default notes" description="Optional text for the description / notes box of new bills.">
          <Field label="Default notes" htmlFor="default-notes" error={errors.default_notes}>
            <TextArea
              id="default-notes"
              rows={3}
              value={values.default_notes}
              error={errors.default_notes}
              placeholder="e.g. Delivery within 3 days"
              onChange={(event) => setField('default_notes', event.target.value)}
            />
          </Field>
        </FormSection>
      </form>

      <Callout tone="neutral">
        <p>
          Terms and notes are printed only when “Show terms &amp; conditions” and “Show bill description / notes” are on
          in <Link to="/settings/invoice" className="font-medium text-brand-ink hover:underline">Invoice &amp; Print</Link>.
        </p>
      </Callout>
    </SettingsPage>
  )
}
