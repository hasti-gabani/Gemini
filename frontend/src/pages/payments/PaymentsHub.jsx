import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router'

import Page, { Fab } from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { Tabs } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { PAYMENT_KINDS } from './paymentConfig.js'
import { PaymentListContent } from './PaymentShared.jsx'

/** Phone "Payments" tab: Payment In and Payment Out in one place. */
export default function PaymentsHub() {
  const { t } = useSession()
  const [params, setParams] = useSearchParams()
  const kind = params.get('tab') === 'out' ? 'out' : 'in'
  const cfg = PAYMENT_KINDS[kind]
  return (
    <Page
      title={t('payments')}
      actions={(
        <>
          <Button to="/payments-in/new" variant="secondary" icon={ArrowDownLeft}>Payment In</Button>
          <Button to="/payments-out/new" variant="secondary" icon={ArrowUpRight}>Payment Out</Button>
        </>
      )}
      mobileActions={null}
      headerExtra={(
        <Tabs
          value={kind}
          onChange={(value) => setParams(value === 'out' ? { tab: 'out' } : {}, { replace: true })}
          items={[
            { value: 'in', label: t('payment_in'), icon: ArrowDownLeft },
            { value: 'out', label: t('payment_out'), icon: ArrowUpRight },
          ]}
        />
      )}
      fab={<Fab><Button to={`${cfg.base}/new`} size="lg" icon={Plus} variant={kind === 'in' ? 'success' : 'danger'}>{cfg.newLabel}</Button></Fab>}
    >
      <PaymentListContent key={kind} kind={kind} />
    </Page>
  )
}
