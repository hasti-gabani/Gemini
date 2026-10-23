import { ArrowRightLeft, EllipsisVertical, Eye, Landmark, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { Badge, EmptyState, ErrorState, FitAmount, Menu, Skeleton } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { gujarati } from '../../lib/i18n.js'
import { formatMoney, isNegative } from '../../lib/money.js'
import BankAccountDialog from './BankAccountDialog.jsx'
import { AccountIcon, IconButton, useAccounts } from './shared.jsx'
import TransferDialog from './TransferDialog.jsx'

function BalanceTile({ label, secondary, value, icon: Icon, tone, loading, className = '' }) {
  const negative = isNegative(value)
  const text = formatMoney(value, { decimals: 'auto' })
  return (
    <div className={`card min-w-0 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-snug text-ink-2">{label}</span>
          {secondary && <span className="block truncate text-xs text-ink-3">{secondary}</span>}
        </span>
        <span className={`hidden size-9 shrink-0 place-items-center rounded-xl xs:grid ${tone}`}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <FitAmount className={`mt-1.5 text-xl font-bold tracking-tight sm:text-2xl ${negative ? 'text-neg' : 'text-ink'}`}>{text}</FitAmount>
      )}
    </div>
  )
}

function BankCard({ account, onEdit }) {
  const negative = isNegative(account.current_balance)
  return (
    <article className="card relative min-w-0">
      <Link to={`/bank/${account.id}`} className="block h-full rounded-2xl p-4 transition hover:bg-muted sm:p-5">
        <span className="flex items-start gap-3 pr-10">
          <AccountIcon account={account} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words text-base font-semibold text-ink">{account.bank_name || account.name}</span>
            <span className="block break-words text-sm text-ink-3">{account.name}</span>
          </span>
        </span>
        <span className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <span className="min-w-0">
            <span className="block text-xs text-ink-3">Account No.</span>
            <span className="num block truncate text-ink-2">{account.masked_number || '—'}</span>
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-ink-3">IFSC</span>
            <span className="block truncate text-ink-2">{account.ifsc || '—'}</span>
          </span>
        </span>
        <span className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-line pt-3">
          <span className="flex flex-wrap gap-1.5">
            {account.is_default && <Badge tone="brand">Default</Badge>}
            {account.print_on_invoice && <Badge tone="pos">On invoice</Badge>}
          </span>
          <span className="ml-auto min-w-0 text-right">
            <span className="block text-xs text-ink-3">{negative ? 'Overdrawn' : 'Balance'}</span>
            <FitAmount as="span" className={`text-lg font-bold tracking-tight ${negative ? 'text-neg' : 'text-ink'}`}>
              {formatMoney(account.current_balance)}
            </FitAmount>
          </span>
        </span>
      </Link>
      <div className="absolute right-2 top-2 sm:right-3 sm:top-3">
        <Menu
          trigger={({ toggle }) => <IconButton icon={EllipsisVertical} label={`Actions for ${account.name}`} onClick={toggle} />}
          items={[
            { label: 'View Transactions', icon: Eye, to: `/bank/${account.id}` },
            { label: 'Edit', icon: Pencil, onClick: onEdit },
          ]}
        />
      </div>
    </article>
  )
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
        <Skeleton className="col-span-2 h-24 rounded-2xl lg:col-span-1" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  )
}

export default function BankAccounts() {
  const { t, language } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = useAccounts()
  const [editing, setEditing] = useState(null) // { account }
  const [transferOpen, setTransferOpen] = useState(false)

  // Quick action "Add / Reduce money" links to /bank?transfer=1
  useEffect(() => {
    if (searchParams.get('transfer') !== '1') return
    setTransferOpen(true)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('transfer')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])

  const accounts = query.data?.results || []
  const summary = query.data?.summary
  const banks = accounts.filter((account) => account.kind === 'bank')
  const secondary = (key) => (language === 'en' ? gujarati(key) : '')

  return (
    <Page
      title={t('cash_bank')}
      subtitle={summary ? `Bank balance ${formatMoney(summary.bank_balance)}` : undefined}
      actions={<Button variant="secondary" icon={ArrowRightLeft} onClick={() => setTransferOpen(true)}>Add / Reduce money</Button>}
      mobileActions={(
        <button
          type="button"
          aria-label="Add / Reduce money"
          onClick={() => setTransferOpen(true)}
          className="grid size-11 place-items-center rounded-full text-ink-2 transition hover:bg-subtle hover:text-ink"
        >
          <ArrowRightLeft className="size-[21px]" />
        </button>
      )}
    >
      {query.isError ? (
        <div className="card"><ErrorState error={query.error} onRetry={query.refetch} /></div>
      ) : query.isPending ? (
        <LoadingState />
      ) : (
        <div className="space-y-6">
          <BalanceTile
            label={t('bank_balance')}
            secondary={secondary('bank_balance')}
            value={summary?.bank_balance}
            icon={Landmark}
            tone="bg-brand-soft text-brand-ink"
          />

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-ink sm:text-lg">Bank Accounts</h2>
                <p className="text-sm text-ink-3">
                  {banks.length ? `${banks.length} account${banks.length === 1 ? '' : 's'}` : 'Accounts you receive and make payments from'}
                </p>
              </div>
            </div>
            {banks.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={Landmark}
                  title="Bank account B is being set up"
                  message="Reload the page in a moment."
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3">
                {banks.map((account) => (
                  <BankCard
                    key={account.id}
                    account={account}
                    onEdit={() => setEditing({ account })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <BankAccountDialog
        open={Boolean(editing)}
        account={editing?.account || null}
        isFirstBank={banks.length === 0}
        onClose={() => setEditing(null)}
      />
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} />
    </Page>
  )
}
