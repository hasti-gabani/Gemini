import { Check } from 'lucide-react'
import { createContext, useContext, useId } from 'react'

import { sanitizeNumberInput } from '../../lib/money.js'

// Lets the first control inside a <Field> pick up the label's id (and hint/error ids)
// without every form having to wire `id`/`htmlFor` by hand.
const FieldContext = createContext(null)

export function useFieldProps(props) {
  const field = useContext(FieldContext)
  if (!field) return props
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': props['aria-describedby'] ?? field.describedBy,
    'aria-required': props['aria-required'] ?? (field.required || undefined),
  }
}

export function Field({ label, hint, error, required, htmlFor, children, className = '', labelRight }) {
  const autoId = useId()
  const id = htmlFor || `${autoId}-control`
  const messageId = `${autoId}-message`
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      {(label || labelRight) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={id} className="text-sm font-medium text-ink-2">
              {label}
              {required && <span className="text-neg"> *</span>}
            </label>
          )}
          {labelRight}
        </div>
      )}
      <FieldContext.Provider value={{ id, required, describedBy: error || hint ? messageId : undefined }}>
        {children}
      </FieldContext.Provider>
      {error ? (
        <p id={messageId} className="text-sm leading-snug text-neg" role="alert">{error}</p>
      ) : hint ? (
        <p id={messageId} className="text-xs leading-snug text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput({ error, className = '', ref, ...rest }) {
  const props = useFieldProps(rest)
  return <input ref={ref} className={`field ${className}`} aria-invalid={error ? 'true' : undefined} {...props} />
}

export function TextArea({ error, className = '', rows = 3, ref, ...rest }) {
  const props = useFieldProps(rest)
  return <textarea ref={ref} rows={rows} className={`field ${className}`} aria-invalid={error ? 'true' : undefined} {...props} />
}

export function Select({ error, options = [], placeholder, className = '', ref, ...rest }) {
  const props = useFieldProps(rest)
  return (
    <select ref={ref} className={`field ${className}`} aria-invalid={error ? 'true' : undefined} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  )
}

export function DateInput({ error, className = '', ref, ...rest }) {
  const props = useFieldProps(rest)
  return <input ref={ref} type="date" className={`field ${className}`} aria-invalid={error ? 'true' : undefined} {...props} />
}

export function MonthInput({ error, className = '', ref, ...rest }) {
  const props = useFieldProps(rest)
  return <input ref={ref} type="month" className={`field ${className}`} aria-invalid={error ? 'true' : undefined} {...props} />
}

/** Amount / quantity input that only accepts valid numbers and keeps the value as a string. */
export function NumberInput({
  value, onChange, decimals = 2, allowNegative = false, prefix, suffix, error, className = '', inputClassName = '',
  selectOnFocus = true, align = 'left', ref, onFocus, ...rest
}) {
  const props = useFieldProps(rest)
  return (
    <div className={`relative min-w-0 ${className}`}>
      {prefix && (
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3">{prefix}</span>
      )}
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value ?? ''}
        onChange={(event) => onChange?.(sanitizeNumberInput(event.target.value, { decimals, allowNegative }))}
        onFocus={(event) => {
          if (selectOnFocus) event.target.select()
          onFocus?.(event)
        }}
        aria-invalid={error ? 'true' : undefined}
        className={`field num ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-10' : ''} ${align === 'right' ? 'text-right' : ''} ${inputClassName}`}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-3">{suffix}</span>
      )}
    </div>
  )
}

export function Checkbox({ checked, onChange, label, description, disabled, className = '', id, ariaLabel }) {
  const autoId = useId()
  const inputId = id || autoId
  return (
    <label htmlFor={inputId} className={`flex cursor-pointer select-none items-start gap-3 ${disabled ? 'opacity-60' : ''} ${className}`}>
      <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
        <input
          id={inputId}
          type="checkbox"
          aria-label={ariaLabel}
          className="peer absolute inset-0 cursor-pointer opacity-0"
          checked={Boolean(checked)}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span className="size-5 rounded-md border-2 border-line-strong bg-card transition peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--ring)]" />
        <Check className="pointer-events-none absolute size-3.5 text-white opacity-0 transition peer-checked:opacity-100" strokeWidth={3} />
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[15px] leading-snug text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-sm leading-snug text-ink-3">{description}</span>}
        </span>
      )}
    </label>
  )
}

export function Switch({ checked, onChange, label, description, disabled, className = '' }) {
  const id = useId()
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-60' : ''} ${className}`}>
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          {label && <span className="block text-[15px] text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-sm leading-snug text-ink-3">{description}</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line-strong'}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  )
}

/** Pill toggle, e.g. Credit | Cash. */
export function Segmented({ value, onChange, options, size = 'md', className = '', tone = 'brand' }) {
  const active = {
    brand: 'bg-card text-brand-ink shadow-sm',
    pos: 'bg-pos text-white shadow-sm',
    neg: 'bg-neg text-white shadow-sm',
  }
  return (
    <div role="radiogroup" className={`inline-flex rounded-full bg-subtle p-1 ${className}`}>
      {options.map((option) => {
        const selected = option.value === value
        const optionTone = option.tone || tone
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange?.(option.value)}
            className={`rounded-full font-semibold transition ${size === 'sm' ? 'px-3 py-1 text-sm' : 'px-4 py-1.5 text-sm sm:text-[15px]'} ${selected ? active[optionTone] : 'text-ink-2 hover:text-ink'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Fieldset card for grouping form fields. */
export function FormSection({ title, description, children, className = '', actions }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-base font-semibold text-ink">{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}
