import { Loader2 } from 'lucide-react'
import { Link } from 'react-router'

const VARIANTS = {
  primary: 'bg-brand text-white shadow-sm hover:bg-brand-hover',
  secondary: 'border border-line-strong bg-card text-ink hover:bg-muted',
  ghost: 'text-ink-2 hover:bg-subtle hover:text-ink',
  soft: 'bg-brand-soft text-brand-ink hover:brightness-[0.97]',
  danger: 'bg-neg text-white shadow-sm hover:brightness-95',
  'danger-soft': 'bg-neg-soft text-neg hover:brightness-[0.97]',
  success: 'bg-pos text-white shadow-sm hover:brightness-95',
  'success-soft': 'bg-pos-soft text-pos hover:brightness-[0.97]',
}

const SIZES = {
  sm: 'h-9 gap-1.5 rounded-lg px-3 text-sm',
  md: 'h-11 gap-2 rounded-xl px-4 text-[15px]',
  lg: 'h-12 gap-2 rounded-xl px-5 text-base',
  icon: 'size-10 rounded-xl',
  // Square icon button as tall as a md button (phone action bars)
  'icon-lg': 'size-11 rounded-xl',
  'icon-sm': 'size-9 rounded-lg',
  // Buttons in two-column action grids on phones: a long label wraps onto a second line
  // instead of spilling out of the button at 320px.
  tile: 'min-h-11 gap-1.5 rounded-xl px-2.5 py-2 text-sm leading-tight sm:px-4 sm:text-[15px]',
  // Floating pill buttons above the bottom navigation; compact on 320px phones.
  fab: 'h-12 gap-2 rounded-full px-3 text-[15px] xs:px-5 xs:text-base',
}

export function buttonClasses({ variant = 'primary', size = 'md', className = '' } = {}) {
  // Let callers hide a button responsively (e.g. "hidden sm:inline-flex"): a base
  // `inline-flex` would otherwise win over `hidden` in the generated CSS order.
  const display = /(^|\s)hidden(\s|$)/.test(className) ? '' : 'inline-flex'
  const wrap = size === 'tile' ? 'whitespace-normal text-center' : 'whitespace-nowrap'
  return `${display} shrink-0 select-none items-center justify-center ${wrap} font-semibold transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`
}

export default function Button({
  variant = 'primary', size = 'md', loading = false, icon: Icon, iconRight: IconRight, to, href, className = '',
  children, disabled, type = 'button', ...props
}) {
  const classes = buttonClasses({ variant, size, className })
  const iconSize = size === 'sm' || size === 'icon-sm' ? 'size-4' : 'size-[18px]'
  const content = (
    <>
      {loading ? <Loader2 className={`${iconSize} animate-spin`} aria-hidden /> : Icon ? <Icon className={`${iconSize} shrink-0`} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight className={`${iconSize} shrink-0`} aria-hidden /> : null}
    </>
  )
  if (to && !disabled) {
    return <Link to={to} className={classes} {...props}>{content}</Link>
  }
  if (href && !disabled) {
    return <a href={href} className={classes} {...props}>{content}</a>
  }
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  )
}
