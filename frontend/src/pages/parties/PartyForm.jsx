import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import {
  DateInput, Field, FormSection, NumberInput, Segmented, Select, TextArea, TextInput,
} from '../../components/ui/form.jsx'
import { ErrorState, PageLoader } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { todayISO } from '../../lib/dates.js'
import { useInvalidateAll } from '../../lib/hooks.js'

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

const EMPTY = {
  name: '', party_type: 'customer', phone: '', phone_alt: '', email: '', address: '', city: '', state: 'Gujarat',
  pincode: '', gstin: '', notes: '', opening_balance: '', opening_balance_type: 'receivable', opening_balance_date: '',
}

const strip = (value) => (value && String(value).includes('.') ? String(value).replace(/\.?0+$/, '') : value || '')

export default function PartyForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const { toast, confirm } = useUI()
  const invalidate = useInvalidateAll()
  const [form, setForm] = useState(() => (editing ? null : { ...EMPTY, opening_balance_date: todayISO() }))
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const existing = useQuery({ queryKey: ['party', id, 'edit'], queryFn: () => api.get(`/parties/${id}/`), enabled: editing, gcTime: 0 })
  useEffect(() => {
    if (editing && existing.data && !form) {
      const p = existing.data
      setForm({
        ...EMPTY,
        ...Object.fromEntries(Object.keys(EMPTY).map((key) => [key, p[key] ?? ''])),
        opening_balance: strip(p.opening_balance) === '0' ? '' : strip(p.opening_balance),
      })
    }
  }, [editing, existing.data, form])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savingRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({ title: 'Discard changes?', message: 'Your changes are not saved.', confirmText: 'Discard', cancelText: 'Keep editing', tone: 'danger' })
      .then((ok) => (ok ? blocker.proceed() : blocker.reset()))
  }, [blocker, confirm])

  if (editing && existing.isError) return <Page title="Edit Party" back="/parties"><ErrorState error={existing.error} onRetry={existing.refetch} /></Page>
  if (!form) return <Page title="Edit Party" back><PageLoader /></Page>

  const set = (key) => (event) => {
    setForm({ ...form, [key]: event?.target ? event.target.value : event })
    setDirty(true)
  }

  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Party name is required.'
    const phoneOk = (value) => !value.trim() || /^(\+?\d[\d\s-]{7,15})$/.test(value.trim())
    if (!phoneOk(form.phone)) next.phone = 'Enter a valid mobile number.'
    if (!phoneOk(form.phone_alt)) next.phone_alt = 'Enter a valid mobile number.'
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter a valid email address.'
    if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode.trim())) next.pincode = 'Enter a valid 6-digit pincode.'
    if (form.gstin && form.gstin.trim().length !== 15) next.gstin = 'GSTIN must be 15 characters.'
    return next
  }

  const save = async (then) => {
    const clientErrors = validate()
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) {
      toast.error(Object.values(clientErrors)[0])
      return
    }
    setSaving(true)
    savingRef.current = true
    // There is no party type choice here: new parties are customers, and editing never changes
    // the type (a party becomes "Customer & Supplier" automatically when used on both kinds of bill).
    const { party_type: _type, ...details } = form
    const body = {
      ...details,
      ...(editing ? {} : { party_type: 'customer' }),
      opening_balance: form.opening_balance || '0',
      gstin: form.gstin.toUpperCase(),
      opening_balance_date: form.opening_balance_date || todayISO(),
    }
    try {
      const saved = editing ? await api.patch(`/parties/${id}/`, body) : await api.post('/parties/', body)
      invalidate()
      setDirty(false)
      toast.success(`${saved.name} ${editing ? 'updated' : 'added'}.`)
      if (then === 'new') {
        if (editing) navigate('/parties/new', { replace: true })
        else {
          setForm({ ...EMPTY, state: form.state, opening_balance_date: todayISO() })
          setErrors({})
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      } else {
        navigate(`/parties/${saved.id}`, { replace: true })
      }
    } catch (error) {
      setErrors(error.errors || {})
      toast.error(error)
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  const states = form.state && !INDIAN_STATES.includes(form.state) ? [form.state, ...INDIAN_STATES] : INDIAN_STATES

  return (
    <Page
      title={editing ? 'Edit Party' : 'Add Party'}
      subtitle={editing ? form.name : undefined}
      back
      maxWidth="max-w-3xl"
      footer={(
        <>
          <Button
            variant="ghost"
            className="hidden lg:inline-flex"
            onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/parties'))}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button variant="secondary" className="flex-1 lg:flex-none" onClick={() => save('new')} disabled={saving}>Save &amp; New</Button>
          <div className="hidden flex-1 lg:block" />
          <Button className="flex-[1.4] lg:min-w-40 lg:flex-none" loading={saving} onClick={() => save('view')}>Save</Button>
        </>
      )}
    >
      <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); save('view') }}>
        <FormSection title="Basic details">
          <div className="space-y-4">
            <Field label="Party Name" required htmlFor="name" error={errors.name}>
              <TextInput id="name" autoFocus={!editing} value={form.name} error={errors.name} onChange={set('name')} autoComplete="off" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mobile Number" htmlFor="phone" error={errors.phone}>
                <TextInput id="phone" type="tel" inputMode="tel" autoComplete="off" value={form.phone} error={errors.phone} onChange={set('phone')} placeholder="98765 43210" />
              </Field>
              <Field label="Alternate Mobile Number" htmlFor="phone_alt" error={errors.phone_alt}>
                <TextInput id="phone_alt" type="tel" inputMode="tel" autoComplete="off" value={form.phone_alt} error={errors.phone_alt} onChange={set('phone_alt')} />
              </Field>
            </div>
            <Field label="Email" htmlFor="email" error={errors.email}>
              <TextInput id="email" type="email" inputMode="email" autoComplete="off" value={form.email} error={errors.email} onChange={set('email')} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Address & GST">
          <div className="space-y-4">
            <Field label="Address" htmlFor="address" error={errors.address}>
              <TextArea id="address" rows={2} value={form.address} onChange={set('address')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" htmlFor="city" error={errors.city}>
                <TextInput id="city" value={form.city} onChange={set('city')} />
              </Field>
              <Field label="State" htmlFor="state">
                <Select id="state" value={form.state} onChange={set('state')} placeholder="Select state" options={states.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Pincode" htmlFor="pincode" error={errors.pincode}>
                <TextInput id="pincode" inputMode="numeric" maxLength={6} value={form.pincode} error={errors.pincode} onChange={set('pincode')} />
              </Field>
            </div>
            <Field label="GST Number (optional)" htmlFor="gstin" error={errors.gstin}>
              <TextInput id="gstin" className="uppercase" maxLength={15} value={form.gstin} error={errors.gstin} onChange={(e) => set('gstin')(e.target.value.toUpperCase())} placeholder="24ABCDE1234F1Z5" />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Opening balance" description="Amount pending with this party before you started using the app.">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opening Balance" error={errors.opening_balance}>
                <NumberInput prefix="₹" value={form.opening_balance} onChange={set('opening_balance')} placeholder="0" />
              </Field>
              <Field label="As of date" error={errors.opening_balance_date}>
                <DateInput value={form.opening_balance_date} onChange={set('opening_balance_date')} />
              </Field>
            </div>
            <Field label="Balance Type">
              <Segmented
                value={form.opening_balance_type}
                onChange={set('opening_balance_type')}
                options={[
                  { value: 'receivable', label: 'Receivable (મારે લેવાના)', tone: 'pos' },
                  { value: 'payable', label: 'Payable (મારે આપવાના)', tone: 'neg' },
                ]}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Party detail / notes">
          <TextArea rows={3} value={form.notes} onChange={set('notes')} placeholder="Anything you want to remember about this party" />
        </FormSection>
        <button type="submit" hidden />
      </form>
    </Page>
  )
}
