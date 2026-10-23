import { Monitor, Moon, Sun } from 'lucide-react'
import { useRef } from 'react'

import { FormSection } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { useUI } from '../../../context/UIContext.jsx'
import { api } from '../../../lib/api.js'
import { useInvalidateAll } from '../../../lib/hooks.js'
import { LANGUAGES, translate } from '../../../lib/i18n.js'
import SettingsPage from '../SettingsLayout.jsx'
import { ChoiceGroup } from '../settingsKit.jsx'

const THEMES = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const THEME_HINTS = {
  system: 'Follows the light or dark setting of your phone or computer.',
  light: 'Always light.',
  dark: 'Always dark — easier on the eyes at night.',
}

const SAMPLE_KEYS = ['dashboard', 'parties', 'receivable', 'new_sale']

export default function Appearance() {
  const { theme, language, patchSession } = useSession()
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  // Only the latest change of each setting may update or roll back the session (fast repeated taps).
  const latest = useRef({ theme: 0, language: 0 })

  const apply = async (key, value, previous) => {
    if (value === previous) return
    latest.current[key] += 1
    const ticket = latest.current[key]
    patchSession({ settings: { [key]: value } })
    try {
      const saved = await api.patch('/settings/', { [key]: value })
      if (ticket !== latest.current[key]) return
      // The other appearance setting may be mid-change; it is updated by its own request.
      const { theme: savedTheme, language: savedLanguage, ...rest } = saved
      patchSession({ settings: { ...rest, [key]: key === 'theme' ? savedTheme : savedLanguage } })
      invalidate()
      toast.success('Settings saved')
    } catch (error) {
      if (ticket === latest.current[key]) patchSession({ settings: { [key]: previous } })
      toast.error(error)
    }
  }

  return (
    <SettingsPage id="appearance">
      <FormSection title="Theme" description="Changes apply immediately.">
        <ChoiceGroup label="Theme" value={theme} onChange={(value) => apply('theme', value, theme)} options={THEMES} />
        <p className="mt-2 text-sm text-ink-3">{THEME_HINTS[theme] || THEME_HINTS.system}</p>
      </FormSection>

      <FormSection title="Language" description="Changes apply immediately.">
        <ChoiceGroup
          label="Language"
          value={language}
          onChange={(value) => apply('language', value, language)}
          options={LANGUAGES}
        />
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          Menu names, dashboard figures and common buttons switch to the selected language across the app.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Sample labels">
          {SAMPLE_KEYS.map((key) => (
            <span key={key} className="rounded-full bg-subtle px-3 py-1 text-sm text-ink-2">{translate(language, key)}</span>
          ))}
        </div>
      </FormSection>
    </SettingsPage>
  )
}
