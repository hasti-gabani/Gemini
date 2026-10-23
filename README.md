# Gemini – Billing, Payments & Accounts

A complete business accounting web app for small Indian businesses: sale & purchase bills, partial payments,
customer/supplier ledgers, cash & bank accounts, inventory, reminders and reports — in English and ગુજરાતી.
It works on Android, iPhone, tablets and desktops (installable as an app from the browser).

## Features

| Module | What you can do |
|---|---|
| **Dashboard** | મારે લેવાના / મારે આપવાના totals, today's and monthly sales & purchases, cash & bank balance, Sales vs Purchase chart (today / week / month / last month / custom), payment reminders, low stock, recent transactions, Take Payment / Pay Out / New Sale buttons |
| **Customers & suppliers** | Full party details, opening balance (receivable/payable), search by name / mobile / bill number, receivable / payable / zero filters, profile with Transactions (bills and payments together, newest first), Statement and Details. No customer/supplier type to choose: a new party is a customer and becomes a supplier too as soon as you buy from them |
| **Sales & purchases** | Auto bill numbers (`Bil.1`, `PUR-1` – prefixes configurable), items with qty and rate, bill discount, extra charges, round-off, notes, terms, photos/PDFs, edit / delete with automatic recalculation. **Received / Paid** is ticked with the full amount; change it for a part payment or untick it for a credit bill (cash or credit is decided automatically). Older bills keep their item discount and GST |
| **Payment In / Out** | Receipts & vouchers against one or many bills (oldest first or chosen), any extra amount is kept as advance, cash or any bank account, reference no., payment screenshots (JPG / PNG / WEBP / PDF) |
| **Ledger / statement** | Date, type, bill no., item names, quantity, debit, credit, running balance with opening & closing balance — PDF, Excel, print, share |
| **Cash & bank** | Multiple bank accounts (add / edit / delete with transaction move), transactions with running balance and filters, deposits, withdrawals and transfers |
| **Items & stock** | Categories, units, prices, HSN, opening stock, low-stock alerts, stock history, stock adjustments — stock updates automatically from bills |
| **Reports** | 18 reports, starting with the **Day Book (રોજમેળ)**: every rupee that came in or went out on a day. Also sales, purchases, payments, bank, cash, daily, monthly, party-wise, item-wise, receivables, payables, bank transactions and stock. Summary cards, cards on phones, tables on desktop, PDF and Excel export |
| **Sharing & printing** | Invoice / receipt PDF (A4, A5, thermal 80 mm & 58 mm), browser print with print preview, Bluetooth thermal printing (Chrome/Edge), WhatsApp / SMS / any app sharing, secure public bill links |
| **Reminders** | Payment reminders with due dates, editable bilingual message template, WhatsApp / SMS / share, dashboard alerts |
| **Settings & data** | Business profile & logo, invoice layout, numbering, terms, units, theme (light/dark), language, automatic daily backup (kept 30 days, optionally copied to a Google Drive folder), full ZIP backup & restore, Excel export of all data, delete data older than 1–12 months with exact counts and balance carry-forward |
| **Security** | Account locked for 15 minutes after 5 wrong passwords, automatic sign-out after 60 minutes without use (and 12 hours after signing in), no public sign-up, HTTPS / secure cookies / HSTS / Content-Security-Policy / clickjacking protection when online, upload type and size checks, unguessable bill links |

All balances (party, cash, bank, stock, bill status, ledger, reports) are derived from the bills and payments, so
creating, editing or deleting any record keeps every number consistent.

## Quick start (Windows, macOS, Linux)

Requirements: **Python 3.11+** and **Node.js 20+**.

```bash
python scripts/runner.py install     # one time: packages + database
python scripts/runner.py demo        # optional: sample business  (login: demo / demo1234)
python scripts/runner.py start       # development: http://localhost:3100
```

On Windows you can also run `.\install.ps1`; with Git Bash / WSL / macOS / Linux `make install`, `make start` …

| Command (`python scripts/runner.py …`) | Purpose |
|---|---|
| `install` | Create `backend/venv`, install Python & npm packages, migrate the database |
| `demo [--reset]` | Create (or recreate) the demo business |
| `start` / `stop` / `restart` / `status` / `logs` | Development servers in the background (API on 8100, app on 3100 with live reload) |
| `build` | Build the production web app into `frontend/dist` |
| `serve [--port 8100]` | Production server: app + API on one port (waitress on Windows, gunicorn elsewhere) |
| `online-env <domain>` | Write the settings for running on the internet over HTTPS into `.env` (see below) |
| `test` | Backend test suite + bill-calculation parity and thermal-printer tests |

### Using it on your phone
Run `serve` (or `start`) on a PC and open the printed Wi-Fi address (e.g. `http://192.168.1.20:8100`) on the phone.
Use the browser menu → **Add to Home screen** to install it like an app.

### Production notes
- Copy `.env.example` to `.env` and review it: keep `DEBUG=False` and set `ALLOWED_HOSTS`. Bluetooth printing on
  phones requires HTTPS.
- Shared bill links (WhatsApp/SMS) must be reachable by your customers: host the app on a public address and set
  `PUBLIC_BASE_URL` (e.g. `https://billing.example.com`). Sharing the PDF file itself works without this.
- SQLite is the default; set `DATABASE_URL` for PostgreSQL. Uploaded files live in `backend/media`.
- Nobody can sign up from the login page (`ALLOW_REGISTRATION=False`). To create the first business on a new server,
  set `ALLOW_REGISTRATION=True`, restart, sign up, then set it back to `False` and restart again.
- Sign-in: 5 wrong passwords lock that user for 15 minutes; a user is signed out after 60 minutes without using the
  app and 12 hours after signing in (`LOGIN_*`, `SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS` in `.env`).
- The Django admin is switched off. To use it, set `ADMIN_URL` to a hard-to-guess path (e.g. `manage-7f3k9q/`).
- `python scripts/runner.py serve` rebuilds the web app automatically when files in `frontend/` changed since the
  last build.

### Putting the app online (internet)
1. Get a domain name (e.g. `billing.example.com`) pointing at your server or PC.
2. Run `python scripts/runner.py online-env billing.example.com`. It writes `.env` with `DEBUG=False`, a random
   `SECRET_KEY` (an existing one is kept), `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `PUBLIC_BASE_URL`, `USE_HTTPS=True`
   and `USE_X_FORWARDED_FOR=True`. Keep `.env` private: it is never committed to git.
3. Put an HTTPS reverse proxy in front of `python scripts/runner.py serve` (Caddy is the simplest:
   `billing.example.com { reverse_proxy 127.0.0.1:8100 }` gets and renews the certificate by itself; nginx or a
   Cloudflare Tunnel work too). The proxy must send `X-Forwarded-Proto` and `X-Forwarded-For`.
4. With `USE_HTTPS=True` the app redirects HTTP to HTTPS and sends HSTS (1 year), secure cookies,
   Content-Security-Policy and clickjacking protection. Inside `backend/`, `venv/Scripts/python manage.py check
   --deploy` (`venv/bin/python` on macOS / Linux) should report no issues.
5. Only open ports 80 and 443 to the internet — never 8100 directly.
6. After updating the app, run `python scripts/runner.py install` (or `manage.py migrate`) before starting it.

### Backups
- **Automatic daily backup:** while the app is running, a full backup of each business (all data plus bill photos
  and payment proofs) is saved once a day in `backend/media/backups/business_<id>/` and kept for 30 days
  (`AUTO_BACKUP_KEEP_DAYS`). **Settings → Backup & Restore** shows the last backup, has **Back up now**, and lists the
  saved backups with Download and Restore. Only the signed-in owner can download them; there is no public link.
- **Copy to Google Drive:** install [Google Drive for desktop](https://www.google.com/drive/download/) and sign in.
  It adds a drive such as `G:\My Drive`. In **Settings → Backup & Restore → Also copy each backup to a folder**, enter
  `G:\My Drive\Gemini Backups` (the page suggests it when Drive is installed) and press **Save folder**. Every daily
  backup is then copied there as well, and Google Drive uploads it. If the folder is missing (Drive not running or
  signed out), the backup is still saved on the computer and the page shows a warning.
- If the app is not always running, schedule `venv/Scripts/python manage.py backup_now` inside `backend/` (Windows
  Task Scheduler, or cron with `venv/bin/python`).
- The server also saves a safety backup before every restore, old-data delete or reset (latest 5 per business);
  restore one from the same page to undo the change. Now and then download a backup and keep it on a pen drive too.

## Architecture

```
backend/   Django 5.2 + Django REST Framework (session auth + CSRF, same origin as the web app)
  accounts/      users, business profile, settings, auth, numbering endpoint
  parties/       customers & suppliers, statements, reminders
  inventory/     items, categories, stock adjustments & history
  banking/       cash & bank accounts, transfers, account statements
  transactions/  sales, purchases, payments, allocations, attachments, invoice documents, share links
  ledger/        posting engine (ledger entries, bank transactions) and balance recalculation
  reports/       dashboard, chart, global search, report builders
  datamgmt/      backup/restore, Excel export, old-data cleanup, reset
  core/          money & date helpers, PDF (ReportLab + HarfBuzz for Gujarati) and Excel rendering
frontend/  React 19 + Vite + Tailwind CSS 4 + TanStack Query (see docs/FRONTEND_GUIDE.md)
```

Money is stored as decimals and never as floating point; the browser uses the same rounding rules as the server
(`frontend/src/lib/billCalc.js` is verified against `backend/transactions/calc.py` by `npm run test:calc`).

In development Django serves the API on port 8100 and Vite serves the app on port 3100 (proxying `/api`).
In production Django serves both the built app and the API from one port.

## Tests

```bash
python scripts/runner.py test
```
- `backend/transactions/tests.py` – end-to-end API workflow: sale → partial bank payment with screenshot → take
  remaining payment → bill paid & balance zero; edits, deletes, validation, purchases, bank transfers, cleanup with
  carry-forward, backup/restore, safety backups, business isolation, share links, every report.
- `backend/accounts/tests.py` – sign-in lockout, automatic sign-out, closed sign-up, security headers.
- `backend/datamgmt/tests.py` – daily backup (once a day, 30 days kept), copy to a folder with a warning when it is
  missing, restoring a saved backup, owner-only access.
- `backend/core/test_render.py` – PDF and Excel rendering (all formats, Gujarati text, large reports).
- `frontend/scripts/billCalc.test.mjs` – 3,000 bill calculations must match the server exactly.
- `frontend/scripts/thermalPrint.test.mjs` – ESC/POS raster encoding and receipt layout.

The previous version of the app is archived in `_legacy/`.
