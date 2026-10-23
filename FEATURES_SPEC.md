# ClearBooks — Product Specification

**Single source of truth** for building and extending the app. All features use the ClearBooks design system, full responsiveness, and a simple, fast flow.

---

## Design & UX Principles

- **Clear hierarchy** — Most important numbers (You’ll Get / You’ll Give) on home; primary actions (Take Payment, Add Sale) always reachable.
- **Consistent UI** — Same cards, buttons, inputs, and spacing across pages; light/dark theme support.
- **Mobile-first** — Works on small screens first; bottom bar for main actions; no tiny tap targets.
- **Fast flows** — Few taps to create a bill, take payment, or open a party; search where lists are long.
- **Trust** — Statements, totals, and reports match; optional audit/delete with confirmation.

---

## 1. Contacts (Customer / Party)

| Feature | Description |
|--------|-------------|
| **Customer name** | Required; used on bills and statements. |
| **Mobile number** | Optional; used for WhatsApp share and reminders. |
| **Details** | Expandable or separate section: address, email, GST, etc. |
| **Edit customer** | From party list, party detail view, and from bill. |
| **Remind** | Send reminder (e.g. WhatsApp/SMS) for pending amount. |

---

## 2. Billing (Invoices / Bills)

| # | Feature | Notes |
|---|--------|------|
| 1 | **Bill number** | Unique (Bill 1, Bill 2, … or custom series); auto or manual. |
| 2 | **Line items** | Item from list or free text; quantity, rate, tax. |
| 3 | **Customer** | Name and phone on every bill; optional address. |
| 4 | **Total** | Grand total; support +/− (credits/adjustments). |
| 5 | **Bill rules** | Optional config (e.g. max amount, mandatory fields). |
| 6 | **Notes** | Full detail on bill: notes, terms, line-wise description. |
| 7 | **Payment recording** | Cash, Bank, UPI when recording payment. |
| 8 | **Partial payment** | Take Payment: record partial amount; show remaining due and optional due date. |
| 9 | **Share** | Share via WhatsApp / link / PDF (use customer number when available). |
| 10 | **Print** | Print bill; support system/Bluetooth print where possible. |
| 11 | **Payment photo** | When recording (especially Bank): optional photo (e.g. bank credit screenshot). |
| 12 | **Purchase bills** | Separate type/flow: supplier, amount to pay, purchase items. |

---

## 3. Customer Bill View (Party-wise)

- **Select party** → Show all bills with **Open** and **Edit**.
- **Summary at top** — You’ll Get (receivable) and You’ll Give (payable) for that party.
- **Remind** — Remind this party (pending amount, due date).
- **Edit party** — Edit name, number, address from this view.

---

## 4. Home (Dashboard)

| # | Feature | Implementation |
|---|--------|-----------------|
| 1 | **Company totals** | **You’ll Get** (total to receive) and **You’ll Give** (total to give) clearly at top. |
| 2 | **Monthly sales** | Option to see this month or selected month (e.g. link or small summary). |
| 3 | **Monthly purchases** | Option to see monthly purchases. |
| 4 | **Banks** | Payment methods (Banks/UPI) managed in **Account** → Payment methods: add, edit, remove. No separate Banks page. |
| 5 | **Party list** | Search and list parties; tap → statement/ledger. |
| 6 | **Primary actions** | Sticky bottom bar: **Take Payment**, **Add Sale** (and optional + for more). |

No chart on home by default; charts live in Reports. Keep dashboard simple and scannable.

---

## 5. Reports

| Report | Description |
|--------|-------------|
| **Total Selling** | Total sales by period; summary and detail. |
| **Total Purchase** | Total purchases by period. |
| **Bank Report** | Amount per bank; filter by bank. |
| **Per-day Sales** | Day-wise sales (date + amount). |
| **Party-wise statement** | Per party; **PDF** and **Excel** download. |
| **Bank-wise transactions** | Per bank: transaction count and amount. |

---

## 6. Statement & Ledger

- Show **item name**, **quantity**, **total**, **date**.
- **Delete data** — Option to delete data for a selected period (e.g. 1–2 months) with **confirmation** and audit note where needed.

---

## 7. Optional “Best App” Extras

- **Backup & restore** — Export/import (JSON/Excel).
- **Multi-user / roles** — Admin vs staff (e.g. view-only / limited edit).
- **Due-date reminders** — Auto or manual remind for overdue bills.
- **Charts** — Sales trend, receivables vs payables (e.g. in Reports or optional on dashboard).
- **Global search** — Bills, customers, items by name/number.
- **Dark mode** — Theme toggle (already in design system).
- **Offline / PWA** — Basic view works offline.
- **GST summary** — GST in/out in reports if applicable.
- **Payment link** — e.g. UPI link for customer to pay.
- **Audit log** — Who changed what and when for critical actions.

---

## 8. Tech & Implementation

- **Stack:** React (Vite) frontend, Django REST backend.
- **UI:** ClearBooks design system (Tailwind, CSS variables, light/dark).
- **API:** REST; add models/endpoints as needed (banks, purchase bills, payment photo, reminders).
- **Layout:** Responsive; sidebar on desktop, bottom nav on mobile; sticky action bar on dashboard.

**Outcome:** App delivers full billing, party management, Cash/Bank payments, reports, statements, and optional data delete; plus any chosen extras from §7.

---

*Use this document to drive implementation: same design language, full responsiveness, and the features above.*
