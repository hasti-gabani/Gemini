import { Info, Lock, Plus, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useBlocker } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { useBeforeUnload, useInvalidateAll } from '../../lib/hooks.js'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => item === b[index])
  return a === b
}

function sameValues(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const key of keys) {
    if (!sameValue(a?.[key], b?.[key])) return false
  }
  return true
}

/** Copy settings fields (with fallbacks) into form values. */
export function pickValues(source, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, source?.[key] ?? fallback]))
}

/** PATCH /settings/ and put the saved settings into the session. */
export function useSaveSettings() {
  const { patchSession } = useSession()
  return useCallback(async (payload) => {
    const saved = await api.patch('/settings/', payload)
    patchSession({ settings: saved })
    return saved
  }, [patchSession])
}

/** Asks before leaving the page (in-app navigation or closing the tab) while there are unsaved changes. */
export function useUnsavedChangesGuard(dirty) {
  const { confirm } = useUI()
  useBeforeUnload(dirty)
  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }) => dirty
      && currentLocation.pathname !== nextLocation.pathname
      && nextLocation.pathname !== '/login',
    [dirty],
  )
  const blocker = useBlocker(shouldBlock)
  const asking = useRef(false)
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return
    asking.current = true
    confirm({
      title: 'Discard unsaved changes?',
      message: 'You changed some settings on this page but did not save them.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      tone: 'danger',
    }).then((ok) => {
      asking.current = false
      if (ok) blocker.proceed()
      else blocker.reset()
    })
  }, [blocker, confirm])
}

/**
 * Local form state for a settings section.
 * `source` is derived from the session; edits live in a draft until saved, so
 * `dirty` is simply "draft differs from what is saved".
 */
export function useSettingsForm({ id, source, validate, submit, successMessage = 'Settings saved' }) {
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const [draft, setDraft] = useState(null)
  // `source` at the moment a save succeeded. The session re-renders a little later (query cache
  // notifications are batched), so the draft is kept until the saved data arrives — no flash of old values.
  const [savedFrom, setSavedFrom] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  if (savedFrom !== null && source !== savedFrom) {
    setSavedFrom(null)
    setDraft(null)
  }
  const values = draft ?? source
  const dirty = draft !== null && savedFrom === null && !sameValues(draft, source)

  useUnsavedChangesGuard(dirty)

  const focusFirstError = () => {
    requestAnimationFrame(() => {
      const field = document.getElementById(id)?.querySelector('[aria-invalid="true"]')
      if (field instanceof HTMLElement) field.focus()
    })
  }

  const update = (patch) => {
    setSavedFrom(null)
    setDraft((previous) => ({ ...(previous ?? source), ...patch }))
    const keys = Object.keys(patch)
    setErrors((previous) => (keys.some((key) => previous[key])
      ? Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.includes(key)))
      : previous))
  }

  const setField = (key, value) => update({ [key]: value })

  const reset = () => {
    setSavedFrom(null)
    setDraft(null)
    setErrors({})
  }

  const save = async (event) => {
    event?.preventDefault()
    if (!dirty || saving) return
    const found = validate ? validate(values) : null
    if (found && Object.keys(found).length) {
      setErrors(found)
      toast.error('Please correct the highlighted fields.')
      focusFirstError()
      return
    }
    setSaving(true)
    try {
      await submit(values)
      setSavedFrom(source)
      setErrors({})
      invalidate()
      toast.success(successMessage)
    } catch (error) {
      setErrors(error?.errors || {})
      toast.error(error)
      focusFirstError()
    } finally {
      setSaving(false)
    }
  }

  return {
    id, values, errors, setErrors, update, setField, dirty, saving, save, reset,
    formProps: { id, onSubmit: save, noValidate: true },
  }
}

/** Whole-number input (starting numbers, days). Keeps the value as a string of digits. */
export function IntegerInput({ value, onChange, suffix, maxLength = 6, error, className = '', ...props }) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={maxLength}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, maxLength))}
        onFocus={(event) => event.target.select()}
        aria-invalid={error ? 'true' : undefined}
        className={`field num ${suffix ? 'pr-16' : ''}`}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-3">{suffix}</span>
      )}
    </div>
  )
}

/** Large segmented choice (≥44px targets), e.g. System | Light | Dark. */
export function ChoiceGroup({ value, onChange, options, label, labelledBy, disabled = false, className = '' }) {
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={`grid w-full auto-cols-fr grid-flow-col gap-1 rounded-xl bg-subtle p-1 sm:inline-grid sm:w-auto ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(option.value)}
            className={`flex min-h-11 min-w-0 items-center justify-center rounded-lg px-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:gap-2 sm:px-5 sm:text-[15px] ${option.icon ? 'flex-col gap-0.5 py-1.5 text-sm sm:flex-row sm:py-0' : 'gap-2 text-[15px]'} ${selected ? 'bg-card text-brand-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
          >
            {option.icon && <option.icon className="size-[18px] shrink-0" aria-hidden />}
            <span className="max-w-full truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const CALLOUT_TONES = {
  info: { box: 'bg-brand-soft', icon: 'text-brand-ink', Icon: Info },
  warn: { box: 'bg-warn-soft', icon: 'text-warn', Icon: TriangleAlert },
  danger: { box: 'bg-neg-soft', icon: 'text-neg', Icon: TriangleAlert },
  neutral: { box: 'border border-line bg-muted', icon: 'text-ink-3', Icon: Info },
}

export function Callout({ tone = 'info', icon, title, children, className = '' }) {
  const config = CALLOUT_TONES[tone] || CALLOUT_TONES.info
  const Icon = icon || config.Icon
  return (
    <div className={`flex gap-3 rounded-xl px-4 py-3 ${config.box} ${className}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${config.icon}`} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1 text-sm leading-relaxed text-ink-2">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  )
}

export function OwnerOnlyNotice({ children }) {
  return (
    <Callout tone="warn" icon={Lock} title="Only the business owner can do this">
      <p>{children}</p>
    </Callout>
  )
}

/** Editable list of short values shown as removable chips (units, tax rates). */
export function TagEditor({
  items, onChange, prepare = (text) => text, normalize, validate, format = (item) => item, sort, minItems = 0,
  placeholder, inputMode, maxLength, label, addLabel = 'Add', error, minItemsMessage,
}) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const inputId = useId()

  const add = () => {
    const value = normalize(text)
    if (!value) {
      setMessage(text.trim() ? `"${text.trim()}" is not valid.` : 'Type a value to add.')
      return
    }
    const problem = validate?.(value, items)
    if (problem) {
      setMessage(problem)
      return
    }
    const next = [...items, value]
    onChange(sort ? sort(next) : next)
    setText('')
    setMessage('')
  }

  const shown = message || error
  return (
    <div className="space-y-3">
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {items.map((item) => {
            const locked = items.length <= minItems
            return (
              <li key={item} className="inline-flex h-11 items-center rounded-full border border-line bg-muted pl-4 text-[15px] font-medium text-ink lg:h-9">
                <span className="num">{format(item)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${format(item)}`}
                  title={locked ? minItemsMessage : `Remove ${format(item)}`}
                  disabled={locked}
                  onClick={() => onChange(items.filter((entry) => entry !== item))}
                  className="grid h-11 w-10 place-items-center rounded-r-full text-ink-3 transition hover:text-neg disabled:cursor-not-allowed disabled:opacity-40 lg:h-9 lg:w-9"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Nothing added yet.</p>
      )}
      <div>
        <label htmlFor={inputId} className="sr-only">{label}</label>
        <div className="flex gap-2">
          <input
            id={inputId}
            className="field min-w-0 flex-1"
            value={text}
            placeholder={placeholder}
            inputMode={inputMode}
            maxLength={maxLength}
            autoComplete="off"
            aria-invalid={shown ? 'true' : undefined}
            onChange={(event) => {
              setText(prepare(event.target.value))
              if (message) setMessage('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
          <Button variant="secondary" icon={Plus} onClick={add}>{addLabel}</Button>
        </div>
        {shown && <p className="mt-1.5 text-sm leading-snug text-neg" role="alert">{shown}</p>}
      </div>
    </div>
  )
}
