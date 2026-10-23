import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

import Button from '../components/ui/Button.jsx'
import Modal from '../components/ui/Modal.jsx'

const UIContext = createContext(null)

const TOAST_ICONS = {
  success: <CheckCircle2 className="size-5 text-pos" aria-hidden />,
  error: <XCircle className="size-5 text-neg" aria-hidden />,
  info: <Info className="size-5 text-brand" aria-hidden />,
}

function ConfirmDialog({ state, onResolve }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  if (!state) return null
  const { title, message, details, confirmText = 'Confirm', cancelText = 'Cancel', tone = 'danger', typeToConfirm } = state
  const blocked = typeToConfirm && typed.trim() !== typeToConfirm
  const close = (result) => {
    setTyped('')
    setBusy(false)
    onResolve(result)
  }
  return (
    <Modal
      open
      onClose={() => !busy && close(false)}
      title={title}
      size="sm"
      footer={(
        <div className="flex w-full gap-3 sm:justify-end">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => close(false)} disabled={busy}>
            {cancelText}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            className="flex-1 sm:flex-none"
            disabled={blocked}
            loading={busy}
            onClick={() => close(true)}
          >
            {confirmText}
          </Button>
        </div>
      )}
    >
      <div className="flex gap-3">
        {tone === 'danger' && (
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-neg-soft text-neg">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0 space-y-3 text-[15px] leading-relaxed text-ink-2">
          {message && <p>{message}</p>}
          {details}
          {typeToConfirm && (
            <label className="block space-y-1.5">
              <span className="text-sm text-ink-2">
                Type <strong className="font-semibold text-ink">{typeToConfirm}</strong> to confirm
              </span>
              <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)
  const resolver = useRef(null)
  const counter = useRef(0)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])

  const push = useCallback((type, message, options = {}) => {
    if (!message) return
    counter.current += 1
    const id = counter.current
    setToasts((list) => [...list.slice(-3), { id, type, message, action: options.action }])
    setTimeout(() => dismiss(id), options.duration ?? (type === 'error' ? 6000 : 3500))
  }, [dismiss])

  const toast = useMemo(() => ({
    success: (message, options) => push('success', message, options),
    error: (message, options) => push('error', message?.message || message, options),
    info: (message, options) => push('info', message, options),
  }), [push])

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve
    setConfirmState(options)
  }), [])

  const resolveConfirm = useCallback((result) => {
    setConfirmState(null)
    resolver.current?.(result)
    resolver.current = null
  }, [])

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <UIContext.Provider value={value}>
      {children}
      <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-line bg-card px-4 py-3 text-[15px] text-ink shadow-pop"
          >
            {TOAST_ICONS[item.type]}
            <p className="min-w-0 flex-1 leading-snug">{item.message}</p>
            {item.action && (
              <button type="button" className="text-sm font-semibold text-brand-ink" onClick={() => { item.action.onClick(); dismiss(item.id) }}>
                {item.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="-m-1 p-1 text-ink-3 hover:text-ink" onClick={() => dismiss(item.id)}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </UIContext.Provider>
  )
}

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used inside UIProvider')
  return context
}
