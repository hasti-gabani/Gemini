import {
  BellRing, CircleUser, Hash, Landmark, MessageCircle, Palette, Printer, Ruler, ScrollText, Store, Trash2, Wallet,
} from 'lucide-react'

/**
 * Settings navigation. `titleKey` / `groupKey` use an i18n label when one exists,
 * otherwise the plain English title is shown. Items with `to` link outside Settings.
 */
export const SETTINGS_GROUPS = [
  {
    key: 'business',
    titleKey: 'business',
    title: 'Business',
    items: [
      { id: 'profile', title: 'Business Profile', description: 'Name, logo, address and GST number', icon: Store },
      { id: 'invoice', title: 'Invoice & Print', description: 'Bill title, paper size and what prints on bills', icon: Printer },
      { id: 'numbering', title: 'Bill Number Format', description: 'Prefix and starting number for bills and receipts', icon: Hash },
      { id: 'terms', titleKey: 'terms', title: 'Terms & Conditions', description: 'Default terms and notes for new bills', icon: ScrollText },
    ],
  },
  {
    key: 'payments',
    title: 'Payments',
    items: [
      { id: 'payment', title: 'Payment Settings', description: 'Default payment mode: cash or bank', icon: Wallet },
      { id: 'units', title: 'Units', description: 'Units for items such as PCS, KG and BOX', icon: Ruler },
      { id: 'bank', title: 'Bank Accounts', description: 'Cash and bank accounts, UPI and bank details on bills', icon: Landmark, to: '/bank' },
    ],
  },
  {
    key: 'reminders',
    titleKey: 'reminders',
    title: 'Reminders',
    items: [
      { id: 'reminders', titleKey: 'payment_reminders', title: 'Payment Reminders', description: 'Reminder message and when due payments show up', icon: BellRing },
    ],
  },
  {
    key: 'app',
    title: 'App',
    items: [
      { id: 'whatsapp', title: 'WhatsApp', description: 'Link your WhatsApp to send bill PDFs straight to the party', icon: MessageCircle },
      { id: 'appearance', title: 'Appearance & Language', description: 'Light or dark theme and app language', icon: Palette },
      { id: 'account', title: 'My Account', description: 'Your name, mobile, password and log out', icon: CircleUser },
    ],
  },
  {
    key: 'data',
    title: 'Data',
    items: [
      { id: 'data', title: 'Data Delete', description: 'Delete old data and recalculate balances', icon: Trash2, tone: 'neg' },
    ],
  },
]

export const SETTINGS_SECTIONS = Object.fromEntries(
  SETTINGS_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item])),
)

export function labelOf(entry, t) {
  return entry.titleKey ? t(entry.titleKey) : entry.title
}
