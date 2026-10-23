import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Download, KeyRound, Smartphone, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from '../../../components/ui/Button.jsx'
import { Field, FormSection, TextInput } from '../../../components/ui/form.jsx'
import { Spinner } from '../../../components/ui/misc.jsx'
import { useUI } from '../../../context/UIContext.jsx'
import { api } from '../../../lib/api.js'
import { deviceSender, setDeviceSender } from '../../../lib/whatsappDevice.js'
import SettingsPage from '../SettingsLayout.jsx'

/**
 * Link WhatsApp numbers once (like WhatsApp Web): each phone by an 8-character code typed into its own
 * WhatsApp (no scanner), or a number by QR code. Then Share → WhatsApp on a bill sends the PDF straight to
 * the party's number, from the WhatsApp chosen on this device, with no contact to choose.
 */
export default function WhatsAppSettings() {
  const { toast, confirm } = useUI()
  const [busy, setBusy] = useState(false)
  const [sender, setSender] = useState(deviceSender)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [linking, setLinking] = useState(null) // id of the number being linked by code on this device
  const status = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get('/whatsapp/status/'),
    refetchInterval: (query) => (query.state.data?.status === 'connected' && !linking ? 15_000 : 3_000),
  })
  const data = status.data
  const state = data?.status
  const accounts = data?.accounts || []
  const linked = accounts.filter((a) => a.status === 'connected' && a.phone)
  const pending = linking ? accounts.find((a) => a.id === linking) : null

  const choose = (number) => {
    setDeviceSender(number)
    setSender(number)
  }

  // The number linked by code on this device becomes this device's sender as soon as it is linked.
  useEffect(() => {
    if (pending?.status === 'connected' && pending.phone) {
      choose(pending.phone)
      setLinking(null)
      setPhone('')
      toast.success(`WhatsApp linked. This device now sends bills from +${pending.phone}.`)
    }
  }, [pending?.status, pending?.phone]) // eslint-disable-line react-hooks/exhaustive-deps

  const getCode = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      setPhoneError('Enter the 10-digit mobile number that has this WhatsApp.')
      return
    }
    setPhoneError('')
    setBusy(true)
    try {
      const result = await api.post('/whatsapp/link/', { phone: digits })
      setLinking(result.id)
      status.refetch()
    } catch (error) {
      setPhoneError(error?.errors?.phone || '')
      if (!error?.errors?.phone) toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (account) => {
    const ok = await confirm({
      title: `Unlink +${account?.phone || 'WhatsApp'}?`,
      message: 'Bills will no longer be sent from this number. You can link it again any time.',
      confirmText: 'Unlink',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.post('/whatsapp/logout/', { id: account?.id })
      if (account?.phone && account.phone === sender) choose('')
      toast.success('WhatsApp unlinked.')
      status.refetch()
    } catch (error) {
      toast.error(error)
    } finally {
      setBusy(false)
    }
  }

  const deviceNumber = linked.find((a) => a.phone === sender)
  const qrAccount = accounts.find((a) => a.id === 'main')

  return (
    <SettingsPage id="whatsapp">
      {state !== 'not_running' && !status.isPending && (
        <FormSection
          title="Linked WhatsApp numbers"
          description="Choose the number this device sends bills from. Each phone can use its own number."
        >
          {linked.length === 0 ? (
            <p className="text-[15px] text-ink-3">No number is linked yet. Link one below.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {linked.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-3 p-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name="whatsapp-sender"
                      className="size-5 accent-[var(--color-brand,#2563eb)]"
                      checked={deviceNumber ? account.phone === sender : account.id === (linked.find((a) => a.id === 'main') || linked[0]).id}
                      onChange={() => choose(account.phone)}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">+{account.phone}</span>
                      <span className="block text-sm text-ink-3">
                        {(deviceNumber ? account.phone === sender : account.id === (linked.find((a) => a.id === 'main') || linked[0]).id)
                          ? 'This device sends from this number'
                          : 'Tap to send from this number on this device'}
                      </span>
                    </span>
                  </label>
                  <Button size="sm" variant="danger-soft" loading={busy} onClick={() => unlink(account)}>Unlink</Button>
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      )}

      <FormSection
        title="Link this phone's WhatsApp (no QR code)"
        description="Do this on each phone that sends bills. Gemini shows a code; type it into that phone's WhatsApp once."
      >
        {state === 'not_running' ? (
          <p className="text-[15px] text-ink-3">Start the WhatsApp service first (see below).</p>
        ) : pending?.status === 'code' && pending.code ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <KeyRound className="size-6 text-brand-ink" aria-hidden />
              <p className="num select-all text-3xl font-bold tracking-[0.2em] text-ink">{pending.code}</p>
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
              <li>On the phone with +{pending.id}, open <strong className="text-ink">WhatsApp</strong>.</li>
              <li>Tap <strong className="text-ink">⋮ (Menu)</strong> → <strong className="text-ink">Linked devices</strong> → <strong className="text-ink">Link a device</strong>.</li>
              <li>Tap <strong className="text-ink">Link with phone number instead</strong> and type the code above.</li>
            </ol>
            <p className="flex items-center gap-2 text-sm text-ink-3"><Spinner className="size-4" /> Waiting for the code to be entered…</p>
          </div>
        ) : linking && (!pending || pending.status === 'starting') ? (
          <p className="flex items-center gap-2 py-4 text-ink-3"><Spinner className="size-5" /> Getting a code from WhatsApp…</p>
        ) : (
          <div className="space-y-3">
            {pending?.status === 'expired' && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink">The code was not entered in time. Get a new code.</p>
            )}
            {pending?.error && <p className="rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg">{pending.error}</p>}
            <Field label="This phone's WhatsApp number" error={phoneError}>
              <TextInput
                type="tel"
                inputMode="tel"
                placeholder="10-digit mobile number"
                value={phone}
                error={phoneError}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Button icon={KeyRound} loading={busy} onClick={getCode}>{pending ? 'Get a new code' : 'Get code'}</Button>
          </div>
        )}
      </FormSection>

      <FormSection
        title="Or link by QR code"
        description="Scan with WhatsApp on any phone. This number is used on devices that have not chosen their own."
      >
        {status.isPending ? (
          <div className="grid h-40 place-items-center"><Spinner className="size-6" /></div>
        ) : state === 'connected' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-pos-soft p-4 text-pos">
              <CheckCircle2 className="size-6 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Linked by QR code</p>
                {data.phone && <p className="text-sm">+{data.phone}</p>}
              </div>
            </div>
            <p className="text-sm text-ink-3">The computer running Gemini must be on and connected to the internet when you send.</p>
            <Button variant="danger-soft" loading={busy} onClick={() => unlink(qrAccount || { id: 'main', phone: data.phone })}>Unlink this number</Button>
          </div>
        ) : state === 'qr' && data.qr ? (
          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <img src={data.qr} alt="WhatsApp link QR code" className="size-64 shrink-0 rounded-xl border border-line bg-white p-2" />
            <ol className="list-decimal space-y-2 pl-5 text-[15px] text-ink-2">
              <li>Open <strong className="text-ink">WhatsApp</strong> on your phone.</li>
              <li>Tap <strong className="text-ink">⋮ (Menu)</strong> → <strong className="text-ink">Linked devices</strong> → <strong className="text-ink">Link a device</strong>.</li>
              <li>Point the phone at this QR code.</li>
              <li className="list-none -ml-5 pt-2 text-sm text-ink-3">The code changes every few seconds; this page updates by itself.</li>
            </ol>
          </div>
        ) : state === 'not_running' ? (
          <div className="flex items-start gap-3 rounded-xl bg-warn-soft p-4 text-ink">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
            <p className="text-[15px]">The WhatsApp service is not running on the computer. Close Gemini and start it again with <strong>Start Gemini.bat</strong>.</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-6 text-ink-3">
            <Spinner className="size-5" />
            <span>Connecting to WhatsApp…</span>
          </div>
        )}
      </FormSection>
      <FormSection
        title="Android app: each phone uses its own WhatsApp"
        description="Install Gemini on Android phones. Share → WhatsApp then opens that phone's WhatsApp straight in the party's chat with the PDF attached. No QR code needed."
      >
        {window.GeminiAndroid ? (
          <p className="flex items-center gap-2 text-[15px] text-pos"><CheckCircle2 className="size-5" aria-hidden /> You are using the Gemini app on this phone.</p>
        ) : (
          <div className="space-y-3">
            <Button href="/gemini.apk" icon={Download} download="Gemini.apk">Get the Android app</Button>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
              <li>On the phone (same Wi-Fi), open Gemini in Chrome and tap <strong>Get the Android app</strong>.</li>
              <li>Open the downloaded <strong>Gemini.apk</strong> and allow installing from Chrome when asked.</li>
              <li>Open the Gemini app and enter the computer&apos;s address shown by <strong>Start Gemini.bat</strong>.</li>
            </ol>
          </div>
        )}
      </FormSection>
      <FormSection title="Good to know">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li><Smartphone className="mr-1 inline size-4 align-[-2px] text-ink-3" aria-hidden />Messages go from your own WhatsApp number, with the bill PDF attached.</li>
          <li>This links like WhatsApp Web. It is not an official WhatsApp service, so send bills only to your own customers. Sending many messages to unknown numbers can get a number blocked by WhatsApp.</li>
        </ul>
      </FormSection>
    </SettingsPage>
  )
}
