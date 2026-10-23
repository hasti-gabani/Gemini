import { Landmark, Wallet } from 'lucide-react'
import { useMemo } from 'react'

import { FormSection } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import SettingsPage from '../SettingsLayout.jsx'
import { ChoiceGroup, useSaveSettings, useSettingsForm } from '../settingsKit.jsx'

// Payments bigger than the pending balance are always saved (the extra stays as an advance),
// and bills have no due date, so the only payment setting left is the default mode.
export default function PaymentSettings() {
  const { settings, t } = useSession()
  const saveSettings = useSaveSettings()
  const source = useMemo(() => ({
    default_payment_mode: settings?.default_payment_mode || 'cash',
  }), [settings])

  const form = useSettingsForm({
    id: 'settings-payment',
    source,
    submit: (values) => saveSettings({ default_payment_mode: values.default_payment_mode }),
  })
  const { values, errors, setField } = form

  return (
    <SettingsPage id="payment" form={form}>
      <form {...form.formProps} className="space-y-4">
        <FormSection title="Default payment mode" description="Selected automatically when you record a payment or a paid bill. You can change it each time.">
          <ChoiceGroup
            label="Default payment mode"
            value={values.default_payment_mode}
            onChange={(mode) => setField('default_payment_mode', mode)}
            options={[
              { value: 'cash', label: t('cash'), icon: Wallet },
              { value: 'bank', label: t('bank'), icon: Landmark },
            ]}
          />
          <p className="mt-2 text-sm text-ink-3">
            {values.default_payment_mode === 'bank'
              ? 'Payments go to your default bank account (or cash if you have no bank account yet).'
              : 'Payments go to Cash in Hand.'}
          </p>
          {errors.default_payment_mode && <p className="mt-1 text-sm text-neg" role="alert">{errors.default_payment_mode}</p>}
        </FormSection>
      </form>
    </SettingsPage>
  )
}
