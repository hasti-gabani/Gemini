import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { Field, TextInput } from '../../components/ui/form.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { api } from '../../lib/api.js'
import AuthLayout from './AuthLayout.jsx'

export default function Register() {
  const { setSession, registrationOpen } = useSession()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', business_name: '', phone: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  if (!registrationOpen) return <Navigate to="/login" replace />

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    if (!form.name.trim()) next.name = 'Please enter your name.'
    if (!form.business_name.trim()) next.business_name = 'Please enter your business name.'
    if (!form.phone.trim() && !form.email.trim()) next.phone = 'Enter a mobile number or email to sign in with.'
    if (form.phone.trim() && !/^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(form.phone.trim())) next.phone = 'Enter a valid 10-digit mobile number.'
    if (form.password.length < 6) next.password = 'Password must be at least 6 characters.'
    setErrors(next)
    setMessage('')
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const session = await api.post('/auth/register/', form)
      setSession(session)
      navigate('/settings/profile?welcome=1', { replace: true })
    } catch (error) {
      setErrors(error.errors || {})
      if (!Object.keys(error.errors || {}).length) setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Create your business account"
      subtitle="Free to start. Your data stays on your own server."
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-brand-ink hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {message && <div className="rounded-xl bg-neg-soft px-4 py-3 text-[15px] text-neg" role="alert">{message}</div>}
        <Field label="Your name" htmlFor="name" required error={errors.name}>
          <TextInput id="name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        </Field>
        <Field label="Business name" htmlFor="business_name" required error={errors.business_name}>
          <TextInput id="business_name" autoComplete="organization" value={form.business_name} onChange={set('business_name')} error={errors.business_name} placeholder="e.g. Shree Hari Traders" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile number" htmlFor="phone" error={errors.phone} hint="Used to sign in">
            <TextInput id="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} error={errors.phone} />
          </Field>
          <Field label="Email (optional)" htmlFor="email" error={errors.email}>
            <TextInput id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
          </Field>
        </div>
        <Field label="Password" htmlFor="password" required error={errors.password} hint="At least 6 characters">
          <div className="relative">
            <TextInput id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} className="pr-12" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:text-ink">
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Create account</Button>
      </form>
    </AuthLayout>
  )
}
