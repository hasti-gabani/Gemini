import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'

import { useSession } from '../../context/SessionContext.jsx'
import { MobileRootActions } from './TopBarActions.jsx'

function BackButton({ to, className = '' }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => {
        if (typeof to === 'string') navigate(to)
        else if (window.history.state?.idx > 0) navigate(-1)
        else navigate('/')
      }}
      className={`grid size-10 shrink-0 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink ${className}`}
    >
      <ArrowLeft className="size-[22px]" />
    </button>
  )
}

/**
 * Screen wrapper.
 * - Phones/tablets: sticky app bar (back or business name, title, compact actions).
 * - Desktop: page heading with labelled actions.
 * `footer` renders a sticky action bar (Save & New | Save); `fab` a floating button on phones.
 */
export default function Page({
  title, subtitle, back, root = false, actions, mobileActions, headerExtra, children, footer, fab,
  maxWidth = 'max-w-7xl', className = '', desktopTitle = true, footerMobileOnly = false,
}) {
  const { business } = useSession()
  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur-md lg:hidden">
        <div className="flex min-h-14 items-center gap-1 px-2 py-1">
          {back ? <BackButton to={back} /> : null}
          <div className={`min-w-0 flex-1 ${back ? 'px-1' : 'px-2'}`}>
            {root ? (
              <p className="line-clamp-2 break-words text-xl font-bold leading-tight tracking-tight text-ink">{business?.name || title}</p>
            ) : (
              <>
                {/* Long names (e.g. an item or customer) wrap to a second line on small phones instead of being cut. */}
                <h1 className="line-clamp-2 break-words text-[17px] font-semibold leading-tight text-ink">{title}</h1>
                {subtitle && <p className="break-words text-xs text-ink-3">{subtitle}</p>}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {mobileActions !== undefined ? mobileActions : actions}
            {root && <MobileRootActions />}
          </div>
        </div>
        {headerExtra && <div className="px-4">{headerExtra}</div>}
      </header>

      <div className={`mx-auto w-full min-w-0 flex-1 px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6 ${footer ? (footerMobileOnly ? 'pb-28 lg:pb-10' : 'pb-28 lg:pb-6') : fab ? 'pb-40 lg:pb-10' : 'pb-24 lg:pb-10'} ${maxWidth} ${className}`}>
        {desktopTitle && (
          <div className="mb-5 hidden items-center gap-3 lg:flex">
            {back ? <BackButton to={back} className="-ml-2" /> : null}
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-2xl font-bold tracking-tight text-ink">{title}</h1>
              {subtitle && <p className="mt-0.5 break-words text-sm text-ink-3">{subtitle}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
        )}
        {headerExtra && <div className="mb-4 hidden lg:block">{headerExtra}</div>}
        {children}
      </div>

      {footer && (
        <div className={`safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur-md lg:sticky lg:mt-auto ${footerMobileOnly ? 'lg:hidden' : ''}`}>
          <div className={`mx-auto flex w-full items-center gap-3 px-4 py-3 sm:px-6 lg:px-8 ${maxWidth}`}>{footer}</div>
        </div>
      )}
      {fab}
    </div>
  )
}

/** Extended floating action button shown above the bottom navigation on phones and tablets. */
export function Fab({ children }) {
  return (
    <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-30 lg:hidden [&>*]:rounded-full [&>*]:shadow-pop">
      {children}
    </div>
  )
}
