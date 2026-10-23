import { useMemo } from 'react'

import { FormSection } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import SettingsPage from '../SettingsLayout.jsx'
import { TagEditor, useSaveSettings, useSettingsForm } from '../settingsKit.jsx'

const MAX_UNIT_LENGTH = 20

export default function UnitsSettings() {
  const { settings } = useSession()
  const saveSettings = useSaveSettings()
  const source = useMemo(() => ({ units: settings?.units || [] }), [settings])
  const form = useSettingsForm({
    id: 'settings-units',
    source,
    validate: (values) => (values.units.length ? {} : { units: 'Keep at least one unit.' }),
    submit: (values) => saveSettings({ units: values.units }),
  })
  const { values, errors, setField } = form

  return (
    <SettingsPage id="units" form={form}>
      <form {...form.formProps}>
        <FormSection
          title={`Units (${values.units.length})`}
          description="Choose from these when you add an item. Items that already use a unit keep it, even if you remove it here."
        >
          <TagEditor
            label="Units"
            items={values.units}
            onChange={(units) => setField('units', units)}
            prepare={(text) => text.toUpperCase().slice(0, MAX_UNIT_LENGTH)}
            normalize={(text) => text.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, MAX_UNIT_LENGTH)}
            validate={(unit, units) => (units.includes(unit) ? `${unit} is already in the list.` : '')}
            minItems={1}
            minItemsMessage="Keep at least one unit"
            maxLength={MAX_UNIT_LENGTH}
            placeholder="Add a unit, e.g. BUNDLE"
            addLabel="Add unit"
            error={errors.units}
          />
        </FormSection>
      </form>
    </SettingsPage>
  )
}
