import { KeyRound, LogOut } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import Button from '../../../components/ui/Button.jsx'
import { Checkbox, Field, FormSection, TextInput } from '../../../components/ui/form.jsx'
import { Avatar, Badge } from '../../../components/ui/misc.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { useUI } from '../../../context/UIContext.jsx'
import { api } from '../../../lib/api.js'
import { useIsDesktop } from '../../../lib/hooks.js'
import SettingsPage, { DesktopSaveBar } from '../SettingsLayout.jsx'
import { EMAIL_RE, useSettingsForm } from '../settingsKit.jsx'

const EMPTY_PASSWORDS = { current_password: '', new_password: '', confirm_password: '' }

function ChangePassword({ username }) {
  const { toast } = useUI()
  const [values, setValues] = useState(EMPTY_PASSWORDS)
  const [errors, setErrors] = useState({})
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => {
    setValues({ ...values, [key]: event.target.value })
    if (errors[key]) setErrors({ ...errors, [key]: '' })
  }

  const submit = async (event) => {
    event.preventDefault()
    const found = {}
    if (!values.current_password) found.current_password = 'Enter your current password.'
    if (values.new_password.length < 6) found.new_password = 'New password must be at least 6 characters.'
    else if (values.confirm_password !== values.new_password) found.confirm_password = 'The new passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const result = await api.post('/auth/change-password/', {
        current_password: values.current_password,
        new_password: values.new_password,
      })
      setValues(EMPTY_PASSWORDS)
      setShow(false)
      toast.success(result?.detail || 'Password changed successfully.')
    } catch (error) {
      setErrors(error.errors || {})
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  const type = show ? 'text' : 'password'
  return (
    <FormSection title="Change password" description="Use at least 6 characters. You stay signed in on this device.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <input type="text" name="username" autoComplete="username" value={username || ''} readOnly hidden />
        <Field label="Current password" htmlFor="current-password" error={errors.current_password}>
          <TextInput
            id="current-password"
            type={type}
            autoComplete="current-password"
            value={values.current_password}
            error={errors.current_password}
            onChange={set('current_password')}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="new-password" error={errors.new_password}>
            <TextInput
              id="new-password"
              type={type}
              autoComplete="new-password"
              value={values.new_password}
              error={errors.new_password}
              onChange={set('new_password')}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password" error={errors.confirm_password}>
            <TextInput
              id="confirm-password"
              type={type}
              autoComplete="new-password"
              value={values.confirm_password}
              error={errors.confirm_password}
              onChange={set('confirm_password')}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Checkbox checked={show} onChange={setShow} label="Show passwords" className="py-1" />
          <Button
            type="submit"
            variant="secondary"
            icon={KeyRound}
            loading={busy}
            disabled={!values.current_password && !values.new_password && !values.confirm_password}
            className="w-full sm:w-auto"
          >
            Change password
          </Button>
        </div>
      </form>
    </FormSection>
  )
}

export default function MyAccount() {
  const { t, user, business, patchSession, logout } = useSession()
  const { confirm, toast } = useUI()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const [loggingOut, setLoggingOut] = useState(false)

  const source = useMemo(() => ({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    phone: user?.phone || '',
    email: user?.email || '',
  }), [user])

  const form = useSettingsForm({
    id: 'settings-account',
    source,
    validate: (values) => (values.email.trim() && !EMAIL_RE.test(values.email.trim())
      ? { email: 'Enter a valid email address.' }
      : {}),
    submit: async (values) => {
      const saved = await api.patch('/auth/profile/', {
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
      })
      patchSession({ user: saved })
    },
  })
  const { values, errors, setField } = form

  const signOut = async () => {
    const ok = await confirm({ title: 'Log out?', message: 'You will need to sign in again.', confirmText: t('logout'), tone: 'primary' })
    if (!ok) return
    setLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (error) {
      setLoggingOut(false)
      toast.error(error)
    }
  }

  const owner = user?.role === 'owner'

  return (
    <SettingsPage id="account" form={form} desktopSaveBar={false}>
      <section className="card flex items-center gap-4 p-4 sm:p-5">
        <Avatar name={user?.name || ''} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-ink">{user?.name}</p>
          <p className="truncate text-sm text-ink-3">
            {business?.name}
          </p>
        </div>
        <Badge tone={owner ? 'brand' : 'neutral'}>{owner ? 'Owner' : 'Staff'}</Badge>
      </section>

      <FormSection title="Your profile" description={`Sign in with your username (${user?.username || '—'}), mobile number or email.`}>
        <form {...form.formProps} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="account-first-name" error={errors.first_name}>
              <TextInput
                id="account-first-name"
                autoComplete="given-name"
                maxLength={150}
                value={values.first_name}
                error={errors.first_name}
                onChange={(event) => setField('first_name', event.target.value)}
              />
            </Field>
            <Field label="Last name" htmlFor="account-last-name" error={errors.last_name}>
              <TextInput
                id="account-last-name"
                autoComplete="family-name"
                maxLength={150}
                value={values.last_name}
                error={errors.last_name}
                onChange={(event) => setField('last_name', event.target.value)}
              />
            </Field>
            <Field label="Mobile" htmlFor="account-phone" error={errors.phone}>
              <TextInput
                id="account-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                value={values.phone}
                error={errors.phone}
                onChange={(event) => setField('phone', event.target.value)}
              />
            </Field>
            <Field label="Email" htmlFor="account-email" error={errors.email}>
              <TextInput
                id="account-email"
                type="email"
                autoComplete="email"
                value={values.email}
                error={errors.email}
                onChange={(event) => setField('email', event.target.value)}
              />
            </Field>
          </div>
          {isDesktop && <DesktopSaveBar form={form} sticky={false} className="border-t border-line pt-4" />}
        </form>
      </FormSection>

      <ChangePassword username={user?.username} />

      <FormSection title={t('logout')} description="Sign out of Gemini on this device.">
        <Button variant="danger-soft" icon={LogOut} loading={loggingOut} onClick={signOut} className="w-full sm:w-auto">
          {t('logout')}
        </Button>
      </FormSection>
    </SettingsPage>
  )
}
