/**
 * Printable invoice / receipt rendered from the backend "document" JSON
 * (GET /api/sales/:id/document/, /api/payments-in/:id/document/, public share page).
 * Always paper-coloured (ignores dark mode). Uses container queries, so the same
 * markup gives a full A4/A5 layout when wide and a compact receipt layout when
 * narrow (thermal paper or a phone screen).
 */

export const PAPER = {
  a4: { label: 'A4', widthMm: 190, pageCss: 'A4 portrait', margin: '10mm', fontPx: 13 },
  a5: { label: 'A5', widthMm: 128, pageCss: 'A5 portrait', margin: '10mm', fontPx: 11.5 },
  thermal80: { label: 'Thermal 80mm', widthMm: 72, thermal: true, paperMm: 80, fontPx: 11 },
  thermal58: { label: 'Thermal 58mm', widthMm: 48, thermal: true, paperMm: 58, fontPx: 10 },
}

const STATUS_STYLE = {
  paid: 'bg-[#dcfce7] text-[#15803d]',
  partial: 'bg-[#fef3c7] text-[#b45309]',
  unpaid: 'bg-[#fee2e2] text-[#b91c1c]',
}

function Lines({ text, className = '' }) {
  if (!text) return null
  return <p className={`whitespace-pre-line ${className}`}>{text}</p>
}

function BusinessHeader({ doc, compact }) {
  const b = doc.business || {}
  const contact = [b.phone && `Ph: ${b.phone}`, b.email].filter(Boolean).join(' · ')
  return (
    <div className={`flex gap-3 ${compact ? 'flex-col items-center text-center' : 'items-start @lg:flex-row'}`}>
      {b.logo_url && (
        <img src={b.logo_url} alt="" className={`${compact ? 'h-12' : 'h-14'} w-auto max-w-[30%] object-contain`} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[1.45em] font-bold leading-tight text-[#0f172a]">{b.name}</p>
        <Lines text={b.address} className="mt-0.5 text-[0.9em] leading-snug text-[#475569]" />
        {contact && <p className="text-[0.9em] text-[#475569]">{contact}</p>}
        {b.gstin && <p className="text-[0.9em] font-medium text-[#334155]">GSTIN: {b.gstin}</p>}
      </div>
    </div>
  )
}

function Meta({ meta, compact }) {
  return (
    <dl className={compact ? 'space-y-0.5' : 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'}>
      {meta.map((row) => (
        compact ? (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-[#64748b]">{row.label}</dt>
            <dd className="text-right font-medium text-[#0f172a]">{row.value}</dd>
          </div>
        ) : (
          <div key={row.label} className="contents">
            <dt className="text-[#64748b]">{row.label}</dt>
            <dd className="text-right font-semibold text-[#0f172a]">{row.value}</dd>
          </div>
        )
      ))}
    </dl>
  )
}

function PartyBlock({ doc }) {
  const p = doc.party || {}
  if (!p.name && !p.phone && !p.address) return null
  return (
    <div className="min-w-0">
      <p className="text-[0.78em] font-semibold uppercase tracking-wider text-[#64748b]">{doc.party_label}</p>
      <p className="mt-0.5 text-[1.1em] font-semibold text-[#0f172a]">{p.name}</p>
      {p.phone && <p className="text-[#475569]">Ph: {p.phone}</p>}
      <Lines text={p.address} className="leading-snug text-[#475569]" />
      {p.gstin && <p className="text-[#475569]">GSTIN: {p.gstin}</p>}
    </div>
  )
}

function Signature({ doc }) {
  if (!doc.show_signature) return null
  return (
    <div className="ml-auto mt-8 w-48 text-center text-[0.9em] text-[#475569]">
      <p>For {doc.business?.name}</p>
      <div className="mt-10 border-t border-[#94a3b8] pt-1">Authorised Signatory</div>
    </div>
  )
}

function ItemsTable({ doc }) {
  const cols = doc.columns || {}
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="bg-[#eff6ff] text-[0.8em] uppercase tracking-wide text-[#1e3a8a]">
          <th className="w-8 px-2 py-2 font-semibold">#</th>
          <th className="px-2 py-2 font-semibold">Item</th>
          {cols.hsn && <th className="px-2 py-2 font-semibold">HSN</th>}
          <th className="px-2 py-2 text-right font-semibold">Qty</th>
          <th className="px-2 py-2 text-right font-semibold">Rate</th>
          {cols.discount && <th className="px-2 py-2 text-right font-semibold">Disc.</th>}
          {cols.tax && <th className="px-2 py-2 text-right font-semibold">Tax</th>}
          <th className="px-2 py-2 text-right font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {doc.items.map((item) => (
          <tr key={item.sno} className="border-b border-[#e2e8f0] align-top">
            <td className="px-2 py-2 text-[#64748b]">{item.sno}</td>
            <td className="px-2 py-2">
              <p className="font-medium text-[#0f172a]">{item.name}</p>
              {item.description && <p className="text-[0.85em] text-[#64748b]">{item.description}</p>}
            </td>
            {cols.hsn && <td className="px-2 py-2 text-[#475569]">{item.hsn}</td>}
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{item.qty} {item.unit}</td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{item.rate}</td>
            {cols.discount && (
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                {item.discount || '—'}
                {item.discount_label && <span className="block text-[0.8em] text-[#64748b]">{item.discount_label}</span>}
              </td>
            )}
            {cols.tax && (
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                {item.tax || '—'}
                {item.tax_label && <span className="block text-[0.8em] text-[#64748b]">{item.tax_label}</span>}
              </td>
            )}
            <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-[#0f172a]">{item.amount}</td>
          </tr>
        ))}
        <tr className="text-[0.9em] text-[#475569]">
          <td />
          <td className="px-2 py-1.5">Total quantity</td>
          {cols.hsn && <td />}
          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{doc.total_qty}</td>
          <td colSpan={1 + (cols.discount ? 1 : 0) + (cols.tax ? 1 : 0) + 1} />
        </tr>
      </tbody>
    </table>
  )
}

function CompactItems({ doc }) {
  return (
    <div className="divide-y divide-dashed divide-[#cbd5e1]">
      {doc.items.map((item) => (
        <div key={item.sno} className="py-1.5">
          <p className="font-medium text-[#0f172a]">{item.name}</p>
          <div className="flex justify-between gap-2 text-[#475569]">
            <span className="tabular-nums">{item.qty} {item.unit} × {item.rate}</span>
            <span className="font-semibold tabular-nums text-[#0f172a]">{item.amount}</span>
          </div>
          {(item.discount || item.tax) && (
            <p className="text-[0.85em] text-[#64748b]">
              {item.discount && `Disc ${item.discount_label || ''} −${item.discount}`}
              {item.discount && item.tax && ' · '}
              {item.tax && `Tax ${item.tax_label} ${item.tax}`}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function Totals({ doc }) {
  return (
    <div className="space-y-1">
      {doc.summary.map((row) => (
        <div key={row.label} className="flex justify-between gap-4 text-[#475569]">
          <span>{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 rounded-md bg-[#1d4ed8] px-2.5 py-1.5 text-[1.15em] font-bold text-white">
        <span>Total</span>
        <span className="tabular-nums">{doc.total}</span>
      </div>
      <div className="flex justify-between gap-4 px-0.5 text-[#15803d]">
        <span>{doc.paid_label}</span>
        <span className="font-semibold tabular-nums">{doc.paid}</span>
      </div>
      <div className="flex justify-between gap-4 px-0.5 text-[1.05em] font-bold text-[#0f172a]">
        <span>{doc.balance_label}</span>
        <span className="tabular-nums">{doc.balance}</span>
      </div>
      {doc.party_balances?.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-[#e2e8f0] pt-2">
          {doc.party_balances.map((row, index) => (index === doc.party_balances.length - 1 ? (
            // The party's total to collect is the line to look at, so it is the red one.
            <div key={row.label} className={`flex justify-between gap-4 rounded-md bg-[#f8fafc] px-2.5 py-1.5 text-[1.05em] font-bold ${/[1-9]/.test(row.value) ? 'text-[#b91c1c]' : 'text-[#0f172a]'}`}>
              <span>{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </div>
          ) : (
            <div key={row.label} className="flex justify-between gap-4 px-0.5 text-[#475569]">
              <span>{row.label}</span>
              <span className="font-semibold tabular-nums text-[#0f172a]">{row.value}</span>
            </div>
          )))}
        </div>
      )}
    </div>
  )
}

function ExtraInfo({ doc }) {
  return (
    <div className="space-y-3 text-[0.92em]">
      {doc.amount_in_words && (
        <div>
          <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Amount in words</p>
          <p className="font-medium text-[#0f172a]">{doc.amount_in_words}</p>
        </div>
      )}
      {doc.payments?.length > 0 && (
        <div>
          <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Payments</p>
          {doc.payments.map((payment) => (
            <p key={payment.number} className="text-[#334155]">
              {payment.date} · {payment.number} · {payment.mode} · <span className="font-semibold tabular-nums">{payment.amount}</span>
            </p>
          ))}
        </div>
      )}
      {doc.tax_summary?.length > 0 && (
        <div>
          <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Tax summary</p>
          {doc.tax_summary.map((row) => (
            <p key={row.rate} className="text-[#334155]">{row.rate}: taxable {row.taxable}, tax {row.tax}</p>
          ))}
        </div>
      )}
      {doc.bank && (
        <div>
          <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Bank details</p>
          <p className="text-[#334155]">
            {[doc.bank.bank_name, doc.bank.account_name && `A/c name: ${doc.bank.account_name}`, doc.bank.account_number && `A/c no: ${doc.bank.account_number}`, doc.bank.ifsc && `IFSC: ${doc.bank.ifsc}`, doc.bank.branch, doc.bank.upi_id && `UPI: ${doc.bank.upi_id}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}
      {doc.notes && (
        <div>
          <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Description / Notes</p>
          <Lines text={doc.notes} className="text-[#334155]" />
        </div>
      )}
      {doc.terms && (
        <div>
          <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Terms &amp; Conditions</p>
          <Lines text={doc.terms} className="text-[#334155]" />
        </div>
      )}
    </div>
  )
}

export function InvoiceDocument({ doc, format = 'a4', className = '' }) {
  const paper = PAPER[format] || PAPER.a4
  const status = STATUS_STYLE[doc.status] || STATUS_STYLE.unpaid
  return (
    <div className={`@container bg-white text-[#0f172a] ${className}`} style={{ fontSize: `${paper.fontPx}px`, lineHeight: 1.45 }}>
      {/* compact (thermal / narrow screens) */}
      <div className="space-y-2.5 @lg:hidden">
        <BusinessHeader doc={doc} compact />
        <div className="border-t border-dashed border-[#94a3b8] pt-2 text-center">
          <p className="text-[1.1em] font-bold tracking-wide">{doc.title}</p>
          <span className={`mt-0.5 inline-block rounded px-2 py-0.5 text-[0.8em] font-bold ${status}`}>{doc.status_label}</span>
        </div>
        <Meta meta={doc.meta} compact />
        <div className="border-t border-dashed border-[#94a3b8] pt-2"><PartyBlock doc={doc} /></div>
        {doc.items.length > 0 && <div className="border-t border-dashed border-[#94a3b8]"><CompactItems doc={doc} /></div>}
        <div className="border-t border-dashed border-[#94a3b8] pt-2"><Totals doc={doc} /></div>
        <div className="border-t border-dashed border-[#94a3b8] pt-2"><ExtraInfo doc={doc} /></div>
        {doc.footer_note && <p className="border-t border-dashed border-[#94a3b8] pt-2 text-center font-medium">{doc.footer_note}</p>}
      </div>

      {/* full (A4 / A5 / wide screens) */}
      <div className="hidden space-y-5 @lg:block">
        <div className="flex items-start justify-between gap-6 border-b-2 border-[#1d4ed8] pb-4">
          <BusinessHeader doc={doc} />
          <div className="shrink-0 text-right">
            <p className="text-[1.6em] font-bold tracking-wide text-[#1d4ed8]">{doc.title}</p>
            <span className={`mt-1 inline-block rounded-md px-2.5 py-0.5 text-[0.85em] font-bold ${status}`}>{doc.status_label}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <PartyBlock doc={doc} />
          <div className="justify-self-end"><Meta meta={doc.meta} /></div>
        </div>
        {doc.items.length > 0 && <ItemsTable doc={doc} />}
        <div className="grid grid-cols-[1fr_minmax(0,17rem)] gap-8">
          <ExtraInfo doc={doc} />
          <div>
            <Totals doc={doc} />
            <Signature doc={doc} />
          </div>
        </div>
        {doc.footer_note && <p className="border-t border-[#e2e8f0] pt-3 text-center font-medium text-[#475569]">{doc.footer_note}</p>}
      </div>
    </div>
  )
}

export function ReceiptDocument({ doc, format = 'a4', className = '' }) {
  const paper = PAPER[format] || PAPER.a4
  const isIn = doc.doc_type === 'payment_in'
  const amountBlock = (
    <div className={`rounded-lg px-4 py-3 text-center ${isIn ? 'bg-[#dcfce7]' : 'bg-[#fee2e2]'}`}>
      <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#475569]">{isIn ? 'Amount received' : 'Amount paid'}</p>
      <p className={`text-[1.9em] font-bold tabular-nums ${isIn ? 'text-[#15803d]' : 'text-[#b91c1c]'}`}>{doc.amount}</p>
      {doc.amount_in_words && <p className="text-[0.9em] text-[#334155]">{doc.amount_in_words}</p>}
    </div>
  )
  const allocations = doc.allocations?.length > 0 && (
    <div>
      <p className="mb-1 text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Payment applied to</p>
      <div className="divide-y divide-[#e2e8f0] rounded-lg border border-[#e2e8f0]">
        {doc.allocations.map((row) => (
          <div key={row.number} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span><span className="font-medium">{row.number}</span> <span className="text-[#64748b]">· {row.date} · Bill {row.bill_total}</span></span>
            <span className="font-semibold tabular-nums">{row.amount}</span>
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div className={`@container bg-white text-[#0f172a] ${className}`} style={{ fontSize: `${paper.fontPx}px`, lineHeight: 1.45 }}>
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 border-b-2 border-[#1d4ed8] pb-3 text-center @lg:flex-row @lg:items-start @lg:justify-between @lg:text-left">
          <BusinessHeader doc={doc} compact={false} />
          <p className="shrink-0 text-[1.4em] font-bold tracking-wide text-[#1d4ed8]">{doc.title}</p>
        </div>
        <div className="grid gap-4 @lg:grid-cols-2">
          <PartyBlock doc={doc} />
          <div className="@lg:justify-self-end"><Meta meta={doc.meta} compact /></div>
        </div>
        {amountBlock}
        {allocations}
        {doc.unallocated && (
          <p className="flex justify-between text-[#475569]"><span>{doc.unallocated_label}</span><span className="font-semibold tabular-nums">{doc.unallocated}</span></p>
        )}
        {doc.party_balance && (
          <p className="flex justify-between text-[#475569]"><span>{doc.party_balance_label}</span><span className="font-semibold tabular-nums">{doc.party_balance}</span></p>
        )}
        {doc.notes && (
          <div>
            <p className="text-[0.85em] font-semibold uppercase tracking-wider text-[#64748b]">Notes</p>
            <Lines text={doc.notes} className="text-[#334155]" />
          </div>
        )}
        <Signature doc={doc} />
        {doc.footer_note && <p className="border-t border-[#e2e8f0] pt-3 text-center font-medium text-[#475569]">{doc.footer_note}</p>}
      </div>
    </div>
  )
}

export function DocumentView({ doc, format }) {
  if (!doc) return null
  return doc.doc_type === 'payment_in' || doc.doc_type === 'payment_out'
    ? <ReceiptDocument doc={doc} format={format} />
    : <InvoiceDocument doc={doc} format={format} />
}
