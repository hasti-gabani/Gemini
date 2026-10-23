import { ArrowRight, ImagePlus, PartyPopper, Store, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'

import Button from '../../../components/ui/Button.jsx'
import { Field, FormSection, Select, TextArea, TextInput } from '../../../components/ui/form.jsx'
import { useSession } from '../../../context/SessionContext.jsx'
import { api } from '../../../lib/api.js'
import SettingsPage from '../SettingsLayout.jsx'
import { EMAIL_RE, useSettingsForm } from '../settingsKit.jsx'

const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]
const DEFAULT_STATE = 'Gujarat'
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_LOGO_MB = 5

function validate(values) {
  const found = {}
  if (!values.name.trim()) found.name = 'Business name is required.'
  if (values.pincode && !/^[1-9]\d{5}$/.test(values.pincode)) found.pincode = 'Enter a valid 6-digit pincode.'
  if (values.gstin && !GSTIN_RE.test(values.gstin)) {
    found.gstin = 'Enter a valid 15-character GST number (e.g. 24ABCDE1234F1Z5).'
  }
  if (values.email.trim() && !EMAIL_RE.test(values.email.trim())) found.email = 'Enter a valid email address.'
  return found
}

function BillHeaderPreview({ values, logoSrc }) {
  const place = [values.city.trim(), values.state].filter(Boolean).join(', ')
  const cityLine = values.pincode ? (place ? `${place} - ${values.pincode}` : values.pincode) : place
  const address = [values.address.trim(), cityLine].filter(Boolean).join('\n')
  const contact = [values.phone.trim() && `Mobile: ${values.phone.trim()}`, values.email.trim()].filter(Boolean).join(' · ')
  return (
    <FormSection
      title="How it looks on bills"
      description="Your details at the top of every bill, receipt and statement."
    >
      <div className="rounded-xl border border-dashed border-line-strong bg-muted p-4">
        <div className="flex items-start gap-3">
          {logoSrc && <img src={logoSrc} alt="" className="size-12 shrink-0 rounded-lg bg-card object-contain" />}
          <div className="min-w-0 flex-1">
            <p className={`wrap-break-word text-lg font-bold leading-snug ${values.name.trim() ? 'text-ink' : 'text-ink-3'}`}>
              {values.name.trim() || 'Your business name'}
            </p>
            {address && <p className="mt-0.5 whitespace-pre-line wrap-break-word text-sm text-ink-2">{address}</p>}
            {contact && <p className="wrap-break-word text-sm text-ink-2">{contact}</p>}
            {values.gstin && <p className="text-sm font-medium text-ink-2">GSTIN: {values.gstin}</p>}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Logo and GSTIN print only when they are turned on in{' '}
        <Link to="/settings/invoice" className="font-medium text-brand-ink hover:underline">Invoice &amp; Print</Link>.
      </p>
    </FormSection>
  )
}

export default function BusinessProfile() {
  const { business, patchSession } = useSession()
  const [searchParams] = useSearchParams()
  const welcome = searchParams.get('welcome') === '1'
  const fileInput = useRef(null)

  const source = useMemo(() => ({
    name: business?.name || '',
    address: business?.address || '',
    city: business?.city || '',
    state: business?.state || DEFAULT_STATE,
    pincode: business?.pincode || '',
    phone: business?.phone || '',
    email: business?.email || '',
    gstin: business?.gstin || '',
    logo: null,
    remove_logo: false,
  }), [business])

  const form = useSettingsForm({
    id: 'settings-profile',
    source,
    validate,
    submit: async (values) => {
      const fields = {
        name: values.name.trim(),
        address: values.address.trim(),
        city: values.city.trim(),
        state: values.state,
        pincode: values.pincode,
        phone: values.phone.trim(),
        email: values.email.trim(),
        gstin: values.gstin,
      }
      let body = fields
      if (values.logo || values.remove_logo) {
        body = new FormData()
        for (const [key, value] of Object.entries(fields)) body.append(key, value)
        if (values.logo) body.append('logo', values.logo)
        else body.append('remove_logo', 'true')
      }
      const saved = await api.patch('/business/', body)
      patchSession({ business: saved })
    },
  })
  const { values, errors, setField, update } = form

  const pickedUrl = useMemo(() => (values.logo ? URL.createObjectURL(values.logo) : ''), [values.logo])
  useEffect(() => () => {
    if (pickedUrl) URL.revokeObjectURL(pickedUrl)
  }, [pickedUrl])

  const savedLogo = business?.logo_url || ''
  const logoSrc = values.logo ? pickedUrl : values.remove_logo ? '' : savedLogo

  const stateOptions = useMemo(() => {
    const options = INDIAN_STATES.map((state) => ({ value: state, label: state }))
    return values.state && !INDIAN_STATES.includes(values.state)
      ? [{ value: values.state, label: values.state }, ...options]
      : options
  }, [values.state])

  const pickLogo = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const typeOk = LOGO_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)
    if (!typeOk) {
      form.setErrors((previous) => ({ ...previous, logo: 'Choose a JPG, PNG or WEBP image.' }))
      return
    }
    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      form.setErrors((previous) => ({ ...previous, logo: `This image is larger than ${MAX_LOGO_MB} MB. Choose a smaller file.` }))
      return
    }
    update({ logo: file, remove_logo: false })
  }

  const logoStatus = values.logo
    ? 'New logo selected — it will be uploaded when you save.'
    : values.remove_logo
      ? 'The logo will be removed when you save.'
      : ''

  return (
    <SettingsPage id="profile" form={form}>
      {welcome && (
        <div className="card flex flex-col gap-3 border-brand/30 bg-brand-soft p-4 sm:flex-row sm:items-center sm:p-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-brand-ink">
            <PartyPopper className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">Welcome to Gemini!</p>
            <p className="text-sm leading-relaxed text-ink-2">
              Add your business details — they appear on every bill and statement.
            </p>
          </div>
          <Button to="/" variant="secondary" iconRight={ArrowRight} className="w-full sm:w-auto">Continue to dashboard</Button>
        </div>
      )}

      <form {...form.formProps} className="space-y-4">
        <FormSection title="Business details">
          <div className="space-y-4">
            <Field label="Logo" error={errors.logo} hint={logoStatus || `JPG, PNG or WEBP, up to ${MAX_LOGO_MB} MB.`}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-muted">
                  {logoSrc ? (
                    <img src={logoSrc} alt="Business logo" className="size-full object-contain" />
                  ) : (
                    <Store className="size-8 text-ink-3" aria-hidden />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon={ImagePlus} onClick={() => fileInput.current?.click()}>
                    {logoSrc ? 'Change logo' : 'Upload logo'}
                  </Button>
                  {values.logo && (
                    <Button variant="ghost" icon={Undo2} onClick={() => update({ logo: null })}>
                      {savedLogo ? 'Keep current logo' : 'Remove'}
                    </Button>
                  )}
                  {!values.logo && savedLogo && !values.remove_logo && (
                    <Button variant="ghost" icon={Trash2} onClick={() => update({ remove_logo: true })}>Remove</Button>
                  )}
                  {values.remove_logo && (
                    <Button variant="ghost" icon={Undo2} onClick={() => update({ remove_logo: false })}>Undo</Button>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Choose logo image"
                  onChange={pickLogo}
                />
              </div>
            </Field>

            <Field label="Business name" htmlFor="biz-name" required error={errors.name}>
              <TextInput
                id="biz-name"
                autoComplete="organization"
                maxLength={150}
                value={values.name}
                error={errors.name}
                placeholder="e.g. Shree Hari Traders"
                onChange={(event) => setField('name', event.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address" htmlFor="biz-address" error={errors.address} className="sm:col-span-2">
              <TextArea
                id="biz-address"
                rows={3}
                autoComplete="street-address"
                value={values.address}
                error={errors.address}
                placeholder="Shop / building, street, area"
                onChange={(event) => setField('address', event.target.value)}
              />
            </Field>
            <Field label="City" htmlFor="biz-city" error={errors.city}>
              <TextInput
                id="biz-city"
                autoComplete="address-level2"
                maxLength={80}
                value={values.city}
                error={errors.city}
                onChange={(event) => setField('city', event.target.value)}
              />
            </Field>
            <Field label="State" htmlFor="biz-state" error={errors.state}>
              <Select
                id="biz-state"
                autoComplete="address-level1"
                options={stateOptions}
                value={values.state}
                error={errors.state}
                onChange={(event) => setField('state', event.target.value)}
              />
            </Field>
            <Field label="Pincode" htmlFor="biz-pincode" error={errors.pincode}>
              <TextInput
                id="biz-pincode"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                value={values.pincode}
                error={errors.pincode}
                placeholder="6 digits"
                onChange={(event) => setField('pincode', event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Contact & GST">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile" htmlFor="biz-phone" error={errors.phone}>
              <TextInput
                id="biz-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                value={values.phone}
                error={errors.phone}
                placeholder="98765 43210"
                onChange={(event) => setField('phone', event.target.value)}
              />
            </Field>
            <Field label="Email" htmlFor="biz-email" error={errors.email}>
              <TextInput
                id="biz-email"
                type="email"
                autoComplete="email"
                value={values.email}
                error={errors.email}
                onChange={(event) => setField('email', event.target.value)}
              />
            </Field>
            <Field
              label="GST Number (GSTIN)"
              htmlFor="biz-gstin"
              error={errors.gstin}
              hint="15 characters, e.g. 24ABCDE1234F1Z5. Leave empty if you are not GST registered."
              className="sm:col-span-2"
              labelRight={<span className="num text-xs text-ink-3">{values.gstin.length}/15</span>}
            >
              <TextInput
                id="biz-gstin"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={15}
                value={values.gstin}
                error={errors.gstin}
                className="uppercase"
                onChange={(event) => setField('gstin', event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15))}
              />
            </Field>
          </div>
        </FormSection>
      </form>

      <BillHeaderPreview values={values} logoSrc={logoSrc} />
    </SettingsPage>
  )
}
