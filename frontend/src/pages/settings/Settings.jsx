import { ChevronRight } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useIsDesktop } from '../../lib/hooks.js'
import { labelOf, SETTINGS_GROUPS } from './config.js'
import Appearance from './sections/Appearance.jsx'
import BillNumbers from './sections/BillNumbers.jsx'
import BusinessProfile from './sections/BusinessProfile.jsx'
import DataDelete from './sections/DataDelete.jsx'
import InvoicePrint from './sections/InvoicePrint.jsx'
import MyAccount from './sections/MyAccount.jsx'
import PaymentSettings from './sections/PaymentSettings.jsx'
import ReminderSettings from './sections/ReminderSettings.jsx'
import TermsSettings from './sections/TermsSettings.jsx'
import UnitsSettings from './sections/UnitsSettings.jsx'
import WhatsAppSettings from './sections/WhatsAppSettings.jsx'

const SECTION_COMPONENTS = {
  profile: BusinessProfile,
  invoice: InvoicePrint,
  numbering: BillNumbers,
  terms: TermsSettings,
  payment: PaymentSettings,
  units: UnitsSettings,
  reminders: ReminderSettings,
  appearance: Appearance,
  account: MyAccount,
  whatsapp: WhatsAppSettings,
  data: DataDelete,
}

const ICON_TONES = {
  brand: 'bg-brand-soft text-brand-ink',
  neg: 'bg-neg-soft text-neg',
}

/** Phones/tablets: grouped list of all settings sections. */
function SettingsHome() {
  const { t, user, business } = useSession()
  return (
    <Page title={t('settings')} maxWidth="max-w-3xl">
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`settings-group-${group.key}`}>
            <h2 id={`settings-group-${group.key}`} className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">
              {labelOf(group, t)}
            </h2>
            <ul className="card divide-y divide-line overflow-hidden">
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.to || `/settings/${item.id}`}
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition hover:bg-muted active:bg-subtle"
                  >
                    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${ICON_TONES[item.tone || 'brand']}`}>
                      <item.icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium leading-snug text-ink">{labelOf(item, t)}</span>
                      <span className="block text-sm text-ink-3">{item.description}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {user && (
          <p className="px-1 text-center text-xs leading-relaxed text-ink-3">
            Signed in as {user.name} ({user.role === 'owner' ? 'Owner' : 'Staff'}){business?.name ? ` · ${business.name}` : ''}
          </p>
        )}
      </div>
    </Page>
  )
}

export default function Settings() {
  const { section } = useParams()
  const isDesktop = useIsDesktop()

  if (section === 'bank') return <Navigate to="/bank" replace />
  const id = section || (isDesktop ? 'profile' : null)
  if (!id) return <SettingsHome />
  const Section = SECTION_COMPONENTS[id]
  if (!Section) return <Navigate to="/settings" replace />
  return <Section />
}
