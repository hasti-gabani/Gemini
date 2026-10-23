import { ShieldCheck } from 'lucide-react'

import { BrandMark } from '../../components/layout/AppShell.jsx'

/**
 * Sign-in / sign-up frame: simple and calm. One white card in the middle of the page with the
 * logo above the form, the same on phones and desktop.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="h-1 bg-brand" />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 flex flex-col items-center text-center">
            <BrandMark className="size-14 rounded-2xl shadow-card" />
            <p className="mt-3 text-xl font-bold tracking-tight text-ink">Gemini</p>
            <p className="mt-0.5 text-sm text-ink-3">Billing · Payments · Accounts</p>
          </div>

          <div className="rounded-2xl border border-line bg-card p-6 shadow-card sm:p-8">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-[15px] text-ink-3">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>

          {footer && <div className="mt-5 text-center text-[15px] text-ink-3">{footer}</div>}
        </div>
      </main>
      <footer className="flex flex-col items-center gap-1 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-xs text-ink-3 sm:flex-row sm:justify-center sm:gap-3">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-pos" aria-hidden />
          Secure sign-in · Your data stays on your own computer
        </span>
        <span className="hidden sm:inline" aria-hidden>·</span>
        <span>© {new Date().getFullYear()} Gemini</span>
      </footer>
    </div>
  )
}
