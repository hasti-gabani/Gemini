import { ArrowUpRight, Check } from 'lucide-react'
import { NavLink, useMatches } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useIsDesktop } from '../../lib/hooks.js'
import { labelOf, SETTINGS_GROUPS, SETTINGS_SECTIONS } from './config.js'

/** Left-hand section list on desktop. */
export function SettingsNav({ activeId }) {
  const { t } = useSession()
  return (
    <nav aria-label="Settings sections" className="card scroll-thin sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto p-2">
      {SETTINGS_GROUPS.map((group, index) => (
        <div key={group.key} className={index ? 'mt-2 border-t border-line pt-2' : ''}>
          <p className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{labelOf(group, t)}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.to || `/settings/${item.id}`}
                  className={({ isActive }) => {
                    const active = !item.to && (isActive || item.id === activeId)
                    return `group flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition ${active ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink'}`
                  }}
                >
                  <item.icon className="size-[18px] shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{labelOf(item, t)}</span>
                  {item.to && <ArrowUpRight className="size-4 shrink-0 text-ink-3" aria-label="Opens another page" />}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SaveButtons({ form, wide = false }) {
  const { t } = useSession()
  return (
    <>
      {form.dirty && (
        <Button variant={wide ? 'secondary' : 'ghost'} onClick={form.reset} disabled={form.saving}>Discard</Button>
      )}
      <Button
        type="submit"
        form={form.id}
        icon={Check}
        className={wide ? 'flex-1' : ''}
        disabled={!form.dirty}
        loading={form.saving}
      >
        {wide ? t('save') : 'Save changes'}
      </Button>
    </>
  )
}

/** Save row for desktop; sticks to the bottom of the window while a long form scrolls. */
export function DesktopSaveBar({ form, sticky = true, className = '' }) {
  return (
    <div className={`${sticky ? 'sticky bottom-0 z-20 -mx-3 bg-canvas/85 px-3 pb-5 pt-3 backdrop-blur-md' : ''} ${className}`}>
      <div className={`flex items-center gap-3 ${sticky ? 'card px-4 py-3' : ''}`}>
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink-3" aria-live="polite">
          {form.dirty && <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden />}
          <span className="truncate">{form.saving ? 'Saving…' : form.dirty ? 'You have unsaved changes' : 'No unsaved changes'}</span>
        </p>
        <SaveButtons form={form} />
      </div>
    </div>
  )
}

/**
 * Wrapper for one settings section.
 * - Desktop: page heading "Settings", section list on the left, the section on the right.
 * - Phones/tablets: only the section, with a back button to the list and a sticky Save bar.
 */
export default function SettingsPage({ id, form, desktopSaveBar = true, after, children }) {
  const { t } = useSession()
  const isDesktop = useIsDesktop()
  // The Save bar replaces the bottom navigation when the route hides it; otherwise it floats just above it.
  const navHidden = useMatches().some((match) => match.handle?.hideNav)
  const meta = SETTINGS_SECTIONS[id]
  const title = labelOf(meta, t)
  const phoneBar = form && !isDesktop

  return (
    <Page
      title={isDesktop ? t('settings') : title}
      back={isDesktop ? undefined : '/settings'}
      maxWidth={isDesktop ? 'max-w-6xl' : 'max-w-3xl'}
      footer={phoneBar && navHidden ? <SaveButtons form={form} wide /> : undefined}
      fab={phoneBar && !navHidden ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-card/95 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
            <SaveButtons form={form} wide />
          </div>
        </div>
      ) : undefined}
    >
      {isDesktop ? (
        <div className="grid grid-cols-[13.5rem_minmax(0,1fr)] items-start gap-6 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-8">
          <SettingsNav activeId={id} />
          <section className="min-w-0 max-w-3xl" aria-labelledby="settings-section-title">
            <header className="mb-4">
              <h2 id="settings-section-title" className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
              <p className="mt-0.5 text-sm text-ink-3">{meta.description}</p>
            </header>
            <div className="space-y-4">{children}</div>
            {form && desktopSaveBar && <DesktopSaveBar form={form} className="mt-4" />}
            {after && <div className="mt-4 space-y-4">{after}</div>}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          {children}
          {after}
        </div>
      )}
    </Page>
  )
}
