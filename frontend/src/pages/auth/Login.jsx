import { Eye, EyeOff, LogIn } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import Button from '../../components/ui/Button.jsx'
import { Checkbox, Field, TextInput } from '../../components/ui/form.jsx'
import { SIGNED_OUT_KEY, useSession } from '../../context/SessionContext.jsx'
import { api } from '../../lib/api.js'
import AuthLayout from './AuthLayout.jsx'

export default function Login() {
  const { setSession, registrationOpen } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: '', password: '', remember: true })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      const reason = sessionStorage.getItem(SIGNED_OUT_KEY)
      if (reason) {
        setNotice(reason)
        sessionStorage.removeItem(SIGNED_OUT_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = {}
    if (!form.username.trim()) nextErrors.username = 'Enter your mobile number, email or username.'
    if (!form.password) nextErrors.password = 'Enter your password.'
    setErrors(nextErrors)
    setMessage('')
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    try {
      const session = await api.post('/auth/login/', form)
      setSession(session)
      navigate(location.state?.from || '/', { replace: true })
    } catch (error) {
      setErrors(error.errors || {})
      if (!error.errors?.password && !error.errors?.username) setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your bills, payments and accounts."
      footer={registrationOpen && (
        <>New to Gemini? <Link to="/register" className="font-semibold text-brand-ink hover:underline">Create your business account</Link></>
      )}
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {notice && !message && <div className="rounded-xl bg-brand-soft px-4 py-3 text-[15px] text-brand-ink" role="status">{notice}</div>}
        {message && <div className="rounded-xl bg-neg-soft px-4 py-3 text-[15px] text-neg" role="alert">{message}</div>}
        <Field label="Mobile number, email or username" htmlFor="username" error={errors.username}>
          <TextInput
            id="username"
            autoComplete="username"
            autoFocus
            value={form.username}
            error={errors.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <div className="relative">
            <TextInput
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={form.password}
              error={errors.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:text-ink"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </Field>
        <Checkbox checked={form.remember} onChange={(remember) => setForm({ ...form, remember })} label="Keep me signed in on this device" />
        <Button type="submit" size="lg" className="w-full" loading={busy} icon={LogIn}>Sign in</Button>
      </form>
    </AuthLayout>
  )
}
