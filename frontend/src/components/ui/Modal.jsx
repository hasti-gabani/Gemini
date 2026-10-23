import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-6xl',
}

// Only the top-most open modal reacts to Escape.
const stack = []

/**
 * Bottom sheet on phones, centered dialog from 640px. Closes on Escape and
 * backdrop tap, locks page scroll while open and restores focus on close.
 */
export default function Modal({
  open, onClose, title, subtitle, children, footer, size = 'md', bodyClassName = '', headerRight, dismissible = true,
  fullHeight = false,
}) {
  const id = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    stack.push(id)
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape' && stack[stack.length - 1] === id && dismissible) {
        event.stopPropagation()
        onCloseRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    const focusTimer = setTimeout(() => {
      const panel = panelRef.current
      if (panel && !panel.contains(document.activeElement)) {
        const target = panel.querySelector('[data-autofocus]') || panel
        target.focus({ preventScroll: true })
      }
    }, 30)
    return () => {
      clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(id), 1)
      if (!stack.length) document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [open, id, dismissible])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-[1px]"
        onClick={() => dismissible && onClose?.()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? `${id}-title` : undefined}
        tabIndex={-1}
        className={`relative flex w-full flex-col overflow-hidden rounded-t-[1.25rem] bg-card shadow-pop outline-none animate-sheet-up sm:animate-pop-in sm:rounded-2xl ${fullHeight ? 'h-[94dvh] sm:h-[88dvh]' : 'max-h-[94dvh] sm:max-h-[88dvh]'} ${SIZES[size] || SIZES.md}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        {(title || headerRight) && (
          <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 pb-3 pt-2.5 sm:pt-4">
            <div className="min-w-0 flex-1">
              {title && <h2 id={`${id}-title`} className="text-lg font-semibold leading-tight text-ink">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
            </div>
            {headerRight}
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-subtle hover:text-ink"
              >
                <X className="size-5" />
              </button>
            )}
          </header>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 scroll-thin ${bodyClassName}`}>
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t border-line bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
