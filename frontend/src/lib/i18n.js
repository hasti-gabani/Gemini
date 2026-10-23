/**
 * English / Gujarati labels. `t(key)` returns the label in the selected language
 * and falls back to English. `gu(key)` always returns the Gujarati label so
 * important figures can be shown bilingually (e.g. "Total Receivable · મારે લેવાના").
 */
const D = {
  // navigation
  dashboard: ['Dashboard', 'ડેશબોર્ડ'],
  home: ['Home', 'હોમ'],
  parties: ['Parties', 'પાર્ટી'],
  items: ['Items', 'વસ્તુઓ'],
  sales: ['Sales', 'વેચાણ'],
  purchase: ['Purchase', 'ખરીદી'],
  purchases: ['Purchases', 'ખરીદી'],
  payment_in: ['Payment In', 'પેમેન્ટ ઇન'],
  payment_out: ['Payment Out', 'પેમેન્ટ આઉટ'],
  payments: ['Payments', 'પેમેન્ટ'],
  bank: ['Bank', 'બેંક'],
  cash_bank: ['Bank', 'બેંક'],
  reports: ['Reports', 'રિપોર્ટ'],
  reminders: ['Reminders', 'રિમાઇન્ડર'],
  settings: ['Settings', 'સેટિંગ્સ'],
  more: ['More', 'વધુ'],

  // dashboard figures
  receivable: ['Total Receivable', 'મારે લેવાના'],
  payable: ['Total Payable', 'મારે આપવાના'],
  you_will_get: ["You'll Get", 'મારે લેવાના'],
  you_will_give: ["You'll Give", 'મારે આપવાના'],
  today_sale: ["Today's Sale", 'આજનું વેચાણ'],
  today_purchase: ["Today's Purchase", 'આજની ખરીદી'],
  month_sale: ['Monthly Sales', 'માસિક વેચાણ'],
  month_purchase: ['Monthly Purchase', 'માસિક ખરીદી'],
  cash_balance: ['Cash Balance', 'રોકડ બેલેન્સ'],
  bank_balance: ['Bank Balance', 'બેંક બેલેન્સ'],
  total_sales: ['Total Sales', 'કુલ વેચાણ'],
  total_purchase: ['Total Purchase', 'કુલ ખરીદી'],
  payment_received: ['Payment Received', 'ચુકવણી મળી'],
  payment_paid: ['Payment Paid', 'ચુકવણી કરી'],
  payment_pending: ['Payment Pending', 'ચુકવણી બાકી'],
  sales_vs_purchase: ['Sales vs Purchase', 'વેચાણ વિરુદ્ધ ખરીદી'],
  quick_actions: ['Quick Actions', 'ઝડપી કાર્ય'],
  payment_reminders: ['Payment Reminders', 'પેમેન્ટ રિમાઇન્ડર'],
  recent_transactions: ['Recent Transactions', 'તાજેતરના વ્યવહાર'],
  low_stock: ['Low Stock', 'ઓછો સ્ટોક'],

  // actions
  new_sale: ['New Sale', 'નવું વેચાણ'],
  add_sale: ['Add Sale', 'વેચાણ ઉમેરો'],
  new_purchase: ['New Purchase', 'નવી ખરીદી'],
  take_payment: ['Take Payment', 'પેમેન્ટ લો'],
  pay_out: ['Pay Out', 'પેમેન્ટ આપો'],
  make_payment: ['Make Payment', 'પેમેન્ટ કરો'],
  add_party: ['Add Party', 'પાર્ટી ઉમેરો'],
  add_item: ['Add Item', 'વસ્તુ ઉમેરો'],
  add_items: ['Add Items', 'વસ્તુઓ ઉમેરો'],
  add_bank: ['Add Bank', 'બેંક ઉમેરો'],
  save: ['Save', 'સેવ કરો'],
  save_new: ['Save & New', 'સેવ & નવું'],
  cancel: ['Cancel', 'રદ કરો'],
  close: ['Close', 'બંધ કરો'],
  edit: ['Edit', 'ફેરફાર'],
  delete: ['Delete', 'ડિલીટ'],
  share: ['Share', 'શેર'],
  print: ['Print', 'પ્રિન્ટ'],
  download: ['Download', 'ડાઉનલોડ'],
  open: ['Open', 'ખોલો'],
  view: ['View', 'જુઓ'],
  search: ['Search', 'શોધો'],
  filter: ['Filter', 'ફિલ્ટર'],
  remind: ['Remind', 'યાદ કરાવો'],
  remind_parties: ['Remind Parties', 'પાર્ટીને યાદ કરાવો'],
  bulk_remind_hint: [
    'Each party gets their own message with their amount and due date. Tap WhatsApp or SMS for each one, send it, then come back here for the next.',
    'દરેક પાર્ટીને પોતાની રકમ અને તારીખ સાથે અલગ મેસેજ જશે. દરેક માટે WhatsApp અથવા SMS દબાવો, મેસેજ મોકલો અને પછી આગળના માટે અહીં પાછા આવો.',
  ],
  select_all: ['Select all', 'બધા પસંદ કરો'],
  selected_count: ['{count} selected', '{count} પસંદ કર્યા'],
  load_more: ['Load more', 'વધુ જુઓ'],
  retry: ['Try again', 'ફરી પ્રયાસ કરો'],
  back: ['Back', 'પાછા'],
  logout: ['Log out', 'લોગ આઉટ'],

  // common words
  all: ['All', 'બધા'],
  bill: ['Bill', 'બિલ'],
  bills: ['Bills', 'બિલ'],
  supplier: ['Supplier', 'સપ્લાયર'],
  party: ['Party', 'પાર્ટી'],
  item: ['Item', 'વસ્તુ'],
  report: ['Report', 'રિપોર્ટ'],
  payment: ['Payment', 'પેમેન્ટ'],
  statement: ['Statement', 'સ્ટેટમેન્ટ'],
  ledger: ['Ledger', 'ખાતાવહી'],
  details: ['Details', 'વિગતો'],
  paid: ['Paid', 'ચૂકવેલ'],
  unpaid: ['Unpaid', 'બાકી'],
  partial: ['Partial', 'આંશિક'],
  pending: ['Pending', 'બાકી'],
  overdue: ['Overdue', 'મુદત વીતી'],
  total: ['Total', 'કુલ'],
  total_amount: ['Total Amount', 'કુલ રકમ'],
  received: ['Received', 'મળેલ'],
  balance_due: ['Balance Due', 'બાકી રકમ'],
  party_balance: ['Party Balance', 'પાર્ટી બેલેન્સ'],
  description: ['Description', 'વર્ણન'],
  notes: ['Notes', 'નોંધ'],
  date: ['Date', 'તારીખ'],
  due_date: ['Due Date', 'ચુકવણી તારીખ'],
  amount: ['Amount', 'રકમ'],
  quantity: ['Qty', 'જથ્થો'],
  rate: ['Rate', 'ભાવ'],
  discount: ['Discount', 'ડિસ્કાઉન્ટ'],
  tax: ['Tax', 'ટેક્સ'],
  subtotal: ['Subtotal', 'પેટા સરવાળો'],
  round_off: ['Round Off', 'રાઉન્ડ ઓફ'],
  mobile: ['Mobile', 'મોબાઇલ'],
  address: ['Address', 'સરનામું'],
  cash: ['Cash', 'રોકડ'],
  credit: ['Credit', 'ઉધાર'],
  payment_type: ['Payment Type', 'પેમેન્ટ પ્રકાર'],
  reference_no: ['Reference No.', 'રેફરન્સ નંબર'],
  add_photo: ['Add Photo', 'ફોટો ઉમેરો'],
  stock: ['Stock', 'સ્ટોક'],
  invoice_no: ['Estimate No.', 'એસ્ટીમેટ નંબર'],
  receipt_no: ['Receipt No.', 'રસીદ નંબર'],
  opening_balance: ['Opening Balance', 'શરૂઆતની બાકી'],
  closing_balance: ['Closing Balance', 'અંતિમ બાકી'],
  terms: ['Terms & Conditions', 'નિયમો અને શરતો'],
  bill_notes: ['Bill Description / Notes', 'બિલ વર્ણન / નોંધ'],
  no_data: ['Nothing here yet', 'હજી કંઈ નથી'],
  settled: ['Settled', 'ચૂકતે'],
  today: ['Today', 'આજે'],
  business: ['Business', 'વ્યવસાય'],
}

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'gu', label: 'ગુજરાતી' },
]

export function translate(lang, key, vars) {
  const entry = D[key]
  let text = entry ? (lang === 'gu' ? entry[1] || entry[0] : entry[0]) : key
  if (vars) text = text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`))
  return text
}

export function gujarati(key) {
  return D[key]?.[1] || ''
}

export function english(key) {
  return D[key]?.[0] || key
}
