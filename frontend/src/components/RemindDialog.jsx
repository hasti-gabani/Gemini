import { useMutation, useQuery } from '@tanstack/react-query'
import { Copy, MessageCircle, MessageSquareText, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useSession } from '../context/SessionContext.jsx'
import { useUI } from '../context/UIContext.jsx'
import { api } from '../lib/api.js'
import { addDays, formatDate, todayISO } from '../lib/dates.js'
import { useInvalidateAll } from '../lib/hooks.js'
import { formatMoney, isPositive } from '../lib/money.js'
import { copyText, openExternal, shareText } from '../lib/share.js'
import Button from './ui/Button.jsx'
import { DateInput, Field, NumberInput, TextArea } from './ui/form.jsx'
import Modal from './ui/Modal.jsx'

export function whatsappUrl(phone, text) {
  let digits = (phone || '').replace(/\D/g, '')
  if (digits.length === 10) digits = `91${digits}`
  else if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

function renderTemplate(template, values) {
  return (template || '').replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match)).trim()
}

/** The reminder text from the template in Settings → Reminders. */
export function reminderMessage(template, business, { name, amount, dueDate }) {
  return renderTemplate(template, {
    name,
    amount: formatMoney(amount || 0, { symbol: '' }),
    due_date: formatDate(dueDate),
    business: business?.name || '',
    phone: business?.phone || '',
  })
}

/**
 * Payment reminder: choose amount + due date, edit the message and send it via
 * WhatsApp / SMS / any app. Sending saves (or updates) a tracked reminder.
 */
export default function RemindDialog({ open, onClose, party, reminder }) {
  const { business, settings } = useSession()
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [adopted, setAdopted] = useState(null)
  const [savedNow, setSavedNow] = useState(false)
  const [initFor, setInitFor] = useState(null)

  const partyName = reminder?.party_name || party?.name || ''
  const phone = reminder?.party_phone ?? party?.phone ?? ''

  // Initialise once per opening (keyed by ids, not object identity: the party is
  // refetched after every save and must not wipe what the user typed).
  const target = open ? `${reminder?.id ?? ''}:${party?.id ?? ''}` : null
  if (target !== initFor) {
    setInitFor(target)
    if (target) {
      setAmount(reminder?.amount || (isPositive(party?.balance) ? party.balance : ''))
      setDueDate(reminder?.due_date || addDays(todayISO(), settings?.reminder_lead_days ?? 3))
      setMessage(reminder?.message || '')
      setEdited(Boolean(reminder?.message))
      setSavedId(reminder?.id || null)
      setAdopted(null)
      setSavedNow(false)
    }
  }

  // Opened for a party (not a specific reminder): reuse their open reminder so
  // reminding again updates it instead of piling up duplicates.
  const openReminder = useQuery({
    queryKey: ['reminders', 'open-for-party', party?.id],
    queryFn: ({ signal }) => api.get('/reminders/', { party: party.id, status: 'pending', page_size: 1 }, { signal }),
    enabled: open && !reminder && Boolean(party?.id),
    select: (data) => data?.results?.[0] || null,
    staleTime: 0,
    gcTime: 0,
  })
  const existing = open && !reminder && openReminder.isSuccess && !openReminder.isFetching ? openReminder.data : null
  if (target && target === initFor && existing && !adopted && !savedId) {
    setAdopted(existing)
    setSavedId(existing.id)
    if (existing.due_date >= todayISO()) setDueDate(existing.due_date)
  }

  const generated = useMemo(
    () => reminderMessage(settings?.reminder_template, business, { name: partyName, amount, dueDate }),
    [settings?.reminder_template, partyName, amount, dueDate, business],
  )

  useEffect(() => {
    if (open && !edited) setMessage(generated)
  }, [generated, edited, open])

  const save = useMutation({
    mutationFn: async ({ markSent }) => {
      const body = { party: reminder?.party || party.id, amount: amount || '0', due_date: dueDate, message }
      const saved = savedId ? await api.patch(`/reminders/${savedId}/`, body) : await api.post('/reminders/', body)
      setSavedId(saved.id)
      setSavedNow(true)
      if (markSent) await api.post(`/reminders/${saved.id}/mark-sent/`)
      return saved
    },
    onSuccess: () => invalidate(),
  })

  const send = async (channel) => {
    if (!dueDate) {
      toast.error('Choose a due date.')
      return
    }
    try {
      if (channel === 'whatsapp') openExternal(whatsappUrl(phone, message))
      else if (channel === 'sms') window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`
      else if (channel === 'share') {
        const result = await shareText({ title: `Payment reminder – ${partyName}`, text: message })
        if (result === 'cancelled') return
        if (result === 'copied') toast.success('Message copied. Paste it in any app.')
      } else if (channel === 'copy') {
        await copyText(message)
        toast.success('Message copied.')
      }
      await save.mutateAsync({ markSent: channel !== 'copy' })
    } catch (error) {
      toast.error(error)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remind party"
      subtitle={partyName}
      size="md"
      footer={(
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button variant="secondary" icon={Copy} onClick={() => send('copy')}>Copy</Button>
          <Button variant="secondary" icon={Share2} onClick={() => send('share')}>Other apps</Button>
          <Button variant="secondary" icon={MessageSquareText} onClick={() => send('sms')} disabled={!phone}>SMS</Button>
          <Button variant="success" icon={MessageCircle} onClick={() => send('whatsapp')}>WhatsApp</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 xs:grid-cols-2">
          <Field label="Pending amount">
            <NumberInput prefix="₹" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Due date">
            <DateInput value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        </div>
        <Field
          label="Reminder message"
          labelRight={edited && (
            <button type="button" className="text-sm font-medium text-brand-ink" onClick={() => setEdited(false)}>Reset</button>
          )}
          hint={phone ? `Will be sent to ${phone}` : 'No mobile number saved for this party — use Other apps or Copy.'}
        >
          <TextArea
            rows={7}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value)
              setEdited(true)
            }}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
          <p className="text-sm text-ink-2">
            {adopted && savedId === adopted.id && !savedNow
              ? `A reminder is already set (due ${formatDate(adopted.due_date)}). Saving or sending updates it.`
              : savedId ? 'Saved — it appears in Payment Reminders.' : 'Save to track this reminder on the dashboard.'}
          </p>
          <Button size="sm" variant="soft" loading={save.isPending} onClick={() => save.mutate({ markSent: false }, {
            onSuccess: () => toast.success('Reminder saved.'),
            onError: (error) => toast.error(error),
          })}
          >
            {savedId ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
