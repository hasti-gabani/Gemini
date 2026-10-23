import { CircleCheck, MessageCircle, MessageSquareText, Share2 } from 'lucide-react'
import { useState } from 'react'

import { reminderMessage, whatsappUrl } from '../../components/RemindDialog.jsx'
import Button from '../../components/ui/Button.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { Badge } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api } from '../../lib/api.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { addMoney, formatMoney } from '../../lib/money.js'
import { openExternal, shareText } from '../../lib/share.js'
import { dueInfo } from './reminderUtils.js'

/**
 * Remind the ticked parties together. The app cannot send WhatsApp or SMS messages by itself, so every
 * party gets their own message (their name, amount and due date, as with Remind) with one tap each.
 * Sending marks the reminder as sent.
 */
export default function BulkRemindDialog({ open, onClose, reminders }) {
  const { t, business, settings } = useSession()
  const { toast } = useUI()
  const invalidate = useInvalidateAll()
  const [sent, setSent] = useState(() => new Set())
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSent(new Set())
  }

  const markSent = async (reminder) => {
    try {
      await api.post(`/reminders/${reminder.id}/mark-sent/`)
      setSent((current) => new Set(current).add(reminder.id))
      invalidate()
    } catch (error) {
      toast.error(error)
    }
  }

  const send = async (reminder, channel) => {
    const phone = reminder.party_phone || ''
    const message = reminderMessage(settings?.reminder_template, business, {
      name: reminder.party_name, amount: reminder.amount, dueDate: reminder.due_date,
    }) || reminder.message
    try {
      if (channel === 'whatsapp') openExternal(whatsappUrl(phone, message))
      else if (channel === 'sms') window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`
      else {
        const result = await shareText({ title: `Payment reminder – ${reminder.party_name}`, text: message })
        if (result === 'cancelled') return
        if (result === 'copied') toast.success('Message copied. Paste it in any app.')
      }
    } catch (error) {
      toast.error(error)
      return
    }
    await markSent(reminder)
  }

  const sentCount = reminders.filter((reminder) => sent.has(reminder.id)).length
  const allSent = reminders.length > 0 && sentCount === reminders.length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('remind_parties')}
      subtitle={`${reminders.length} part${reminders.length === 1 ? 'y' : 'ies'} · ${formatMoney(addMoney(...reminders.map((reminder) => reminder.amount)))}`}
      size="lg"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-sm text-ink-2" role="status">{sentCount} of {reminders.length} sent</p>
          <Button variant={allSent ? 'primary' : 'secondary'} onClick={onClose}>Done</Button>
        </div>
      )}
    >
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-ink-2">{t('bulk_remind_hint')}</p>
      <ul className="mt-2 divide-y divide-line">
        {reminders.map((reminder) => {
          const name = reminder.party_name
          const phone = reminder.party_phone
          const due = dueInfo(reminder.due_date)
          const done = sent.has(reminder.id)
          return (
            <li key={reminder.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 break-words font-medium text-ink">{name}</p>
                  <p className="break-words text-sm text-ink-3">
                    {phone || 'No mobile number'} · <span className={due.tone}>{due.label}</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num font-semibold text-neg">{formatMoney(reminder.amount)}</span>
                  {done && <Badge tone="pos"><CircleCheck className="size-3.5" aria-hidden />Sent</Badge>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <Button
                  size="tile"
                  variant="ghost"
                  icon={Share2}
                  onClick={() => send(reminder, 'share')}
                  aria-label={`Other apps: ${name}`}
                  title="Other apps"
                />
                <Button size="tile" variant="secondary" icon={MessageSquareText} disabled={!phone} onClick={() => send(reminder, 'sms')}>
                  SMS
                </Button>
                <Button size="tile" variant={done ? 'success-soft' : 'success'} icon={MessageCircle} onClick={() => send(reminder, 'whatsapp')}>
                  WhatsApp
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
